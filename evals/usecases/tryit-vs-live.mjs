#!/usr/bin/env node
/**
 * The live page books where Try it books (Q4 H6, Sukoon live: "7 pm works. I'm Priya Test,
 * 98000 00031." got fees and "please contact the team" on the page, "Shall I book…?" in Try it).
 * Sends the same booking conversation through Try it (POST /chatbots/:id/test, as the owner) and
 * the live page (the bot page's stream, as a visitor), and compares the last reply: whether each
 * asks "Shall I book…?", and the tools each run called. Exits 1 when they differ.
 *
 *   node evals/usecases/tryit-vs-live.mjs --assistant b1-dragarwal [--setup 2026-11-22] [--runs 3]
 *
 * Local only. The owner token is read from ~/.ally-local-token.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', '..', 'ally-be', 'package.json'));
const { Pool } = require('pg');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const API = arg('api', 'http://localhost:8001');
if (!/localhost|127\.0\.0\.1/.test(API)) {
  console.error('Local only.');
  process.exit(2);
}
const key = arg('assistant', 'b1-dragarwal');
const runs = Number(arg('runs', '1'));
const setup = JSON.parse(fs.readFileSync(path.join(here, 'results', `setup-${arg('setup', '2026-11-22')}.json`), 'utf8'))[key];
const token = fs.readFileSync(path.join(os.homedir(), '.ally-local-token'), 'utf8').trim();
const db = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:password@localhost:5477/ally_local' });

/** The booking conversation (H6), on an assistant with slots. */
export const CONVERSATION = [
  "I'd like to book an appointment tomorrow evening",
  'What times are free tomorrow evening?',
  "7 pm works. I'm Priya Test, 98000 00031. Evenings work best for me.",
];
export const ASKS_TO_BOOK = /\bshall i (?:book|register|request|send|add)\b|क्या मैं .*(?:बुक|रजिस्टर)|\bkya main .*book/i;

async function toolsOf(conversationId, since) {
  const { rows } = await db.query(
    `SELECT tool, status FROM tool_runs WHERE conversation_id = $1 AND "createdAt" >= $2::timestamptz ORDER BY "createdAt"`,
    [conversationId, since],
  );
  return rows.map((r) => `${r.tool}: ${r.status}`);
}

async function tryIt() {
  const history = [];
  const conversationId = `preview-${crypto.randomUUID()}`;
  let last = null;
  const since = new Date().toISOString();
  for (const message of CONVERSATION) {
    const res = await fetch(`${API}/api/v1/chatbots/${setup.chatbot_id}/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, history, conversationId }),
    });
    last = await res.json();
    history.push({ role: 'user', content: message }, { role: 'assistant', content: last.reply ?? '' });
  }
  return { reply: last?.reply ?? '', tools: await toolsOf(conversationId, since) };
}

async function live() {
  let cookies = '';
  const ip = `10.66.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const call = async (p, body) => {
    const res = await fetch(`${API}/api/v1/public/bots/${setup.slug}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookies, 'x-forwarded-for': ip },
      body: JSON.stringify(body ?? {}),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookies = set.map((c) => c.split(';')[0]).join('; ');
    return res;
  };
  const session = await (await call('/session', {})).json();
  if (session.intakeDone === false) await call('/intake', { answers: [] });
  const since = new Date().toISOString();
  let reply = '';
  let conversationId = null;
  for (const message of CONVERSATION) {
    const res = await call('/messages/stream', { message });
    const text = await res.text();
    const final = text.split('\n\n').find((b) => /^event: final$/m.test(b));
    const data = final ? JSON.parse(final.match(/^data: (.*)$/m)[1]) : {};
    reply = data.reply ?? data.text ?? '';
    conversationId = data.conversationId ?? data.conversation_id ?? conversationId;
  }
  if (!conversationId) {
    const { rows } = await db.query(
      `SELECT v.id FROM chatbot_conversations v WHERE v.chatbot_id = $1 AND v."createdAt" >= $2::timestamptz ORDER BY v."createdAt" DESC LIMIT 1`,
      [setup.chatbot_id, since],
    );
    conversationId = rows[0]?.id;
  }
  return { reply, tools: conversationId ? await toolsOf(conversationId, since) : [] };
}

let differ = 0;
for (let n = 1; n <= runs; n++) {
  const [a, b] = await Promise.all([tryIt(), live()]);
  const askA = ASKS_TO_BOOK.test(a.reply);
  const askB = ASKS_TO_BOOK.test(b.reply);
  if (askA !== askB) differ += 1;
  console.log(`run ${n}: Try it ${askA ? 'asks to book' : 'does not ask'} | live ${askB ? 'asks to book' : 'does not ask'}`);
  console.log(`  Try it tools: ${a.tools.join(', ') || 'none'}\n  Try it: ${a.reply.slice(0, 200)}`);
  console.log(`  live tools:   ${b.tools.join(', ') || 'none'}\n  live:   ${b.reply.slice(0, 200)}`);
}
await db.end();
process.exit(differ ? 1 : 0);
