#!/usr/bin/env node
// Paired eval of the Course Pilot blueprint critic: for each confirmed brief, plan ONCE, then run
// the critic + one repair round on that same plan. The judge scores both, so the only difference
// between "off" and "on" is the critic. Runs against a built ally-be (dist) and the local DB.
//
//   COURSE_PILOT_CRITIC=true node scripts/course-pilot-evals/plan-eval.mjs <results.json> [--concurrency 3]
//
// <results.json> is a run.mjs output; its sessions' saved briefs are the inputs.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeBlueprint } from './judge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const beRoot = join(here, '..', '..');
process.chdir(beRoot);
process.env.COURSE_PILOT_CRITIC = 'true';
const require = createRequire(join(beRoot, 'package.json'));
require('tsconfig-paths').register({
  baseUrl: join(beRoot, 'dist'),
  paths: { 'src/*': ['*'] },
});

const args = process.argv.slice(2);
const resultsFile = args[0];
const concurrency = Number(args[args.indexOf('--concurrency') + 1] || 3);
const withTransfer = args.includes('--transfer');
const withCritic = !args.includes('--no-critic');
const env = Object.fromEntries(
  readFileSync(join(beRoot, '.env'), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^"|"$/g, '')]),
);

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require(join(beRoot, 'dist/app.module'));
const { CourseCopilotBlueprintService } = require(
  join(beRoot, 'dist/course-copilot/service/course-copilot-blueprint.service'),
);
const { BlueprintPlannerSpecialist } = require(
  join(
    beRoot,
    'dist/course-copilot/service/specialists/blueprint-planner.specialist',
  ),
);
const { courseCopilotGameOptions } = require(
  join(beRoot, 'dist/course-copilot/util/course-blueprint.util'),
);
const { CourseCopilotSessionRepository } = require(
  join(beRoot, 'dist/course-copilot/repository/course-copilot.repository'),
);
const { transferProblems } = require(
  join(beRoot, 'dist/course-copilot/util/course-pilot-transfer.util'),
);

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
const blueprints = app.get(CourseCopilotBlueprintService);
const planner = app.get(BlueprintPlannerSpecialist);
const sessions = app.get(CourseCopilotSessionRepository);

const runs = JSON.parse(readFileSync(resultsFile, 'utf8')).results.filter(
  (r) => r.sessionId,
);
const out = [];
const queue = [...runs];

async function one(run) {
  const session = await sessions.findOne({ where: { id: run.sessionId } });
  const brief = session.brief ?? {};
  const guidance = blueprints.designGuidance
    ? await blueprints.designGuidance.referenceWithCodes({
        sessionId: session.id,
        tenantId: session.tenantId,
        brief,
        stage: 'blueprint',
      })
    : { text: '' };
  const input = {
    sessionId: session.id,
    brief,
    libraryPicks: await blueprints.libraryPicks(session),
    games: courseCopilotGameOptions(),
    referenceMaterial:
      (await blueprints.referenceForPlan(session))?.text ?? null,
    designGuidance: guidance.text || null,
    usageMetadata: { courseCopilotSessionId: session.id, eval: 'plan-eval' },
    checkTransfer: withTransfer,
  };
  const t0 = Date.now();
  const planned = await planner.plan(input);
  const t1 = Date.now();
  const checked = withCritic
    ? await blueprints.checkWithCritic(
        session,
        input,
        planned,
        guidance.text || null,
      )
    : { blueprint: planned, report: null };
  const t2 = Date.now();
  const [judgeOff, judgeOn, judgeOffAgain] = await Promise.all([
    judgeBlueprint(env.OPENAI_API_KEY, brief, planned),
    checked.report?.repaired
      ? judgeBlueprint(env.OPENAI_API_KEY, brief, checked.blueprint)
      : null,
    // The same plan judged again: how far the judge agrees with itself.
    judgeBlueprint(env.OPENAI_API_KEY, brief, planned),
  ]);
  return {
    id: run.id,
    sessionId: run.sessionId,
    planSeconds: (t1 - t0) / 1000,
    criticSeconds: (t2 - t1) / 1000,
    critic: checked.report,
    transferProblems: transferProblems(planned, brief).length,
    brief,
    planOff: planned,
    planOn: checked.report?.repaired ? checked.blueprint : null,
    off: judgeOff,
    on: judgeOn ?? judgeOff, // not repaired = the same plan went out
    offAgain: judgeOffAgain,
  };
}

await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const run = queue.shift();
      try {
        const r = await one(run);
        out.push(r);
        console.log(
          `${r.id.padEnd(26)} critic: ${r.critic?.found?.length ?? '-'} found, ${r.critic?.found?.filter((f) => f.severity === 'blocking').length ?? '-'} blocking, repaired=${r.critic?.repaired}` +
            ` | judge blocking off=${r.off?.blocking} on=${r.on?.blocking} | ${r.planSeconds.toFixed(0)}s + ${r.criticSeconds.toFixed(0)}s`,
        );
      } catch (e) {
        console.log(`${run.id}: ERROR ${e instanceof Error ? e.message : e}`);
        out.push({ id: run.id, error: String(e) });
      }
    }
  }),
);

const ok = out.filter((r) => !r.error);
const avg = (f) =>
  (ok.reduce((a, r) => a + (f(r) ?? 0), 0) / ok.length).toFixed(2);
console.log(
  '\nplans:',
  ok.length,
  '| repaired:',
  ok.filter((r) => r.critic?.repaired).length,
);
console.log(
  'judge blocking per plan  off:',
  avg((r) => r.off?.blocking),
  ' on:',
  avg((r) => r.on?.blocking),
);
console.log(
  'plans with no blocking   off:',
  ok.filter((r) => r.off?.blocking === 0).length,
  ' on:',
  ok.filter((r) => r.on?.blocking === 0).length,
);
console.log(
  'critic seconds (avg):',
  avg((r) => r.criticSeconds),
);
console.log(
  'plan seconds (avg):',
  avg((r) => r.planSeconds),
);
console.log(
  'plans meeting B2/B3 transfer (code check):',
  ok.filter((r) => r.transferProblems === 0).length,
  'of',
  ok.length,
);
const failsCrit = (j, c) =>
  (j?.issues ?? []).some((i) => i.severity === 'blocking' && i.criterion === c);
console.log(
  'judge: skill_targets passed on',
  ok.filter((r) => !failsCrit(r.off, 'skill_targets')).length,
  'of',
  ok.length,
  'plans',
);
const fails = (j) =>
  new Set(
    (j?.issues ?? [])
      .filter((i) => i.severity === 'blocking')
      .map((i) => i.criterion),
  );
const agree = ok.filter(
  (r) =>
    JSON.stringify([...fails(r.off)].sort()) ===
    JSON.stringify([...fails(r.offAgain)].sort()),
).length;
console.log(
  'judge agrees with itself on the same plan:',
  agree,
  'of',
  ok.length,
);
const dir = join(homedir(), 'workspace', 'ally', 'course-pilot-evals');
mkdirSync(dir, { recursive: true });
const file = join(
  dir,
  `plan-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
);
writeFileSync(file, JSON.stringify(out, null, 1));
console.log('Wrote', file);
await app.close();
process.exit(0);
