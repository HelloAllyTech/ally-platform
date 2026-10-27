import {
  AgentLlmProviderFactory,
  AgentLlmProviderName,
} from '../agent-llm.factory';
import { Logger } from '@nestjs/common';
import { AnthropicAgentProvider } from '../../provider/anthropic-agent.provider';

describe('AgentLlmProviderFactory', () => {
  const build = (opts: { anthropicKey?: string }) => {
    const configService = {
      anthropic: { apiKey: opts.anthropicKey },
      openai: { apiKey: 'sk-proj-123' },
      gemini: { apiKey: 'gem-123' },
    };

    const factory = new AgentLlmProviderFactory(configService as any);
    return { factory };
  };

  describe('Anthropic key validation', () => {
    it('should create Anthropic provider with a valid key', () => {
      const { factory } = build({ anthropicKey: 'sk-ant-123' });
      const provider = factory.create(
        AgentLlmProviderName.ANTHROPIC,
        'claude-3-haiku-20240307',
      );
      expect(provider).toBeInstanceOf(AnthropicAgentProvider);
    });

    it('should log a warning for a malformed Anthropic key', () => {
      const loggerWarnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation();
      const { factory } = build({ anthropicKey: 'sk-anthropic-123' });

      factory.create(AgentLlmProviderName.ANTHROPIC, 'claude-3-haiku-20240307');

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Malformed Anthropic API key detected. Key should start with "sk-ant-".',
      );
      loggerWarnSpy.mockRestore();
    });

    it('should still create the provider with a malformed key', () => {
      const { factory } = build({ anthropicKey: 'invalid-key' });
      const provider = factory.create(
        AgentLlmProviderName.ANTHROPIC,
        'claude-3-haiku-20240307',
      );
      expect(provider).toBeInstanceOf(AnthropicAgentProvider);
    });
  });
});
