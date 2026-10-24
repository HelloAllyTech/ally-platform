import {
  HarnessStage,
  HarnessStageError,
  HarnessTurnContext,
  runHarnessStages,
} from '../harness-turn-runner';

const ctx = (): HarnessTurnContext => ({
  turnId: 't1',
  agentKey: 'test',
  timings: [],
});

const stage = (
  name: string,
  run: HarnessStage<HarnessTurnContext>['run'] = () => undefined,
  always = false,
): HarnessStage<HarnessTurnContext> => ({ name, run, always });

describe('runHarnessStages', () => {
  it('runs every stage in order and completes', async () => {
    const order: string[] = [];
    const c = ctx();
    const outcome = await runHarnessStages(c, [
      stage('a', () => void order.push('a')),
      stage('b', () => void order.push('b')),
    ]);

    expect(outcome).toBe('completed');
    expect(order).toEqual(['a', 'b']);
    expect(c.timings.map((t) => [t.stage, t.outcome])).toEqual([
      ['a', 'ok'],
      ['b', 'ok'],
    ]);
  });

  it('stops early on purpose, skipping the rest but running always-stages', async () => {
    const order: string[] = [];
    const c = ctx();
    const outcome = await runHarnessStages(c, [
      stage('admit', () => 'stop'),
      stage('model', () => void order.push('model')),
      stage('unlock', () => void order.push('unlock'), true),
    ]);

    expect(outcome).toBe('stopped');
    expect(c.stoppedAt).toBe('admit');
    expect(order).toEqual(['unlock']);
    expect(c.timings.map((t) => t.outcome)).toEqual([
      'stopped',
      'skipped',
      'ok',
    ]);
  });

  it('fails with the stage error code and still runs cleanup', async () => {
    const order: string[] = [];
    const c = ctx();
    const outcome = await runHarnessStages(c, [
      stage('model', () => {
        throw new HarnessStageError('provider_unavailable', 'all down');
      }),
      stage('emit', () => void order.push('emit')),
      stage('persist', () => void order.push('persist'), true),
    ]);

    expect(outcome).toBe('failed');
    expect(c.failure).toEqual({
      stage: 'model',
      code: 'provider_unavailable',
      message: 'all down',
    });
    expect(order).toEqual(['persist']);
  });

  it('maps an unexpected error to internal_error', async () => {
    const c = ctx();
    await runHarnessStages(c, [
      stage('plan', () => {
        throw new Error('boom');
      }),
    ]);
    expect(c.failure?.code).toBe('internal_error');
  });

  it('keeps the first failure when a cleanup stage also fails', async () => {
    const c = ctx();
    const outcome = await runHarnessStages(c, [
      stage('model', () => {
        throw new HarnessStageError('rate_limited', 'slow down');
      }),
      stage(
        'unlock',
        () => {
          throw new Error('redis gone');
        },
        true,
      ),
    ]);
    expect(outcome).toBe('failed');
    expect(c.failure?.code).toBe('rate_limited');
    expect(c.timings.map((t) => t.outcome)).toEqual(['error', 'error']);
  });

  it('never lets a throwing hook change the outcome', async () => {
    const hookErrors: string[] = [];
    const outcome = await runHarnessStages(
      ctx(),
      [stage('a')],
      [
        {
          before: () => {
            throw new Error('telemetry down');
          },
          after: () => {
            throw new Error('telemetry down');
          },
        },
      ],
      { onHookError: (hook) => hookErrors.push(hook) },
    );
    expect(outcome).toBe('completed');
    expect(hookErrors).toEqual(['before', 'after']);
  });

  it('times each stage with the injected clock', async () => {
    let clock = 100;
    const c = ctx();
    await runHarnessStages(
      c,
      [
        stage('slow', () => {
          clock += 40;
        }),
      ],
      [],
      { now: () => clock },
    );
    expect(c.timings[0]).toMatchObject({
      stage: 'slow',
      startedAt: 100,
      ms: 40,
    });
  });
});
