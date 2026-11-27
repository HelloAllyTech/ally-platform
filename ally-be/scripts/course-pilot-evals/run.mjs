#!/usr/bin/env node
// Course Pilot eval suite: fixed course requests, each played end to end against a LOCAL ally-be
// by a simulated trainer who has a hidden "truth" brief. Stops when a blueprint is proposed.
//
//   node scripts/course-pilot-evals/run.mjs --label stages-on [--only id1,id2] [--concurrency 4]
//
// Needs: ally-be on localhost:8001 (the label is yours — set COURSE_PILOT_STAGES on the server
// to match), the local seed users below, psql on PATH, and OPENAI_API_KEY in ally-be/.env for the
// simulated trainer (gpt-4o-mini). Results: ~/workspace/ally/course-pilot-evals/<label>-<time>.json
//
// Metrics per brief: reached a blueprint; questions; turns; seconds; spend; refused tool calls;
// replies sent back by the validator; brief completeness (the Course Pilot gates); fidelity to the
// trainer's truth (time, languages, assessment); stage history; confirmations.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeBlueprint as judgeWith } from './judge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const beRoot = join(here, '..', '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const label = flag('--label', 'run');
const only = flag('--only')?.split(',');
const concurrency = Number(flag('--concurrency', 4));
const MAX_TURNS = Number(flag('--max-turns', 20));
const API = process.env.API ?? 'http://localhost:8001/api';

const env = Object.fromEntries(
  readFileSync(join(beRoot, '.env'), 'utf8')
    .split('\n')
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^"|"$/g, '')]),
);
// Eval users: their own accounts, so runs never collide with a person testing as the admin.
// The session cap is per user (2 in progress), so two users give four lanes.
const USERS = flag(
  '--users',
  'multi-tenant-admin1@example.com,sarah.thompson@northwindbh.org',
).split(',');

function sql(query) {
  return execFileSync(
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
}

async function login(username) {
  const res = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Password123!' }),
  });
  const body = await res.json();
  if (!body.accessToken)
    throw new Error(`login ${username}: ${JSON.stringify(body).slice(0, 200)}`);
  return body.accessToken;
}

// Tokens live ~15 minutes; a run can outlast one.
const tokens = new Map();
async function token(username) {
  const cached = tokens.get(username);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.token;
  const fresh = await login(username);
  tokens.set(username, { token: fresh, at: Date.now() });
  return fresh;
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

async function turn(username, sessionId, payload) {
  const text = await api(
    username,
    'POST',
    `/v1/course-copilot/sessions/${sessionId}/messages/stream`,
    payload,
  );
  const frames = [];
  for (const block of text.split('\n\n')) {
    const event = block.match(/^event: (.*)$/m)?.[1];
    const data = block.match(/^data: (.*)$/m)?.[1];
    if (event && data) {
      try {
        frames.push({ event, data: JSON.parse(data) });
      } catch {
        frames.push({ event, data });
      }
    }
  }
  return frames;
}

/**
 * The confirm card, decided in code: confirm when the SAVED brief matches the trainer's facts on
 * time, language family and assessment type; otherwise ask for exactly those corrections. An LLM
 * trainer here nitpicked wording ("en" vs "English (UK)") and never confirmed, so runs measured
 * the simulator, not the product. Three corrections at most, then it confirms and the run notes it.
 */
async function confirmDecision(brief, username, sessionId, state) {
  if (brief.changeAtConfirm && !state.changedOnce) {
    state.changedOnce = true;
    return { selectedOptionIds: ['change_brief'], text: brief.changeAtConfirm };
  }
  const saved =
    JSON.parse(
      await api(username, 'GET', `/v1/course-copilot/sessions/${sessionId}`),
    ).session.brief ?? {};
  const { fidelity } = score(brief, saved);
  const t = brief.truth;
  const fixes = [];
  if (fidelity.duration === false)
    fixes.push(`the course should be ${t.durationMinutes} minutes`);
  if (!fidelity.languages)
    fixes.push(
      `the language should be ${t.languages.map((c) => ({ en: 'English', hi: 'Hindi' })[c] ?? c).join(' and ')} only`,
    );
  if (fidelity.assessment === false)
    fixes.push(`learners should be assessed with a ${t.assessment}`);
  state.corrections = state.corrections ?? 0;
  if (!fixes.length || state.corrections >= 3) {
    if (fixes.length) state.forcedConfirm = true;
    return { selectedOptionIds: ['confirm_brief'], text: '' };
  }
  state.corrections += 1;
  return {
    selectedOptionIds: ['change_brief'],
    text: `Please change: ${fixes.join('; ')}.`,
  };
}

/** The simulated trainer: answers from its hidden truth, in its style. */
async function trainerAnswer(
  brief,
  question,
  reply,
  state,
  username,
  sessionId,
) {
  const isConfirm = question?.options?.some((o) => o.id === 'confirm_brief');
  if (isConfirm) return confirmDecision(brief, username, sessionId, state);
  const styles = {
    cooperative: 'You answer helpfully and briefly.',
    terse:
      'You answer in a few words and pick an option whenever one is close enough.',
    'just-build':
      'You want this done fast: pick the recommended option unless it contradicts your facts.',
    'you-decide':
      'You have few opinions: when a question is not about your facts, say "you decide" or pick the recommended option.',
  };
  const system =
    'You are a trainer at a mental-health training organisation, building a course with an AI ' +
    'course designer. Your facts (the AI cannot see them):\n' +
    JSON.stringify(brief.truth, null, 1) +
    '\n"any" means you have no preference. ' +
    styles[brief.style] +
    '\nAnswer the question as JSON: {"selectedOptionIds": [ids of options you pick, or empty], "text": "your words, or empty"}. ' +
    'Pick the option closest to your facts. If none fits your facts, pick none and say what you want in text. ' +
    'If this is a confirmation of the brief, confirm only if time, languages and assessment match your facts; otherwise choose the change option and say what to change. ' +
    'Language codes: "en" is any English (English (India), English (UK) all count), "hi" is Hindi. Do not object to details your facts do not mention (pass marks, practice items, regional variants).';
  const user = question
    ? `The AI said: ${reply || '(nothing)'}\nQuestion (${question.kind}): ${question.prompt}\n` +
      (question.rationale ? `Details: ${question.rationale}\n` : '') +
      `Options: ${JSON.stringify((question.options ?? []).map((o) => ({ id: o.id, label: o.label, recommended: !!o.recommended })))}`
    : `The AI said: ${reply || '(nothing)'}\nThere is no question card. Reply in one short sentence (JSON with empty selectedOptionIds).`;
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
      selectedOptionIds: (parsed.selectedOptionIds ?? []).filter((id) =>
        valid.has(id),
      ),
      text: String(parsed.text ?? '').trim(),
    };
  } catch {
    return {
      selectedOptionIds: [],
      text: 'Go ahead with your recommendation.',
    };
  }
}

function payloadFor(question, answer) {
  const labels = (question?.options ?? [])
    .filter((o) => answer.selectedOptionIds.includes(o.id))
    .map((o) => o.label);
  const message =
    [...labels, answer.text].filter(Boolean).join(' — ') ||
    'Go ahead with your recommendation.';
  if (!question) return { message };
  return {
    message,
    questionId: question.id,
    answer: {
      ...(answer.selectedOptionIds.length
        ? { selectedOptionIds: answer.selectedOptionIds }
        : {}),
      ...(answer.text ? { customValues: [answer.text] } : {}),
    },
  };
}

const LANGUAGE_CODES = Object.fromEntries(
  sql(`select id || '|' || "translationCode" from languages`)
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('|')),
);

function score(brief, finalBrief) {
  const b = finalBrief ?? {};
  const targets = b.skillTargets ?? [];
  const gates = {
    learners: !!b.audience?.who,
    learnerProfile: !!b.learnerProfileId,
    outcome: !!b.outcomes?.terminal,
    competencies: !!b.competencyIds?.length,
    skillTargetsAB:
      targets.length >= 1 &&
      targets.length <= 3 &&
      targets.every((t) => t.a && t.b),
    assessment: !!b.assessment?.kind,
    duration: !!b.shape?.durationMinutes,
    language: !!b.shape?.languageIds?.length,
  };
  const t = brief.truth;
  const codes = [
    ...new Set((b.shape?.languageIds ?? []).map((id) => LANGUAGE_CODES[id])),
  ].sort();
  const fidelity = {
    duration:
      t.durationMinutes === 'any'
        ? null
        : b.shape?.durationMinutes === t.durationMinutes,
    languages:
      JSON.stringify(codes) === JSON.stringify([...t.languages].sort()),
    assessment:
      t.assessment === 'any' ? null : b.assessment?.kind === t.assessment,
  };
  // "English" should be one language, not English (UK) + English (US).
  const oneVariantPerLanguage =
    (b.shape?.languageIds ?? []).length === codes.length;
  return { gates, fidelity, languages: codes, oneVariantPerLanguage };
}

async function runBrief(brief, username) {
  const started = Date.now();
  const created = JSON.parse(
    await api(username, 'POST', '/v1/course-copilot/sessions', {}),
  );
  const sessionId = created.id ?? created.session?.id;
  const log = [];
  const state = {};
  let payload = { message: brief.firstMessage };
  let reached = false;
  let error = null;
  try {
    for (let n = 1; n <= MAX_TURNS; n++) {
      const t0 = Date.now();
      const frames = await turn(username, sessionId, payload);
      const question = frames.find((f) => f.event === 'question')?.data;
      const reply = frames
        .filter((f) => f.event === 'reply' || f.event === 'token')
        .map((f) => f.data.text ?? f.data.delta ?? '')
        .join('')
        .trim();
      const done = frames.find((f) => f.event === 'done')?.data;
      log.push({
        n,
        seconds: (Date.now() - t0) / 1000,
        question: question
          ? {
              prompt: question.prompt,
              kind: question.kind,
              confirm: question.options?.some((o) => o.id === 'confirm_brief'),
            }
          : null,
        reply: reply.slice(0, 400),
        errors: frames
          .filter((f) => f.event === 'error')
          .map((f) => f.data.message),
      });
      if (done?.sessionStatus === 'AWAITING_BLUEPRINT') {
        reached = true;
        break;
      }
      const answer = await trainerAnswer(
        brief,
        question,
        reply,
        state,
        username,
        sessionId,
      );
      log[log.length - 1].answer = answer;
      payload = payloadFor(question, answer);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const detail = JSON.parse(
    await api(username, 'GET', `/v1/course-copilot/sessions/${sessionId}`),
  );
  const budget = JSON.parse(
    await api(
      username,
      'GET',
      `/v1/course-copilot/sessions/${sessionId}/budget`,
    ),
  );
  const judged =
    reached && !args.includes('--no-judge')
      ? await judgeWith(
          env.OPENAI_API_KEY,
          detail.session.brief,
          detail.session.blueprint,
        ).catch((e) => ({ error: String(e) }))
      : null;
  const meta = JSON.parse(
    sql(
      `select coalesce(metadata->'coursePilot','{}')::text from course_copilot_sessions where id='${sessionId}'`,
    ) || '{}',
  );
  const toolStats = sql(
    `select count(*) filter (where r->'result'->>'ok' = 'false' and r->'result'->>'error' = 'not_delivered') || '|' ||
            count(*) filter (where r->'result'->>'ok' = 'false' and coalesce(r->'result'->>'error','') <> 'not_delivered')
       from course_copilot_messages m, jsonb_array_elements(coalesce(m."toolResults",'[]'::jsonb)) r
      where m."sessionId" = '${sessionId}'`,
  ).split('|');
  await api(
    username,
    'POST',
    `/v1/course-copilot/sessions/${sessionId}/archive`,
  ).catch(() => {});
  return {
    id: brief.id,
    sessionId,
    reachedBlueprint: reached,
    error,
    turns: log.length,
    questions: log.filter((l) => l.question).length,
    confirmations: log.filter((l) => l.question?.confirm).length,
    // Interview questions only: the confirm cards are counted above.
    interviewQuestions: log.filter((l) => l.question && !l.question.confirm)
      .length,
    forcedConfirm: !!state.forcedConfirm,
    seconds: Math.round((Date.now() - started) / 1000),
    spentUsd: budget.spentUsd,
    notDelivered: Number(toolStats[0]),
    refusedTools: Number(toolStats[1]),
    stageHistory: (meta.history ?? []).map((h) => h.stage),
    judge: judged,
    critic: meta.critic ?? null,
    questionsByStage: meta.questions ?? null,
    ...score(brief, detail.session.brief),
    log,
  };
}

const briefs = JSON.parse(
  readFileSync(join(here, 'briefs.json'), 'utf8'),
).filter((b) => !only || only.includes(b.id));
const queue = [...briefs];
const results = [];
const lanes = Array.from(
  { length: Math.min(concurrency, USERS.length * 2) },
  (_, i) => USERS[i % USERS.length],
);
await Promise.all(
  lanes.map(async (username) => {
    while (queue.length) {
      const brief = queue.shift();
      process.stdout.write(`start ${brief.id} (${username})\n`);
      const result = await runBrief(brief, username).catch((e) => ({
        id: brief.id,
        error: String(e),
      }));
      results.push(result);
      process.stdout.write(
        `done  ${brief.id}: blueprint=${result.reachedBlueprint} q=${result.questions} ${result.seconds}s $${result.spentUsd} ${result.error ?? ''}\n`,
      );
    }
  }),
);

const outDir = join(homedir(), 'workspace', 'ally', 'course-pilot-evals');
mkdirSync(outDir, { recursive: true });
const file = join(
  outDir,
  `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
);
results.sort(
  (a, b) =>
    briefs.findIndex((x) => x.id === a.id) -
    briefs.findIndex((x) => x.id === b.id),
);
writeFileSync(
  file,
  JSON.stringify({ label, at: new Date().toISOString(), results }, null, 1),
);
console.log(`\nWrote ${file}`);
