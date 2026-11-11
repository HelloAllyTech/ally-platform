import { useCallback, useState } from "react";

import { useCreateBotDraftMutation, useGetCurrentBotDraftQuery } from "@api";

import { COPY } from "./copy";
import { filesProblem, useDraftUpload } from "./useDraftUpload";

import type { BotDraftView } from "./types";

export const errorText = (error: unknown): string => {
  const data = (error as { data?: { message?: unknown } })?.data;
  return typeof data?.message === "string" ? data.message : COPY.problems.generic;
};

export interface OnboardingStart {
  /** A setup in progress, for the resume banner. */
  resume: BotDraftView | null;
  busy: boolean;
  error: string | null;
  /** Each resolves with the new draft's id, or null if it was refused (see `error`). */
  startWithWebsite: (website: string) => Promise<string | null>;
  startWithDescription: (description: string) => Promise<string | null>;
  startWithFiles: (files: File[]) => Promise<string | null>;
}

/**
 * Everything onboarding's start does (chunk 20a), without how it looks: a website, a description
 * or uploaded documents each start a draft; uploads go through the chatbot's own document routes
 * and are then read into "What we learned". The screen only draws and calls these.
 */
export const useOnboardingStart = (): OnboardingStart => {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { data: current } = useGetCurrentBotDraftQuery();
  const [createDraft, { isLoading: creating }] = useCreateBotDraftMutation();
  const upload = useDraftUpload();

  const start = useCallback(
    async (body: { website?: string; description?: string }) => {
      setError(null);
      try {
        return (await createDraft(body).unwrap()).id;
      } catch (err) {
        setError(errorText(err));
        return null;
      }
    },
    [createDraft],
  );

  const startWithFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      const problem = filesProblem(files);
      if (problem) {
        setError(problem);
        return null;
      }
      setUploading(true);
      try {
        const draft = await createDraft({ upload: true }).unwrap();
        await upload({ id: draft.id, chatbotId: draft.chatbotId! }, files);
        return draft.id;
      } catch (err) {
        setError(errorText(err));
        return null;
      } finally {
        setUploading(false);
      }
    },
    [createDraft, upload],
  );

  return {
    resume: current?.draft ?? null,
    busy: creating || uploading,
    error,
    startWithWebsite: website => start({ website: website.trim() }),
    startWithDescription: description => start({ description: description.trim() }),
    startWithFiles,
  };
};
