import React, { useState } from "react";

import { toast } from "sonner";

import { AutoExpandableTextarea, SkeletonText, TextInput } from "@ally-ui-mono/ui-shared";
import { useGetChatbotDocumentQuery, useUpdateChatbotDocumentMutation } from "@api";
import { EntityField, EntitySidePanel } from "@components";
import { en } from "@constants";
import { ChatbotDocumentDetail, KB_IN_FLIGHT_STATUSES, KbDocumentStatus } from "@types";

import { errorMessage, LoadError, StatusPill } from "./shared";

const t = en.whatsappBot.bots.knowledge;
/** ally-be refuses a longer title. */
const TITLE_MAX = 300;

/** Still being trained (indexed). */
export const isTraining = (status: string) =>
  KB_IN_FLIGHT_STATUSES.includes(status as KbDocumentStatus);

/**
 * A document's training state in words an owner knows: "Trained", not "indexed". Archived
 * documents carry their own Archived tag, so they get no status tag here.
 */
export const DocumentStatusTag: React.FC<{ status: string; archived: boolean }> = ({
  status,
  archived,
}) => {
  if (archived) return null;
  if (status === KbDocumentStatus.FAILED) return <StatusPill tone="danger">{t.failed}</StatusPill>;
  if (isTraining(status)) return <StatusPill tone="neutral">{t.training}</StatusPill>;
  if (status === KbDocumentStatus.INDEXED)
    return <StatusPill tone="success">{t.trained}</StatusPill>;
  return null;
};

/**
 * View one of the chatbot's documents. Its own (private) documents are editable by editors;
 * saving a changed text retrains the chatbot on it. Library documents are read-only here.
 */
export const KnowledgeDocumentPanel: React.FC<{
  botId: string;
  documentId: string | null;
  canEdit: boolean;
  onClose: () => void;
}> = ({ botId, documentId, canEdit, onClose }) => {
  const {
    data: doc,
    isFetching,
    isError,
    refetch,
  } = useGetChatbotDocumentQuery(
    { id: botId, documentId: documentId ?? "" },
    { skip: !documentId },
  );
  const isOpen = Boolean(documentId);

  if (!isOpen) return null;

  if (isError || !doc || doc.id !== documentId) {
    return (
      <EntitySidePanel isOpen title={t.viewTitle} hideSave onClose={onClose}>
        {isError ? (
          <LoadError title={t.viewLoadFailed} onRetry={() => void refetch()} />
        ) : (
          isFetching && <SkeletonText paragraph lineCount={6} />
        )}
      </EntitySidePanel>
    );
  }

  // Keyed so the form starts from the server's values each time a different document opens.
  return (
    <DocumentForm
      key={`${doc.id}:${doc.updatedAt}`}
      botId={botId}
      doc={doc}
      editable={canEdit && doc.private}
      onClose={onClose}
    />
  );
};

const DocumentForm: React.FC<{
  botId: string;
  doc: ChatbotDocumentDetail;
  editable: boolean;
  onClose: () => void;
}> = ({ botId, doc, editable, onClose }) => {
  const [title, setTitle] = useState(doc.title);
  const [text, setText] = useState(doc.rawText);
  const [updateDocument, { isLoading: isSaving }] = useUpdateChatbotDocumentMutation();

  const trimmedTitle = title.trim();
  const titleChanged = trimmedTitle !== doc.title;
  const textChanged = text !== doc.rawText;
  const dirty = editable && (titleChanged || textChanged);
  const valid = Boolean(trimmedTitle) && Boolean(text.trim());

  const handleSave = async () => {
    if (!dirty || !valid) return;
    try {
      await updateDocument({
        id: botId,
        documentId: doc.id,
        ...(titleChanged ? { title: trimmedTitle } : {}),
        ...(textChanged ? { text } : {}),
      }).unwrap();
      toast.success(t.viewSaved);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, t.viewSaveFailed));
    }
  };

  return (
    <EntitySidePanel
      isOpen
      title={editable ? t.viewTitle : doc.title}
      dirty={dirty}
      hideSave={!editable}
      saveDisabled={!dirty || !valid || isSaving}
      onClose={onClose}
      onSave={() => void handleSave()}
    >
      <div className="flex flex-wrap items-center gap-2">
        <DocumentStatusTag status={doc.status} archived={doc.archived} />
        <StatusPill tone="neutral">{doc.private ? t.private : t.viewFromLibrary}</StatusPill>
        {doc.archived && <StatusPill tone="warning">{t.archived}</StatusPill>}
      </div>
      {doc.status === KbDocumentStatus.FAILED && doc.statusMessage && (
        <EntityField label={t.viewFailedReason}>
          <p className="text-sm text-destructive-600">{doc.statusMessage}</p>
        </EntityField>
      )}
      {editable ? (
        <>
          <EntityField label={t.viewTitleLabel} required>
            <TextInput
              id="knowledge-document-title"
              labelText=""
              hideLabel
              value={title}
              maxLength={TITLE_MAX}
              onChange={event => setTitle(event.target.value)}
            />
          </EntityField>
          <EntityField label={t.viewTextLabel} required>
            <AutoExpandableTextarea
              id="knowledge-document-text"
              value={text}
              onChange={setText}
              minHeight={220}
              maxLines={24}
            />
          </EntityField>
          <p className="text-xs text-typography-500">{t.viewEditHelp}</p>
        </>
      ) : (
        <>
          {!doc.private && <p className="text-sm text-typography-600">{t.viewLibraryNote}</p>}
          <EntityField label={t.viewTextLabel}>
            <div
              className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded border border-border-light p-3 text-sm text-typography-900"
              data-testid="knowledge-document-text"
            >
              {doc.rawText || t.viewTextEmpty}
            </div>
          </EntityField>
        </>
      )}
    </EntitySidePanel>
  );
};
