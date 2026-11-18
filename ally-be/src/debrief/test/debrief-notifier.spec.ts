import { DebriefNotifier } from '../service/debrief-notifier.service';

describe('DebriefNotifier.ready', () => {
  function setup() {
    const dataSource = {
      query: jest.fn(async () => [
        { user_id: 5, tenant_id: 't1', title: 'Exam stress' },
      ]),
    };
    const inApp = { create: jest.fn(async () => undefined) };
    const push = { sendDataMessage: jest.fn(async () => undefined) };
    const tokens = { getTokensForUser: jest.fn(async () => ['tok']) };
    const svc = new DebriefNotifier(
      dataSource as any,
      inApp as any,
      push as any,
      tokens as any,
    );
    return { svc, inApp, push };
  }
  const run = (cards: unknown, language = 'en') =>
    ({
      id: 'r1',
      scenarioSessionId: 's1',
      language,
      cards,
    }) as any;

  it('says a debrief is ready', async () => {
    const { svc, inApp } = setup();
    await svc.ready(run({ opening: 'x' }));
    expect(inApp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DEBRIEF_READY',
        body: 'Your debrief for Exam stress is ready.',
      }),
    );
  });

  it('names the progress card when the debrief has one, same screen', async () => {
    const { svc, inApp, push } = setup();
    await svc.ready(run({ opening: 'x', progress_card: { sessions: 5 } }));
    expect(inApp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DEBRIEF_READY',
        body: 'See how your last 5 sessions add up, in your debrief for Exam stress.',
        data: { screen: 'SimulationFeedback', scenarioSessionId: 's1' },
      }),
    );
    expect(push.sendDataMessage).toHaveBeenCalledWith(
      ['tok'],
      expect.objectContaining({ type: 'DEBRIEF_READY' }),
    );
  });

  it('in the debrief’s language', async () => {
    const { svc, inApp } = setup();
    await svc.ready(run({ progress_card: { sessions: 6 } }, 'hi-IN'));
    expect(inApp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Exam stress की डीब्रीफ़ में देखें कि आपके पिछले 6 सेशन कैसे रहे।',
      }),
    );
  });
});
