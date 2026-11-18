import { WaHandledBy } from '../../enum/whatsapp.enum';
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
 * WhatsApp while a team member holds the chat (chunk 11a), through the real engine: nothing is
 * sent, no typing dots, the message is kept for the team; a crisis message still gets the crisis
 * reply at once.
 */
describe('WhatsAppInboundService: a person holding the chat', () => {
  const build = (holder: number | null) =>
    buildInboundHarness({
      chatbot: agentBot,
      agentAnswer: AGENT_ANSWER,
      holder,
    });

  it('sends nothing while a team member holds the chat', async () => {
    const h = await build(7);
    await h.service.handle(inboundText('how much is a session?'));

    expect(h.provider.sendText).not.toHaveBeenCalled();
    expect(h.provider.showTypingIndicator).not.toHaveBeenCalled();
    expect(h.aiService.runAgent).not.toHaveBeenCalled();
    expect(h.aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
    // No reply row; the visitor's message is kept, marked held, and the inbox is told.
    expect(
      h.savedMessages.filter((m) => m.direction === 'outbound'),
    ).toHaveLength(0);
    expect(h.messageUpdates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ handledBy: WaHandledBy.HELD }),
    );
    expect(h.handover.afterDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ held: true }),
    );
  });

  it('still sends the crisis reply at once while held', async () => {
    const h = await build(7);
    h.aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: true,
      confidence: 0.97,
      signal: 'self_harm',
    });
    await h.service.handle(inboundText("I don't want to be here any more"));

    expect(h.provider.sendText).toHaveBeenCalledTimes(1);
    const outbound = h.savedMessages.find((m) => m.direction === 'outbound');
    expect(outbound?.handledBy).toBe(WaHandledBy.CRISIS);
    expect(h.aiService.runAgent).not.toHaveBeenCalled();
  });

  it('answers as before when the assistant has the chat', async () => {
    const h = await build(null);
    await h.service.handle(inboundText('how much is a session?'));
    expect(h.provider.sendText).toHaveBeenCalledTimes(1);
    expect(h.provider.showTypingIndicator).toHaveBeenCalledTimes(1);
  });

  it('a request for a person is answered with the hand-over message', async () => {
    const h = await build(null);
    await h.service.handle(inboundText('can I talk to a person?'));
    expect(h.provider.sendText).toHaveBeenCalledWith(
      expect.any(String),
      "I've asked the team to join. They usually reply within a few hours.",
      expect.anything(),
    );
    expect(h.aiService.runAgent).not.toHaveBeenCalled();
  });
});
