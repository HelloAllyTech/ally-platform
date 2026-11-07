import type { PatchOp } from '../type/bot-draft.type';

/**
 * The JSON Patch subset onboarding uses (RFC 6902 `add`, `replace`, `remove`), applied to a copy,
 * with the inverse ops worked out as it goes so every change can be undone. Small and in-repo on
 * purpose: the paths are allow-listed before this runs, and nothing here needs `move`, `copy` or
 * `test`.
 */
export class PatchError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

const decode = (token: string): string =>
  token.replace(/~1/g, '/').replace(/~0/g, '~');
const encode = (token: string | number): string =>
  String(token).replace(/~/g, '~0').replace(/\//g, '~1');

export function splitPath(path: string): string[] {
  if (!path.startsWith('/'))
    throw new PatchError(path, 'A path starts with "/".');
  return path.slice(1).split('/').map(decode);
}

const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

/** Apply `ops` to a deep copy of `doc`. Returns the new document and the ops that undo them. */
export function applyPatch<T extends object>(
  doc: T,
  ops: PatchOp[],
): { result: T; inverse: PatchOp[] } {
  const result = clone(doc);
  const inverse: PatchOp[] = [];
  for (const op of ops) {
    const tokens = splitPath(op.path);
    const key = tokens[tokens.length - 1];
    let parent: unknown = result;
    for (const token of tokens.slice(0, -1)) {
      parent = child(parent, token, op.path);
    }
    if (parent === null || typeof parent !== 'object') {
      throw new PatchError(op.path, 'Nothing to change at that path.');
    }

    if (Array.isArray(parent)) {
      const index = key === '-' ? parent.length : Number(key);
      if (!Number.isInteger(index) || index < 0) {
        throw new PatchError(op.path, 'That is not a list position.');
      }
      const parentPath = tokens.slice(0, -1).map(encode).join('/');
      if (op.op === 'add') {
        if (index > parent.length)
          throw new PatchError(op.path, 'Past the end of the list.');
        parent.splice(index, 0, clone(op.value));
        inverse.unshift({ op: 'remove', path: `/${parentPath}/${index}` });
      } else {
        if (index >= parent.length)
          throw new PatchError(op.path, 'Nothing at that position.');
        const old = parent[index];
        if (op.op === 'replace') {
          parent[index] = clone(op.value);
          inverse.unshift({ op: 'replace', path: op.path, value: old });
        } else {
          parent.splice(index, 1);
          inverse.unshift({ op: 'add', path: op.path, value: old });
        }
      }
      continue;
    }

    const record = parent as Record<string, unknown>;
    const had = Object.prototype.hasOwnProperty.call(record, key);
    const old = record[key];
    if (op.op === 'remove') {
      if (!had) throw new PatchError(op.path, 'Nothing to remove there.');
      delete record[key];
      inverse.unshift({ op: 'add', path: op.path, value: old });
    } else {
      if (op.op === 'replace' && !had) {
        throw new PatchError(op.path, 'Nothing to replace there.');
      }
      record[key] = clone(op.value);
      inverse.unshift(
        had
          ? { op: 'replace', path: op.path, value: old }
          : { op: 'remove', path: op.path },
      );
    }
  }
  return { result, inverse };
}

function child(parent: unknown, token: string, path: string): unknown {
  if (Array.isArray(parent)) {
    const index = Number(token);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new PatchError(path, 'Nothing at that position.');
    }
    return parent[index];
  }
  if (parent && typeof parent === 'object' && token in parent) {
    return (parent as Record<string, unknown>)[token];
  }
  throw new PatchError(path, 'Nothing to change at that path.');
}

/**
 * Whether `path` falls under one of `allowed` (each a prefix like `/branding` or an exact
 * `/name`). `/branding/title` is under `/branding`; `/brandingx` is not.
 */
export function pathAllowed(path: string, allowed: readonly string[]): boolean {
  return allowed.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** Whether two paths touch the same data (one is a prefix of the other). */
export function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
