#!/usr/bin/env node
// Release check: does every LIVE prompt in a Skills Store satisfy the contract
// this release's code declares? Contracts are code; each service dumps them
// as JSON ({ code: contract }) for this check:
//   ally-be:       npx ts-node --transpile-only scripts/prompt-contracts-json.ts
//   ally-ai(-learn): python -m app.prompts.contracts
// Run before
// deploying code whose contract moved (a required placeholder added, a
// variable removed), so a deploy can't ship code that renders a live prompt it
// no longer matches.
//
//   node scripts/prompts/release-check.mjs --contracts be.json [--contracts ai.json] \
//     --remote https://api.helloally.ai --key ssk_...
//   SKILLS_STORE_URL=... SKILLS_STORE_KEY=... node scripts/prompts/release-check.mjs --contracts be.json
//
// The key needs the `pull` scope (generate one in the Skills Store). Exits 1
// listing each live prompt that breaks its local contract; 2 when the store
// can't be read.
import fs from 'node:fs';
import { checkContract, describeViolation } from './lib/catalog.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name) {
  return process.argv.flatMap((a, i, all) => (a === `--${name}` ? [all[i + 1]] : []));
}

const remote = (arg('remote') ?? process.env.SKILLS_STORE_URL ?? '').replace(/\/+$/, '');
const key = arg('key') ?? process.env.SKILLS_STORE_KEY;
if (!remote || !key) {
  console.error('Usage: release-check.mjs --remote <ally-be url> --key <skills store key>');
  process.exit(2);
}

let exported;
try {
  const res = await fetch(`${remote}/api/v1/skills-store/export`, {
    headers: { 'x-skills-store-key': key },
  });
  if (!res.ok) {
    console.error(`Could not read the Skills Store at ${remote}: HTTP ${res.status} ${await res.text()}`);
    process.exit(2);
  }
  exported = await res.json();
} catch (err) {
  console.error(`Could not reach the Skills Store at ${remote}: ${err.message}`);
  process.exit(2);
}

const files = args('contracts').filter(Boolean);
if (!files.length) {
  console.error('Give at least one --contracts <file.json> dumped from a service.');
  process.exit(2);
}
const contracts = new Map();
for (const file of files) {
  for (const [code, contract] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) {
    contracts.set(code, { contract, source: file });
  }
}

const problems = [];
let checked = 0;
for (const prompt of exported.prompts ?? []) {
  const local = contracts.get(prompt.promptCode);
  if (!local || !prompt.live?.prompt) continue;
  checked++;
  const violation = checkContract(prompt.live.prompt, local.contract);
  if (violation) {
    problems.push(
      `${prompt.promptCode} (live v${prompt.live.version}) breaks its contract in ${local.source}` +
        ` (contractVersion ${local.contract.contractVersion ?? '-'}): ${describeViolation(violation)}`,
    );
  }
}

if (problems.length) {
  console.error(`${problems.length} live prompt(s) don't satisfy this checkout's contracts:`);
  for (const line of problems) console.error(`  - ${line}`);
  console.error(
    'Publish a version of each that satisfies the contract (Skills Store or `prompts push`), ' +
      'or ship the code change in two steps: first accept both, then require the new one.',
  );
  process.exit(1);
}
console.log(`Release check passed: ${checked} live prompt(s) satisfy their contracts at ${remote}.`);
