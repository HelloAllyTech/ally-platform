import { PlanNotificationKind } from '../../enum/product-planning.enum';
import { PlanNotificationService } from '../plan-notification.service';

/** Roadmap v2 dual-write: the old table behaves as before, and the inbox gets the notice too. */
describe('PlanNotificationService', () => {
  const build = (unread: unknown = null) => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(unread),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockResolvedValue({}),
      create: jest.fn((row) => row),
    };
    const inbox = { fromPlanNotification: jest.fn().mockResolvedValue([]) };
    const service = new PlanNotificationService(
      repository as never,
      inbox as never,
    );
    return { service, repository, inbox };
  };

  it('saves a new notice and dual-writes it', async () => {
    const { service, repository, inbox } = build();
    await service.notify(4, 's1', PlanNotificationKind.TAKEN_ON, 'Taken on.');
    expect(repository.save).toHaveBeenCalledWith({
      recipientUserId: 4,
      sessionId: 's1',
      kind: PlanNotificationKind.TAKEN_ON,
      message: 'Taken on.',
    });
    expect(inbox.fromPlanNotification).toHaveBeenCalledWith(
      4,
      's1',
      PlanNotificationKind.TAKEN_ON,
      'Taken on.',
    );
  });

  it('refreshes an unread notice instead of repeating it, and still dual-writes', async () => {
    const { service, repository, inbox } = build({ id: 'n1' });
    await service.notify(4, 's1', PlanNotificationKind.NUDGE, 'Again.');
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'n1' },
      { message: 'Again.' },
    );
    expect(repository.save).not.toHaveBeenCalled();
    expect(inbox.fromPlanNotification).toHaveBeenCalled();
  });

  it('tells nobody when there is no recipient', async () => {
    const { service, repository, inbox } = build();
    await service.notify(null, 's1', PlanNotificationKind.NUDGE, 'x');
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(inbox.fromPlanNotification).not.toHaveBeenCalled();
  });

  it('works without the inbox (fixtures)', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue({}),
      create: jest.fn((row) => row),
    };
    const service = new PlanNotificationService(repository as never);
    await expect(
      service.notify(4, 's1', PlanNotificationKind.NUDGE, 'x'),
    ).resolves.toBeUndefined();
  });
});
