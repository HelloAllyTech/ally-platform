import { ExecutionManager } from '../../../common/execution/execution-manager';
import { InboxController } from '../../inbox/inbox.controller';

/** Stage 8: an Ally staff read of a chat never marks it read (owners' "nobody opened it" email). */
describe('Inbox thread under a staff view', () => {
  const BOT = '00000000-0000-4000-8000-000000000001';
  const CONV = '00000000-0000-4000-8000-00000000000c';
  const make = (staffView: boolean) => {
    const inbox = {
      thread: jest.fn(async () => ({ id: CONV, messages: [] })),
      markRead: jest.fn(),
      list: jest.fn(async () => []),
      counts: jest.fn(async () => ({ unread: 0, needsPerson: 0, safety: 0 })),
    };
    const events = { publishInbox: jest.fn() };
    const access = {
      assertCan: jest.fn(async () => ({ roles: [] })),
      isStaffView: jest.fn(() => staffView),
      staffListScope: jest.fn(async () => (staffView ? [BOT] : undefined)),
    };
    const controller = new InboxController(
      inbox as never,
      {} as never,
      events as never,
      access as never,
      { query: jest.fn(async () => []) } as never,
    );
    return { controller, inbox, events, access };
  };
  const run = <T>(fn: () => Promise<T>) =>
    ExecutionManager.runWithContext(
      async () => {
        ExecutionManager.setAuthContext('50', 't');
        return fn();
      },
      { path: '/' },
    );

  it('a member opening a chat marks it read', async () => {
    const { controller, inbox, events } = make(false);
    await run(() => controller.thread(BOT, CONV));
    expect(inbox.markRead).toHaveBeenCalledWith(BOT, CONV);
    expect(events.publishInbox).toHaveBeenCalled();
  });

  it('a staff view returns the chat and marks nothing read', async () => {
    const { controller, inbox, events } = make(true);
    await expect(
      run(() => controller.thread(BOT, CONV)),
    ).resolves.toMatchObject({ id: CONV });
    expect(inbox.markRead).not.toHaveBeenCalled();
    expect(events.publishInbox).not.toHaveBeenCalled();
  });

  it('the list and counts pass the staff scope through', async () => {
    const { controller, inbox } = make(true);
    await run(() => controller.list({ chatbotId: BOT }));
    expect(inbox.list).toHaveBeenCalledWith({ chatbotId: BOT }, [BOT]);
    await run(() => controller.counts({ chatbotId: BOT }));
    // TF1 round 2: the counts are held to the assistant asked about, as the list is.
    expect(inbox.counts).toHaveBeenCalledWith([BOT], BOT);
  });
});
