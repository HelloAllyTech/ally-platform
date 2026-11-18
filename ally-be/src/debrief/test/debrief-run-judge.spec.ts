import axios from 'axios';
import {
  DEBRIEF_JUDGE_INSTRUCTIONS_CODE,
  DebriefRunJudgeService,
  JUDGE_CLAIM_STALE_MINUTES,
  RUN_JUDGE_INPUT_VERSION,
} from '../service/debrief-run-judge.service';

jest.mock('axios');

/**
 * The run judge sees the guidance the Writer was given — otherwise a protocol
 * is invisible to it and `contradicts_protocol` can never fire (plan case 17).
 */
describe('the run judge is given the Writer’s guidance', () => {
  const post = axios.post as jest.Mock;

  function build(
    chunks: Array<Record<string, unknown>>,
    prompts: Record<string, string> = {},
  ) {
    const query = jest.fn(async () => [{ id: 'r1' }]);
    const find = jest.fn(async () => chunks);
    const agentLogs = { recordJudge: jest.fn(async () => undefined) };
    const svc = new DebriefRunJudgeService(
      { manager: { getRepository: () => ({ find }) }, query } as any,
      {
        transcript: jest.fn(async () => [
          { turn_index: 0, role: 'client', text: 'hi' },
        ]),
        loadSession: jest.fn(async () => ({
          language: 'en',
          learnerLevel: 'LAY',
        })),
        promptText: jest.fn(async (code: string) => prompts[code] ?? null),
        currentPromptVersions: jest.fn(async () => ({
          [DEBRIEF_JUDGE_INSTRUCTIONS_CODE]: 4,
        })),
      } as any,
      { ai: { apiUrl: 'http://ai', outboundApiKey: 'k' } } as any,
      agentLogs as any,
    );
    return { svc, find, agentLogs, query };
  }

  const run = (passages?: string[]) =>
    ({
      id: 'r1',
      scenarioSessionId: 's1',
      language: 'en',
      cards: {
        lead: 'x',
        what_worked: [],
        work_on_this: [],
        practise_next: null,
      },
      workspace: passages ? { passages } : {},
    }) as any;

  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({
      data: {
        judge_model: 'm',
        judge_prompt_version: 'v3',
        dimensions: [{ dimension: 'accuracy', score: 9 }],
        hard_fails: [],
      },
    });
  });

  it('sends each passage the Writer saw, protocols labelled, in retrieval order', async () => {
    const { svc } = build([
      {
        id: 'b',
        statement: 'Refer weeks of low mood',
        body: 'Always refer.',
        facets: { kind: 'protocol' },
      },
      {
        id: 'a',
        statement: 'Name a missed feeling',
        body: 'Quote it.',
        facets: { kind: 'style_guide' },
      },
    ]);
    const j = await svc.judge(run(['a', 'b']), { store: false });
    const body = post.mock.calls[0][1];
    expect(body.guidance).toBe(
      'Name a missed feeling\nQuote it.\n\nORGANISATION PROTOCOL: Refer weeks of low mood\nAlways refer.',
    );
    expect(j!.promptVersion).toBe(`v3+${RUN_JUDGE_INPUT_VERSION}`);
  });

  it("sends the judge's instructions from the Skills Store with the rubric", async () => {
    const { svc } = build([], {
      debrief_quality_rubric: 'RUBRIC',
      [DEBRIEF_JUDGE_INSTRUCTIONS_CODE]: 'INSTRUCTIONS',
    });
    await svc.judge(run(), { store: false });
    const body = post.mock.calls[0][1];
    expect(body.rubric).toBe('RUBRIC');
    expect(body.judge_instructions).toBe('INSTRUCTIONS');
  });

  it('sends none when the store has none, so ally-ai uses its own text', async () => {
    const { svc } = build([]);
    await svc.judge(run(), { store: false });
    expect(post.mock.calls[0][1].judge_instructions).toBeNull();
  });

  it('sends no guidance when the run used none, without a lookup', async () => {
    const { svc, find } = build([]);
    await svc.judge(run(), { store: false });
    expect(post.mock.calls[0][1].guidance).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });

  it("logs the judge's call against the run when it stores the score (Agent logs)", async () => {
    const log = { input: '{{system_prompt}}\n…', prompt_inlined: true };
    post.mockResolvedValue({
      data: {
        judge_model: 'm',
        judge_prompt_version: 'v3',
        dimensions: [{ dimension: 'accuracy', score: 9 }],
        hard_fails: [],
        log,
      },
    });
    const { svc, agentLogs } = build([], {
      [DEBRIEF_JUDGE_INSTRUCTIONS_CODE]: 'INSTRUCTIONS',
    });
    await svc.judge(run());
    expect(agentLogs.recordJudge).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1' }),
      log,
      { code: DEBRIEF_JUDGE_INSTRUCTIONS_CODE, version: 4 },
      'm',
    );
  });

  it('stores the score, model and prompt version as columns too, for SQL that filters on them', async () => {
    const { svc, query } = build([]);
    const r = run();
    const judgment = await svc.judge(r);
    const store = (query.mock.calls as any[][]).find(([sql]) =>
      String(sql).includes('"judgeOverall" = $3'),
    )!;
    expect(String(store[0])).toContain(
      '"judgeModel" = $4, "judgePromptVersion" = $5',
    );
    expect(store[1][2]).toBe(judgment!.overall);
    expect(store[1][3]).toBe('m');
    expect(store[1][4]).toBe(judgment!.promptVersion);
    // The in-memory run carries them as well, so a later save does not blank them.
    expect(r.judgeModel).toBe('m');
    expect(r.judgeOverall).toBe(
      judgment!.overall == null ? null : String(judgment!.overall),
    );
  });
});

/**
 * Judging a run is exclusive (B2F-1): "Debrief now" judged a run and the
 * every-minute drain judged it again ~20s later, paying twice and overwriting
 * the first score. A fake debrief_runs row stands in for Postgres, applying
 * the same claim/store conditions the SQL does.
 */
describe('judging a run is exclusive', () => {
  const post = axios.post as jest.Mock;

  function fakeRow(workspace: Record<string, any> = {}) {
    const row = { id: 'r1', workspace: { ...workspace } };
    const stale = () => {
      const at = row.workspace.judgeClaimedAt;
      return (
        !at || Date.now() - Date.parse(at) > JUDGE_CLAIM_STALE_MINUTES * 60_000
      );
    };
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("jsonb_build_object('judgeClaimedAt'")) {
        if (row.workspace.judge || !stale()) return [[], 0];
        row.workspace.judgeClaimedAt = new Date().toISOString();
        return [[{ id: row.id }], 1];
      }
      if (sql.includes("jsonb_build_object('judge'")) {
        if (row.workspace.judge) return [[], 0];
        delete row.workspace.judgeClaimedAt;
        row.workspace.judge = JSON.parse(params[1] as string);
        return [[{ id: row.id }], 1];
      }
      if (sql.includes("'judgeFailures'")) {
        row.workspace.judgeFailures = (row.workspace.judgeFailures ?? 0) + 1;
        row.workspace.judgeFailedAt = new Date().toISOString();
        return [[], 0];
      }
      if (sql.includes("workspace - 'judgeClaimedAt'")) {
        delete row.workspace.judgeClaimedAt;
        return [[], 0];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });
    const snapshot = () =>
      ({
        id: row.id,
        scenarioSessionId: 's1',
        mode: 'shadow',
        status: 'PUBLISHED',
        language: 'en',
        cards: {
          lead: 'x',
          what_worked: [],
          work_on_this: [],
          practise_next: null,
        },
        workspace: JSON.parse(JSON.stringify(row.workspace)),
      }) as any;
    const runs = {
      query,
      find: jest.fn(async () => [snapshot()]),
      findOne: jest.fn(async () => snapshot()),
      manager: { getRepository: () => ({ find: jest.fn(async () => []) }) },
    };
    const agentLogs = { recordJudge: jest.fn(async () => undefined) };
    const svc = new DebriefRunJudgeService(
      runs as any,
      {
        transcript: jest.fn(async () => [
          { turn_index: 0, role: 'client', text: 'hi' },
        ]),
        loadSession: jest.fn(async () => ({ language: 'en' })),
        promptText: jest.fn(async () => null),
        currentPromptVersions: jest.fn(async () => ({})),
      } as any,
      { ai: { apiUrl: 'http://ai', outboundApiKey: 'k' } } as any,
      agentLogs as any,
    );
    return { row, svc, snapshot, agentLogs };
  }

  const response = (score: number) => ({
    data: {
      judge_model: 'm',
      judge_prompt_version: 'v3',
      dimensions: [{ dimension: 'accuracy', score }],
      hard_fails: [],
      log: { input: 'x' },
    },
  });

  beforeEach(() => post.mockReset());

  it('"Debrief now" plus the drain gives one judge call and one score', async () => {
    const { row, svc, snapshot, agentLogs } = fakeRow();
    let answer!: (v: unknown) => void;
    post.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    // "Debrief now" starts judging; the drain runs while the call is out.
    const now = svc.judge(snapshot());
    await new Promise((r) => setImmediate(r));
    expect(post).toHaveBeenCalledTimes(1);
    expect(await svc.drain(5)).toBe(0);
    answer(response(8));
    const judged = await now;
    // And a drain after the score is stored finds nothing to judge.
    expect(await svc.drain(5)).toBe(0);

    expect(post).toHaveBeenCalledTimes(1);
    expect(judged?.dimensions).toEqual([{ dimension: 'accuracy', score: 8 }]);
    expect(row.workspace.judge.dimensions[0].score).toBe(8);
    expect(row.workspace.judgeClaimedAt).toBeUndefined();
    expect(agentLogs.recordJudge).toHaveBeenCalledTimes(1);
  });

  it('a run the judge fails on is counted, and the drain stops asking for it until it has backed off', async () => {
    const { row, svc, snapshot } = fakeRow();
    post.mockRejectedValueOnce(new Error('judge unavailable'));
    expect(await svc.drain(5)).toBe(0);
    expect(row.workspace.judgeFailures).toBe(1);
    expect(typeof row.workspace.judgeFailedAt).toBe('string');
    // The query the drain asks with leaves out runs that failed lately, so the newest failing
    // runs cannot keep older ones from being judged.
    const where = (svc as any).runs.find.mock.calls[0][0].where;
    const sql: string = where.workspace.getSql('w');
    expect(sql).toContain("(w ->> 'judgeFailedAt' IS NULL");
    expect(sql).toContain('power(2,');
    expect(sql).toContain("NOT (coalesce(w, '{}'::jsonb) ? 'judge')");
    void snapshot;
  });

  it('a second caller with a stale copy gets the stored score, not a second call', async () => {
    const { svc, snapshot } = fakeRow();
    post.mockResolvedValueOnce(response(7));
    const stale = snapshot();
    await svc.judge(snapshot());
    const again = await svc.judge(stale);
    expect(post).toHaveBeenCalledTimes(1);
    expect(again?.dimensions[0].score).toBe(7);
  });

  it('takes over a claim left by a crashed worker once it is stale', async () => {
    const old = new Date(
      Date.now() - (JUDGE_CLAIM_STALE_MINUTES + 1) * 60_000,
    ).toISOString();
    const { row, svc } = fakeRow({ judgeClaimedAt: old });
    post.mockResolvedValueOnce(response(6));
    expect(await svc.drain(5)).toBe(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(row.workspace.judge.dimensions[0].score).toBe(6);
    expect(row.workspace.judgeClaimedAt).toBeUndefined();
  });

  it('leaves a live claim alone', async () => {
    const { row, svc, snapshot } = fakeRow({
      judgeClaimedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await svc.drain(5)).toBe(0);
    expect(await svc.judge(snapshot())).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(row.workspace.judge).toBeUndefined();
  });

  it('frees the claim when the judge call fails, so the next drain retries', async () => {
    const { row, svc, snapshot } = fakeRow();
    post.mockRejectedValueOnce(new Error('503'));
    await expect(svc.judge(snapshot())).rejects.toThrow('503');
    expect(row.workspace.judgeClaimedAt).toBeUndefined();
    post.mockResolvedValueOnce(response(9));
    expect(await svc.drain(5)).toBe(1);
    expect(row.workspace.judge.dimensions[0].score).toBe(9);
  });

  it('re-judging without storing (baseline) neither claims nor writes', async () => {
    const { row, svc, snapshot } = fakeRow({
      judge: { overall: 5, dimensions: [] },
    });
    post.mockResolvedValueOnce(response(4));
    const j = await svc.judge(snapshot(), { store: false });
    expect(j?.dimensions[0].score).toBe(4);
    expect(row.workspace.judge.overall).toBe(5);
  });
});

describe('the judge drain reaches older unscored runs', () => {
  it('asks only for runs with no score, so scored newer runs cannot starve older ones', async () => {
    const find = jest.fn(async () => []);
    const svc = Object.create(DebriefRunJudgeService.prototype) as any;
    Object.assign(svc, { runs: { find } });
    await svc.drain(5);
    const where = (find.mock.calls[0] as any)[0].where;
    expect(where.workspace).toBeDefined();
    // Starts with the no-score condition (the backoff clause follows it).
    expect(where.workspace.getSql('w')).toMatch(
      /^NOT \(coalesce\(w, '\{\}'::jsonb\) \? 'judge'\)/,
    );
  });
});

describe('the judge drain’s pending-runs filter', () => {
  it('leaves a space, comma or parenthesis after every use of the column, so TypeORM quotes it', async () => {
    const { judgePendingSql } =
      await import('../service/debrief-run-judge.service');
    const sql = judgePendingSql('__COLUMN__');
    expect(sql.match(/__COLUMN__/g)?.length).toBeGreaterThan(0);
    // TypeORM only rewrites the column name when whitespace, a comma or ")" follows it.
    expect(sql).not.toMatch(/__COLUMN__(?![\s,)])/);
  });
});
