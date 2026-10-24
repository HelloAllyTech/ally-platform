#!/usr/bin/env node
// CI check: does every free-text JSON prompt's DEFAULT still make a model answer
// in the shape the code parses? For each prompt whose contract says
// `output: 'json'` (the code parses free text, with no provider JSON mode),
// render its default in Git with sample values for its variables, make ONE
// cheap model call, and check the answer parses as JSON. A `_system`/`_user`
// pair is checked as the one call it is. `output: 'structured'` prompts are
// skipped: the provider enforces their shape, not the text.
//
//   OPENAI_API_KEY=... node scripts/prompts/check-structured-defaults.mjs \
//     --contracts be.json --contracts ai.json --contracts learn.json
//
// Contracts are code; dump them first (see release-check.mjs for the commands).
// Model: PROMPT_CHECK_MODEL (default gpt-4o-mini). Exits 1 listing each default
// whose answer didn't parse; 0 with a notice when OPENAI_API_KEY is unset, so
// the check is skipped rather than failed where no key is configured.
import fs from 'node:fs';
import { listPrompts } from './lib/catalog.mjs';

const files = process.argv.flatMap((a, i, all) => (a === '--contracts' ? [all[i + 1]] : []));
const key = process.env.OPENAI_API_KEY;
const model = process.env.PROMPT_CHECK_MODEL || 'gpt-4o-mini';
if (!key) {
  console.log('OPENAI_API_KEY is not set; skipping the structured-default check.');
  process.exit(0);
}
if (!files.length) {
  console.error('Give at least one --contracts <file.json> dumped from a service.');
  process.exit(2);
}

const contracts = {};
for (const file of files) Object.assign(contracts, JSON.parse(fs.readFileSync(file, 'utf8')));

/**
 * Fill a default the way its service renders it: Python services use
 * str.format (`{name}`, with `{{`/`}}` as literal braces); ally-be templates
 * use `{{name}}` or `{name}`.
 */
function render(prompt) {
  const sample = (name) => `sample ${name.replace(/_/g, ' ')}`;
  if (prompt.service === 'ally-be') {
    return prompt.body
      .replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, n) => sample(n))
      .replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, n) => sample(n));
  }
  return prompt.body
    .replace(/\{\{/g, '\u0000')
    .replace(/\}\}/g, '\u0001')
    .replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, n) => sample(n))
    .replace(/\u0000/g, '{')
    .replace(/\u0001/g, '}');
}

/** The answer as JSON, tolerating a markdown fence around it. */
function parses(text) {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

const prompts = listPrompts();
const byCode = new Map(prompts.map((p) => [p.code, p]));
const isJson = (code) => contracts[code]?.output === 'json';

/**
 * The calls to check: a `_user` prompt with a `_system` sibling is sent with
 * it (and the sibling isn't checked alone); anything else is the system
 * message with a generic user turn.
 */
const calls = [];
const paired = new Set();
for (const prompt of prompts) {
  if (!isJson(prompt.code) || !prompt.code.endsWith('_user')) continue;
  const system = byCode.get(prompt.code.replace(/_user$/, '_system'));
  if (!system) continue;
  paired.add(system.code);
  calls.push({ label: `${system.file} + ${prompt.file}`, code: prompt.code, system, user: prompt });
}
for (const prompt of prompts) {
  if (!isJson(prompt.code) || paired.has(prompt.code)) continue;
  if (calls.some((c) => c.user === prompt)) continue;
  calls.push({ label: prompt.file, code: prompt.code, system: prompt });
}

const problems = [];
for (const call of calls) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 4000,
      messages: [
        { role: 'system', content: render(call.system) },
        {
          role: 'user',
          content: call.user ? render(call.user) : 'Respond now, following the instructions above.',
        },
      ],
    }),
  }).catch((err) => ({ ok: false, status: 0, text: async () => err.message }));
  if (!res.ok) {
    problems.push(`${call.label}: model call failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    continue;
  }
  const answer = (await res.json()).choices?.[0]?.message?.content ?? '';
  if (!parses(answer)) {
    problems.push(`${call.label} (${call.code}): the answer isn't JSON: ${answer.slice(0, 160).replace(/\s+/g, ' ')}`);
  }
}

if (problems.length) {
  console.error(`${problems.length} structured default(s) didn't produce parseable JSON with ${model}:`);
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`Structured-default check passed: ${calls.length} call(s) over the 'json' defaults answer in JSON with ${model}.`);
