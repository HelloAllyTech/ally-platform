import { AllyGuideSupportLine } from "@types";

/**
 * What the learner's crisis card would show, worked out the way the server does it.
 *
 * Mirrors ally-be `resolveSupportLines` (src/guide/safety/fixed-responses.ts) and the learner card's
 * own handling (`crisisLinesFor`): an organisation's lines for the learner's language, else its
 * English lines, else the platform defaults; crisis lines first; and emergency services (112) is
 * always on the card. If the server's rules change, this is the place to follow them, and the
 * preview's test pins the cases.
 */

/** Mirror of ally-be `PLATFORM_DEFAULT_CRISIS_LINES`. */
export const PLATFORM_DEFAULT_CRISIS_LINES: AllyGuideSupportLine[] = [
  {
    name: "Tele-MANAS (free, 24×7)",
    phone: "14416",
    hours: "24 hours, every day",
    url: null,
    isCrisis: true,
  },
  {
    name: "Tele-MANAS (toll-free)",
    phone: "1-800-891-4416",
    hours: "24 hours, every day",
    url: null,
    isCrisis: true,
  },
  { name: "Emergency services", phone: "112", hours: null, url: null, isCrisis: true },
];

/** Tele-MANAS's toll-free alternative, which the learner card mentions under the buttons. */
export const TELE_MANAS_TOLL_FREE = "1-800-891-4416";

export type PreviewLinesSource = "org" | "english" | "default";

const digitsOf = (phone: string): string => phone.replace(/\D/g, "");

export const resolvePreviewLines = (
  supportLines: Partial<Record<string, AllyGuideSupportLine[]>> | undefined,
  language: string,
): { lines: AllyGuideSupportLine[]; source: PreviewLinesSource } => {
  const own = supportLines?.[language];
  const english = supportLines?.en;
  let source: PreviewLinesSource;
  let chosen: AllyGuideSupportLine[];
  if (own && own.length > 0) {
    source = "org";
    chosen = own;
  } else if (english && english.length > 0) {
    // For `en` itself this branch is unreachable: `own` would have been it.
    source = "english";
    chosen = english;
  } else {
    source = "default";
    chosen = PLATFORM_DEFAULT_CRISIS_LINES;
  }
  // Stable: Array.prototype.sort keeps the admin's order among lines of the same kind.
  const sorted = [...chosen].sort(
    (a, b) => Number(Boolean(b.isCrisis)) - Number(Boolean(a.isCrisis)),
  );
  if (!sorted.some(line => digitsOf(line.phone) === "112")) {
    sorted.push(PLATFORM_DEFAULT_CRISIS_LINES[2]);
  }
  return { lines: sorted, source };
};

export const hasTeleManas = (lines: AllyGuideSupportLine[]): boolean =>
  lines.some(line => digitsOf(line.phone) === "14416");
