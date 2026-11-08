import React, { useRef, useState } from "react";

import axios from "axios";
import { useNavigate } from "react-router-dom";

import { AutoExpandableTextarea, InlineNotification } from "@ally-ui-mono/ui-shared";
import {
  useAddBotDraftDocumentMutation,
  useCreateBotDraftMutation,
  useCreateChatbotDocumentUploadUrlMutation,
  useCreatePrivateChatbotDocumentMutation,
  useGetCurrentBotDraftQuery,
} from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { ROUTES } from "@constants";

import { COPY, fill } from "./copy";

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
const extension = (name: string) => name.toLowerCase().split(".").pop() ?? "";
const withoutExtension = (name: string) => name.replace(/\.[^.]+$/, "");

type Mode = "website" | "describe";

const errorText = (error: unknown): string => {
  const data = (error as { data?: { message?: unknown } })?.data;
  return typeof data?.message === "string" ? data.message : COPY.problems.generic;
};

/**
 * Onboarding's start (copy §1): a website, documents or a description. Each starts a draft and
 * opens the builder; a draft already in progress is offered first (copy §13's resume banner).
 */
export const OnboardingStart: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("website");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: current } = useGetCurrentBotDraftQuery();
  const [createDraft, { isLoading: creating }] = useCreateBotDraftMutation();
  const [createUploadUrl] = useCreateChatbotDocumentUploadUrlMutation();
  const [createDocument] = useCreatePrivateChatbotDocumentMutation();
  const [addDocument] = useAddBotDraftDocumentMutation();
  const busy = creating || uploading;

  const open = (id: string) => navigate(ROUTES.CHATBOT_NEW_SESSION(id));

  const start = async (body: { website?: string; description?: string }) => {
    setError(null);
    try {
      const draft = await createDraft(body).unwrap();
      open(draft.id);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const upload = async (files: File[]) => {
    setError(null);
    const picked = files.slice(0, MAX_FILES);
    if (
      files.length > MAX_FILES ||
      picked.some(f => f.size > MAX_BYTES || !FORMATS[extension(f.name)])
    ) {
      setError(COPY.start.uploadLimits);
      return;
    }
    setUploading(true);
    try {
      const draft = await createDraft({ upload: true }).unwrap();
      const botId = draft.chatbotId!;
      for (const file of picked) {
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
      open(draft.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const resume = current?.draft;

  return (
    <div className="flex h-full justify-center overflow-y-auto px-4 py-12">
      <div className="flex w-full max-w-xl flex-col gap-6">
        {resume && (
          <button
            type="button"
            onClick={() => open(resume.id)}
            className="rounded-md border border-primary-200 bg-primary-50 px-4 py-3 text-left text-sm text-typography-900 hover:bg-primary-100"
          >
            {fill(COPY.problems.resume, { business: resume.draft.name })}
          </button>
        )}

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-secondary text-typography-900">{COPY.start.title}</h1>
          <p className="text-base text-typography-700">{COPY.start.subtitle}</p>
        </div>

        {mode === "website" ? (
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={event => {
              event.preventDefault();
              if (website.trim()) void start({ website: website.trim() });
            }}
          >
            <input
              aria-label={COPY.start.placeholder}
              className="flex-1 rounded-md border border-border-light px-3 py-2 text-base focus:border-primary-600 focus:outline-none"
              placeholder={COPY.start.placeholder}
              value={website}
              onChange={event => setWebsite(event.target.value)}
              inputMode="url"
              autoFocus
            />
            <Button
              type="submit"
              variant={ButtonVariant.PRIMARY}
              disabled={!website.trim() || busy}
            >
              {COPY.start.primary}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-typography-700">{COPY.start.describePrompt}</p>
            <AutoExpandableTextarea
              id="describe-business"
              value={description}
              onChange={setDescription}
              placeholder={COPY.start.describePlaceholder}
              maxLines={10}
            />
            <Button
              variant={ButtonVariant.PRIMARY}
              className="self-start"
              disabled={description.trim().length < 20 || busy}
              onClick={() => void start({ description: description.trim() })}
            >
              {COPY.start.describeButton}
            </Button>
          </div>
        )}

        {error && <InlineNotification kind="error" lowContrast hideCloseButton title={error} />}

        <div className="flex flex-col gap-2 text-sm">
          <button
            type="button"
            className="self-start underline text-typography-800 disabled:opacity-50"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {COPY.start.upload}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt"
            className="hidden"
            data-testid="onboarding-upload"
            onChange={event => void upload(Array.from(event.target.files ?? []))}
          />
          <button
            type="button"
            className="self-start underline text-typography-800"
            onClick={() => setMode(mode === "describe" ? "website" : "describe")}
          >
            {mode === "describe" ? COPY.start.primary : COPY.start.describe}
          </button>
          <p className="text-xs text-typography-600">{COPY.start.uploadLimits}</p>
        </div>

        <p className="text-xs text-typography-500">{COPY.start.footnote}</p>
      </div>
    </div>
  );
};
