#!/usr/bin/env node
/**
 * Course Pilot phase 5B: the roleplay interview, end to end, on fixed requests.
 *
 * A simulated trainer (gpt-4o-mini, answering from hidden facts in roleplay-briefs.json) talks to
 * the roleplay interview over the real API until a plan is proposed, then the run abandons the
 * session. Run it against a backend with ROLEPLAY_PILOT_STAGES on and one with it off, and
 * compare: questions asked, turns, whether a plan was reached, fidelity to the trainer's facts,
 * tokens and time.
 *
 *   API=http://localhost:8001/api node scripts/course-pilot-evals/roleplay-run.mjs --label on
 *   [--only id,id] [--users a@x,b@y] [--max-turns 14]
 *
 * One interview in progress per user, so each user is one lane, run in turn.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const beRoot = join(here, '../..');
const API = process.env.API ?? 'http://localhost:8001/api';
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const LABEL = flag('label', 'run');
const MAX_TURNS = Number(flag('max-turns', 14));
const ONLY = flag('only', '').split(',').filter(Boolean);
const USERS = flag(
  'users',
  'multi-tenant-admin1@example.com,sarah.thompson@northwindbh.org,arjun.rao@helloally.ai',
).split(',');

const env = Object.fromEntries(
  readFileSync(join(beRoot, '.env'), 'utf8')
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

const tokens = new Map();
async function token(username) {
  const cached = tokens.get(username);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.token;
  const res = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Password123!' }),
  });
  const body = await res.json();
  if (!body.accessToken)
    throw new Error(`login ${username}: ${JSON.stringify(body).slice(0, 200)}`);
  tokens.set(username, { token: body.accessToken, at: Date.now() });
  return body.accessToken;
}
async function api(username, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await token(username)}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${path} ${res.status}: ${text.slice(0, 200)}`);
  return text;
}
const json = async (...a) => JSON.parse((await api(...a)) || 'null');

async function turn(username, sessionId, payload) {
  const text = await api(
    username,
    'POST',
    `/v1/learn/roleplay-interview/sessions/${sessionId}/messages/stream`,
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
  return frames;
}

const STYLES = {
  cooperative: 'You answer helpfully and briefly.',
  terse:
    'You answer in a few words and pick an option whenever one is close enough.',
  'just-build':
    'You want this done fast: pick the recommended option unless it contradicts your facts.',
  'you-decide':
    'You have few opinions: when a question is not about your facts, pick the recommended option.',
};

/** The simulated trainer: answers from its hidden facts, in its style. */
async function trainerAnswer(brief, question, reply) {
  const system =
    'You are a trainer at a mental-health training organisation, building ONE roleplay with an AI ' +
    'roleplay designer. Your facts (the AI cannot see them):\n' +
    JSON.stringify(brief.truth, null, 1) +
    '\n"any" means you have no preference. Language "en" is any English, "hi" is Hindi. ' +
    STYLES[brief.style] +
    '\nAnswer as JSON: {"optionIds": [ids you pick, or empty], "text": "your words, or empty"}. ' +
    'Pick the option closest to your facts; if none fits, pick none and say what you want. For a ' +
    'choice between existing library characters and a new one, pick the recommended option unless it contradicts your facts.';
  const user = question
    ? `The AI said: ${reply || '(nothing)'}\nQuestion (${question.kind}): ${question.prompt}\n` +
      `Options: ${JSON.stringify((question.options ?? []).map((o) => ({ id: o.id, label: o.label, recommended: !!o.recommended })))}`
    : `The AI said: ${reply || '(nothing)'}\nThere is no question card. Reply in one short sentence (JSON, empty optionIds).`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const body = await res.json();
  try {
    const parsed = JSON.parse(body.choices[0].message.content);
    const valid = new Set((question?.options ?? []).map((o) => o.id));
    return {
      optionIds: (parsed.optionIds ?? []).filter((id) => valid.has(id)),
      text: String(parsed.text ?? '').trim(),
    };
  } catch {
    return { optionIds: [], text: 'Go ahead with your recommendation.' };
  }
}

function payloadFor(question, answer) {
  if (!question)
    return { text: answer.text || 'Go ahead with your recommendation.' };
  if (!answer.optionIds.length && !answer.text)
    answer.text = 'Go ahead with your recommendation.';
  return {
    questionId: question.id,
    answer: {
      ...(answer.optionIds.length ? { optionIds: answer.optionIds } : {}),
      ...(answer.text ? { text: answer.text } : {}),
    },
  };
}

function score(brief, saved) {
  const b = saved ?? {};
  const t = brief.truth;
  const gates = {
    learners: !!b.learners?.who,
    goal: !!b.goal,
    competency:
      !!b.competencyIds?.length &&
      (b.competencyNames ?? []).length === b.competencyIds.length,
    mode: !!b.mode,
    client: !!(b.client?.description || b.client?.characterId),
    difficulty: !!b.difficulty,
    language: !!b.languages?.length,
    minScore: typeof b.minScore === 'number',
  };
  const fidelity = {
    mode: t.mode === 'any' ? null : b.mode === t.mode,
    difficulty: t.difficulty === 'any' ? null : b.difficulty === t.difficulty,
    language:
      (b.languages ?? []).length > 0 &&
      (b.languages ?? []).every((l) =>
        String(l.code ?? '')
          .toLowerCase()
          .startsWith(t.language),
      ),
  };
  return { gates, fidelity };
}

async function freshSession(username) {
  // The API resumes an interview still in progress: abandon leftovers first.
  for (let i = 0; i < 3; i++) {
    const view = await json(
      username,
      'POST',
      '/v1/learn/roleplay-interview/sessions',
      {},
    );
    const empty = !Object.keys(view.brief ?? {}).length && !view.plan;
    const msgs =
      (
        await json(
          username,
          'GET',
          `/v1/learn/roleplay-interview/sessions/${view.id}`,
        )
      ).messages ?? [];
    if (empty && !msgs.length) return view.id;
    await api(
      username,
      'POST',
      `/v1/learn/roleplay-interview/sessions/${view.id}/abandon`,
      {},
    );
  }
  throw new Error(`${username}: could not get a fresh interview`);
}

async function runBrief(brief, username) {
  const started = Date.now();
  const sessionId = await freshSession(username);
  const log = [];
  let payload = { text: brief.firstMessage };
  let planReached = false;
  let changed = false;
  let error = null;
  try {
    for (let n = 1; n <= MAX_TURNS; n++) {
      const t0 = Date.now();
      const frames = await turn(username, sessionId, payload);
      const question = frames.find((f) => f.event === 'question')?.data;
      const plan = frames.find((f) => f.event === 'plan');
      const reply = frames
        .filter((f) => f.event === 'token')
        .map((f) => f.data.delta ?? '')
        .join('')
        .trim();
      const refused = frames.filter(
        (f) => f.event === 'tool_result' && f.data?.error === 'question_limit',
      ).length;
      const errors = frames
        .filter((f) => f.event === 'error')
        .map((f) => f.data?.code);
      log.push({
        n,
        seconds: (Date.now() - t0) / 1000,
        question: question
          ? {
              prompt: question.prompt,
              stage: question.stage ?? null,
              field: question.field ?? null,
            }
          : null,
        plan: Boolean(plan),
        refused,
        errors,
        reply: reply.slice(0, 300),
      });
      if (plan) {
        if (brief.changeAtPlan && !changed) {
          changed = true;
          payload = { text: brief.changeAtPlan };
          continue;
        }
        planReached = true;
        break;
      }
      payload = payloadFor(
        question,
        await trainerAnswer(brief, question, reply),
      );
    }
  } catch (e) {
    error = e.message;
  }
  const view = (
    await json(
      username,
      'GET',
      `/v1/learn/roleplay-interview/sessions/${sessionId}`,
    )
  ).session;
  await api(
    username,
    'POST',
    `/v1/learn/roleplay-interview/sessions/${sessionId}/abandon`,
    {},
  ).catch(() => {});
  const usage = sql(
    `select coalesce(sum("promptTokens"),0) || '|' || coalesce(sum("completionTokens"),0) || '|' || coalesce(sum("cachedTokens"),0)
     from llm_usage where metadata->>'roleplayInterviewSessionId' = '${sessionId}'`,
  )
    .split('|')
    .map(Number);
  const result = {
    id: brief.id,
    sessionId,
    planReached,
    planVersion: view.planVersion,
    turns: log.length,
    questions: log.filter((l) => l.question).length,
    refused: log.reduce((n, l) => n + l.refused, 0),
    errors: log.flatMap((l) => l.errors),
    minutes: (Date.now() - started) / 60000,
    tokens: { prompt: usage[0], completion: usage[1], cached: usage[2] },
    ...score(brief, view.brief),
    error,
    log,
  };
  const f = result.fidelity;
  console.log(
    `${brief.id.padEnd(26)} plan ${planReached ? 'yes' : 'NO '} | turns ${result.turns} | questions ${result.questions}` +
      `${result.refused ? ` (+${result.refused} refused)` : ''} | mode ${f.mode} diff ${f.difficulty} lang ${f.language} | ` +
      `${result.minutes.toFixed(1)} min${error ? ` | ERROR ${error.slice(0, 80)}` : ''}`,
  );
  return result;
}

const briefs = JSON.parse(
  readFileSync(join(here, 'roleplay-briefs.json'), 'utf8'),
).filter((b) => !ONLY.length || ONLY.includes(b.id));
const queue = [...briefs];
const results = [];
await Promise.all(
  USERS.map(async (username) => {
    while (queue.length) {
      const brief = queue.shift();
      results.push(
        await runBrief(brief, username).catch((e) => ({
          id: brief.id,
          error: e.message,
        })),
      );
    }
  }),
);

const ok = results.filter((r) => r.log);
const avg = (pick) =>
  ok.length ? ok.reduce((n, r) => n + pick(r), 0) / ok.length : 0;
const rate = (pick) => {
  const known = ok.map(pick).filter((v) => v !== null && v !== undefined);
  return known.length ? known.filter(Boolean).length / known.length : null;
};
const summary = {
  label: LABEL,
  api: API,
  runs: results.length,
  planReached: ok.filter((r) => r.planReached).length,
  avgTurns: avg((r) => r.turns),
  avgQuestions: avg((r) => r.questions),
  avgRefused: avg((r) => r.refused),
  avgMinutes: avg((r) => r.minutes),
  avgPromptTokens: avg((r) => r.tokens.prompt),
  avgCompletionTokens: avg((r) => r.tokens.completion),
  fidelityMode: rate((r) => r.fidelity.mode),
  fidelityDifficulty: rate((r) => r.fidelity.difficulty),
  fidelityLanguage: rate((r) => r.fidelity.language),
  allGates: ok.filter((r) => Object.values(r.gates).every(Boolean)).length,
  errors: results.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`),
};
console.log('\n' + JSON.stringify(summary, null, 2));
const out = join(homedir(), 'workspace/ally/course-pilot-evals');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, `roleplay-run-${LABEL}.json`),
  JSON.stringify({ summary, results }, null, 2),
);
console.log(`Saved ${join(out, `roleplay-run-${LABEL}.json`)}`);
