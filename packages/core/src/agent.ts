/**
 * Agent runtime — the core execution loop.
 *
 * An Agent takes a user message, iteratively calls the LLM, executes tools,
 * and returns a final response. Supports streaming, tool use, memory, and
 * configurable iteration limits.
 */

import { EventEmitter } from 'eventemitter3';
import { ToolRegistry } from './tools.js';
import { ProviderError, ValidationError } from './errors.js';
import type {
  AgentConfig,
  AgentEvents,
  AgentRun,
  AgentStatus,
  ChatRequest,
  ChatResponse,
  Message,
  ToolCall,
  ToolContext,
  ToolResult,
} from './types.js';
import { InMemoryStore } from './memory.js';

let _runCounter = 0;
function nextRunId(): string {
  return `run_${Date.now()}_${++_runCounter}`;
}

/**
 * An Agent orchestrates the LLM ↔ tool execution loop.
 *
 * It holds configuration (model, tools, memory, limits), exposes an event
 * emitter for observability, and provides a `run()` method that processes a
 * user message to completion.
 *
 * @example
 * ```typescript
 * const agent = new Agent({
 *   id: 'my-agent',
 *   name: 'My Agent',
 *   systemPrompt: 'You are a helpful assistant.',
 *   llm: createOpenAIProvider({ model: 'gpt-4o' }),
 *   tools: [calculatorTool, httpRequestTool],
 * })
 * const result = await agent.run('What is 42 * 7?')
 * console.log(result.result)
 * ```
 */
export class Agent {
  /** The full agent configuration as supplied to the constructor. */
  readonly config: AgentConfig;
  /**
   * EventEmitter for observability hooks.
   *
   * Subscribe to events like `agent:start`, `agent:tool_call`,
   * `agent:tool_result`, `agent:complete`, and `agent:error`.
   */
  readonly events: EventEmitter<AgentEvents>;
  private toolRegistry: ToolRegistry;

  /**
   * Create a new Agent.
   *
   * @param config - Agent configuration (model, tools, memory, etc.)
   * @throws {ValidationError} If required fields (id, name, systemPrompt, llm) are missing.
   */
  constructor(config: AgentConfig) {
    // Validate required fields
    if (!config.id || typeof config.id !== 'string') {
      throw new ValidationError('AgentConfig.id must be a non-empty string');
    }
    if (!config.name || typeof config.name !== 'string') {
      throw new ValidationError('AgentConfig.name must be a non-empty string');
    }
    if (!config.systemPrompt || typeof config.systemPrompt !== 'string') {
      throw new ValidationError('AgentConfig.systemPrompt must be a non-empty string');
    }
    if (!config.llm || typeof config.llm.chat !== 'function') {
      throw new ValidationError('AgentConfig.llm must implement the LLMProvider interface');
    }
    if (config.maxIterations !== undefined && config.maxIterations < 1) {
      throw new ValidationError('AgentConfig.maxIterations must be at least 1');
    }
    if (config.maxToolCalls !== undefined && config.maxToolCalls < 1) {
      throw new ValidationError('AgentConfig.maxToolCalls must be at least 1');
    }

    this.config = config;
    this.events = new EventEmitter();
    this.toolRegistry = new ToolRegistry();
    if (config.tools) {
      this.toolRegistry.registerAll(config.tools);
    }
  }

  /** The agent's unique identifier. */
  get id(): string {
    return this.config.id;
  }

  /** The agent's display name. */
  get name(): string {
    return this.config.name;
  }

  /**
   * Run the agent with a user message. Returns the full run result.
   *
   * The agent calls the LLM, executes any requested tools, feeds the results
   * back, and repeats until the LLM stops requesting tools or `maxIterations`
   * is reached. All tool calls happen in parallel within each iteration.
   *
   * @param userMessage - The user's message to process.
   * @param options.signal            - AbortSignal to cancel the run.
   * @param options.additionalMessages - Extra messages to prepend (e.g. conversation history).
   * @returns A fully populated `AgentRun` record including status, messages, tool results, and usage.
   * @throws {ProviderError} If the LLM provider throws a non-retryable error.
   *
   * @example
   * ```typescript
   * const run = await agent.run('What is 2 + 2?')
   * if (run.status === 'completed') {
   *   console.log(run.result)
   * }
   * ```
   */
  async run(
    userMessage: string,
    options: { signal?: AbortSignal; additionalMessages?: Message[] } = {},
  ): Promise<AgentRun> {
    const runId = nextRunId();
    const maxIterations = this.config.maxIterations ?? 25;
    const maxToolCalls = this.config.maxToolCalls ?? 50;
    const memory = this.config.memory ?? new InMemoryStore();

    const run: AgentRun = {
      id: runId,
      agentId: this.config.id,
      status: 'running',
      messages: [],
      toolResults: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      startedAt: new Date(),
      iterations: 0,
    };

    // Build initial messages
    const messages: Message[] = [
      { role: 'system', content: this.config.systemPrompt },
      ...(options.additionalMessages ?? []),
      { role: 'user', content: userMessage },
    ];

    run.messages.push(...messages);
    this.events.emit('agent:start', { runId, agentId: this.config.id });

    let totalToolCalls = 0;

    try {
      for (let i = 0; i < maxIterations; i++) {
        if (options.signal?.aborted) {
          run.status = 'error';
          run.error = 'Aborted';
          break;
        }

        run.iterations = i + 1;
        this.events.emit('agent:iteration', {
          runId,
          iteration: i + 1,
          messages: [...messages],
        });

        // Allow message interception
        let callMessages = [...messages];
        if (this.config.onBeforeCall) {
          try {
            callMessages = await this.config.onBeforeCall(callMessages);
          } catch (hookErr) {
            throw new ProviderError(
              `onBeforeCall hook failed: ${hookErr instanceof Error ? hookErr.message : String(hookErr)}`,
              this.config.llm.model,
              hookErr,
            );
          }
        }

        // Build request
        const tools = this.toolRegistry.list().length > 0
          ? this.toolRegistry.toOpenAISchemas()
          : undefined;

        const request: ChatRequest = {
          messages: callMessages,
          tools,
          temperature: this.config.temperature,
        };

        // Call LLM — wrap SDK errors in ProviderError
        let response: ChatResponse;
        try {
          response = await this.config.llm.chat(request);
        } catch (llmErr) {
          throw new ProviderError(
            `LLM provider "${this.config.llm.model}" failed: ${llmErr instanceof Error ? llmErr.message : String(llmErr)}`,
            this.config.llm.model,
            llmErr,
          );
        }

        // Track usage
        run.usage.prompt_tokens += response.usage.prompt_tokens;
        run.usage.completion_tokens += response.usage.completion_tokens;
        run.usage.total_tokens += response.usage.total_tokens;

        // Add assistant message
        messages.push(response.message);
        run.messages.push(response.message);
        this.events.emit('agent:message', { runId, message: response.message });

        if (this.config.onAfterCall) {
          try {
            await this.config.onAfterCall(response);
          } catch (hookErr) {
            throw new ProviderError(
              `onAfterCall hook failed: ${hookErr instanceof Error ? hookErr.message : String(hookErr)}`,
              this.config.llm.model,
              hookErr,
            );
          }
        }

        // If no tool calls, we're done
        if (response.finish_reason !== 'tool_calls' || !response.message.tool_calls?.length) {
          run.status = 'completed';
          run.result = response.message.content;
          break;
        }

        // Execute tool calls
        const toolCalls = response.message.tool_calls!;
        totalToolCalls += toolCalls.length;

        if (totalToolCalls > maxToolCalls) {
          run.status = 'error';
          run.error = `Exceeded maximum tool calls (${maxToolCalls})`;
          break;
        }

        const toolContext: ToolContext = {
          agentId: this.config.id,
          memory,
          signal: options.signal ?? new AbortController().signal,
          emit: (event, data) => this.events.emit(event as any, data as any),
        };

        // Execute all tool calls (can be parallelized)
        const results = await Promise.all(
          toolCalls.map(async (tc: ToolCall) => {
            this.events.emit('agent:tool_call', { runId, toolCall: tc });
            const result = await this.toolRegistry.execute(tc, toolContext);
            this.events.emit('agent:tool_result', { runId, result });
            return result;
          }),
        );

        // Add tool results to messages
        for (const result of results) {
          run.toolResults.push(result);
          const toolMessage: Message = {
            role: 'tool',
            content: result.error
              ? `Error: ${result.error}`
              : JSON.stringify(result.result),
            tool_call_id: result.toolCallId,
          };
          messages.push(toolMessage);
          run.messages.push(toolMessage);
        }
      }

      // If we exhausted iterations without completing
      if (run.status === 'running') {
        run.status = 'error';
        run.error = `Exceeded maximum iterations (${maxIterations})`;
      }
    } catch (err) {
      run.status = 'error';
      run.error = err instanceof Error ? err.message : String(err);
      this.events.emit('agent:error', { runId, error: run.error });
    }

    run.completedAt = new Date();

    if (run.status === 'completed' && run.result) {
      this.events.emit('agent:complete', { runId, result: run.result });
    }

    return run;
  }
}

/**
 * Convenience factory for creating an Agent.
 *
 * Equivalent to `new Agent(config)` but reads more naturally in pipelines.
 *
 * @param config - Agent configuration.
 * @returns A new `Agent` instance.
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   id: 'assistant',
 *   name: 'Assistant',
 *   systemPrompt: 'You are a helpful assistant.',
 *   llm: createOpenAIProvider(),
 * })
 * ```
 */
export function createAgent(config: AgentConfig): Agent {
  return new Agent(config);
}
