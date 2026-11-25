// TF1 browser driver: one headless Chromium, one browser context per person, driven by HTTP
// commands so a tester can work through the real UI step by step. Every command and its result
// is appended to evals/tf1/runs/driver-log.jsonl (replay with replay.mjs).
//
//   node evals/tf1/scripts/driver.mjs            # listens on 127.0.0.1:9333
//   node evals/tf1/scripts/do.mjs <who> <cmd> [args…]   # see do.mjs
//
// Commands (POST /cmd {who, cmd, ...}):
//   new      {state?, mobile?}         new context for <who> (optionally from a storage state file)
//   goto     {url}
//   click    {text|role+name|sel, nth?, exact?}
//   fill     {label|ph|sel, value, nth?}
//   type     {value}                   keyboard typing into the focused element
//   press    {key}
//   upload   {sel?, file}
//   check    {label|sel}
//   select   {label|sel, value}
//   wait     {ms|text}
//   text     {sel?}                    visible text (default body)
//   controls {}                        buttons/inputs/links currently on the page
//   shot     {name, full?}
//   save     {path}                    storage state
//   eval     {js}                      page.evaluate (read-only checks)
//   url      {}
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium, devices } = createRequire(resolve(here, '../../../ally-web/package.json'))('playwright');
const runs = resolve(here, '../runs');
const shots = resolve(here, '../screenshots');
const log = resolve(runs, 'driver-log.jsonl');

const browser = await chromium.launch();
const people = new Map();

async function pageOf(who) {
  if (!people.has(who)) await open(who, {});
  return people.get(who).page;
}

async function open(who, { state, mobile }) {
  if (people.has(who)) await people.get(who).ctx.close();
  const opts = mobile ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 } };
  if (state) opts.storageState = resolve(runs, state);
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 300)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  // Every failed API call, with its body, so a silent failure in the UI is visible.
  page.on('response', async (r) => {
    if (r.status() < 400 || !/\/api\//.test(r.url())) return;
    let body = '';
    try {
      body = (await r.text()).slice(0, 300);
    } catch {}
    consoleErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${body}`);
  });
  people.set(who, { ctx, page, consoleErrors });
  return page;
}

function locate(page, a) {
  let l;
  if (a.sel) l = page.locator(a.sel);
  else if (a.role) l = page.getByRole(a.role, { name: a.name, exact: !!a.exact });
  else if (a.label) l = page.getByLabel(a.label, { exact: !!a.exact });
  else if (a.ph) l = page.getByPlaceholder(a.ph, { exact: !!a.exact });
  else if (a.text) l = page.getByText(a.text, { exact: !!a.exact });
  else throw new Error('no locator');
  return a.nth === undefined ? l.first() : l.nth(a.nth);
}

async function controls(page) {
  return page.evaluate(() => {
    const out = [];
    for (const n of document.querySelectorAll('button, input, textarea, select, a[href], [role=button], [role=tab], [role=option], [role=switch], [role=checkbox], [role=radio]')) {
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const t = (n.innerText || n.value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      out.push(`${n.tagName.toLowerCase()}${n.type ? ':' + n.type : ''}${n.getAttribute('role') ? '[' + n.getAttribute('role') + ']' : ''} "${t}"${n.getAttribute('aria-label') ? ' aria=' + n.getAttribute('aria-label') : ''}${n.getAttribute('placeholder') ? ' ph=' + n.getAttribute('placeholder') : ''}${n.getAttribute('name') ? ' name=' + n.getAttribute('name') : ''}${n.disabled ? ' (disabled)' : ''}${n.getAttribute('aria-checked') ? ' checked=' + n.getAttribute('aria-checked') : ''}${n.checked ? ' (checked)' : ''}${n.getAttribute('href') ? ' href=' + n.getAttribute('href') : ''}`);
    }
    return out.join('\n');
  });
}

async function run(a) {
  const who = a.who ?? 'owner';
  if (a.cmd === 'new') {
    await open(who, a);
    return 'ok';
  }
  const page = await pageOf(who);
  const t = a.timeout ?? 15000;
  switch (a.cmd) {
    case 'goto':
      await page.goto(a.url, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => e.message);
      await page.waitForTimeout(800);
      return page.url();
    case 'click':
      await locate(page, a).click({ timeout: t });
      await page.waitForTimeout(a.after ?? 1200);
      return 'clicked';
    case 'fill':
      await locate(page, a).fill(a.value, { timeout: t });
      return 'filled';
    case 'type':
      await page.keyboard.type(a.value, { delay: 10 });
      return 'typed';
    case 'press':
      await page.keyboard.press(a.key);
      await page.waitForTimeout(a.after ?? 800);
      return 'pressed';
    case 'upload':
      await page.locator(a.sel ?? 'input[type=file]').first().setInputFiles(resolve(here, '..', a.file));
      await page.waitForTimeout(a.after ?? 1500);
      return 'uploaded';
    case 'check':
      await locate(page, a).check({ timeout: t });
      return 'checked';
    case 'select':
      await locate(page, a).selectOption(a.value, { timeout: t });
      return 'selected';
    case 'wait':
      if (a.text) {
        await page.getByText(a.text, { exact: !!a.exact }).first().waitFor({ timeout: a.ms ?? 60000 });
        return 'seen';
      }
      if (a.gone) {
        await page.getByText(a.gone).first().waitFor({ state: 'hidden', timeout: a.ms ?? 120000 });
        return 'gone';
      }
      await page.waitForTimeout(a.ms ?? 1000);
      return 'waited';
    case 'text':
      return (await page.locator(a.sel ?? 'body').first().innerText({ timeout: t })).slice(a.from ?? 0, (a.from ?? 0) + (a.max ?? 6000));
    case 'controls':
      return controls(page);
    case 'shot': {
      const path = resolve(shots, `${a.name}.png`);
      await page.screenshot({ path, fullPage: a.full !== false });
      return path;
    }
    case 'save':
      await people.get(who).ctx.storageState({ path: resolve(runs, a.path) });
      return 'saved';
    case 'eval':
      return JSON.stringify(await page.evaluate(a.js), null, 1)?.slice(0, 6000);
    case 'url':
      return page.url();
    case 'errors':
      return people.get(who).consoleErrors.splice(0).join('\n') || '(none)';
    default:
      throw new Error(`unknown command ${a.cmd}`);
  }
}

createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const a = JSON.parse(body || '{}');
  const started = new Date().toISOString();
  let out;
  let ok = true;
  try {
    out = await run(a);
  } catch (e) {
    ok = false;
    out = String(e.message ?? e).split('\n').slice(0, 6).join('\n');
  }
  appendFileSync(log, JSON.stringify({ at: started, ...a, ok, out: typeof out === 'string' ? out.slice(0, 2000) : out }) + '\n');
  res.writeHead(ok ? 200 : 500, { 'content-type': 'text/plain' });
  res.end(String(out));
}).listen(9333, '127.0.0.1', () => console.log('driver on 127.0.0.1:9333'));
