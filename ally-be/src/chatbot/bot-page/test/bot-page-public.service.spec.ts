import { HttpException } from '@nestjs/common';
import { ErrorCode } from '../../../exception/error-code.enum';
import {
  WaHandledBy,
  WaUnansweredReason,
} from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import {
  BotPageAccess,
  BotPageStatus,
  PrechatFieldType,
} from '../../enum/bot-page.enum';
import {
  AgentRuntimeUsed,
  ChatbotAccessMode,
  ChatbotStatus,
} from '../../enum/chatbot.enum';
import { ConversationChannel } from '../../enum/conversation.enum';
import { AGENT_FALLBACK_EVENT } from '../../type/agent-runtime.event';
import { defaultBotPageSettings } from '../../type/bot-page.type';
import { BotPageRateLimitService } from '../bot-page-rate-limit.service';
import {
  BotPagePublicService,
  WEB_CHANNEL,
  publicCitations,
} from '../bot-page-public.service';
import type { BotPageVisitor } from '../bot-page-visitor.service';
import { FakeRedis } from './fake-redis';

const BOT_ID = 'bot-1';
const chatbot = {
  id: BOT_ID,
  name: 'Sunrise Mind',
  status: ChatbotStatus.LIVE,
  accessMode: ChatbotAccessMode.LISTED,
  persona: {},
  settings: {},
};

function availableFor(access: BotPageAccess, prechat = false) {
  const settings = defaultBotPageSettings({
    name: 'Sunrise Mind',
    crisisSafetyOn: true,
  });
  if (prechat) {
    settings.prechat = [
      {
        id: 'name',
        label: 'Your name',
        type: PrechatFieldType.TEXT,
        required: true,
      },
    ];
  }
  return {
    page: {
      id: 'page-1',
      chatbotId: BOT_ID,
      slug: 'sunrise',
      status: BotPageStatus.ON,
      access,
      settings,
    },
    chatbot,
    settings,
    botSettings: {
      ...DEFAULT_WHATSAPP_SETTINGS,
      enabled: true,
      conversationIdleMinutes: 60,
    },
  };
}

const DECISION = {
  handledBy: WaHandledBy.RAG,
  body: 'Sessions cost 1500.',
  citations: [
    {
      document_title: 'Fees',
      source_url: 'https://sunrise.example/fees',
      chunk_id: 'c1',
      document_id: 'd1',
      similarity: 0.9,
    },
    {
      document_title: 'Fees',
      source_url: 'https://sunrise.example/fees',
      chunk_id: 'c2',
      document_id: 'd1',
      similarity: 0.8,
    },
  ],
  retrievalMeta: { prompt_version: 3 },
  language: 'en',
  agent: {
    runtime: AgentRuntimeUsed.V2,
    runId: 'run-1',
    conversationId: 'conv-1',
    trace: [],
  },
};

function harness(
  access = BotPageAccess.INVITE,
  opts: { prechat?: boolean } = {},
) {
  const available = availableFor(access, opts.prechat);
  const redis = new FakeRedis();
  const emit = jest.fn();
  let visitor: BotPageVisitor | null = null;
  const issued: BotPageVisitor[] = [];
  const visitors = {
    read: jest.fn(async () => visitor),
    newVisitor: jest.fn(() => ({
      id: 'visitor-1',
      chatbotId: BOT_ID,
      verifiedAt: null,
      issuedAt: new Date(),
    })),
    issue: jest.fn(async (_res: unknown, v: BotPageVisitor) => {
      issued.push(v);
      return { ...v, token: 'signed-token' };
    }),
    rotateIfDue: jest.fn(),
  };
  const pageAccess = {
    eligibility: jest.fn().mockResolvedValue({ eligible: false }),
  };
  const otp = {
    send: jest.fn().mockResolvedValue('sent'),
    check: jest.fn().mockResolvedValue('ok'),
  };
  const turnstile = {
    verify: jest.fn().mockResolvedValue(true),
    siteKey: null,
  };
  const conversation = {
    id: 'conv-1',
    metadata: {} as Record<string, unknown>,
  };
  const stored: Record<string, unknown>[] = [];
  const conversations = {
    resolveContact: jest.fn().mockResolvedValue({ id: 'contact-1' }),
    contactByIdentity: jest.fn().mockResolvedValue({ id: 'contact-1' }),
    identityOf: jest
      .fn()
      .mockResolvedValue({ externalId: 'asha@example.com', verified: true }),
    resolveVerifiedContact: jest.fn().mockResolvedValue({ id: 'contact-1' }),
    openConversation: jest.fn().mockResolvedValue(conversation),
    currentConversation: jest.fn().mockResolvedValue(conversation),
    closeConversation: jest.fn(),
    recentMessages: jest.fn().mockResolvedValue([]),
    latestMetadata: jest.fn().mockResolvedValue(null),
    setMetadata: jest.fn(),
    appendMessage: jest.fn(
      async (_c: string, message: Record<string, unknown>) => {
        const row = { ...message, id: `msg-${stored.length + 1}` };
        stored.push(row);
        return row;
      },
    ),
    updateMessage: jest.fn(),
    recentHistory: jest
      .fn()
      .mockResolvedValue([{ role: 'user', content: 'how much?' }]),
  };
  const engine = { respond: jest.fn().mockResolvedValue(DECISION) };
  const leads = { afterTurn: jest.fn().mockResolvedValue(false) };
  // The inbox (chunk 11a): decisions pass through unchanged unless a test says otherwise.
  const handover = {
    afterDecision: jest.fn(async (_c: unknown, _id: string, d: unknown) => d),
    markNeedsPerson: jest.fn(),
  };
  const inboxEvents = { listenVisitor: jest.fn(async () => () => undefined) };
  const unansweredValues = jest.fn().mockReturnThis();
  /** Raw queries the feedback route runs (chunk Q2a): the message lookup, then the upsert. */
  const db = { query: jest.fn() };
  const unanswered = {
    manager: db,
    createQueryBuilder: () => ({
      insert: () => ({
        into: () => ({
          values: unansweredValues,
          orIgnore: () => ({ execute: jest.fn() }),
        }),
      }),
    }),
  };
  unansweredValues.mockReturnValue({
    orIgnore: () => ({ execute: jest.fn() }),
  });
  const service = new BotPagePublicService(
    {
      findAvailable: jest.fn().mockResolvedValue(available),
      link: (slug: string) => `https://chat.ally.test/b/${slug}`,
    } as never,
    pageAccess as never,
    visitors as never,
    otp as never,
    new BotPageRateLimitService(redis as never, { emit } as never),
    turnstile as never,
    conversations as never,
    engine as never,
    { emit } as never,
    {
      jwt: { accessToken: { secret: 's' } },
      botPage: { origin: 'https://chat.ally.test' },
      nodeEnv: 'production',
    } as never,
    leads as never,
    handover as never,
    inboxEvents as never,
    unanswered as never,
  );
  const req = { ip: '203.0.113.9', headers: {} } as never;
  const res = {} as never;
  return {
    available,
    service,
    visitors,
    pageAccess,
    otp,
    turnstile,
    conversations,
    conversation,
    engine,
    emit,
    stored,
    unansweredValues,
    db,
    handover,
    issued,
    req,
    res,
    setVisitor: (v: Partial<BotPageVisitor> | null) => {
      visitor = v
        ? {
            id: 'visitor-1',
            chatbotId: BOT_ID,
            verifiedAt: null,
            issuedAt: new Date(),
            ...v,
          }
        : null;
    },
  };
}

async function errorCodeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return ((error as HttpException).getResponse() as { errorCode: string })
      .errorCode;
  }
  throw new Error('expected a refusal');
}

describe('BotPagePublicService', () => {
  describe('view (what the browser learns)', () => {
    it('shows branding and questions, nothing internal', () => {
      const { service, available } = harness();
      const view = service.view(available as never);
      expect(Object.keys(view).sort()).toEqual(
        [
          'access',
          'branding',
          'language',
          'maxMessageChars',
          'prechat',
          'slug',
          'suggestedQuestions',
          'turnstileSiteKey',
        ].sort(),
      );
      expect(JSON.stringify(view)).not.toMatch(
        /bot-1|page-1|systemPrompt|retrieval/,
      );
    });
  });

  describe('session', () => {
    it('public: checks the bot check, then lets the visitor in', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      expect(
        await h.service.session('sunrise', {}, h.req, h.res),
      ).toMatchObject({ state: 'ready', intakeDone: true });
      expect(h.turnstile.verify).toHaveBeenCalled();
      expect(h.issued).toHaveLength(1);
    });

    it('public: refuses a failed bot check', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.turnstile.verify.mockResolvedValue(false);
      expect(
        await errorCodeOf(h.service.session('sunrise', {}, h.req, h.res)),
      ).toBe(ErrorCode.BOT_PAGE_BOT_CHECK_FAILED);
    });

    it('invite: asks for an email first', async () => {
      const h = harness();
      expect(await h.service.session('sunrise', {}, h.req, h.res)).toEqual({
        state: 'needs_email',
        intakeDone: false,
        signedInAs: null,
      });
    });

    it('invite: answers the same for an invited and an uninvited email, and only emails the invited one', async () => {
      const h = harness();
      const stranger = await h.service.session(
        'sunrise',
        { email: 'who@example.com' },
        h.req,
        h.res,
      );
      h.pageAccess.eligibility.mockResolvedValue({ eligible: true });
      const invited = await h.service.session(
        'sunrise',
        { email: 'asha@example.com' },
        h.req,
        h.res,
      );
      expect(stranger).toEqual(invited);
      expect(h.otp.send).toHaveBeenCalledTimes(1);
      expect(h.otp.send.mock.calls[0][1]).toBe('asha@example.com');
    });

    it('invite: a visitor verified recently, and still invited, goes straight in', async () => {
      const h = harness();
      h.setVisitor({ verifiedAt: new Date() });
      h.pageAccess.eligibility.mockResolvedValue({ eligible: true });
      expect(
        await h.service.session('sunrise', {}, h.req, h.res),
      ).toMatchObject({
        state: 'ready',
        signedInAs: 'a***@example.com',
      });
    });

    it('limits session starts per IP', async () => {
      const h = harness();
      for (let i = 0; i < 20; i++)
        await h.service.session('sunrise', {}, h.req, h.res);
      expect(
        await errorCodeOf(h.service.session('sunrise', {}, h.req, h.res)),
      ).toBe(ErrorCode.BOT_PAGE_THROTTLED);
    });
  });

  describe('verify', () => {
    it.each([
      ['wrong', ErrorCode.BOT_PAGE_CODE_WRONG],
      ['expired', ErrorCode.BOT_PAGE_CODE_EXPIRED],
      ['too_many', ErrorCode.BOT_PAGE_CODE_TOO_MANY],
    ])('maps a %s code', async (result, code) => {
      const h = harness();
      h.setVisitor({});
      h.otp.check.mockResolvedValue(result);
      expect(
        await errorCodeOf(
          h.service.verify(
            'sunrise',
            { email: 'asha@example.com', code: '123456' },
            h.req,
            h.res,
          ),
        ),
      ).toBe(code);
    });

    it('a right code links the email to the visitor and marks them verified', async () => {
      const h = harness();
      h.setVisitor({});
      h.pageAccess.eligibility.mockResolvedValue({ eligible: true });
      const session = await h.service.verify(
        'sunrise',
        { email: 'Asha@Example.com', code: '123456' },
        h.req,
        h.res,
      );
      expect(session.state).toBe('ready');
      expect(h.conversations.resolveVerifiedContact).toHaveBeenCalledWith(
        { chatbotId: BOT_ID },
        { channel: ConversationChannel.EMAIL, externalId: 'asha@example.com' },
        { channel: ConversationChannel.WEB, externalId: 'visitor-1' },
        expect.any(Date),
      );
      expect(h.issued[h.issued.length - 1]?.verifiedAt).toBeInstanceOf(Date);
    });

    it('needs a session first', async () => {
      const h = harness();
      expect(
        await errorCodeOf(
          h.service.verify(
            'sunrise',
            { email: 'a@b.co', code: '123456' },
            h.req,
            h.res,
          ),
        ),
      ).toBe(ErrorCode.BOT_PAGE_START_AGAIN);
    });
  });

  describe('admit (refusals before anything is stored)', () => {
    it('refuses a visitor whose email was taken off the list since', async () => {
      const h = harness();
      h.setVisitor({ verifiedAt: new Date() });
      h.pageAccess.eligibility.mockResolvedValue({ eligible: false });
      expect(
        await errorCodeOf(h.service.admit('sunrise', 'hi', h.req, h.res)),
      ).toBe(ErrorCode.BOT_PAGE_NOT_ALLOWED);
    });

    it('refuses an unverified visitor on an invite page', async () => {
      const h = harness();
      h.setVisitor({});
      expect(
        await errorCodeOf(h.service.admit('sunrise', 'hi', h.req, h.res)),
      ).toBe(ErrorCode.BOT_PAGE_START_AGAIN);
    });

    it('refuses an empty or too-long message', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.setVisitor({});
      expect(
        await errorCodeOf(h.service.admit('sunrise', '   ', h.req, h.res)),
      ).toBe(ErrorCode.BOT_PAGE_MESSAGE_TOO_LONG);
      expect(
        await errorCodeOf(
          h.service.admit('sunrise', 'x'.repeat(1001), h.req, h.res),
        ),
      ).toBe(ErrorCode.BOT_PAGE_MESSAGE_TOO_LONG);
    });

    it('limits messages per visitor per hour', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.available.settings.limits.messagesPerVisitorPerHour = 2;
      h.setVisitor({});
      await h.service.admit('sunrise', 'one', h.req, h.res);
      await h.service.admit('sunrise', 'two', h.req, h.res);
      expect(
        await errorCodeOf(h.service.admit('sunrise', 'three', h.req, h.res)),
      ).toBe(ErrorCode.BOT_PAGE_THROTTLED);
    });

    it('says busy once the bot’s daily cap is used, and alerts once', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.available.settings.limits.dailyCapPerBot = 1;
      h.setVisitor({});
      await h.service.admit('sunrise', 'one', h.req, h.res);
      expect(
        await errorCodeOf(h.service.admit('sunrise', 'two', h.req, h.res)),
      ).toBe(ErrorCode.BOT_PAGE_BUSY_UNAVAILABLE);
      expect(
        await errorCodeOf(h.service.admit('sunrise', 'three', h.req, h.res)),
      ).toBe(ErrorCode.BOT_PAGE_BUSY_UNAVAILABLE);
      expect(
        h.emit.mock.calls.filter(([name]) => name === 'exception'),
      ).toHaveLength(1);
    });

    it('asks for the pre-chat answers before the first message', async () => {
      const h = harness(BotPageAccess.PUBLIC, { prechat: true });
      h.setVisitor({});
      expect(
        await errorCodeOf(h.service.admit('sunrise', 'hi', h.req, h.res)),
      ).toBe(ErrorCode.BOT_PAGE_INTAKE_REQUIRED);
      h.conversation.metadata = { intake: { answers: [] } };
      await expect(
        h.service.admit('sunrise', 'hi', h.req, h.res),
      ).resolves.toMatchObject({ text: 'hi' });
    });
  });

  describe('respond', () => {
    async function answer(h: ReturnType<typeof harness>, live?: never) {
      h.setVisitor({});
      const admitted = await h.service.admit(
        'sunrise',
        ' how much? ',
        h.req,
        h.res,
      );
      return h.service.respond(admitted, live);
    }

    it('stores no reply while a team member holds the chat (chunk 11a)', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.engine.respond.mockResolvedValueOnce({
        handledBy: WaHandledBy.HELD,
        body: '',
        held: true,
      });
      const final = await answer(h);
      // Only the visitor's message: no assistant reply is stored or returned.
      expect(h.stored).toHaveLength(1);
      expect(h.stored[0]).toMatchObject({ direction: 'inbound', role: 'user' });
      expect(final).toMatchObject({ reply: '', held: true, rateable: false });
      expect(h.conversations.updateMessage).toHaveBeenCalledWith(
        h.stored[0].id,
        expect.objectContaining({ handledBy: WaHandledBy.HELD }),
      );
      expect(h.handover.afterDecision).toHaveBeenCalled();
    });

    it('still sends the crisis reply while a team member holds the chat (chunk 11a)', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.engine.respond.mockResolvedValueOnce({
        handledBy: WaHandledBy.CRISIS,
        body: 'Please call 14416 now.',
      });
      const final = await answer(h);
      expect(h.stored[1]).toMatchObject({
        direction: 'outbound',
        handledBy: WaHandledBy.CRISIS,
        text: 'Please call 14416 now.',
      });
      expect(final.reply).toBe('Please call 14416 now.');
      expect(final.held).toBeUndefined();
    });

    it('stores the message and the reply on the web channel, with the run behind it', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      const final = await answer(h);
      expect(h.stored).toHaveLength(2);
      expect(h.stored[0]).toMatchObject({
        channel: 'web',
        direction: 'inbound',
        role: 'user',
        text: 'how much?',
      });
      expect(h.stored[1]).toMatchObject({
        channel: 'web',
        direction: 'outbound',
        role: 'assistant',
        text: DECISION.body,
        handledBy: WaHandledBy.RAG,
        agentRunId: 'run-1',
        agentRuntime: AgentRuntimeUsed.V2,
        citations: DECISION.citations,
        retrievalMeta: DECISION.retrievalMeta,
        inReplyToId: 'msg-1',
      });
      expect(final).toEqual({
        reply: DECISION.body,
        citations: [{ title: 'Fees', url: 'https://sunrise.example/fees' }],
        messageId: 'msg-2',
        conversationId: 'conv-1',
        rateable: true,
      });
    });

    it('runs the engine on the web channel, past the bot’s own WhatsApp access list', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      await answer(h);
      const [turn] = h.engine.respond.mock.calls[0];
      expect(turn.channel).toEqual(WEB_CHANNEL);
      expect(turn.chatbot.accessMode).toBe(ChatbotAccessMode.ANYONE);
      expect(turn.conversationId).toBe('conv-1');
      expect(turn.providerMessageId).toBe('msg-1');
      expect(turn.sender.label).not.toContain('visitor-1');
      // The bot itself is untouched: WhatsApp still reads its own accessMode.
      expect(chatbot.accessMode).toBe(ChatbotAccessMode.LISTED);
    });

    it('returns the same final with or without streaming', async () => {
      const a = harness(BotPageAccess.PUBLIC);
      const b = harness(BotPageAccess.PUBLIC);
      const streamed = await answer(a, { onEvent: jest.fn() } as never);
      const waited = await answer(b);
      expect(streamed).toEqual(waited);
    });

    it('files an unanswered question with the shared store’s ids', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.engine.respond.mockResolvedValue({
        ...DECISION,
        handledBy: WaHandledBy.DECLINED,
        unanswered: {
          reason: WaUnansweredReason.BELOW_THRESHOLD,
          topSimilarity: 0.31234,
          hitCount: 2,
        },
      });
      await answer(h);
      expect(h.unansweredValues).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-1',
          conversationId: 'conv-1',
          questionText: 'how much?',
          reason: WaUnansweredReason.BELOW_THRESHOLD,
          topSimilarity: '0.3123',
          hitCount: 2,
        }),
      );
    });

    it('raises the decision’s alert and the fallback event', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      const alert = { type: 'Chatbot Crisis Keyword' };
      h.engine.respond.mockResolvedValue({
        ...DECISION,
        alert,
        agent: {
          runtime: AgentRuntimeUsed.V2_FALLBACK,
          runId: 'r',
          conversationId: 'c',
          fallbackReason: 'timeout',
        },
      });
      await answer(h);
      expect(h.emit).toHaveBeenCalledWith('exception', alert);
      expect(h.emit).toHaveBeenCalledWith(AGENT_FALLBACK_EVENT, {
        chatbot: { id: BOT_ID, name: 'Sunrise Mind' },
        reason: 'timeout',
      });
    });

    it('marks the message failed when the engine throws', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.engine.respond.mockRejectedValue(new Error('boom'));
      await expect(answer(h)).rejects.toThrow('boom');
      expect(h.conversations.updateMessage).toHaveBeenCalledWith(
        'msg-1',
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('carries the pre-chat answers to a new thread', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      const intake = { answers: [{ id: 'name', value: 'Asha' }] };
      h.conversations.latestMetadata.mockResolvedValue(intake);
      await answer(h);
      expect(h.conversations.setMetadata).toHaveBeenCalledWith('conv-1', {
        intake,
      });
    });
  });

  describe('intake, resume, new chat', () => {
    it('stores validated answers on the open thread', async () => {
      const h = harness(BotPageAccess.PUBLIC, { prechat: true });
      h.setVisitor({});
      await h.service.intake(
        'sunrise',
        { answers: [{ id: 'name', value: 'Asha' }] },
        h.req,
      );
      expect(h.conversations.setMetadata).toHaveBeenCalledWith('conv-1', {
        intake: expect.objectContaining({
          answers: [expect.objectContaining({ id: 'name', value: 'Asha' })],
        }),
      });
    });

    it('names the refused question', async () => {
      const h = harness(BotPageAccess.PUBLIC, { prechat: true });
      h.setVisitor({});
      try {
        await h.service.intake('sunrise', { answers: [] }, h.req);
        throw new Error('expected a refusal');
      } catch (error) {
        expect((error as HttpException).getResponse()).toMatchObject({
          errorCode: ErrorCode.BOT_PAGE_INTAKE_INVALID,
          details: { field: 'name' },
        });
      }
    });

    it('resumes the open thread with replies and their sources, nothing internal', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.setVisitor({});
      h.conversations.recentMessages.mockResolvedValue([
        {
          id: 'm1',
          role: 'user',
          text: 'how much?',
          citations: null,
          createdAt: new Date('2026-11-07T10:00:00Z'),
        },
        {
          id: 'm2',
          role: 'assistant',
          text: 'Sessions cost 1500.',
          citations: DECISION.citations,
          retrievalMeta: { x: 1 },
          agentRunId: 'run-1',
          handledBy: 'rag',
          createdAt: new Date('2026-11-07T10:00:05Z'),
        },
        {
          id: 'm3',
          role: 'assistant',
          text: '[erased]  ',
          citations: null,
          createdAt: new Date('2026-11-07T10:00:06Z'),
        },
      ]);
      const resumed = await h.service.conversation('sunrise', h.req);
      expect(resumed.messages[1]).toEqual({
        id: 'm2',
        role: 'assistant',
        text: 'Sessions cost 1500.',
        citations: [{ title: 'Fees', url: 'https://sunrise.example/fees' }],
        createdAt: '2026-11-07T10:00:05.000Z',
        rateable: true,
      });
    });

    it('new chat closes the open thread', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.setVisitor({});
      await h.service.newConversation('sunrise', h.req);
      expect(h.conversations.closeConversation).toHaveBeenCalledWith('conv-1');
    });
  });

  it('publicCitations keeps titles and http links only', () => {
    expect(
      publicCitations([
        { document_title: 'A', source_url: 'javascript:alert(1)' },
        { document_title: 'A', source_url: 'https://x' },
        { document_title: '', source_url: 'https://y' },
        { document_title: 'B', source_url: 'https://b' },
      ]),
    ).toEqual([
      { title: 'A', url: null },
      { title: 'B', url: 'https://b' },
    ]);
  });

  describe('feedback on an answer (chunk Q2a)', () => {
    const answer = (handledBy: string) => [
      {
        id: 'msg-2',
        conversation_id: 'conv-1',
        direction: 'outbound',
        handled_by: handledBy,
      },
    ];

    it('stores a thumbs down with its reason and note, once per answer', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.setVisitor({});
      h.db.query.mockResolvedValueOnce(answer('rag')).mockResolvedValueOnce([]);
      await expect(
        h.service.feedback(
          'sunrise',
          'msg-2',
          { rating: 'down', reason: 'wrong_info', note: ' The fee is wrong ' },
          h.req,
        ),
      ).resolves.toEqual({ rating: 'down' });
      const [sql, params] = h.db.query.mock.calls[1];
      expect(sql).toContain('ON CONFLICT (message_id) DO UPDATE');
      expect(params).toEqual([
        'msg-2',
        BOT_ID,
        'conv-1',
        'down',
        'wrong_info',
        'The fee is wrong',
      ]);
    });

    it('a thumbs up keeps no reason or note', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.setVisitor({});
      h.db.query
        .mockResolvedValueOnce(answer('declined'))
        .mockResolvedValueOnce([]);
      await h.service.feedback(
        'sunrise',
        'msg-2',
        { rating: 'up', reason: 'other', note: 'x' },
        h.req,
      );
      expect(h.db.query.mock.calls[1][1].slice(3)).toEqual(['up', null, null]);
    });

    it('never on a crisis reply or a template', async () => {
      for (const kind of ['crisis', 'template', 'consent']) {
        const h = harness(BotPageAccess.PUBLIC);
        h.setVisitor({});
        h.db.query.mockResolvedValueOnce(answer(kind));
        expect(
          await errorCodeOf(
            h.service.feedback('sunrise', 'msg-2', { rating: 'up' }, h.req),
          ),
        ).toBe('BOT_PAGE_NOT_RATEABLE');
        expect(h.db.query).toHaveBeenCalledTimes(1);
      }
    });

    it("refuses an answer from someone else's conversation", async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.setVisitor({});
      h.db.query.mockResolvedValueOnce([]);
      expect(
        await errorCodeOf(
          h.service.feedback('sunrise', 'msg-9', { rating: 'down' }, h.req),
        ),
      ).toBe('BOT_PAGE_NOT_FOUND');
      // The lookup is scoped to this visitor's contact on this bot.
      expect(h.db.query.mock.calls[0][1]).toEqual([
        'msg-9',
        BOT_ID,
        'contact-1',
      ]);
    });
  });

  describe('Talk to a person (chunk 11a)', () => {
    it('tells the visitor the team has been asked, and marks the chat', async () => {
      const h = harness(BotPageAccess.PUBLIC);
      h.setVisitor({});
      const result = await h.service.askForPerson('sunrise', h.req);
      expect(result.reply).toBe(
        "I've asked the team to join. They usually reply within a few hours.",
      );
      expect(h.stored[0]).toMatchObject({
        direction: 'outbound',
        role: 'assistant',
        handledBy: WaHandledBy.HANDOVER,
      });
      expect(h.handover.markNeedsPerson).toHaveBeenCalledWith(
        BOT_ID,
        'conv-1',
        'asked',
      );
    });
  });

  describe('the website widget (chunk 13)', () => {
    const SITE = 'https://www.sunrisemind.in';
    const embedReq = (extra: Record<string, string> = {}) =>
      ({
        ip: '203.0.113.9',
        headers: { 'x-ally-embed': '1', ...extra },
      }) as never;

    function widget(access = BotPageAccess.PUBLIC) {
      const h = harness(access);
      h.available.settings.widget.allowedDomains = ['sunrisemind.in'];
      return h;
    }

    it('starts a visit only on an allowed website, and remembers which', async () => {
      const h = widget();
      await h.service.session(
        'sunrise',
        { embed: { host: SITE, page: `${SITE}/fees?utm=x` } },
        embedReq(),
        h.res,
      );
      expect(h.issued[0].embed).toEqual({
        host: SITE,
        page: `${SITE}/fees`,
      });
    });

    it('refuses any other website, a missing host, and localhost in production', async () => {
      for (const host of [
        'https://evil-sunrisemind.in',
        'https://other.wixsite.com',
        'http://localhost:5500',
        undefined,
      ]) {
        const h = widget();
        expect(
          await errorCodeOf(
            h.service.session(
              'sunrise',
              host ? { embed: { host } } : {},
              embedReq(),
              h.res,
            ),
          ),
        ).toBe(ErrorCode.BOT_PAGE_HOST_NOT_ALLOWED);
        expect(h.issued).toHaveLength(0);
      }
    });

    it('the bot page itself is unchanged: no host needed, no widget visitor', async () => {
      const h = widget();
      await h.service.session('sunrise', {}, h.req, h.res);
      expect(h.issued[0].embed).toBeNull();
    });

    it('invite pages work in the widget: the code step keeps the host', async () => {
      const h = widget(BotPageAccess.INVITE);
      h.pageAccess.eligibility.mockResolvedValue({ eligible: true });
      await h.service.session(
        'sunrise',
        { email: 'asha@example.com', embed: { host: SITE } },
        embedReq(),
        h.res,
      );
      h.setVisitor({ embed: { host: SITE, page: null } });
      await h.service.verify(
        'sunrise',
        { email: 'asha@example.com', code: '123456', embed: { host: SITE } },
        embedReq(),
        h.res,
      );
      expect(h.issued.map((v) => v.embed?.host)).toEqual([SITE, SITE]);
      expect(h.issued[1].verifiedAt).toBeInstanceOf(Date);
    });

    it('hands over its token only when it asks (its cookie check failed)', async () => {
      const h = widget();
      const plain = await h.service.session(
        'sunrise',
        { embed: { host: SITE } },
        embedReq(),
        h.res,
      );
      expect(plain.visitorToken).toBeUndefined();
      const asked = await h.service.session(
        'sunrise',
        { embed: { host: SITE } },
        embedReq({ 'x-ally-embed-token': '1' }),
        h.res,
      );
      expect(asked.visitorToken).toBe('signed-token');
      // Never on the bot page itself, even if asked.
      const page = await h.service.session(
        'sunrise',
        {},
        { ip: '1.2.3.4', headers: { 'x-ally-embed-token': '1' } } as never,
        h.res,
      );
      expect(page.visitorToken).toBeUndefined();
    });

    it('taking the website off the list refuses the next message at once', async () => {
      const h = widget();
      h.setVisitor({ embed: { host: SITE, page: null } });
      await h.service.admit('sunrise', 'hi', embedReq(), h.res);
      h.available.settings.widget.allowedDomains = [];
      expect(
        await errorCodeOf(h.service.admit('sunrise', 'hi', embedReq(), h.res)),
      ).toBe(ErrorCode.BOT_PAGE_HOST_NOT_ALLOWED);
    });

    it('marks the chat as from the website, with the page', async () => {
      const h = widget();
      h.setVisitor({ embed: { host: SITE, page: `${SITE}/fees` } });
      const admitted = await h.service.admit(
        'sunrise',
        'how much?',
        embedReq(),
        h.res,
      );
      await h.service.respond(admitted);
      expect(h.conversations.setMetadata).toHaveBeenCalledWith('conv-1', {
        source: { kind: 'widget', host: SITE, page: `${SITE}/fees` },
      });
    });

    it('a message in the widget reaches the engine exactly as on the page (crisis included)', async () => {
      const page = widget();
      page.setVisitor({});
      await page.service.respond(
        await page.service.admit(
          'sunrise',
          'I want to end it',
          page.req,
          page.res,
        ),
      );
      const framed = widget();
      framed.setVisitor({ embed: { host: SITE, page: null } });
      await framed.service.respond(
        await framed.service.admit(
          'sunrise',
          'I want to end it',
          embedReq(),
          framed.res,
        ),
      );
      expect(framed.engine.respond.mock.calls[0]).toEqual(
        page.engine.respond.mock.calls[0],
      );
      expect(framed.engine.respond.mock.calls[0][0].channel).toBe(WEB_CHANNEL);
    });

    it('Talk to a person works in the widget, and the chat is marked', async () => {
      const h = widget();
      h.setVisitor({ embed: { host: SITE, page: null } });
      await h.service.askForPerson('sunrise', embedReq());
      expect(h.handover.markNeedsPerson).toHaveBeenCalledWith(
        BOT_ID,
        'conv-1',
        'asked',
      );
      expect(h.conversations.setMetadata).toHaveBeenCalledWith('conv-1', {
        source: { kind: 'widget', host: SITE, page: null },
      });
    });

    it("gives the loader the bubble's settings only on an allowed website", async () => {
      const h = widget();
      h.available.settings.widget.label = 'Talk to us';
      expect(await h.service.widgetConfig('sunrise', SITE, h.req)).toEqual({
        position: 'right',
        label: 'Talk to us',
        autoOpenSeconds: null,
        showOnPhones: true,
        accent: h.available.settings.branding.accentColour,
        logo: null,
        title: 'Sunrise Mind',
        pageUrl: 'https://chat.ally.test/b/sunrise',
      });
      for (const origin of ['https://elsewhere.com', undefined]) {
        expect(
          await errorCodeOf(h.service.widgetConfig('sunrise', origin, h.req)),
        ).toBe(ErrorCode.BOT_PAGE_HOST_NOT_ALLOWED);
      }
    });

    it('states the frame-ancestors for infra', async () => {
      const h = widget();
      expect(await h.service.framePolicy('sunrise')).toEqual({
        frameAncestors:
          "frame-ancestors 'self' https://chat.ally.test https://sunrisemind.in https://*.sunrisemind.in",
      });
    });
  });
});
