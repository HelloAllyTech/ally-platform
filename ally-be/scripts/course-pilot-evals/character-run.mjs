#!/usr/bin/env node
/**
 * Course Pilot phase 5C baseline: the character interview, end to end, on fixed requests.
 *
 * A simulated admin (gpt-4o-mini, answering from hidden facts in character-briefs.json) talks to
 * the character interview over the real API until it saves a draft, then the run abandons the
 * session. Reports questions asked (and what each was about), turns, whether a draft was saved,
 * failed save attempts, fidelity of the draft to the admin's facts, tokens and time.
 *
 *   API=http://localhost:8001/api node scripts/course-pilot-evals/character-run.mjs --label base
 *   [--only id,id] [--user admin@example.com] [--concurrency 3] [--max-turns 25]
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
const USER = flag('user', 'admin@example.com');
const CONCURRENCY = Number(flag('concurrency', 3));
const MAX_TURNS = Number(flag('max-turns', 25));
const ONLY = flag('only', '').split(',').filter(Boolean);
const BASE = '/v1/scenario-characters/interview/sessions';

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
const LANGUAGE_CODES = Object.fromEntries(
  sql(`select id || '|' || "translationCode" from languages`)
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('|')),
);

let cached;
async function token() {
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.token;
  const res = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: 'Password123!' }),
  });
  const body = await res.json();
  if (!body.accessToken)
    throw new Error(`login ${USER}: ${JSON.stringify(body).slice(0, 200)}`);
  cached = { token: body.accessToken, at: Date.now() };
  return cached.token;
}
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await token()}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${path} ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

async function turn(sessionId, payload) {
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
  return frames;
}

/** What a question is about, from its words: to see the order and any repeats. */
const TOPICS = [
  [
    'kind',
    /kind of character|type of character|role|what.*character.*for|purpose|scenario/i,
  ],
  ['name', /\bname\b/i],
  ['age', /\bage\b|how old/i],
  ['gender', /gender identity|\bgender\b/i],
  ['orientation', /orientation/i],
  ['profession', /profession|occupation|job|work|career|study|student/i],
  ['location', /where.*live|location|city|town|based/i],
  ['language', /language/i],
  ['voice', /voice/i],
  [
    'situation',
    /situation|going through|struggl|problem|challenge|presenting|history|background|life/i,
  ],
  ['personality', /personality|temperament|trait|cope|coping|react/i],
  ['speech', /speak|talk|tone|style|phrases|dialect/i],
  ['knowledge', /know|knowledge/i],
  ['finish', /ready|save|draft|finish|review/i],
];
const topicOf = (prompt) =>
  TOPICS.find(([, re]) => re.test(prompt))?.[0] ?? 'other';

const STYLES = {
  cooperative: 'You answer helpfully and briefly.',
  terse:
    'You answer in a few words and pick an option whenever one is close enough.',
  'just-build':
    'You want this done fast: pick the first or recommended option unless it contradicts your facts.',
  'you-decide':
    'You have few opinions: when a question is not about your facts, say "you decide".',
};

async function adminAnswer(brief, question, reply) {
  const system =
    'You are an admin building ONE fictional character for counsellor-training roleplays with an ' +
    'AI character designer. Your facts (the AI cannot see them):\n' +
    JSON.stringify(brief.truth, null, 1) +
    '\n"any" means you have no preference. Language "en" is English, "hi" is Hindi. ' +
    STYLES[brief.style] +
    '\nAnswer as JSON: {"selectedOptionIds": [ids you pick, or empty], "text": "your words, or empty"}. ' +
    'Pick the option closest to your facts; if none fits, pick none and say what you want. For a ' +
    'voice choice, pick the first option. If asked whether to finish or save, say yes.';
  const user = question
    ? `The AI said: ${reply || '(nothing)'}\nQuestion (${question.kind}): ${question.prompt}\n` +
      `Options: ${JSON.stringify((question.options ?? []).map((o) => ({ id: o.id, label: o.label })))}`
    : `The AI said: ${reply || '(nothing)'}\nThere is no question card. Reply in one short sentence (JSON, empty selectedOptionIds).`;
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
    return { selectedOptionIds: [], text: 'You decide.' };
  }
}

function payloadFor(question, answer) {
  const labels = (question?.options ?? [])
    .filter((o) => answer.selectedOptionIds.includes(o.id))
    .map((o) => o.label);
  const message =
    [...labels, answer.text].filter(Boolean).join(' — ') || 'You decide.';
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

function score(brief, draft) {
  if (!draft) return null;
  const t = brief.truth;
  const codes = [
    ...new Set(
      Object.keys({
        ...(draft.languageCharacteristics ?? {}),
        ...(draft.voices ?? {}),
      }).map((id) => LANGUAGE_CODES[id] ?? id),
    ),
  ].sort();
  return {
    name: t.name
      ? String(draft.name ?? '')
          .toLowerCase()
          .includes(t.name.toLowerCase())
      : null,
    age:
      typeof t.age === 'number'
        ? Math.abs(Number(draft.age) - t.age) <= 3
        : null,
    gender:
      t.gender === 'any'
        ? null
        : String(draft.gender ?? '').toLowerCase() === t.gender,
    languages:
      JSON.stringify(codes) === JSON.stringify([...t.languages].sort()),
    voicesForAll: t.languages.every((code) =>
      Object.keys(draft.voices ?? {}).some((id) => LANGUAGE_CODES[id] === code),
    ),
    profileChars: String(draft.characterProfileText ?? '').length,
    knowledgeSources: (draft.knowledgeSources ?? []).length,
  };
}

async function runBrief(brief) {
  const started = Date.now();
  const session = JSON.parse(await api('POST', BASE, {}));
  const sessionId = session.id;
  const log = [];
  let payload = { message: brief.firstMessage };
  let draft = null;
  let failedSaves = 0;
  let error = null;
  try {
    for (let n = 1; n <= MAX_TURNS; n++) {
      const t0 = Date.now();
      const frames = await turn(sessionId, payload);
      const question = frames.find((f) => f.event === 'question')?.data;
      const reply = frames
        .filter((f) => f.event === 'token')
        .map((f) => f.data.delta ?? '')
        .join('')
        .trim();
      const drafted = frames.find((f) => f.event === 'character_draft')?.data;
      failedSaves += frames.filter(
        (f) =>
          f.event === 'tool_result' &&
          f.data?.name === 'save_character_draft' &&
          f.data?.ok === false,
      ).length;
      log.push({
        n,
        seconds: (Date.now() - t0) / 1000,
        question: question
          ? {
              prompt: question.prompt,
              topic: topicOf(question.prompt),
              kind: question.kind,
            }
          : null,
        drafted: Boolean(drafted),
        errors: frames
          .filter((f) => f.event === 'error')
          .map((f) => f.data?.code),
        reply: reply.slice(0, 200),
      });
      if (drafted) {
        draft = drafted.draft ?? drafted.character ?? drafted;
        break;
      }
      payload = payloadFor(question, await adminAnswer(brief, question, reply));
    }
  } catch (e) {
    error = e.message;
  }
  await api('POST', `${BASE}/${sessionId}/abandon`, {}).catch(() => {});
  const usage = sql(
    `select coalesce(sum("promptTokens"),0) || '|' || coalesce(sum("completionTokens"),0)
     from llm_usage where metadata->>'characterInterviewSessionId' = '${sessionId}'`,
  )
    .split('|')
    .map(Number);
  const topics = log.filter((l) => l.question).map((l) => l.question.topic);
  const repeats = topics.filter(
    (topic, i) => topic !== 'other' && topics.indexOf(topic) !== i,
  );
  const result = {
    id: brief.id,
    sessionId,
    drafted: Boolean(draft),
    turns: log.length,
    questions: topics.length,
    topics,
    repeatedTopics: [...new Set(repeats)],
    failedSaves,
    minutes: (Date.now() - started) / 60000,
    tokens: { prompt: usage[0], completion: usage[1] },
    fidelity: score(brief, draft),
    error,
    log,
  };
  const f = result.fidelity ?? {};
  console.log(
    `${brief.id.padEnd(22)} draft ${result.drafted ? 'yes' : 'NO '} | questions ${result.questions} | ` +
      `failed saves ${failedSaves} | lang ${f.languages ?? '-'} voices ${f.voicesForAll ?? '-'} gender ${f.gender ?? '-'} age ${f.age ?? '-'} | ` +
      `${result.minutes.toFixed(1)} min${error ? ` | ERROR ${error.slice(0, 80)}` : ''}\n` +
      `   order: ${topics.join(' → ')}`,
  );
  return result;
}

const briefs = JSON.parse(
  readFileSync(join(here, 'character-briefs.json'), 'utf8'),
).filter((b) => !ONLY.length || ONLY.includes(b.id));
const queue = [...briefs];
const results = [];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const brief = queue.shift();
      results.push(
        await runBrief(brief).catch((e) => ({
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
const rate = (key) => {
  const known = ok
    .map((r) => r.fidelity?.[key])
    .filter((v) => v !== null && v !== undefined);
  return known.length
    ? `${known.filter(Boolean).length}/${known.length}`
    : null;
};
const summary = {
  label: LABEL,
  runs: results.length,
  drafted: ok.filter((r) => r.drafted).length,
  avgQuestions: avg((r) => r.questions),
  maxQuestions: Math.max(0, ...ok.map((r) => r.questions)),
  withRepeatedTopics: ok.filter((r) => r.repeatedTopics.length).length,
  failedSaves: ok.reduce((n, r) => n + r.failedSaves, 0),
  avgMinutes: avg((r) => r.minutes),
  avgPromptTokens: avg((r) => r.tokens.prompt),
  languages: rate('languages'),
  voicesForAll: rate('voicesForAll'),
  gender: rate('gender'),
  age: rate('age'),
  name: rate('name'),
  errors: results.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`),
};
console.log('\n' + JSON.stringify(summary, null, 2));
const out = join(homedir(), 'workspace/ally/course-pilot-evals');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, `character-run-${LABEL}.json`),
  JSON.stringify({ summary, results }, null, 2),
);
console.log(`Saved ${join(out, `character-run-${LABEL}.json`)}`);
