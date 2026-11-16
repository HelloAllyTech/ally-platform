import { BadRequestException } from '@nestjs/common';
import { ToolRunStatus } from '../../entity/tool-run.entity';
import { HandOverTool } from '../hand-over.tool';
import {
  BOT_A,
  BOT_B,
  CONV_A,
  CONV_B,
  makeGateway,
  SERVICE_KEY,
} from './agent-tools.fakes';

/** Bot A owns CONV_A and bot B owns CONV_B, as stored conversations. */
function setup() {
  const conversations = new Map([
    [CONV_A, BOT_A],
    [CONV_B, BOT_B],
  ]);
  const dataSource = {
    query: jest.fn(async (_sql: string, [id, chatbotId]: string[]) =>
      conversations.get(id) === chatbotId ? [{ id }] : [],
    ),
  };
  const handover = { markNeedsPerson: jest.fn().mockResolvedValue(undefined) };
  const store = { setMetadata: jest.fn().mockResolvedValue(undefined) };
  const tool = new HandOverTool(
    dataSource as never,
    handover as never,
    store as never,
  );
  const ctx = (conversationId: string, chatbotId = BOT_A) => ({
    chatbotId,
    conversationId,
    runId: 'run-1',
    contactId: null,
  });
  return { tool, dataSource, handover, store, ctx };
}

describe('hand_over', () => {
  it('marks the chat Needs a person with `assistant`, keeps the summary, and tells the inbox', async () => {
    const { tool, handover, store, ctx } = setup();
    await expect(
      tool.run(
        ctx(CONV_A),
        tool.parse({ summary: '  Wants a call back about a bill. ' }),
      ),
    ).resolves.toEqual({ ok: true, result: { needs_person: true } });
    expect(store.setMetadata).toHaveBeenCalledWith(CONV_A, {
      handover: { summary: 'Wants a call back about a bill.' },
    });
    // markNeedsPerson keeps the first reason and publishes the inbox's state event.
    expect(handover.markNeedsPerson).toHaveBeenCalledWith(
      BOT_A,
      CONV_A,
      'assistant',
    );
  });

  it('hands over with an empty summary, storing none', async () => {
    const { tool, handover, store, ctx } = setup();
    await expect(tool.run(ctx(CONV_A), tool.parse({}))).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      tool.run(ctx(CONV_A), tool.parse({ summary: '   ' })),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(store.setMetadata).not.toHaveBeenCalled();
    expect(handover.markNeedsPerson).toHaveBeenCalledTimes(2);
  });

  it('refuses a summary over 300 characters, a non-text one, and unknown fields', () => {
    const { tool } = setup();
    expect(() => tool.parse({ summary: 'x'.repeat(301) })).toThrow(
      BadRequestException,
    );
    expect(tool.parse({ summary: 'x'.repeat(300) }).summary).toHaveLength(300);
    expect(() => tool.parse({ summary: 3 })).toThrow(BadRequestException);
    expect(() => tool.parse({ summary: 'x', conversation_id: CONV_B })).toThrow(
      BadRequestException,
    );
  });

  it('changes nothing in Preview', async () => {
    const { tool, dataSource, handover, store, ctx } = setup();
    await expect(
      tool.run(ctx('preview-1234'), tool.parse({ summary: 'x' })),
    ).resolves.toEqual({ ok: true, result: { preview: true } });
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(handover.markNeedsPerson).not.toHaveBeenCalled();
    expect(store.setMetadata).not.toHaveBeenCalled();
  });

  it('fails with no stored conversation (WhatsApp before the shared store), never silently', async () => {
    const { tool, handover, ctx } = setup();
    await expect(
      tool.run(
        ctx('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        tool.parse({ summary: 'x' }),
      ),
    ).resolves.toEqual({ ok: false, error: 'no_conversation' });
    await expect(tool.run(ctx('not-a-uuid'), tool.parse({}))).resolves.toEqual({
      ok: false,
      error: 'no_conversation',
    });
    expect(handover.markNeedsPerson).not.toHaveBeenCalled();
  });

  it("can't touch another bot's conversation: bot A's token on bot B's chat fails", async () => {
    const { tool, handover, store, ctx } = setup();
    await expect(
      tool.run(ctx(CONV_B, BOT_A), tool.parse({ summary: 'x' })),
    ).resolves.toEqual({ ok: false, error: 'no_conversation' });
    expect(handover.markNeedsPerson).not.toHaveBeenCalled();
    expect(store.setMetadata).not.toHaveBeenCalled();
  });

  it("through the gateway: bot A's token naming bot B's conversation is refused and recorded", async () => {
    const { tool, handover } = setup();
    const { db, tokens, gateway } = makeGateway([tool]);
    db.bots.set(BOT_A, { abilities: { hand_over: 'do_it' } });
    const token = tokens.sign({
      chatbotId: BOT_A,
      conversationId: CONV_B,
      runId: 'run-x',
      contactId: null,
      tools: ['hand_over'],
    });
    await expect(
      gateway.call(
        'hand_over',
        { apiKey: SERVICE_KEY, authorization: `Bearer ${token}` },
        { run_id: 'run-x', step: 0, input: { summary: 'x' } },
      ),
    ).resolves.toEqual({
      ok: false,
      error: 'no_conversation',
      replayed: false,
    });
    expect(handover.markNeedsPerson).not.toHaveBeenCalled();
    expect(db.runs[0]).toMatchObject({
      chatbot_id: BOT_A,
      status: ToolRunStatus.ERROR,
      error_code: 'no_conversation',
    });
  });
});
