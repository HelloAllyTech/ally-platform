import axios from 'axios';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  DebriefLanguageJudgeService,
  inLanguageSample,
} from '../service/debrief-language-judge.service';
import {
  EXPERIENCE_TARGETS,
  metricFailurePoints,
} from '../util/debrief-metric-failures.util';
import { DEBRIEF_REPORTING_VIEWS } from '../service/debrief-reporting.service';
import {
  citedTurns,
  languageSections,
} from '../util/debrief-language-sections.util';
import { isEnglishLanguage } from '../util/debrief-language-sections.util';
import {
  languageProblem,
  passRollup,
  RolledRun,
} from '../util/debrief-outcome.util';
import {
  JudgeAttemptFamily,
  JudgeAttemptOutcome,
} from '../../analytics/constants/judge-scheduling.constants';

jest.mock('axios');
const post = axios.post as jest.Mock;

const CARDS: any = {
  opening: 'आपने बहुत अच्छा किया।',
  important_moment: null,
  what_worked: [
    {
      skill: 's',
      turn_index: 2,
      quote: 'मुझे डर लगता है',
      lead: 'सुना',
      body: 'अच्छा',
    },
  ],
  work_on_this: [
    {
      skill: 's',
      turn_index: 4,
      quote: 'ठीक है',
      lead: 'अगली बार',
      why: 'भावना का नाम लें',
      try_saying: 'आप डरे हुए लग रहे हैं',
    },
  ],
  practise_next: null,
  skill_words: [{ skill: 's', word: 'strength' }],
  skill_labels: [{ skill: 's', label: 'सक्रिय श्रवण' }],
  reflective_question: 'आपने क्या महसूस किया?',
};
const TRANSCRIPT = [
  { turn_index: 1, role: 'counselor', text: 'क्या हुआ?' },
  { turn_index: 2, role: 'client', text: 'मुझे डर लगता है' },
  { turn_index: 3, role: 'counselor', text: 'बताइए' },
  { turn_index: 4, role: 'client', text: 'ठीक है' },
];

describe('the language check reads only what the learner reads', () => {
  it('builds one section per visible block and nothing else', () => {
    const s = languageSections(CARDS);
    expect(s.map((x) => x.section)).toEqual([
      'opening',
      'what_worked',
      'work_on_this',
      'skill_names',
      'reflective_question',
    ]);
    const all = s.map((x) => x.text).join('\n');
    expect(all).not.toContain('strength');
    expect(all).toContain('सक्रिय श्रवण');
  });

  it('sends only the turns the cards cite', () => {
    expect(
      citedTurns(CARDS, TRANSCRIPT as any).map((t) => t.turn_index),
    ).toEqual([2, 4]);
  });
});

describe('DebriefLanguageJudgeService', () => {
  function build(
    opts: { existing?: any; rate?: unknown; allowed?: string[] } = {},
  ) {
    const stored: any[] = opts.existing ? [opts.existing] : [];
    const judgments = {
      findOne: jest.fn(async () => stored[0] ?? null),
    };
    const dataSource: any = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT INTO debrief_language_judgments')) {
          const force = sql.includes('DO UPDATE');
          if (stored.length && !force) return [];
          stored[0] = {
            runId: params[0],
            judgeModel: params[2],
            judgePromptVersion: params[3],
            findings: JSON.parse(params[4] as string),
            findingCount: params[5],
            types: params[6],
          };
          return [];
        }
        if (sql.includes('FROM languages')) {
          return [
            {
              label: 'Hindi (India)',
              cfg: {
                targetVariety: 'colloquial spoken Hindi',
                diglossia: true,
                codeSwitchPartners: ['English'],
              },
            },
          ];
        }
        if (sql.includes('FROM debrief_runs r')) return [{ id: 'r1' }];
        throw new Error(`unexpected SQL: ${sql}`);
      }),
      getRepository: () => ({
        createQueryBuilder: () => ({
          whereInIds: () => ({
            orderBy: () => ({ getMany: async () => [run()] }),
          }),
        }),
      }),
    };
    const attempts = {
      recordFailure: jest.fn(async () => undefined),
      clear: jest.fn(async () => undefined),
    };
    const context = {
      transcript: jest.fn(async () => TRANSCRIPT),
      promptText: jest.fn(async () => 'PINNED RUBRIC'),
      providerAllowlist: jest.fn(
        async () => opts.allowed ?? ['gemini', 'openai'],
      ),
    };
    const svc = new DebriefLanguageJudgeService(
      judgments as any,
      dataSource,
      context as any,
      { ai: { apiUrl: 'http://ai', outboundApiKey: 'k' } } as any,
      attempts as any,
      {
        getGa: jest.fn(async () => ({
          bundle: {
            settings:
              opts.rate === undefined
                ? {}
                : { languageJudgeSampleRate: opts.rate },
          },
        })),
      } as any,
    );
    return { svc, stored, attempts, dataSource, context, judgments };
  }
  const run = (over: Record<string, unknown> = {}) =>
    ({
      id: 'r1',
      tenantId: 't',
      scenarioSessionId: 's1',
      language: 'hi-IN',
      cards: CARDS,
      ...over,
    }) as any;
  const answer = (findings: unknown[] = [], answered = true) => ({
    data: {
      judge_model: 'gpt-5-mini',
      judge_prompt_version: 'v1',
      answered,
      findings,
    },
  });
  const finding = (t = 'wrong_language') => ({
    section: 'opening',
    error_type: t,
    evidence_quote: 'x',
    note: 'n',
  });

  beforeEach(() => post.mockReset());

  it('sends the organisation’s allowed providers, and a skipped answer stores nothing and is not an error', async () => {
    const { svc, stored, attempts, context } = build({ allowed: ['gemini'] });
    post.mockResolvedValueOnce({
      data: {
        judge_model: 'gpt-5-mini',
        judge_prompt_version: 'v2',
        answered: false,
        skipped: 'provider_not_allowed',
        findings: [],
      },
    });
    expect(await svc.judge(run())).toBeNull();
    expect(context.providerAllowlist).toHaveBeenCalledWith('t');
    expect(post.mock.calls[0][1].allowed_providers).toEqual(['gemini']);
    expect(stored).toHaveLength(0);
    expect(attempts.recordFailure).toHaveBeenCalledWith(
      expect.anything(),
      'r1',
      't',
      expect.anything(),
      'not checked: provider_not_allowed',
    );
  });

  it('sends visible text, language facts, pinned rubric and cited turns; stores findings and types', async () => {
    const { svc, stored, attempts } = build();
    post.mockResolvedValueOnce(
      answer([
        finding('wrong_language'),
        finding('script_mix'),
        finding('wrong_language'),
      ]),
    );
    const row = await svc.judge(run());
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('http://ai/api/v1/debrief-language/judge');
    expect(body.language).toBe('hi-IN');
    expect(body.language_config).toMatchObject({
      language_label: 'Hindi (India)',
      diglossia: true,
      code_switch_partners: ['English'],
    });
    expect(body.rubric).toBe('PINNED RUBRIC');
    expect(body.quoted_turns).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('strength');
    expect(stored[0].findingCount).toBe(3);
    expect(stored[0].types.sort()).toEqual(['script_mix', 'wrong_language']);
    expect(stored[0].judgeModel).toBe('gpt-5-mini');
    expect(row).toBeTruthy();
    expect(attempts.clear).toHaveBeenCalledWith(
      JudgeAttemptFamily.DEBRIEF_LANGUAGE,
      'r1',
    );
  });

  it('drops a finding type outside the closed list', async () => {
    const { svc, stored } = build();
    post.mockResolvedValueOnce(
      answer([finding('made_up'), finding('quote_altered')]),
    );
    await svc.judge(run());
    expect(stored[0].findingCount).toBe(1);
    expect(stored[0].types).toEqual(['quote_altered']);
  });

  it('an empty list of findings is a stored clean result', async () => {
    const { svc, stored } = build();
    post.mockResolvedValueOnce(answer([]));
    await svc.judge(run());
    expect(stored[0].findingCount).toBe(0);
  });

  it('is idempotent: a run that already has a result is not judged again', async () => {
    const { svc } = build({
      existing: { runId: 'r1', judgePromptVersion: 'v1' },
    });
    const row = await svc.judge(run());
    expect(post).not.toHaveBeenCalled();
    expect(row).toMatchObject({ runId: 'r1' });
  });

  it('a deliberate re-judge replaces the single row', async () => {
    const { svc, stored } = build({
      existing: { runId: 'r1', judgePromptVersion: 'v0', findingCount: 5 },
    });
    post.mockResolvedValueOnce(answer([finding()]));
    await svc.judge(run(), { force: true });
    expect(stored).toHaveLength(1);
    expect(stored[0].judgePromptVersion).toBe('v1');
    expect(stored[0].findingCount).toBe(1);
  });

  it('no usable answer is counted on the ledger and stores nothing', async () => {
    const { svc, stored, attempts } = build();
    post.mockResolvedValueOnce(answer([], false));
    expect(await svc.judge(run())).toBeNull();
    expect(stored).toHaveLength(0);
    expect(attempts.recordFailure).toHaveBeenCalledWith(
      JudgeAttemptFamily.DEBRIEF_LANGUAGE,
      'r1',
      't',
      JudgeAttemptOutcome.EMPTY,
      expect.any(String),
    );
  });

  it('drain never throws: a failing call is recorded and the drain goes on', async () => {
    const { svc, attempts } = build();
    post.mockRejectedValueOnce(new Error('503'));
    await expect(svc.drain(5)).resolves.toBe(0);
    expect(attempts.recordFailure).toHaveBeenCalledWith(
      JudgeAttemptFamily.DEBRIEF_LANGUAGE,
      'r1',
      't',
      JudgeAttemptOutcome.FAILED,
      expect.any(Error),
    );
  });

  it('reads the rate from the live release, defaults to 1, and the drain query carries it', async () => {
    const dflt = build();
    expect(await dflt.svc.sampleRate()).toBe(1);
    expect(await build({ rate: 0.25 }).svc.sampleRate()).toBe(0.25);
    expect(await build({ rate: 7 }).svc.sampleRate()).toBe(1);
    const half = build({ rate: 0.5 });
    post.mockResolvedValueOnce({
      data: {
        judge_model: 'm',
        judge_prompt_version: 'v1',
        answered: true,
        findings: [],
      },
    });
    await half.svc.drain(5);
    const call = half.dataSource.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('FROM debrief_runs r'),
    );
    expect(String(call[0])).toContain('md5(r.id::text)');
    expect(call[1]).toContain(0.5);
  });

  it('drain asks only for runs with cards, no result yet, past the ledger gate', async () => {
    const { svc, dataSource } = build();
    post.mockResolvedValueOnce(answer([]));
    await svc.drain(5);
    const sql: string = dataSource.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('FROM debrief_runs r'),
    )[0];
    expect(sql).toContain('r.cards IS NOT NULL');
    expect(sql).toContain("r.mode <> 'replay'");
    expect(sql).toContain(
      'NOT EXISTS (SELECT 1 FROM debrief_language_judgments',
    );
    expect(sql).toContain('judge_attempts');
  });

  it('never checks English: not in the drain query, and not when judged directly', async () => {
    const { svc, dataSource } = build();
    await svc.drain(5);
    const sql: string = dataSource.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('FROM debrief_runs r'),
    )[0];
    expect(sql).toContain("!~* '^en([-_]|$)'");
    for (const language of ['en', 'en-IN', 'en_US', null]) {
      post.mockClear();
      expect(await svc.judge(run({ language }))).toBeNull();
      expect(post).not.toHaveBeenCalled();
    }
    expect(isEnglishLanguage('hi-IN')).toBe(false);
    expect(isEnglishLanguage('ml-IN')).toBe(false);
  });

  it('a deliberate re-judge still runs on English', async () => {
    const { svc } = build();
    post.mockResolvedValueOnce(answer([]));
    expect(
      await svc.judge(run({ language: 'en-IN' }), { force: true }),
    ).not.toBeNull();
  });
});

describe('the language problem rollup', () => {
  const r = (check: RolledRun['languageCheck']): RolledRun =>
    ({
      week: 'w',
      language: 'hi-IN',
      status: 'published',
      languageCheck: check,
    }) as any;

  it('gives English no language-check figures, even for rows checked before English was left out', () => {
    const en = {
      ...r({ findingCount: 1, types: ['meaning_drift'] }),
      language: 'en-IN',
    };
    const rows = passRollup([en as any, r(null)]).byLanguage;
    const english = rows.find((x) => x.language === 'en-IN')!;
    const hindi = rows.find((x) => x.language === 'hi-IN')!;
    expect(english.languageProblem.checked).toBe(0);
    expect(english.languageProblem.notChecked).toBe(0);
    expect(hindi.languageProblem.notChecked).toBe(1);
  });

  it('counts the share with a finding among checked debriefs, and each type once per debrief', () => {
    const g = languageProblem([
      r({ findingCount: 2, types: ['wrong_language', 'wrong_language'] }),
      r({ findingCount: 1, types: ['script_mix'] }),
      r({ findingCount: 0, types: [] }),
      r({ findingCount: 0, types: [] }),
      r(null),
    ]);
    expect(g.checked).toBe(4);
    expect(g.notChecked).toBe(1);
    expect(g.withFinding).toMatchObject({ n: 2, of: 4, value: 0.5 });
    expect(g.byType).toEqual({ wrong_language: 1, script_mix: 1 });
  });

  it('has no rate, not zero, when nothing is checked', () => {
    const g = languageProblem([r(null)]);
    expect(g.withFinding.value).toBeNull();
    expect(g.checked).toBe(0);
  });

  describe('the sample rate', () => {
    it('is deterministic by run id, and its share tracks the rate', () => {
      const ids = Array.from({ length: 2000 }, (_, i) => `run-${i}`);
      const a = ids.filter((id) => inLanguageSample(id, 0.3));
      expect(a).toEqual(ids.filter((id) => inLanguageSample(id, 0.3)));
      expect(a.length / ids.length).toBeGreaterThan(0.25);
      expect(a.length / ids.length).toBeLessThan(0.35);
      expect(ids.every((id) => inLanguageSample(id, 1))).toBe(true);
      expect(ids.some((id) => inLanguageSample(id, 0))).toBe(false);
    });

    it('a run in a smaller sample is in every larger one', () => {
      for (let i = 0; i < 500; i++) {
        if (inLanguageSample(`r${i}`, 0.2)) {
          expect(inLanguageSample(`r${i}`, 0.5)).toBe(true);
        }
      }
    });
  });
});

describe('the language check is never on the learner’s path', () => {
  const dir = join(__dirname, '..');
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)],
    );
  const src = files(dir).filter(
    (f) =>
      f.endsWith('.ts') && !f.includes('/test/') && !f.endsWith('.spec.ts'),
  );

  it('only the judge drain and its own service mention it among the debrief services', () => {
    const users = src
      .filter((f) =>
        /DebriefLanguageJudgeService|debrief-language-judge\.service/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => f.slice(dir.length + 1))
      .sort();
    expect(users).toEqual([
      'debrief.module.ts',
      'service/debrief-language-judge.service.ts',
      'service/debrief-run-judge.service.ts',
    ]);
  });

  it('the runner and the publish path never call the run judge directly or the language check', () => {
    for (const f of [
      'service/debrief-runner.service.ts',
      'service/debrief-publish.service.ts',
    ]) {
      let text = '';
      try {
        text = readFileSync(join(dir, f), 'utf8');
      } catch {
        continue;
      }
      expect(text).not.toMatch(/language-judge|LanguageJudge/);
    }
  });
});

describe('the PM agent reads language findings only as counts', () => {
  it('has two redacted views, with no quote or learner text column', () => {
    const checks = DEBRIEF_REPORTING_VIEWS['debrief_reporting.language_checks'];
    const found =
      DEBRIEF_REPORTING_VIEWS['debrief_reporting.language_findings'];
    expect(checks).toContain('finding_count');
    expect(found).toContain('error_type');
    expect(found).toContain('section');
    expect(found).toContain('no quote');
    expect(`${checks} ${found}`).not.toMatch(/evidence|debrief_text/);
  });

  it('the migration view selects no evidence quote or note', () => {
    const m = readFileSync(
      join(
        dir2(),
        'database/migrations/1984700000000-CreateDebriefLanguageJudgments.ts',
      ),
      'utf8',
    );
    const views = m.slice(
      m.indexOf('CREATE OR REPLACE VIEW'),
      m.indexOf('The drain records'),
    );
    expect(views).not.toMatch(/evidence_quote|->>'note'/);
    expect(views).toContain("f->>'error_type'");
  });
});

function dir2() {
  return join(__dirname, '../..');
}

describe('the language failure point', () => {
  const rate = (n: number, of: number) => ({
    value: of ? n / of : null,
    n,
    of,
    low: null,
    high: null,
  });
  const view = (byLanguage: any[]) =>
    ({
      series: [
        {
          week: 'w',
          debriefs: 30,
          steering: { value: null },
          guardrails: {
            judgeP50: null,
            judged: 0,
            hardFailRate: rate(0, 0),
            fabricatedQuotes: 0,
            thumbsDownRate: rate(0, 0),
            costP50: null,
            visibleSecondsP50: null,
          },
          efficiency: { revisionRoundsP50: null },
          experience: Object.fromEntries(
            Object.keys(EXPERIENCE_TARGETS).map((k) => [k, rate(0, 0)]),
          ),
        },
      ],
      byLanguage: [],
      byPlatform: [],
      baselines: {
        legacyHardFailRate: rate(0, 0),
        legacyThumbsDownRate: rate(0, 0),
      },
      agents: { stages: {} },
      quality: { byLanguage },
    }) as any;
  const lp = (language: string, n: number, of: number) => ({
    language,
    languageProblem: { checked: of, withFinding: rate(n, of) },
  });

  it('flags a language above 20% once 20 debriefs are checked, by language', () => {
    const pts = metricFailurePoints(
      view([lp('hi-IN', 8, 25), lp('ta-IN', 4, 25)]),
    );
    const lang = pts.filter((p) => p.kind === 'language_off_target');
    expect(lang.map((p) => p.segment).sort()).toEqual([
      'all',
      'language=hi-IN',
    ]);
    expect(lang[0]).toMatchObject({
      name: 'language_issue_rate',
      target: '<= 0.2',
    });
  });

  it('does not flag a thin sample, however bad', () => {
    const pts = metricFailurePoints(view([lp('mr-IN', 5, 5)]));
    expect(pts.filter((p) => p.kind === 'language_off_target')).toEqual([]);
  });
});
