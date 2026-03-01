/**
 * Task Graph Engine — orchestrates multi-step, multi-agent workflows.
 *
 * Tasks are arranged as a DAG (directed acyclic graph). The engine resolves
 * dependencies, runs tasks in parallel where possible, passes outputs
 * between tasks via inputMap, and supports conditions, retries, and timeouts.
 */

import { EventEmitter } from 'eventemitter3';
import { Agent } from './agent.js';
import { InMemoryStore } from './memory.js';
import type {
  AgentEvents,
  MemoryStore,
  TaskContext,
  TaskGraphConfig,
  TaskGraphRun,
  TaskIO,
  TaskNode,
  TaskResult,
  TaskStatus,
} from './types.js';

let _graphRunCounter = 0;
function nextGraphRunId(): string {
  return `graph_${Date.now()}_${++_graphRunCounter}`;
}

export class TaskGraph {
  readonly config: TaskGraphConfig;
  readonly events: EventEmitter<AgentEvents>;
  private memory: MemoryStore;

  constructor(config: TaskGraphConfig, memory?: MemoryStore) {
    this.config = config;
    this.events = new EventEmitter();
    this.memory = memory ?? new InMemoryStore();
    this.validateGraph();
  }

  /** Run the full task graph to completion */
  async run(options: { signal?: AbortSignal } = {}): Promise<TaskGraphRun> {
    const runId = nextGraphRunId();
    const run: TaskGraphRun = {
      id: runId,
      graphId: this.config.id,
      status: 'running',
      taskResults: new Map(),
      startedAt: new Date(),
    };

    this.events.emit('graph:start', { graphId: this.config.id });

    const outputs = new Map<string, TaskIO>();
    const taskMap = new Map(this.config.tasks.map((t) => [t.id, t]));
    const completed = new Set<string>();
    const failed = new Set<string>();

    try {
      while (completed.size + failed.size < this.config.tasks.length) {
        if (options.signal?.aborted) {
          throw new Error('Graph execution aborted');
        }

        // Find tasks ready to run (all deps completed, not yet run)
        const ready = this.config.tasks.filter((task) => {
          if (completed.has(task.id) || failed.has(task.id)) return false;
          const deps = task.dependsOn ?? [];
          return deps.every((d) => completed.has(d));
        });

        if (ready.length === 0 && completed.size + failed.size < this.config.tasks.length) {
          // Remaining tasks have failed dependencies — skip them
          for (const task of this.config.tasks) {
            if (!completed.has(task.id) && !failed.has(task.id)) {
              const result: TaskResult = {
                taskId: task.id,
                status: 'skipped',
                error: 'Dependency failed',
                startedAt: new Date(),
                completedAt: new Date(),
                durationMs: 0,
              };
              run.taskResults.set(task.id, result);
              failed.add(task.id);
            }
          }
          break;
        }

        // Run all ready tasks in parallel
        const results = await Promise.all(
          ready.map((task) =>
            this.executeTask(task, outputs, options.signal),
          ),
        );

        for (const result of results) {
          run.taskResults.set(result.taskId, result);

          if (result.status === 'completed') {
            completed.add(result.taskId);
            if (result.output) {
              outputs.set(result.taskId, result.output);
            }
            this.events.emit('task:complete', {
              graphId: this.config.id,
              result,
            });
            if (this.config.onTaskComplete) {
              await this.config.onTaskComplete(result);
            }
          } else {
            failed.add(result.taskId);
            this.events.emit('task:error', {
              graphId: this.config.id,
              taskId: result.taskId,
              error: result.error ?? 'Unknown error',
            });
          }
        }
      }

      run.status = failed.size > 0 ? 'failed' : 'completed';
    } catch (err) {
      run.status = 'failed';
      const error = err instanceof Error ? err.message : String(err);
      this.events.emit('graph:error', { graphId: this.config.id, error });
    }

    run.completedAt = new Date();
    this.events.emit('graph:complete', {
      graphId: this.config.id,
      results: run.taskResults,
    });

    return run;
  }

  /** Execute a single task node */
  private async executeTask(
    task: TaskNode,
    outputs: Map<string, TaskIO>,
    signal?: AbortSignal,
  ): Promise<TaskResult> {
    const start = new Date();

    this.events.emit('task:start', {
      graphId: this.config.id,
      taskId: task.id,
    });

    // Build task context
    const context: TaskContext = {
      taskId: task.id,
      graphId: this.config.id,
      outputs,
      memory: this.memory,
      signal: signal ?? new AbortController().signal,
      emit: (event, data) => this.events.emit(event as any, data as any),
    };

    // Check condition
    if (task.condition && !task.condition(context)) {
      return {
        taskId: task.id,
        status: 'skipped',
        startedAt: start,
        completedAt: new Date(),
        durationMs: Date.now() - start.getTime(),
      };
    }

    // Build input from inputMap
    const input: TaskIO = { ...(this.config.input ?? {}) };
    if (task.inputMap) {
      for (const [key, source] of Object.entries(task.inputMap)) {
        // source format: "taskId.outputKey" or just "taskId" for full output
        const [sourceTaskId, outputKey] = source.split('.');
        const sourceOutput = outputs.get(sourceTaskId);
        if (sourceOutput) {
          input[key] = outputKey ? sourceOutput[outputKey] : sourceOutput;
        }
      }
    }

    const maxAttempts = (task.retries ?? 0) + 1;
    let lastError: string | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        let output: TaskIO | undefined;

        if (task.execute) {
          // Custom function execution
          output = await this.withTimeout(
            task.execute(input, context),
            task.timeout,
          );
        } else if (task.agent) {
          // Agent execution
          const agent = new Agent(task.agent);
          const prompt = typeof input.prompt === 'string'
            ? input.prompt
            : JSON.stringify(input);

          const run = await agent.run(prompt, { signal });

          output = {
            result: run.result ?? '',
            status: run.status,
            toolResults: run.toolResults,
            usage: run.usage,
          };
        } else {
          // Passthrough
          output = input;
        }

        return {
          taskId: task.id,
          status: 'completed',
          output,
          startedAt: start,
          completedAt: new Date(),
          durationMs: Date.now() - start.getTime(),
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < maxAttempts - 1) {
          // Wait before retry (exponential backoff)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(1000 * 2 ** attempt, 10_000)),
          );
        }
      }
    }

    return {
      taskId: task.id,
      status: 'failed',
      error: lastError,
      startedAt: start,
      completedAt: new Date(),
      durationMs: Date.now() - start.getTime(),
    };
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs?: number,
  ): Promise<T> {
    if (!timeoutMs) return promise;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }

  /** Validate the graph has no cycles and all deps exist */
  private validateGraph(): void {
    const ids = new Set(this.config.tasks.map((t) => t.id));

    for (const task of this.config.tasks) {
      // Each task must have either an agent config or an execute function
      if (!task.agent && !task.execute) {
        throw new Error(
          `Task "${task.id}" must define either "agent" or "execute"`,
        );
      }

      for (const dep of task.dependsOn ?? []) {
        if (!ids.has(dep)) {
          throw new Error(
            `Task "${task.id}" depends on unknown task "${dep}"`,
          );
        }
        if (dep === task.id) {
          throw new Error(`Task "${task.id}" depends on itself`);
        }
      }
    }

    // Detect cycles via topological sort
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Cycle detected in task graph involving task "${id}"`);
      }
      visiting.add(id);
      const task = this.config.tasks.find((t) => t.id === id)!;
      for (const dep of task.dependsOn ?? []) {
        visit(dep);
      }
      visiting.delete(id);
      visited.add(id);
    };

    for (const task of this.config.tasks) {
      visit(task.id);
    }
  }
}

/** Convenience factory */
export function createTaskGraph(
  config: TaskGraphConfig,
  memory?: MemoryStore,
): TaskGraph {
  return new TaskGraph(config, memory);
}
