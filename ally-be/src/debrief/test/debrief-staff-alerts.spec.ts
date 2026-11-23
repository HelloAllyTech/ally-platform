import { DebriefNotifier } from '../service/debrief-notifier.service';

describe('owner and Ally team notifications (FR-54)', () => {
  it('tells every owner in-app, never the person who acted, and never throws', async () => {
    const dataSource = {
      query: jest.fn(async () => [
        { id: 1, tenant_id: 't' },
        { id: 2, tenant_id: 't' },
      ]),
    };
    const inApp = { create: jest.fn(async () => ({})) };
    const n = new DebriefNotifier(
      dataSource as any,
      inApp as any,
      {} as any,
      {} as any,
    );
    const sent = await n.owner({
      title: 'Debriefs: v7 is live',
      body: 'Promoted',
      data: { ideaId: 'i1' },
      excludeUserId: 2,
    });
    expect(sent).toBe(1);
    expect(inApp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        type: 'DEBRIEF_OWNER_ALERT',
        data: { screen: 'DebriefConsole', ideaId: 'i1' },
      }),
    );
    expect((dataSource.query.mock.calls[0] as unknown[])[1]).toEqual([
      'manage:admin:debrief-settings',
    ]);
    dataSource.query.mockRejectedValueOnce(new Error('db down'));
    await expect(n.team({ title: 'x', body: 'y' })).resolves.toBe(0);
  });
});
