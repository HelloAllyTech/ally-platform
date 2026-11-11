import { useCallback, useState } from "react";

import axios from "axios";

import {
  useAddBotDraftDocumentMutation,
  useCreateBotDraftMutation,
  useCreateChatbotDocumentUploadUrlMutation,
  useCreatePrivateChatbotDocumentMutation,
  useGetCurrentBotDraftQuery,
} from "@api";

import { COPY } from "./copy";

import type { BotDraftView } from "./types";

/** Copy §13: up to 10 files at a time, 20 MB each. */
const MAX_FILES = 10;
const MAX_BYTES = 20 * 1024 * 1024;
const FORMATS: Record<string, { sourceType: string; mime: string }> = {
  pdf: { sourceType: "pdf", mime: "application/pdf" },
  docx: {
    sourceType: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  txt: { sourceType: "paste", mime: "text/plain" },
};
export const ACCEPTED_FILES = ".pdf,.docx,.txt";

const extension = (name: string) => name.toLowerCase().split(".").pop() ?? "";
const withoutExtension = (name: string) => name.replace(/\.[^.]+$/, "");

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
  const [createUploadUrl] = useCreateChatbotDocumentUploadUrlMutation();
  const [createDocument] = useCreatePrivateChatbotDocumentMutation();
  const [addDocument] = useAddBotDraftDocumentMutation();

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
      if (
        !files.length ||
        files.length > MAX_FILES ||
        files.some(f => f.size > MAX_BYTES || !FORMATS[extension(f.name)])
      ) {
        setError(COPY.start.uploadLimits);
        return null;
      }
      setUploading(true);
      try {
        const draft = await createDraft({ upload: true }).unwrap();
        const botId = draft.chatbotId!;
        for (const file of files) {
          const format = FORMATS[extension(file.name)];
          const title = withoutExtension(file.name);
          let rows;
          if (format.sourceType === "paste") {
            rows = await createDocument({
              id: botId,
              title,
              sourceType: "paste",
              text: await file.text(),
            } as never).unwrap();
          } else {
            const { presignedUrl, fileUrl } = await createUploadUrl({
              id: botId,
              fileName: file.name,
              fileSize: file.size,
              contentType: format.mime,
            }).unwrap();
            await axios.put(presignedUrl, file, { headers: { "Content-Type": format.mime } });
            rows = await createDocument({
              id: botId,
              title,
              sourceType: format.sourceType,
              fileUrl,
              fileName: file.name,
              contentType: format.mime,
              sizeBytes: file.size,
            } as never).unwrap();
          }
          const added = (rows as { id: string; title: string }[]).find(r => r.title === title);
          if (added) await addDocument({ id: draft.id, documentId: added.id }).unwrap();
        }
        return draft.id;
      } catch (err) {
        setError(errorText(err));
        return null;
      } finally {
        setUploading(false);
      }
    },
    [addDocument, createDocument, createDraft, createUploadUrl],
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
