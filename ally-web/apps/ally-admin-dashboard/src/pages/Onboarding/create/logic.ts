import type { BuildMode, WorkingCopyView } from "@api";

import { BUILD_COPY } from "./copy";
import { hasContact } from "../betterItems";

/**
 * Mirrors ally-be `working-copy/staged-fields.ts` SAFETY_RELEVANT: these run the safety check on
 * Apply and are refused at $0, so the form disables them when the builder has no credits.
 */
export const SAFETY_RELEVANT = new Set([
  "assistantName",
  "tone",
  "instructions",
  "languages",
  "declineText",
  "extraNever",
  "ownerNotes",
  "sources",
]);

/** The tones the draft schema accepts. */
export const TONE_IDS = ["warm", "friendly", "professional", "formal"] as const;

/** Languages offered in the form (BCP-47). The server validates; this is only the short list. */
export const LANGUAGE_IDS = ["en", "hi", "mr", "ta", "kn", "te", "bn"] as const;

/** After this pause in typing, a field's edit is sent (no Save button). */
export const EDIT_DEBOUNCE_MS = 800;

export interface ApiError {
  status?: number | string;
  data?: {
    errorCode?: string;
    message?: string | string[];
    details?: { field?: string; value?: unknown; version?: string; [k: string]: unknown };
  };
}

export const errorOf = (error: unknown): ApiError => (error ?? {}) as ApiError;
export const codeOf = (error: unknown): string | undefined => errorOf(error).data?.errorCode;
export const messageOf = (error: unknown): string | null => {
  const m = errorOf(error).data?.message;
  if (Array.isArray(m)) return m.join(" ");
  return typeof m === "string" && m.trim() ? m : null;
};

/** 402 `credits_required`: the builder has $0 for AI work. */
export const isCreditsRequired = (error: unknown): boolean =>
  errorOf(error).status === 402 || codeOf(error) === "credits_required";

/** A crawl failure code as a plain explanation; the code itself is never shown. */
export const crawlFailureText = (code: string | null | undefined, fallback?: string | null) =>
  (code && BUILD_COPY.crawlFailure[code]) || fallback || BUILD_COPY.crawlFailure.crawl_failed;

/**
 * The setup's own working documents ("What we learned", "Owner notes"): the assistant reads them,
 * but they are not sources the owner added, so the Sources list leaves them out. The same titles
 * ally-be never shows as a source (`INTERNAL_TITLES` in reply-composer.ts).
 */
export const INTERNAL_SOURCE_TITLES = /^(what we learned|owner notes)\b/i;
export const isInternalSource = (title: string | null | undefined): boolean =>
  INTERNAL_SOURCE_TITLES.test((title ?? "").trim());

/** `sunrise.org`, `www.x.com/a` and `https://x.com` are web addresses; text with spaces is not. */
const WEB_ADDRESS = /^(https?:\/\/)?[^\s/.]+(\.[^\s/.]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i;
export const looksLikeAddress = (text: string): boolean => WEB_ADDRESS.test(text.trim());

/** The value as text, for a text field. */
export const asText = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

/** The value as a list of text. */
export const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(v => String(v)) : [];

/** Lines typed in a box, as a list (blank lines dropped). */
export const linesOf = (text: string): string[] =>
  text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * A blank chatbot nobody has chosen a start for yet: the left panel shows the start options. A test
 * message touches a blank (so it is kept) but chooses nothing, so `touched` alone doesn't hide them;
 * every start path stores a mode, and a template is recorded.
 */
export const showsStart = (wc: Pick<WorkingCopyView, "blank" | "template" | "buildMode">) =>
  wc.blank && !wc.template && !wc.buildMode;

/**
 * The mode the left panel opens in: the remembered one, else Copilot after a start path, the form
 * after a template, the form for an existing chatbot. A start path stores its mode as it is chosen
 * (`POST .../mode`), so only an unremembered chatbot falls through to the form here.
 */
export const defaultMode = (wc: Pick<WorkingCopyView, "buildMode">): BuildMode =>
  wc.buildMode ?? "form";

/** The mode a start path opens: Copilot after website, documents or interview; the form after a template. */
export const modeAfterStart = (
  path: "template" | "website" | "documents" | "interview",
): BuildMode => (path === "template" ? "form" : "copilot");

export type SuggestionId =
  | "sources"
  | "greeting"
  | "instructions"
  | "questions"
  | "contact"
  | "tone";

/** The field each suggestion is about (null for sources, which has its own section). */
export const SUGGESTION_FIELD: Record<SuggestionId, string | null> = {
  sources: null,
  greeting: "introduction",
  instructions: "instructions",
  questions: "suggestedQuestions",
  contact: "declineText",
  tone: "tone",
};

/**
 * "Make it better", computed in the browser at no cost: an item is listed while it is still true,
 * so doing it removes it. Highest impact first.
 */
export const suggestionsFor = (
  fields: Record<string, unknown>,
  hasSources: boolean,
): SuggestionId[] => {
  const out: SuggestionId[] = [];
  if (!hasSources && !asText(fields.ownerNotes).trim()) out.push("sources");
  if (!asText(fields.introduction).trim()) out.push("greeting");
  if (!asText(fields.instructions).trim()) out.push("instructions");
  if (asList(fields.suggestedQuestions).length === 0) out.push("questions");
  if (!hasContact(asText(fields.declineText))) out.push("contact");
  if (!asText(fields.tone).trim()) out.push("tone");
  return out;
};
