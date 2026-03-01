/**
 * Anthropic Claude provider for AgentKit.
 *
 * Wraps the Anthropic SDK to implement the LLMProvider interface.
 * Supports chat completions with tool calling and streaming.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatChunk,
  ChatRequest,
  ChatResponse,
  LLMProvider,
  Message,
  OpenAIToolSchema,
} from '../types.js';

export interface AnthropicProviderConfig {
  apiKey?: string;
  model?: string;
  /** Default max tokens (default: 4096) */
  maxTokens?: number;
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  readonly model: string;
  private defaultMaxTokens: number;

  constructor(config: AnthropicProviderConfig = {}) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
    this.model = config.model ?? 'claude-3-5-sonnet-20241022';
    this.defaultMaxTokens = config.maxTokens ?? 4096;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    // Separate system message from conversation
    const systemMsg = request.messages.find((m) => m.role === 'system');
    const conversationMessages = request.messages
      .filter((m) => m.role !== 'system')
      .map(toAnthropicMessage);

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: request.max_tokens ?? this.defaultMaxTokens,
      temperature: request.temperature ?? 0.7,
      messages: conversationMessages,
    };

    if (systemMsg) {
      params.system = systemMsg.content;
    }

    if (request.tools?.length) {
      params.tools = request.tools.map(toAnthropicTool);
    }

    const response = await this.client.messages.create(params);

    // Build message from response blocks
    let textContent = '';
    const toolCalls: Message['tool_calls'] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    const message: Message = {
      role: 'assistant',
      content: textContent,
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    const finishReason = response.stop_reason === 'tool_use'
      ? 'tool_calls' as const
      : response.stop_reason === 'max_tokens'
        ? 'length' as const
        : 'stop' as const;

    return {
      message,
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finish_reason: finishReason,
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const systemMsg = request.messages.find((m) => m.role === 'system');
    const conversationMessages = request.messages
      .filter((m) => m.role !== 'system')
      .map(toAnthropicMessage);

    const params: Anthropic.MessageCreateParamsStreaming = {
      model: this.model,
      max_tokens: request.max_tokens ?? this.defaultMaxTokens,
      temperature: request.temperature ?? 0.7,
      messages: conversationMessages,
      stream: true,
    };

    if (systemMsg) {
      params.system = systemMsg.content;
    }

    if (request.tools?.length) {
      params.tools = request.tools.map(toAnthropicTool);
    }

    const stream = this.client.messages.stream(params);

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if ('text' in delta) {
          yield {
            delta: { content: delta.text },
          };
        }
      } else if (event.type === 'message_stop') {
        yield {
          delta: {},
          finish_reason: 'stop',
        };
      }
    }
  }
}

function toAnthropicMessage(
  msg: Message,
): Anthropic.MessageParam {
  if (msg.role === 'tool') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id!,
          content: msg.content,
        },
      ],
    };
  }

  if (msg.role === 'assistant' && msg.tool_calls?.length) {
    const content: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
    if (msg.content) {
      content.push({ type: 'text', text: msg.content });
    }
    for (const tc of msg.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      });
    }
    return { role: 'assistant', content };
  }

  return {
    role: msg.role === 'user' ? 'user' : 'assistant',
    content: msg.content,
  };
}

function toAnthropicTool(
  tool: OpenAIToolSchema,
): Anthropic.Tool {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters as Anthropic.Tool.InputSchema,
  };
}

/** Convenience factory */
export function createAnthropicProvider(
  config?: AnthropicProviderConfig,
): AnthropicProvider {
  return new AnthropicProvider(config);
}
