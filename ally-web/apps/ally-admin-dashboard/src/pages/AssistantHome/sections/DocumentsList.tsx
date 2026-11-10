import React, { useRef, useState } from "react";

import axios from "axios";

import {
  useCreateChatbotDocumentUploadUrlMutation,
  useCreatePrivateChatbotDocumentMutation,
  useGetKbDocumentsQuery,
} from "@api";
import { Button } from "@components/v2";
import { KbCorpus } from "@types";
import type { HomeDocument } from "@types";

import {
  ACCEPT_ATTRIBUTES,
  DOCUMENT_UPLOAD_FORMATS,
  FILE_SIZE_LIMITS,
} from "../../../constants/file";
import { HOME, fill } from "../copy";
import { Collapsed } from "../fields";
import { ListError, ListRow, ListRows, ListSkeleton, RemoveButton } from "../ui/List";
import { useHomeList } from "../useHomeList";
import { LoadFailed } from "./AccessLists";

const t = HOME.lists.documents;
const k = HOME.knows;

type FileSource = keyof typeof DOCUMENT_UPLOAD_FORMATS;
const ACCEPT = [ACCEPT_ATTRIBUTES.PDF, ACCEPT_ATTRIBUTES.DOCX, ACCEPT_ATTRIBUTES.EPUB].join(",");

/** Which format a file is, by its type or its extension (browsers report .epub loosely). */
const sourceOf = (file: File): FileSource | null => {
  const name = file.name.toLowerCase();
  return (
    (Object.keys(DOCUMENT_UPLOAD_FORMATS) as FileSource[]).find(
      key =>
        file.type === DOCUMENT_UPLOAD_FORMATS[key].mime ||
        DOCUMENT_UPLOAD_FORMATS[key].extensions.some(ext => name.endsWith(ext)),
    ) ?? null
  );
};

const statusOf = (status: string): string =>
  status === "indexed" ? k.ready : status === "failed" ? k.failed : k.reading;

/** Picks library documents to add, one at a time (each saves on its own). */
const LibraryPicker: React.FC<{
  taken: string[];
  disabled: boolean;
  onAdd: (id: string) => void;
}> = ({ taken, disabled, onAdd }) => {
  const { data, isLoading } = useGetKbDocumentsQuery({ corpus: KbCorpus.WHATSAPP_QA, limit: 50 });
  const available = (data?.documents ?? []).filter(doc => !taken.includes(doc.id));
  if (isLoading) return <ListSkeleton rows={2} />;
  if (!available.length) return <p className="ally-small">{t.libraryEmpty}</p>;
  return (
    <ListRows label={t.libraryLabel}>
      {available.map(doc => (
        <ListRow
          key={doc.id}
          title={doc.title}
          actions={
            <Button className="ally-btn--sm" disabled={disabled} onClick={() => onAdd(doc.id)}>
              {HOME.lists.add}
            </Button>
          }
        />
      ))}
    </ListRows>
  );
};

/**
 * What it answers from (chunk 20d-2, What it knows → Documents): the pages it read and the files
 * added, each with whether it's ready. Upload a file or add one from the library; remove one.
 * Each is its own change, saved at once, with Undo.
 */
export const DocumentsList: React.FC<{ botId: string; canEdit: boolean }> = ({
  botId,
  canEdit,
}) => {
  const list = useHomeList(botId, "documents");
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [createUploadUrl] = useCreateChatbotDocumentUploadUrlMutation();
  const [createDocument] = useCreatePrivateChatbotDocumentMutation();
  const shown = list.items.filter(doc => !doc.archived);

  const upload = async (file: File) => {
    setUploadError(null);
    const sourceType = sourceOf(file);
    if (!sourceType) return setUploadError(t.wrongType);
    if (file.size > FILE_SIZE_LIMITS.DOCUMENT) return setUploadError(t.tooLarge);
    const contentType = DOCUMENT_UPLOAD_FORMATS[sourceType].mime;
    setUploading(file.name);
    try {
      const { presignedUrl, fileUrl } = await createUploadUrl({
        id: botId,
        fileName: file.name,
        fileSize: file.size,
        contentType,
      }).unwrap();
      await axios.put(presignedUrl, file, { headers: { "Content-Type": contentType } });
      await createDocument({
        id: botId,
        title: file.name.replace(/\.[^.]+$/, ""),
        sourceType,
        fileUrl,
        fileName: file.name,
        contentType,
        sizeBytes: file.size,
      }).unwrap();
      list.refetch();
    } catch {
      setUploadError(t.failed);
    } finally {
      setUploading(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = (doc: HomeDocument) =>
    void list.change(
      { op: "remove", id: doc.id },
      // A library document can be added back; an uploaded file is archived and can't be restored yet.
      doc.private ? undefined : () => ({ op: "add", item: { documentId: doc.id } }),
    );

  if (list.loading) return <ListSkeleton rows={3} />;
  if (list.failed) return <LoadFailed onRetry={list.refetch} />;
  return (
    <div className="ally-home__list-block" data-testid="documents-list">
      {shown.length ? (
        <ListRows label={k.documents}>
          {shown.map(doc => (
            <ListRow
              key={doc.id}
              title={doc.title}
              meta={doc.private ? t.yourFile : t.library}
              badge={
                <span
                  className={`ally-badge ally-home__doc-status ally-home__doc-status--${doc.status}`}
                >
                  {statusOf(doc.status)}
                </span>
              }
              actions={
                canEdit && (
                  <RemoveButton
                    label={fill(HOME.lists.remove, { item: doc.title })}
                    disabled={list.saving}
                    onClick={() => remove(doc)}
                  />
                )
              }
            />
          ))}
        </ListRows>
      ) : (
        <p className="ally-small">{t.empty}</p>
      )}
      {canEdit && (
        <>
          <div className="ally-btn-row">
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="ally-sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button disabled={Boolean(uploading)} onClick={() => input.current?.click()}>
              {t.upload}
            </Button>
            <span className="ally-small" aria-live="polite">
              {uploading ? fill(t.uploading, { name: uploading }) : t.uploadHint}
            </span>
          </div>
          <Collapsed summary={t.fromLibrary}>
            <LibraryPicker
              taken={list.items.map(doc => doc.id)}
              disabled={list.saving}
              onAdd={documentId =>
                void list.change({ op: "add", item: { documentId } }, () => ({
                  op: "remove",
                  id: documentId,
                }))
              }
            />
          </Collapsed>
        </>
      )}
      <ListError error={uploadError ?? list.error} />
    </div>
  );
};
