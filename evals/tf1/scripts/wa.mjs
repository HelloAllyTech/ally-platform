// TF1: a "recorded" WhatsApp webhook, signed like Meta's, sent to the local ally-be, and the
// bot's reply read back from wa_messages (WHATSAPP_ACCESS_TOKEN is unset locally, so the send
// fails before any network call and nothing reaches Meta).
//
//   node evals/tf1/scripts/wa.mjs --from 919800000001 --text "hi"
//   node evals/tf1/scripts/wa.mjs --from 919800000001 --tap <actionId> --title "Confirm"
//
// Env: WA_APP_SECRET (the TF1 override's WHATSAPP_APP_SECRET), WA_PHONE_NUMBER_ID
// (default 900000000000001), API (default http://localhost:8001), PG* for the read-back
// (default the local docker postgres, database ally_tf1).
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../../../ally-be/package.json'));
const { Client } = require('pg');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]]);
    return acc;
  }, []),
);

// The local docker postgres password, from ally-be/docker.env (never printed).
function dockerEnv(key) {
  const line = readFileSync(resolve(here, '../../../ally-be/docker.env'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : undefined;
}

const API = process.env.API ?? 'http://localhost:8001';
const SECRET = process.env.WA_APP_SECRET;
const PNID = process.env.WA_PHONE_NUMBER_ID ?? '900000000000001';
if (!SECRET) throw new Error('WA_APP_SECRET is required');
if (!args.from) throw new Error('--from <digits> is required');

export function payload({ from, text, tap, title, list }) {
  const id = `wamid.TF1${randomUUID().replace(/-/g, '')}`;
  const message = { id, from, timestamp: String(Math.floor(Date.now() / 1000)) };
  if (tap) {
    message.type = 'interactive';
    message.interactive = list
      ? { type: 'list_reply', list_reply: { id: tap, title: title ?? '' } }
      : { type: 'button_reply', button_reply: { id: tap, title: title ?? '' } };
  } else {
    message.type = 'text';
    message.text = { body: text };
  }
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'TF1-WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: PNID },
              contacts: [{ profile: { name: args.name ?? 'TF1 tester' }, wa_id: from }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

async function send() {
  const body = JSON.stringify(payload(args));
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
  const pg = new Client({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5477),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? dockerEnv('POSTGRES_PASSWORD'),
    database: process.env.PGDATABASE ?? 'ally_tf1',
  });
  await pg.connect();
  // The DB's own clock (createdAt is timestamp without time zone), so the read-back can't miss rows.
  const started = (await pg.query('SELECT localtimestamp AS t')).rows[0].t;
  const res = await fetch(`${API}/api/v1/webhook/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    body,
  });
  console.log(`webhook ${res.status}`);
  if (!res.ok) {
    console.log(await res.text());
    await pg.end();
    process.exit(1);
  }
  // Read back every outbound row for this number written after the send.
  const waitMs = Number(args.wait ?? 90000);
  const deadline = Date.now() + waitMs;
  let rows = [];
  let quietSince = null;
  while (Date.now() < deadline) {
    const r = await pg.query(
      `SELECT m.status, m.body, m.handled_by, m.error_message
         FROM wa_messages m JOIN wa_contacts c ON c.id = m.contact_id
        WHERE c.phone_e164 IN ($1, $2) AND m.direction = 'outbound' AND m."createdAt" >= $3
        ORDER BY m."createdAt"`,
      [args.from, `+${args.from}`, started],
    );
    if (r.rows.length > rows.length) {
      rows = r.rows;
      quietSince = Date.now();
    }
    // Done once something arrived and nothing new for 6 seconds (a crisis reply can be followed
    // by a second message, so don't stop at the first).
    if (rows.length && Date.now() - quietSince > 6000) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await pg.end();
  if (!rows.length) console.log('(no reply within', waitMs / 1000, 's)');
  for (const row of rows) {
    console.log(`--- ${row.status} (${row.handled_by ?? '-'})${row.error_message ? ' error: ' + row.error_message.slice(0, 120) : ''}`);
    console.log(row.body);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await send();
