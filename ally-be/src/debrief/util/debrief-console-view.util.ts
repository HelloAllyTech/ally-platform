import { DEBRIEF_PROMPT_CODES } from '../constants/debrief-release.constants';
import { DebriefViewer } from './debrief-console-roles.util';

/**
 * Pure rules behind the redesigned Debrief console (debrief-console-redesign-
 * notes.md): the session list's filters and categories, approvals' 14-day
 * expiry, autonomy per kind of change, pinned rules, and the "waiting on you"
 * actions per role. The services read the data; these decide.
 */

// --- Session list -------------------------------------------------------------------

export const SESSION_CATEGORIES = [
  /** Rank 0–2: urgent, other open flags, held or below the bar. The queue. */
  'needs',
  /** A learner flagged a card (any outcome). */
  'flagged',
  'below',
  'published',
  /** Escalated to the clinical advisor and not decided. */
  'escalated',
  /** The weekly random sample for the κ gate, still without a verdict (who gives verdicts). */
  'agreement_sample',
  'all',
] as const;
export type SessionCategory = (typeof SESSION_CATEGORIES)[number];

export interface SessionFilters {
  category: SessionCategory;
  tenantId?: string;
  language?: string;
  recipe?: string;
  /** none = ran as written; light = steps 1–2; heavy = steps 3–6. */
  fallback?: 'none' | 'light' | 'heavy';
  riskCue?: boolean;
  /** over_0_20 = cost over $0.20; hit_ceiling = spent at least 95% of its ceiling. */
  cost?: 'over_0_20' | 'hit_ceiling';
  /** production = shadow + live (default); any = every mode. */
  mode: 'production' | 'live' | 'shadow' | 'replay' | 'any';
  limit: number;
  offset: number;
}

/** The query string as the session list accepts it; anything malformed is dropped. */
export function parseSessionFilters(
  q: Record<string, string | undefined>,
): SessionFilters {
  const str = (k: string) =>
    typeof q[k] === 'string' && q[k]!.trim() ? q[k]!.trim() : undefined;
  const category = (SESSION_CATEGORIES as readonly string[]).includes(
    str('category') ?? '',
  )
    ? (str('category') as SessionCategory)
    : 'needs';
  const fallback = ['none', 'light', 'heavy'].includes(str('fallback') ?? '')
    ? (str('fallback') as SessionFilters['fallback'])
    : undefined;
  const cost = ['over_0_20', 'hit_ceiling'].includes(str('cost') ?? '')
    ? (str('cost') as SessionFilters['cost'])
    : undefined;
  const mode = ['production', 'live', 'shadow', 'replay', 'any'].includes(
    str('mode') ?? '',
  )
    ? (str('mode') as SessionFilters['mode'])
    : 'production';
  const riskCue =
    str('riskCue') === 'true'
      ? true
      : str('riskCue') === 'false'
        ? false
        : undefined;
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const tenantId = str('tenantId');
  const language = str('language');
  const recipe = str('recipe');
  return {
    category,
    ...(tenantId && tenantId.length <= 64 ? { tenantId } : {}),
    ...(language && language.length <= 10 ? { language } : {}),
    ...(recipe && recipe.length <= 20 ? { recipe } : {}),
    ...(fallback ? { fallback } : {}),
    ...(riskCue !== undefined ? { riskCue } : {}),
    ...(cost ? { cost } : {}),
    mode,
    limit,
    offset,
  };
}

/** A run cost "hit the ceiling" when it spent at least this share of it. */
export const HIT_CEILING_SHARE = 0.95;
export const COST_BAND_USD = 0.2;

// --- Approvals (plan §11.7) -------------------------------------------------------

export const APPROVAL_EXPIRY_DAYS = 14;
export const APPROVAL_WARN_DAYS = 3;

export type ApprovalWait =
  | 'pinned_rule'
  | 'handoff'
  | 'start_quick_test'
  | 'promote_budget'
  | 'start_gate'
  | 'start_trial'
  | 'start_canary'
  | 'promote';

/** What a person must decide on this idea now, and since when; null when nothing waits. */
export function awaitingDecision(idea: {
  status: string;
  createdAt: string | Date;
  change?: Record<string, any> | null;
  evidence?: Record<string, any> | null;
}): { wait: ApprovalWait; since: string } | null {
  if (!['proposed', 'approved'].includes(idea.status)) return null;
  const e = idea.evidence ?? {};
  if (e.expiry) return null;
  const iso = (v: unknown) =>
    v
      ? new Date(v as string).toISOString()
      : new Date(idea.createdAt).toISOString();
  const kind = idea.change?.ideaKind;
  if (kind === 'release' && idea.status === 'proposed') {
    // A person's proposed change: budgets go live on the owner's word; any
    // other change waits for someone to start its quick test.
    if (idea.change?.budgetOnly) {
      return { wait: 'promote_budget', since: iso(idea.createdAt) };
    }
    if (!e.screen)
      return { wait: 'start_quick_test', since: iso(idea.createdAt) };
  }
  if (kind === 'pinned_rule') {
    return idea.status === 'proposed'
      ? { wait: 'pinned_rule', since: iso(idea.createdAt) }
      : null;
  }
  if (e.canary?.status === 'passed') {
    return { wait: 'promote', since: iso(e.canary.checkedAt) };
  }
  if (e.canary) return null;
  if (e.trial?.status === 'passed') {
    return { wait: 'start_canary', since: iso(e.trial.decidedAt) };
  }
  if (e.trial?.status === 'waiting') {
    return { wait: 'start_trial', since: iso(e.trial.at) };
  }
  if (e.gate?.status === 'waiting') {
    return { wait: 'start_gate', since: iso(e.gate.at) };
  }
  if (e.handoff?.status === 'waiting' && idea.status === 'proposed') {
    return { wait: 'handoff', since: iso(e.handoff.at) };
  }
  return null;
}

export interface ApprovalState {
  wait: ApprovalWait;
  since: string;
  /** Null when it never expires: a pinned rule's first version waits until approved. */
  expiresAt: string | null;
  /** Whole days left, rounded up; 0 once expired; null when it never expires. */
  expiresInDays: number | null;
  expired: boolean;
  /** Within APPROVAL_WARN_DAYS of expiring: the yellow banner. */
  expiringSoon: boolean;
}

export function approvalState(
  idea: Parameters<typeof awaitingDecision>[0],
  now = new Date(),
): ApprovalState | null {
  const w = awaitingDecision(idea);
  if (!w) return null;
  // A pinned rule's first version: a base version must exist, so it neither
  // expires nor can be rejected; it waits until it is approved.
  if (idea.change?.firstVersion) {
    return {
      ...w,
      expiresAt: null,
      expiresInDays: null,
      expired: false,
      expiringSoon: false,
    };
  }
  const expiresAt = new Date(
    new Date(w.since).getTime() + APPROVAL_EXPIRY_DAYS * 86_400_000,
  );
  const leftMs = expiresAt.getTime() - now.getTime();
  const expiresInDays = Math.max(0, Math.ceil(leftMs / 86_400_000));
  return {
    ...w,
    expiresAt: expiresAt.toISOString(),
    expiresInDays,
    expired: leftMs <= 0,
    expiringSoon: leftMs > 0 && leftMs <= APPROVAL_WARN_DAYS * 86_400_000,
  };
}

// --- Kinds of change and autonomy (PRD §12) ----------------------------------------

/**
 * The kinds of change the PM agent's policy covers (spec C3, C4). Settings:
 * non-budget settings. Prompts: prompt (skill) edits, registry agents and
 * default plans. Pinned rules: always never. Guidance is not here: the PM
 * agent never touches Context Library chunks (C4). Models are not here:
 * model trials are Release 2.
 */
export const CHANGE_KINDS = ['settings', 'prompts', 'pinned_rules'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** Pinned rules: the safety rules, the rubric, and the judge's instructions. */
export const PINNED_RULE_PROMPTS: ReadonlyArray<{
  code: string;
  label: string;
}> = [
  { code: DEBRIEF_PROMPT_CODES.safetyReader, label: 'Safety rules' },
  {
    code: DEBRIEF_PROMPT_CODES.rubric,
    label: 'Rubric (the Evaluator and the judge score by it)',
  },
  { code: 'debrief_quality_judge_system', label: "Judge's instructions" },
];
export const PINNED_RULE_CODES: ReadonlySet<string> = new Set(
  PINNED_RULE_PROMPTS.map((p) => p.code),
);

/** The kind of change an idea is, for the autonomy table; null for hand-offs and questions. */
export function changeKindOf(
  change: Record<string, any> | null | undefined,
): ChangeKind | null {
  switch (change?.ideaKind) {
    case 'pinned_rule':
      return 'pinned_rules';
    case 'setting':
      return 'settings';
    case 'prompt_edit':
      return PINNED_RULE_CODES.has(change.promptCode)
        ? 'pinned_rules'
        : 'prompts';
    case 'registry_agent':
    case 'default_plan':
      return 'prompts';
    default:
      return null;
  }
}

/** The test steps an idea climbs (PRD §12). Promoting to everyone is always a person. */
export const AUTONOMY_STEPS = [
  'quick_test',
  'gate_test',
  'paired_trial',
  'canary',
] as const;
export type AutonomyStep = (typeof AUTONOMY_STEPS)[number];

/** The steps learners never see (plan §4: free to experiment before learners are involved). */
export const LEARNER_FREE_STEPS: readonly AutonomyStep[] = [
  'quick_test',
  'gate_test',
  'paired_trial',
];

/** auto: on its own; ask: waits for a person; off: never at this step. */
export type StepPolicy = 'auto' | 'ask' | 'off';
/**
 * An organisation may only tighten: default (use the global), ask, never.
 * Side-by-side trials take only default ("Allowed") or never ("Not on its
 * sessions"); learner try-outs all three.
 */
export type OrgPolicy = 'default' | 'ask' | 'never';
export const ORG_POLICY_STEPS = ['paired_trial', 'canary'] as const;
export type OrgPolicyStep = (typeof ORG_POLICY_STEPS)[number];

/** The kinds whose cells the owner may set; pinned rules are always never. */
export const CONFIGURABLE_KINDS = CHANGE_KINDS.filter(
  (k) => k !== 'pinned_rules',
) as Array<Exclude<ChangeKind, 'pinned_rules'>>;

export type AutonomyMatrix = Record<
  ChangeKind,
  Record<AutonomyStep, StepPolicy>
>;

export interface AutonomyPolicy {
  matrix: AutonomyMatrix;
  orgs: Record<string, Partial<Record<OrgPolicyStep, OrgPolicy>>>;
  /** Why a kind was dropped back to "ask" on its own (by the system), newest last. */
  relocks: Array<{
    kind: ChangeKind;
    at: string;
    reason: string;
    /** The cells it set to "ask" (older entries: every auto cell of the kind). */
    steps?: AutonomyStep[];
    by?: 'system';
  }>;
  /**
   * Whether each kind's canary could run on its own when last checked, so the
   * owner is told once when it becomes possible (never switched on for them).
   */
  canaryEligible?: Partial<Record<ChangeKind, boolean>>;
  /**
   * The owner set a canary "on its own" before the κ gate was met (an
   * override, confirmed and audited). The κ re-lock leaves it be; the other
   * re-locks (reverts, baseline, drift) still apply and clear it.
   */
  overrides?: Partial<
    Record<ChangeKind, { at: string; by: number; name: string | null }>
  >;
}

/**
 * The policy before anyone set it. The steps learners never see (quick
 * check, pass test, side-by-side trial) always run on their own, paid from
 * the learning budget (plan §11.1 "Experiment: free"; decided 2026-11-12):
 * they are not settings. A learner try-out (the canary) waits for a person
 * until the owner switches it on. Pinned rules never.
 */
export function defaultAutonomyMatrix(): AutonomyMatrix {
  const row = (): Record<AutonomyStep, StepPolicy> => ({
    quick_test: 'auto',
    gate_test: 'auto',
    paired_trial: 'auto',
    canary: 'ask',
  });
  return {
    settings: row(),
    prompts: row(),
    pinned_rules: {
      quick_test: 'off',
      gate_test: 'off',
      paired_trial: 'off',
      canary: 'off',
    },
  };
}

/**
 * The stored policy over the defaults; malformed cells fall back. Only the
 * canary cell is read from storage: the steps learners never see are always
 * "auto", whatever an older policy stored for them.
 */
export function normaliseAutonomy(
  stored: Partial<AutonomyPolicy> | null | undefined,
): AutonomyPolicy {
  const matrix = defaultAutonomyMatrix();
  for (const kind of CONFIGURABLE_KINDS) {
    for (const step of AUTONOMY_STEPS) {
      if (LEARNER_FREE_STEPS.includes(step)) continue;
      const v = stored?.matrix?.[kind]?.[step];
      if (v === 'auto' || v === 'ask' || v === 'off') matrix[kind][step] = v;
    }
  }
  const orgs: AutonomyPolicy['orgs'] = {};
  for (const [org, o] of Object.entries(stored?.orgs ?? {})) {
    const clean: Partial<Record<OrgPolicyStep, OrgPolicy>> = {};
    for (const step of ORG_POLICY_STEPS) {
      const v = o?.[step];
      // Side-by-side trials are "Allowed" or "Not on its sessions" (never):
      // an older "ask" no longer exists and reads as allowed (2026-11-12).
      if (v === 'never' || (v === 'ask' && step === 'canary')) clean[step] = v;
    }
    if (Object.keys(clean).length) orgs[org] = clean;
  }
  const canaryEligible: Partial<Record<ChangeKind, boolean>> = {};
  for (const kind of CONFIGURABLE_KINDS) {
    const v = stored?.canaryEligible?.[kind];
    if (typeof v === 'boolean') canaryEligible[kind] = v;
  }
  const overrides: AutonomyPolicy['overrides'] = {};
  for (const kind of CONFIGURABLE_KINDS) {
    const o = stored?.overrides?.[kind];
    if (o && typeof o.at === 'string' && matrix[kind].canary === 'auto') {
      overrides[kind] = { at: o.at, by: Number(o.by), name: o.name ?? null };
    }
  }
  return {
    matrix,
    orgs,
    relocks: Array.isArray(stored?.relocks) ? stored!.relocks.slice(-50) : [],
    canaryEligible,
    overrides,
  };
}

const STRICTNESS: Record<StepPolicy, number> = { auto: 0, ask: 1, off: 2 };
const ORG_AS_STEP: Record<OrgPolicy, StepPolicy | null> = {
  default: null,
  ask: 'ask',
  never: 'off',
};

/** The stricter of two policies. */
export function stricter(a: StepPolicy, b: StepPolicy | null): StepPolicy {
  if (!b) return a;
  return STRICTNESS[b] > STRICTNESS[a] ? b : a;
}

/**
 * What the PM agent may do for this kind at this step, for this organisation:
 * off when the master switch is off; else the global cell, tightened by the
 * organisation's override (paired trials and canaries reach its learners).
 * An organisation can never loosen the global.
 */
export function effectivePolicy(
  policy: AutonomyPolicy,
  enabled: boolean,
  kind: ChangeKind,
  step: AutonomyStep,
  orgId?: string | null,
): StepPolicy {
  if (!enabled) return 'off';
  let p = policy.matrix[kind]?.[step] ?? 'ask';
  if (orgId) {
    const o = policy.orgs[orgId] ?? {};
    if (step === 'paired_trial' || step === 'canary') {
      p = stricter(p, ORG_AS_STEP[o[step] ?? 'default']);
    }
  }
  return p;
}

export interface AutonomyFacts {
  /** The calibration gate: κ ≥ 0.6 on every gated measure. */
  gate: {
    met: boolean;
    /** `n`: reviewed debriefs behind it (κ counts from 50). */
    failing: Array<{ measure: string; kappa: number | null; n?: number }>;
  };
  /** Canary reverts in the last 4 weeks, by kind. */
  reverts: Partial<Record<ChangeKind, number>>;
  /** The latest monthly sealed run scored worse than the one before. */
  failedBaseline: { failed: boolean; detail: string | null };
  /**
   * Judge drift. Measured by the nightly evaluator job, which is Release 2:
   * until then null ("not measured") and never blocks.
   */
  judgeDrift: boolean | null;
}

/** Where judge drift will come from, for the UI ("measured from Release 2"). */
export const JUDGE_DRIFT_SOURCE = {
  measured: false,
  from: 'release_2',
  note: 'Judge drift is measured by the nightly evaluator job (Release 2).',
} as const;

export const RELOCK_REVERTS = 2;
export const RELOCK_WINDOW_DAYS = 28;

/** Why a kind must drop back to "ask" on its own, or null. Not the κ gate: that only blocks new "auto". */
export function relockReason(
  kind: ChangeKind,
  f: AutonomyFacts,
): string | null {
  if ((f.reverts[kind] ?? 0) >= RELOCK_REVERTS) {
    return `${f.reverts[kind]} learner try-outs were taken back in the last 4 weeks`;
  }
  if (f.failedBaseline.failed) {
    return `the monthly baseline failed${f.failedBaseline.detail ? ` (${f.failedBaseline.detail})` : ''}`;
  }
  if (f.judgeDrift) return 'the independent check has drifted';
  return null;
}

export interface KindEligibility {
  kind: ChangeKind;
  eligible: boolean;
  reason: string;
}

/** The κ gate's measures in words (the admin's gateMeasures); a reason never shows a code. */
export const GATE_MEASURE_LABELS: Record<string, string> = {
  accuracy: 'Accuracy',
  evidence_specificity: 'Evidence',
  missed_risk_cue: 'Missed risk cue',
};

export function gateMeasureLabel(measure: string): string {
  const known = GATE_MEASURE_LABELS[measure];
  if (known) return known;
  const words = measure.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Minimum reviewed debriefs before a measure's κ counts (debrief-agreement.util AGREEMENT_MIN_REVIEWS). */
const GATE_MIN_REVIEWS = 50;

/** One failing measure in words: its κ, or why there is none yet. */
function gateMeasureState(c: { kappa: number | null; n?: number }): string {
  if (c.kappa != null) return c.kappa.toFixed(2);
  if (c.n == null) return 'not measured';
  if (c.n < GATE_MIN_REVIEWS) {
    return `not measured yet: ${c.n} of ${GATE_MIN_REVIEWS} reviews`;
  }
  return 'not measurable yet: every answer is the same';
}

/**
 * May this kind run on its own at this step? Quick checks, pass tests and
 * side-by-side trials never reach a learner, so they always do (decided
 * 2026-11-12; the learning budget is the limit). The canary (a learner
 * try-out) reaches learners: it needs a clean track record and the
 * independent check to agree with the clinical advisor (κ ≥ 0.6 on the
 * gated measures). Live for everyone is always a person; pinned rules never.
 */
export function kindEligibility(
  kind: ChangeKind,
  f: AutonomyFacts,
  step: AutonomyStep = 'canary',
): KindEligibility {
  if (kind === 'pinned_rules') {
    return {
      kind,
      eligible: false,
      reason: 'Never: the clinical advisor or the owner approves every change.',
    };
  }
  if (LEARNER_FREE_STEPS.includes(step)) {
    return {
      kind,
      eligible: true,
      reason:
        'Always on its own: learners never see it; paid from the learning budget.',
    };
  }
  const relock = relockReason(kind, f);
  if (relock) return { kind, eligible: false, reason: `Not now: ${relock}.` };
  if (!f.gate.met) {
    const low = f.gate.failing
      .map((c) => `${gateMeasureLabel(c.measure)} ${gateMeasureState(c)}`)
      .join('; ');
    return {
      kind,
      eligible: false,
      reason: `Not yet: agreement below 0.6${low ? ` (${low})` : ''}.`,
    };
  }
  return {
    kind,
    eligible: true,
    reason: 'Yes: agreement 0.6 or more, clean track record.',
  };
}

/** Each step's eligibility for one kind (the Settings matrix, the PM agent's chips). */
export function stepEligibility(
  kind: ChangeKind,
  f: AutonomyFacts,
): Record<AutonomyStep, { eligible: boolean; reason: string }> {
  return Object.fromEntries(
    AUTONOMY_STEPS.map((st) => {
      const e = kindEligibility(kind, f, st);
      return [st, { eligible: e.eligible, reason: e.reason }];
    }),
  ) as Record<AutonomyStep, { eligible: boolean; reason: string }>;
}

/**
 * Why an owner's change to the matrix is refused (null when it is fine):
 * pinned rules are not configurable; the steps learners never see always run
 * on their own and can't be changed; "auto" on the canary needs the kind
 * eligible (the κ gate), unless the owner confirms an override.
 */
export function matrixChangeRefusal(
  kind: string,
  step: string,
  value: string,
  f: AutonomyFacts,
  override = false,
): string | null {
  if (!(CHANGE_KINDS as readonly string[]).includes(kind)) {
    return `${kind} is not a kind of change`;
  }
  if (kind === 'pinned_rules') {
    return 'pinned rules always need the clinical advisor or the owner';
  }
  if (!(AUTONOMY_STEPS as readonly string[]).includes(step)) {
    return `${step} is not a test step (putting a change live for everyone is always a person)`;
  }
  if (LEARNER_FREE_STEPS.includes(step as AutonomyStep)) {
    return `${step} always runs on its own (learners never see it); only the learner try-out (canary) can be set`;
  }
  if (!['auto', 'ask', 'off'].includes(value)) {
    return `${value} is not auto, ask or off`;
  }
  if (value === 'auto') {
    const e = kindEligibility(kind as ChangeKind, f, step as AutonomyStep);
    // The owner may override the κ gate on the canary, confirmed; never a re-lock.
    if (
      !e.eligible &&
      override &&
      step === 'canary' &&
      !relockReason(kind as ChangeKind, f)
    ) {
      return null;
    }
    if (!e.eligible)
      return `${kind} cannot run learner try-outs on its own: ${e.reason}`;
  }
  return null;
}

// --- The "waiting on you" bar --------------------------------------------------------

export type PendingKind =
  | 'urgent_flag'
  | 'learner_distress'
  | 'flag'
  | 'held'
  | 'below_bar'
  | 'escalated_flag'
  | 'escalated_run';

export type PendingDecision =
  | 'keep'
  | 'correct'
  | 'remove'
  | 'escalate'
  | 'publish'
  | 'todays_debrief'
  | 'looks_fine'
  | 'checked'
  | 'verdict';

export interface PendingAction {
  kind: PendingKind;
  level: 'red' | 'yellow';
  /** When it started waiting on a person. */
  waitingSince: string;
  /** Past the review deadline (owner setting flagReviewSlaHours). */
  overdue: boolean;
  /** What happened, in one line. */
  title: string;
  flagId?: string;
  /** "Read first" jump links. */
  anchors: {
    turns: number[];
    cardSection?: string | null;
    learnerNote?: string | null;
    judgeReasons?: boolean;
    askAlly?: boolean;
  };
  decisions: PendingDecision[];
}

export interface PendingFacts {
  runMode: string;
  status: string;
  reviewed: boolean;
  createdAt: string;
  learnerDistress: boolean;
  judgeBelowBar: boolean;
  riskCueTurns: number[];
  /** Turns where the learner stepped out of the roleplay in distress (the safety reader's). */
  distressTurns?: number[];
  heldReasonTurns: number[];
  escalation: { at: string; note: string | null; by: string | null } | null;
  /** Review deadline (owner setting flagReviewSlaHours). */
  slaHours: number;
  flags: Array<{
    id: string;
    section: string | null;
    status: string;
    urgent: boolean;
    reason: string | null;
    note: string | null;
    since: string;
    /** Still inside the learner's undo window: not work yet. */
    inUndoWindow: boolean;
    cardTurns: number[];
  }>;
}

const REASON_TEXT: Record<string, string> = {
  didnt_say: '“I didn’t say this”',
  described_wrongly: '“This describes it wrongly”',
  advice_doesnt_fit: '“This advice doesn’t fit”',
  something_else: '“Something else”',
};

const sectionName = (s: string | null) =>
  !s
    ? 'the debrief'
    : s.startsWith('important_moment')
      ? '“An important moment”'
      : s.startsWith('work_on_this')
        ? '“Work on this”'
        : s.startsWith('what_worked')
          ? '“What worked”'
          : s === 'practise_next'
            ? '“Practise this next”'
            : `“${s}”`;

/**
 * What the viewer's role must decide on this session, most urgent first. The
 * Ally team (and the owner) sees urgent flags, learner distress, other open
 * flags and held or below-the-bar debriefs; the clinical advisor sees what was
 * escalated to them. Anyone else sees nothing: the bar is for whoever can act.
 */
export function pendingActions(
  f: PendingFacts,
  viewer: Pick<DebriefViewer, 'roles'>,
  now = new Date(),
): PendingAction[] {
  if (f.runMode !== 'live') return [];
  const team = viewer.roles.allyTeam || viewer.roles.owner;
  const advisor = viewer.roles.receivesEscalations;
  const out: Array<Omit<PendingAction, 'overdue'>> = [];
  const decisionsFor = (forTeam: boolean): PendingDecision[] =>
    forTeam
      ? ['correct', 'keep', 'remove', 'escalate']
      : ['correct', 'keep', 'remove'];

  for (const fl of f.flags) {
    if (fl.inUndoWindow) continue;
    if (fl.section === 'ask_ally') {
      if (team && ['open', 'escalated'].includes(fl.status)) {
        out.push({
          kind: 'learner_distress',
          level: 'red',
          waitingSince: fl.since,
          title: 'The learner showed distress in Ask Ally.',
          flagId: fl.id,
          anchors: { turns: f.riskCueTurns, askAlly: true },
          decisions: ['checked', 'escalate'],
        });
      }
      continue;
    }
    if (fl.status === 'escalated' && advisor) {
      out.push({
        kind: 'escalated_flag',
        level: 'red',
        waitingSince: f.escalation?.at ?? fl.since,
        title: `Escalated to you: ${REASON_TEXT[fl.reason ?? ''] ?? 'a flag'} on ${sectionName(fl.section)}.`,
        flagId: fl.id,
        anchors: {
          turns: fl.cardTurns,
          cardSection: fl.section,
          learnerNote: fl.note,
        },
        decisions: decisionsFor(false),
      });
      continue;
    }
    if (team && ['open', 'escalated'].includes(fl.status)) {
      out.push({
        kind: fl.urgent ? 'urgent_flag' : 'flag',
        level: fl.urgent ? 'red' : 'yellow',
        waitingSince: fl.since,
        title: `The learner flagged ${sectionName(fl.section)}: ${REASON_TEXT[fl.reason ?? ''] ?? 'a flag'}.`,
        flagId: fl.id,
        anchors: {
          turns: fl.cardTurns,
          cardSection: fl.section,
          learnerNote: fl.note,
        },
        decisions:
          fl.status === 'escalated'
            ? ['correct', 'keep', 'remove']
            : decisionsFor(true),
      });
    }
  }

  if (team && !f.reviewed) {
    if (f.learnerDistress && !out.some((a) => a.kind === 'learner_distress')) {
      out.push({
        kind: 'learner_distress',
        level: 'red',
        waitingSince: f.createdAt,
        title: 'The learner showed distress in this session.',
        // Notes #21: "Read first" goes to the learner's own distress turns.
        anchors: {
          turns: [
            ...new Set([...(f.distressTurns ?? []), ...f.riskCueTurns]),
          ].sort((a, b) => a - b),
        },
        decisions: ['looks_fine', 'escalate'],
      });
    }
    const held = ['needs_person', 'failed'].includes(f.status);
    const below =
      f.status === 'below_bar' || (f.status === 'published' && f.judgeBelowBar);
    if (held || below) {
      out.push({
        kind: held ? 'held' : 'below_bar',
        level: 'yellow',
        waitingSince: f.createdAt,
        title: held
          ? 'Held: the learner sees “on its way” until you decide.'
          : 'Published, but the judge scored it below the bar.',
        anchors: { turns: f.heldReasonTurns, judgeReasons: true },
        decisions: held
          ? ['publish', 'todays_debrief', 'escalate']
          : ['looks_fine', 'correct', 'escalate'],
      });
    }
  }

  if (advisor && f.escalation && !f.reviewed) {
    out.push({
      kind: 'escalated_run',
      level: 'red',
      waitingSince: f.escalation.at,
      title: `Escalated to you${f.escalation.by ? ` by ${f.escalation.by}` : ''}${f.escalation.note ? `: “${f.escalation.note}”` : '.'}`,
      anchors: { turns: f.heldReasonTurns, judgeReasons: true },
      decisions: ['verdict'],
    });
  }

  const order: Record<PendingKind, number> = {
    urgent_flag: 0,
    learner_distress: 0,
    escalated_flag: 1,
    escalated_run: 1,
    held: 2,
    flag: 3,
    below_bar: 4,
  };
  const slaMs = f.slaHours * 3_600_000;
  return out
    .map((a) => {
      const overdue =
        now.getTime() - new Date(a.waitingSince).getTime() > slaMs;
      // A held debrief turns red once overdue; urgent items are red already.
      return {
        ...a,
        overdue,
        level: overdue ? ('red' as const) : a.level,
      };
    })
    .sort(
      (a, b) =>
        order[a.kind] - order[b.kind] ||
        a.waitingSince.localeCompare(b.waitingSince),
    );
}

/** Turn numbers a judge or check finding names ("turn 5", "(turn 12)"). */
export function turnsIn(text: string | null | undefined): number[] {
  const out = new Set<number>();
  for (const m of (text ?? '').matchAll(
    /\bturns?\s+(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?/gi,
  )) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = a; i <= Math.min(b, a + 10); i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

/** "Why the judge held it": the judge's hard fails and the failed checks, as readable lines. */
export function heldReasons(run: {
  workspace?: Record<string, any> | null;
  checkFailures?: Array<{ code: string; section: string; detail: string }>;
  evaluatorHardFails?: Array<{ code: string; evidence: string }>;
}): Array<{
  source: 'judge' | 'evaluator' | 'check';
  code: string;
  text: string;
  turns: number[];
}> {
  const judge = run.workspace?.judge;
  const lines: Array<{
    source: 'judge' | 'evaluator' | 'check';
    code: string;
    text: string;
    turns: number[];
  }> = [];
  for (const h of (judge?.hardFails ?? []) as Array<{
    code: string;
    evidence?: string;
  }>) {
    const text = h.evidence || h.code.replace(/_/g, ' ');
    lines.push({ source: 'judge', code: h.code, text, turns: turnsIn(text) });
  }
  for (const h of run.evaluatorHardFails ?? []) {
    const text = h.evidence || h.code.replace(/_/g, ' ');
    lines.push({
      source: 'evaluator',
      code: h.code,
      text,
      turns: turnsIn(text),
    });
  }
  for (const c of run.checkFailures ?? []) {
    lines.push({
      source: 'check',
      code: c.code,
      text: c.detail,
      turns: turnsIn(c.detail),
    });
  }
  return lines;
}

// --- Ideas are like pull requests: open or closed ------------------------------------

export type IdeaClosedReason =
  | 'promoted'
  | 'rejected'
  | 'expired'
  | 'reverted'
  | 'did_not_pass'
  | 'handed_off'
  | 'answered'
  | 'signed_off'
  | 'withdrawn'
  | 'retired';

/**
 * Open: needs a person, being tested, or in canary. Closed: promoted (with
 * the release it became), rejected, expired with no decision, reverted (with
 * why), did not pass a test, handed to Builder or Bug Hunter, answered, a
 * pinned rule signed off, or retired.
 */
export function ideaState(idea: {
  status: string;
  releaseId?: string | null;
  change?: Record<string, any> | null;
  evidence?: Record<string, any> | null;
}): {
  state: 'open' | 'closed';
  closedReason: IdeaClosedReason | null;
  closedWhy: string | null;
  releaseId: string | null;
} {
  const e = idea.evidence ?? {};
  const closed = (
    reason: IdeaClosedReason,
    why: string | null = null,
    releaseId: string | null = null,
  ) => ({
    state: 'closed' as const,
    closedReason: reason,
    closedWhy: why,
    releaseId,
  });
  if (idea.status === 'active') {
    return closed(
      'promoted',
      null,
      idea.releaseId ?? e.canary?.releaseId ?? idea.change?.releaseId ?? null,
    );
  }
  if (idea.status === 'retired') {
    return e.withdrawn ? closed('withdrawn') : closed('retired');
  }
  if (idea.status === 'rejected') {
    if (e.expiry) return closed('expired', 'no decision within 14 days');
    if (e.canary?.status === 'reverted') {
      return closed('reverted', e.canary.reason ?? null);
    }
    // The person's reason (required for a pinned rule) is what the PM agent reads too.
    return closed('rejected', e.rejection?.reason ?? null);
  }
  if (e.canary?.status === 'reverted') {
    return closed('reverted', e.canary.reason ?? null);
  }
  if (idea.status === 'approved') {
    if (idea.change?.ideaKind === 'pinned_rule') return closed('signed_off');
    if (e.handoff?.status === 'filed') return closed('handed_off');
    if (e.handoff?.status === 'answered') return closed('answered');
  }
  for (const [k, label] of [
    ['screen', 'quick check'],
    ['gate', 'pass test'],
    ['trial', 'side-by-side trial'],
  ] as const) {
    const r = e[k];
    if (r && (r.passed === false || r.status === 'failed')) {
      return closed('did_not_pass', `did not pass the ${label}`);
    }
  }
  return {
    state: 'open',
    closedReason: null,
    closedWhy: null,
    releaseId: null,
  };
}
