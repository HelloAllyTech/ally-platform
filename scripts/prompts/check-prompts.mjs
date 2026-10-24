#!/usr/bin/env node
// CI check for what may live in Git now that the Skills Store holds the live
// prompt text. Each service's own test suite checks that its defaults satisfy
// their contracts (contracts are code: ally-be src/prompt/contracts/,
// ally-ai and ally-ai-learn app/prompts/contracts.py); this checks the rules
// that span the repo.
//
//   node scripts/prompts/check-prompts.mjs
//
// Fails (exit 1) when:
//   1. anything under `.prompts/` is tracked: that is the pulled working copy
//      of the real prompt text, which never goes into Git;
//   2. a migration newer than the Skills Store cut-over writes
//      `prompts_versions`: prompt text changes go through the store's write
//      path (versions, base check, translations), not migrations;
//   3. the branch MODIFIES an existing default .txt without changing that
//      service's contracts file in the same diff. Live prompt text belongs in
//      the Skills Store; a default changes only to keep up with its contract.
//      Allowed anyway when PROMPT_DEFAULT_REFRESH=true (the workflow sets it
//      for a PR labelled `prompt-default-refresh`). New defaults (git status A)
//      are always allowed: that is how a new prompt starts. The diff base is
//      BASE_REF (default origin/master); skipped when it can't be resolved.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, SERVICES, listPrompts } from './lib/catalog.mjs';

const MIGRATIONS_DIR = 'ally-be/src/database/migrations';
// The migration that made the store the source of truth; later ones may not
// write prompt text.
const CUTOVER_TIMESTAMP = 1980200000000;

const git = (...args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
const problems = [];
const prompts = listPrompts();

let tracked = '';
try {
  tracked = git('ls-files', '--', '.prompts');
} catch {
  // Not a git checkout; nothing tracked to check.
}
for (const file of tracked.split('\n').filter(Boolean)) {
  problems.push(
    `${file}: the .prompts/ working copy holds real prompt text and must never be committed (it is gitignored; remove it with git rm --cached)`,
  );
}

// A migration may remove prompts, but never write their text: that goes
// through the Skills Store. So only INSERT/UPDATE of prompts_versions counts.
const WRITES_VERSIONS = /\b(INSERT\s+INTO|UPDATE)\s+"?prompts_versions"?/i;
const migrationsDir = path.join(REPO_ROOT, MIGRATIONS_DIR);
if (fs.existsSync(migrationsDir)) {
  for (const name of fs.readdirSync(migrationsDir)) {
    const ts = Number(name.match(/^(\d{13})-/)?.[1]);
    if (!ts || ts <= CUTOVER_TIMESTAMP || !name.endsWith('.ts')) continue;
    if (WRITES_VERSIONS.test(fs.readFileSync(path.join(migrationsDir, name), 'utf8'))) {
      problems.push(
        `${MIGRATIONS_DIR}/${name}: writes prompts_versions. Prompt text changes go through the Skills Store ` +
          '(a new version, then promotion), and a new prompt arrives as a default file through sync.',
      );
    }
  }
}

const baseRef = process.env.BASE_REF || 'origin/master';
const refresh = process.env.PROMPT_DEFAULT_REFRESH === 'true';
let changed = null;
try {
  changed = git('diff', '--name-status', `${baseRef}...HEAD`);
} catch {
  console.warn(`Skipping the default-change check: can't diff against ${baseRef}.`);
}
if (changed !== null && !refresh) {
  const rows = changed
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
  const touched = new Set(rows.map(([, file]) => file));
  const byFile = new Map(prompts.map((p) => [p.file, p]));
  for (const [status, file] of rows) {
    if (status !== 'M' || !byFile.has(file)) continue;
    const { contractsFile } = SERVICES.find((s) => s.service === byFile.get(file).service);
    if (!touched.has(contractsFile)) {
      problems.push(
        `${file}: Live prompt text belongs in the Skills Store (prompts push), not in Git. ` +
          `Default files change only with their contract (${contractsFile}). ` +
          'If this PR deliberately refreshes the open-source default, add the label prompt-default-refresh.',
      );
    }
  }
}

if (problems.length) {
  console.error(`Prompt check failed (${problems.length}):`);
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`Prompt check passed (${prompts.length} default(s) in Git).`);
