import { ForbiddenException } from '@nestjs/common';
import { ChatbotMemberRole, ChatbotStatus } from '../../enum/chatbot.enum';
import { ChatbotService } from '../chatbot.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/**
 * Restoring a removed bot (the Archived tab): it comes back paused, with the documents its removal
 * archived and, if it never went live, its setup. Only an owner can, and its channels stay free.
 */
describe('ChatbotService.restore', () => {
  const BOT = 'bot-1';
  const REMOVED = new Date('2026-11-11T10:00:00Z');

  const setup = (
    role: ChatbotMemberRole,
    { archived = true, unpublishedSetup = null as string | null } = {},
  ) => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM kb_documents')) return [{ id: 'own-1' }];
      if (sql.includes('SELECT id FROM bot_drafts')) {
        return unpublishedSetup ? [{ id: unpublishedSetup }] : [];
      }
      return [];
    });
    const update = jest.fn();
    const knowledgeBase = { unarchiveForChatbot: jest.fn() };
    const connectors = { update: jest.fn() };
    const service = new ChatbotService(
      { manager: { query }, update } as never,
      {} as never,
      {} as never,
      {} as never,
      connectors as never,
      {
        assert: jest.fn(async () => ({
          chatbot: { id: BOT, archivedAt: archived ? REMOVED : null },
          role,
        })),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      knowledgeBase as never,
    );
    jest.spyOn(service, 'get').mockResolvedValue({ id: BOT } as never);
    return { service, query, update, knowledgeBase, connectors };
  };

  it('brings it back paused, with the documents its removal archived', async () => {
    const t = setup(ChatbotMemberRole.OWNER);
    await t.service.restore(BOT);
    expect(t.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "archived_at >= $2::timestamptz - interval '1 minute'",
      ),
      [BOT, REMOVED],
    );
    expect(t.knowledgeBase.unarchiveForChatbot).toHaveBeenCalledWith(
      BOT,
      'own-1',
    );
    expect(t.update).toHaveBeenCalledWith(
      { id: BOT },
      expect.objectContaining({
        archivedAt: null,
        status: ChatbotStatus.PAUSED,
      }),
    );
    // Its channels stay free: a number may serve another bot by now.
    expect(t.connectors.update).not.toHaveBeenCalled();
  });

  it('gives a bot removed mid-setup its setup back, as a draft', async () => {
    const t = setup(ChatbotMemberRole.OWNER, { unpublishedSetup: 'draft-1' });
    await t.service.restore(BOT);
    expect(t.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'active'"),
      ['draft-1'],
    );
    expect(t.update).toHaveBeenCalledWith(
      { id: BOT },
      expect.objectContaining({
        archivedAt: null,
        status: ChatbotStatus.DRAFT,
      }),
    );
  });

  it('is for owners only', async () => {
    const t = setup(ChatbotMemberRole.EDITOR);
    await expect(t.service.restore(BOT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(t.update).not.toHaveBeenCalled();
  });

  it('leaves a bot that is not archived as it is', async () => {
    const t = setup(ChatbotMemberRole.OWNER, { archived: false });
    await t.service.restore(BOT);
    expect(t.update).not.toHaveBeenCalled();
  });
});

/** One switch (Overview): Live means people can use it, so the page turns on with it. */
describe('ChatbotService.setStatus', () => {
  const make = () => {
    const query = jest.fn(async () => []);
    const update = jest.fn();
    const service = new ChatbotService(
      { manager: { query }, update } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { assert: jest.fn(async () => ({ chatbot: { id: 'bot-1' } })) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'bot-1' } as never);
    return { service, query, update };
  };

  it('turns the page on when the assistant goes live', async () => {
    const t = make();
    await t.service.setStatus('bot-1', ChatbotStatus.LIVE);
    expect(t.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE chatbot_pages SET status = 'on'"),
      ['bot-1'],
    );
  });

  it("leaves the page on when it's paused, so visitors see it's away", async () => {
    const t = make();
    await t.service.setStatus('bot-1', ChatbotStatus.PAUSED);
    expect(t.update).toHaveBeenCalledWith(
      { id: 'bot-1' },
      expect.objectContaining({ status: ChatbotStatus.PAUSED }),
    );
    expect(t.query).not.toHaveBeenCalled();
  });
});
