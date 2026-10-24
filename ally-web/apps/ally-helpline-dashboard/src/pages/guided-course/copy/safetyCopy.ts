/**
 * Fixed safety copy: the crisis card, the CARE resource card and the
 * breathing guide (plans/ally-guide/design/voice-and-tone.md §11).
 *
 * PENDING CLINICAL REVIEW (plan §15.2 Q1). These strings are deliberately
 * NOT in the i18n bundles: a translation is shown only once that language's
 * version is clinically reviewed, and until then every learner sees English
 * with the same numbers (plan §6.3). Add a language here, not to the locale
 * files, when its review is signed off. The fixed crisis MESSAGE itself comes
 * from the server (`crisis.response.text`), already in the reviewed language.
 *
 * The card needs no network: it ships with the bundle so the numbers render
 * even offline (card grammar §5.4).
 */
import type { GuideCrisisLine } from "../contract/wire";

export interface SafetyCopy {
  crisisTitle: string;
  safeNow: string;
  needHelpNow: string;
  privacyFooter: string;
  needHelpLines: string[];
  safeNowLine: string;
  supportChip: string;
  call: string;
  tollFreeAlso: (name: string, number: string) => string;
  resourceTitle: string;
  resourceLine: string;
  resourceSupervisor: string;
  resourcePrivacy: string;
  breatheIntro: string;
  breatheStart: string;
  breatheStop: string;
  breatheIn: string;
  breatheOut: string;
  breatheHow: string;
  breatheBetter: string;
  breatheHeavy: string;
  backToCourse: string;
  close: string;
}

const EN: SafetyCopy = {
  crisisTitle: "Support is available now",
  safeNow: "I'm safe right now",
  needHelpNow: "I need help now",
  privacyFooter: "This stays private. Nothing is shared with your organisation.",
  needHelpLines: [
    "Please call one of the numbers above. They're trained for exactly this, and this page will stay open.",
    "If you can, let someone near you know how you're feeling right now.",
  ],
  safeNowLine:
    "Thank you for telling me. We can take this slowly. The support numbers are under the Support button at the top whenever you need them.",
  supportChip: "Support",
  call: "Call",
  tollFreeAlso: (name, number) => `${name} is also on ${number}.`,
  resourceTitle: "If you'd like support",
  resourceLine:
    "Talking to someone can help, especially when the work brings up your own experiences.",
  resourceSupervisor: "Your supervisor or a colleague you trust",
  resourcePrivacy: "This conversation stays private. Nothing is shared with your organisation.",
  breatheIntro:
    "Breathe in as the circle grows, and out as it settles. Four rounds. Stop whenever you like.",
  breatheStart: "Start",
  breatheStop: "Stop",
  breatheIn: "Breathe in…",
  breatheOut: "…and out",
  breatheHow: "How's that?",
  breatheBetter: "A bit better",
  breatheHeavy: "Still heavy",
  backToCourse: "Back to the course",
  close: "Close",
};

/** Reviewed languages only. Everything else falls back to English. */
const REVIEWED: Record<string, SafetyCopy> = { en: EN };

export const safetyCopyFor = (language: string | null | undefined): SafetyCopy =>
  REVIEWED[(language ?? "en").slice(0, 2)] ?? EN;

/**
 * The platform default lines, used when the org has none for the learner's
 * language. Tele-MANAS is free and 24×7; 112 is the national emergency
 * number (voice and tone §11).
 */
export const DEFAULT_CRISIS_LINES: GuideCrisisLine[] = [
  { name: "Tele-MANAS", phone: "14416", hours: "free, 24×7", url: null },
  { name: "Emergency", phone: "112", hours: null, url: null },
];

/** Tele-MANAS's toll-free alternative, shown as selectable text under the buttons. */
export const TELE_MANAS_TOLL_FREE = "1-800-891-4416";
