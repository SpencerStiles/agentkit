/**
 * Core type definitions for AgentKit.
 *
 * These types define the fundamental building blocks:
 * - Messages (LLM conversation format)
 * - Tools (function calling interface)
 * - Agent configuration and state
 * - Task graph nodes and edges
 * - Memory entries
 */

import type { ZodType } from 'zod';

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  parameters: ZodType<TInput>;
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
  /** If true, requires user confirmation before execution */
  requiresConfirmation?: boolean;
  /** Maximum execution time in ms (default: 30000) */
  timeout?: number;
  /** Retry configuration */
  retry?: { attempts: number; delay: number };
}

export interface ToolContext {
  agentId: string;
  taskId?: string;
  memory: MemoryStore;
  signal: AbortSignal;
  emit: (event: string, data: unknown) => void;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: unknown;
  error?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// LLM Provider
// ---------------------------------------------------------------------------

export interface LLMProvider {
  /** Generate a chat completion */
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Generate a streaming chat completion */
  stream?(request: ChatRequest): AsyncIterable<ChatChunk>;
  /** The model identifier */
  model: string;
}

export interface ChatRequest {
  messages: Message[];
  tools?: OpenAIToolSchema[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'text' | 'json_object' };
  stop?: string[];
}

export interface OpenAIToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResponse {
  message: Message;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
}

export interface ChatChunk {
  delta: Partial<Message>;
  finish_reason?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  llm: LLMProvider;
  tools?: ToolDefinition[];
  memory?: MemoryStore;
  /** Maximum number of LLM calls per run (default: 25) */
  maxIterations?: number;
  /** Maximum total tool calls per run (default: 50) */
  maxToolCalls?: number;
  /** Temperature override */
  temperature?: number;
  /** Hook called before each LLM call */
  onBeforeCall?: (messages: Message[]) => Promise<Message[]>;
  /** Hook called after each LLM response */
  onAfterCall?: (response: ChatResponse) => Promise<void>;
}

export type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

export interface AgentRun {
  id: string;
  agentId: string;
  status: AgentStatus;
  messages: Message[];
  toolResults: ToolResult[];
  result?: string;
  error?: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  startedAt: Date;
  completedAt?: Date;
  iterations: number;
}

// ---------------------------------------------------------------------------
// Task Graph
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface TaskNode {
  id: string;
  name: string;
  description?: string;
  /** The agent to execute this task, or an inline function */
  agent?: AgentConfig;
  execute?: (input: TaskIO, context: TaskContext) => Promise<TaskIO>;
  /** IDs of tasks that must complete before this one starts */
  dependsOn?: string[];
  /** Input mapping from previous task outputs */
  inputMap?: Record<string, string>;
  /** Condition: skip this task if returns false */
  condition?: (context: TaskContext) => boolean;
  /** Maximum retries on failure */
  retries?: number;
  /** Timeout in ms */
  timeout?: number;
}

export interface TaskIO {
  [key: string]: unknown;
}

export interface TaskContext {
  taskId: string;
  graphId: string;
  outputs: Map<string, TaskIO>;
  memory: MemoryStore;
  signal: AbortSignal;
  emit: (event: string, data: unknown) => void;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  output?: TaskIO;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  durationMs: number;
}

export interface TaskGraphConfig {
  id: string;
  name: string;
  description?: string;
  tasks: TaskNode[];
  /** Global input available to all tasks */
  input?: TaskIO;
  /** Hook for each task completion */
  onTaskComplete?: (result: TaskResult) => Promise<void>;
}

export interface TaskGraphRun {
  id: string;
  graphId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  taskResults: Map<string, TaskResult>;
  startedAt: Date;
  completedAt?: Date;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
  score?: number;
}

export interface MemoryStore {
  /** Add an entry to memory */
  add(content: string, metadata?: Record<string, unknown>): Promise<MemoryEntry>;
  /** Search memory by semantic similarity */
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
  /** Get a specific entry by ID */
  get(id: string): Promise<MemoryEntry | null>;
  /** Delete an entry */
  delete(id: string): Promise<void>;
  /** List all entries (optionally filtered) */
  list(filter?: Record<string, unknown>): Promise<MemoryEntry[]>;
  /** Clear all entries */
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface AgentEvents {
  'agent:start': { runId: string; agentId: string };
  'agent:message': { runId: string; message: Message };
  'agent:tool_call': { runId: string; toolCall: ToolCall };
  'agent:tool_result': { runId: string; result: ToolResult };
  'agent:iteration': { runId: string; iteration: number; messages: Message[] };
  'agent:complete': { runId: string; result: string };
  'agent:error': { runId: string; error: string };
  'task:start': { graphId: string; taskId: string };
  'task:complete': { graphId: string; result: TaskResult };
  'task:error': { graphId: string; taskId: string; error: string };
  'graph:start': { graphId: string };
  'graph:complete': { graphId: string; results: Map<string, TaskResult> };
  'graph:error': { graphId: string; error: string };
}
