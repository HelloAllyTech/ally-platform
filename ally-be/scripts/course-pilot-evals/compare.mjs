#!/usr/bin/env node
// Compare Course Pilot eval runs side by side.
//   node scripts/course-pilot-evals/compare.mjs <a.json> [b.json]
import { readFileSync } from 'node:fs';

const runs = process.argv
  .slice(2)
  .map((file) => JSON.parse(readFileSync(file, 'utf8')));
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-');

function summary(run) {
  const r = run.results.filter((x) => !x.error || x.turns);
  const sum = (f) => r.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  const gatesAll = r.filter(
    (x) => x.gates && Object.values(x.gates).every(Boolean),
  ).length;
  const fid = (key) => {
    const scored = r.filter((x) => x.fidelity && x.fidelity[key] !== null);
    return pct(scored.filter((x) => x.fidelity[key]).length, scored.length);
  };
  return {
    runs: run.results.length,
    reachedBlueprint: pct(
      r.filter((x) => x.reachedBlueprint).length,
      run.results.length,
    ),
    avgQuestions: (sum((x) => x.questions) / r.length).toFixed(1),
    maxQuestions: Math.max(...r.map((x) => x.questions ?? 0)),
    avgInterviewQs: (
      sum((x) => x.interviewQuestions ?? x.questions) / r.length
    ).toFixed(1),
    avgConfirmCards: (sum((x) => x.confirmations) / r.length).toFixed(1),
    forcedConfirms: r.filter((x) => x.forcedConfirm).length,
    avgOutcomeQs: (
      sum((x) => x.questionsByStage?.['brief.outcomes'] ?? 0) / r.length
    ).toFixed(1),
    oneVariantPerLang: pct(
      r.filter((x) => x.oneVariantPerLanguage !== false).length,
      r.length,
    ),
    avgMinutes: (sum((x) => x.seconds) / r.length / 60).toFixed(1),
    avgSpendUsd: (sum((x) => x.spentUsd) / r.length).toFixed(2),
    briefComplete: pct(gatesAll, r.length),
    skillTargetsAB: pct(
      r.filter((x) => x.gates?.skillTargetsAB).length,
      r.length,
    ),
    learnerProfile: pct(
      r.filter((x) => x.gates?.learnerProfile).length,
      r.length,
    ),
    rightDuration: fid('duration'),
    rightLanguages: fid('languages'),
    rightAssessment: fid('assessment'),
    planBlockingIssues: (() => {
      const j = r.filter((x) => x.judge && !x.judge.error);
      return j.length
        ? (j.reduce((a, x) => a + x.judge.blocking, 0) / j.length).toFixed(1)
        : '-';
    })(),
    plansWithNoBlocking: (() => {
      const j = r.filter((x) => x.judge && !x.judge.error);
      return pct(j.filter((x) => x.judge.blocking === 0).length, j.length);
    })(),
    minutesOff20pct: r.filter((x) =>
      x.judge?.issues?.some((i) => i.criterion === 'minutes'),
    ).length,
    criticRepaired: r.filter((x) => x.critic?.repaired).length,
    repliesSentBack: sum((x) => x.notDelivered),
    refusedTools: sum((x) => x.refusedTools),
    errors: run.results.filter((x) => x.error).length,
  };
}

const sums = runs.map(summary);
const keys = Object.keys(sums[0]);
const width = 18;
console.log(
  'metric'.padEnd(width) + runs.map((r) => r.label.padStart(16)).join(''),
);
for (const key of keys) {
  console.log(
    key.padEnd(width) + sums.map((s) => String(s[key]).padStart(16)).join(''),
  );
}

console.log('\nPer brief (questions / complete / blueprint):');
const ids = [...new Set(runs.flatMap((r) => r.results.map((x) => x.id)))];
for (const id of ids) {
  const cells = runs.map((run) => {
    const x = run.results.find((y) => y.id === id);
    if (!x) return '-';
    const complete =
      x.gates && Object.values(x.gates).every(Boolean) ? 'full' : 'gaps';
    return `${x.questions ?? '?'}q ${complete} ${x.reachedBlueprint ? 'BP' : 'no-BP'}`;
  });
  console.log(id.padEnd(26) + cells.map((c) => c.padStart(18)).join(''));
}
