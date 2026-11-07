import {
  FAILURES_TO_OPEN,
  OPEN_MS,
  WINDOW_MS,
  isModelCircuitOpen,
  modelsToTry,
  recordModelFailure,
  recordModelSuccess,
  resetModelCircuits,
} from '../util/model-circuit';

describe('model circuit breaker', () => {
  beforeEach(() => resetModelCircuits());

  it('tries the model first, then its backup, while the model is healthy', () => {
    expect(modelsToTry('claude-sonnet-5-5', 'gemini-2.5-flash')).toEqual([
      'claude-sonnet-5-5',
      'gemini-2.5-flash',
    ]);
  });

  it('opens after repeated failures and sends steps to the backup first', () => {
    const t = 1_000_000;
    for (let i = 0; i < FAILURES_TO_OPEN; i++) recordModelFailure('m', t + i);
    expect(isModelCircuitOpen('m', t + 10)).toBe(true);
    expect(modelsToTry('m', 'backup', t + 10)).toEqual(['backup', 'm']);
  });

  it('does not open on failures spread wider than the window', () => {
    for (let i = 0; i < FAILURES_TO_OPEN; i++) {
      recordModelFailure('m', i * (WINDOW_MS / 2));
    }
    expect(isModelCircuitOpen('m', FAILURES_TO_OPEN * WINDOW_MS)).toBe(false);
  });

  it('half-opens after the cool-down, and a success closes it', () => {
    for (let i = 0; i < FAILURES_TO_OPEN; i++) recordModelFailure('m', i);
    expect(isModelCircuitOpen('m', OPEN_MS + 10)).toBe(false);
    for (let i = 0; i < FAILURES_TO_OPEN; i++) recordModelFailure('n', i);
    recordModelSuccess('n');
    expect(isModelCircuitOpen('n', 20)).toBe(false);
  });

  it('with no backup, keeps trying the model itself', () => {
    for (let i = 0; i < FAILURES_TO_OPEN; i++) recordModelFailure('m', i);
    expect(modelsToTry('m', null, 10)).toEqual(['m', 'm']);
  });
});
