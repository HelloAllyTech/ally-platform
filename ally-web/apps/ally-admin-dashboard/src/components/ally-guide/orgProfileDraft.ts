import { AllyGuideLanguage, AllyGuideOrgProfileValue, AllyGuideSupportLine } from "@types";

import { ALLY_GUIDE_LANGUAGES } from "./allyGuideFormat";

/**
 * The org profile as the form holds it, and the rules for turning it back into what the server
 * accepts. The server (`normaliseOrgProfile`) trims, bounds and silently truncates; these limits
 * are the same numbers, applied up front so a save never loses text it appeared to accept.
 */
export const MAX_LINES_PER_LANGUAGE = 10;
export const MAX_AVOID_TOPICS = 20;
export const LIMITS = {
  lineName: 120,
  linePhone: 40,
  lineHours: 80,
  lineUrl: 300,
  supervisorContact: 200,
  supervisorWording: 400,
  protocols: 4000,
  toneNotes: 1000,
  topic: 80,
} as const;

/** Same pattern as the server's phone check. */
const PHONE_PATTERN = /^[+\d(][\d\s().-]{2,}$/;
const URL_PATTERN = /^https?:\/\/\S+$/i;

export interface DraftLine {
  /** Stable across edits, so React keeps the right row's focus when another is removed. */
  key: string;
  name: string;
  phone: string;
  hours: string;
  url: string;
  isCrisis: boolean;
}

export interface OrgProfileDraft {
  supportLines: Record<AllyGuideLanguage, DraftLine[]>;
  supervisorContact: string;
  supervisorWording: string;
  protocols: string;
  toneNotes: string;
  avoidTopics: string[];
  outreachEnabled: boolean;
  emailEnabled: boolean;
}

let lineCounter = 0;
export const nextLineKey = (): string => `line-${(lineCounter += 1)}`;

export const emptyLine = (): DraftLine => ({
  key: nextLineKey(),
  name: "",
  phone: "",
  hours: "",
  url: "",
  isCrisis: false,
});

const toDraftLine = (line: AllyGuideSupportLine): DraftLine => ({
  key: nextLineKey(),
  name: line.name ?? "",
  phone: line.phone ?? "",
  hours: line.hours ?? "",
  url: line.url ?? "",
  isCrisis: Boolean(line.isCrisis),
});

export const draftFromProfile = (
  profile: AllyGuideOrgProfileValue | undefined,
): OrgProfileDraft => {
  const source = profile ?? {};
  const supportLines = Object.fromEntries(
    ALLY_GUIDE_LANGUAGES.map(language => [
      language,
      (source.supportLines?.[language] ?? []).map(toDraftLine),
    ]),
  ) as Record<AllyGuideLanguage, DraftLine[]>;
  return {
    supportLines,
    supervisorContact: source.supervisorContact ?? "",
    supervisorWording: source.supervisorWording ?? "",
    protocols: source.protocols ?? "",
    toneNotes: source.toneNotes ?? "",
    avoidTopics: [...(source.avoidTopics ?? [])],
    // The server treats an absent flag as on, so the form does too: a save must not switch off
    // something the admin never saw switched on.
    outreachEnabled: source.outreachEnabled !== false,
    emailEnabled: source.emailEnabled !== false,
  };
};

const orNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/**
 * What goes to `PUT org-profile`. The body is the WHOLE profile: the server replaces it, so
 * every field is always sent, including the two outreach flags (omitted, they would reset to on).
 * Languages with no lines are left out rather than sent as empty lists.
 */
export const profileFromDraft = (draft: OrgProfileDraft): AllyGuideOrgProfileValue => {
  const supportLines: Partial<Record<AllyGuideLanguage, AllyGuideSupportLine[]>> = {};
  for (const language of ALLY_GUIDE_LANGUAGES) {
    const lines = draft.supportLines[language] ?? [];
    if (lines.length === 0) continue;
    supportLines[language] = lines.map(line => ({
      name: line.name.trim(),
      phone: line.phone.trim(),
      hours: orNull(line.hours),
      url: orNull(line.url),
      isCrisis: line.isCrisis,
    }));
  }
  return {
    supportLines,
    supervisorContact: orNull(draft.supervisorContact),
    supervisorWording: orNull(draft.supervisorWording),
    protocols: orNull(draft.protocols),
    toneNotes: orNull(draft.toneNotes),
    avoidTopics: draft.avoidTopics.map(topic => topic.trim()).filter(Boolean),
    outreachEnabled: draft.outreachEnabled,
    emailEnabled: draft.emailEnabled,
  };
};

export const isDraftDirty = (draft: OrgProfileDraft, baseline: OrgProfileDraft): boolean =>
  JSON.stringify(profileFromDraft(draft)) !== JSON.stringify(profileFromDraft(baseline));

export interface LineErrors {
  name?: "nameRequired";
  phone?: "phoneRequired" | "phoneInvalid";
  url?: "urlInvalid";
}

export const validateLine = (line: DraftLine): LineErrors => {
  const errors: LineErrors = {};
  if (!line.name.trim()) errors.name = "nameRequired";
  const phone = line.phone.trim();
  if (!phone) errors.phone = "phoneRequired";
  else if (!PHONE_PATTERN.test(phone)) errors.phone = "phoneInvalid";
  const url = line.url.trim();
  if (url && !URL_PATTERN.test(url)) errors.url = "urlInvalid";
  return errors;
};

/** Errors by line key, for every language; empty when the whole draft can be saved. */
export const validateDraft = (draft: OrgProfileDraft): Record<string, LineErrors> => {
  const errors: Record<string, LineErrors> = {};
  for (const language of ALLY_GUIDE_LANGUAGES) {
    for (const line of draft.supportLines[language] ?? []) {
      const lineErrors = validateLine(line);
      if (Object.keys(lineErrors).length > 0) errors[line.key] = lineErrors;
    }
  }
  return errors;
};
