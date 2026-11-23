#!/usr/bin/env node
/**
 * Like-for-like comparison of two use-case runs (Q4, asked 23 Nov): the same assistants as the
 * baseline, side by side, with in-data answers right per template (x of runs per question) and
 * how many replies a hand-over replaced. Assistants the baseline has no replies for (not published
 * then) are reported on their own, as a new baseline.
 *
 *   node evals/usecases/compare.mjs --before 2026-11-22-baseline-1-regraded --after 2026-11-23-after-B-1
 *
 * Writes results/compare-<before>-vs-<after>.md and prints it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const beforeLabel = arg('before');
const afterLabel = arg('after');
if (!beforeLabel || !afterLabel) {
  console.error('usage: compare.mjs --before <label> --after <label>');
  process.exit(2);
}
const load = (label) => JSON.parse(fs.readFileSync(path.join(here, 'results', `${label}.json`), 'utf8'));
const assistants = new Map(
  JSON.parse(fs.readFileSync(path.join(here, 'assistants.json'), 'utf8')).assistants.map((a) => [a.key, a]),
);

/** The line a hand-over adds (handover.ts, EN/HI/Hinglish), at the start of a reply = it replaced the answer. */
export const HANDOVER_FIRST =
  /^\s*(I'?ve asked the team to join|The team isn'?t available right now|मैंने टीम से|टीम अभी उपलब्ध नहीं|Maine team ko|Team abhi available nahi)/i;

export function handoverReplaced(turn) {
  return turn.handledBy === 'handover' && HANDOVER_FIRST.test(turn.reply ?? '');
}

/** Per set: its cases over every run, and the numbers the comparison reads. */
export function summarise(result) {
  const bySet = new Map();
  for (const r of result.results) {
    if (!r.cases?.length) continue;
    const s = bySet.get(r.set) ?? { set: r.set, assistant: r.assistant, runs: 0, cases: [] };
    s.runs += 1;
    s.cases.push(...r.cases);
    bySet.set(r.set, s);
  }
  for (const s of bySet.values()) {
    const count = (v) => s.cases.filter((c) => c.verdict === v).length;
    s.pass = count('PASS');
    s.partial = count('PARTIAL');
    s.fail = count('FAIL');
    const facts = s.cases.filter((c) => c.kind === 'fact');
    s.factQuestions = new Set(facts.map((c) => c.id)).size;
    s.factRight = facts.filter((c) => c.verdict === 'PASS').length;
    s.factTotal = facts.length;
    const risk = s.cases.filter((c) => c.kind === 'at_risk');
    s.riskRight = risk.filter((c) => !c.turns.some((t) => (t.hard ?? []).includes('crisis missed'))).length;
    s.riskTotal = risk.length;
    s.replaced = s.cases.flatMap((c) => c.turns ?? []).filter(handoverReplaced).length;
    s.hard = s.cases.filter((c) => c.turns.some((t) => (t.hard ?? []).length)).length;
  }
  return bySet;
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '–');
const right = (s) => (s ? `${s.factRight}/${s.factTotal} (${pct(s.factRight, s.factTotal)})` : '–');
const verdicts = (s) => (s ? `${s.pass} · ${s.partial} · ${s.fail}` : '–');
const templateOf = (s) => assistants.get(s.assistant)?.template ?? assistants.get(s.set)?.template ?? 'live page';
const nameOf = (s) => {
  const a = assistants.get(s.assistant) ?? assistants.get(s.set);
  if (!a) return s.set;
  // A set of its own on an assistant (the RHA live-page messages on O5).
  return s.set !== a.key ? `${a.code} ${a.name}: ${s.set} set` : `${a.code} ${a.name}`;
};

const before = summarise(load(beforeLabel));
const after = summarise(load(afterLabel));
const same = [...before.keys()].filter((k) => after.has(k));
const fresh = [...after.keys()].filter((k) => !before.has(k));
const runsOf = (m) => Math.max(0, ...[...m.values()].map((s) => s.runs));

const total = (m, keys, f) => keys.reduce((n, k) => n + f(m.get(k)), 0);
const lines = [
  `# Like for like: ${beforeLabel} → ${afterLabel}`,
  '',
  `The ${same.length} assistants with replies in both runs. Before: ${runsOf(before)} run(s); after: ${runsOf(after)} run(s). In-data right counts each in-data question once per run (x of questions × runs).`,
  '',
  '| | Before | After |',
  '|---|---|---|',
  `| PASS · PARTIAL · FAIL | ${total(before, same, (s) => s.pass)} · ${total(before, same, (s) => s.partial)} · ${total(before, same, (s) => s.fail)} | ${total(after, same, (s) => s.pass)} · ${total(after, same, (s) => s.partial)} · ${total(after, same, (s) => s.fail)} |`,
  `| In-data right | ${total(before, same, (s) => s.factRight)}/${total(before, same, (s) => s.factTotal)} (${pct(total(before, same, (s) => s.factRight), total(before, same, (s) => s.factTotal))}) | ${total(after, same, (s) => s.factRight)}/${total(after, same, (s) => s.factTotal)} (${pct(total(after, same, (s) => s.factRight), total(after, same, (s) => s.factTotal))}) |`,
  `| Emergencies right | ${total(before, same, (s) => s.riskRight)}/${total(before, same, (s) => s.riskTotal)} | ${total(after, same, (s) => s.riskRight)}/${total(after, same, (s) => s.riskTotal)} |`,
  `| Conversations with a hard fail | ${total(before, same, (s) => s.hard)} | ${total(after, same, (s) => s.hard)} |`,
  `| Answers a hand-over replaced | ${total(before, same, (s) => s.replaced)} | ${total(after, same, (s) => s.replaced)} |`,
  '',
  '## Per assistant',
  '',
  '| Assistant | Template | PASS · PARTIAL · FAIL before | after | In-data right before | after | Emergencies before | after | Hand-over replaced before | after |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...same.map((k) => {
    const b = before.get(k);
    const a = after.get(k);
    return `| ${nameOf(b)} | ${templateOf(b)} | ${verdicts(b)} | ${verdicts(a)} | ${right(b)} | ${right(a)} | ${b.riskRight}/${b.riskTotal} | ${a.riskRight}/${a.riskTotal} | ${b.replaced} | ${a.replaced} |`;
  }),
  '',
  '## In-data right per template',
  '',
  '| Template | Assistants | Before | After |',
  '|---|---|---|---|',
];
const templates = new Map();
for (const k of same) {
  const t = templateOf(before.get(k));
  templates.set(t, [...(templates.get(t) ?? []), k]);
}
for (const [t, keys] of templates) {
  const b = [total(before, keys, (s) => s.factRight), total(before, keys, (s) => s.factTotal)];
  const a = [total(after, keys, (s) => s.factRight), total(after, keys, (s) => s.factTotal)];
  lines.push(`| ${t} | ${keys.map((k) => nameOf(before.get(k))).join(', ')} | ${b[0]}/${b[1]} (${pct(...b)}) | ${a[0]}/${a[1]} (${pct(...a)}) |`);
}
if (fresh.length) {
  lines.push(
    '',
    '## New baselines (no replies in the before run)',
    '',
    '| Assistant | Template | PASS · PARTIAL · FAIL | In-data right | Emergencies right | Hand-over replaced |',
    '|---|---|---|---|---|---|',
    ...fresh.map((k) => {
      const s = after.get(k);
      return `| ${nameOf(s)} | ${templateOf(s)} | ${verdicts(s)} | ${right(s)} | ${s.riskRight}/${s.riskTotal} | ${s.replaced} |`;
    }),
  );
}
const out = lines.join('\n') + '\n';
fs.writeFileSync(path.join(here, 'results', `compare-${beforeLabel}-vs-${afterLabel}.md`), out);
process.stdout.write(out);
