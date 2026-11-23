import {
  GuideOrgProfileValue,
  GuideSupportLine,
} from '../entity/guide-org-profile.entity';

/**
 * The guide's FIXED responses (plans/ally-guide/plan.md §6.1, §6.3): text no
 * model writes, sent verbatim when the Sentinel or the mode machine calls
 * for it.
 *
 * These code defaults are PLACEHOLDERS until the clinical safety reviewer
 * approves the copy (plan §13.1, Q1). Approved copy lives in
 * `guide_crisis_responses` per language and tenant and always wins; English
 * is the fallback for a language with no approved row.
 */

/** India's national tele-mental-health line, the platform default. */
export const PLATFORM_DEFAULT_CRISIS_LINES: GuideSupportLine[] = [
  {
    name: 'Tele-MANAS (free, 24×7)',
    phone: '14416',
    hours: '24 hours, every day',
    url: null,
    isCrisis: true,
  },
  {
    name: 'Tele-MANAS (toll-free)',
    phone: '1-800-891-4416',
    hours: '24 hours, every day',
    url: null,
    isCrisis: true,
  },
  {
    name: 'Emergency services',
    phone: '112',
    hours: null,
    url: null,
    isCrisis: true,
  },
];

/**
 * The platform default in each supported language: same numbers, names and
 * hours translated (Tele-MANAS is a name and stays as it is). PLACEHOLDER
 * wording, like the rest of this file, until a native speaker checks it.
 */
const crisisLines = (
  free: string,
  tollFree: string,
  hours: string,
  emergency: string,
): GuideSupportLine[] => [
  { ...PLATFORM_DEFAULT_CRISIS_LINES[0], name: free, hours },
  { ...PLATFORM_DEFAULT_CRISIS_LINES[1], name: tollFree, hours },
  { ...PLATFORM_DEFAULT_CRISIS_LINES[2], name: emergency },
];

export const PLATFORM_DEFAULT_CRISIS_LINES_BY_LANGUAGE: Record<
  string,
  GuideSupportLine[]
> = {
  en: PLATFORM_DEFAULT_CRISIS_LINES,
  hi: crisisLines(
    'Tele-MANAS (निःशुल्क, 24×7)',
    'Tele-MANAS (टोल-फ़्री)',
    '24 घंटे, हर दिन',
    'आपातकालीन सेवाएँ',
  ),
  mr: crisisLines(
    'Tele-MANAS (मोफत, 24×7)',
    'Tele-MANAS (टोल-फ्री)',
    '24 तास, दररोज',
    'आपत्कालीन सेवा',
  ),
  ta: crisisLines(
    'Tele-MANAS (இலவசம், 24×7)',
    'Tele-MANAS (கட்டணமில்லா எண்)',
    '24 மணி நேரமும், தினமும்',
    'அவசர சேவைகள்',
  ),
  kn: crisisLines(
    'Tele-MANAS (ಉಚಿತ, 24×7)',
    'Tele-MANAS (ಟೋಲ್-ಫ್ರೀ)',
    'ದಿನದ 24 ಗಂಟೆ, ಪ್ರತಿದಿನ',
    'ತುರ್ತು ಸೇವೆಗಳು',
  ),
};

export const DEFAULT_CRISIS_TEXT =
  "I'm really glad you told me. What you're feeling matters, and you deserve " +
  "to talk to a person right now. I'm an AI, so I can't be the help you need " +
  'in this moment, but someone can: please call one of the numbers below. ' +
  "They're free and confidential. If you are in immediate danger, call 112.";

/** Shown after "I need help now" while no model may speak (plan §6.3 step 5). */
export const DEFAULT_CRISIS_STAY_TEXT =
  "You don't have to get through this alone. The numbers above are there for " +
  "exactly this moment. If you can, call one now. When you're ready, you can " +
  'write to me again.';

export const DEFAULT_CRISIS_CHECK_IN_TEXT =
  "Welcome back. Before we go on, how are you doing today? There's no rush; " +
  'we can take this at whatever pace suits you.';

/** A real person the learner supports is at risk now (plan §6.1). */
export function urgentRealCaseText(
  profile: GuideOrgProfileValue | null,
): string {
  const supervisor = profile?.supervisorContact?.trim();
  return (
    'This sounds urgent. Please follow your organisation’s emergency ' +
    'protocol and contact your supervisor now' +
    (supervisor ? ` (${supervisor})` : '') +
    ". If someone's life is in immediate danger, call 112. I can't advise " +
    "on a live situation, but once they're safe I'm here to help you think " +
    'it through.'
  );
}

/**
 * The lines to show, for a language: the org's own for that language, else
 * the org's English ones, else the platform default in that language (else
 * English). Crisis lines first.
 */
export function resolveSupportLines(
  profile: GuideOrgProfileValue | null,
  language: string,
): GuideSupportLine[] {
  const byLanguage = profile?.supportLines ?? {};
  const lines =
    byLanguage[language]?.length > 0
      ? byLanguage[language]
      : byLanguage.en?.length > 0
        ? byLanguage.en
        : (PLATFORM_DEFAULT_CRISIS_LINES_BY_LANGUAGE[
            (language ?? '').split(/[-_]/)[0].toLowerCase()
          ] ?? PLATFORM_DEFAULT_CRISIS_LINES);
  return [...lines].sort(
    (a, b) => Number(Boolean(b.isCrisis)) - Number(Boolean(a.isCrisis)),
  );
}
