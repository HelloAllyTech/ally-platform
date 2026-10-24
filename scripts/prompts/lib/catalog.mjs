// The prompt defaults in Git, across the three services, and the code the
// store knows each by. Each service's contracts live in code (contractsFile).
// Codes are derived exactly as each service's sync derives them:
//   ally-be        src/prompts/<path>.txt        -> <path with / as _>
//   ally-ai        app/prompts/<dir>/<name>.txt  -> ally_ai_<dir>_<name>
//   ally-ai-learn  app/prompts/<dir>/<name>.txt  -> ally_ai_learn_<dir>_<name>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

export const SERVICES = [
  {
    service: 'ally-be',
    dir: 'ally-be/src/prompts',
    prefix: '',
    needsSubdir: false,
    contractsFile: 'ally-be/src/prompt/contracts/prompt-contracts.ts',
  },
  {
    service: 'ally-ai',
    dir: 'ally-ai/app/prompts',
    prefix: 'ally_ai_',
    needsSubdir: true,
    contractsFile: 'ally-ai/app/prompts/contracts.py',
  },
  {
    service: 'ally-ai-learn',
    dir: 'ally-ai-learn/app/prompts',
    prefix: 'ally_ai_learn_',
    needsSubdir: false,
    contractsFile: 'ally-ai-learn/app/prompts/contracts.py',
  },
];

/** `{name}` placeholders, also the inner name of `{{name}}` (mirrors ally-be's placeholdersIn). */
export function placeholdersIn(body) {
  const names = new Set();
  for (const m of body.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) names.add(m[1]);
  return [...names].sort();
}

/** Same rule as ally-be's checkContract: null when satisfied or undeclared. */
export function checkContract(body, contract) {
  if (!contract) return null;
  const used = new Set(placeholdersIn(body));
  const missing = (contract.required ?? []).filter((v) => !used.has(v));
  const declared = Array.isArray(contract.variables) ? new Set(contract.variables) : null;
  const unknown = declared ? [...used].filter((v) => !declared.has(v)) : [];
  return missing.length || unknown.length ? { missing, unknown } : null;
}

export function describeViolation(v) {
  const parts = [];
  if (v.missing.length) parts.push(`missing required ${v.missing.map((n) => `{${n}}`).join(', ')}`);
  if (v.unknown.length)
    parts.push(`uses ${v.unknown.map((n) => `{${n}}`).join(', ')}, which the code doesn't supply`);
  return parts.join('; ');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '_meta') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.txt')) out.push(full);
  }
  return out;
}

/** Every default prompt: `{ service, code, file, body }`. */
export function listPrompts(root = REPO_ROOT) {
  const prompts = [];
  for (const svc of SERVICES) {
    const base = path.join(root, svc.dir);
    if (!fs.existsSync(base)) continue;
    for (const file of walk(base).sort()) {
      const rel = path.relative(base, file);
      const parts = rel.split(path.sep);
      if (svc.needsSubdir && parts.length < 2) continue; // ally-ai skips these too
      const code = svc.prefix + rel.replace(/\.txt$/, '').split(path.sep).join('_');
      prompts.push({
        service: svc.service,
        code,
        file: path.relative(root, file),
        body: fs.readFileSync(file, 'utf8'),
      });
    }
  }
  return prompts;
}
