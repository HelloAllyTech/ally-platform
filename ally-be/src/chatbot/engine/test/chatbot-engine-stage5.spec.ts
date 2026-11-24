import {
  WaHandledBy,
  WaTemplateKind,
  WaUnansweredReason,
} from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { AnswerConflictService } from '../../knowledge/answer-conflict.service';
import type { ChatTurn } from '../chatbot-engine.types';
import { crisisTextFor } from '../chatbot-engine.service';
import { CONFLICT_NOT_SURE_COPY } from '../conflict-reply';
import {
  ANSWER,
  chatbotFixture,
  engineAiService,
  makeEngine,
} from './engine.fixtures';

const CONVERSATION = '6f9c1a52-1111-4a8e-9a0c-1b2c3d4e5f60';

const cite = (n: number, doc: string) => ({
  ...ANSWER.citations[0],
  passage_number: n,
  chunk_id: `chunk-${n}`,
  document_id: doc,
  document_title: `Doc ${doc}`,
});

/** Stage 5 hooks in the engine: conflicts, the no-answer setting, crisis numbers and languages. */
describe('ChatbotEngineService: stage 5 wiring', () => {
  const setup = (
    agentAnswer: unknown,
    opts: {
      chunks?: { id: string; document_id: string; text: string }[];
      settings?: Record<string, unknown>;
      keyword?: Record<string, unknown> | null;
      translations?: unknown;
      language?: string;
    } = {},
  ) => {
    const aiService = engineAiService(agentAnswer, agentAnswer);
    const documents = {
      find: jest.fn().mockResolvedValue([{ documentId: 'doc-a' }]),
      manager: { query: jest.fn().mockResolvedValue(opts.chunks ?? []) },
    };
    const engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
      documents,
      replyService: {
        match: jest
          .fn()
          .mockResolvedValue(
            opts.keyword
              ? { bypassRag: true, terminal: true, template: opts.keyword }
              : null,
          ),
      },
    });
    Object.assign(engine, {
      answerConflict: new AnswerConflictService({} as never),
      safetyTranslations: opts.translations,
    });
    const turn: ChatTurn = {
      chatbot: chatbotFixture({ settings: opts.settings ?? {} } as never),
      settings: {
        ...DEFAULT_WHATSAPP_SETTINGS,
        crisisClassifierEnabled: false,
      },
      text: 'What is your phone number?',
      language: opts.language ?? 'en',
      history: [],
      sender: { externalId: '+919800000001', label: 'contact ending 0001' },
      channel: { type: 'whatsapp' },
      conversationId: CONVERSATION,
      providerMessageId: 'wamid.s5',
    };
    return { engine, turn, documents };
  };

  it('two sources with different phone numbers: "not sure", and a conflict for the owner', async () => {
    const h = setup(
      { ...ANSWER, citations: [cite(1, 'doc-a'), cite(2, 'doc-b')] },
      {
        chunks: [
          {
            id: 'chunk-1',
            document_id: 'doc-a',
            text: 'Call us on 98765 43210.',
          },
          {
            id: 'chunk-2',
            document_id: 'doc-b',
            text: 'Our number is 91234 56789.',
          },
        ],
      },
    );
    const decision = await h.engine.respond(h.turn);
    expect(decision.body).toBe(CONFLICT_NOT_SURE_COPY.en);
    expect(decision.conflict).toMatchObject({
      conflict: true,
      reason: 'phone',
    });
    expect(decision.unanswered?.reason).toBe(WaUnansweredReason.CONFLICT);
  });

  it('two sources that agree keep the answer', async () => {
    const h = setup(
      { ...ANSWER, citations: [cite(1, 'doc-a'), cite(2, 'doc-b')] },
      {
        chunks: [
          {
            id: 'chunk-1',
            document_id: 'doc-a',
            text: 'Call us on 98765 43210.',
          },
          {
            id: 'chunk-2',
            document_id: 'doc-b',
            text: 'Phone: +91 98765 43210',
          },
        ],
      },
    );
    const decision = await h.engine.respond(h.turn);
    expect(decision.handledBy).toBe(WaHandledBy.RAG);
    expect(decision.conflict).toBeUndefined();
  });

  it('nothing found, with a no-answer choice stored: the fixed reply ending with the crisis link', async () => {
    const h = setup(
      {
        ...ANSWER,
        intent: 'decline',
        answer: '',
        citations: [],
        decline_reason: 'no_hits',
      },
      { settings: { noAnswerMode: 'say_unknown' } },
    );
    const decision = await h.engine.respond(h.turn);
    expect(decision.body).toContain("I don't know the answer to that.");
    expect(decision.body).toContain('findahelpline.com');
  });

  it('the locked crisis reply carries the chatbot numbers, then its regional extras', () => {
    const text = crisisTextFor(
      {
        chatbot: chatbotFixture({ id: 'bot-1' }),
        settings: {
          ...DEFAULT_WHATSAPP_SETTINGS,
          helplineNumbers: '+91 11111 11111',
        },
        text: 'help',
      },
      {
        chatbotId: 'bot-1',
        responseText: 'Please call {helpline_numbers}.',
        extraNumbers: ['+91 22222 22222'],
      },
    );
    expect(text).toContain('+91 11111 11111, +91 22222 22222');
  });

  it('a crisis reply in an enabled non-curated language adds the reviewed help line', async () => {
    const crisisHelpFor = jest.fn().mockResolvedValue({
      text: 'TA help {link}',
      language: 'ta',
      reviewed: true,
    });
    const h = setup(ANSWER, {
      settings: { enabledLanguages: ['en', 'ta'] },
      keyword: {
        id: 't-crisis',
        kind: WaTemplateKind.CRISIS,
        responseText: '',
        chatbotId: null,
      },
      translations: { crisisHelpFor },
      language: 'ta',
    });
    const decision = await h.engine.respond({
      ...h.turn,
      text: 'I want to die',
    });
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
    expect(crisisHelpFor).toHaveBeenCalledWith('bot-1', 'ta', null);
    expect(decision.body).toContain('TA help');
  });

  it('isCrisisKeyword: a crisis template, not inside an everyday idiom; a failure counts as crisis', async () => {
    const h = setup(ANSWER, {
      keyword: { id: 't', kind: WaTemplateKind.CRISIS, responseText: '' },
    });
    expect(await h.engine.isCrisisKeyword('I want to die', 'en', 'bot-1')).toBe(
      true,
    );
    const broken = setup(ANSWER);
    Object.assign(broken.engine, {
      replyService: { match: jest.fn().mockRejectedValue(new Error('db')) },
    });
    expect(await broken.engine.isCrisisKeyword('hi', 'en', 'bot-1')).toBe(true);
  });
});
