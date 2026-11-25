// TF1: the owner builds one assistant through the real admin UI (via driver.mjs), the way case 1 was
// done by hand, printing what each step showed. Where the UI can't finish a step (N18: Go live stays
// disabled), it says so and uses the endpoint the button calls.
//
//   node evals/tf1/scripts/build-case.mjs evals/tf1/scripts/cases/2-services.json
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const tag = cfg.tag;
// Resume: node build-case.mjs <cfg> --from <n> --chatbot <id>  (steps 1-7 as numbered below)
const argv = process.argv.slice(3);
const from = Number(argv[argv.indexOf('--from') + 1] ?? 1) || 1;
const resumeId = argv.includes('--chatbot') ? argv[argv.indexOf('--chatbot') + 1] : null;
const who = 'owner';

async function d(cmd, args = {}) {
  const res = await fetch('http://127.0.0.1:9333/cmd', {
    method: 'POST',
    body: JSON.stringify({ who, cmd, ...args }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${cmd} ${JSON.stringify(args)}: ${text.split('\n')[0]}`);
  return text;
}
const step = (s) => console.log(`\n## ${s}`);
const sql = (q) =>
  execFileSync('docker', ['exec', 'ally-be-postgres-1', 'psql', '-U', 'postgres', '-d', process.env.PGDATABASE ?? 'ally_local', '-Atc', q])
    .toString()
    .trim();
const shot = (name) => d('shot', { name: `${tag}-${name}`, full: false });
const errors = async () => {
  const e = (await d('errors'))
    .split('\n')
    .filter((l) => l && !/preferences|Failed to load resource/.test(l));
  if (e.length) console.log('  API errors:', e.join('\n  '));
};
const nav = (i) => d('click', { sel: 'button.ally-home__nav-item', nth: i });

let chatbotId = resumeId;
let draftId = resumeId ? sql(`select id from bot_drafts where chatbot_id = '${resumeId}'`) : null;
if (from <= 1) {
// 1. Create → Start from scratch → From your documents → PDF.
step('a2 Create, from your documents');
await d('goto', { url: 'http://localhost:8081/assistants' });
await d('click', { role: 'button', name: 'Create a chatbot' });
await d('click', { text: 'Start from scratch' });
await d('click', { text: 'From your documents' });
await d('upload', { file: cfg.pdf });
await d('click', { text: 'Add these files', after: 3000 });
await d('wait', { ms: 30000 });
chatbotId = sql(
  `select chatbot_id from bot_drafts where owner_user_id = ${process.env.OWNER_ID ?? 25} order by "createdAt" desc limit 1`,
);
draftId = sql(`select id from bot_drafts where chatbot_id = '${chatbotId}'`);
console.log(`  chatbot ${chatbotId}, draft ${draftId}`);
console.log(`  name in working copy: ${sql(`select draft_config->>'name' from bot_drafts where id='${draftId}'`)}`);
console.log(`  document: ${sql(`select status||' chunks='||chunk_count from kb_documents where owner_chatbot_id='${chatbotId}' or id in (select (jsonb_array_elements_text(draft_config->'knowledgeDocumentIds'))::uuid from bot_drafts where id='${draftId}')`)}`);
await shot('a2-after-pdf');
await errors();
}

// 2. Knowledge → Sources to review → Approve (N2).
const home = `http://localhost:8081/assistants/${chatbotId}`;
if (from <= 2) {
step('a2 Knowledge review');
await d('goto', { url: home });
await nav(4);
const know = await d('text', { max: 40000 });
const learned = know.split('\n').filter((l) => /pdf, page/.test(l)).length;
console.log(`  "What it knows": ${learned} facts with a page citation`);
if (/Sources to review/.test(know) && /Approve/.test(know)) {
  await d('click', { role: 'button', name: 'Approve', after: 3000 });
  console.log('  approved the held source');
}
await errors();

}
if (from <= 3) {
// 3. Lists → Add from a template → the organisation card → its questions.
step(`a2 Add from a template: ${cfg.template}`);
await d('click', { text: 'Lists', nth: 0 });
await d('click', { text: 'Add from a template', after: 2500 });
const cards = await d('text', { max: 6000 });
const idx = cards.split('\n').filter((l) => l === 'Use this template →').length;
const titles = [...cards.matchAll(/\n([^\n]+)\n[^\n]+\n(?:Sets up:[^\n]*\n)?(?:Safety:[^\n]*\n)?Asks you/g)].map((m) => m[1]);
const n = titles.indexOf(cfg.template);
console.log(`  ${idx} cards; "${cfg.template}" is #${n + 1}`);
await d('click', { text: 'Use this template', nth: n, after: 2000 });
console.log('  ' + (await d('text', { max: 3000 })).split('A few questions to make it yours')[1]?.split('This adds to your assistant')[0].replace(/\n+/g, ' | '));
let ti = 0;
let ai = 0;
for (const a of cfg.answers) {
  if (a.kind === 'yesno') {
    await d('click', { role: 'radio', name: a.value, exact: true, nth: a.nth ?? 0 });
  } else if (a.kind === 'input') {
    await d('fill', { sel: 'form input:not([type=radio]):not([type=checkbox])', nth: ti++, value: a.value });
  } else {
    await d('fill', { sel: 'form textarea', nth: ai++, value: a.value });
  }
}
await d('click', { role: 'button', name: 'Set it up', after: 7000 });
console.log('  ' + (await d('text', { max: 3000 })).split('Everything your assistant can use')[1]?.split('Run the checkup')[0].replace(/\n+/g, ' | '));
await errors();
await shot('a2-template');
}

// 4. Lists and abilities as installed.
step('a2 Lists and abilities');
if (from >= 4) {
  await d('goto', { url: home });
  await nav(4);
  await d('click', { text: 'Lists', nth: 0 });
}
await d('click', { role: 'button', name: 'Done' }).catch(() => {});
const lists = await d('text', { max: 20000 });
for (const m of lists.matchAll(/What your assistant can do\n([^\n]+)/g)) console.log('  ' + m[1]);
console.log(`  lists: ${sql(`select string_agg(key, ', ') from collections where chatbot_id='${chatbotId}'`)}`);
console.log(`  pack (live): ${sql(`select safety_pack from chatbots where id='${chatbotId}'`)}`);
console.log(`  memory: ${sql(`select coalesce((settings->'memory')::text, '(unset)') from chatbots where id='${chatbotId}'`)}`);

// 5. Checkup (the template's questions).
if (from <= 5) {
step('a3 Checkup');
await nav(1);
await d('click', { text: 'Check-up', nth: 0 });
await d('click', { role: 'button', name: 'Run the crisis check', after: 2000 });
await d('wait', { ms: 45000 });
await d('click', { text: 'Advanced: saved tests' });
await d('click', { role: 'button', name: 'Run all', after: 3000 });
await d('wait', { gone: 'NOT ASKED YET', ms: 240000 }).catch(() => console.log('  (questions still not asked after 4 min)'));
await d('wait', { gone: 'Checking each answer', ms: 180000 }).catch(() => {});
const ck = await d('text', { max: 30000 });
console.log('  ' + (ck.match(/\n(\d+%)\naccurate\n([^\n]+)/)?.slice(1).join(' · ') ?? 'no score'));
for (const m of ck.matchAll(/\n“([^”]+)”\n\n(FAILED|PASSED|PARTLY[^\n]*|NOT ASKED YET)\n(?:[^\n]*\n)*?(?:\n([^\n]*(?:isn't in|must not|didn't|missed)[^\n]*))?/g))
  console.log(`  ${m[2]}: ${m[1]}${m[3] ? ' — ' + m[3] : ''}`);
await shot('a3-checkup');
}

// 6. Go live: the checklist in Build → Form.
step('b1 Go live');
if (from >= 6) {
  await d('goto', { url: home });
  await nav(1);
}
await d('click', { text: 'Personality', nth: 0 }).catch(() => {});
await d('click', { text: 'Form', nth: 0 });
await d('click', { text: cfg.audience, exact: true, after: 1500 });
await d('click', { text: cfg.purpose, exact: true, after: 1500 });
await d('fill', { label: 'Phone number', exact: true, value: cfg.contact });
await d('click', { role: 'button', name: 'Save contact', after: 2000 });
await d('click', { text: 'Read the safety terms' }).catch(() => {});
await d('click', { role: 'button', name: 'I accept the safety terms', after: 2000 }).catch(() => {});
const gate = await d('eval', {
  js: `(()=>{const t=document.body.innerText;const i=t.indexOf('Before going live');return t.slice(i,i+600)})()`,
});
console.log('  ' + gate.replace(/\\n/g, ' | ').slice(0, 600));
const live = await d('controls');
if (/"Go live"(?! \(disabled\))/.test(live)) {
  await d('click', { role: 'button', name: 'Go live', exact: true, after: 5000 });
  console.log('  Go live clicked in the UI');
} else {
  console.log('  Go live is disabled in the UI (N18); publishing through POST /v1/bot-drafts/:id/publish');
  const token = execFileSync(resolve(here, 'owner-token.sh')).toString().trim();
  const r = await fetch(`http://localhost:8001/api/v1/bot-drafts/${draftId}/publish`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ access: 'invite' }),
  });
  console.log(`  publish ${r.status}: ${(await r.text()).slice(0, 300)}`);
}
await errors();
console.log(`  live row: ${sql(`select name||' | '||status||' | '||access_mode||' | purpose='||coalesce(purpose,'') from chatbots where id='${chatbotId}'`)}`);
const page = sql(`select slug||' '||public_id from chatbot_pages where chatbot_id='${chatbotId}'`);
console.log(`  page: ${page}`);

// 7. Budget (N21) and Who may chat.
step('b2 Budget and invites');
await d('goto', { url: home });
await nav(5);
await d('fill', { label: 'Add from your free balance', value: String(cfg.budget ?? 1) });
await d('click', { role: 'button', name: 'Add credits', after: 2500 });
console.log(`  budget: ${sql(`select set_aside_micros/1e6 from chatbot_budgets where chatbot_id='${chatbotId}'`)}`);
await nav(3);
await d('fill', { sel: "textarea[placeholder*='name@example.com']", value: cfg.invite.join(', ') });
await d('click', { role: 'button', name: 'Add to list', after: 3000 });
const ch = await d('text', { max: 20000 });
console.log('  ' + (ch.match(/Added \d+\./)?.[0] ?? 'no "Added"'));
await errors();
await shot('b2-channels');
console.log(`\nRESULT ${JSON.stringify({ chatbotId, draftId, page })}`);
