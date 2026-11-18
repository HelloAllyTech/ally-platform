import { DataSource } from 'typeorm';
import { ChatbotConversation } from '../../entity/chatbot-conversation.entity';
import { ChatbotMessage } from '../../entity/chatbot-message.entity';
import { MemoryEntry } from '../../entity/memory-entry.entity';
import { AgentRuntimeUsed } from '../../enum/chatbot.enum';
import {
  ConversationChannel,
  ConversationMessageRole,
} from '../../enum/conversation.enum';
import { ConversationService } from '../../service/conversation.service';
import {
  WaHandledBy,
  WaMessageDirection,
  WaMessageStatus,
} from '../../../whatsapp/enum/whatsapp.enum';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from '../../../whatsapp/shared-store/test/shared-store.pg';
import { MemoryService } from '../memory.service';
import { SummaryService } from '../summary.service';
import type { AgentMemoryWrite } from '../../../ai/dto/knowledge.dto';

const WEB = ConversationChannel.WEB;
const PLACEHOLDERS = { text: '[erased]', erasedPrefix: 'erased:' };
const DAY = 24 * 60 * 60 * 1000;
const RUN = '0b0c3d58-55b1-4f36-a7a0-6f3f7b6f0a01';

describePg('Memory, light (Postgres)', () => {
  let dataSource: DataSource;
  let conversations: ConversationService;
  let memory: MemoryService;
  let summaries: SummaryService;
  let bot: string;
  let retentionDays: number;
  const ai = {
    getPromptOverrides: jest.fn().mockResolvedValue({}),
    checkMemoryLines: jest.fn(),
    summarizeConversation: jest.fn(),
  };
  const locks = new Set<string>();
  const redis = {
    acquireLock: jest.fn(async (key: string) => {
      if (locks.has(key)) return false;
      locks.add(key);
      return true;
    }),
    releaseLock: jest.fn(async (key: string) => {
      locks.delete(key);
    }),
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource([MemoryEntry]);
    conversations = new ConversationService(
      dataSource,
      dataSource.getRepository(ChatbotConversation),
      dataSource.getRepository(ChatbotMessage),
    );
    memory = new MemoryService(
      dataSource,
      ai as never,
      { get: async () => ({ retentionDays }) } as never,
    );
    summaries = new SummaryService(dataSource, ai as never, redis as never);
  });
  afterAll(async () => closeTestDataSource(dataSource));
  beforeEach(async () => {
    await resetTables(dataSource);
    bot = await seedChatbot(dataSource, 'Lakeview');
    retentionDays = 180;
    locks.clear();
    jest.clearAllMocks();
  });

  type Bot = {
    id: string;
    settings: Record<string, unknown>;
    safetyPack: string | null;
  };
  const chatbot = (
    over: Partial<Omit<Bot, 'id'>> & { id?: string } = {},
  ): Bot => ({
    id: over.id ?? bot,
    settings: over.settings ?? { memory: { on: true } },
    safetyPack: over.safetyPack ?? null,
  });

  async function person(visitor = 'visitor-1', chatbotId = bot) {
    const contact = await conversations.resolveContact(
      { chatbotId },
      WEB,
      visitor,
    );
    const conversation = await conversations.openConversation(
      chatbotId,
      contact.id,
      WEB,
      { idleWindowMinutes: 60 },
    );
    return { contactId: contact.id, conversationId: conversation.id };
  }

  /** A person message and the reply to it, as the bot page stores them. */
  async function turn(
    conversationId: string,
    text: string,
    reply: {
      handledBy?: WaHandledBy;
      runtime?: AgentRuntimeUsed | null;
      runId?: string;
      status?: WaMessageStatus;
    } = {},
  ) {
    const inbound = await conversations.appendMessage(conversationId, {
      channel: WEB,
      direction: WaMessageDirection.INBOUND,
      role: ConversationMessageRole.USER,
      text,
      status: WaMessageStatus.SENT,
    });
    await conversations.appendMessage(conversationId, {
      channel: WEB,
      direction: WaMessageDirection.OUTBOUND,
      role: ConversationMessageRole.ASSISTANT,
      text: 'OK.',
      status: reply.status ?? WaMessageStatus.SENT,
      handledBy: reply.handledBy ?? WaHandledBy.RAG,
      agentRunId: reply.runId ?? RUN,
      agentRuntime:
        reply.runtime === null ? null : (reply.runtime ?? AgentRuntimeUsed.V2),
      inReplyToId: inbound.id,
    });
    return inbound.id;
  }

  const lines = async (contactId: string) =>
    (await dataSource.query(
      `SELECT section, text, status, source_message_id, source_kind, said_at, expires_at
         FROM memory_entries WHERE contact_id = $1 ORDER BY said_at, text`,
      [contactId],
    )) as {
      section: string;
      text: string;
      status: string;
      source_message_id: string;
      source_kind: string;
      said_at: Date;
      expires_at: Date | null;
    }[];

  const add = (text: string, section = 'preferences'): AgentMemoryWrite => ({
    op: 'add',
    section: section as AgentMemoryWrite['section'],
    text,
  });

  const after = (
    conversationId: string,
    writes: AgentMemoryWrite[],
    refs: Record<string, string> = {},
    over: Partial<Omit<Bot, 'id'>> = {},
  ) =>
    memory.afterTurn({
      chatbot: chatbot(over) as never,
      conversationId,
      runId: RUN,
      pending: { writes, refs },
    });

  describe('after the reply', () => {
    it("stores a line from the agent's own reply, with its source message", async () => {
      const { contactId, conversationId } = await person();
      const said = await turn(conversationId, 'evenings work better for me');
      const applied = await after(conversationId, [add('prefers evenings')]);
      expect(applied).toMatchObject({ added: 1, refused: 0 });
      const [line] = await lines(contactId);
      expect(line).toMatchObject({
        section: 'preferences',
        text: 'prefers evenings',
        status: 'active',
        source_message_id: said,
        source_kind: 'person',
      });
    });

    it('stores nothing when the agent decided "answer" but the crisis reply went out', async () => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, 'I prefer evenings and I want to end it', {
        handledBy: WaHandledBy.CRISIS,
      });
      expect(await after(conversationId, [add('prefers evenings')])).toBe(null);
      expect(await lines(contactId)).toEqual([]);
    });

    it.each([
      ['a hand-over', { handledBy: WaHandledBy.HANDOVER }],
      ['an error', { handledBy: WaHandledBy.ERROR }],
      ['a v1 fallback', { runtime: AgentRuntimeUsed.V2_FALLBACK }],
      ['a reply that failed to send', { status: WaMessageStatus.FAILED }],
      ['a reply from another run', { runId: RUN.replace('01', '02') }],
    ])('stores nothing after %s', async (_label, reply) => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, 'evenings please', reply);
      expect(await after(conversationId, [add('prefers evenings')])).toBe(null);
      expect(await lines(contactId)).toEqual([]);
    });

    it('stores nothing in Try it', async () => {
      expect(
        await memory.afterTurn({
          chatbot: chatbot() as never,
          conversationId: 'preview-123',
          runId: RUN,
          pending: { writes: [add('prefers evenings')], refs: {} },
        }),
      ).toBe(null);
    });

    it('refuses a never-store line, a bad section and an over-long line', async () => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, 'my card is 4111 1111 1111 1111');
      const applied = await after(
        conversationId,
        [
          add('card 4111 1111 1111 1111'),
          add('is religious'),
          add('likes mornings', 'health'),
          add('x'.repeat(201)),
          add('prefers mornings'),
        ],
        {},
        { settings: { memory: { on: true, neverStore: ['religion'] } } },
      );
      expect(applied).toMatchObject({ added: 1, refused: 4 });
      expect((await lines(contactId)).map((l) => l.text)).toEqual([
        'prefers mornings',
      ]);
    });

    it('on a health pack keeps only what the model check keeps', async () => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, "I'm on sertraline and I prefer evenings");
      ai.checkMemoryLines.mockResolvedValue({
        keep: [false, true],
        failed: false,
      });
      const applied = await after(
        conversationId,
        [add('takes a daily tablet'), add('prefers evenings')],
        {},
        { safetyPack: 'mental_health' },
      );
      // "tablet" is refused in code first; the check sees what's left.
      expect(ai.checkMemoryLines).toHaveBeenCalledWith(
        expect.objectContaining({ lines: ['prefers evenings'] }),
      );
      expect(applied).toMatchObject({ refused: 1 });
      expect(await lines(contactId)).toEqual([]);
      ai.checkMemoryLines.mockResolvedValue({ keep: [true], failed: false });
      await after(
        conversationId,
        [add('prefers evenings')],
        {},
        { safetyPack: 'mental_health' },
      );
      expect((await lines(contactId)).map((l) => l.text)).toEqual([
        'prefers evenings',
      ]);
    });

    it.each([
      ['fails', { keep: [true], failed: true }],
      ['times out', new Error('timeout')],
      ['answers for the wrong lines', { keep: [true, true], failed: false }],
    ])('on a health pack keeps nothing when the check %s', async (_l, out) => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, 'evenings please');
      if (out instanceof Error) ai.checkMemoryLines.mockRejectedValue(out);
      else ai.checkMemoryLines.mockResolvedValue(out);
      const applied = await after(
        conversationId,
        [add('prefers evenings')],
        {},
        { safetyPack: 'medical' },
      );
      expect(applied).toMatchObject({ dropped: 1, added: 0 });
      expect(await lines(contactId)).toEqual([]);
    });

    it('never calls the check off a health pack', async () => {
      const { conversationId } = await person();
      await turn(conversationId, 'evenings please');
      await after(conversationId, [add('prefers evenings')]);
      expect(ai.checkMemoryLines).not.toHaveBeenCalled();
    });

    it("can't change another person's line, or another bot's", async () => {
      const a = await person('visitor-a');
      const b = await person('visitor-b');
      await turn(a.conversationId, 'evenings');
      await after(a.conversationId, [add('prefers evenings')]);
      const [{ id }] = (await dataSource.query(
        `SELECT id FROM memory_entries WHERE contact_id = $1`,
        [a.contactId],
      )) as { id: string }[];
      await turn(b.conversationId, 'forget it');
      const applied = await after(
        b.conversationId,
        [
          { op: 'forget', id: 'm1' },
          { op: 'replace', id: 'm1', text: 'prefers mornings' },
        ],
        { m1: id },
      );
      expect(applied).toMatchObject({ forgotten: 0, replaced: 0, refused: 2 });
      expect((await lines(a.contactId)).map((l) => l.text)).toEqual([
        'prefers evenings',
      ]);

      const other = await seedChatbot(dataSource, 'Sunrise');
      const elsewhere = await person('visitor-a', other);
      await turn(elsewhere.conversationId, 'hi');
      // Another bot's run, pointing at Lakeview's message and line.
      const crossed = await memory.apply(chatbot({ id: other }) as never, {
        contactId: a.contactId,
        conversationId: a.conversationId,
        sourceMessageId: (
          (await dataSource.query(
            `SELECT id FROM chatbot_messages WHERE conversation_id = $1 AND role = 'user'`,
            [a.conversationId],
          )) as { id: string }[]
        )[0].id,
        runId: RUN,
        writes: [add('likes tea'), { op: 'forget', id: 'm1' }],
        refs: { m1: id },
      });
      expect(crossed.refused).toBe(2);
      expect(await lines(a.contactId)).toHaveLength(1);
    });

    it('replace, done and forget change the line they point at', async () => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, 'evenings');
      await after(conversationId, [
        add('prefers evenings'),
        add('waiting to hear about fees', 'open_items'),
        add('comes with her mother', 'context'),
      ]);
      const ids = Object.fromEntries(
        (
          (await dataSource.query(
            `SELECT id, text FROM memory_entries WHERE contact_id = $1`,
            [contactId],
          )) as { id: string; text: string }[]
        ).map((r) => [r.text, r.id]),
      );
      await turn(conversationId, 'mornings now; fees sorted; forget my mum');
      await after(
        conversationId,
        [
          { op: 'replace', id: 'm1', text: 'prefers mornings' },
          { op: 'done', id: 'm2' },
          { op: 'forget', id: 'm3' },
        ],
        {
          m1: ids['prefers evenings'],
          m2: ids['waiting to hear about fees'],
          m3: ids['comes with her mother'],
        },
      );
      expect(
        (await lines(contactId)).map((l) => [l.text, l.status]).sort(),
      ).toEqual([
        ['prefers mornings', 'active'],
        ['waiting to hear about fees', 'done'],
      ]);
    });

    it('with memory off stores no lines', async () => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, 'evenings');
      const applied = await after(
        conversationId,
        [add('prefers evenings')],
        {},
        { settings: { memory: { on: false } } },
      );
      expect(applied).toMatchObject({ added: 0, refused: 1 });
      expect(await lines(contactId)).toEqual([]);
    });
  });

  describe('the limit and expiry', () => {
    it('keeps at most 40 active lines: past that, the oldest context line goes', async () => {
      const { contactId, conversationId } = await person();
      const source = await turn(conversationId, 'lots');
      await dataSource.query(
        `INSERT INTO memory_entries (chatbot_id, contact_id, section, text, source_message_id, said_at)
         SELECT $1, $2, CASE WHEN n <= 5 THEN 'context' ELSE 'preferences' END,
                'line ' || n, $3, now() - (n || ' minutes')::interval
           FROM generate_series(1, 40) n`,
        [bot, contactId, source],
      );
      await after(conversationId, [add('prefers evenings')]);
      const all = await lines(contactId);
      expect(all).toHaveLength(40);
      // line 5 was the oldest context line (said 5 minutes ago).
      expect(all.map((l) => l.text)).not.toContain('line 5');
      expect(all.map((l) => l.text)).toContain('prefers evenings');
    });

    it('a preference expires with retention from when it was last said; saying it again renews it', async () => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, 'evenings');
      await after(conversationId, [add('Prefers evenings.')]);
      const [first] = await lines(contactId);
      expect(first.expires_at).not.toBeNull();
      expect(
        new Date(first.expires_at!).getTime() -
          new Date(first.said_at).getTime(),
      ).toBe(180 * DAY);
      await dataSource.query(
        `UPDATE memory_entries SET said_at = said_at - interval '10 days',
                expires_at = expires_at - interval '10 days'`,
      );
      await turn(conversationId, 'evenings again');
      const renewed = await after(conversationId, [add('prefers  evenings')]);
      expect(renewed).toMatchObject({ renewed: 1, added: 0 });
      const after2 = await lines(contactId);
      expect(after2).toHaveLength(1);
      expect(new Date(after2[0].said_at).getTime()).toBeGreaterThan(
        new Date(first.said_at).getTime(),
      );
    });

    it('with retention off a preference has no expiry; an open item and context take the earlier date', async () => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, 'x');
      retentionDays = 0;
      await after(conversationId, [add('prefers evenings')]);
      retentionDays = 10;
      await after(conversationId, [
        add('waiting for a call back', 'open_items'),
        add('comes with his mother', 'context'),
      ]);
      retentionDays = 365;
      await after(conversationId, [add('asked about fees', 'open_items')]);
      const byText = Object.fromEntries(
        (await lines(contactId)).map((l) => [
          l.text,
          l.expires_at
            ? Math.round(
                (new Date(l.expires_at).getTime() -
                  new Date(l.said_at).getTime()) /
                  DAY,
              )
            : null,
        ]),
      );
      expect(byText).toEqual({
        'prefers evenings': null,
        'waiting for a call back': 10,
        'comes with his mother': 10,
        'asked about fees': 30,
      });
    });

    it('the sweep deletes lines past their expiry', async () => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, 'x');
      await after(conversationId, [
        add('prefers evenings'),
        add('waiting', 'open_items'),
      ]);
      await dataSource.query(
        `UPDATE memory_entries SET expires_at = now() - interval '1 minute' WHERE text = 'waiting'`,
      );
      expect(await conversations.sweepMemory()).toBe(1);
      expect((await lines(contactId)).map((l) => l.text)).toEqual([
        'prefers evenings',
      ]);
    });
  });

  describe('the name', () => {
    const nameOf = async (contactId: string) =>
      (
        (await dataSource.query(
          `SELECT display_name FROM chatbot_contacts WHERE id = $1`,
          [contactId],
        )) as { display_name: string | null }[]
      )[0].display_name;

    it('is set only when the contact has none, even with memory off', async () => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, "I'm Rahul, book me 11:00");
      await after(
        conversationId,
        [{ op: 'name', text: 'Rahul' }],
        {},
        {
          settings: {},
        },
      );
      expect(await nameOf(contactId)).toBe('Rahul');
      await turn(conversationId, "I'm Ravi actually");
      await after(conversationId, [{ op: 'name', text: 'Ravi' }]);
      expect(await nameOf(contactId)).toBe('Rahul');
    });

    it.each([
      ['a crisis reply', { handledBy: WaHandledBy.CRISIS }, 'Rahul'],
      ['past 80 characters', {}, 'R'.repeat(81)],
      ['a never-store match', {}, 'PIN 1234'],
    ])('is refused after %s', async (_l, reply, name) => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, 'hi', reply);
      await after(conversationId, [{ op: 'name', text: name }]);
      expect(await nameOf(contactId)).toBe(null);
    });

    it("heads the person's lines in the memory section when memory is on", async () => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, "I'm Rahul, evenings please");
      await after(conversationId, [
        { op: 'name', text: 'Rahul' },
        add('prefers evenings'),
      ]);
      const run = await memory.forRun(
        chatbot() as never,
        contactId,
        conversationId,
      );
      expect(run.fields.memory?.lines).toMatch(
        /^Name: Rahul\nPreferences:\n- m1 /,
      );
      expect(run.fields.person_name).toBe('Rahul');
    });

    it('reaches the next run', async () => {
      const { contactId, conversationId } = await person();
      await turn(conversationId, "I'm Rahul");
      await after(conversationId, [{ op: 'name', text: 'Rahul' }]);
      const run = await memory.forRun(
        chatbot({ settings: {} }) as never,
        contactId,
        conversationId,
      );
      expect(run.fields).toEqual({ person_name: 'Rahul' });
    });
  });

  describe('what they told the page before the chat', () => {
    const intake = {
      completedAt: '2026-11-16T06:28:00Z',
      consents: [],
      answers: [
        { id: 'q1', type: 'text', label: 'Your name', value: 'Shehbaz' },
        { id: 'q2', type: 'phone', label: 'Phone number', value: '9920805299' },
        {
          id: 'q3',
          type: 'choice',
          label: 'What are you looking for?',
          value: 'Adult Therapy',
        },
      ],
    };

    it('gives the run their name and answers, never their phone, with memory off too', async () => {
      const { contactId, conversationId } = await person();
      await dataSource.query(
        `UPDATE chatbot_conversations SET metadata = metadata || jsonb_build_object('intake', $2::jsonb) WHERE id = $1`,
        [conversationId, JSON.stringify(intake)],
      );
      const run = await memory.forRun(
        chatbot({ settings: {} }) as never,
        contactId,
        conversationId,
      );
      expect(run.fields).toEqual({
        person_name: 'Shehbaz',
        before_chat: [
          { label: 'What are you looking for?', value: 'Adult Therapy' },
        ],
      });
      expect(JSON.stringify(run.fields)).not.toContain('9920805299');
    });

    it('names the contact from it, only when it has no name', async () => {
      const { contactId } = await person();
      await memory.nameIfUnnamed(bot, contactId, 'Shehbaz');
      await memory.nameIfUnnamed(bot, contactId, 'Someone Else');
      const [row] = (await dataSource.query(
        `SELECT display_name FROM chatbot_contacts WHERE id = $1`,
        [contactId],
      )) as { display_name: string }[];
      expect(row.display_name).toBe('Shehbaz');
    });
  });

  describe('the run', () => {
    it('with memory off, no name and no summary sends nothing', async () => {
      const { contactId, conversationId } = await person();
      expect(
        await memory.forRun(
          chatbot({ settings: {} }) as never,
          contactId,
          conversationId,
        ),
      ).toEqual({ fields: {}, refs: {} });
    });

    it("with memory on sends the person's lines, and never another person's", async () => {
      const a = await person('visitor-a');
      const b = await person('visitor-b');
      await turn(a.conversationId, 'evenings');
      await after(a.conversationId, [add('prefers evenings')]);
      const forA = await memory.forRun(
        chatbot() as never,
        a.contactId,
        a.conversationId,
      );
      expect(forA.fields.memory?.lines).toMatch(
        /^Preferences:\n- m1 \(\d+ \w+ \d{4}\): prefers evenings$/,
      );
      expect(forA.fields.memory?.never_store).toEqual([
        'Payment details',
        'Passwords and PINs',
        'ID numbers',
      ]);
      expect(Object.keys(forA.refs)).toEqual(['m1']);
      const forB = await memory.forRun(
        chatbot() as never,
        b.contactId,
        b.conversationId,
      );
      expect(forB.fields.memory).toEqual({
        lines: '',
        never_store: expect.any(Array),
      });
    });
  });

  describe('Forget, erasure and retention', () => {
    async function remembered() {
      const p = await person();
      await turn(p.conversationId, 'evenings');
      await after(p.conversationId, [add('prefers evenings')]);
      await dataSource.query(
        `UPDATE chatbot_conversations SET summary = 'They asked about fees.',
                metadata = metadata || '{"summaryUpto":"x"}' WHERE id = $1`,
        [p.conversationId],
      );
      return p;
    }
    const summaryOf = async (id: string) =>
      (
        (await dataSource.query(
          `SELECT summary, metadata ? 'summaryUpto' AS upto FROM chatbot_conversations WHERE id = $1`,
          [id],
        )) as { summary: string | null; upto: boolean }[]
      )[0];

    it('Forget this person deletes their lines and blanks their summaries', async () => {
      const { contactId, conversationId } = await remembered();
      expect(await memory.forgetPerson(bot, contactId)).toBe(1);
      expect(await lines(contactId)).toEqual([]);
      expect(await summaryOf(conversationId)).toEqual({
        summary: null,
        upto: false,
      });
    });

    it("shows the Inbox the chat's pre-chat answers, its summary, expiry and what it never keeps", async () => {
      const { contactId, conversationId } = await remembered();
      await dataSource.query(
        `UPDATE chatbot_conversations
            SET metadata = metadata || jsonb_build_object('intake', $2::jsonb) WHERE id = $1`,
        [
          conversationId,
          JSON.stringify({
            completedAt: 'x',
            consents: [],
            answers: [
              { id: 'q2', type: 'phone', label: 'Phone', value: '9920805299' },
              {
                id: 'q3',
                type: 'choice',
                label: 'Looking for',
                value: 'Adult Therapy',
              },
            ],
          }),
        ],
      );
      const view = await memory.forInbox(
        chatbot() as never,
        contactId,
        conversationId,
      );
      expect(view.beforeChat).toEqual([
        { label: 'Looking for', value: 'Adult Therapy' },
      ]);
      expect(view.summary).toBe('They asked about fees.');
      expect(view.lines[0].expiresAt).not.toBeNull();
      expect(view.neverStore).toContain('Payment details');
      expect(JSON.stringify(view)).not.toContain('9920805299');
    });

    it('a forgotten line is gone from the next run', async () => {
      const { contactId, conversationId } = await remembered();
      const view = await memory.forInbox(chatbot() as never, contactId);
      expect(view.lines).toHaveLength(1);
      expect(view.lines[0].sourceConversationId).toBe(conversationId);
      expect(await memory.forget(bot, view.lines[0].id)).toBe(true);
      const run = await memory.forRun(
        chatbot() as never,
        contactId,
        conversationId,
      );
      expect(run.fields.memory?.lines).toBe('');
    });

    it("an editor's change keeps the line and makes it the owner's; never-store still applies", async () => {
      const { contactId } = await remembered();
      const [line] = (await memory.forInbox(chatbot() as never, contactId))
        .lines;
      expect(
        await memory.edit(chatbot() as never, line.id, 'prefers late evenings'),
      ).toMatchObject({ ok: true });
      expect((await lines(contactId))[0]).toMatchObject({
        text: 'prefers late evenings',
        source_kind: 'owner',
      });
      expect(
        await memory.edit(chatbot() as never, line.id, 'password is hunter2'),
      ).toEqual({ ok: false, reason: 'never_store' });
      const other = await seedChatbot(dataSource, 'Sunrise');
      expect(
        await memory.edit(chatbot({ id: other }) as never, line.id, 'x'),
      ).toEqual({ ok: false, reason: 'not_found' });
      expect(await memory.forget(other, line.id)).toBe(false);
    });

    it('erasing a contact deletes their lines and blanks summaries', async () => {
      const { contactId, conversationId } = await remembered();
      await conversations.eraseContact(contactId, PLACEHOLDERS);
      expect(await lines(contactId)).toEqual([]);
      expect((await summaryOf(conversationId)).summary).toBe(null);
    });

    it('erasing conversations (WhatsApp) deletes the lines and blanks summaries', async () => {
      const { contactId, conversationId } = await remembered();
      await conversations.eraseConversations(
        [conversationId],
        WEB,
        PLACEHOLDERS,
      );
      expect(await lines(contactId)).toEqual([]);
      expect((await summaryOf(conversationId)).summary).toBe(null);
    });

    it('retention deletes lines last said before the cutoff and blanks old summaries', async () => {
      const { contactId, conversationId } = await remembered();
      await dataSource.query(
        `UPDATE memory_entries SET said_at = now() - interval '200 days'`,
      );
      await dataSource.query(
        `UPDATE chatbot_conversations SET last_message_at = now() - interval '200 days' WHERE id = $1`,
        [conversationId],
      );
      await conversations.blankBefore(
        new Date(Date.now() - 180 * DAY),
        PLACEHOLDERS,
      );
      expect(await lines(contactId)).toEqual([]);
      expect((await summaryOf(conversationId)).summary).toBe(null);
    });
  });

  describe('the rolling summary', () => {
    async function chat(n: number) {
      const p = await person();
      for (let i = 1; i <= n; i++) {
        await conversations.appendMessage(p.conversationId, {
          channel: WEB,
          direction:
            i % 2 ? WaMessageDirection.INBOUND : WaMessageDirection.OUTBOUND,
          role:
            i % 2
              ? ConversationMessageRole.USER
              : ConversationMessageRole.ASSISTANT,
          text: `message ${i}`,
          status: WaMessageStatus.SENT,
        });
        // Distinct timestamps, in order.
        await dataSource.query(
          `UPDATE chatbot_messages SET "createdAt" = now() + ($2 || ' seconds')::interval
            WHERE conversation_id = $1 AND text = $3`,
          [p.conversationId, i, `message ${i}`],
        );
      }
      return p;
    }
    const summarised = (text = 'They said 1 and 2.') =>
      ai.summarizeConversation.mockResolvedValue({
        summary: text,
        failed: false,
      });

    it('waits until the chat passes 10 messages', async () => {
      const { conversationId } = await chat(10);
      expect(
        await summaries.afterTurn(chatbot() as never, conversationId),
      ).toBe(false);
      expect(ai.summarizeConversation).not.toHaveBeenCalled();
    });

    it('folds in the messages that left the window, once', async () => {
      const { conversationId } = await chat(12);
      summarised();
      expect(
        await summaries.afterTurn(
          chatbot({ safetyPack: 'mental_health' }) as never,
          conversationId,
        ),
      ).toBe(true);
      expect(ai.summarizeConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: null,
          health: true,
          messages: [
            { role: 'user', content: 'message 1' },
            { role: 'assistant', content: 'message 2' },
          ],
        }),
      );
      expect(
        await summaries.afterTurn(chatbot() as never, conversationId),
      ).toBe(false);
      expect(ai.summarizeConversation).toHaveBeenCalledTimes(1);
      const run = await memory.forRun(
        chatbot({ settings: {} }) as never,
        null,
        conversationId,
      );
      expect(run.fields.summary).toBe('They said 1 and 2.');
    });

    it('folds only the new ones next time, with the summary so far', async () => {
      const { conversationId } = await chat(12);
      summarised();
      await summaries.afterTurn(chatbot() as never, conversationId);
      for (const i of [13, 14]) {
        await conversations.appendMessage(conversationId, {
          channel: WEB,
          direction: WaMessageDirection.INBOUND,
          role: ConversationMessageRole.USER,
          text: `message ${i}`,
          status: WaMessageStatus.SENT,
        });
        await dataSource.query(
          `UPDATE chatbot_messages SET "createdAt" = now() + ($2 || ' seconds')::interval
            WHERE conversation_id = $1 AND text = $3`,
          [conversationId, i, `message ${i}`],
        );
      }
      summarised('They said 1 to 4.');
      await summaries.afterTurn(chatbot() as never, conversationId);
      expect(ai.summarizeConversation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          summary: 'They said 1 and 2.',
          messages: [
            { role: 'user', content: 'message 3' },
            { role: 'assistant', content: 'message 4' },
          ],
        }),
      );
    });

    it('keeps the old summary when it fails, and tries again next time', async () => {
      const { conversationId } = await chat(12);
      ai.summarizeConversation.mockResolvedValue({ summary: '', failed: true });
      expect(
        await summaries.afterTurn(chatbot() as never, conversationId),
      ).toBe(false);
      ai.summarizeConversation.mockRejectedValue(new Error('down'));
      expect(
        await summaries.afterTurn(chatbot() as never, conversationId),
      ).toBe(false);
      summarised();
      expect(
        await summaries.afterTurn(chatbot() as never, conversationId),
      ).toBe(true);
      expect(redis.releaseLock).toHaveBeenCalledTimes(3);
    });

    it('runs one at a time per chat', async () => {
      const { conversationId } = await chat(12);
      locks.add(`summary:${conversationId}`);
      summarised();
      expect(
        await summaries.afterTurn(chatbot() as never, conversationId),
      ).toBe(false);
      expect(ai.summarizeConversation).not.toHaveBeenCalled();
    });
  });
});
