import { useCallback } from "react";

import axios from "axios";

import {
  useAddBotDraftDocumentMutation,
  useCreateChatbotDocumentUploadUrlMutation,
  useCreatePrivateChatbotDocumentMutation,
} from "@api";

import { COPY } from "./copy";

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

/** Why these files can't be uploaded (too many, too big, a format we don't read), or null. */
export const filesProblem = (files: File[]): string | null =>
  !files.length ||
  files.length > MAX_FILES ||
  files.some(f => f.size > MAX_BYTES || !FORMATS[extension(f.name)])
    ? COPY.start.uploadLimits
    : null;

/**
 * Uploads documents to a setup (chunk 20a): each goes through the draft chatbot's own document
 * routes, then is read into "What we learned". Used by the start screen and by "What we learned"
 * when a website gave too little.
 */
export const useDraftUpload = () => {
  const [createUploadUrl] = useCreateChatbotDocumentUploadUrlMutation();
  const [createDocument] = useCreatePrivateChatbotDocumentMutation();
  const [addDocument] = useAddBotDraftDocumentMutation();

  return useCallback(
    async (draft: { id: string; chatbotId: string }, files: File[]) => {
      const botId = draft.chatbotId;
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
    },
    [addDocument, createDocument, createUploadUrl],
  );
};
