#!/usr/bin/env node
// Course Pilot test manual, tests 2-8, automated against a LOCAL ally-be (COURSE_PILOT_STAGES=true).
// The trainer is scripted: it picks the Recommended option unless the test says otherwise, and
// confirms the brief on the final check card. Each test prints PASS/FAIL with the reasons and a
// link to open the session in the admin dashboard.
//
//   node scripts/course-pilot-evals/manual-tests.mjs            # all of 2-8
//   node scripts/course-pilot-evals/manual-tests.mjs --only 3,4  # some
//   node scripts/course-pilot-evals/manual-tests.mjs --keep      # don't archive the sessions
//
// Uses the local test accounts (not admin@example.com), so it never blocks your own sessions.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const beRoot = join(here, '..', '..');
const args = process.argv.slice(2);
const only = args.includes('--only')
  ? args[args.indexOf('--only') + 1].split(',').map(Number)
  : null;
const keep = args.includes('--keep');
const API = process.env.API ?? 'http://localhost:8001/api';
const ADMIN = process.env.ADMIN ?? 'http://localhost:8081';
const USERS = [
  'multi-tenant-admin1@example.com',
  'sarah.thompson@northwindbh.org',
  'arjun.rao@helloally.ai',
];

const env = Object.fromEntries(
  readFileSync(join(beRoot, '.env'), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^"|"$/g, '')]),
);
const sql = (q) =>
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
      q,
    ],
    {
      env: { ...process.env, PGPASSWORD: env.DB_PASSWORD },
      encoding: 'utf8',
    },
  ).trim();
const LANG = Object.fromEntries(
  sql(`select id || '|' || "translationCode" from languages`)
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('|')),
);

const tokens = new Map();
async function token(user) {
  const c = tokens.get(user);
  if (c && Date.now() - c.at < 10 * 60_000) return c.token;
  const r = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: 'Password123!' }),
  });
  const t = (await r.json()).accessToken;
  if (!t) throw new Error(`login failed for ${user}`);
  tokens.set(user, { token: t, at: Date.now() });
  return t;
}
async function api(user, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await token(user)}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  if (!r.ok)
    throw new Error(`${method} ${path} ${r.status}: ${text.slice(0, 200)}`);
  return text;
}

/** One trainer session: send messages, read what came back. */
class Session {
  constructor(user) {
    this.user = user;
    this.turns = [];
  }
  async start() {
    const raw = await api(this.user, 'POST', '/v1/course-copilot/sessions', {});
    const s = JSON.parse(raw);
    this.id = s.id ?? s.session?.id;
    return this;
  }
  async send(payload) {
    const text = await api(
      this.user,
      'POST',
      `/v1/course-copilot/sessions/${this.id}/messages/stream`,
      payload,
    );
    const frames = [];
    for (const block of text.split('\n\n')) {
      const ev = block.match(/^event: (.*)$/m)?.[1];
      const data = block.match(/^data: (.*)$/m)?.[1];
      if (ev && data) {
        try {
          frames.push({ event: ev, data: JSON.parse(data) });
        } catch {}
      }
    }
    const turn = {
      sent: payload.message,
      question: frames.find((f) => f.event === 'question')?.data ?? null,
      reply: frames
        .filter((f) => f.event === 'reply' || f.event === 'token')
        .map((f) => f.data.text ?? f.data.delta ?? '')
        .join('')
        .trim(),
      status: frames.find((f) => f.event === 'done')?.data?.sessionStatus,
      errors: frames
        .filter((f) => f.event === 'error')
        .map((f) => f.data.message),
    };
    this.turns.push(turn);
    return turn;
  }
  say(message) {
    return this.send({ message });
  }
  /** Pick the recommended option (or the first); free text gets "use your recommendation". */
  answer(q, override) {
    if (override)
      return this.send({
        message: override,
        questionId: q.id,
        answer: { customValues: [override] },
      });
    const pick = q.options?.find((o) => o.recommended) ?? q.options?.[0];
    return pick
      ? this.send({
          message: pick.label,
          questionId: q.id,
          answer: { selectedOptionIds: [pick.id] },
        })
      : this.send({
          message: 'Use your recommendation.',
          questionId: q.id,
          answer: { customValues: ['Use your recommendation.'] },
        });
  }
  confirm(q, change) {
    return change
      ? this.send({
          message: `Change something — ${change}`,
          questionId: q.id,
          answer: {
            selectedOptionIds: ['change_brief'],
            customValues: [change],
          },
        })
      : this.send({
          message: 'Looks right, plan the course',
          questionId: q.id,
          answer: { selectedOptionIds: ['confirm_brief'] },
        });
  }
  /** Keep answering with the recommendation until a condition holds (or turns run out). */
  async until(stop, { maxTurns = 16, confirmCard = 'confirm' } = {}) {
    for (let i = 0; i < maxTurns; i++) {
      const last = this.turns[this.turns.length - 1];
      if (stop(last)) return last;
      if (last.status === 'AWAITING_BLUEPRINT') return last;
      if (last.question && isConfirm(last.question)) {
        if (confirmCard === 'stop') return last;
        await this.confirm(last.question);
      } else if (last.question) await this.answer(last.question);
      else await this.say('Go ahead with your recommendations.');
    }
    return this.turns[this.turns.length - 1];
  }
  async brief() {
    return JSON.parse(
      await api(this.user, 'GET', `/v1/course-copilot/sessions/${this.id}`),
    ).session;
  }
  pilot() {
    return JSON.parse(
      sql(
        `select coalesce(metadata->'coursePilot','{}')::text from course_copilot_sessions where id='${this.id}'`,
      ) || '{}',
    );
  }
  async close(force = false) {
    if (!keep || force)
      await api(
        this.user,
        'POST',
        `/v1/course-copilot/sessions/${this.id}/archive`,
      ).catch(() => {});
  }
  get link() {
    return `${ADMIN}/course-copilot/${this.id}`;
  }
  get questions() {
    return this.turns.filter((t) => t.question && !isConfirm(t.question))
      .length;
  }
}
const isConfirm = (q) => q?.options?.some((o) => o.id === 'confirm_brief');
const confirmCards = (s) => s.turns.filter((t) => isConfirm(t.question)).length;
const languageCodes = (b) => (b.shape?.languageIds ?? []).map((id) => LANG[id]);
const CLAIMS_BUILD =
  /\b(building (the|your) (course|draft)|started (the )?build(ing)?|(the )?build (has )?(started|begun|is (now )?(running|under ?way))|creating (the|your) (course )?draft now)\b/i;

// ── The tests ────────────────────────────────────────────────────────────────
// Each returns a list of failed checks (empty = PASS) plus notes.
const TESTS = {
  2: {
    name: 'A vague request',
    async run(s) {
      await s.say('Can you help me make a course for our counsellors?');
      const end = await s.until((t) => t.status === 'AWAITING_BLUEPRINT');
      const b = (await s.brief()).brief ?? {};
      const fails = [];
      if (end.status !== 'AWAITING_BLUEPRINT')
        fails.push('never reached a course plan');
      if (s.questions > 12)
        fails.push(`asked ${s.questions} questions (limit 12)`);
      if (
        !b.audience?.who ||
        !b.outcomes?.terminal ||
        !b.shape?.durationMinutes ||
        !b.shape?.languageIds?.length
      )
        fails.push(
          'brief on the right is missing learners, outcome, time or language',
        );
      const order = (s.pilot().history ?? []).map((h) => h.stage);
      const expected = [
        'intake',
        'brief.learners',
        'brief.outcomes',
        'brief.assessment',
        'brief.constraints',
        'brief.final',
      ];
      const seen = order.filter((st) => expected.includes(st));
      const outOfOrder = seen.some(
        (st, i) => i && expected.indexOf(st) < expected.indexOf(seen[i - 1]),
      );
      if (outOfOrder)
        fails.push(`steps went out of order: ${order.join(' → ')}`);
      return {
        fails,
        notes: [`${s.questions} questions`, `steps: ${order.join(' → ')}`],
      };
    },
  },
  3: {
    name: '"Just build it"',
    async run(s) {
      await s.say(
        'Make a 30 minute course in Hindi on active listening for school teachers. Just build it with your defaults.',
      );
      const atCard = await s.until((t) => isConfirm(t.question), {
        confirmCard: 'stop',
      });
      const b = (await s.brief()).brief ?? {};
      const fails = [];
      if (!isConfirm(atCard.question))
        fails.push('never showed the final check card');
      if (s.questions > 2)
        fails.push(
          `asked ${s.questions} questions before the final check (expected 0-2)`,
        );
      if (b.shape?.durationMinutes !== 30)
        fails.push(`time is ${b.shape?.durationMinutes}, not 30`);
      const langs = languageCodes(b);
      if (langs.length !== 1 || langs[0] !== 'hi')
        fails.push(`languages are [${langs}], expected exactly one Hindi`);
      return { fails, notes: [`${s.questions} questions before the card`] };
    },
  },
  4: {
    name: 'Change your mind at the end',
    async run(s) {
      await s.say(
        'I want a 60 minute course in English for new helpline volunteers on handling callers in crisis, ending in a roleplay.',
      );
      const card = await s.until((t) => isConfirm(t.question), {
        confirmCard: 'stop',
      });
      const fails = [];
      if (!isConfirm(card.question))
        return { fails: ['never showed the final check card'], notes: [] };
      const after = await s.confirm(card.question, 'make it 30 minutes');
      const again = await s.until(
        (t) => isConfirm(t.question) || t.status === 'AWAITING_BLUEPRINT',
        { confirmCard: 'stop' },
      );
      const b = (await s.brief()).brief ?? {};
      if (b.shape?.durationMinutes !== 30)
        fails.push(`time is ${b.shape?.durationMinutes} after asking for 30`);
      if (
        after.status === 'AWAITING_BLUEPRINT' ||
        again.status === 'AWAITING_BLUEPRINT'
      )
        fails.push(
          'a course plan appeared without confirming the changed brief',
        );
      if (!isConfirm(again.question))
        fails.push('the final check card did not come back');
      else {
        const done = await s.confirm(again.question);
        const end =
          done.status === 'AWAITING_BLUEPRINT'
            ? done
            : await s.until((t) => t.status === 'AWAITING_BLUEPRINT');
        if (end.status !== 'AWAITING_BLUEPRINT')
          fails.push('no course plan after confirming');
      }
      return { fails, notes: [`${confirmCards(s)} final check cards`] };
    },
  },
  5: {
    name: 'Go back to an earlier step',
    async run(s) {
      await s.say(
        'I want a course for helpline volunteers on handling callers in crisis.',
      );
      // Answer until the interview is past the learners step, then change the learners.
      await s.until(
        () =>
          [
            'brief.assessment',
            'brief.constraints',
            'brief.final',
            'brief.outcomes',
          ].includes(stageNow(s)),
        { confirmCard: 'stop' },
      );
      const before = s.pilot().history?.length ?? 0;
      const t = await s.say(
        'Actually the learners are school teachers, not volunteers.',
      );
      const b = (await s.brief()).brief ?? {};
      const fails = [];
      if (!/teacher/i.test(b.audience?.who ?? ''))
        fails.push(`learners still "${b.audience?.who}"`);
      if (stageNow(s) === 'intake')
        fails.push('the interview restarted from the beginning');
      if (t.errors.length) fails.push(`error: ${t.errors[0]}`);
      const end = await s.until((x) => x.status === 'AWAITING_BLUEPRINT');
      if (end.status !== 'AWAITING_BLUEPRINT')
        fails.push('never reached a course plan afterwards');
      return {
        fails,
        notes: [
          `learners now: "${b.audience?.who}"`,
          `stage after the change: ${stageNow(s)}`,
          `history entries before change: ${before}`,
        ],
      };
    },
  },
  6: {
    name: 'Try to skip ahead',
    async run(s) {
      const first = await s.say(
        'I want a course for school counsellors on supporting students after a bereavement.',
      );
      const fails = [];
      const t = await s.say('Just make the course plan now.');
      let next = t;
      // It may take one more turn to fill defaults; it must never plan without the card.
      if (!isConfirm(next.question) && next.status !== 'AWAITING_BLUEPRINT')
        next = await s.say('Use your defaults for everything.');
      if (
        t.status === 'AWAITING_BLUEPRINT' ||
        next.status === 'AWAITING_BLUEPRINT'
      )
        fails.push('produced a course plan before the brief was confirmed');
      if (!isConfirm(next.question))
        fails.push('did not show the final check card');
      return {
        fails,
        notes: [
          `first question: ${first.question?.prompt?.slice(0, 80) ?? '(none)'}`,
        ],
      };
    },
  },
  7: {
    name: 'The build needs Approve',
    async run(s) {
      await s.say(
        'Make a 30 minute course in English on active listening for peer supporters, assessed by a quiz. Use your defaults.',
      );
      const end = await s.until((t) => t.status === 'AWAITING_BLUEPRINT');
      if (end.status !== 'AWAITING_BLUEPRINT')
        return { fails: ['never reached a course plan'], notes: [] };
      const t = await s.say('yes, build it');
      const text = [t.reply, t.question?.prompt].filter(Boolean).join(' ');
      const session = await s.brief();
      const fails = [];
      if (CLAIMS_BUILD.test(text))
        fails.push(`claimed the build started: "${text.slice(0, 160)}"`);
      if (!/approve/i.test(text))
        fails.push(
          `did not tell the trainer to click Approve: "${text.slice(0, 160)}"`,
        );
      if (session.status !== 'AWAITING_BLUEPRINT')
        fails.push(`status moved to ${session.status} without Approve`);
      return { fails, notes: [`reply: "${text.slice(0, 140)}"`] };
    },
  },
  8: {
    name: 'Skill targets on one card',
    async run(s) {
      await s.say(
        'I want a 60 minute course in English for helpline volunteers on assessing suicide risk and showing empathy, assessed by a roleplay.',
      );
      await s.until((t) => isConfirm(t.question), { confirmCard: 'stop' });
      const q = s.pilot().questions ?? {};
      const targetCards = s.turns.filter((t) =>
        (t.question?.options ?? []).some((o) =>
          /A[1-4]\s*\/\s*B[1-3]/.test(o.label),
        ),
      );
      const perSkillCards = s.turns.filter(
        (t) =>
          /\b(level|depth)\b.*\bA\b|\bA[- ]level\b|transfer level/i.test(
            t.question?.prompt ?? '',
          ) &&
          !(t.question?.options ?? []).some((o) =>
            /A[1-4]\s*\/\s*B[1-3]/.test(o.label),
          ),
      );
      const fails = [];
      if ((q['brief.outcomes'] ?? 0) > 2)
        fails.push(
          `spent ${q['brief.outcomes']} questions on outcome + skill targets (expected ≤ 2)`,
        );
      if (!targetCards.length)
        fails.push(
          'no card offering complete target sets (like "Risk A2/B2 · Empathy A3/B2")',
        );
      if (perSkillCards.length)
        fails.push(`${perSkillCards.length} separate per-skill level card(s)`);
      return {
        fails,
        notes: targetCards.map(
          (t) =>
            `card: ${t.question.prompt.slice(0, 70)} | e.g. ${t.question.options[0].label.slice(0, 60)}`,
        ),
      };
    },
  },
};
function stageNow(s) {
  const h = s.pilot().history ?? [];
  return h.length ? h[h.length - 1].stage : 'intake';
}

// ── Run ──────────────────────────────────────────────────────────────────────
// Start clean: the test accounts' leftover in-progress sessions are archived (test accounts only,
// never admin@example.com). During the run each lane archives only its OWN finished session.
sql(
  `update course_copilot_sessions set status = 'ARCHIVED' where status in ('INTERVIEWING','AWAITING_BLUEPRINT')
     and "createdBy" in (select id from users where email in (${USERS.map((u) => `'${u}'`).join(',')}))`,
);
const ids = Object.keys(TESTS)
  .map(Number)
  .filter((n) => !only || only.includes(n));
const queue = [...ids];
const results = [];
const lanes = USERS.flatMap((u) => [u, u]); // 2 courses in progress per account
await Promise.all(
  lanes.map(async (user) => {
    let previous = null; // this lane's last kept session
    while (queue.length) {
      if (previous) await previous.close(true);
      const n = queue.shift();
      let s;
      try {
        s = await new Session(user).start();
      } catch (e) {
        results.push({
          n,
          fails: [
            `could not start a session: ${e instanceof Error ? e.message : e}`,
          ],
          notes: [],
          link: '-',
          turns: 0,
        });
        continue;
      }
      process.stdout.write(`… Test ${n}: ${TESTS[n].name}\n`);
      let r;
      try {
        r = await TESTS[n].run(s);
      } catch (e) {
        r = {
          fails: [`crashed: ${e instanceof Error ? e.message : e}`],
          notes: [],
        };
      }
      results.push({ n, ...r, link: s.link, turns: s.turns.length });
      if (keep) previous = s;
      else await s.close();
    }
  }),
);

console.log('\n════════ Course Pilot tests 2-8 ════════');
for (const r of results.sort((a, b) => a.n - b.n)) {
  console.log(
    `\n${r.fails.length ? '❌ FAIL' : '✅ PASS'}  Test ${r.n}: ${TESTS[r.n].name}  (${r.turns} turns)`,
  );
  for (const f of r.fails) console.log(`   ✗ ${f}`);
  for (const note of r.notes) console.log(`   · ${note}`);
  console.log(`   ${r.link}${keep ? '' : '  (archived)'}`);
}
const passed = results.filter((r) => !r.fails.length).length;
console.log(`\n${passed} of ${results.length} passed.`);
process.exit(passed === results.length ? 0 : 1);
