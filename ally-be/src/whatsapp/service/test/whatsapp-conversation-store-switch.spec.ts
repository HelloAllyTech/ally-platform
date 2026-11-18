import {
  DEFAULT_WHATSAPP_SETTINGS,
  dashboardReadsShared,
} from '../../type/whatsapp-settings.type';
import { WhatsAppConversationService } from '../whatsapp-conversation.service';
import { notWebQuestionSql, visitorLabel } from '../shared-conversation.reader';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/**
 * Which store the dashboard reads (chunk 12b). `wa_*` unless `dashboardReadsFrom` is `shared` AND
 * the shared store is being written; the WhatsApp-only path never sees a bot page thread. The full
 * comparison of both stores on the same data is `dashboard-parity.pg.spec.ts` (needs Postgres).
 */
describe('the dashboard’s store switch', () => {
  it.each([
    [{ sharedStoreWrites: false, dashboardReadsFrom: 'wa' }, false],
    [{ sharedStoreWrites: false, dashboardReadsFrom: 'shared' }, false],
    [{ sharedStoreWrites: true, dashboardReadsFrom: 'wa' }, false],
    [{ sharedStoreWrites: true, dashboardReadsFrom: 'shared' }, true],
  ] as const)('%j → shared = %s', (settings, shared) => {
    expect(dashboardReadsShared(settings)).toBe(shared);
  });

  function service(settings?: Partial<typeof DEFAULT_WHATSAPP_SETTINGS>) {
    const manager = { query: jest.fn().mockResolvedValue([]) };
    const builder = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ id: 'wa-thread' }]),
      getCount: jest.fn().mockResolvedValue(1),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const repo = { createQueryBuilder: () => builder, manager };
    const svc = new WhatsAppConversationService(
      repo as never,
      repo as never,
      repo as never,
      repo as never,
      repo as never,
      {} as never,
      {} as never,
      { accessibleChatbotIds: async () => null } as never,
      undefined,
      settings
        ? ({
            get: async () => ({ ...DEFAULT_WHATSAPP_SETTINGS, ...settings }),
          } as never)
        : undefined,
    );
    return { svc, builder, manager };
  }

  it('reads wa_* when no settings service is wired (as every existing module builds it)', async () => {
    const { svc, builder, manager } = service();
    expect(await svc.listConversations({})).toEqual({
      conversations: [{ id: 'wa-thread' }],
      count: 1,
    });
    expect(builder.getRawMany).toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('reads wa_* while the switch is off, and has no bot page threads to show', async () => {
    const { svc, manager } = service({
      sharedStoreWrites: true,
      dashboardReadsFrom: 'wa',
    });
    expect((await svc.listConversations({})).count).toBe(1);
    expect(await svc.listConversations({ channel: 'web' })).toEqual({
      conversations: [],
      count: 0,
    });
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('reads the shared store when switched on', async () => {
    const { svc, builder, manager } = service({
      sharedStoreWrites: true,
      dashboardReadsFrom: 'shared',
    });
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }]);
    await svc.listConversations({});
    expect(builder.getRawMany).not.toHaveBeenCalled();
    expect(manager.query.mock.calls[0][0]).toContain(
      'FROM chatbot_conversations c',
    );
  });

  it('keeps bot page questions out of the WhatsApp queue', async () => {
    const { svc, builder } = service({ sharedStoreWrites: false });
    await svc.listUnanswered({});
    expect(builder.where.mock.calls[0][0]).toBe(
      notWebQuestionSql('q.conversation_id'),
    );
  });

  it('labels a visitor by masked email, or as a visitor', () => {
    expect(visitorLabel('asha@example.com')).toBe('a***@example.com');
    expect(visitorLabel(null)).toBe('Visitor');
  });
});
