#!/usr/bin/env node
/**
 * Course Pilot phase 4C measurement: re-runs the post-build reviewer on courses Course Copilot
 * built locally, exactly as the COURSE_REVIEW job reads them, WITHOUT posting into the chat, and
 * compares with the review each course got at build time.
 *
 * Reports per course: must-fix findings before/now, how many mention trigger warnings, and how
 * many of those point at a roleplay that already has one (a false finding).
 *
 *   node scripts/course-pilot-evals/review-eval.mjs [--sessions id,id] [--runs 1] [--label x]
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const beRoot = join(here, '../..');
const require = createRequire(join(beRoot, 'package.json'));
require('tsconfig-paths').register({
  baseUrl: join(beRoot, 'dist'),
  paths: { 'src/*': ['*'] },
});

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const RUNS = Number(flag('runs', 1));
const LABEL = flag(
  'label',
  new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'),
);
const ONLY = flag('sessions', '').split(',').filter(Boolean);

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require(join(beRoot, 'dist/app.module'));
const dist = (p) => require(join(beRoot, 'dist/course-copilot', p));
const { CourseCopilotJobExecutorService } = dist(
  'service/course-copilot-job-executor.service',
);
const { CourseReviewSpecialist } = dist(
  'service/specialists/course-review.specialist',
);
const { CourseCopilotStructureService } = dist(
  'service/course-copilot-structure.service',
);
const { CourseCopilotSessionRepository } = dist(
  'repository/course-copilot.repository',
);

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
const executor = app.get(CourseCopilotJobExecutorService);
const reviewer = app.get(CourseReviewSpecialist);
const structure = app.get(CourseCopilotStructureService);
const sessions = app.get(CourseCopilotSessionRepository);
const db = sessions.manager;

const sessionIds = ONLY.length
  ? ONLY
  : (
      await db.query(`
        select distinct m."sessionId" from course_copilot_messages m
        join course_copilot_sessions s on s.id = m."sessionId" and s."trackId" is not null
        where m.metadata ? 'reviewNotes'`)
    ).map((r) => r.sessionId);

const TW = /trigger[\s-]?warning/i;
const CUT = /truncat|cut off|mid-sentence|incomplete text/i;

/** Item ids whose roleplay already carries a trigger warning. */
async function itemsWithWarnings(trackId) {
  const rows = await db.query(
    `select ti.id from track_items ti
     where ti."trackId" = $1 and ti."deletedAt" is null and ti."scenarioId" is not null
       and exists (select 1 from scenario_trigger_warnings tw where tw."scenarioId" = ti."scenarioId")`,
    [trackId],
  );
  return new Set(rows.map((r) => r.id));
}

function tally(findings, warned) {
  const fix = findings.filter((f) => f.severity === 'fix');
  const tw = fix.filter((f) => TW.test(f.note));
  const falseTw = tw.filter((f) => {
    const id = f.itemId ?? f.suggestedAction?.input?.itemId;
    return id && warned.has(id);
  });
  return {
    fix: fix.length,
    triggerWarning: tw.length,
    falseTriggerWarning: falseTw.length,
    truncated: fix.filter((f) => CUT.test(f.note)).length,
  };
}

const results = [];
async function one(sessionId) {
  const session = await sessions.findOne({ where: { id: sessionId } });
  if (!session?.trackId) return;
  const [stored] = await db.query(
    `select metadata->'reviewNotes'->'findings' as findings from course_copilot_messages
     where "sessionId" = $1 and metadata ? 'reviewNotes' order by "createdAt" desc limit 1`,
    [sessionId],
  );
  let track;
  try {
    track = await structure.getTrack(session.trackId);
  } catch (error) {
    console.log(`${sessionId} skipped: ${error.message}`);
    return;
  }
  const warned = await itemsWithWarnings(session.trackId);
  const roleplays = await executor.roleplaysForReview(track);
  const guidance = executor.designGuidance
    ? await executor.designGuidance.referenceWithCodes({
        sessionId,
        tenantId: session.tenantId,
        brief: session.brief ?? {},
        stage: 'review',
      })
    : { text: '' };
  const before = tally(stored?.findings ?? [], warned);
  const now = [];
  for (let run = 0; run < RUNS; run++) {
    let findings;
    try {
      findings = await reviewer.review({
        sessionId,
        brief: session.brief ?? {},
        courseDigest: executor.courseDigest(track, roleplays),
        referenceMaterial: guidance.text || null,
        usageMetadata: {
          courseCopilotSessionId: sessionId,
          eval: 'review-eval',
        },
      });
    } catch (error) {
      // The build retries a failed review job; here a broken run is just not counted.
      console.log(`${sessionId} run ${run + 1} failed: ${error.message}`);
      continue;
    }
    now.push({ ...tally(findings, warned), findings });
  }
  const line = now.map(
    (n) =>
      `${n.fix} fix / ${n.triggerWarning} tw (${n.falseTriggerWarning} false)`,
  );
  console.log(
    `${track.title.slice(0, 44).padEnd(44)} | warned roleplays ${warned.size} | before ${before.fix} fix / ` +
      `${before.triggerWarning} tw (${before.falseTriggerWarning} false) | now ${line.join(' ; ')}`,
  );
  if (now.length) {
    results.push({
      sessionId,
      title: track.title,
      warnedRoleplays: warned.size,
      before,
      now,
    });
  }
}
const queue = [...sessionIds];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (queue.length) await one(queue.shift());
  }),
);
await app.close();

const sum = (pick) => results.reduce((n, r) => n + pick(r), 0);
const summary = {
  label: LABEL,
  courses: results.length,
  runs: RUNS,
  before: {
    fix: sum((r) => r.before.fix),
    triggerWarning: sum((r) => r.before.triggerWarning),
    falseTriggerWarning: sum((r) => r.before.falseTriggerWarning),
    truncated: sum((r) => r.before.truncated),
  },
  nowPerRun: {
    fix: sum((r) => r.now.reduce((n, x) => n + x.fix, 0) / r.now.length),
    triggerWarning: sum(
      (r) => r.now.reduce((n, x) => n + x.triggerWarning, 0) / r.now.length,
    ),
    falseTriggerWarning: sum(
      (r) =>
        r.now.reduce((n, x) => n + x.falseTriggerWarning, 0) / r.now.length,
    ),
    truncated: sum(
      (r) => r.now.reduce((n, x) => n + x.truncated, 0) / r.now.length,
    ),
  },
};
console.log('\n' + JSON.stringify(summary, null, 2));
const out = join(homedir(), 'workspace/ally/course-pilot-evals');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, `review-eval-${LABEL}.json`),
  JSON.stringify({ summary, results }, null, 2),
);
console.log(`Saved ${join(out, `review-eval-${LABEL}.json`)}`);
process.exit(0);
