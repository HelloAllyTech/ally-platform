// TF1 round 2: the owner builds one assistant through the real admin UI (driver.mjs on :9333):
// Create → Pick a template → answers → Set it up → PDF → name → Form (audience, contact, terms) →
// Knowledge / Settings checks → crisis check + saved tests → Go live → invites → History.
//   node evals/tf1/scripts/build-r2.mjs evals/tf1/scripts/cases/r2-2-sahyog.json [--from-existing]
// (--from-existing: the template form is already open in the owner context.)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const fromExisting = process.argv.includes('--from-existing');
const who = 'owner';
async function d(cmd, args = {}) {
  const res = await fetch('http://127.0.0.1:9333/cmd', { method: 'POST', body: JSON.stringify({ who, cmd, ...args }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${cmd} ${JSON.stringify(args)}: ${text.split('\n')[0]}`);
  return text;
}
const tryd = (cmd, args) => d(cmd, args).catch((e) => console.log('  (failed: ' + e.message.slice(0, 160) + ')'));
const step = (s) => console.log(`\n## ${s}`);
const sql = (q) => execFileSync('docker', ['exec', 'ally-be-postgres-1', 'psql', '-U', 'postgres', '-d', process.env.PGDATABASE ?? 'ally_local', '-Atc', q]).toString().trim();
const slice = async (from, n) => JSON.parse(await d('eval', { js: `(()=>{const t=document.body.innerText;const i=t.indexOf(${JSON.stringify(from)});return i<0?'(not found: ${from})':t.slice(i,i+${Math.min(n,5400)})})()` })).replace(/\n+/g, ' | ');
const errors = async () => { const e = (await d('errors')).split('\n').filter((l) => l && l !== '(none)' && !/preferences|Failed to load resource/.test(l)); if (e.length) console.log('  API/console errors:\n   ' + e.join('\n   ')); };
const shot = (n) => d('shot', { name: `round2-${cfg.tag}-${n}`, full: false });
const tab = (name) => d('click', { role: 'button', name, exact: true, after: 2500 });

const resume = process.argv.includes('--resume') ? process.argv[process.argv.indexOf('--resume') + 1] : null;
let chatbotId = resume;
if (!resume) {
step('Create → template ' + cfg.template);
if (!fromExisting) {
  await d('goto', { url: 'http://localhost:8081/assistants' });
  await d('click', { role: 'button', name: 'Create a chatbot', after: 2500 });
  await d('click', { text: 'Pick a template', after: 2500 });
  const cards = await d('text', { max: 8000 });
  const titles = [...cards.matchAll(/\n([^\n]+)\n[^\n]+\n(?:Sets up:[^\n]*\n)?(?:Safety:[^\n]*\n)?Asks you/g)].map((m) => m[1]);
  const n = titles.indexOf(cfg.template);
  console.log(`  "${cfg.template}" is card #${n + 1}`);
  await d('click', { text: 'Use this template', nth: n, after: 2500 });
}
console.log('  ' + (await slice('A few questions', 900)));
const fields = 'form input:not([type=radio]):not([type=checkbox]), form textarea';
let fi = 0;
for (const a of cfg.answers) {
  if (a.kind === 'yesno') await d('click', { role: 'radio', name: a.value, exact: true });
  else if (a.kind === 'skip') fi++;
  else await d('fill', { sel: fields, nth: fi++, value: a.value });
}
console.log('  filled: ' + (await d('eval', { js: `[...document.querySelectorAll(${JSON.stringify(fields)})].map(e=>e.value.slice(0,50))` })).replace(/\s+/g, ' '));
await d('click', { role: 'button', name: 'Set it up', after: 8000 });
chatbotId = sql(`select chatbot_id from bot_drafts where owner_user_id = 25 order by "createdAt" desc limit 1`);
console.log(`  chatbot ${chatbotId}`);
console.log(`  draft: ${sql(`select coalesce(draft_config->>'purpose','-')||' | pack='||coalesce(draft_config->>'safetyPack','-')||' | langs='||coalesce((draft_config->'languages')::text,'-') from bot_drafts where chatbot_id='${chatbotId}'`)}`);
await errors();

step('PDF ' + cfg.pdf);
await d('upload', { sel: '[data-testid=sources-upload]', file: cfg.pdf, after: 3000 });
for (let i = 0; i < 30; i++) {
  const s = await slice('Sources', 120);
  if (/Ready|Waiting|review|failed/i.test(s)) break;
  await d('wait', { ms: 4000 });
}
console.log('  sources panel: ' + (await slice('Sources', 160)));
console.log(`  documents: ${sql(`select string_agg(status||' chunks='||coalesce(chunk_count,0)||' pii_review='||coalesce(pii_review::text,'-'), '; ') from kb_documents where owner_chatbot_id='${chatbotId}'`)}`);
await d('wait', { ms: 4000 });
await d('fill', { label: 'Chatbot name', value: cfg.name });
await d('press', { key: 'Tab', after: 2500 });
console.log(`  name: ${sql(`select draft_config->>'name'||' / in chat: '||coalesce(draft_config->>'displayName','-') from bot_drafts where chatbot_id='${chatbotId}'`)}`);

step('Form: audience, contact, terms');
await d('click', { text: cfg.audience, exact: true, after: 1500 });
await d('fill', { label: 'Phone number', exact: true, value: cfg.contact });
await d('click', { role: 'button', name: 'Save contact', after: 2000 });
await tryd('click', { text: 'Read the safety terms', after: 1200 });
await tryd('click', { role: 'button', name: 'I accept the safety terms', after: 2000 });
console.log('  ' + (await slice('Before going live', 520)));
await errors();

const home0 = `http://localhost:8081/assistants/${chatbotId}`;
step('Knowledge: What it knows');
await d('goto', { url: home0 });
await tab('Knowledge');
const know = await d('text', { max: 40000 });
const facts = know.split('\n').filter((l) => /\.pdf, page/.test(l)).length;
console.log(`  ${facts} facts with a page citation; held for review: ${/Waiting for you|check it for personal details/.test(know) ? 'YES' : 'no'}`);
for (const re of cfg.knowsChecks ?? []) {
  const line = know.split('\n').find((l) => new RegExp(re, 'i').test(l));
  console.log(`  /${re}/: ${line ?? 'NOT FOUND'}`);
}
await shot('what-it-knows');
await errors();

step('Settings → Safety');
await tab('Settings');
console.log('  ' + (await slice('Rules your assistant always follows', 260)));
console.log('  ' + (await slice('When someone may be at risk', 300)));
await errors();

step('Lists');
await tab('Build');
const lists = sql(`select string_agg(key||'('||(select count(*) from collection_records r where r.collection_id=c.id)||')', ', ') from collections c where chatbot_id='${chatbotId}'`);
console.log(`  lists: ${lists}`);

step('Check-up');
await d('click', { role: 'tab', name: 'Check-up', after: 2000 });
await d('click', { role: 'button', name: 'Run the crisis check', after: 2000 });
for (let i = 0; i < 20; i++) { const s = await slice('Crisis check', 300); if (/Passed|Failed|didn't/.test(s)) break; await d('wait', { ms: 4000 }); }
console.log('  ' + (await slice('Sends a message from someone at risk', 200)));
await d('click', { text: 'Advanced: saved tests', after: 2000 });
await d('click', { role: 'button', name: 'Run all', after: 3000 });
await tryd('wait', { gone: 'NOT ASKED YET', ms: 300000 });
await d('wait', { ms: 5000 });
await tryd('wait', { gone: 'Checking each answer', ms: 300000 });
await d('wait', { ms: 3000 });
for (let i = 0; i < 40; i++) await d('click', { text: 'Details', exact: true, nth: 0, after: 300, timeout: 1500 }).catch(() => (i = 99));
const ck = await slice('We asked your assistant', 9000);
console.log('  ' + ck);
await shot('checkup');
}
const home = `http://localhost:8081/assistants/${chatbotId}`;
if (resume) { await d('goto', { url: home }); await tab('Build'); }

step('Go live');
await d('click', { role: 'tab', name: 'Personality', after: 2000 });
await tryd('click', { text: 'Form', nth: 0, after: 1500 });
console.log('  badge before: ' + (await d('eval', { js: `document.body.innerText.match(/NOT LIVE YET|\\bLIVE\\b|PAUSED/)?.[0]` })));
console.log('  ' + (await slice('Before going live', 520)));
await d('click', { role: 'button', name: 'Go live', exact: true, after: 4000 });
console.log('  badge after (no reload): ' + (await d('eval', { js: `document.body.innerText.match(/NOT LIVE YET|\\bLIVE\\b|PAUSED/)?.[0]` })));
console.log('  ' + (await slice('Live.', 220)));
await shot('golive');
await errors();
console.log(`  live row: ${sql(`select c.name||' | '||c.status||' | '||c.access_mode||' | purpose='||coalesce(c.purpose,'')||' | pack='||coalesce(c.safety_pack,'')||' | memory='||coalesce((c.settings->'memory')::text,'-')||' | '||p.public_id from chatbots c join chatbot_pages p on p.chatbot_id=c.id where c.id='${chatbotId}'`)}`);
console.log(`  budget: ${sql(`select set_aside_micros/1e6 from chatbot_budgets where chatbot_id='${chatbotId}'`)}`);

step('Invites');
await d('fill', { sel: "textarea[placeholder*='name@example.com']", value: cfg.invite.join(', ') });
await d('click', { role: 'button', name: 'Add to list', after: 3000 });
console.log('  ' + (await slice('Add to list', 200)));
await errors();

step('Budget and History');
await d('goto', { url: home });
await tab('Settings');
console.log('  ' + (await slice('Set aside', 140)));
await d('click', { role: 'button', name: 'Change your assistant', after: 2500 });
await d('click', { role: 'radio', name: 'History', after: 2000 });
console.log('  ' + (await slice('History', 600)));
const page = sql(`select public_id from chatbot_pages where chatbot_id='${chatbotId}'`);
console.log(`\nRESULT ${JSON.stringify({ name: cfg.name, chatbotId, publicId: page })}`);
