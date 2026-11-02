import { DebriefNotifier } from '../service/debrief-notifier.service';

function build(
  sessionRow: Record<string, unknown> | null = {
    user_id: 7,
    tenant_id: 't1',
    title: 'Exam stress',
  },
) {
  const inApp = { create: jest.fn(async () => ({})) };
  const push = { sendDataMessage: jest.fn(async () => undefined) };
  const tokens = { getTokensForUser: jest.fn(async () => ['tok']) };
  const svc = new DebriefNotifier(
    { query: jest.fn(async () => (sessionRow ? [sessionRow] : [])) } as any,
    inApp as any,
    push as any,
    tokens as any,
  );
  return { svc, inApp, push };
}

const run = (language: string) =>
  ({ id: 'r1', scenarioSessionId: 's1', language }) as any;

describe('DebriefNotifier (FR-28, FR-31)', () => {
  it('tells the learner their debrief is ready, in its language, linking to the session', async () => {
    const { svc, inApp, push } = build();
    await svc.ready(run('hi-IN'));
    expect(inApp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        type: 'DEBRIEF_READY',
        title: 'आपकी डीब्रीफ़ तैयार है',
        body: 'Exam stress के लिए आपकी डीब्रीफ़ तैयार है।',
        data: { screen: 'SimulationFeedback', scenarioSessionId: 's1' },
      }),
    );
    expect(push.sendDataMessage).toHaveBeenCalledWith(
      ['tok'],
      expect.objectContaining({
        type: 'DEBRIEF_READY',
        data: { scenarioSessionId: 's1' },
      }),
    );
  });

  it('says Ally updated the debrief after a review, in English for an unknown language', async () => {
    const { svc, inApp } = build();
    await svc.reviewed(run('ml-IN'));
    expect(inApp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DEBRIEF_REVIEWED',
        body: 'Ally updated your debrief for Exam stress after a review.',
      }),
    );
  });

  it('never throws, and sends nothing for a session it cannot find', async () => {
    const { svc, inApp } = build(null);
    await expect(svc.ready(run('en'))).resolves.toBeUndefined();
    expect(inApp.create).not.toHaveBeenCalled();
    const failing = build();
    failing.inApp.create.mockRejectedValue(new Error('db down'));
    await expect(failing.svc.ready(run('en'))).resolves.toBeUndefined();
  });
});
