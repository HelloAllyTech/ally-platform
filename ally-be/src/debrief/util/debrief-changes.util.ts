import { pinnedRuleName } from './debrief-pinned-rules.util';
import { DEBRIEF_PROMPT_CODES } from '../constants/debrief-release.constants';
import { confidenceOf } from './debrief-always-ask.util';
import {
  awaitingDecision,
  expiresWhileWaiting,
} from './debrief-console-view.util';
import { languageName } from './debrief-score.util';

/**
 * Debrief v2 Changes (canvas F3, the API contract in V2_AUTONOMY.md): an
 * idea (`agent_lessons` row) with its release, try-out and trial evidence, in
 * the owner's words. Pure: DebriefChangesService reads the rows.
 */
export type ChangeState =
  | 'waits'
  | 'trying'
  | 'building'
  | 'testing'
  /** Proposed; no test has started yet. */
  | 'proposed'
  | 'live'
  | 'undone'
  | 'stopped'
  | 'turned_down';

export const CHANGE_STATES: readonly ChangeState[] = [
  'waits',
  'trying',
  'building',
  'testing',
  'proposed',
  'live',
  'undone',
  'stopped',
  'turned_down',
];

export interface DebriefChange {
  id: string;
  title: string;
  kind: string;
  state: ChangeState;
  result: string;
  why: string;
  when: string;
  waitsBecause: string | null;
  confidence: 'high' | 'low' | null;
  languages: string[] | null;
  measures: Array<{
    name: string;
    value: string;
    tone: 'up' | 'down' | 'flat';
  }>;
  steps: Array<{
    name: string;
    state: string;
    detail: string;
    tone: 'pass' | 'wait' | 'fail';
  }>;
  basedOn: string;
  canUndo: boolean;
  canStop: boolean;
  /** What kind of thing changes, for code that must tell (the advisor sees pinned rules only). */
  kindKey:
    | 'pinned_rule'
    | 'prompt'
    | 'setting'
    | 'budget'
    | 'model'
    | 'code'
    | 'agents'
    | 'change';
  /** The wording before and after, for a prompt or pinned-rule change. */
  wording: { before: string; after: string } | null;
  /** One short line for the list: when, and the first measure. */
  summary: string;
  /**
   * A pinned rule in full, so the person deciding reads all of it: the rule
   * as it stands (a sign-off), or as it would read after the change, with
   * the changed passage marked. Filled by the service; null for other kinds.
   */
  rule?: {
    name: string;
    segments: Array<{ text: string; changed: boolean }>;
    stale: boolean;
  } | null;
}

/** What the mapping needs besides the idea. */
export interface ChangeContext {
  /** The release live for everyone now. */
  gaReleaseId: string | null;
  /** Owner settings the words quote. */
  canaryMinRuns: number;
  canaryMinDays: number;
  pairedMinComparisons: number;
  now?: Date;
}

/** An idea as read from `agent_lessons`. */
export interface IdeaRow {
  id: string;
  status: string;
  text?: string;
  title?: string;
  createdAt: string | Date;
  updatedAt?: string | Date;
  releaseId?: string | null;
  change?: Record<string, any> | null;
  evidence?: Record<string, any> | null;
}

/** Ideas that are not changes: a question for a person is answered, not changed. */
export function isChange(idea: IdeaRow): boolean {
  return idea.change?.ideaKind !== 'needs_person';
}

const STEP_NAMES: Record<string, string> = {
  [DEBRIEF_PROMPT_CODES.safetyReader]: 'Safety reader',
  [DEBRIEF_PROMPT_CODES.analyst]: 'Analyst',
  [DEBRIEF_PROMPT_CODES.writer]: 'Writer',
  [DEBRIEF_PROMPT_CODES.reviser]: 'Reviser',
  [DEBRIEF_PROMPT_CODES.rubric]: 'Rubric',
  [DEBRIEF_PROMPT_CODES.reply]: 'Ask Ally',
  [DEBRIEF_PROMPT_CODES.planner]: 'Planner',
  [DEBRIEF_PROMPT_CODES.protocolCheck]: 'Protocol check',
  [DEBRIEF_PROMPT_CODES.historyDeep]: 'History',
  [DEBRIEF_PROMPT_CODES.languageSpecialist]: 'Language specialist',
  [DEBRIEF_PROMPT_CODES.progress]: 'Progress',
  [DEBRIEF_PROMPT_CODES.progressReader]: 'Progress',
  debrief_quality_judge_system: 'Judge',
};

const words = (s: string) => {
  const w = String(s ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

const stepName = (code: string) => STEP_NAMES[code] ?? words(code);
const PINNED = new Set([
  DEBRIEF_PROMPT_CODES.safetyReader,
  DEBRIEF_PROMPT_CODES.rubric,
  'debrief_quality_judge_system',
]);

/** "Prompt · Writer", "Pinned rule · Safety reader", "Model · Writer", "Code · Builder". */
export function changeKindLabel(idea: IdeaRow): string {
  const c = idea.change ?? {};
  const diff = idea.evidence?.diff ?? {};
  switch (c.ideaKind) {
    case 'pinned_rule':
      return `Pinned rule · ${stepName(c.promptCode)}`;
    case 'prompt_edit':
      return `${PINNED.has(c.promptCode) ? 'Pinned rule' : 'Prompt'} · ${stepName(c.promptCode)}`;
    case 'setting':
      return `Setting · ${words(c.settingKey)}`;
    case 'test_settings':
      return 'Setting · Tests';
    case 'needs_code':
      return 'Code · Builder';
    case 'defect':
      return 'Code · Bug Hunter';
    case 'registry_agent':
    case 'default_plan':
      return 'Prompt · Agents';
    case 'release': {
      if (c.budgetOnly) return 'Budget';
      const pinned = (diff.prompts ?? []).find((p: { code: string }) =>
        PINNED.has(p.code),
      );
      if (pinned) return `Pinned rule · ${stepName(pinned.code)}`;
      const model = (diff.steps ?? []).find(
        (s: { field: string }) =>
          s.field === 'model' || s.field === 'backupModel',
      );
      if (model) return `Model · ${words(model.step)}`;
      if (diff.reply) return 'Model · Ask Ally';
      if ((diff.prompts ?? []).length) {
        return `Prompt · ${stepName(diff.prompts[0].code)}`;
      }
      if ((diff.steps ?? []).length || diff.orchestrator) return 'Agents';
      return 'Setting';
    }
    default:
      return 'Change';
  }
}

/** "12 Nov", India time. */
export function shortDate(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const n1 = (x: unknown) =>
  x == null || !Number.isFinite(Number(x))
    ? '–'
    : (Math.round(Number(x) * 10) / 10).toFixed(1);

/** What each pinned rule does, in one sentence, for the person signing it off. */
const RULE_PURPOSE: Record<string, string> = {
  [DEBRIEF_PROMPT_CODES.safetyReader]:
    'It decides what counts as a risk cue in a roleplay.',
  [DEBRIEF_PROMPT_CODES.rubric]:
    'It decides what a good debrief must do; every debrief is scored against it.',
  debrief_quality_judge_system:
    'It tells the judge how to score every debrief.',
};

/** The waits the always-ask list covers (A1): the only ones a person must answer. */
function waitsFor(idea: IdeaRow): string | null {
  const w = awaitingDecision(idea as Parameters<typeof awaitingDecision>[0]);
  if (!w) return null;
  const e = idea.evidence ?? {};
  if (w.wait === 'pinned_rule') {
    return idea.change?.firstVersion
      ? `${RULE_PURPOSE[idea.change?.promptCode] ?? 'It decides how debriefs are checked.'} It is already in use, but the clinical advisor or the owner has not checked it yet.`
      : 'It changes a pinned rule, so the clinical advisor or the owner decides.';
  }
  if (w.wait === 'promote_budget') return 'Budgets are the owner’s to change.';
  if (e.ask && !e.approval && expiresWhileWaiting(idea as never, w.wait)) {
    return String(e.ask.waitsBecause ?? 'It is on the always-ask list.');
  }
  if (w.wait === 'handoff') {
    return 'A person starts a hand-off to Builder or Bug Hunter.';
  }
  return null;
}

/** The state of a change (the ChangeState union). */
export function changeState(idea: IdeaRow): ChangeState {
  const e = idea.evidence ?? {};
  const kind = idea.change?.ideaKind;
  if (e.undo) return 'undone';
  if (e.stopped) return 'stopped';
  if (idea.status === 'rejected') {
    if (e.canary?.status === 'reverted') return 'stopped';
    return 'turned_down';
  }
  if (idea.status === 'retired') return 'turned_down';
  if (idea.status === 'active') return 'live';
  if (kind === 'needs_code' || kind === 'defect') {
    if (e.handoff?.status === 'filed') return e.delivery ? 'live' : 'building';
  }
  if (kind === 'pinned_rule' && idea.status === 'approved') return 'live';
  for (const k of ['screen', 'gate', 'trial'] as const) {
    const r = e[k];
    if (r && (r.passed === false || r.status === 'failed')) return 'stopped';
  }
  if (e.canary?.status === 'reverted') return 'stopped';
  if (waitsFor(idea)) return 'waits';
  if (e.canary && ['running', 'passed'].includes(e.canary.status)) {
    return 'trying';
  }
  // No test has started: an idea, or a draft waiting for its first check.
  if (!e.screen && !e.gate && !e.trial) return 'proposed';
  return 'testing';
}

/** The ladder's rungs, each with where it stands. */
export function changeSteps(
  idea: IdeaRow,
  ctx: ChangeContext,
): DebriefChange['steps'] {
  const e = idea.evidence ?? {};
  const kind = idea.change?.ideaKind;
  const steps: DebriefChange['steps'] = [];
  // A budget goes live on the owner's confirm; it runs no tests.
  if (kind === 'release' && idea.change?.budgetOnly) {
    const live = idea.status === 'active';
    return [
      {
        name: "Owner's confirm",
        state: live ? 'Done' : 'Waiting',
        detail: live
          ? shortDate(idea.updatedAt)
          : 'Budgets are the owner’s to change',
        tone: live ? 'pass' : 'wait',
      },
    ];
  }
  if (kind === 'needs_code' || kind === 'defect') {
    const filed = e.handoff?.status === 'filed';
    steps.push({
      name:
        kind === 'needs_code' ? 'Handed to Builder' : 'Reported to Bug Hunter',
      state: filed ? 'Done' : 'Not yet',
      detail: filed ? shortDate(e.handoff.at) : '',
      tone: filed ? 'pass' : 'wait',
    });
    if (kind === 'needs_code') {
      steps.push({
        name: 'Merged by an engineer',
        state: e.delivery ? 'Done' : filed ? 'Waiting' : 'Not yet',
        detail: e.delivery ? shortDate(e.delivery.at) : '',
        tone: e.delivery ? 'pass' : 'wait',
      });
    }
    return steps;
  }
  if (kind === 'pinned_rule' || kind === 'test_settings') return steps;
  const rung = (
    name: string,
    r: Record<string, any> | undefined,
    detail: (r: Record<string, any>) => string,
  ) => {
    if (!r) {
      steps.push({ name, state: 'Not yet', detail: '', tone: 'wait' });
      return;
    }
    const failed = r.passed === false || r.status === 'failed';
    const passed = r.passed === true || r.status === 'passed';
    steps.push({
      name,
      state: failed
        ? 'Did not pass'
        : passed
          ? 'Passed'
          : r.status === 'stopped'
            ? 'Stopped'
            : 'Running',
      detail: detail(r),
      tone: failed ? 'fail' : passed ? 'pass' : 'wait',
    });
  };
  rung('Quick check', e.screen, (r) =>
    r.meanDifference != null || r.lift != null
      ? `quality ${Number(r.meanDifference ?? r.lift) >= 0 ? '+' : ''}${n1(r.meanDifference ?? r.lift)} on practice sessions`
      : '',
  );
  rung('Pass test', e.gate, (r) =>
    r.error ? 'could not run' : r.reasons?.length ? String(r.reasons[0]) : '',
  );
  rung(
    'Side-by-side on real sessions',
    e.trial,
    (r) =>
      `${r.comparisons ?? 0} of ${ctx.pairedMinComparisons} sessions${r.meanDifference != null ? `, quality ${r.meanDifference >= 0 ? '+' : ''}${n1(r.meanDifference)}` : ''}`,
  );
  if (e.ask) {
    steps.push({
      name: 'A person’s yes',
      state: e.approval ? 'Given' : 'Waiting',
      detail: e.approval
        ? shortDate(e.approval.at)
        : String(e.ask.waitsBecause ?? ''),
      tone: e.approval ? 'pass' : 'wait',
    });
  }
  const c = e.canary;
  if (c?.status === 'skipped') {
    steps.push({
      name: 'Tried on some learners',
      state: 'Not needed',
      detail: 'learners don’t see this change',
      tone: 'pass',
    });
  } else {
    steps.push({
      name: 'Tried on some learners',
      state: !c
        ? 'Not yet'
        : c.status === 'reverted'
          ? 'Taken back'
          : c.status === 'stopped'
            ? 'Stopped'
            : c.status === 'running'
              ? 'Running'
              : 'Passed',
      detail: c
        ? `${pct(Number(c.share ?? 0))} of learners, ${c.canaryRuns ?? 0} of ${ctx.canaryMinRuns} debriefs`
        : '',
      tone:
        !c || c.status === 'running'
          ? 'wait'
          : ['reverted', 'stopped'].includes(c.status)
            ? 'fail'
            : 'pass',
    });
  }
  const w = e.watch;
  steps.push({
    name: 'Live for everyone',
    state: w ? 'Done' : 'Not yet',
    detail: w ? shortDate(w.liveAt) : '',
    tone: w ? 'pass' : 'wait',
  });
  if (w) {
    steps.push({
      name: 'Watched',
      state: e.undo
        ? 'Undone'
        : w.status === 'kept'
          ? 'Kept'
          : w.status === 'superseded'
            ? 'Ended'
            : 'Watching',
      detail: e.undo
        ? String(e.undo.reason ?? '')
        : w.status === 'watching'
          ? `until ${shortDate(w.until)}`
          : '',
      tone: e.undo ? 'fail' : w.status === 'watching' ? 'wait' : 'pass',
    });
  }
  return steps;
}

/** The figures that tell how it is doing. */
export function changeMeasures(idea: IdeaRow): DebriefChange['measures'] {
  const e = idea.evidence ?? {};
  const out: DebriefChange['measures'] = [];
  const last = e.watch?.last;
  if (last && last.after != null) {
    const d = last.before != null ? last.after - last.before : 0;
    out.push({
      name: 'Score since it went live',
      value:
        last.before != null
          ? `${n1(last.after)} (was ${n1(last.before)})`
          : n1(last.after),
      tone: Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down',
    });
    out.push({
      name: 'Debriefs since it went live',
      value: String(last.n ?? 0),
      tone: 'flat',
    });
  }
  const c = e.canary;
  if (c && c.canaryMedian != null) {
    const d =
      Number(c.canaryMedian) - Number(c.controlMedian ?? c.canaryMedian);
    out.push({
      name: 'Quality score with the change',
      value: `${n1(c.canaryMedian)} (without: ${n1(c.controlMedian)})`,
      tone: Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down',
    });
  }
  const t = e.trial;
  if (t && t.meanDifference != null) {
    out.push({
      name: 'Side by side, quality',
      value: `${t.meanDifference >= 0 ? '+' : ''}${n1(t.meanDifference)} over ${t.comparisons ?? 0} sessions`,
      tone:
        Math.abs(t.meanDifference) < 0.05
          ? 'flat'
          : t.meanDifference > 0
            ? 'up'
            : 'down',
    });
  }
  return out;
}

/** The headline: what it did, or where it is. */
export function changeResult(
  idea: IdeaRow,
  state: ChangeState,
  ctx: ChangeContext,
  waitsBecause: string | null,
): string {
  const e = idea.evidence ?? {};
  switch (state) {
    case 'undone':
      return `Undone on ${shortDate(e.undo.at)}${e.undo.by ? ' by a person' : ' on its own'}: ${e.undo.reason ?? 'it did worse'}.`;
    case 'stopped':
      if (e.stopped) {
        return `Stopped on ${shortDate(e.stopped.at)}${e.stopped.reason ? `: ${e.stopped.reason}` : '.'}`;
      }
      if (e.canary?.status === 'reverted') {
        return `Taken back from its try-out on learners: ${e.canary.reason ?? 'it did worse'}.`;
      }
      for (const [k, label] of [
        ['screen', 'quick check'],
        ['gate', 'pass test'],
        ['trial', 'side-by-side trial on real sessions'],
      ] as const) {
        const r = e[k];
        if (r && (r.passed === false || r.status === 'failed')) {
          return `Did not pass its ${label}${r.error ? ' (it could not run)' : ''}.`;
        }
      }
      return 'Stopped.';
    case 'turned_down':
      if (e.expiry) return 'Nobody decided within 14 days, so it was not made.';
      if (idea.status === 'retired') return 'Withdrawn.';
      return `Turned down${e.rejection?.reason ? `: ${e.rejection.reason}` : '.'}`;
    case 'waits':
      return `Waits for you. ${waitsBecause ?? ''}`.trim();
    case 'building':
      return 'Being built: an engineer merges the pull request, then it goes live.';
    case 'live': {
      const w = e.watch;
      const last = w?.last;
      const score =
        last?.after != null
          ? ` Score ${n1(last.after)}${last.before != null ? `, was ${n1(last.before)}` : ''}.`
          : '';
      if (idea.change?.ideaKind === 'test_settings') {
        return `Test settings changed on ${shortDate(idea.createdAt)}.`;
      }
      if (!w)
        return `Live for everyone${idea.updatedAt ? ` since ${shortDate(idea.updatedAt)}` : ''}.`;
      if (w.status === 'watching') {
        return `Live for everyone since ${shortDate(w.liveAt)}; watched until ${shortDate(w.until)}.${score}`;
      }
      return `Live for everyone since ${shortDate(w.liveAt)}; kept.${score}`;
    }
    case 'trying': {
      const c = e.canary;
      if (c.status === 'passed')
        return 'Passed its try-out on learners; going live for everyone.';
      return `Tried on ${pct(Number(c.share ?? 0))} of learners: ${c.canaryRuns ?? 0} of ${ctx.canaryMinRuns} debriefs, ${c.days ?? 0} of ${ctx.canaryMinDays} days.`;
    }
    case 'proposed': {
      const drafted = [
        'prompt_edit',
        'setting',
        'registry_agent',
        'default_plan',
      ].includes(String(idea.change?.ideaKind));
      return drafted
        ? 'Not tested yet: its first check starts on the next hourly run.'
        : 'An idea, not a change yet: the PM agent drafts it on its next run.';
    }
    case 'testing':
    default: {
      if (e.trial?.status === 'running') {
        return `Side by side on real sessions: ${e.trial.comparisons ?? 0} of ${ctx.pairedMinComparisons}.`;
      }
      if (e.trial?.status === 'passed')
        return 'Passed side by side; its try-out on learners starts next.';
      if (e.gate?.status === 'running') return 'In its pass test.';
      if (e.gate?.passed)
        return 'Passed its pass test; side by side on real sessions next.';
      if (e.screen?.status === 'running') return 'In its quick check.';
      if (e.screen?.passed)
        return 'Passed its quick check; the pass test is next.';
      return 'Waiting to start its tests.';
    }
  }
}

/**
 * Why the PM agent (or a person) made it; empty when nobody said, never the
 * change's own text again (that is its title).
 */
export function changeWhy(idea: IdeaRow): string {
  const e = idea.evidence ?? {};
  return String(e.hypothesis ?? e.why ?? e.expectedEffect ?? '').trim();
}

/** The evidence in one line. */
export function changeBasedOn(idea: IdeaRow): string {
  const e = idea.evidence ?? {};
  const parts: string[] = [];
  if (e.problem?.title) parts.push(String(e.problem.title));
  else if (typeof e.evidence === 'string' && e.evidence) parts.push(e.evidence);
  const comments = Array.isArray(e.commentIds) ? e.commentIds.length : 0;
  if (comments) parts.push(`${comments} comment${comments === 1 ? '' : 's'}`);
  const metrics = Array.isArray(e.metrics) ? e.metrics.length : 0;
  if (metrics) parts.push(`${metrics} measure${metrics === 1 ? '' : 's'}`);
  if (e.proposedBy != null && !parts.length) parts.push('Proposed by a person');
  if (idea.change?.ideaKind === 'test_settings') {
    parts.push('The baseline: production volume and how much scores move');
  }
  return parts.join(' · ');
}

/** When, in a few words, for the row. */
export function changeWhen(idea: IdeaRow, state: ChangeState): string {
  const e = idea.evidence ?? {};
  switch (state) {
    case 'live':
      return `live since ${shortDate(e.watch?.liveAt ?? idea.updatedAt ?? idea.createdAt)}`;
    case 'undone':
      return `undone ${shortDate(e.undo?.at)}`;
    case 'stopped':
      return `stopped ${shortDate(e.stopped?.at ?? e.canary?.checkedAt ?? idea.updatedAt ?? idea.createdAt)}`;
    case 'trying':
      return `trying since ${shortDate(e.canary?.startedAt)}`;
    case 'waits':
      return `waiting since ${shortDate(e.ask?.at ?? idea.createdAt)}`;
    case 'building':
      return `handed over ${shortDate(e.handoff?.at ?? idea.createdAt)}`;
    case 'turned_down':
      return `closed ${shortDate(e.expiry?.at ?? e.rejection?.at ?? idea.updatedAt ?? idea.createdAt)}`;
    default:
      return `proposed ${shortDate(idea.createdAt)}`;
  }
}

const SETTING_NAMES: Record<string, string> = {
  monthlyCapUsd: 'the monthly cap',
  runCeilingUsd: 'the most one debrief may spend',
  passScore: 'the pass mark',
};

/**
 * Older budget changes were titled with the raw setting keys
 * ("Settings: monthlyCapUsd"); read those in plain words. Other titles pass.
 */
export function plainChangeTitle(text: string): string {
  const m = /^Settings:\s*(.+)$/.exec(text.trim());
  if (!m) return text;
  const names = m[1]
    .split(/\s*,\s*/)
    .map(
      (k) =>
        SETTING_NAMES[k] ?? k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(),
    );
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      : names[0];
  return `Change ${list}`;
}

/** The whole change as the Changes page shows it. */
export function toDebriefChange(
  idea: IdeaRow,
  ctx: ChangeContext,
): DebriefChange {
  const state = changeState(idea);
  const waitsBecause = state === 'waits' ? waitsFor(idea) : null;
  const e = idea.evidence ?? {};
  const langs = e.languages ?? idea.change?.languages ?? null;
  const releaseId = idea.releaseId ?? e.watch?.releaseId ?? null;
  const kind = changeKindLabel(idea);
  const when = changeWhen(idea, state);
  const measures = changeMeasures(idea);
  const firstVersion =
    idea.change?.ideaKind === 'pinned_rule' && idea.change?.firstVersion;
  return {
    id: idea.id,
    title: firstVersion
      ? `Sign off the ${pinnedRuleName(String(idea.change?.promptCode))} (in use since ${shortDate(idea.createdAt)})`
      : plainChangeTitle(String(idea.text ?? idea.title ?? '')),
    kind,
    state,
    result: changeResult(idea, state, ctx, waitsBecause),
    why: changeWhy(idea),
    when,
    waitsBecause,
    confidence: confidenceOf(e)?.level ?? null,
    languages: Array.isArray(langs) && langs.length ? langs.map(String) : null,
    measures,
    steps: changeSteps(idea, ctx),
    basedOn: changeBasedOn(idea),
    canUndo:
      state === 'live' &&
      (idea.change?.ideaKind === 'test_settings' ||
        (!!releaseId && releaseId === ctx.gaReleaseId)),
    canStop: state === 'trying' || state === 'testing' || state === 'proposed',
    kindKey: kindKeyOf(kind),
    wording:
      typeof idea.change?.find === 'string' &&
      typeof idea.change?.replace === 'string'
        ? { before: idea.change.find, after: idea.change.replace }
        : null,
    summary: [
      when,
      measures[0] ? `${measures[0].name} ${measures[0].value}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

/** The kind label's first word, as a key. */
export function kindKeyOf(kind: string): DebriefChange['kindKey'] {
  const k = kind.toLowerCase();
  if (k.startsWith('pinned rule')) return 'pinned_rule';
  if (k.startsWith('prompt')) return 'prompt';
  if (k.startsWith('setting')) return 'setting';
  if (k.startsWith('budget')) return 'budget';
  if (k.startsWith('model')) return 'model';
  if (k.startsWith('code')) return 'code';
  if (k.startsWith('agents')) return 'agents';
  return 'change';
}

/** Languages in words, for a sentence. */
export function languagesInWords(langs: string[] | null): string {
  return langs?.length ? langs.map(languageName).join(', ') : 'every language';
}
