/**
 * Tool registry and execution engine.
 *
 * Converts Zod-based tool definitions into OpenAI function schemas,
 * manages tool registration, and handles execution with timeouts and retries.
 */

import { zodToJsonSchema } from './utils/zod-to-json.js';
import { ToolExecutionError, TimeoutError, ValidationError } from './errors.js';
import type {
  OpenAIToolSchema,
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from './types.js';

/**
 * Registry that stores tool definitions and executes them on behalf of agents.
 *
 * Tools are keyed by name. The registry converts Zod schemas to OpenAI
 * function-calling JSON Schema and enforces per-tool timeouts.
 *
 * @example
 * ```typescript
 * const registry = new ToolRegistry()
 * registry.register(calculatorTool)
 * const schemas = registry.toOpenAISchemas()
 * ```
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /**
   * Register a single tool. Throws if a tool with the same name already exists.
   *
   * @param tool - The tool definition to register.
   * @throws {ValidationError} If a tool with the same name is already registered.
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new ValidationError(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools at once. Stops and throws on the first duplicate.
   *
   * @param tools - Array of tool definitions to register.
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Retrieve a tool by name.
   *
   * @param name - The tool's registered name.
   * @returns The tool definition, or `undefined` if not found.
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check whether a tool with the given name is registered.
   *
   * @param name - The tool name to check.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Return all registered tool definitions.
   */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Convert all registered tools to the OpenAI function-calling JSON Schema format.
   *
   * @returns An array of OpenAI tool schema objects ready to pass to the API.
   */
  toOpenAISchemas(): OpenAIToolSchema[] {
    return this.list().map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters),
      },
    }));
  }

  /**
   * Execute a tool call end-to-end: parse arguments, validate with Zod,
   * run the tool with a timeout, and return a structured ToolResult.
   *
   * This method never throws — all errors are captured in `ToolResult.error`.
   *
   * @param toolCall - The raw tool call from the LLM response.
   * @param context  - Execution context (agent ID, memory, abort signal, …).
   * @returns A `ToolResult` describing the outcome (success or error).
   */
  async execute(
    toolCall: ToolCall,
    context: ToolContext,
  ): Promise<ToolResult> {
    const start = Date.now();
    const tool = this.tools.get(toolCall.function.name);

    if (!tool) {
      return {
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        result: null,
        error: `Unknown tool: ${toolCall.function.name}`,
        durationMs: Date.now() - start,
      };
    }

    try {
      // Parse arguments
      let args: unknown;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch (parseErr) {
        return {
          toolCallId: toolCall.id,
          name: tool.name,
          result: null,
          error: `Invalid JSON arguments: ${toolCall.function.arguments}`,
          durationMs: Date.now() - start,
        };
      }

      // Validate with Zod
      const parsed = tool.parameters.safeParse(args);
      if (!parsed.success) {
        const validationError = new ValidationError(
          `Validation error for tool "${tool.name}": ${parsed.error.message}`,
          parsed.error,
        );
        return {
          toolCallId: toolCall.id,
          name: tool.name,
          result: null,
          error: validationError.message,
          durationMs: Date.now() - start,
        };
      }

      // Execute with timeout
      const timeout = tool.timeout ?? 30_000;
      let result: unknown;
      try {
        result = await Promise.race([
          tool.execute(parsed.data, context),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new TimeoutError(
                    `Tool "${tool.name}" timed out after ${timeout}ms`,
                    timeout,
                  ),
                ),
              timeout,
            ),
          ),
        ]);
      } catch (execErr) {
        if (execErr instanceof TimeoutError) {
          return {
            toolCallId: toolCall.id,
            name: tool.name,
            result: null,
            error: execErr.message,
            durationMs: Date.now() - start,
          };
        }
        throw new ToolExecutionError(
          `Tool "${tool.name}" failed: ${execErr instanceof Error ? execErr.message : String(execErr)}`,
          tool.name,
          execErr,
        );
      }

      return {
        toolCallId: toolCall.id,
        name: tool.name,
        result,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: toolCall.id,
        name: tool.name,
        result: null,
        error,
        durationMs: Date.now() - start,
      };
    }
  }
}

/**
 * Create a strongly-typed tool definition with full type inference from the
 * Zod parameter schema.
 *
 * @example
 * ```typescript
 * const greet = defineTool({
 *   name: 'greet',
 *   description: 'Say hello',
 *   parameters: z.object({ name: z.string() }),
 *   async execute({ name }) {
 *     return { greeting: `Hello, ${name}!` }
 *   },
 * })
 * ```
 *
 * @param definition - Full tool definition with Zod schema and execute function.
 * @returns The same definition, typed with inferred input/output types.
 */
export function defineTool<TInput, TOutput>(
  definition: ToolDefinition<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> {
  return definition;
}
