import { enabledLanguagesOf } from '../languages/reply-language-for';
import { safetySettingsOf } from './safety-settings';
import { SAFETY_TERMS_VERSION, humanContactOf } from './safety-terms';
import type {
  ChatbotSafetyState,
  LanguageCrisisStatus,
} from './safety-state.service';
import { CRISIS_SUITE as suite } from './crisis-suite/crisis-suite';

/**
 * The go-live gate (stage 4, D10): what a chatbot needs before customers can use it, on every path
 * that makes one live. Pure: the service reads the rows, this decides.
 */
export type GoLiveItem =
  | 'audience_age'
  | 'human_contact'
  | 'purpose'
  | 'safety_terms'
  | 'crisis_check';

export const GO_LIVE_ITEMS: readonly GoLiveItem[] = [
  'audience_age',
  'human_contact',
  'purpose',
  'safety_terms',
  'crisis_check',
];

// COPY: needs approval
export const GO_LIVE_COPY: Record<GoLiveItem, string> = {
  audience_age:
    'Say who will use it: adults only, or people who may be under 18.',
  human_contact:
    'Add a way for people to reach a person: a phone number, an email or a web page.',
  purpose: 'Choose what the assistant is for.',
  safety_terms: 'Read and accept the safety terms.',
  crisis_check:
    'Run the crisis check. It must pass in at least one language, and every language you turn on must be checked.',
};

// COPY: needs approval
export const GO_LIVE_REFUSED =
  'This assistant can’t go live yet. Finish the go-live checklist first.';

export type LanguageGateStatus =
  /** Passed the current suite: customers get this language. */
  | 'pass'
  /** Failed: turned off for customers; the others still go live. */
  | 'off'
  /** Not checked against the current suite yet (or the check could not run). */
  | 'unchecked'
  /** No curated crisis suite exists for it, so it cannot pass (D5). */
  | 'no_suite';

export interface LanguageGateRow {
  language: string;
  status: LanguageGateStatus;
  checkedAt: string | null;
  passed: number | null;
  total: number | null;
}

export interface GoLiveCheck {
  /** Every item is done. */
  ok: boolean;
  /** False while the kill switch is off: the check is shown, never enforced. */
  enforced: boolean;
  missing: { item: GoLiveItem; message: string }[];
  items: { item: GoLiveItem; done: boolean; message: string }[];
  languages: LanguageGateRow[];
  /** The languages customers get when it goes live. */
  liveLanguages: string[];
  terms: {
    version: string;
    acceptedVersion: string | null;
    acceptedAt: string | null;
  };
  pausedByGate: { at: string; missing: string[] } | null;
}

/** The current suite's version and the languages it covers. */
export const CRISIS_SUITE_VERSION: string = suite.version;

export const normLanguage = (tag: string): string => tag.trim().toLowerCase();

export function suiteCovers(language: string): boolean {
  const l = normLanguage(language);
  return suite.cases.some((c) => c.language === l);
}

export function languageRows(
  enabled: string[],
  status: LanguageCrisisStatus,
): LanguageGateRow[] {
  const seen = new Set<string>();
  const rows: LanguageGateRow[] = [];
  const add = (language: string) => {
    const key = normLanguage(language);
    if (seen.has(key)) return;
    seen.add(key);
    const result = status[key];
    const current = result?.suiteVersion === CRISIS_SUITE_VERSION;
    const state: LanguageGateStatus = !suiteCovers(key)
      ? 'no_suite'
      : !current || !result || result.status === 'error'
        ? 'unchecked'
        : result.status === 'pass'
          ? 'pass'
          : 'off';
    rows.push({
      language: key,
      status: state,
      checkedAt: current ? (result?.checkedAt ?? null) : null,
      passed: current ? (result?.passed ?? null) : null,
      total: current ? (result?.total ?? null) : null,
    });
  };
  enabled.forEach(add);
  // A language a failed check turned off is still listed, as off.
  for (const [language, result] of Object.entries(status)) {
    if (result?.turnedOffAt && result.suiteVersion === CRISIS_SUITE_VERSION)
      add(language);
  }
  return rows;
}

export function evaluateGoLive(input: {
  chatbot: {
    purpose?: string | null;
    settings?: Record<string, unknown> | null;
    persona?: {
      defaultLanguage?: string | null;
      languages?: string[] | null;
    } | null;
  };
  state: ChatbotSafetyState;
  enforced: boolean;
}): GoLiveCheck {
  const { chatbot, state } = input;
  const safety = safetySettingsOf(chatbot.settings as never);
  const languages = languageRows(
    enabledLanguagesOf(chatbot as never),
    state.languageCrisisStatus ?? {},
  );
  const liveLanguages = languages
    .filter((l) => l.status === 'pass')
    .map((l) => l.language);
  const done: Record<GoLiveItem, boolean> = {
    audience_age: safety.audienceAge !== 'unstated',
    human_contact: Boolean(humanContactOf(chatbot.settings)),
    purpose: Boolean(chatbot.purpose?.trim()),
    safety_terms:
      state.termsVersion === SAFETY_TERMS_VERSION &&
      Boolean(state.termsAcceptedAt),
    // At least one language passed, and none is waiting for a check. A failed language is off and
    // does not hold the others back; a language with no suite can never pass, so it is off too.
    crisis_check:
      liveLanguages.length > 0 &&
      !languages.some((l) => l.status === 'unchecked'),
  };
  const items = GO_LIVE_ITEMS.map((item) => ({
    item,
    done: done[item],
    message: GO_LIVE_COPY[item],
  }));
  return {
    ok: items.every((i) => i.done),
    enforced: input.enforced,
    missing: items
      .filter((i) => !i.done)
      .map(({ item, message }) => ({ item, message })),
    items,
    languages,
    liveLanguages,
    terms: {
      version: SAFETY_TERMS_VERSION,
      acceptedVersion: state.termsVersion,
      acceptedAt: state.termsAcceptedAt
        ? new Date(state.termsAcceptedAt).toISOString()
        : null,
    },
    pausedByGate: state.pausedByGateAt
      ? {
          at: new Date(state.pausedByGateAt).toISOString(),
          missing: state.pausedByGateReason?.missing ?? [],
        }
      : null,
  };
}
