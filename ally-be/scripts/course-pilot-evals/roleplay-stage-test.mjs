#!/usr/bin/env node
/**
 * One scripted test of the roleplay interview's stages (ROLEPLAY_PILOT_STAGES must be on in the
 * backend you point it at). Plays the manual test scenario, picking the recommended option on
 * every card, and prints a pass/fail line per check.
 *
 *   node scripts/course-pilot-evals/roleplay-stage-test.mjs
 *   API=http://localhost:8001/api USER_EMAIL=someone@example.com node scripts/...
 *
 * Runs as admin@example.com by default. The API keeps one roleplay interview in progress per
 * user, so the script abandons that account's open roleplay chat first, and its own at the end.
 */
const API = process.env.API ?? 'http://localhost:8001/api';
const USER = process.env.USER_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.USER_PASSWORD ?? 'Password123!';
const BASE = '/v1/learn/roleplay-interview/sessions';
const MAX_TURNS = 14;
const MAX_QUESTIONS = 8;

const FIRST =
  'I need a practice roleplay for new helpline volunteers: a caller who hints at suicide.';
// What the trainer types when a card has no options, by what the question is about.
const TYPED = [
  [
    /learner|who|audience|experience/i,
    'New helpline volunteers with no counselling background.',
  ],
  [
    /goal|able to|outcome|skill/i,
    'Ask directly about suicide when a caller hints at it, and agree a safety step.',
  ],
  [
    /client|caller|character|persona/i,
    'A 22-year-old student calling late at night, exhausted, hinting she does not want to wake up.',
  ],
];

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
const json = async (...a) => JSON.parse((await api(...a)) || 'null');

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
  const session = (await json('GET', `${BASE}/${sessionId}`)).session;
  return {
    question: frames.find((f) => f.event === 'question')?.data ?? null,
    plan: frames.some((f) => f.event === 'plan'),
    reply: frames
      .filter((f) => f.event === 'token')
      .map((f) => f.data.delta ?? '')
      .join('')
      .trim(),
    refused: frames.filter(
      (f) => f.event === 'tool_result' && f.data?.error === 'question_limit',
    ).length,
    errors: frames
      .filter((f) => f.event === 'error')
      .map((f) => f.data?.message ?? f.data?.code),
    session,
  };
}

async function freshSession() {
  for (let i = 0; i < 3; i++) {
    const view = await json('POST', BASE, {});
    const messages = (await json('GET', `${BASE}/${view.id}`)).messages ?? [];
    if (!Object.keys(view.brief ?? {}).length && !view.plan && !messages.length)
      return view.id;
    await api('POST', `${BASE}/${view.id}/abandon`, {});
  }
  throw new Error('could not start a fresh interview');
}

function answerFor(question) {
  const options = question.options ?? [];
  if (options.length) {
    const pick = options.find((o) => o.recommended) ?? options[0];
    return { questionId: question.id, answer: { optionIds: [pick.id] } };
  }
  const typed =
    TYPED.find(([re]) => re.test(question.prompt))?.[1] ??
    'Go ahead with your recommendation.';
  return { questionId: question.id, answer: { text: typed } };
}

const settled = (brief) => ({
  learners: Boolean(brief.learners?.who && brief.goal),
  competency: Boolean(
    brief.competencyIds?.length &&
    brief.competencyNames?.length === brief.competencyIds.length,
  ),
  mode: Boolean(brief.mode),
  client: Boolean(brief.client?.description || brief.client?.characterId),
});

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass });
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`,
  );
};

/** Main scenario: from the first message to a plan, then one change. */
async function mainScenario() {
  console.log(`\n== Scenario: "${FIRST}"\n`);
  const sessionId = await freshSession();
  const questions = [];
  let payload = { text: FIRST };
  let planTurn = null;
  let briefAtPlan = null;
  let refused = 0;
  for (let n = 1; n <= MAX_TURNS; n++) {
    const turn = await send(sessionId, payload);
    refused += turn.refused;
    if (turn.errors.length)
      console.log(`   turn ${n} error: ${turn.errors.join('; ')}`);
    if (turn.question) {
      questions.push(turn.question);
      console.log(
        `   Q${questions.length} [${turn.question.stage ?? 'no stage'}] ${turn.question.prompt.slice(0, 90)}`,
      );
    }
    if (turn.plan) {
      planTurn = n;
      briefAtPlan = turn.session.brief;
      console.log(
        `   Plan proposed on turn ${n}${turn.reply ? `: "${turn.reply.slice(0, 160)}"` : ''}`,
      );
      break;
    }
    payload = turn.question
      ? answerFor(turn.question)
      : { text: 'Go ahead with your recommendation.' };
  }
  console.log('');

  const askedMode = questions.some(
    (q) => q.field === 'mode' || /\bmode\b/i.test(q.prompt),
  );
  check(
    'Does not ask the mode (you said "practice")',
    !askedMode,
    askedMode
      ? `asked: "${questions.find((q) => q.field === 'mode' || /\bmode\b/i.test(q.prompt)).prompt.slice(0, 70)}"`
      : '',
  );
  check(
    `At most ${MAX_QUESTIONS} questions before the plan`,
    questions.length <= MAX_QUESTIONS,
    `${questions.length} asked`,
  );
  check(
    'Every question is tagged with its stage',
    questions.length > 0 && questions.every((q) => q.stage),
    questions.map((q) => q.stage ?? '?').join(' → '),
  );
  const order = ['learners', 'skill', 'client', 'practice', 'plan'];
  const stages = questions
    .map((q) => order.indexOf(q.stage))
    .filter((i) => i >= 0);
  check(
    'Stages only move forward',
    stages.every((s, i) => i === 0 || s >= stages[i - 1]),
  );
  // A card that fills a brief field must not run ahead of the stage it was asked in.
  const FIELD_STAGE = {
    learnerProfileId: 'learners',
    competencyIds: 'skill',
    mode: 'skill',
    characterId: 'client',
    difficulty: 'practice',
    languageIds: 'practice',
    minScore: 'practice',
    lengthMinutes: 'practice',
  };
  const ahead = questions.filter(
    (q) =>
      q.field &&
      FIELD_STAGE[q.field] &&
      order.indexOf(FIELD_STAGE[q.field]) > order.indexOf(q.stage),
  );
  check(
    'Each card belongs to the stage it was asked in',
    ahead.length === 0,
    ahead.map((q) => `${q.field} asked in ${q.stage}`).join(', '),
  );
  const perStage = questions.reduce(
    (m, q) => ({ ...m, [q.stage]: (m[q.stage] ?? 0) + 1 }),
    {},
  );
  const limits = { learners: 2, skill: 2, client: 2, practice: 3 };
  check(
    'Each stage within its question limit',
    Object.entries(perStage).every(([s, c]) => !limits[s] || c <= limits[s]),
    Object.entries(perStage)
      .map(([s, c]) => `${s} ${c}/${limits[s] ?? '∞'}`)
      .join(', '),
  );
  check(
    'No question refused for going over a limit',
    refused === 0,
    refused ? `${refused} refused` : '',
  );
  check(
    'A plan was proposed',
    planTurn !== null,
    planTurn ? `turn ${planTurn}` : `none in ${MAX_TURNS} turns`,
  );
  if (briefAtPlan) {
    const s = settled(briefAtPlan);
    check(
      'Plan only after learners, competency, mode and client are set',
      Object.values(s).every(Boolean),
      Object.entries(s)
        .filter(([, v]) => !v)
        .map(([k]) => `missing ${k}`)
        .join(', '),
    );
    check(
      'Mode recorded as practice',
      briefAtPlan.mode === 'practice',
      `mode=${briefAtPlan.mode}`,
    );
    const defaults = ['difficulty', 'languages', 'minScore'].filter((k) =>
      k === 'languages'
        ? briefAtPlan.languages?.length
        : briefAtPlan[k] !== undefined && briefAtPlan[k] !== null,
    );
    check(
      'Practice details filled (difficulty, language, pass mark)',
      defaults.length === 3,
      `set: ${defaults.join(', ') || 'none'}`,
    );

    // The change check: an answer to an earlier stage after the plan.
    const before = await json('GET', `${BASE}/${sessionId}`);
    const change = await send(sessionId, {
      text: 'Make the client an angry father instead.',
    });
    const after = change.session;
    const clientNow = `${after.brief.client?.description ?? ''} ${after.brief.client?.characterName ?? ''}`;
    check(
      'Change: client updated to an angry father',
      /father|dad/i.test(clientNow),
      clientNow.trim().slice(0, 80),
    );
    check(
      'Change: plan proposed again',
      after.planVersion > before.session.planVersion,
      `plan version ${before.session.planVersion} → ${after.planVersion}`,
    );
  }
  await api('POST', `${BASE}/${sessionId}/abandon`, {}).catch(() => {});
}

/** Rush check: "just make the plan now" before the early stages are settled. */
async function rushScenario() {
  console.log('\n== Rush: "Just make the plan now" after the first message\n');
  const sessionId = await freshSession();
  const first = await send(sessionId, { text: FIRST });
  const rush = await send(
    sessionId,
    first.question
      ? {
          questionId: first.question.id,
          answer: { text: 'Just make the plan now.' },
        }
      : { text: 'Just make the plan now.' },
  );
  const s = settled(rush.session.brief);
  const ready = Object.values(s).every(Boolean);
  if (rush.plan) {
    check(
      'Rush: a plan appears only with learners, competency, mode and client set',
      ready,
      Object.entries(s)
        .filter(([, v]) => !v)
        .map(([k]) => `missing ${k}`)
        .join(', ') || 'all set (filled with defaults)',
    );
  } else {
    check(
      'Rush: no plan while earlier stages are open; it says what is missing or asks',
      Boolean(rush.question || rush.reply),
      rush.reply.slice(0, 140),
    );
  }
  await api('POST', `${BASE}/${sessionId}/abandon`, {}).catch(() => {});
}

await login();
const started = Date.now();
try {
  await mainScenario();
  await rushScenario();
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
