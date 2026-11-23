import { useCallback } from "react";

import axios from "axios";

import { useAddBotDraftSourcesMutation, useCreateChatbotDocumentUploadUrlMutation } from "@api";
import type { AddSourcesResult, SourceDocumentInput } from "@api";

/** Copy §13: up to 10 files at a time, 20 MB each. PDF and Word go through the upload pathway. */
export const SOURCE_MAX_FILES = 10;
export const SOURCE_MAX_BYTES = 20 * 1024 * 1024;
const FORMATS: Record<string, { sourceType: string; mime: string }> = {
  pdf: { sourceType: "pdf", mime: "application/pdf" },
  docx: {
    sourceType: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
};
export const SOURCE_ACCEPT = ".pdf,.docx";

const extension = (name: string) => name.toLowerCase().split(".").pop() ?? "";

/** True when these files can be added (count, size, format). */
export const filesOk = (files: File[]): boolean =>
  files.length > 0 &&
  files.length <= SOURCE_MAX_FILES &&
  files.every(f => f.size <= SOURCE_MAX_BYTES && Boolean(FORMATS[extension(f.name)]));

/**
 * Sources for the Create and Build screen: a web address is read by the site crawl; a file goes up
 * through the chatbot's existing presigned upload (`POST /v1/chatbots/:id/documents/upload-url`),
 * then `POST /v1/bot-drafts/:id/sources` makes it the chatbot's own document. On a live chatbot the
 * server stages both until Apply.
 */
export const useSources = (draftId: string | null, chatbotId: string | null) => {
  const [addSources] = useAddBotDraftSourcesMutation();
  const [createUploadUrl] = useCreateChatbotDocumentUploadUrlMutation();

  const addAddress = useCallback(
    (address: string): Promise<AddSourcesResult> =>
      addSources({ id: draftId ?? "", addresses: [address.trim()] }).unwrap(),
    [addSources, draftId],
  );

  const addFiles = useCallback(
    async (files: File[]): Promise<AddSourcesResult> => {
      if (!chatbotId) throw new Error("no chatbot");
      const documents: SourceDocumentInput[] = [];
      for (const file of files) {
        const format = FORMATS[extension(file.name)];
        const { presignedUrl, fileUrl } = await createUploadUrl({
          id: chatbotId,
          fileName: file.name,
          fileSize: file.size,
          contentType: format.mime,
        }).unwrap();
        await axios.put(presignedUrl, file, { headers: { "Content-Type": format.mime } });
        documents.push({
          fileUrl,
          title: file.name.replace(/\.[^.]+$/, ""),
          sourceType: format.sourceType,
          fileName: file.name,
          contentType: format.mime,
          sizeBytes: file.size,
        });
      }
      return addSources({ id: draftId ?? "", documents }).unwrap();
    },
    [addSources, createUploadUrl, draftId, chatbotId],
  );

  return { addAddress, addFiles };
};
