import { WhatsAppInboundService } from '../whatsapp-inbound.service';
import {
  agentBot,
  ANSWER,
  buildInboundHarness,
  inboundText,
} from './whatsapp-inbound-agent.fixtures';

const AGENT_ANSWER = {
  ...ANSWER,
  turn_type: 'question',
  run_id: 'run-1',
  runtime: 'v2',
  trace: [],
};

/**
 * "Show typing": Meta's typing dots (which also mark the message read) once per accepted message,
 * on unless the bot turns it off, never for a crisis keyword, and never in the reply's way.
 */
describe('WhatsAppInboundService: the typing indicator', () => {
  const build = (
    over: Parameters<typeof buildInboundHarness>[0] extends infer O
      ? Partial<O>
      : never = {},
  ) =>
    buildInboundHarness({
      chatbot: agentBot,
      agentAnswer: AGENT_ANSWER,
      ...over,
    });

  it('shows typing once, with the number’s credentials, before the reply', async () => {
    const { service, provider } = await build();

    await service.handle(inboundText('how do I get access?'));

    expect(provider.showTypingIndicator).toHaveBeenCalledTimes(1);
    expect(provider.showTypingIndicator.mock.calls[0][0]).toBe('wamid.1');
    expect(
      provider.showTypingIndicator.mock.invocationCallOrder[0],
    ).toBeLessThan(provider.sendText.mock.invocationCallOrder[0]);
  });

  it('shows none when the bot has "Show typing" off', async () => {
    const { service, provider } = await build({
      settings: { showTyping: false },
    });

    await service.handle(inboundText('how do I get access?'));

    expect(provider.showTypingIndicator).not.toHaveBeenCalled();
    expect(provider.sendText).toHaveBeenCalledTimes(1);
  });

  it('shows none for a crisis keyword', async () => {
    const isCrisisKeyword = jest.fn().mockResolvedValue(true);
    const { service, provider } = await build({
      replies: { isCrisisKeyword },
    });

    await service.handle(inboundText('I want to die'));

    expect(isCrisisKeyword.mock.calls[0][0]).toBe('I want to die');
    expect(isCrisisKeyword.mock.calls[0][2]).toBe('bot-1');
    expect(provider.showTypingIndicator).not.toHaveBeenCalled();
  });

  it('still shows it when the keyword lookup fails', async () => {
    const { service, provider } = await build({
      replies: {
        isCrisisKeyword: jest.fn().mockRejectedValue(new Error('db')),
      },
    });

    await service.handle(inboundText('how do I get access?'));

    expect(provider.showTypingIndicator).toHaveBeenCalledTimes(1);
  });

  it('never fails or holds up the reply', async () => {
    const { service, provider } = await build({
      replies: { isCrisisKeyword: jest.fn(() => new Promise(() => undefined)) },
    });
    provider.showTypingIndicator.mockRejectedValue(new Error('meta down'));

    await (service as WhatsAppInboundService).handle(
      inboundText('how do I get access?'),
    );

    expect(provider.sendText).toHaveBeenCalledTimes(1);
  });

  it('shows none on STOP', async () => {
    const { service, provider } = await build();

    await service.handle(inboundText('STOP'));

    expect(provider.showTypingIndicator).not.toHaveBeenCalled();
  });
});
