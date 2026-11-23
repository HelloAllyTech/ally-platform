import { ConflictException } from '@nestjs/common';
import { CRISIS_SUITE_VERSION, evaluateGoLive } from '../go-live-gate';
import { GoLiveGateService } from '../go-live-gate.service';
import { GoLiveBackfillService } from '../go-live-backfill.service';
import type { ChatbotSafetyState } from '../safety-state.service';
import { SAFETY_TERMS_VERSION } from '../safety-terms';

const pass = (passed = 8) => ({
  status: 'pass' as const,
  suiteVersion: CRISIS_SUITE_VERSION,
  checkedAt: '2026-11-23T00:00:00Z',
  passed,
  total: 8,
  failedCases: [],
});
const fail = (turnedOffAt: string | null = null) => ({
  status: 'fail' as const,
  suiteVersion: CRISIS_SUITE_VERSION,
  checkedAt: '2026-11-23T00:00:00Z',
  passed: 6,
  total: 8,
  failedCases: ['ta-explicit-1'],
  turnedOffAt,
});

const state = (over: Partial<ChatbotSafetyState> = {}): ChatbotSafetyState => ({
  chatbotId: 'bot-1',
  termsVersion: SAFETY_TERMS_VERSION,
  termsAcceptedAt: new Date('2026-11-23T00:00:00Z'),
  termsAcceptedBy: 1,
  languageCrisisStatus: { en: pass() },
  pausedByGateAt: null,
  pausedByGateReason: null,
  ...over,
});

const ready = {
  purpose: 'answer',
  settings: {
    audienceAge: 'adults',
    humanContact: { email: 'team@example.com' },
    enabledLanguages: ['en'],
  },
  persona: { defaultLanguage: 'en' },
};

const evaluate = (chatbot = ready, s = state()) =>
  evaluateGoLive({ chatbot, state: s, enforced: true });

describe('the go-live gate (stage 4)', () => {
  it('passes when every item is done', () => {
    const check = evaluate();
    expect(check.ok).toBe(true);
    expect(check.missing).toEqual([]);
    expect(check.liveLanguages).toEqual(['en']);
  });

  it.each([
    [
      'audience_age',
      { ...ready, settings: { ...ready.settings, audienceAge: 'unstated' } },
      state(),
    ],
    [
      'human_contact',
      {
        ...ready,
        settings: { ...ready.settings, humanContact: { phone: '123' } },
      },
      state(),
    ],
    ['purpose', { ...ready, purpose: '' }, state()],
    ['safety_terms', ready, state({ termsVersion: '2020-01-01' })],
    [
      'safety_terms',
      ready,
      state({ termsAcceptedAt: null, termsVersion: null }),
    ],
    ['crisis_check', ready, state({ languageCrisisStatus: {} })],
    [
      'crisis_check',
      ready,
      state({
        languageCrisisStatus: { en: { ...pass(), suiteVersion: 'old' } },
      }),
    ],
  ])('refuses without %s', (item, chatbot, s) => {
    const check = evaluate(chatbot as never, s);
    expect(check.ok).toBe(false);
    expect(check.missing.map((m) => m.item)).toEqual([item]);
    expect(check.missing[0].message).toBeTruthy();
  });

  it('a failing language is off while the others go live', () => {
    const chatbot = {
      ...ready,
      settings: { ...ready.settings, enabledLanguages: ['en', 'hi'] },
    };
    const check = evaluate(
      chatbot,
      state({
        languageCrisisStatus: {
          en: pass(),
          hi: pass(),
          ta: fail('2026-11-23T00:00:00Z'),
        },
      }),
    );
    expect(check.ok).toBe(true);
    expect(check.liveLanguages).toEqual(['en', 'hi']);
    expect(check.languages.find((l) => l.language === 'ta')?.status).toBe(
      'off',
    );
  });

  it('a language with no curated suite can never pass (D5), and an unchecked one holds go-live', () => {
    const chatbot = {
      ...ready,
      settings: { ...ready.settings, enabledLanguages: ['en', 'bn'] },
    };
    const noSuite = evaluate(chatbot, state());
    expect(noSuite.languages.find((l) => l.language === 'bn')?.status).toBe(
      'no_suite',
    );
    expect(noSuite.ok).toBe(true); // bn is simply off; en goes live
    const unchecked = evaluate(
      {
        ...ready,
        settings: { ...ready.settings, enabledLanguages: ['en', 'hi'] },
      },
      state(),
    );
    expect(unchecked.ok).toBe(false);
    expect(unchecked.missing.map((m) => m.item)).toEqual(['crisis_check']);
  });

  it('when every language fails it cannot go live', () => {
    const check = evaluate(
      ready,
      state({ languageCrisisStatus: { en: fail() } }),
    );
    expect(check.ok).toBe(false);
    expect(check.liveLanguages).toEqual([]);
  });
});

describe('GoLiveGateService', () => {
  const service = (
    chatbot: unknown,
    s: ChatbotSafetyState,
    enabled = 'true',
  ) => {
    const dataSource = { query: jest.fn().mockResolvedValue([chatbot]) };
    const safety = {
      get: jest.fn().mockResolvedValue(s),
      clearPausedByGate: jest.fn().mockResolvedValue(undefined),
    };
    const config = { get: jest.fn(() => enabled) };
    return {
      gate: new GoLiveGateService(
        dataSource as never,
        safety as never,
        config as never,
      ),
      safety,
    };
  };

  it('refuses with the missing items, structured for the checklist', async () => {
    const { gate } = service({ ...ready, id: 'bot-1', purpose: null }, state());
    const error = await gate.assertCanGoLive('bot-1').catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      errorCode: 'go_live_incomplete',
      details: { missing: [{ item: 'purpose' }] },
    });
  });

  it('reads the purpose the caller is about to write (publish)', async () => {
    const { gate, safety } = service(
      { ...ready, id: 'bot-1', purpose: null },
      state(),
    );
    await expect(
      gate.assertCanGoLive('bot-1', { purpose: 'answer' }),
    ).resolves.toMatchObject({ ok: true });
    expect(safety.clearPausedByGate).toHaveBeenCalledWith('bot-1');
  });

  it('the kill switch stops enforcing, never the checklist', async () => {
    const { gate } = service(
      { ...ready, id: 'bot-1', purpose: null },
      state(),
      'false',
    );
    const check = await gate.assertCanGoLive('bot-1');
    expect(check).toMatchObject({ ok: false, enforced: false });
  });
});

describe('the unpublish backfill (D10)', () => {
  /** A tiny chatbots table: ids and statuses. */
  const harness = (enabled = 'true') => {
    const status = new Map([
      ['ok-bot', 'live'],
      ['bad-bot', 'live'],
      ['draft-bot', 'draft'],
    ]);
    const marked: string[] = [];
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('SELECT id FROM chatbots')) {
        return [...status]
          .filter(([, s]) => s === 'live')
          .map(([id]) => ({ id }));
      }
      if (sql.includes('UPDATE chatbots SET status')) {
        const id = params[0] as string;
        if (status.get(id) !== 'live') return [[], 0];
        status.set(id, 'paused');
        return [[{ id }], 1];
      }
      return [];
    });
    const dataSource = {
      query,
      transaction: (work: (m: unknown) => unknown) => work({ query }),
    };
    const gate = {
      check: jest.fn(async (id: string) =>
        id === 'bad-bot'
          ? {
              ok: false,
              missing: [{ item: 'safety_terms' }, { item: 'crisis_check' }],
            }
          : { ok: true, missing: [] },
      ),
    };
    const state = {
      markPausedByGate: jest.fn(async (id: string) => {
        marked.push(id);
      }),
    };
    const config = { get: jest.fn(() => enabled) };
    return {
      service: new GoLiveBackfillService(
        dataSource as never,
        gate as never,
        state as never,
        config as never,
      ),
      status,
      marked,
    };
  };

  it('a dry run changes nothing and says what it would pause', async () => {
    const h = harness();
    const report = await h.service.run({ dryRun: true });
    expect(report.paused).toEqual([
      { chatbotId: 'bad-bot', missing: ['safety_terms', 'crisis_check'] },
    ]);
    expect(h.status.get('bad-bot')).toBe('live');
    expect(h.marked).toEqual([]);
  });

  it('pauses only the failing live chatbots, records why, deletes nothing, and is idempotent', async () => {
    const h = harness();
    const first = await h.service.run({ dryRun: false });
    expect(first.paused.map((p) => p.chatbotId)).toEqual(['bad-bot']);
    expect(h.status.get('bad-bot')).toBe('paused');
    expect(h.status.get('ok-bot')).toBe('live');
    expect(h.status.get('draft-bot')).toBe('draft');
    expect(h.marked).toEqual(['bad-bot']);

    const second = await h.service.run({ dryRun: false });
    expect(second.paused).toEqual([]);
    expect(h.marked).toEqual(['bad-bot']);
  });

  it('does nothing while its kill switch is off', async () => {
    const h = harness('false');
    const report = await h.service.run({ dryRun: false });
    expect(report).toMatchObject({ skipped: true, paused: [] });
    expect(h.status.get('bad-bot')).toBe('live');
  });
});
