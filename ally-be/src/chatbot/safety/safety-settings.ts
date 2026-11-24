/**
 * The per-chatbot safety settings (assistants build, stage 1b): who the audience is, how long chats
 * are kept, how a miss is answered, which languages are on, who is alerted, how long a flagged chat
 * waits before "no one is available", and whether a flagged chat may go back to the assistant.
 *
 * Stored on `chatbots.settings` (the per-bot override) and read through `safetySettingsOf`, which
 * fills every default. The platform defaults record (`whatsapp_bot`) is not touched. Pure: no I/O.
 */

export const AUDIENCE_AGES = ['unstated', 'adults', 'includes_minors'] as const;
export type AudienceAge = (typeof AUDIENCE_AGES)[number];

export const NO_ANSWER_MODES = [
  'say_unknown_offer_person',
  'say_unknown',
  'offer_person',
] as const;
export type NoAnswerMode = (typeof NO_ANSWER_MODES)[number];

export const CRISIS_RESUME_RULES = ['never', 'after_idle'] as const;
export type CrisisResumeRule = (typeof CRISIS_RESUME_RULES)[number];

export const ALERT_MODES = ['immediate', 'digest'] as const;
export type AlertMode = (typeof ALERT_MODES)[number];

export interface AlertPolicy {
  mode: AlertMode;
  /** Extra email addresses alerted besides the members who hold Owner or Responder. */
  recipients?: string[];
}

export interface ChatbotSafetySettings {
  audienceAge: AudienceAge;
  retentionDays: number;
  noAnswerMode: NoAnswerMode;
  enabledLanguages: string[];
  alertPolicy: AlertPolicy;
  waitBeforeNoOneAvailableMinutes: number;
  crisisResumeRule: CrisisResumeRule;
  archivedMessage: string;
  timeZone: string;
}

/** The numbers the plan names. Bounds are inclusive. */
export const SAFETY_LIMITS = {
  retentionDays: { default: 90, min: 7, max: 365 },
  waitBeforeNoOneAvailableMinutes: { default: 10, min: 2, max: 120 },
  enabledLanguages: { max: 30 },
  recipients: { max: 20 },
  archivedMessageChars: 600,
} as const;

export const SAFETY_DEFAULTS: ChatbotSafetySettings = {
  audienceAge: 'unstated',
  retentionDays: SAFETY_LIMITS.retentionDays.default,
  noAnswerMode: 'say_unknown_offer_person',
  enabledLanguages: [],
  alertPolicy: { mode: 'immediate' },
  waitBeforeNoOneAvailableMinutes:
    SAFETY_LIMITS.waitBeforeNoOneAvailableMinutes.default,
  crisisResumeRule: 'never',
  archivedMessage: '',
  timeZone: 'Asia/Kolkata',
};

/** The keys this module owns on a bot's stored override. */
export const SAFETY_SETTING_KEYS = [
  'audienceAge',
  'retentionDays',
  'noAnswerMode',
  'enabledLanguages',
  'alertPolicy',
  'waitBeforeNoOneAvailableMinutes',
  'crisisResumeRule',
  'archivedMessage',
  'timeZone',
] as const;

type Stored = Partial<Record<(typeof SAFETY_SETTING_KEYS)[number], unknown>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Every setting with its default; a stored value that is out of range falls back to the default. */
export function safetySettingsOf(
  stored: Stored | null | undefined,
): ChatbotSafetySettings {
  const s = stored ?? {};
  const inRange = (v: unknown, min: number, max: number, dflt: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
      ? v
      : dflt;
  const policy = s.alertPolicy as Partial<AlertPolicy> | undefined;
  const recipients = Array.isArray(policy?.recipients)
    ? policy.recipients.filter((r) => typeof r === 'string' && EMAIL.test(r))
    : undefined;
  return {
    audienceAge: (AUDIENCE_AGES as readonly unknown[]).includes(s.audienceAge)
      ? (s.audienceAge as AudienceAge)
      : SAFETY_DEFAULTS.audienceAge,
    retentionDays: inRange(
      s.retentionDays,
      SAFETY_LIMITS.retentionDays.min,
      SAFETY_LIMITS.retentionDays.max,
      SAFETY_DEFAULTS.retentionDays,
    ),
    noAnswerMode: (NO_ANSWER_MODES as readonly unknown[]).includes(
      s.noAnswerMode,
    )
      ? (s.noAnswerMode as NoAnswerMode)
      : SAFETY_DEFAULTS.noAnswerMode,
    enabledLanguages: Array.isArray(s.enabledLanguages)
      ? s.enabledLanguages.filter((l): l is string => typeof l === 'string')
      : [],
    // Never off: anything that is not a known mode is immediate.
    alertPolicy: {
      mode: policy?.mode === 'digest' ? 'digest' : 'immediate',
      ...(recipients?.length ? { recipients } : {}),
    },
    waitBeforeNoOneAvailableMinutes: inRange(
      s.waitBeforeNoOneAvailableMinutes,
      SAFETY_LIMITS.waitBeforeNoOneAvailableMinutes.min,
      SAFETY_LIMITS.waitBeforeNoOneAvailableMinutes.max,
      SAFETY_DEFAULTS.waitBeforeNoOneAvailableMinutes,
    ),
    crisisResumeRule: (CRISIS_RESUME_RULES as readonly unknown[]).includes(
      s.crisisResumeRule,
    )
      ? (s.crisisResumeRule as CrisisResumeRule)
      : SAFETY_DEFAULTS.crisisResumeRule,
    archivedMessage:
      typeof s.archivedMessage === 'string' ? s.archivedMessage.trim() : '',
    timeZone:
      typeof s.timeZone === 'string' && isZone(s.timeZone)
        ? s.timeZone
        : SAFETY_DEFAULTS.timeZone,
  };
}

/**
 * Why a write is refused, or null. A key that is absent is fine (it follows the default); a key
 * that is present must be valid. Alerts can never be switched off: the only modes are `immediate`
 * and `digest`, and an explicit empty recipient list is refused in immediate mode.
 */
export function validateSafetySettings(
  next: Stored | null | undefined,
): string | null {
  if (!next) return null;
  const has = (k: keyof Stored) => next[k] !== undefined && next[k] !== null;
  if (
    has('audienceAge') &&
    !(AUDIENCE_AGES as readonly unknown[]).includes(next.audienceAge)
  )
    return `audienceAge is one of: ${AUDIENCE_AGES.join(', ')}`;
  if (
    has('noAnswerMode') &&
    !(NO_ANSWER_MODES as readonly unknown[]).includes(next.noAnswerMode)
  )
    return `noAnswerMode is one of: ${NO_ANSWER_MODES.join(', ')}`;
  if (
    has('crisisResumeRule') &&
    !(CRISIS_RESUME_RULES as readonly unknown[]).includes(next.crisisResumeRule)
  )
    return `crisisResumeRule is one of: ${CRISIS_RESUME_RULES.join(', ')}`;
  for (const key of [
    'retentionDays',
    'waitBeforeNoOneAvailableMinutes',
  ] as const) {
    if (!has(key)) continue;
    const { min, max } = SAFETY_LIMITS[key];
    const v = next[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
      return `${key} is a whole number from ${min} to ${max}`;
  }
  if (has('enabledLanguages')) {
    const l = next.enabledLanguages;
    if (
      !Array.isArray(l) ||
      l.length > SAFETY_LIMITS.enabledLanguages.max ||
      l.some((t) => typeof t !== 'string' || !LANGUAGE_TAG.test(t))
    )
      return 'enabledLanguages is a list of language tags such as "en" or "hi"';
  }
  if (has('archivedMessage')) {
    const m = next.archivedMessage;
    if (typeof m !== 'string' || m.length > SAFETY_LIMITS.archivedMessageChars)
      return `archivedMessage is text of at most ${SAFETY_LIMITS.archivedMessageChars} characters`;
  }
  if (has('timeZone')) {
    const z = next.timeZone;
    if (typeof z !== 'string' || !isZone(z))
      return 'timeZone is an IANA zone such as "Asia/Kolkata"';
  }
  if (has('alertPolicy')) {
    const p = next.alertPolicy as Partial<AlertPolicy>;
    if (typeof p !== 'object' || Array.isArray(p))
      return 'alertPolicy is { mode, recipients? }';
    if (!(ALERT_MODES as readonly unknown[]).includes(p.mode))
      return `alertPolicy.mode is one of: ${ALERT_MODES.join(', ')}; alerts cannot be switched off`;
    if (p.recipients !== undefined) {
      if (
        !Array.isArray(p.recipients) ||
        p.recipients.length > SAFETY_LIMITS.recipients.max ||
        p.recipients.some((r) => typeof r !== 'string' || !EMAIL.test(r))
      )
        return 'alertPolicy.recipients is a list of email addresses';
      if (p.mode === 'immediate' && p.recipients.length === 0)
        return 'immediate alerts need at least one recipient: leave recipients out to alert the owners and responders';
    }
  }
  return null;
}

const AGE_RANK: Record<AudienceAge, number> = {
  includes_minors: 0,
  unstated: 0,
  adults: 1,
};

/**
 * Whether a write loosens a safety setting, which only an owner may do: stating an adults-only
 * audience, keeping chats longer, waiting longer before "no one is available", letting a flagged
 * chat resume, or digesting alerts. Tightening is open to editors.
 */
export function loosensSafetySetting(
  stored: Stored | null | undefined,
  next: Stored | null | undefined,
): boolean {
  const a = safetySettingsOf(stored);
  const b = safetySettingsOf(next);
  return (
    AGE_RANK[b.audienceAge] > AGE_RANK[a.audienceAge] ||
    b.retentionDays > a.retentionDays ||
    b.waitBeforeNoOneAvailableMinutes > a.waitBeforeNoOneAvailableMinutes ||
    (a.crisisResumeRule === 'never' && b.crisisResumeRule !== 'never') ||
    (a.alertPolicy.mode === 'immediate' && b.alertPolicy.mode === 'digest')
  );
}
