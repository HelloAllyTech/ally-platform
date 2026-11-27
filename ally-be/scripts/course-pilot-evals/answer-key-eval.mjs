#!/usr/bin/env node
/**
 * Course Pilot phase 4B measurement: does the answer-key check find real key errors, and only those?
 *
 * For each QUIZ item in the blueprints Course Copilot planned locally:
 *   1. the real quiz writer writes it (check off: COURSE_PILOT_ANSWER_CHECK unset);
 *   2. the answer-key check runs on it → natural disputes, each judged by an independent model
 *      that CAN see the key (gpt-4o): key wrong / ambiguous / key right (= a false alarm);
 *   3. the key of up to two checkable questions is deliberately broken, and the check runs again
 *      → how many planted errors it catches.
 *
 * Runs against a built ally-be (dist) and the local DB, like plan-eval.mjs.
 *   node scripts/course-pilot-evals/answer-key-eval.mjs [--limit 12] [--concurrency 4] [--label x]
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const beRoot = join(here, '../..');
const require = createRequire(join(beRoot, 'package.json'));
require('tsconfig-paths').register({
  baseUrl: join(beRoot, 'dist'),
  paths: { 'src/*': ['*'] },
});

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const LIMIT = Number(flag('limit', 12));
const CONCURRENCY = Number(flag('concurrency', 4));
const LABEL = flag(
  'label',
  new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'),
);
const OUT_DIR = join(homedir(), 'workspace/ally/course-pilot-evals');

const env = Object.fromEntries(
  readFileSync(join(beRoot, '.env'), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [
      line.slice(0, line.indexOf('=')),
      line.slice(line.indexOf('=') + 1),
    ]),
);

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require(join(beRoot, 'dist/app.module'));
const { QuizSpecialist } = require(
  join(beRoot, 'dist/course-copilot/service/specialists/quiz.specialist'),
);
const { AnswerKeyCheckSpecialist } = require(
  join(
    beRoot,
    'dist/course-copilot/service/specialists/answer-key-check.specialist',
  ),
);
const { CourseCopilotSessionRepository } = require(
  join(beRoot, 'dist/course-copilot/repository/course-copilot.repository'),
);

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
const writer = app.get(QuizSpecialist);
const checker = app.get(AnswerKeyCheckSpecialist);
const sessions = app.get(CourseCopilotSessionRepository);
if (checker.enabled) {
  console.log(
    'COURSE_PILOT_ANSWER_CHECK is on: unset it so the writer runs unchecked.',
  );
  process.exit(1);
}

/** QUIZ items in local blueprints, one per session first, newest first. */
const rows = await sessions.manager.query(`
  select s.id as "sessionId", sec->>'id' as "sectionId", it->>'id' as "itemId"
  from course_copilot_sessions s,
    jsonb_array_elements(coalesce(s."approvedBlueprint", s.blueprint)->'sections') sec,
    jsonb_array_elements(sec->'items') it
  where it->>'type' = 'QUIZ'
  order by s."createdAt" desc
  limit ${LIMIT}`);

const CHECKED = new Set(['mcq_single', 'mcq_multi', 'true_false']);
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Break the key of up to two checkable questions; returns the broken quiz and their ids. */
function plantErrors(content) {
  const broken = structuredClone(content);
  const planted = [];
  for (const q of broken.questions) {
    if (planted.length >= 2 || !CHECKED.has(q.type)) continue;
    if (q.type === 'true_false') q.correctAnswer = !q.correctAnswer;
    else {
      const wrong = q.options.find((o) => !q.correctOptionIds.includes(o.id));
      if (!wrong) continue;
      q.correctOptionIds =
        q.type === 'mcq_multi' && q.correctOptionIds.length > 1
          ? q.correctOptionIds.slice(1)
          : [wrong.id];
    }
    planted.push(q.id);
  }
  return { broken, planted };
}

function describe(q) {
  if (q.type === 'true_false')
    return { statement: q.prompt, key: String(q.correctAnswer) };
  return {
    question: q.prompt,
    kind: q.type === 'mcq_multi' ? 'choose all that apply' : 'choose one',
    options: q.options.map((o, i) => `${LETTERS[i]}. ${o.text}`),
    key: q.options
      .map((o, i) => (q.correctOptionIds.includes(o.id) ? LETTERS[i] : null))
      .filter(Boolean)
      .join(', '),
    explanation: q.explanation ?? '',
  };
}

/** Independent judge (gpt-4o, sees the key): who is right about a disputed question? */
async function judge(brief, q, dispute) {
  const body = {
    model: 'gpt-4o',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a senior trainer of helpers (counsellors, volunteers, health workers) reviewing a quiz answer key. ' +
          'Return JSON {"verdict": "key_right" | "key_wrong" | "ambiguous", "why": "one sentence"}. ' +
          '"ambiguous" = an expert could reasonably defend a different answer, so the question should be rewritten.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          learners: brief.learners ?? brief.audience ?? null,
          outcome: brief.outcome ?? brief.goal ?? null,
          question: describe(q),
          a_second_reviewer_answered: dispute.answered,
          their_reason: dispute.reason,
          they_called_it_ambiguous: dispute.ambiguous,
        }),
      },
    ],
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  try {
    return JSON.parse(json.choices[0].message.content);
  } catch {
    return { verdict: 'error', why: JSON.stringify(json).slice(0, 200) };
  }
}

async function one(row) {
  const session = await sessions.findOne({ where: { id: row.sessionId } });
  const blueprint = session.approvedBlueprint ?? session.blueprint;
  const section = blueprint.sections.find((s) => s.id === row.sectionId);
  const item = section.items.find((i) => i.id === row.itemId);
  const usageMetadata = {
    courseCopilotSessionId: session.id,
    eval: 'answer-key-eval',
  };
  const brief = session.brief ?? {};

  const t0 = Date.now();
  const written = await writer.generate({
    sessionId: session.id,
    brief,
    blueprint,
    section,
    item,
    usageMetadata,
  });
  const t1 = Date.now();
  const content = written.content;
  const checkable = content.questions.filter((q) => CHECKED.has(q.type)).length;
  const natural = await checker.check(content, brief, usageMetadata);
  const t2 = Date.now();

  const byId = new Map(content.questions.map((q) => [q.id, q]));
  const judged = await Promise.all(
    natural.map(async (d) => ({
      ...d,
      judge: await judge(brief, byId.get(d.questionId), d),
    })),
  );

  const { broken, planted } = plantErrors(content);
  const afterPlant = await checker.check(broken, brief, usageMetadata);
  const caught = planted.filter((id) =>
    afterPlant.some((d) => d.questionId === id && d.keyed !== d.answered),
  );

  const result = {
    sessionId: session.id,
    item: item.title,
    questions: content.questions.length,
    checkable,
    writeSeconds: (t1 - t0) / 1000,
    checkSeconds: (t2 - t1) / 1000,
    natural: judged,
    planted: planted.length,
    caught: caught.length,
  };
  const verdicts = judged.map((d) => d.judge.verdict).join(',') || '-';
  console.log(
    `${item.title.slice(0, 48).padEnd(48)} | ${checkable}/${content.questions.length} checkable | ` +
      `disputes ${judged.length} [${verdicts}] | planted ${caught.length}/${planted.length} | check ${result.checkSeconds}s`,
  );
  return result;
}

const results = [];
const queue = [...rows];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const row = queue.shift();
      try {
        results.push(await one(row));
      } catch (error) {
        console.log(`${row.itemId} error: ${error.message?.slice(0, 200)}`);
        results.push({ ...row, error: error.message });
      }
    }
  }),
);
await app.close();

const ok = results.filter((r) => !r.error);
const disputes = ok.flatMap((r) => r.natural);
const count = (v) => disputes.filter((d) => d.judge.verdict === v).length;
const checkTimes = ok.map((r) => r.checkSeconds).sort((a, b) => a - b);
const summary = {
  label: LABEL,
  quizzes: ok.length,
  errors: results.length - ok.length,
  questions: ok.reduce((n, r) => n + r.questions, 0),
  checkable: ok.reduce((n, r) => n + r.checkable, 0),
  disputes: disputes.length,
  judgedKeyWrong: count('key_wrong'),
  judgedAmbiguous: count('ambiguous'),
  judgedKeyRight: count('key_right'),
  quizzesWithDispute: ok.filter((r) => r.natural.length).length,
  planted: ok.reduce((n, r) => n + r.planted, 0),
  plantedCaught: ok.reduce((n, r) => n + r.caught, 0),
  medianCheckSeconds: checkTimes[Math.floor(checkTimes.length / 2)] ?? null,
};
console.log('\n' + JSON.stringify(summary, null, 2));
mkdirSync(OUT_DIR, { recursive: true });
const file = join(OUT_DIR, `answer-key-eval-${LABEL}.json`);
writeFileSync(file, JSON.stringify({ summary, results }, null, 2));
console.log(`Saved ${file}`);
process.exit(0);
