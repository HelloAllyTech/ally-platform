#!/usr/bin/env node
/**
 * Confirmations asked before each booking, callback or registration is saved (Q4, asked 23 Nov;
 * target exactly 1, H1's one "Shall I…?" and one yes). Counted from a run's stored replies: each
 * assistant reply that asks the person to confirm ("Shall I book…?", "Do you mean Friday 27 Nov?",
 * "Can you confirm…", "क्या मैं…", "Kya main…") between the conversation's start (or its last
 * save) and the turn the save succeeded on.
 *
 *   node evals/usecases/confirmations.mjs --runs 2026-11-22-baseline-1-regraded,2026-11-23-after-C-1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const at = process.argv.indexOf('--runs');
const runs = (at > 0 ? process.argv[at + 1] : '').split(',').filter(Boolean);
if (!runs.length) {
  console.error('usage: confirmations.mjs --runs <label>,<label>');
  process.exit(2);
}

/** The conversations meant to save a booking, callback or registration. */
export const IN_SCOPE = [
  'b1-a01', 'b1-a02', 'b2-a01', 'b2-a02', 'b4-a01', 'b5a-a01', 'b5a-a02', 'b5b-a02', 'b5b-a03',
  'o1-a01', 'o3-a01', 'o3-a02', 'o5-a01', 'o5-a02', 'rha-actions',
];

/** A reply asking the person to confirm something before it's done. */
export const ASKS_TO_CONFIRM =
  /\b(?:shall|should|can|may) i\b[^?]*\?|\bdo you (?:mean|want me)\b[^?]*\?|\bconfirm\b[^?]*\?|\bis that (?:right|correct)\?|क्या मैं[^?]*\?|\bkya (?:main|mai)\b[^?]*\?/i;

const WRITE = /^create_\w+: ok$/;

/** For one conversation: the confirmations asked before each save, or before the end if none. */
export function confirmationsOf(turns) {
  const out = [];
  let asked = 0;
  for (const t of turns) {
    const wrote = (t.steps ?? []).some((s) => WRITE.test(s));
    if (wrote) {
      out.push({ asked, saved: true });
      asked = 0;
    }
    if (ASKS_TO_CONFIRM.test(t.reply ?? '')) asked += 1;
  }
  if (!out.length) out.push({ asked, saved: false });
  return out;
}

const byRun = runs.map((label) => {
  const data = JSON.parse(fs.readFileSync(path.join(here, 'results', `${label}.json`), 'utf8'));
  const cases = new Map();
  for (const r of data.results) for (const c of r.cases ?? []) cases.set(c.id, c);
  return { label, cases };
});

const cell = (c) => {
  if (!c) return 'not run';
  return confirmationsOf(c.turns ?? [])
    .map((x) => (x.saved ? `${x.asked}` : `${x.asked}, not saved`))
    .join(' + ');
};

const lines = [
  `# Confirmations before each save: ${runs.join(' vs ')}`,
  '',
  'Replies that asked the person to confirm, before each booking, callback or registration was saved (target: exactly 1). "Not saved": the conversation ended without the save. rha-actions saves twice, so it has two counts.',
  '',
  `| Conversation | ${runs.join(' | ')} |`,
  `|---|${runs.map(() => '---').join('|')}|`,
  ...IN_SCOPE.map((id) => `| ${id} | ${byRun.map((r) => cell(r.cases.get(id))).join(' | ')} |`),
  '',
];
for (const r of byRun) {
  const all = IN_SCOPE.flatMap((id) => {
    const c = r.cases.get(id);
    return c ? confirmationsOf(c.turns ?? []).map((x) => ({ id, ...x })) : [];
  });
  const saved = all.filter((x) => x.saved);
  const exact = saved.filter((x) => x.asked === 1).length;
  const many = all.filter((x) => x.asked >= 2);
  lines.push(
    `**${r.label}:** ${saved.length} saves, ${exact} with exactly 1 confirmation; ${all.length - saved.length} not saved. Two or more: ${many.length ? many.map((x) => `${x.id} (${x.asked}${x.saved ? '' : ', not saved'})`).join(', ') : 'none'}.`,
    '',
  );
}
const out = lines.join('\n');
fs.writeFileSync(path.join(here, 'results', `confirmations-${runs.join('-vs-')}.md`), out);
process.stdout.write(out);
