/**
 * AgentKit error hierarchy.
 *
 * All errors thrown by AgentKit extend AgentKitError, which makes it easy
 * to distinguish library errors from application errors in catch blocks.
 *
 * @example
 * ```typescript
 * import { AgentKitError, ProviderError, ToolExecutionError } from '@agentkit/core'
 *
 * try {
 *   await agent.run('hello')
 * } catch (err) {
 *   if (err instanceof ProviderError) {
 *     console.error('LLM provider failed:', err.provider, err.message)
 *   } else if (err instanceof ToolExecutionError) {
 *     console.error('Tool failed:', err.toolName, err.message)
 *   }
 * }
 * ```
 */

/**
 * Base class for all AgentKit errors.
 *
 * Extends the built-in Error with a stable machine-readable `code` and an
 * optional `cause` (the underlying error that triggered this one).
 */
export class AgentKitError extends Error {
  /**
   * @param message - Human-readable description of what went wrong.
   * @param code    - Machine-readable error code (e.g. "PROVIDER_ERROR").
   * @param cause   - The underlying error or value that caused this error.
   */
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AgentKitError';
    // Maintain proper prototype chain in transpiled ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an LLM provider (OpenAI, Anthropic, …) returns an error or
 * is unreachable.
 *
 * @example
 * ```typescript
 * throw new ProviderError('Rate limit exceeded', 'openai', originalError)
 * ```
 */
export class ProviderError extends AgentKitError {
  /**
   * @param message  - Human-readable description.
   * @param provider - Identifier of the provider that failed (e.g. "openai").
   * @param cause    - The original SDK error.
   */
  constructor(
    message: string,
    public readonly provider: string,
    cause?: unknown,
  ) {
    super(message, 'PROVIDER_ERROR', cause);
    this.name = 'ProviderError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a tool's `execute` function throws or times out.
 *
 * @example
 * ```typescript
 * throw new ToolExecutionError('HTTP request failed', 'http_request', originalError)
 * ```
 */
export class ToolExecutionError extends AgentKitError {
  /**
   * @param message  - Human-readable description.
   * @param toolName - The name of the tool that failed.
   * @param cause    - The original error thrown by the tool.
   */
  constructor(
    message: string,
    public readonly toolName: string,
    cause?: unknown,
  ) {
    super(message, 'TOOL_EXECUTION_ERROR', cause);
    this.name = 'ToolExecutionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the task graph is invalid (cycle, missing dependency, …) or
 * when a task execution fails in an unrecoverable way.
 *
 * @example
 * ```typescript
 * throw new TaskGraphError('Cycle detected', 'task-a')
 * ```
 */
export class TaskGraphError extends AgentKitError {
  /**
   * @param message - Human-readable description.
   * @param taskId  - The task ID involved in the error, if known.
   * @param cause   - The underlying error, if any.
   */
  constructor(
    message: string,
    public readonly taskId?: string,
    cause?: unknown,
  ) {
    super(message, 'TASK_GRAPH_ERROR', cause);
    this.name = 'TaskGraphError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a value fails Zod (or other) schema validation.
 *
 * @example
 * ```typescript
 * throw new ValidationError('Invalid agent config: model is required')
 * ```
 */
export class ValidationError extends AgentKitError {
  /**
   * @param message - Description of which field(s) failed validation.
   * @param cause   - The original ZodError or other validation error.
   */
  constructor(message: string, cause?: unknown) {
    super(message, 'VALIDATION_ERROR', cause);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an operation exceeds its configured time limit.
 *
 * @example
 * ```typescript
 * throw new TimeoutError('Tool "http_request" timed out', 30000)
 * ```
 */
export class TimeoutError extends AgentKitError {
  /**
   * @param message   - Human-readable description.
   * @param timeoutMs - The timeout limit in milliseconds that was exceeded.
   */
  constructor(
    message: string,
    public readonly timeoutMs: number,
  ) {
    super(message, 'TIMEOUT_ERROR');
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
