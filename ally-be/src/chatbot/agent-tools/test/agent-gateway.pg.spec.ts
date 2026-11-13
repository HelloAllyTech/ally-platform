import { DataSource } from 'typeorm';
import { ChatbotConversation } from 'src/chatbot/entity/chatbot-conversation.entity';
import { ChatbotMessage } from 'src/chatbot/entity/chatbot-message.entity';
import { ConversationChannel } from 'src/chatbot/enum/conversation.enum';
import { HandoverService } from 'src/chatbot/handover/handover.service';
import { ConversationService } from 'src/chatbot/service/conversation.service';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from 'src/whatsapp/shared-store/test/shared-store.pg';
import { AgentGatewayService } from '../agent-gateway.service';
import { AgentRunTokenService } from '../agent-run-token.service';
import { HandOverTool } from '../hand-over.tool';
import { AgentToolRegistry } from '../tools';
import { appConfig, RecordingTool, SERVICE_KEY } from './agent-tools.fakes';

/**
 * The gateway's claim on real Postgres (chunk 3b): `ON CONFLICT (run_id, step)`, the replay, the
 * stale reclaim, and `hand_over` marking a stored conversation with the new `assistant` reason.
 */
describePg('AgentGatewayService (Postgres)', () => {
  let dataSource: DataSource;
  let conversations: ConversationService;
  let botA: string;
  let botB: string;
  const events = { publishInbox: jest.fn() };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    conversations = new ConversationService(
      dataSource,
      dataSource.getRepository(ChatbotConversation),
      dataSource.getRepository(ChatbotMessage),
    );
  });
  afterAll(async () => closeTestDataSource(dataSource));
  beforeEach(async () => {
    await resetTables(dataSource);
    events.publishInbox.mockReset();
    botA = await seedChatbot(dataSource, 'A');
    botB = await seedChatbot(dataSource, 'B');
    await dataSource.query(
      `UPDATE chatbots SET settings = '{"abilities":{"hand_over":"do_it","note_it":"do_it"}}' WHERE id = $1`,
      [botA],
    );
  });

  const build = () => {
    const config = appConfig();
    const tokens = new AgentRunTokenService(config);
    const handover = new HandoverService(
      dataSource,
      conversations,
      events as never,
      {} as never,
      {} as never,
      {} as never,
      config,
    );
    const note = new RecordingTool('note_it');
    const gateway = new AgentGatewayService(
      dataSource,
      config,
      tokens,
      new AgentToolRegistry([
        new HandOverTool(dataSource, handover, conversations),
        note,
      ]),
    );
    const call = (
      tool: string,
      conversationId: string,
      body: { step?: number; input?: Record<string, unknown> } = {},
      runId = 'run-1',
    ) =>
      gateway.call(
        tool,
        {
          apiKey: SERVICE_KEY,
          authorization: `Bearer ${tokens.sign({
            chatbotId: botA,
            conversationId,
            runId,
            contactId: null,
            tools: ['hand_over', 'note_it'],
          })}`,
        },
        { run_id: runId, step: body.step ?? 0, input: body.input ?? {} },
      );
    return { call, note };
  };

  const conversationFor = async (chatbotId: string, phone: string) =>
    conversations.openConversation(
      chatbotId,
      (
        await conversations.resolveContact(
          { chatbotId },
          ConversationChannel.WEB,
          phone,
        )
      ).id,
      ConversationChannel.WEB,
      { idleWindowMinutes: 10 },
    );

  it('hand_over marks Needs a person with `assistant`, keeps the summary, tells the inbox, and records ok', async () => {
    const { call } = build();
    const conversation = await conversationFor(botA, 'v1');
    await expect(
      call('hand_over', conversation.id, {
        input: { summary: 'Wants a call back.' },
      }),
    ).resolves.toEqual({
      ok: true,
      result: { needs_person: true },
      replayed: false,
    });

    const [row] = await dataSource.query(
      `SELECT needs_person_since, needs_person_reason, metadata FROM chatbot_conversations WHERE id = $1`,
      [conversation.id],
    );
    expect(row.needs_person_reason).toBe('assistant');
    expect(row.needs_person_since).not.toBeNull();
    expect(row.metadata).toEqual({
      handover: { summary: 'Wants a call back.' },
    });
    expect(events.publishInbox).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'state', state: 'needs_person' }),
    );
    const runs = await dataSource.query(
      `SELECT chatbot_id, conversation_id, run_id, step, tool, status, result, duration_ms FROM tool_runs`,
    );
    expect(runs).toEqual([
      expect.objectContaining({
        chatbot_id: botA,
        conversation_id: conversation.id,
        run_id: 'run-1',
        step: 0,
        tool: 'hand_over',
        status: 'ok',
        result: { needs_person: true },
      }),
    ]);
  });

  it('keeps the first reason when the chat already needs a person', async () => {
    const { call } = build();
    const conversation = await conversationFor(botA, 'v2');
    await dataSource.query(
      `UPDATE chatbot_conversations SET needs_person_since = now(), needs_person_reason = 'asked' WHERE id = $1`,
      [conversation.id],
    );
    await call('hand_over', conversation.id);
    const [row] = await dataSource.query(
      `SELECT needs_person_reason FROM chatbot_conversations WHERE id = $1`,
      [conversation.id],
    );
    expect(row.needs_person_reason).toBe('asked');
  });

  it("can't reach another bot's conversation", async () => {
    const { call } = build();
    const theirs = await conversationFor(botB, 'v3');
    await expect(call('hand_over', theirs.id)).resolves.toEqual({
      ok: false,
      error: 'no_conversation',
      replayed: false,
    });
    const [row] = await dataSource.query(
      `SELECT needs_person_reason FROM chatbot_conversations WHERE id = $1`,
      [theirs.id],
    );
    expect(row.needs_person_reason).toBeNull();
  });

  it('Preview records the run and changes nothing else', async () => {
    const { call } = build();
    await expect(call('hand_over', 'preview-abc')).resolves.toMatchObject({
      ok: true,
    });
    expect(
      await dataSource.query(`SELECT conversation_id, status FROM tool_runs`),
    ).toEqual([{ conversation_id: 'preview-abc', status: 'ok' }]);
    expect(events.publishInbox).not.toHaveBeenCalled();
  });

  it('a replay runs once and returns the stored result; another tool at the step is 409', async () => {
    const { call, note } = build();
    await call('note_it', 'preview-1', { input: { note: 'a' } });
    await expect(
      call('note_it', 'preview-1', { input: { note: 'rephrased' } }),
    ).resolves.toEqual({ ok: true, result: { done: true }, replayed: true });
    expect(note.calls).toHaveLength(1);
    await expect(call('hand_over', 'preview-1')).rejects.toMatchObject({
      response: { errorCode: 'step_taken' },
    });
    expect(
      await dataSource.query(`SELECT count(*)::int AS n FROM tool_runs`),
    ).toEqual([{ n: 1 }]);
  });

  it('a step still running is 409; one started over 30 s ago is claimed again', async () => {
    const { call, note } = build();
    await dataSource.query(
      `INSERT INTO tool_runs (chatbot_id, conversation_id, run_id, step, tool, input, status)
       VALUES ($1, 'preview-1', 'run-1', 0, 'note_it', '{}', 'started')`,
      [botA],
    );
    await expect(call('note_it', 'preview-1')).rejects.toMatchObject({
      response: { errorCode: 'in_progress' },
    });
    await dataSource.query(
      `UPDATE tool_runs SET "updatedAt" = now() - interval '31 seconds'`,
    );
    await expect(call('note_it', 'preview-1')).resolves.toMatchObject({
      ok: true,
      replayed: false,
    });
    expect(note.calls).toHaveLength(1);
    expect(await dataSource.query(`SELECT status FROM tool_runs`)).toEqual([
      { status: 'ok' },
    ]);
  });
});
