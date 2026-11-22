#!/usr/bin/env node
/**
 * Run the use-case suite (EVAL-USECASES.md §3, chunk Q4 §0) against the local stack.
 *
 *   node evals/usecases/run.mjs --label baseline-1 [--setup <setup label>] [--only o1-icall,rha]
 *        [--cases b1-f01,b1-r01] [--repeat 3] [--concurrency 4] [--classifier-fail] [--no-grade] [--api http://localhost:8001]
 *
 * Every message goes through the real bot page stream (`POST v1/public/bots/:slug/messages/stream`),
 * with a fresh visitor per case; a case's turns share one chat, and a named visitor (`as`) keeps
 * their cookie across the cases of a set, as one person would. Per turn it records the reply, its
 * sources, the status-line, first-words and reply times, and reads from the database what the page
 * never shows: the crisis verdict and label (`chatbot_messages`), the tools called (`tool_runs`)
 * and what was saved (`collection_records`). Hard checks run in code (`lib.mjs`); meaning is graded
 * by the checkup grader (ally-ai `/checkup/grade`) against each turn's `shouldBe` and `facts`.
 *
 * --classifier-fail runs only the at-risk and look-alike cases, with the crisis classifier failing
 * on purpose. It refuses unless the API is local and ally-ai runs with
 * AGENT_RUNTIME__DEBUG_CRISIS_FAIL=true in a DEV environment (which ally-ai itself also requires).
 *
 * Reads ally-be/.env for the database and ally-ai. The owner token (~/.ally-local-token) is needed
 * only for the seeded order (B3) and the Updates change (O6). Never run beside Docker Playwright.
 * Writes results/<label>.json and results/<label>.md.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkTurn,
  classifierFailAllowed,
  expectFor,
  gradeExpect,
  median,
  verdictOf,
} from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const require = createRequire(join(root, 'ally-be', 'package.json'));
const { Client } = require('pg');

// ---------------------------------------------------------------- arguments and environment
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at > -1 ? argv[at + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
const API = arg('api', 'http://localhost:8001').replace(/\/$/, '');
const LABEL = arg('label', `run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
const REPEAT = Number(arg('repeat', '1'));
const CONCURRENCY = Number(arg('concurrency', '4'));
const ONLY = new Set((arg('only', '') || '').split(',').filter(Boolean));
const CASES = new Set((arg('cases', '') || '').split(',').filter(Boolean));
const CLASSIFIER_FAIL = flag('classifier-fail');
const GRADE = !flag('no-grade');

const env = Object.fromEntries(
  readFileSync(join(root, 'ally-be', '.env'), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.trim().replace(/^['"]|['"]$/g, '')]),
);
const AI = (env.AI_SERVICE_API_URL || 'http://localhost:3001').replace('host.docker.internal', 'localhost');
const AI_KEY = env.AI_SERVICE_OUTBOUND_API_KEY;
const tokenFile = arg('token-file', join(homedir(), '.ally-local-token'));
const OWNER_TOKEN = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : null;

function refuse(message) {
  console.error(`Refused: ${message}`);
  process.exit(2);
}

if (CLASSIFIER_FAIL) {
  if (!classifierFailAllowed(API)) refuse('--classifier-fail runs only against a local stack.');
  const aiEnv = (name) => {
    try {
      return execFileSync('docker', ['exec', 'ally-ai-app-1', 'printenv', name], { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  };
  if (aiEnv('AGENT_RUNTIME__DEBUG_CRISIS_FAIL').toLowerCase() !== 'true') {
    refuse('start ally-ai with AGENT_RUNTIME__DEBUG_CRISIS_FAIL=true first (development only).');
  }
  if (!['DEV', 'DEVELOPMENT'].includes(aiEnv('ENV__ENV').toUpperCase())) {
    refuse('ally-ai is not a DEV environment.');
  }
}

// ---------------------------------------------------------------- inputs
const assistants = new Map(
  JSON.parse(readFileSync(join(here, 'assistants.json'), 'utf8')).assistants.map((a) => [a.key, a]),
);
const setupLabel =
  arg('setup') ??
  readdirSync(join(here, 'results'))
    .filter((f) => /^setup-.*\.json$/.test(f))
    .sort()
    .at(-1)
    ?.replace(/^setup-|\.json$/g, '');
if (!setupLabel) refuse('no setup results: run setup.py first.');
const setup = JSON.parse(readFileSync(join(here, 'results', `setup-${setupLabel}.json`), 'utf8'));

const sets = readdirSync(join(here, 'sets'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f.replace(/\.json$/, ''), ...JSON.parse(readFileSync(join(here, 'sets', f), 'utf8')) }))
  .filter((s) => !ONLY.size || ONLY.has(s.file) || ONLY.has(s.assistant));

// ---------------------------------------------------------------- database
const db = new Client({
  host: env.DB_HOST === 'postgres' ? 'localhost' : env.DB_HOST,
  port: env.DB_HOST === 'postgres' ? 5477 : Number(env.DB_PORT),
  database: env.DB_DATABASE,
  user: env.DB_USERNAME,
  password: env.DB_PASSWORD,
});

async function corpusOf(chatbotId) {
  const { rows } = await db.query(
    `SELECT coalesce(string_agg(d.raw_text, ' '), '') AS docs
       FROM kb_documents d
      WHERE d.owner_chatbot_id = $1
         OR d.id IN (SELECT document_id FROM chatbot_documents WHERE chatbot_id = $1)`,
    [chatbotId],
  );
  const bot = await db.query(`SELECT coalesce(settings::text,'') || ' ' || coalesce(persona::text,'') AS s FROM chatbots WHERE id = $1`, [chatbotId]);
  const recs = await db.query(`SELECT coalesce(string_agg(data::text, ' '), '') AS r FROM collection_records WHERE chatbot_id = $1`, [chatbotId]);
  return `${rows[0].docs} ${bot.rows[0]?.s ?? ''} ${recs.rows[0].r}`;
}

async function contextOf(chatbotId) {
  const { rows } = await db.query(`SELECT settings, persona FROM chatbots WHERE id = $1`, [chatbotId]);
  const s = rows[0]?.settings ?? {};
  const p = rows[0]?.persona ?? {};
  return { declineText: s.declineText ?? '', about: [p.greeting, p.systemPrompt].filter(Boolean).join('\n') };
}

async function turnFacts({ chatbotId, messageId, conversationId, since, list, caseStart }) {
  const msg = messageId
    ? (await db.query(`SELECT handled_by, retrieval_meta, citations FROM chatbot_messages WHERE id = $1`, [messageId])).rows[0]
    : null;
  const steps = conversationId
    ? (
        await db.query(
          `SELECT tool, status, error_code FROM tool_runs WHERE conversation_id = $1 AND "createdAt" >= $2 ORDER BY "createdAt", step`,
          [conversationId, since],
        )
      ).rows.map((r) => `${r.tool}: ${r.status === 'ok' ? 'ok' : r.error_code || r.status}`)
    : [];
  let records;
  if (list) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM collection_records r JOIN collections c ON c.id = r.collection_id
        WHERE r.chatbot_id = $1 AND c.key = $2 AND r.deleted_at IS NULL AND r."createdAt" >= $3`,
      [chatbotId, list, caseStart],
    );
    records = rows[0].n;
  }
  return { handledBy: msg?.handled_by ?? null, retrieval: msg?.retrieval_meta ?? {}, storedCitations: msg?.citations ?? [], steps, records };
}

// ---------------------------------------------------------------- the bot page, as a visitor
class Visitor {
  constructor(slug, email) {
    this.slug = slug;
    this.email = email;
    this.cookies = new Map();
    this.ready = false;
    this.refused = false;
  }

  headers(json = true) {
    const h = { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (json) h['content-type'] = 'application/json';
    return h;
  }

  keep(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const at = pair.indexOf('=');
      this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }

  async call(method, path, body) {
    const res = await fetch(`${API}/api/v1/public/bots/${this.slug}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.keep(res);
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }

  async start() {
    if (this.ready) return;
    if (!this.email) {
      const r = await this.call('POST', '/session', {});
      if (r.status >= 300) throw new Error(`session ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
      this.session = r.data;
    } else {
      const since = new Date().toISOString();
      await this.call('POST', '/session', { email: this.email });
      const code = await devCode(this.email, since);
      if (!code) {
        this.refused = true;
        return;
      }
      const r = await this.call('POST', '/otp/verify', { email: this.email, code });
      if (r.status >= 300) {
        this.refused = true;
        return;
      }
      this.session = r.data;
    }
    if (this.session && this.session.intakeDone === false) await this.intake();
    this.ready = true;
  }

  async intake() {
    const page = await this.call('GET', '');
    const fields = page.data?.prechat ?? page.data?.settings?.prechat ?? [];
    const answers = fields.map((f) => ({
      id: f.id,
      value:
        f.type === 'consent' ? 'true'
        : f.type === 'phone' ? '9800000000'
        : f.type === 'email' ? 'visitor@usecases.test'
        : f.type === 'choice' ? f.options?.[0] ?? 'Other'
        : f.type === 'date' ? new Date().toISOString().slice(0, 10)
        : /name/i.test(f.label) ? 'Test Visitor' : 'Test',
    }));
    await this.call('POST', '/intake', { answers });
  }

  async newChat() {
    await this.call('POST', '/conversation/new', {});
  }

  /** One message through the SSE stream, timed. */
  async say(message) {
    const t0 = performance.now();
    const res = await fetch(`${API}/api/v1/public/bots/${this.slug}/messages/stream`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(90_000),
    });
    this.keep(res);
    if (!res.ok || !res.body) {
      return { error: `${res.status} ${(await res.text()).slice(0, 200)}`, ms: performance.now() - t0 };
    }
    let statusMs = null;
    let firstWordsMs = null;
    let final = null;
    let error = null;
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) > -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const name = block.match(/^event: (.*)$/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (!name) continue;
        const at = performance.now() - t0;
        if (name === 'status' && statusMs === null) statusMs = at;
        if (name === 'token' && firstWordsMs === null) firstWordsMs = at;
        if (name === 'final') final = JSON.parse(data);
        if (name === 'error') error = JSON.parse(data)?.code ?? 'error';
      }
    }
    const ms = performance.now() - t0;
    if (!final) return { error: error ?? 'no final event', ms, statusMs, firstWordsMs };
    return { final, ms, statusMs, firstWordsMs: firstWordsMs ?? ms };
  }
}

/** The development-only code the server logs instead of emailing (bot-page-otp.service.ts). */
async function devCode(email, since) {
  const domain = email.slice(email.lastIndexOf('@'));
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    let logs = '';
    try {
      logs = execFileSync('docker', ['logs', '--since', since, 'ally-be-app-1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      logs = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    const re = new RegExp(`email not sent\\): (\\d{6}) for \\*\\*\\*${domain.replace(/\./g, '\\.')}`, 'g');
    const codes = [...logs.matchAll(re)].map((m) => m[1]);
    if (codes.length) return codes.at(-1);
  }
  return null;
}

// ---------------------------------------------------------------- owner-side seeding
async function owner(method, path, body) {
  if (!OWNER_TOKEN) throw new Error('no owner token');
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function seedOrders(a, s, visitors) {
  for (const order of a.orders ?? []) {
    const v = visitors.get(order.person) ?? new Visitor(s.slug);
    visitors.set(order.person, v);
    await v.start();
    const hello = await v.say('Hi');
    const conv = hello.final?.conversationId;
    const { rows } = await db.query(`SELECT contact_id FROM chatbot_conversations WHERE id = $1`, [conv]);
    await owner('POST', `/chatbots/${s.chatbot_id}/lists/orders/records`, {
      data: { number: order.ref, customer: rows[0].contact_id, items: order.item, status: order.status },
    }).catch((e) => console.warn(`   order not seeded: ${e.message}`));
  }
}

async function changeUpdate(a, s) {
  const change = a.changeLater;
  const list = await owner('GET', `/chatbots/${s.chatbot_id}/lists/updates/records`);
  const rows = list.records ?? list.items ?? list;
  const row = rows.find((r) => (r.data?.title ?? r.title) === change.title);
  await owner('PATCH', `/chatbots/${s.chatbot_id}/lists/updates/records/${row.id}`, {
    data: { what_changed: change.text },
    version: row.version,
  });
}

// ---------------------------------------------------------------- grading
async function grade(c, t, observed, context) {
  const expect = gradeExpect(c.kind);
  if (!GRADE || !expect || !AI_KEY) return null;
  const body = {
    case: {
      id: c.id,
      question: t.user,
      expect,
      facts: t.facts ?? [],
      must_not: [],
      also_ok: [t.shouldBe],
      hard_fail: Boolean(c.mustPass),
    },
    observed: { ...observed, decline_text: context.declineText, about: context.about },
    judge: true,
  };
  try {
    const res = await fetch(`${AI}/api/v1/checkup/grade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': AI_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { verdict: 'error', reasons: [`grader ${res.status}`] };
    const g = await res.json();
    return { verdict: g.verdict, reasons: g.reasons, outcome: g.outcome, judge: g.judge };
  } catch (e) {
    return { verdict: 'error', reasons: [String(e.message ?? e)] };
  }
}

// ---------------------------------------------------------------- one case
async function runCase(c, a, s, visitors, corpus, context) {
  const caseStart = new Date();
  const fresh = new Map();
  // A setup entry may name its own access and invited emails (an existing page).
  const invite = (s.access ?? a.access) === 'invite';
  const emails = s.emails ?? a.staff ?? [];
  const visitorFor = (name) => {
    if (name === 'outsider') return new Visitor(s.slug, a.outsider);
    if (name) {
      if (!visitors.has(name)) visitors.set(name, new Visitor(s.slug, invite ? emails[visitors.size % emails.length] : null));
      return visitors.get(name);
    }
    if (!fresh.has('_')) fresh.set('_', new Visitor(s.slug, invite ? emails[0] : null));
    return fresh.get('_');
  };
  const turns = [];
  let prevAssistant = '';
  const history = [];
  for (const t of c.turns) {
    const v = visitorFor(t.as);
    const expect = expectFor(c.kind, t.expect ?? {});
    try {
      await v.start();
    } catch (e) {
      turns.push({ user: t.user, error: String(e.message ?? e), hard: [`session: ${e.message}`], soft: [] });
      break;
    }
    if (v.refused) {
      const r = checkTurn({ kind: c.kind, mustPass: c.mustPass, user: t.user, prevAssistant, expect, turn: { refused: true }, corpus, visitorText: '' });
      turns.push({ user: t.user, refused: true, ...r });
      continue;
    }
    if (t.newChat) await v.newChat();
    const since = new Date(Date.now() - 1000);
    const said = await v.say(t.user);
    const reply = said.final?.reply ?? '';
    const facts = await turnFacts({
      chatbotId: s.chatbot_id,
      messageId: said.final?.messageId,
      conversationId: said.final?.conversationId,
      since,
      list: expect.records?.list,
      caseStart,
    });
    const turn = { reply, error: said.error, handledBy: facts.handledBy, steps: facts.steps, records: facts.records, refused: false };
    const visitorText = c.turns.map((x) => x.user).join(' ');
    const checked = checkTurn({ kind: c.kind, mustPass: c.mustPass, user: t.user, prevAssistant, expect, turn, corpus, visitorText });
    const citations = (said.final?.citations ?? []).map((x) => ({
      chunk_id: String(x.chunk_id ?? x.chunkId ?? ''),
      document_id: String(x.document_id ?? x.documentId ?? ''),
      document_title: String(x.document_title ?? x.title ?? ''),
      source_url: String(x.source_url ?? x.url ?? ''),
    }));
    const observed = {
      reply,
      handled_by: facts.handledBy ?? '',
      turn_type: facts.retrieval?.turn_type ?? '',
      citations,
      passage_document_ids: (facts.retrieval?.passage_document_ids ?? []).map(String),
      passage_chunk_ids: (facts.retrieval?.passage_chunk_ids ?? []).map(String),
      history: [...history],
    };
    const g = said.error ? null : await grade(c, t, observed, context);
    turns.push({
      user: t.user,
      as: t.as,
      reply,
      handledBy: facts.handledBy,
      turnType: observed.turn_type,
      steps: facts.steps,
      records: facts.records,
      sources: citations.length,
      confirmation: said.final?.confirmation ?? null,
      statusMs: said.statusMs,
      firstWordsMs: said.firstWordsMs,
      ms: said.ms,
      grade: g,
      ...checked,
    });
    history.push({ role: 'user', content: t.user }, { role: 'assistant', content: reply });
    prevAssistant = reply;
  }
  return { id: c.id, kind: c.kind, lang: c.lang, mustPass: Boolean(c.mustPass), verdict: verdictOf(turns), turns };
}

// ---------------------------------------------------------------- one set, one run
async function runSet(set, run) {
  const a = assistants.get(set.assistant);
  const s = setup[set.assistant];
  if (!s?.slug) return { set: set.file, assistant: set.assistant, run, skipped: `not published (${s?.publish ?? 'no setup'})`, cases: [] };
  const corpus = await corpusOf(s.chatbot_id);
  const context = await contextOf(s.chatbot_id);
  const visitors = new Map();
  let cases = set.cases.filter((c) => c.phase !== 'after' && (!CASES.size || CASES.has(c.id)));
  if (CLASSIFIER_FAIL) cases = cases.filter((c) => c.kind === 'at_risk' || c.kind === 'lookalike');
  if (set.assistant === 'b3-tss' && !CLASSIFIER_FAIL) await seedOrders(a, s, visitors);
  const out = [];
  for (const c of cases) {
    out.push(await runCase(c, a, s, visitors, corpus, context));
    process.stdout.write(out.at(-1).verdict === 'PASS' ? '.' : out.at(-1).verdict === 'PARTIAL' ? '~' : 'x');
  }
  const after = set.cases.filter((c) => c.phase === 'after' && (!CASES.size || CASES.has(c.id)));
  if (after.length && !CLASSIFIER_FAIL) {
    try {
      await changeUpdate(a, s);
      for (const c of after) out.push(await runCase(c, a, s, visitors, corpus, context));
    } catch (e) {
      out.push({ id: after[0].id, kind: 'use_case', verdict: 'SKIPPED', turns: [], note: e.message });
    }
  }
  return { set: set.file, assistant: set.assistant, run, cases: out };
}

// ---------------------------------------------------------------- report
function pct(n, d) {
  return d ? `${Math.round((100 * n) / d)}%` : '–';
}
const sec = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`);

function report(results) {
  const lines = [
    `# Use-case suite: ${LABEL}`,
    '',
    `${new Date().toISOString()} · setup \`${setupLabel}\` · ${REPEAT} run(s)${CLASSIFIER_FAIL ? ' · **crisis classifier forced to fail**' : ''}${GRADE ? '' : ' · not graded'}`,
    '',
    '| Set | In-data right (x of runs) | PASS · PARTIAL · FAIL | Hard fails | Emergencies right | Slowest emergency | False alarms | Actions complete | Status line (median) | First words (median) | Reply (median) |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const bySet = new Map();
  for (const r of results) bySet.set(r.set, [...(bySet.get(r.set) ?? []), r]);
  const details = [];
  for (const [set, runs] of bySet) {
    const cases = runs.flatMap((r) => r.cases);
    const turns = cases.flatMap((c) => c.turns ?? []);
    const facts = cases.filter((c) => c.kind === 'fact');
    const right = facts.filter((c) => c.verdict === 'PASS').length;
    const risk = cases.filter((c) => c.kind === 'at_risk');
    const riskRight = risk.filter((c) => !c.turns.some((t) => (t.hard ?? []).includes('crisis missed'))).length;
    const riskSlowest = Math.max(0, ...risk.flatMap((c) => c.turns.map((t) => t.ms ?? 0)));
    const looks = cases.filter((c) => c.kind === 'lookalike');
    const alarms = looks.filter((c) => c.turns.some((t) => t.handledBy === 'crisis')).length;
    const actions = cases.filter((c) => c.kind === 'action');
    const hard = cases.flatMap((c) => (c.turns ?? []).flatMap((t) => (t.hard ?? []).map((h) => `${c.id}: ${h}`)));
    const count = (v) => cases.filter((c) => c.verdict === v).length;
    const skipped = runs.find((r) => r.skipped)?.skipped;
    lines.push(
      skipped
        ? `| ${set} | ${skipped} | | | | | | | | | |`
        : `| ${set} | ${right}/${facts.length} (${pct(right, facts.length)}) | ${count('PASS')} · ${count('PARTIAL')} · ${count('FAIL')} | ${hard.length} | ${riskRight}/${risk.length} | ${sec(riskSlowest)} | ${alarms}/${looks.length} | ${actions.filter((c) => c.verdict === 'PASS').length}/${actions.length} | ${sec(median(turns.map((t) => t.statusMs)))} | ${sec(median(turns.map((t) => t.firstWordsMs)))} | ${sec(median(turns.map((t) => t.ms)))} |`,
    );
    details.push(`\n## ${set}\n`);
    if (hard.length) details.push('**Hard fails**\n', ...[...new Set(hard)].map((h) => `- ${h}`), '');
    const ids = [...new Set(cases.map((c) => c.id))];
    details.push('| Case | Kind | Runs | Last reply | Problems |', '|---|---|---|---|---|');
    for (const id of ids) {
      const all = cases.filter((c) => c.id === id);
      const last = all.at(-1);
      const reply = (last.turns?.at(-1)?.reply ?? '').replace(/\s+/g, ' ').slice(0, 220).replace(/\|/g, '\\|');
      const problems = [
        ...new Set(
          all.flatMap((c) => (c.turns ?? []).flatMap((t) => [...(t.hard ?? []), ...(t.soft ?? []), ...(t.grade?.verdict === 'fail' ? [`grader: ${(t.grade.reasons ?? []).join('; ')}`] : [])])),
        ),
      ]
        .join(' · ')
        .replace(/\|/g, '\\|')
        .slice(0, 400);
      details.push(`| ${id} | ${last.kind} | ${all.map((c) => c.verdict[0]).join('')} | ${reply} | ${problems} |`);
    }
  }
  return [...lines, ...details, ''].join('\n');
}

// ---------------------------------------------------------------- main
async function main() {
  await db.connect();
  const jobs = [];
  for (let run = 1; run <= REPEAT; run++) for (const set of sets) jobs.push({ set, run });
  const results = [];
  let next = 0;
  // Sets of the same assistant never run at once (their visitors and lists overlap).
  const busy = new Set();
  async function worker() {
    for (;;) {
      const i = jobs.findIndex((j, k) => k >= 0 && !j.taken && !busy.has(j.set.assistant));
      if (i < 0) {
        if (jobs.every((j) => j.taken)) return;
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      const job = jobs[i];
      job.taken = true;
      busy.add(job.set.assistant);
      process.stdout.write(`\n[${++next}/${jobs.length}] ${job.set.file} run ${job.run} `);
      try {
        results.push(await runSet(job.set, job.run));
      } catch (e) {
        results.push({ set: job.set.file, assistant: job.set.assistant, run: job.run, skipped: `error: ${e.message}`, cases: [] });
      } finally {
        busy.delete(job.set.assistant);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await db.end();
  writeFileSync(join(here, 'results', `${LABEL}.json`), JSON.stringify({ label: LABEL, setup: setupLabel, repeat: REPEAT, classifierFail: CLASSIFIER_FAIL, results }, null, 1));
  writeFileSync(join(here, 'results', `${LABEL}.md`), report(results));
  console.log(`\nwrote evals/usecases/results/${LABEL}.md`);
}

main().catch(async (e) => {
  console.error(e);
  await db.end().catch(() => {});
  process.exit(1);
});
