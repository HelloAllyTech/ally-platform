import type {
  AgentRunResponse,
  AgentStreamEvent,
} from '../../../ai/dto/knowledge.dto';
import {
  WaHandledBy,
  WaTemplateKind,
} from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import type { LiveReply } from '../../engine/chatbot-engine.types';
import {
  ANSWER,
  chatbotFixture,
  engineAiService,
  makeEngine,
} from '../../engine/test/engine.fixtures';
import { publicEvent } from '../bot-page-public.controller';
import { WEB_CHANNEL } from '../bot-page-public.service';

const AGENT_ANSWER = {
  ...ANSWER,
  answer: 'Here is some text the visitor must never see.',
  turn_type: 'question',
  run_id: 'run-1',
  runtime: 'v2',
  trace: [{ node: 'agent', ms: 10, summary: 'agent' }],
} satisfies AgentRunResponse;

/**
 * Crisis handling on the bot page is the engine's, unchanged: the web channel only says it can
 * stream. A crisis keyword gives the fixed reply and nothing streams; a crisis the classifier catches
 * drops the held text, so the visitor sees status codes and then only the crisis reply.
 */
describe('crisis on the web channel', () => {
  const settings = {
    ...DEFAULT_WHATSAPP_SETTINGS,
    agentRuntimeAllowed: true,
    retrieval: { ...DEFAULT_WHATSAPP_SETTINGS.retrieval },
  };
  const LIVE: AgentStreamEvent[] = [
    { event: 'run_started', data: { run_id: 'run-1' } },
    { event: 'status', data: { code: 'thinking', label: 'Thinking' } },
    { event: 'token', data: { text: 'Here is some text' } },
    { event: 'token', data: { text: ' the visitor must never see.' } },
  ];

  function setup(replyMatch: unknown = null) {
    const aiService = {
      ...engineAiService(ANSWER, AGENT_ANSWER),
      runAgentStreaming: jest.fn(
        async (_b: unknown, onEvent: (e: AgentStreamEvent) => void) => {
          for (const event of LIVE) onEvent(event);
          return AGENT_ANSWER;
        },
      ),
    };
    const engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
      replyService: { match: jest.fn().mockResolvedValue(replyMatch) },
    });
    const visible: { event: string; data: unknown }[] = [];
    const live: LiveReply = {
      onEvent: (event) => {
        const shown = publicEvent(event);
        if (shown) visible.push(shown);
      },
    };
    const turn = (text: string) => ({
      chatbot: chatbotFixture(),
      settings,
      text,
      history: [],
      sender: { externalId: 'visitor-1', label: 'bot page visitor abc' },
      channel: WEB_CHANNEL,
      conversationId: 'conv-1',
    });
    return { aiService, engine, visible, live, turn };
  }

  it('a crisis keyword: only the crisis reply, nothing streamed, and the alert raised', async () => {
    const { engine, visible, live, turn, aiService } = setup({
      bypassRag: true,
      template: {
        id: 'crisis',
        kind: WaTemplateKind.CRISIS,
        responseText: 'Please call a crisis line now.',
      },
    });
    const decision = await engine.respond(turn('I want to kill myself'), live);
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(decision.body).toBe('Please call a crisis line now.');
    expect(decision.alert).toBeDefined();
    expect(visible).toEqual([]);
    expect(aiService.runAgentStreaming).not.toHaveBeenCalled();
  });

  it('a crisis the classifier catches: the held text is dropped', async () => {
    const { engine, visible, live, turn, aiService } = setup();
    aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: true,
      confidence: 0.9,
      signal: 'risk',
    });
    const decision = await engine.respond(
      turn('there is no point to anything any more'),
      live,
    );
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(visible.some((e) => e.event === 'token')).toBe(false);
    expect(JSON.stringify(visible)).not.toContain('never see');
  });

  it('no crisis: the checked text reaches the visitor', async () => {
    const { engine, visible, live, turn } = setup();
    await engine.respond(turn('what are your fees?'), live);
    expect(visible.filter((e) => e.event === 'token')).toHaveLength(2);
  });

  it('the reply text has no "Sources:" footer: the page lists the citations itself', async () => {
    const { engine, turn } = setup();
    const onWeb = await engine.respond(turn('what are your fees?'));
    expect(onWeb.body).not.toContain('Sources:');
    expect(onWeb.citations?.length).toBeGreaterThan(0);
    const onWhatsApp = await engine.respond({
      ...turn('what are your fees?'),
      channel: {
        type: 'whatsapp',
        capabilities: { maxReplyChars: 4096, streaming: false },
      },
    });
    expect(onWhatsApp.body).toContain('Sources:');
  });
});
