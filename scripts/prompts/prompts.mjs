#!/usr/bin/env node
/**
 * prompts — work on Skills Store prompts from a laptop.
 *
 * The Skills Store (ally-be's prompt store) is the single source of truth for
 * prompt text. This CLI pulls the latest versions into a gitignored working
 * copy, shows what you changed, pushes a change back as a new candidate
 * version, and loads production's prompts into a local stack so local tests
 * run on exactly what production serves.
 *
 *   prompts pull [codes…] [--remote prod] [--candidates] [--into-local]
 *   prompts status [--remote prod]
 *   prompts diff <code> [--remote prod]
 *   prompts push <code> [--remote prod] [--note "why"] [--model m] [--provider p] [--temperature t]
 *   prompts apply-local [codes…]
 *
 * Remotes: `local` (default, http://localhost:8001) and `prod`
 * (https://api.helloally.ai), or any URL. Keys come from
 * SKILLS_STORE_<REMOTE>_KEY (e.g. SKILLS_STORE_PROD_KEY), or SKILLS_STORE_KEY.
 * Generate one in the Skills Store → Keys. URLs can be overridden with
 * SKILLS_STORE_<REMOTE>_URL.
 *
 * Working copy layout (all under .prompts/, gitignored):
 *   .prompts/<service>/<code>.txt        the text you edit
 *   .prompts/.base/<service>/<code>.txt  the text you pulled (merge base)
 *   .prompts/lock.json                   per code: remote, versions, hash, settings
 *   .prompts/export.json                 the last export, for apply-local
 *
 * No dependencies: Node 18+ (fetch) and git (merge-file, diff).
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, '.prompts');
const BASE_DIR = path.join(DIR, '.base');
const LOCK = path.join(DIR, 'lock.json');
const EXPORT = path.join(DIR, 'export.json');

const REMOTES = {
  local: 'http://localhost:8001',
  prod: 'https://api.helloally.ai',
};

// ---------------------------------------------------------------- helpers

export function hashBody(body) {
  return createHash('sha256').update(body.trim(), 'utf8').digest('hex');
}

/** Which service folder a prompt code belongs to. */
export function serviceOf(code) {
  if (code.startsWith('ally_ai_learn_')) return 'ally-ai-learn';
  if (code.startsWith('ally_ai_')) return 'ally-ai';
  return 'ally-be';
}

const fileOf = (code) => path.join(DIR, serviceOf(code), `${code}.txt`);
const baseOf = (code) => path.join(BASE_DIR, serviceOf(code), `${code}.txt`);
const rel = (p) => path.relative(process.cwd(), p) || p;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}

function remoteOf(args) {
  const name = typeof args.remote === 'string' ? args.remote : 'local';
  const upper = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const url =
    process.env[`SKILLS_STORE_${upper}_URL`] ||
    REMOTES[name] ||
    (/^https?:\/\//.test(name) ? name : null);
  if (!url) fail(`Unknown remote "${name}". Use local, prod or a URL.`);
  const key =
    process.env[`SKILLS_STORE_${upper}_KEY`] || process.env.SKILLS_STORE_KEY;
  return { name, url: url.replace(/\/$/, ''), key };
}

function fail(message, code = 1) {
  process.stderr.write(`prompts: ${message}\n`);
  process.exit(code);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
}

function readLock() {
  return readJson(LOCK, { prompts: {} });
}

function saveLock(lock) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
}

async function call(remote, method, route, body, headers = {}) {
  if (!remote.key && !headers['x-api-key']) {
    fail(
      `No key for remote "${remote.name}". Generate one in the Skills Store → Keys and set ` +
        `SKILLS_STORE_${remote.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_KEY.`,
    );
  }
  const res = await fetch(`${remote.url}/api/v1${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(remote.key ? { 'x-skills-store-key': remote.key } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((err) => fail(`Can't reach ${remote.url}: ${err.message}`));
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  return { status: res.status, ok: res.ok, data };
}

function hasLocalEdits(code, entry) {
  const file = fileOf(code);
  if (!fs.existsSync(file)) return false;
  return hashBody(fs.readFileSync(file, 'utf8')) !== entry.contentHash;
}

/** Three-way merge with git: returns { text, conflicts }. */
function merge(mine, base, theirs) {
  const tmp = fs.mkdtempSync(path.join(DIR, '.merge-'));
  const [m, b, t] = ['mine', 'base', 'theirs'].map((n) => path.join(tmp, n));
  // The store trims bodies; files end in a newline. Normalise all three, or a
  // final-line difference alone reads as a conflict at the end of the file.
  const norm = (text) => `${text.trim()}\n`;
  fs.writeFileSync(m, norm(mine));
  fs.writeFileSync(b, norm(base));
  fs.writeFileSync(t, norm(theirs));
  const out = spawnSync(
    'git',
    ['merge-file', '-p', '-L', 'yours', '-L', 'pulled', '-L', 'store', m, b, t],
    { encoding: 'utf8' },
  );
  fs.rmSync(tmp, { recursive: true, force: true });
  return { text: out.stdout, conflicts: out.status > 0 };
}

// ---------------------------------------------------------------- commands

async function pull(args) {
  const remote = remoteOf(args);
  const codes = args._.slice(1);
  const query = new URLSearchParams();
  if (codes.length) query.set('codes', codes.join(','));
  if (args.candidates) query.set('candidates', 'true');
  const res = await call(remote, 'GET', `/skills-store/export?${query}`);
  if (!res.ok) fail(`pull failed (${res.status}): ${res.data?.message}`);
  const exported = res.data;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(EXPORT, `${JSON.stringify(exported, null, 2)}\n`);

  const lock = readLock();
  const summary = { updated: 0, unchanged: 0, merged: [], conflicts: [], drafts: [] };
  for (const p of exported.prompts) {
    // Edit on top of the NEWEST version: a draft if one exists, so a push
    // never silently drops someone's unpublished draft.
    const newest = p.latest ?? p.live;
    if (!newest) continue;
    if (p.live && newest.version !== p.live.version) {
      summary.drafts.push(`${p.promptCode} (draft v${newest.version}, live v${p.live.version})`);
    }
    const prev = lock.prompts[p.promptCode];
    const theirs = newest.prompt;
    const file = fileOf(p.promptCode);
    if (prev && hasLocalEdits(p.promptCode, prev)) {
      const mine = fs.readFileSync(file, 'utf8');
      const base = fs.existsSync(baseOf(p.promptCode))
        ? fs.readFileSync(baseOf(p.promptCode), 'utf8')
        : '';
      if (hashBody(base) === hashBody(theirs)) {
        // The text didn't move: keep the edits as they are. The lock below
        // still moves to the newest version, or the next push is refused as
        // stale even though there is nothing to merge.
        summary.unchanged++;
      } else {
        const result = merge(mine, base, theirs);
        writeFile(file, result.text);
        (result.conflicts ? summary.conflicts : summary.merged).push(p.promptCode);
      }
    } else {
      if (prev && prev.contentHash === newest.contentHash) summary.unchanged++;
      else summary.updated++;
      writeFile(file, theirs);
    }
    writeFile(baseOf(p.promptCode), theirs);
    lock.prompts[p.promptCode] = {
      remote: remote.name,
      liveVersion: p.live?.version ?? null,
      latestVersion: p.latestVersion,
      contentHash: newest.contentHash,
      provider: newest.provider,
      model: newest.model,
      temperature: newest.temperature,
      contract: p.contract,
      file: path.relative(ROOT, file),
    };
  }
  lock.pulledAt = exported.exportedAt;
  lock.remote = remote.name;
  saveLock(lock);

  console.log(
    `Pulled ${exported.prompts.length} prompt(s) from ${remote.name}: ` +
      `${summary.updated} updated, ${summary.unchanged} unchanged` +
      (summary.merged.length ? `, ${summary.merged.length} merged with your edits` : '') +
      '.',
  );
  for (const d of summary.drafts) console.log(`  building on a draft: ${d}`);
  for (const c of summary.merged) console.log(`  merged:   ${rel(fileOf(c))}`);
  for (const c of summary.conflicts)
    console.log(`  CONFLICT: ${rel(fileOf(c))} — resolve the <<<<<<< markers, then push`);
  if (args['into-local']) await applyLocal({ _: [], ...args });
  if (summary.conflicts.length) process.exitCode = 2;
}

async function status(args) {
  const lock = readLock();
  const codes = Object.keys(lock.prompts);
  if (!codes.length) fail('Nothing pulled yet. Run: prompts pull --remote prod');
  const changed = codes.filter((c) => hasLocalEdits(c, lock.prompts[c]));
  const age = lock.pulledAt
    ? Math.round((Date.now() - Date.parse(lock.pulledAt)) / 36e5)
    : null;
  console.log(
    `Working copy from ${lock.remote ?? '?'}, pulled ${age ?? '?'}h ago; ${codes.length} prompt(s).`,
  );
  if (age !== null && age >= 24)
    console.log('  Pulled more than a day ago: run prompts pull before trusting a test.');
  if (!changed.length) console.log('  No local edits.');
  for (const c of changed) console.log(`  edited:  ${rel(fileOf(c))}`);

  if (args.remote) {
    const remote = remoteOf(args);
    const res = await call(remote, 'GET', `/skills-store/export?codes=${codes.join(',')}`);
    if (!res.ok) fail(`status check failed (${res.status}): ${res.data?.message}`);
    for (const p of res.data.prompts) {
      const mine = lock.prompts[p.promptCode];
      if (mine && p.latestVersion !== mine.latestVersion)
        console.log(
          `  moved:   ${p.promptCode} — ${remote.name} is at v${p.latestVersion}, you pulled v${mine.latestVersion}`,
        );
    }
  }
}

async function diff(args) {
  const code = args._[1];
  if (!code) fail('Usage: prompts diff <code> [--remote prod]');
  const file = fileOf(code);
  if (!fs.existsSync(file)) fail(`${code} isn't in the working copy. Pull it first.`);
  let against = baseOf(code);
  let label = 'pulled';
  if (args.remote) {
    const remote = remoteOf(args);
    const res = await call(remote, 'GET', `/skills-store/prompts/${code}`);
    if (!res.ok) fail(`diff failed (${res.status}): ${res.data?.message}`);
    const newest = res.data.versions[0];
    const tmp = path.join(DIR, `.diff-${code}.txt`);
    writeFile(tmp, newest.prompt);
    against = tmp;
    label = `${remote.name} v${newest.version} (${newest.status})`;
  }
  console.log(`--- ${label}\n+++ yours (${rel(file)})`);
  spawnSync('git', ['--no-pager', 'diff', '--no-index', '--color=auto', against, file], {
    stdio: 'inherit',
  });
  if (args.remote) fs.rmSync(path.join(DIR, `.diff-${code}.txt`), { force: true });
}

async function push(args) {
  const code = args._[1];
  if (!code) fail('Usage: prompts push <code> [--remote prod] [--note "why"]');
  const lock = readLock();
  const entry = lock.prompts[code];
  if (!entry) fail(`${code} isn't in the working copy. Pull it first.`);
  const remote = remoteOf(args);
  if (entry.remote !== remote.name)
    fail(
      `${code} was pulled from ${entry.remote}, so its base version means nothing on ${remote.name}. ` +
        `Pull it from ${remote.name} first.`,
    );
  const text = fs.readFileSync(fileOf(code), 'utf8');
  if (text.includes('<<<<<<<') || text.includes('>>>>>>>'))
    fail(`${rel(fileOf(code))} still has merge conflict markers. Resolve them first.`);
  if (hashBody(text) === entry.contentHash && !args.model && !args.provider && args.temperature === undefined)
    fail(`${code} has no changes to push.`);

  const res = await call(remote, 'POST', `/skills-store/prompts/${code}/versions`, {
    prompt: text,
    baseVersion: entry.latestVersion,
    provider: args.provider ?? entry.provider ?? null,
    model: args.model ?? entry.model ?? null,
    temperature:
      args.temperature !== undefined ? Number(args.temperature) : (entry.temperature ?? null),
    note: typeof args.note === 'string' ? args.note : null,
  });
  if (res.data?.errorCode === 'SKILLS_STORE_STALE_BASE') {
    fail(
      `${remote.name} has moved on: its newest version is v${res.data.details?.latestVersion}, you started from v${entry.latestVersion}.\n` +
        `  Run: prompts pull ${code} --remote ${remote.name}   (merges your edit), then push again.`,
      3,
    );
  }
  if (res.data?.errorCode === 'SKILLS_STORE_CONTRACT_VIOLATION') {
    fail(`${res.data.message}`, 4);
  }
  if (!res.ok) fail(`push failed (${res.status}): ${res.data?.message}`);

  entry.latestVersion = res.data.version;
  entry.contentHash = res.data.contentHash ?? hashBody(text);
  writeFile(baseOf(code), text);
  saveLock(lock);
  console.log(
    `Pushed ${code} as draft v${res.data.version} on ${remote.name}. ` +
      'It is not live yet: its translations run now, then publish it in the Skills Store.',
  );
}

/** ally-be's service API key for the local stack, read from ally-be/.env. */
function localApiKey() {
  if (process.env.ALLY_BE_API_KEY) return process.env.ALLY_BE_API_KEY;
  const env = path.join(ROOT, 'ally-be', '.env');
  const line = fs.existsSync(env)
    ? fs.readFileSync(env, 'utf8').split('\n').find((l) => l.startsWith('API_KEY='))
    : null;
  return line ? line.slice('API_KEY='.length).trim().replace(/^["']|["']$/g, '') : null;
}

/**
 * Serve the working copy from the LOCAL store: the last export (production's
 * live text, translations included) with your edited files laid over it.
 */
async function applyLocal(args) {
  const exported = readJson(EXPORT, null);
  if (!exported) fail('Nothing pulled yet. Run: prompts pull --remote prod');
  const only = new Set(args._.slice(1));
  const lock = readLock();
  const prompts = exported.prompts
    .filter((p) => p.live && (!only.size || only.has(p.promptCode)))
    .map((p) => {
      const file = fileOf(p.promptCode);
      const entry = lock.prompts[p.promptCode];
      if (!fs.existsSync(file) || !entry) return p;
      const text = fs.readFileSync(file, 'utf8');
      // Unedited since the pull: serve what production serves.
      if (hashBody(text) === entry.contentHash) return p;
      // Your edit: served locally in place of the live text. Translations
      // of the live text no longer match it, so they are left out.
      return {
        ...p,
        live: { ...p.live, prompt: text, contentHash: hashBody(text) },
        translations: p.translations.filter((t) => t.sourceHash !== p.live.contentHash),
        edited: true,
      };
    });
  const key = localApiKey();
  if (!key) fail('No local API key: set ALLY_BE_API_KEY or API_KEY in ally-be/.env.');
  const local = { name: 'local', url: process.env.SKILLS_STORE_LOCAL_URL || REMOTES.local };
  const res = await call(local, 'POST', '/skills-store/import', { ...exported, prompts }, { 'x-api-key': key });
  if (!res.ok) fail(`apply-local failed (${res.status}): ${res.data?.message}`);
  const edited = prompts.filter((p) => p.edited).map((p) => p.promptCode);
  console.log(
    `Local store now serves ${prompts.length} prompt(s): ${res.data.updated.length} updated, ` +
      `${res.data.created.length} created, ${res.data.unchanged.length} unchanged.` +
      (edited.length ? ` Your edits are live locally for: ${edited.join(', ')}.` : ''),
  );
  for (const f of res.data.failed ?? []) console.log(`  not imported: ${f.promptCode}: ${f.error}`);
  if (res.data.failed?.length) process.exitCode = 1;
  if (edited.length)
    console.log(
      '  Edited prompts serve English locally until translated: their translations were made from the old text.',
    );
}

const COMMANDS = { pull, status, diff, push, 'apply-local': applyLocal };

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const command = COMMANDS[args._[0]];
  if (!command) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
    process.exit(args._[0] ? 1 : 0);
  }
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
  } catch {
    fail('git is required (merge and diff).');
  }
  await command(args);
}
