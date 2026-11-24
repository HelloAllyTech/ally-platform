import type { RoleplayMode } from "../api/agentBuilder";

/**
 * Suggestions in the Agent Builder wizard, all rule-based (no model call, so nothing is slower
 * or costs more): a recommended mode from the trainer's own words, and what to review once the
 * fields are generated. Advisory only — the trainer picks the mode and edits the form.
 */

export type ModeReason =
  | "assessmentAfter"
  | "assessmentBefore"
  | "performance"
  | "firstTry"
  | "practice";

export interface ModeRecommendation {
  mode: RoleplayMode;
  reason: ModeReason;
}

// Order matters: the most specific signal wins ("baseline test" is a pre-assessment, not a test).
const MODE_RULES: { pattern: RegExp; mode: RoleplayMode; reason: ModeReason }[] = [
  {
    pattern: /\b(baseline|pre[- ]?(assessment|test|course)|before the course)\b/i,
    mode: "pre_assessment",
    reason: "assessmentBefore",
  },
  {
    pattern:
      /\b(final|capstone|post[- ]?(assessment|test|course)|certif\w*|assess\w*|evaluat\w*|exam|graded)\b/i,
    mode: "post_assessment",
    reason: "assessmentAfter",
  },
  {
    pattern:
      /\b(on their own|independent\w*|unsupported|real[- ]world|without help|show the skill)\b/i,
    mode: "performance",
    reason: "performance",
  },
  {
    pattern:
      /\b(first|introduc\w*|beginner\w*|new to|never|basic\w*|easy|cooperative|warm[- ]?up)\b/i,
    mode: "learning",
    reason: "firstTry",
  },
];

/**
 * The mode the trainer's description points to, and why; practice when nothing says otherwise.
 * Only the description is read: a competency names a skill ("Assessment of Harm & Response
 * Planning"), not how the roleplay is used, so its words would mislead the rules.
 */
export const recommendMode = (description: string): ModeRecommendation => {
  const hit = MODE_RULES.find(rule => rule.pattern.test(description ?? ""));
  return hit ? { mode: hit.mode, reason: hit.reason } : { mode: "practice", reason: "practice" };
};

export type NextStepKey =
  | "noTitle"
  | "noOpening"
  | "longOpening"
  | "noVoice"
  | "fewStates"
  | "fewReminders"
  | "supportsInAssessment"
  | "preview";

export interface NextStep {
  key: NextStepKey;
  /** Filled into the message, e.g. the number of states. */
  count?: number;
}

/** Spoken aloud, a first line much past this keeps the learner waiting before they can reply. */
const LONG_OPENING_CHARS = 220;
const MIN_STATES = 3;
const MIN_REMINDERS = 3;

const lines = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : typeof value === "string"
      ? value
          .split("\n")
          .map(line => line.trim())
          .filter(Boolean)
      : [];

/**
 * What to review after generating, most important first. Reads the form as the wizard left it;
 * `mode` is the one picked in the wizard (absent: only the mode-free checks run).
 */
export const suggestNextSteps = (
  values: Record<string, unknown>,
  mode?: RoleplayMode | null,
): NextStep[] => {
  const steps: NextStep[] = [];

  if (!String(values.title ?? "").trim()) steps.push({ key: "noTitle" });

  const primary = lines(values.openingStatements);
  const translated = Object.values(
    (values.translationOpeningStatements as Record<string, unknown>) ?? {},
  ).flatMap(lines);
  const openings = [...primary, ...translated];
  if (openings.length === 0) steps.push({ key: "noOpening" });
  else if (openings[0].length > LONG_OPENING_CHARS) steps.push({ key: "longOpening" });

  const voices = (values.languageVoices as Record<string, unknown>) ?? {};
  if (!Object.values(voices).some(Boolean)) steps.push({ key: "noVoice" });

  const states = Array.isArray(values.states) ? values.states : [];
  if (states.length > 0 && states.length < MIN_STATES) {
    steps.push({ key: "fewStates", count: states.length });
  }

  const supported = mode === "learning" || mode === "practice";
  const reminders = lines(values.reminders);
  if (supported && values.remindersEnabled && reminders.length < MIN_REMINDERS) {
    steps.push({ key: "fewReminders", count: reminders.length });
  }
  if (
    mode &&
    !supported &&
    (values.remindersEnabled || values.currentState || values.supervisorNotesEnabled)
  ) {
    steps.push({ key: "supportsInAssessment" });
  }

  steps.push({ key: "preview" });
  return steps;
};
