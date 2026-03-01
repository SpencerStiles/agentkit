/**
 * OpenAI LLM provider for AgentKit.
 *
 * Wraps the OpenAI SDK to implement the LLMProvider interface.
 * Supports chat completions with tool calling and streaming.
 */

import OpenAI from 'openai';
import type {
  ChatChunk,
  ChatRequest,
  ChatResponse,
  LLMProvider,
  Message,
} from '../types.js';

export interface OpenAIProviderConfig {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  organization?: string;
  /** Default max tokens (default: 4096) */
  maxTokens?: number;
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  readonly model: string;
  private defaultMaxTokens: number;

  constructor(config: OpenAIProviderConfig = {}) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      organization: config.organization,
    });
    this.model = config.model ?? 'gpt-4o';
    this.defaultMaxTokens = config.maxTokens ?? 4096;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: request.messages.map(toOpenAIMessage),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens ?? this.defaultMaxTokens,
    };

    if (request.tools?.length) {
      params.tools = request.tools as any;
    }
    if (request.tool_choice) {
      params.tool_choice = request.tool_choice as any;
    }
    if (request.response_format) {
      params.response_format = request.response_format as any;
    }
    if (request.stop) {
      params.stop = request.stop;
    }

    const response = await this.client.chat.completions.create(params);
    const choice = response.choices[0];

    const message: Message = {
      role: 'assistant',
      content: choice.message.content ?? '',
    };

    if (choice.message.tool_calls?.length) {
      message.tool_calls = choice.message.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }

    return {
      message,
      usage: {
        prompt_tokens: response.usage?.prompt_tokens ?? 0,
        completion_tokens: response.usage?.completion_tokens ?? 0,
        total_tokens: response.usage?.total_tokens ?? 0,
      },
      finish_reason: mapFinishReason(choice.finish_reason),
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const params: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: this.model,
      messages: request.messages.map(toOpenAIMessage),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens ?? this.defaultMaxTokens,
      stream: true,
    };

    if (request.tools?.length) {
      params.tools = request.tools as any;
    }

    const stream = await this.client.chat.completions.create(params);

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      yield {
        delta: {
          role: delta.role as Message['role'],
          content: delta.content ?? undefined,
          tool_calls: delta.tool_calls?.map((tc) => ({
            id: tc.id ?? '',
            type: 'function' as const,
            function: {
              name: tc.function?.name ?? '',
              arguments: tc.function?.arguments ?? '',
            },
          })),
        },
        finish_reason: chunk.choices[0]?.finish_reason ?? undefined,
      };
    }
  }
}

function toOpenAIMessage(
  msg: Message,
): OpenAI.Chat.ChatCompletionMessageParam {
  if (msg.role === 'tool') {
    return {
      role: 'tool',
      content: msg.content,
      tool_call_id: msg.tool_call_id!,
    };
  }
  if (msg.role === 'assistant' && msg.tool_calls?.length) {
    return {
      role: 'assistant',
      content: msg.content || null,
      tool_calls: msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
    };
  }
  return {
    role: msg.role as 'system' | 'user' | 'assistant',
    content: msg.content,
  };
}

function mapFinishReason(
  reason: string | null,
): ChatResponse['finish_reason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'stop';
  }
}

/** Convenience factory */
export function createOpenAIProvider(
  config?: OpenAIProviderConfig,
): OpenAIProvider {
  return new OpenAIProvider(config);
}
