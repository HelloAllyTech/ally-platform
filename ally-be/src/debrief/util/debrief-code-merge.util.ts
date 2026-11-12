import { DebriefBundle } from '../constants/debrief-release.constants';

/**
 * A change from the Skills Store or from code (Gopi, 2026-11-12): it goes
 * live on its own — unless it would overwrite something a promoted PM-agent
 * or person-proposed release set. The check is a three-way merge at the level
 * people change things: each prompt version, each setting, each step of each
 * recipe (model, fallback, on/off), a recipe's revision rounds and step
 * order, Ask Ally's model, each orchestrator setting and agent.
 *
 *   base   = what the source said before (the previous Skills Store
 *            version, or the previous code defaults)
 *   live   = the release in force
 *   code   = what the source says now
 *
 * Where only the code moved, the code's value is taken. Where only people
 * moved, theirs is kept (the code release carries it forward). Where both
 * moved to different values, it is a conflict: the release waits as a draft
 * and nothing in it goes live until a person promotes or dismisses it (one
 * conflict blocks the whole release; parts are not shipped separately).
 */

type Leaf = unknown;

const json = (v: unknown) => JSON.stringify(v ?? null);

/** Every value a person can change, by a stable path. */
export function leaves(b: Partial<DebriefBundle> | null): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  if (!b) return out;
  for (const [code, v] of Object.entries(b.prompts ?? {})) {
    out.set(`prompts.${code}`, v ?? null);
  }
  for (const [k, v] of Object.entries(b.settings ?? {})) {
    out.set(`settings.${k}`, v);
  }
  for (const [key, r] of Object.entries(b.recipes ?? {})) {
    if (!r) continue;
    out.set(`recipes.${key}.maxRevisionRounds`, r.maxRevisionRounds);
    out.set(`recipes.${key}.shortForm`, r.shortForm);
    out.set(
      `recipes.${key}.order`,
      r.steps.map((s) => s.step),
    );
    for (const s of r.steps) {
      out.set(`recipes.${key}.steps.${s.step}`, {
        model: s.model ?? null,
        backupModel: s.backupModel ?? null,
        label: s.label,
      });
    }
  }
  if (b.reply) out.set('reply', b.reply);
  if (b.orchestrator) {
    const { agents, ...rest } = b.orchestrator;
    for (const [k, v] of Object.entries(rest)) {
      out.set(`orchestrator.${k}`, v);
    }
    for (const a of agents ?? []) out.set(`orchestrator.agents.${a.id}`, a);
  }
  return out;
}

/** Set one path on a bundle (a clone the caller owns); undefined removes it. */
function setLeaf(b: DebriefBundle, path: string, value: Leaf): void {
  const parts = path.split('.');
  if (parts[0] === 'prompts') {
    if (value === undefined) delete b.prompts[parts[1]];
    else b.prompts[parts[1]] = value as number | null;
    return;
  }
  if (parts[0] === 'settings') {
    const s = b.settings as unknown as Record<string, unknown>;
    if (value === undefined) delete s[parts[1]];
    else s[parts[1]] = value;
    return;
  }
  if (parts[0] === 'reply') {
    if (value === undefined) delete b.reply;
    else b.reply = value as DebriefBundle['reply'];
    return;
  }
  if (parts[0] === 'orchestrator') {
    if (!b.orchestrator) {
      if (value === undefined) return;
      b.orchestrator = { agents: [] } as unknown as NonNullable<
        DebriefBundle['orchestrator']
      >;
    }
    const o = b.orchestrator as unknown as Record<string, any>;
    if (parts[1] === 'agents') {
      const at = o.agents.findIndex((a: { id: string }) => a.id === parts[2]);
      if (value === undefined) {
        if (at >= 0) o.agents.splice(at, 1);
      } else if (at >= 0) o.agents[at] = value;
      else o.agents.push(value);
      return;
    }
    if (value === undefined) delete o[parts[1]];
    else o[parts[1]] = value;
    return;
  }
  if (parts[0] === 'recipes') {
    const recipes = b.recipes as Record<string, any>;
    const r = recipes[parts[1]];
    if (!r) return;
    if (parts[2] === 'steps') {
      const at = r.steps.findIndex(
        (s: { step: string }) => s.step === parts[3],
      );
      if (value === undefined) {
        if (at >= 0) r.steps.splice(at, 1);
      } else {
        const step = { step: parts[3], ...(value as object) };
        if (at >= 0) r.steps[at] = step;
        else r.steps.push(step);
      }
      return;
    }
    if (parts[2] === 'order') {
      const order = value as string[];
      r.steps.sort(
        (x: { step: string }, y: { step: string }) =>
          order.indexOf(x.step) - order.indexOf(y.step),
      );
      return;
    }
    r[parts[2]] = value;
  }
}

export interface CodeMerge {
  merged: DebriefBundle;
  /** Paths the code release changed and nobody else had: taken from the code. */
  fromCode: string[];
  /** Paths people changed and the code did not: carried forward. */
  keptFromLive: string[];
  /** Paths both changed, to different values: the code would undo a promoted change. */
  conflicts: Array<{ path: string; live: Leaf; code: Leaf; base: Leaf }>;
}

/**
 * Three-way merge of a code release onto the release in force. The merged
 * bundle takes the code's value at every conflict, so promoting the waiting
 * draft "accepts the overwrite"; with no conflicts it is exactly the code's
 * changes on top of what people promoted.
 */
export function mergeCodeRelease(
  base: DebriefBundle | null,
  live: DebriefBundle,
  code: DebriefBundle,
): CodeMerge {
  const B = leaves(base);
  const L = leaves(live);
  const C = leaves(code);
  const merged = JSON.parse(JSON.stringify(live)) as DebriefBundle;
  const out: CodeMerge = {
    merged,
    fromCode: [],
    keptFromLive: [],
    conflicts: [],
  };
  const paths = new Set([...B.keys(), ...L.keys(), ...C.keys()]);
  // Steps before order, so a reorder sees every step.
  const sorted = [...paths].sort(
    (a, b) => Number(a.endsWith('.order')) - Number(b.endsWith('.order')),
  );
  for (const path of sorted) {
    const b = B.get(path);
    const l = L.get(path);
    const c = C.get(path);
    const codeMoved = json(c) !== json(b);
    const liveMoved = json(l) !== json(b);
    if (!codeMoved) {
      if (liveMoved) out.keptFromLive.push(path);
      continue;
    }
    if (liveMoved && json(l) !== json(c)) {
      out.conflicts.push({
        path,
        live: l ?? null,
        code: c ?? null,
        base: b ?? null,
      });
    } else {
      out.fromCode.push(path);
    }
    if (json(l) !== json(c)) setLeaf(merged, path, c);
  }
  return out;
}

/** A path as people say it. */
export function describePath(path: string): string {
  const p = path.split('.');
  switch (p[0]) {
    case 'prompts':
      return `the ${p[1]} prompt version`;
    case 'settings':
      return `the ${p[1]} setting`;
    case 'reply':
      return "Ask Ally's model";
    case 'orchestrator':
      return p[1] === 'agents'
        ? `the ${p[2]} agent`
        : `the orchestrator's ${p[1]}`;
    case 'recipes':
      if (p[2] === 'steps')
        return `the ${p[3].replace(/_/g, ' ')} step (${p[1]} recipe)`;
      if (p[2] === 'order') return `the step order (${p[1]} recipe)`;
      return `${p[2]} (${p[1]} recipe)`;
    default:
      return path;
  }
}
