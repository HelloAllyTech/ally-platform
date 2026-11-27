#!/usr/bin/env node
/**
 * One scripted test of the character interview's stages (CHARACTER_PILOT_STAGES, on by default).
 * Plays a character interview, picking the first option on every card (and typing a short answer
 * when a card has none), then a second, detailed request that should go straight to a draft.
 * Prints a pass/fail line per check.
 *
 *   node scripts/course-pilot-evals/character-stage-test.mjs
 *   API=http://localhost:8001/api USER_EMAIL=someone@example.com node scripts/...
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const API = process.env.API ?? 'http://localhost:8001/api';
const USER = process.env.USER_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.USER_PASSWORD ?? 'Password123!';
const BASE = '/v1/scenario-characters/interview/sessions';
const MAX_TURNS = 16;
const MAX_QUESTIONS = 10;
const LIMITS = { kind: 2, identity: 3, life: 3, voice: 3, draft: 0 };
const ORDER = ['kind', 'identity', 'life', 'voice', 'draft'];

const FIRST =
  'I need a character: a college student struggling with exam stress.';
const DETAILED =
  'A character called Meena, 28, female, a nurse in Bengaluru, speaks English, exhausted from ' +
  'night shifts and starting to feel numb. She will be a client in burnout roleplays. Decide ' +
  'anything else yourself.';
const TYPED = [
  [/name/i, 'Priya Kulkarni'],
  [/age|old/i, '20'],
  [/where|live|city|location/i, 'Pune, India'],
  [/profession|occupation|job|study/i, 'Second-year engineering student'],
  [/language/i, 'English'],
  [
    /kind|who|situation|going through|role/i,
    'A first-generation college student, anxious and perfectionist, for counselling practice roleplays.',
  ],
];

const env = Object.fromEntries(
  readFileSync(join(here, '../../.env'), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [
      line.slice(0, line.indexOf('=')),
      line.slice(line.indexOf('=') + 1),
    ]),
);
const sql = (query) =>
  execFileSync(
    'psql',
    [
      '-h',
      env.DB_HOST ?? 'localhost',
      '-p',
      env.DB_PORT ?? '5477',
      '-U',
      env.DB_USERNAME,
      env.DB_DATABASE,
      '-At',
      '-c',
      query,
    ],
    { env: { ...process.env, PGPASSWORD: env.DB_PASSWORD }, encoding: 'utf8' },
  ).trim();

let accessToken;
async function login() {
  const res = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body.accessToken)
    throw new Error(`login ${USER}: ${JSON.stringify(body).slice(0, 200)}`);
  accessToken = body.accessToken;
}
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${path} ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

async function send(sessionId, payload) {
  const text = await api(
    'POST',
    `${BASE}/${sessionId}/messages/stream`,
    payload,
  );
  const frames = [];
  for (const block of text.split('\n\n')) {
    const event = block.match(/^event: (.*)$/m)?.[1];
    const data = block.match(/^data: (.*)$/m)?.[1];
    if (!event || !data) continue;
    try {
      frames.push({ event, data: JSON.parse(data) });
    } catch {
      frames.push({ event, data });
    }
  }
  const results = frames
    .filter((f) => f.event === 'tool_result')
    .map((f) => f.data);
  return {
    question: frames.find((f) => f.event === 'question')?.data ?? null,
    draft: frames.find((f) => f.event === 'character_draft')?.data ?? null,
    reply: frames
      .filter((f) => f.event === 'token')
      .map((f) => f.data.delta ?? '')
      .join('')
      .trim(),
    calls: frames
      .filter((f) => f.event === 'tool_call')
      .map((f) => f.data?.name),
    refused: results.filter((r) => r?.error === 'question_limit').length,
    earlySaves: results.filter(
      (r) =>
        r?.name === 'save_character_draft' && r?.error === 'stage_not_ready',
    ).length,
    errors: frames
      .filter((f) => f.event === 'error')
      .map((f) => f.data?.message ?? f.data?.code),
  };
}

function answerFor(question) {
  const options = question.options ?? [];
  const message = (text) => ({ message: text, questionId: question.id });
  if (options.length) {
    const pick = options[0];
    return { ...message(pick.label), answer: { selectedOptionIds: [pick.id] } };
  }
  const typed =
    TYPED.find(([re]) => re.test(question.prompt))?.[1] ?? 'You decide.';
  return { ...message(typed), answer: { customValues: [typed] } };
}

const brief = (sessionId) =>
  JSON.parse(
    sql(
      `select coalesce(metadata->'characterBrief','{}')::text from character_interview_sessions where id='${sessionId}'`,
    ) || '{}',
  );

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass });
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`,
  );
};

/** Draft checks shared by both scenarios. */
function checkDraft(label, draft, recorded) {
  const d = draft?.draft ?? draft ?? {};
  const languages = recorded.languageIds ?? [];
  const voiced = languages.filter((id) => d.voices?.[id]);
  check(
    `${label}: every recorded language has a voice in the draft`,
    languages.length > 0 && voiced.length === languages.length,
    `languages ${languages.join(', ') || 'none'}; voices for ${voiced.join(', ') || 'none'}`,
  );
  check(
    `${label}: draft matches the record (name, age, gender)`,
    d.name === recorded.name &&
      Number(d.age) === Number(recorded.age) &&
      d.gender === recorded.gender,
    `draft ${d.name}/${d.age}/${d.gender} vs recorded ${recorded.name}/${recorded.age}/${recorded.gender}`,
  );
}

async function mainScenario() {
  console.log(`\n== Scenario: "${FIRST}"\n`);
  const sessionId = JSON.parse(await api('POST', BASE, {})).id;
  const questions = [];
  const calls = [];
  let payload = { message: FIRST };
  let draft = null;
  let refused = 0;
  let earlySaves = 0;
  for (let n = 1; n <= MAX_TURNS; n++) {
    const turn = await send(sessionId, payload);
    calls.push(...turn.calls);
    refused += turn.refused;
    earlySaves += turn.earlySaves;
    if (turn.errors.length)
      console.log(`   turn ${n} error: ${turn.errors.join('; ')}`);
    if (turn.question) {
      questions.push(turn.question);
      console.log(
        `   Q${questions.length} [${turn.question.stage ?? 'no stage'}] ${turn.question.prompt.slice(0, 90)}`,
      );
    }
    if (turn.draft) {
      draft = turn.draft;
      console.log(`   Draft saved on turn ${n}`);
      break;
    }
    payload = turn.question
      ? answerFor(turn.question)
      : { message: 'You decide and carry on.' };
  }
  console.log('');
  const recorded = brief(sessionId);

  check(
    `At most ${MAX_QUESTIONS} questions`,
    questions.length <= MAX_QUESTIONS,
    `${questions.length} asked`,
  );
  check(
    'Every question is tagged with its stage',
    questions.every((q) => q.stage),
    questions.map((q) => q.stage ?? '?').join(' → ') || 'no questions',
  );
  const idx = questions
    .map((q) => ORDER.indexOf(q.stage))
    .filter((i) => i >= 0);
  check(
    'Stages only move forward',
    idx.every((s, i) => i === 0 || s >= idx[i - 1]),
  );
  const perStage = questions.reduce(
    (m, q) => ({ ...m, [q.stage]: (m[q.stage] ?? 0) + 1 }),
    {},
  );
  check(
    'Each stage within its question limit',
    Object.entries(perStage).every(([s, c]) => !LIMITS[s] || c <= LIMITS[s]),
    Object.entries(perStage)
      .map(([s, c]) => `${s} ${c}/${LIMITS[s] ?? '?'}`)
      .join(', ') || 'none',
  );
  check(
    'Facts recorded as it goes (record_character used)',
    calls.includes('record_character'),
    `${calls.filter((c) => c === 'record_character').length} record calls`,
  );
  check(
    'No question refused for going over a limit',
    refused === 0,
    refused ? `${refused} refused` : '',
  );
  check(
    'Did not try to save before the end',
    earlySaves === 0,
    earlySaves ? `${earlySaves} early save attempts` : '',
  );
  check('A draft was saved', Boolean(draft));
  if (draft) checkDraft('Main', draft, recorded);
  await api('POST', `${BASE}/${sessionId}/abandon`, {}).catch(() => {});
}

async function fastPath() {
  console.log(`\n== Fast path: everything given up front\n`);
  const sessionId = JSON.parse(await api('POST', BASE, {})).id;
  let payload = { message: DETAILED };
  let questions = 0;
  let draft = null;
  for (let n = 1; n <= 6; n++) {
    const turn = await send(sessionId, payload);
    if (turn.question) {
      questions += 1;
      console.log(
        `   Q${questions} [${turn.question.stage ?? 'no stage'}] ${turn.question.prompt.slice(0, 90)}`,
      );
    }
    if (turn.draft) {
      draft = turn.draft;
      console.log(`   Draft saved on turn ${n}`);
      break;
    }
    payload = turn.question
      ? answerFor(turn.question)
      : { message: 'You decide.' };
  }
  console.log('');
  check(
    'Fast path: a draft with at most 2 questions',
    Boolean(draft) && questions <= 2,
    `${questions} questions${draft ? '' : ', no draft'}`,
  );
  const recorded = brief(sessionId);
  if (draft) {
    check(
      'Fast path: kept the given name, age and gender',
      /meena/i.test(recorded.name ?? '') &&
        recorded.age === 28 &&
        recorded.gender === 'female',
      `${recorded.name}/${recorded.age}/${recorded.gender}`,
    );
    checkDraft('Fast path', draft, recorded);
  }
  await api('POST', `${BASE}/${sessionId}/abandon`, {}).catch(() => {});
}

await login();
const started = Date.now();
try {
  await mainScenario();
  await fastPath();
} catch (error) {
  console.log(`\nERROR: ${error.message}`);
  process.exitCode = 1;
}
const failed = checks.filter((c) => !c.pass);
console.log(
  `\n${checks.length - failed.length}/${checks.length} checks passed in ${((Date.now() - started) / 60000).toFixed(1)} min` +
    (failed.length ? `\nFailed: ${failed.map((c) => c.name).join('; ')}` : ''),
);
if (failed.length) process.exitCode = 1;
