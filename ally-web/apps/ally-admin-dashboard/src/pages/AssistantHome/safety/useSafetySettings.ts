import { useRef, useState } from "react";

import { useGetChatbotSettingsQuery, useUpdateChatbotSettingsMutation } from "@api";

import { SAFETY_PRIVACY_COPY as C } from "../copy/safetyPrivacy";

export interface HumanContact {
  phone?: string;
  email?: string;
  url?: string;
}

export interface AlertPolicy {
  mode: "immediate" | "digest";
  recipients?: string[];
}

/** The safety keys a chatbot stores on its settings (ally-be `chatbot/safety/safety-settings.ts`). */
export interface SafetyValues {
  audienceAge?: "unstated" | "adults" | "includes_minors";
  retentionDays?: number;
  noAnswerMode?: string;
  alertPolicy?: AlertPolicy;
  waitBeforeNoOneAvailableMinutes?: number;
  crisisResumeRule?: string;
  timeZone?: string;
  humanContact?: HumanContact;
}

/** The defaults ally-be fills in for a key nobody has set. */
export const SAFETY_DEFAULTS = {
  audienceAge: "unstated",
  retentionDays: 90,
  noAnswerMode: "say_unknown_offer_person",
  alertPolicy: { mode: "immediate" } as AlertPolicy,
  waitBeforeNoOneAvailableMinutes: 10,
  crisisResumeRule: "never",
  timeZone: "Asia/Kolkata",
} as const;

export const SAFETY_LIMITS = {
  retentionDays: { min: 7, max: 365 },
  waitBeforeNoOneAvailableMinutes: { min: 2, max: 120 },
} as const;

/** The reason ally-be gave for a refusal, or a plain line for a 403. */
export const refusalOf = (error: unknown): string => {
  const e = (error ?? {}) as { status?: number | string; data?: { message?: string | string[] } };
  const m = e.data?.message;
  const text = Array.isArray(m) ? m.join(" ") : typeof m === "string" ? m : "";
  if (text.trim()) return text;
  return e.status === 403 ? C.ownerOnly : C.saveFailed;
};

/**
 * A chatbot's stored settings. `PUT :id/settings` replaces every change the chatbot makes, so a
 * save sends what is stored with one key changed; the latest answer is kept so two quick saves in
 * a row don't undo each other.
 */
export const useSafetySettings = (chatbotId: string) => {
  const query = useGetChatbotSettingsQuery(chatbotId);
  const [put, { isLoading }] = useUpdateChatbotSettingsMutation();
  // What the last save answered: shown at once, and the base of the next save.
  const [answered, setAnswered] = useState<Record<string, unknown> | null>(null);
  const latest = useRef<Record<string, unknown> | null>(null);
  const stored = (answered ?? query.data?.overrides ?? {}) as Record<string, unknown>;

  /** Saves `patch`; resolves with null, or the reason it was refused. */
  const save = async (
    patch: Partial<Record<keyof SafetyValues, unknown>>,
  ): Promise<string | null> => {
    const base = (latest.current ?? query.data?.overrides ?? {}) as Record<string, unknown>;
    try {
      const result = await put({
        id: chatbotId,
        settings: { ...base, ...patch } as never,
      }).unwrap();
      latest.current = result.overrides as Record<string, unknown>;
      setAnswered(latest.current);
      return null;
    } catch (error) {
      return refusalOf(error);
    }
  };

  return {
    loaded: Boolean(query.data),
    failed: query.isError,
    saving: isLoading,
    values: stored as SafetyValues,
    save,
  };
};
