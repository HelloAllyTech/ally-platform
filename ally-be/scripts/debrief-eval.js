// Paired eval of the Debrief agent on a test set built from real sessions (plan §9.5).
//
// Every case runs twice as a REPLAY (never shown to a learner, not counted in the production
// budget): once as GA, once with one change. Both are scored by the same graders the agent
// already has, so nothing here re-implements a check:
//   - the rule checks (quotes verbatim, structure, language, risk cue covered, …), blocking only;
//   - the independent judge's hard fails (fabricated quote, missed risk cue, diagnoses trainee,
//     wrong language, contradicts protocol, unsupported progress claim).
// A case passes when the debrief is ready to publish with no blocking check failure and no
// judge hard fail — "right" is written down once, for every case, by those graders.
// Guidance retrieval is graded on its own (the finder, separately from the writer).
//
// Sets: `open` is the dev set (read outputs, settle graders); `gate` is the test set (report
// only). `sealed` is never used here. Sessions from v2v tests (metadata.v2vTest) are excluded.
//
// Usage, from a built ally-be (inside the prod container for prod numbers):
//   node scripts/debrief-eval.js --set gate --limit 200 --change no_guidance --out /tmp/eval
//     [--concurrency 3] [--rejudge 30]
// "Passes" is `debriefOutcome` (src/debrief/util/debrief-outcome.util.ts), the same definition
// the Console's live metrics use.
// Writes <out>/cases.jsonl (one line per case and arm: ids, codes, booleans — no transcript or
// debrief text) plus eval_stats.py inputs <out>/{ga,change}.jsonl, and prints a summary.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const req = (p) => require(path.join(ROOT, p));

/**
 * The changes this script can test against GA. Add one here; it is only ever a run option,
 * built once before the first case.
 *   no_guidance  GA with guidance lookups off.
 *   draft        the newest DRAFT release (e.g. code defaults changed by a deploy), plus any
 *                `--prompt <code>=<file>` overrides — how a change is tested before it is promoted.
 */
const CHANGES = {
  no_guidance: async () => ({
    settingOverrides: { guidancePassagesPerMoment: 0 },
  }),
  ga: async () => ({}),
  draft: async ({ ds, opt }) => {
    const [row] = await ds.query(
      `SELECT id FROM agent_releases WHERE "agentKey" = 'debrief' AND status = 'draft'
        ORDER BY version DESC LIMIT 1`,
    );
    if (!row) throw new Error('no draft debrief release to test');
    const release = await ds
      .getRepository('AgentRelease')
      .findOne({ where: { id: row.id } });
    return {
      release,
      promptOverrides: Object.keys(opt.prompts).length
        ? opt.prompts
        : undefined,
    };
  },
};

const SETS = { open: 'debrief_open', gate: 'debrief_gate' };

function args() {
  const a = process.argv.slice(2);
  const get = (k, d) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? a[i + 1] : d;
  };
  const set = get('set');
  if (!SETS[set]) throw new Error('--set open|gate');
  const change = get('change', 'no_guidance');
  if (!CHANGES[change])
    throw new Error(`--change ${Object.keys(CHANGES).join('|')}`);
  return {
    set,
    change,
    limit: Number(get('limit', 30)),
    out: get('out', `/tmp/debrief-eval-${set}`),
    concurrency: Number(get('concurrency', 3)),
    rejudge: Number(get('rejudge', 0)),
    // --prompt <code>=<file>, repeatable: a prompt's text for the change arm only.
    prompts: Object.fromEntries(
      a
        .flatMap((x, i) => (x === '--prompt' ? [a[i + 1]] : []))
        .map((kv) => {
          const [code, file] = kv.split('=');
          return [code, fs.readFileSync(file, 'utf8')];
        }),
    ),
  };
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

(async () => {
  const opt = args();
  fs.mkdirSync(opt.out, { recursive: true });
  const { NestFactory } = req('node_modules/@nestjs/core');
  const { DataSource } = req('node_modules/typeorm');
  const { AppModule } = req('dist/app.module');
  const { DebriefRunnerService } = req(
    'dist/debrief/service/debrief-runner.service',
  );
  const { DebriefRunJudgeService } = req(
    'dist/debrief/service/debrief-run-judge.service',
  );
  const { DebriefContextRepository } = req(
    'dist/debrief/service/debrief-context.repository',
  );
  // The one definition of a passing debrief, shared with stored runs and live metrics.
  const { debriefOutcome, writerModelOf, judgeVersionOf } = req(
    'dist/debrief/util/debrief-outcome.util',
  );
  const { DebriefRunMode, DebriefRunArm } = req(
    'dist/debrief/enum/debrief-run.enum',
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const ds = app.get(DataSource);
  const runner = app.get(DebriefRunnerService);
  const judge = app.get(DebriefRunJudgeService);
  const context = app.get(DebriefContextRepository);
  const changeOpts = await CHANGES[opt.change]({ ds, opt });
  if (changeOpts.release)
    console.log(`change arm runs release v${changeOpts.release.version}`);

  const cases = await ds.query(
    `SELECT c.id AS case_id, c.category, c.input->>'scenarioSessionId' AS session_id
       FROM agent_eval_cases c
       JOIN agent_eval_suites su ON su.id = c."suiteId"
       JOIN scenario_sessions s ON s.id = (c.input->>'scenarioSessionId')::uuid
      WHERE su."agentKey" = 'debrief' AND su.key = $1 AND c.status = 'active'
        AND COALESCE((s.metadata->>'v2vTest')::boolean, false) = false
      ORDER BY c."contentHash"
      LIMIT $2`,
    [SETS[opt.set], opt.limit],
  );
  console.log(
    `${cases.length} ${opt.set} cases (v2v excluded), change: ${opt.change}`,
  );

  const chunkMeta = async (ids) =>
    ids.length
      ? ds.query(
          `SELECT id::text, code, facets->>'kind' AS kind, facets->'level' AS level,
                  COALESCE((attributes->>'clinical')::boolean, false) AS clinical
             FROM cl_chunks WHERE id::text = ANY($1)`,
          [ids],
        )
      : [];

  const grade = async (c, armName, run, level) => {
    if (run.cards) await judge.judge(run).catch(() => null); // stores workspace.judge
    const o = debriefOutcome(run);
    const passages = await chunkMeta(
      (run.workspace && run.workspace.passages) || [],
    );
    const lvl = String(level || '').toLowerCase();
    const j = (run.workspace && run.workspace.judge) || null;
    return {
      id: c.session_id,
      caseId: c.case_id,
      category: c.category,
      arm: armName,
      run: run.id,
      releaseId: run.releaseId,
      status: run.status,
      outcome: o,
      skipped: o.skipped,
      ready: o.ready,
      pass: o.pass,
      infra: o.outage,
      checks: o.blocking,
      hardFails: o.hardFails,
      judgeOverall: j && j.overall != null ? Number(j.overall) : null,
      judgeVersion: judgeVersionOf(run),
      writerModel: writerModelOf(run),
      riskCue: run.hasRiskCue,
      distress: run.learnerDistress,
      level: lvl,
      learnerTurns: run.learnerTurns,
      language: run.language,
      cost: Number(run.estimatedCostUsd || 0),
      revisions: run.revisionRounds,
      guidance: passages.map((p) => p.code),
      clinicalOnNonRisk: run.hasRiskCue
        ? 0
        : passages.filter((p) => p.clinical).length,
      levelMismatch: passages.filter(
        (p) =>
          p.kind === 'level_guide' &&
          Array.isArray(p.level) &&
          lvl &&
          !p.level.includes(lvl),
      ).length,
    };
  };

  const rows = [];
  const line = (r) => {
    rows.push(r);
    fs.appendFileSync(
      path.join(opt.out, 'cases.jsonl'),
      JSON.stringify(r) + '\n',
    );
  };
  fs.writeFileSync(path.join(opt.out, 'cases.jsonl'), '');

  await pool(cases, opt.concurrency, async (c) => {
    const session = await context.loadSession(c.session_id).catch(() => null);
    const level = session && session.learnerLevel;
    const arm = async (name, armEnum, extra) => {
      try {
        const run = await runner.run(c.session_id, {
          mode: DebriefRunMode.REPLAY,
          arm: armEnum,
          ...extra,
        });
        return await grade(c, name, run, level);
      } catch (e) {
        return {
          id: c.session_id,
          caseId: c.case_id,
          category: c.category,
          arm: name,
          crash: e.message.slice(0, 200),
          pass: false,
          ready: false,
        };
      }
    };
    const [ga, ch] = await Promise.all([
      arm('ga', DebriefRunArm.BASELINE, {}),
      arm(opt.change, DebriefRunArm.CHALLENGER, changeOpts),
    ]);
    line(ga);
    line(ch);

    console.log(
      `${c.session_id.slice(0, 8)} ${c.category}  ga:${ga.pass ? 'pass' : 'FAIL ' + [...(ga.checks || []), ...(ga.hardFails || []), ga.crash || (ga.ready ? '' : ga.status)].join(',')}` +
        `  ${opt.change}:${ch.pass ? 'pass' : 'FAIL ' + [...(ch.checks || []), ...(ch.hardFails || []), ch.crash || (ch.ready ? '' : ch.status)].join(',')}`,
    );
  });

  // Grader stability: judge the same GA debriefs again without storing, count verdict flips.
  if (opt.rejudge > 0) {
    const sample = rows
      .filter((r) => r.arm === 'ga' && r.run && r.ready)
      .slice(0, opt.rejudge);
    const flips = [];
    for (const r of sample) {
      const run = await ds
        .getRepository('DebriefRun')
        .findOne({ where: { id: r.run } });
      const again = await judge.judge(run, { store: false }).catch(() => null);
      if (!again) continue;
      const hf = again.hardFails.map((h) => h.code);
      flips.push({
        id: r.id,
        first: r.hardFails.length === 0,
        second: hf.length === 0,
        firstCodes: r.hardFails,
        secondCodes: hf,
      });
    }
    fs.writeFileSync(
      path.join(opt.out, 'rejudge.jsonl'),
      flips.map((f) => JSON.stringify(f)).join('\n') + '\n',
    );
    console.log(
      `re-judged ${flips.length}: hard-fail verdict flipped on ${flips.filter((f) => f.first !== f.second).length}`,
    );
  }

  // eval_stats inputs: cases skipped by both arms (too short to debrief) are out of the denominator.
  const byId = {};
  for (const r of rows) (byId[r.id] = byId[r.id] || {})[r.arm] = r;
  const both = Object.values(byId).filter(
    // The shared definition: a skipped or not-yet-judged run has no verdict (pass null) and
    // leaves the pair out of the denominator rather than counting as a failure.
    (p) =>
      p.ga &&
      p[opt.change] &&
      p.ga.pass !== null &&
      p[opt.change].pass !== null,
  );
  const write = (name, arm) =>
    fs.writeFileSync(
      path.join(opt.out, `${name}.jsonl`),
      both
        .map((p) => JSON.stringify({ id: p.ga.id, pass: !!p[arm].pass }))
        .join('\n') + '\n',
    );
  write('ga', 'ga');
  write('change', opt.change);
  // The same pair with outages taken out (cases where either arm hit one).
  const quality = both.filter(
    (p) =>
      !p.ga.infra &&
      !p[opt.change].infra &&
      !p.ga.crash &&
      !p[opt.change].crash,
  );
  for (const [name, arm] of [
    ['ga_quality', 'ga'],
    ['change_quality', opt.change],
  ]) {
    fs.writeFileSync(
      path.join(opt.out, `${name}.jsonl`),
      quality
        .map((p) => JSON.stringify({ id: p.ga.id, pass: !!p[arm].pass }))
        .join('\n') + '\n',
    );
  }
  const rate = (arm) => both.filter((p) => p[arm].pass).length;
  const cost = rows.reduce((s, r) => s + (r.cost || 0), 0);
  console.log(
    `done: ${both.length} paired cases; pass ga ${rate('ga')}/${both.length}, ${opt.change} ${rate(opt.change)}/${both.length}; ` +
      `left out (skipped or unjudged) ${Object.keys(byId).length - both.length}; spend $${cost.toFixed(2)} (+ judge)`,
  );
  await app.close();
  process.exit(0);
})().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
