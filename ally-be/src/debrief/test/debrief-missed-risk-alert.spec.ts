import { DebriefAgentService } from '../service/debrief-agent.service';

/** The Slack post for a missed risk cue is a courtesy on top of the durable urgent review. */
describe('the missed-risk-cue post', () => {
  const build = (post: jest.Mock | undefined) => {
    const svc = Object.create(DebriefAgentService.prototype) as any;
    Object.assign(svc, {
      slack: post ? { missedRiskCue: post } : undefined,
      logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
    });
    return svc;
  };

  it('a failed post is logged at error, says the sweep will retry, and throws nothing', async () => {
    const svc = build(
      jest.fn(async () => {
        throw new Error('slack down');
      }),
    );
    expect(() => svc.postMissedRiskCue({ id: 'run-1' })).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(svc.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('run run-1'),
    );
    expect(svc.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('the safety sweep will try again: slack down'),
    );
  });

  it('a post that works, or no Slack at all, logs nothing', async () => {
    const ok = build(jest.fn(async () => true));
    ok.postMissedRiskCue({ id: 'run-1' });
    const none = build(undefined);
    none.postMissedRiskCue({ id: 'run-1' });
    await new Promise((r) => setImmediate(r));
    expect(ok.logger.error).not.toHaveBeenCalled();
    expect(none.logger.error).not.toHaveBeenCalled();
  });
});
