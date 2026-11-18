import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { modelSupportsTemperature } from 'src/common/util/llm-model.util';
import {
  LlmMessage,
  LlmProvider,
  LlmProviderConfig,
  LlmStreamChunk,
  LlmTokenUsage,
} from '../interface/llm-provider.interface';

/** Anthropic's usage block → ours. */
const toTokenUsage = (usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): LlmTokenUsage => ({
  promptTokens: usage.input_tokens ?? 0,
  completionTokens: usage.output_tokens ?? 0,
  cachedTokens: usage.cache_read_input_tokens ?? undefined,
});

/**
 * Claude for the in-process chat (Ask Ally, the debrief chat). The Messages
 * API takes the system prompt apart from the turns, so system messages are
 * joined into it. Temperature is sent only to models that accept one.
 */
@Injectable()
export class AnthropicLlmProvider implements LlmProvider {
  private client: Anthropic | null = null;

  constructor(private readonly configService: AppConfigService) {}

  /** Built on first use, so a deployment without the key still boots. */
  private get anthropic(): Anthropic {
    if (!this.client) {
      const apiKey = this.configService.anthropic.apiKey;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  private request(messages: LlmMessage[], config: LlmProviderConfig) {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const turns = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
    return {
      model: config.model,
      max_tokens: config.maxTokens ?? 1500,
      ...(system ? { system } : {}),
      messages: turns,
      ...(modelSupportsTemperature(config.model)
        ? { temperature: config.temperature ?? 0.7 }
        : {}),
    };
  }

  async *streamCompletion(
    messages: LlmMessage[],
    config: LlmProviderConfig,
  ): AsyncIterable<LlmStreamChunk> {
    const stream = await this.anthropic.messages.create({
      ...this.request(messages, config),
      stream: true,
    });
    let usage: Parameters<typeof toTokenUsage>[0] = {};
    for await (const event of stream) {
      if (event.type === 'message_start') {
        usage = { ...event.message.usage };
      } else if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { content: event.delta.text };
      } else if (event.type === 'message_delta') {
        usage = { ...usage, output_tokens: event.usage.output_tokens };
        yield {
          content: '',
          finishReason: event.delta.stop_reason ?? undefined,
          usage: toTokenUsage(usage),
        };
      }
    }
  }

  async getCompletion(
    messages: LlmMessage[],
    config: LlmProviderConfig,
    onUsage?: (usage: LlmTokenUsage) => void,
  ): Promise<string> {
    const response = await this.anthropic.messages.create(
      this.request(messages, config),
    );
    onUsage?.(toTokenUsage(response.usage));
    return response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');
  }
}
