import { DEBRIEF_PROMPT_CODES } from '../constants/debrief-release.constants';
import { BUDGET_SETTING_KEYS } from './debrief-releases.util';

/**
 * "Always asks a person" (Debrief v2, A1). Every other change runs the
 * ladder on its own (A3). Locked on, not settings: the Safety reader's text,
 * crisis lines and support copy, budget increases. Settings: low-confidence
 * changes (`askLowConfidence`, on by default) and new models or providers
 * (`askModels`, off by default). Model changes within budget never wait
 * otherwise; an organisation's provider allowlist always applies (elsewhere).
 */
export type AlwaysAskKind =
  | 'safety_reader'
  | 'crisis_support'
  | 'budget_increase'
  | 'low_confidence'
  | 'new_model';

export interface AlwaysAsk {
  kind: AlwaysAskKind;
  /** A locked kind: not a setting. */
  locked: boolean;
  /** Why it waits, in the owner's words (DebriefChange.waitsBecause). */
  waitsBecause: string;
}

/** The kinds in the owner's words (Settings › Autonomy). */
export const ALWAYS_ASK_LABELS: Record<AlwaysAskKind, string> = {
  safety_reader: 'Safety reader text',
  crisis_support: 'Crisis lines and support copy',
  budget_increase: 'Budget increases',
  low_confidence: 'Changes the Debrief PM agent is not sure about',
  new_model: 'New models or providers',
};

/** Budget settings a release carries: the Budgets page's and the session's. */
const BUDGET_KEYS: readonly string[] = [
  ...BUDGET_SETTING_KEYS,
  'sessionBudgetUsd',
];

const CRISIS_WORDS = /crisis|support[_ ]?(copy|line|reply)|helpline/i;

/** The PM agent's stated confidence (A2), read from the idea's evidence; missing reads as high. */
export function confidenceOf(
  evidence: Record<string, any> | null | undefined,
): { level: 'high' | 'low'; why: string | null } | null {
  const c = evidence?.confidence;
  if (c == null) return null;
  if (typeof c === 'string') {
    return { level: c === 'low' ? 'low' : 'high', why: null };
  }
  const level = c.level ?? c.value ?? c.confidence;
  return {
    level: level === 'low' ? 'low' : 'high',
    why: typeof c.why === 'string' ? c.why : (c.reason ?? null),
  };
}

/** The prompt codes a change touches (an edit's own, or a release's diff). */
function promptCodes(
  change: Record<string, any>,
  evidence: Record<string, any>,
): string[] {
  const codes: string[] = [];
  if (change.promptCode) codes.push(String(change.promptCode));
  for (const p of evidence.diff?.prompts ?? []) {
    if (p?.code) codes.push(String(p.code));
  }
  return codes;
}

/**
 * Must this change wait for a person, and why? Null when it runs on its own.
 * `liveModels`: the models the live release already uses (a model in it is
 * not new); without it every model change counts as new.
 */
export function alwaysAsk(
  idea: {
    change?: Record<string, any> | null;
    evidence?: Record<string, any> | null;
  },
  settings: { askLowConfidence: boolean; askModels: boolean },
  liveModels?: ReadonlySet<string>,
): AlwaysAsk | null {
  const change = idea.change ?? {};
  const evidence = idea.evidence ?? {};
  const codes = promptCodes(change, evidence);
  if (
    codes.includes(DEBRIEF_PROMPT_CODES.safetyReader) ||
    codes.includes(DEBRIEF_PROMPT_CODES.riskCueDefinition)
  ) {
    return {
      kind: 'safety_reader',
      locked: true,
      waitsBecause: 'It changes what the Safety reader looks for.',
    };
  }
  if (
    change.touches === 'crisis_lines' ||
    change.touches === 'support_copy' ||
    codes.some((c) => CRISIS_WORDS.test(c)) ||
    CRISIS_WORDS.test(String(change.settingKey ?? ''))
  ) {
    return {
      kind: 'crisis_support',
      locked: true,
      waitsBecause:
        'It changes the crisis lines or the support copy learners see.',
    };
  }
  const budgetUp = [
    ...(evidence.diff?.settings ?? []),
    ...(change.ideaKind === 'setting'
      ? [{ key: change.settingKey, before: null, after: change.settingValue }]
      : []),
  ].find(
    (s: { key: string; before: unknown; after: unknown }) =>
      BUDGET_KEYS.includes(String(s?.key)) &&
      (s.before == null || Number(s.after) > Number(s.before)),
  );
  if (budgetUp) {
    return {
      kind: 'budget_increase',
      locked: true,
      waitsBecause: 'It raises a budget.',
    };
  }
  const confidence = confidenceOf(evidence);
  if (settings.askLowConfidence && confidence?.level === 'low') {
    return {
      kind: 'low_confidence',
      locked: false,
      waitsBecause: `The Debrief PM agent is not sure about it${confidence.why ? `: ${confidence.why}` : '.'}`,
    };
  }
  if (settings.askModels) {
    const models = [
      ...(evidence.diff?.steps ?? [])
        .filter(
          (s: { field: string; after: unknown }) =>
            (s.field === 'model' || s.field === 'backupModel') && s.after,
        )
        .map((s: { after: unknown }) => String(s.after)),
      ...(evidence.diff?.reply?.after
        ? [String(evidence.diff.reply.after)]
        : []),
      ...(change.model ? [String(change.model)] : []),
    ];
    const fresh = models.filter((m) => !liveModels || !liveModels.has(m));
    if (fresh.length) {
      return {
        kind: 'new_model',
        locked: false,
        waitsBecause: `It brings in a new model: ${[...new Set(fresh)].join(', ')}.`,
      };
    }
  }
  return null;
}
