/**
 * Tests for TaskGraph — validateGraph() and DAG execution ordering.
 */

import { describe, it, expect, vi } from 'vitest';
import { TaskGraph } from '../graph.js';
import type { TaskGraphConfig, TaskIO } from '../types.js';

// Minimal stub for LLMProvider — never actually called in these tests
const stubLLM = {
  model: 'stub',
  async chat() {
    throw new Error('LLM should not be called in unit tests');
  },
};

// Helper: build a minimal valid graph config
function makeConfig(
  overrides: Partial<TaskGraphConfig> = {},
): TaskGraphConfig {
  return {
    id: 'test-graph',
    name: 'Test Graph',
    tasks: [
      {
        id: 'task-a',
        name: 'Task A',
        execute: async (input: TaskIO) => ({ ...input, a: true }),
      },
    ],
    ...overrides,
  };
}

// ============================================================================
// Construction / validation
// ============================================================================

describe('TaskGraph — construction and validateGraph()', () => {
  it('creates successfully with a valid single-task graph', () => {
    expect(() => new TaskGraph(makeConfig())).not.toThrow();
  });

  it('creates successfully with a valid multi-task DAG', () => {
    const config = makeConfig({
      tasks: [
        {
          id: 'a',
          name: 'A',
          execute: async () => ({ done: true }),
        },
        {
          id: 'b',
          name: 'B',
          dependsOn: ['a'],
          execute: async () => ({ done: true }),
        },
        {
          id: 'c',
          name: 'C',
          dependsOn: ['a'],
          execute: async () => ({ done: true }),
        },
        {
          id: 'd',
          name: 'D',
          dependsOn: ['b', 'c'],
          execute: async () => ({ done: true }),
        },
      ],
    });
    expect(() => new TaskGraph(config)).not.toThrow();
  });

  it('throws when a dependsOn reference points to a non-existent task', () => {
    const config = makeConfig({
      tasks: [
        {
          id: 'task-a',
          name: 'Task A',
          dependsOn: ['ghost-task'], // does not exist
          execute: async () => ({}),
        },
      ],
    });
    expect(() => new TaskGraph(config)).toThrow(/unknown task|ghost-task/i);
  });

  it('throws when a task depends on itself', () => {
    const config = makeConfig({
      tasks: [
        {
          id: 'task-a',
          name: 'Task A',
          dependsOn: ['task-a'], // self-reference
          execute: async () => ({}),
        },
      ],
    });
    expect(() => new TaskGraph(config)).toThrow(/unknown task|itself|task-a/i);
  });

  it('throws on a simple two-node cycle (A -> B -> A)', () => {
    // Note: validateGraph checks that dependsOn points to existing IDs,
    // so we build a three-node cycle where no single node self-references.
    const config = makeConfig({
      tasks: [
        {
          id: 'a',
          name: 'A',
          dependsOn: ['c'], // creates cycle: a->c->b->a
          execute: async () => ({}),
        },
        {
          id: 'b',
          name: 'B',
          dependsOn: ['a'],
          execute: async () => ({}),
        },
        {
          id: 'c',
          name: 'C',
          dependsOn: ['b'],
          execute: async () => ({}),
        },
      ],
    });
    expect(() => new TaskGraph(config)).toThrow(/cycle/i);
  });

  it('throws on a direct two-node cycle (A depends on B, B depends on A)', () => {
    const config = makeConfig({
      tasks: [
        {
          id: 'a',
          name: 'A',
          dependsOn: ['b'],
          execute: async () => ({}),
        },
        {
          id: 'b',
          name: 'B',
          dependsOn: ['a'],
          execute: async () => ({}),
        },
      ],
    });
    expect(() => new TaskGraph(config)).toThrow(/cycle/i);
  });

  it('throws when a node has neither agent nor execute defined', () => {
    const config = makeConfig({
      tasks: [
        {
          id: 'no-executor',
          name: 'No Executor',
          // neither agent nor execute provided
        },
      ],
    });
    // Per the spec: validateGraph should reject nodes with no executor.
    // The current implementation treats these as passthrough (returns input),
    // so we assert the expected behaviour after the fix is applied.
    // If the project chose passthrough semantics instead of erroring, this
    // test would need adjusting — but the brief says to throw.
    expect(() => new TaskGraph(config)).toThrow(/agent|execute/i);
  });
});

// ============================================================================
// Execution ordering
// ============================================================================

describe('TaskGraph — DAG execution ordering', () => {
  it('runs a single execute task and returns its output', async () => {
    const graph = new TaskGraph(
      makeConfig({
        tasks: [
          {
            id: 'only',
            name: 'Only Task',
            execute: async (_input: TaskIO) => ({ answer: 42 }),
          },
        ],
      }),
    );

    const run = await graph.run();
    expect(run.status).toBe('completed');
    const result = run.taskResults.get('only');
    expect(result?.status).toBe('completed');
    expect(result?.output?.answer).toBe(42);
  });

  it('runs dependencies before dependents', async () => {
    const order: string[] = [];

    const config = makeConfig({
      tasks: [
        {
          id: 'a',
          name: 'A',
          execute: async () => {
            order.push('a');
            return {};
          },
        },
        {
          id: 'b',
          name: 'B',
          dependsOn: ['a'],
          execute: async () => {
            order.push('b');
            return {};
          },
        },
        {
          id: 'c',
          name: 'C',
          dependsOn: ['b'],
          execute: async () => {
            order.push('c');
            return {};
          },
        },
      ],
    });

    const graph = new TaskGraph(config);
    const run = await graph.run();

    expect(run.status).toBe('completed');
    // Each node must appear after all its deps
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('runs independent tasks in parallel (both complete before dependent)', async () => {
    const completedAt: Record<string, number> = {};

    const config = makeConfig({
      tasks: [
        {
          id: 'left',
          name: 'Left',
          execute: async () => {
            // small artificial delay to make timing observable
            await new Promise((r) => setTimeout(r, 20));
            completedAt['left'] = Date.now();
            return {};
          },
        },
        {
          id: 'right',
          name: 'Right',
          execute: async () => {
            await new Promise((r) => setTimeout(r, 20));
            completedAt['right'] = Date.now();
            return {};
          },
        },
        {
          id: 'join',
          name: 'Join',
          dependsOn: ['left', 'right'],
          execute: async () => {
            // Small delay ensures join timestamp is strictly after parallel tasks
            // even when Date.now() only has 1ms resolution.
            await new Promise((r) => setTimeout(r, 1));
            completedAt['join'] = Date.now();
            return {};
          },
        },
      ],
    });

    const graph = new TaskGraph(config);
    const run = await graph.run();

    expect(run.status).toBe('completed');
    expect(completedAt['left']).toBeLessThan(completedAt['join']);
    expect(completedAt['right']).toBeLessThan(completedAt['join']);
  });

  it('pipes output from one task to the next via inputMap', async () => {
    const config = makeConfig({
      input: { seed: 1 },
      tasks: [
        {
          id: 'producer',
          name: 'Producer',
          execute: async (_input: TaskIO) => ({ value: 99 }),
        },
        {
          id: 'consumer',
          name: 'Consumer',
          dependsOn: ['producer'],
          inputMap: { receivedValue: 'producer.value' },
          execute: async (input: TaskIO) => ({ doubled: (input.receivedValue as number) * 2 }),
        },
      ],
    });

    const graph = new TaskGraph(config);
    const run = await graph.run();

    expect(run.status).toBe('completed');
    const consumer = run.taskResults.get('consumer');
    expect(consumer?.output?.doubled).toBe(198);
  });

  it('marks remaining tasks as skipped when a dependency fails', async () => {
    const config = makeConfig({
      tasks: [
        {
          id: 'fail',
          name: 'Fail',
          execute: async () => {
            throw new Error('intentional failure');
          },
        },
        {
          id: 'downstream',
          name: 'Downstream',
          dependsOn: ['fail'],
          execute: async () => ({ ran: true }),
        },
      ],
    });

    const graph = new TaskGraph(config);
    const run = await graph.run();

    expect(run.status).toBe('failed');
    expect(run.taskResults.get('fail')?.status).toBe('failed');
    expect(run.taskResults.get('downstream')?.status).toBe('skipped');
  });
});
