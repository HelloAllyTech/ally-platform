import { WaKeywordTemplate } from '../../../whatsapp/entity/wa-keyword-template.entity';
import {
  WaHandledBy,
  WaTemplateKind,
  WaTemplateMatchType,
  WaUnansweredReason,
} from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import type { WhatsAppBotSettings } from '../../../whatsapp/type/whatsapp-settings.type';
import { Chatbot } from '../../entity/chatbot.entity';
import {
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
  ChatbotRuntime,
  ChatbotStatus,
} from '../../enum/chatbot.enum';
import { ChatbotReplyService } from '../../service/chatbot-reply.service';
import { withFirstMessageParts } from '../first-reply';
import {
  AGENT_PROMPT_CODES,
  ChatbotEngineService,
  KNOWLEDGE_PROMPT_CODES,
} from '../chatbot-engine.service';
import type { ChatTurn } from '../chatbot-engine.types';

const row = (over: Partial<WaKeywordTemplate>): WaKeywordTemplate =>
  ({
    id: 'id',
    kind: WaTemplateKind.FAQ,
    name: 'reply',
    matchType: WaTemplateMatchType.EXACT,
    patterns: ['x'],
    languageCode: null,
    priority: 300,
    responseText: 'text',
    bypassRag: true,
    terminal: false,
    active: true,
    mandatory: false,
    archivedAt: null,
    chatbotId: null,
    overridesTemplateId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  }) as WaKeywordTemplate;

/** The seeded global replies (migration 1892000000008), plus one FAQ reply. */
const TEMPLATES = [
  row({
    id: 'crisis',
    kind: WaTemplateKind.CRISIS,
    matchType: WaTemplateMatchType.ANY_OF,
    patterns: ['suicide', 'kill myself', 'want to die'],
    priority: 10,
    responseText: 'Crisis reply',
    terminal: true,
    mandatory: true,
  }),
  row({
    id: 'opt-out',
    kind: WaTemplateKind.CONSENT,
    patterns: ['stop', 'unsubscribe'],
    priority: 110,
    responseText: 'Opted out',
    terminal: true,
    mandatory: true,
  }),
  row({
    id: 'opt-in',
    kind: WaTemplateKind.CONSENT,
    patterns: ['start', 'resume'],
    priority: 120,
    responseText: 'Opted in',
    mandatory: true,
  }),
  row({
    id: 'greeting',
    kind: WaTemplateKind.COMMAND,
    patterns: ['hi', 'hello', 'hey', 'namaste'],
    priority: 210,
    responseText: 'Hello template',
  }),
  row({
    id: 'help',
    kind: WaTemplateKind.COMMAND,
    patterns: ['help', 'menu', 'what can you do', 'options'],
    priority: 220,
    responseText: 'Help template',
    mandatory: true,
  }),
  row({
    id: 'faq',
    kind: WaTemplateKind.FAQ,
    patterns: ['opening hours'],
    priority: 300,
    responseText: 'FAQ template',
  }),
];

const bot = (over: Partial<Chatbot> = {}): Chatbot =>
  ({
    id: 'bot-1',
    name: 'Ally FAQ',
    status: ChatbotStatus.LIVE,
    accessMode: ChatbotAccessMode.ANYONE,
    answerMode: ChatbotAnswerMode.DOCUMENTS_ONLY,
    knowledgeSource: ChatbotKnowledgeSource.SELECTED,
    persona: { displayName: 'Ally Helper' },
    model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    settings: {},
    runtime: ChatbotRuntime.V2,
    features: { agent: true },
    ...over,
  }) as Chatbot;

const SMALLTALK = {
  intent: 'answer',
  answer: "Hi! I'm Ally Helper. I'm not a crisis service.",
  language: 'en',
  confidence: 0,
  citations: [],
  decline_reason: 'none',
  retrieval: { hit_count: 0, top_similarity: 0, passages_used: 0 },
  provider: 'openai',
  model: 'gpt-5-mini',
  prompt_version: 'v1',
  turn_type: 'smalltalk',
  run_id: 'run-1',
  runtime: 'v2',
  trace: [
    { node: 'contextualize', ms: 400, summary: 'contextualize: smalltalk' },
  ],
};

/**
 * A bot in Agent mode (Agents v2, `features.agent`): which keyword replies give way to the agent,
 * what it sends ally-ai, and how its small talk is recorded.
 */
describe('ChatbotEngineService in Agent mode', () => {
  let engine: ChatbotEngineService;
  let aiService: {
    answerKnowledgeQuestion: jest.Mock;
    answerKnowledgeQuestionWithin: jest.Mock;
    checkWhatsAppCrisis: jest.Mock;
    runAgent: jest.Mock;
  };
  let promptShared: { getPromptsByOptions: jest.Mock };
  let titles: jest.Mock;
  let settings: WhatsAppBotSettings;

  const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({
    chatbot: bot(),
    settings,
    text: 'hello',
    language: 'en',
    history: [],
    isFirstMessage: false,
    sender: { externalId: '919876543210', label: '…3210' },
    channel: { type: 'whatsapp' },
    conversationId: 'conv-1',
    providerMessageId: 'wamid.1',
    ...over,
  });

  beforeEach(() => {
    settings = {
      ...DEFAULT_WHATSAPP_SETTINGS,
      agentRuntimeAllowed: true,
      retrieval: { ...DEFAULT_WHATSAPP_SETTINGS.retrieval },
    };
    aiService = {
      answerKnowledgeQuestion: jest.fn().mockResolvedValue(SMALLTALK),
      answerKnowledgeQuestionWithin: jest.fn().mockResolvedValue(SMALLTALK),
      runAgent: jest.fn().mockResolvedValue(SMALLTALK),
      checkWhatsAppCrisis: jest
        .fn()
        .mockResolvedValue({ is_crisis: false, confidence: 0, signal: '' }),
    };
    const storeRows = [
      {
        promptCode: 'ally_ai_agent_system',
        prompt: 'Agent rules.',
        version: 2,
        provider: 'openai',
        model: 'gpt-5-mini',
      },
    ];
    promptShared = {
      // Like the store: only the rows for the codes asked for.
      getPromptsByOptions: jest.fn(({ promptCode }: { promptCode: string[] }) =>
        Promise.resolve(
          storeRows.filter((r) => promptCode.includes(r.promptCode)),
        ),
      ),
    };
    titles = jest
      .fn()
      .mockResolvedValue([
        { title: 'Ally FAQ – About Ally' },
        { title: 'Ally FAQ – Privacy and Data' },
      ]);
    engine = new ChatbotEngineService(
      {
        find: jest.fn().mockResolvedValue([{ documentId: 'doc-1' }]),
        manager: { query: titles },
      } as never,
      new ChatbotReplyService({
        find: jest.fn().mockResolvedValue(TEMPLATES),
      } as never),
      { renderPlaceholders: (text: string) => text } as never,
      { canChat: jest.fn().mockResolvedValue(true) } as never,
      aiService as never,
      promptShared as never,
    );
  });

  describe('keyword replies', () => {
    it.each([
      ['hello', 'greeting'],
      ['what can you do', 'help'],
      ['menu', 'help'],
      ['opening hours', 'faq'],
    ])('lets the agent answer "%s" (%s reply)', async (text) => {
      const decision = await engine.respond(turn({ text }));
      expect(aiService.runAgent).toHaveBeenCalledTimes(1);
      expect(decision.handledBy).toBe(WaHandledBy.RAG);
      expect(decision.templateId).toBeUndefined();
    });

    it('keeps a bare "help" on the fixed Help text', async () => {
      const decision = await engine.respond(turn({ text: 'Help!' }));
      expect(decision.body).toBe('Help template');
      expect(decision.templateId).toBe('help');
      expect(aiService.runAgent).not.toHaveBeenCalled();
    });

    it.each([
      ['I want to die', 'crisis', WaHandledBy.CRISIS],
      ['stop', 'opt-out', WaHandledBy.TEMPLATE],
      ['start', 'opt-in', WaHandledBy.TEMPLATE],
    ])('still matches "%s" (%s) first', async (text, templateId, handledBy) => {
      const decision = await engine.respond(turn({ text }));
      expect(decision.templateId).toBe(templateId);
      expect(decision.handledBy).toBe(handledBy);
      expect(aiService.runAgent).not.toHaveBeenCalled();
    });

    it('keeps the welcome message on a first message only', async () => {
      const chatbot = bot({
        persona: { displayName: 'Ally Helper', greeting: 'Welcome to Ally!' },
      });
      const first = await engine.respond(
        turn({ chatbot, isFirstMessage: true }),
      );
      expect(first.body).toBe('Welcome to Ally!');
      expect(first.isWelcome).toBe(true);
      expect(aiService.runAgent).not.toHaveBeenCalled();

      const later = await engine.respond(turn({ chatbot }));
      expect(later.body).not.toBe('Welcome to Ally!');
      expect(aiService.runAgent).toHaveBeenCalledTimes(1);
    });

    it('lets the agent answer a first hello when the bot has no welcome', async () => {
      await engine.respond(turn({ isFirstMessage: true }));
      expect(aiService.runAgent).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a v1 bot', { runtime: ChatbotRuntime.V1 }, {}],
      ['a v2 bot with the flag off', { features: { agent: false } }, {}],
      ['a v2 bot with no features', { features: {} }, {}],
      ['an agent bot on shadow', { runtime: ChatbotRuntime.SHADOW }, {}],
      [
        'an agent bot under the kill switch',
        {},
        { agentRuntimeAllowed: false },
      ],
    ])('gives %s every template', async (_label, botOver, settingsOver) => {
      settings = { ...settings, ...settingsOver };
      for (const [text, id] of [
        ['hello', 'greeting'],
        ['what can you do', 'help'],
        ['opening hours', 'faq'],
      ]) {
        const decision = await engine.respond(
          turn({ chatbot: bot(botOver), settings, text }),
        );
        expect(decision.templateId).toBe(id);
      }
      expect(aiService.runAgent).not.toHaveBeenCalled();
    });

    it('lets Preview force v2 for an agent bot that is saved on v1', async () => {
      await engine.respond(
        turn({
          chatbot: bot({ runtime: ChatbotRuntime.V1 }),
          runtime: ChatbotRuntime.V2,
          channel: { type: 'test' },
        }),
      );
      expect(aiService.runAgent).toHaveBeenCalledTimes(1);
    });
  });

  describe('the request', () => {
    it('sends features, the document titles and the decline wording', async () => {
      await engine.respond(turn({ text: 'who are you?' }));
      const body = aiService.runAgent.mock.calls[0][0];
      expect(body.features).toEqual({ agent: true });
      expect(body.knowledge_topics).toEqual([
        'Ally FAQ – About Ally',
        'Ally FAQ – Privacy and Data',
      ]);
      expect(body.decline_text).toBe(DEFAULT_WHATSAPP_SETTINGS.declineText);
      expect(titles.mock.calls[0][1]).toEqual([['doc-1']]);
    });

    it("uses Preview's unsaved document selection for the titles", async () => {
      await engine.respond(turn({ documentIds: ['doc-9', 'doc-8'] }));
      expect(titles.mock.calls[0][1]).toEqual([['doc-9', 'doc-8']]);
    });

    it('sends no titles for a bot answering from its organisation', async () => {
      await engine.respond(
        turn({
          chatbot: bot({
            knowledgeSource: ChatbotKnowledgeSource.ORGANISATION,
          }),
          sender: { externalId: 'x', label: 'x', tenantId: 'tenant-1' },
        }),
      );
      expect(titles).not.toHaveBeenCalled();
      expect(aiService.runAgent.mock.calls[0][0].knowledge_topics).toEqual([]);
    });

    it('still answers when the titles cannot be loaded', async () => {
      titles.mockRejectedValue(new Error('db down'));
      const decision = await engine.respond(turn({ text: 'who are you?' }));
      expect(aiService.runAgent.mock.calls[0][0].knowledge_topics).toEqual([]);
      expect(decision.handledBy).toBe(WaHandledBy.RAG);
    });

    it("loads the agent prompts and gives the bot's model to the agent step", async () => {
      await engine.respond(turn({ text: 'who are you?' }));
      expect(promptShared.getPromptsByOptions).toHaveBeenCalledWith({
        promptCode: [...KNOWLEDGE_PROMPT_CODES, ...AGENT_PROMPT_CODES],
      });
      const prompts = aiService.runAgent.mock.calls[0][0].prompts;
      expect(prompts.ally_ai_agent_system).toMatchObject({
        prompt: 'Agent rules.',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      });
      // The contextualise call keeps the platform's (cheap) model.
      expect(prompts.ally_ai_agent_contextualize).toBeUndefined();
    });

    it('sends none of it for a v2 bot with the flag off', async () => {
      await engine.respond(
        turn({
          chatbot: bot({ features: { agent: false } }),
          text: 'who are you?',
        }),
      );
      const body = aiService.runAgent.mock.calls[0][0];
      expect(body).not.toHaveProperty('features');
      expect(body).not.toHaveProperty('knowledge_topics');
      expect(body).not.toHaveProperty('decline_text');
      expect(body.prompts).not.toHaveProperty('ally_ai_agent_system');
      expect(promptShared.getPromptsByOptions).toHaveBeenCalledWith({
        promptCode: KNOWLEDGE_PROMPT_CODES,
      });
    });
  });

  describe('small talk', () => {
    it('is a RAG reply that is not filed as unanswered', async () => {
      const decision = await engine.respond(turn({ text: 'thanks!' }));
      expect(decision.handledBy).toBe(WaHandledBy.RAG);
      expect(decision.unanswered).toBeUndefined();
      expect(decision.body).toBe(SMALLTALK.answer);
      expect(decision.retrievalMeta?.turn_type).toBe('smalltalk');
    });

    it.each(['smalltalk', 'about_bot'])(
      'a %s reply counts as a greeting, so the first-message notice follows it',
      async (turnType) => {
        aiService.runAgent.mockResolvedValue({
          ...SMALLTALK,
          turn_type: turnType,
        });
        const decision = await engine.respond(turn({ text: 'who are you?' }));
        expect(decision.isWelcome).toBe(true);
        expect(
          withFirstMessageParts({
            body: decision.body,
            handledBy: decision.handledBy,
            bodyIsWelcome: decision.isWelcome,
            notice: 'Not medical advice. Reply STOP to opt out.',
          }),
        ).toBe(
          `${SMALLTALK.answer}\n\nNot medical advice. Reply STOP to opt out.`,
        );
      },
    );

    it('a question answered by the agent gets no notice, as in v1', async () => {
      aiService.runAgent.mockResolvedValue({
        ...SMALLTALK,
        answer: 'Ask your admin for an invite.',
        citations: [
          {
            passage_number: 1,
            chunk_id: 'c1',
            document_id: 'd1',
            document_title: 'Ally FAQ – Getting Access',
            similarity: 0.7,
          },
        ],
        turn_type: 'question',
      });
      const decision = await engine.respond(
        turn({ text: 'how do I get access?' }),
      );
      expect(decision.isWelcome).toBeUndefined();
    });

    it('a decline by the agent is filed with its reason', async () => {
      aiService.runAgent.mockResolvedValue({
        ...SMALLTALK,
        intent: 'decline',
        answer: '',
        decline_reason: 'below_threshold',
        turn_type: 'question',
      });
      const decision = await engine.respond(turn({ text: 'refund policy?' }));
      expect(decision.handledBy).toBe(WaHandledBy.DECLINED);
      expect(decision.body).toBe(DEFAULT_WHATSAPP_SETTINGS.declineText);
      expect(decision.unanswered?.reason).toBe(
        WaUnansweredReason.BELOW_THRESHOLD,
      );
    });

    it('is overridden by a crisis verdict', async () => {
      aiService.checkWhatsAppCrisis.mockResolvedValue({
        is_crisis: true,
        confidence: 0.4,
        signal: "can't go on",
      });
      const decision = await engine.respond(
        turn({ text: "hi, I can't go on" }),
      );
      expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
      expect(decision.body).toBe(
        DEFAULT_WHATSAPP_SETTINGS.crisisEscalationText,
      );
      expect(decision.isWelcome).toBeUndefined();
      expect(decision.agent?.runId).toBe('run-1');
    });
  });
});
