import {
  AGENT_RUNTIME_ALERT_WINDOW_MS,
  AGENT_RUNTIME_DEGRADED_TYPE,
  AgentRuntimeAlertThrottle,
} from '../agent-runtime-alert-throttle.service';

/**
 * The "agent runtime degraded" alert fires at most once per bot and reason every 10 minutes, and
 * says how many messages fell back since the last one — so throttling hides the noise, not the count.
 */
describe('AgentRuntimeAlertThrottle', () => {
  const BOT = { id: 'bot-1', name: 'Ally FAQ' };
  const T0 = 1_000_000;
  let throttle: AgentRuntimeAlertThrottle;
  let emit: jest.Mock;

  beforeEach(() => {
    emit = jest.fn();
    throttle = new AgentRuntimeAlertThrottle({ emit } as never);
  });

  it('sends the first fallback, then nothing for the same bot and reason inside the window', () => {
    const first = throttle.take(BOT, 'upstream_404', T0);
    expect(first).toMatchObject({
      type: AGENT_RUNTIME_DEGRADED_TYPE,
      path: 'chatbot/agent-runtime-degraded',
    });
    expect(first?.message).toContain('1 message fell back to v1');
    expect(first?.message).toContain('"Ally FAQ"');
    expect(first?.message).toContain('upstream_404');

    for (const at of [
      T0 + 1,
      T0 + 60_000,
      T0 + AGENT_RUNTIME_ALERT_WINDOW_MS,
    ]) {
      expect(throttle.take(BOT, 'upstream_404', at)).toBeNull();
    }
  });

  it('alerts separately for another reason and for another bot', () => {
    throttle.take(BOT, 'upstream_404', T0);
    expect(throttle.take(BOT, 'timeout', T0 + 1)).not.toBeNull();
    expect(
      throttle.take({ id: 'bot-2', name: 'Other' }, 'upstream_404', T0 + 2),
    ).not.toBeNull();
  });

  it('sends again after the window, counting every message that fell back since', () => {
    throttle.take(BOT, 'upstream_404', T0);
    throttle.take(BOT, 'upstream_404', T0 + 1_000);
    throttle.take(BOT, 'upstream_404', T0 + 2_000);
    throttle.take(BOT, 'upstream_404', T0 + 3_000);

    const next = throttle.take(
      BOT,
      'upstream_404',
      T0 + AGENT_RUNTIME_ALERT_WINDOW_MS + 1,
    );
    // The three suppressed ones plus this one.
    expect(next?.message).toContain('4 messages fell back to v1');
  });

  it('resets the count after each alert', () => {
    throttle.take(BOT, 'upstream_404', T0);
    throttle.take(BOT, 'upstream_404', T0 + 1);
    throttle.take(BOT, 'upstream_404', T0 + AGENT_RUNTIME_ALERT_WINDOW_MS + 1);
    const third = throttle.take(
      BOT,
      'upstream_404',
      T0 + 2 * AGENT_RUNTIME_ALERT_WINDOW_MS + 2,
    );
    expect(third?.message).toContain('1 message fell back to v1');
  });

  it('emits through the exception path when a fallback is announced', () => {
    throttle.onFallback({ chatbot: BOT, reason: 'timeout' });
    throttle.onFallback({ chatbot: BOT, reason: 'timeout' });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'exception',
      expect.objectContaining({ type: AGENT_RUNTIME_DEGRADED_TYPE }),
    );
  });
});
