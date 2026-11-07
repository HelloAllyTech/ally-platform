import React, { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import { Checkbox, Search, SkeletonText } from "@ally-ui-mono/ui-shared";
import {
  useGetChatbotDocumentsQuery,
  useGetKbDocumentsQuery,
  useRemoveChatbotDocumentMutation,
  useSetChatbotDocumentsMutation,
  useUpdateChatbotMutation,
} from "@api";
import { Button, EmptyState, EntitySidePanel } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import {
  Chatbot,
  ChatbotDocumentRow,
  ChatbotKnowledgeSource,
  KbCorpus,
  KbDocumentStatus,
} from "@types";

import { DocumentStatusTag, isTraining, KnowledgeDocumentPanel } from "./KnowledgeDocumentPanel";
import { KnowledgeUploadPanel } from "./KnowledgeUploadPanel";
import { Card, errorMessage, fill, LoadError, StatusPill, timeAgo } from "./shared";

const t = en.whatsappBot.bots.knowledge;
/** The library list endpoint accepts at most 100 per request. */
const PICKER_LIMIT = 100;
/** How often the list refreshes while a document is still training (being indexed). */
const POLL_INTERVAL_MS = 4000;

/**
 * The documents a bot answers from: its own (uploaded here, private to it) and any picked from the
 * shared library. Removing a library document only takes it off this bot; removing a private one
 * deletes it. The list refreshes while anything is still being indexed.
 */
export const KnowledgeTab: React.FC<{ bot: Chatbot; canEdit: boolean }> = ({ bot, canEdit }) => {
  const [pollInterval, setPollInterval] = useState(0);
  const {
    data: docs = [],
    isLoading,
    isError,
    refetch,
  } = useGetChatbotDocumentsQuery(bot.id, { pollingInterval: pollInterval });
  const [setDocuments, { isLoading: isSaving }] = useSetChatbotDocumentsMutation();
  const [removeDocument, { isLoading: isRemoving }] = useRemoveChatbotDocumentMutation();
  const [updateBot] = useUpdateChatbotMutation();
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const indexing = docs.some(doc => isTraining(doc.status));
  useEffect(() => {
    setPollInterval(indexing ? POLL_INTERVAL_MS : 0);
  }, [indexing]);

  if (bot.knowledgeSource === ChatbotKnowledgeSource.ORGANISATION) {
    return (
      <Card title={t.title} subtitle={t.organisationSource}>
        {canEdit && (
          <div>
            <Button
              variant={ButtonVariant.SECONDARY}
              onClick={() =>
                void updateBot({ id: bot.id, knowledgeSource: ChatbotKnowledgeSource.SELECTED })
                  .unwrap()
                  .catch(err => toast.error(errorMessage(err, t.saveFailed)))
              }
            >
              {t.useSelected}
            </Button>
          </div>
        )}
      </Card>
    );
  }

  if (isLoading) return <SkeletonText paragraph lineCount={6} />;
  if (isError) return <LoadError title={t.loadFailed} onRetry={() => void refetch()} />;

  // The library documents on this bot. Its private ones stay attached whatever is sent.
  const sharedIds = docs.filter(d => !d.private).map(d => d.id);

  const save = async (ids: string[], message: string) => {
    try {
      await setDocuments({ id: bot.id, documentIds: ids }).unwrap();
      toast.success(message);
    } catch (err) {
      toast.error(errorMessage(err, t.saveFailed));
    }
  };

  const removePrivate = async (doc: ChatbotDocumentRow) => {
    if (!window.confirm(fill(t.removePrivateConfirm, { title: doc.title }))) return;
    try {
      await removeDocument({ id: bot.id, documentId: doc.id }).unwrap();
      toast.success(t.privateRemoved);
    } catch (err) {
      toast.error(errorMessage(err, t.saveFailed));
    }
  };

  return (
    <Card
      title={t.title}
      subtitle={t.intro}
      action={
        canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant={ButtonVariant.PRIMARY} onClick={() => setUploading(true)}>
              {t.upload}
            </Button>
            <Button variant={ButtonVariant.SECONDARY} onClick={() => setPicking(true)}>
              {t.add}
            </Button>
          </div>
        )
      }
    >
      {docs.length === 0 ? (
        <EmptyState
          title={t.empty}
          actionLabel={t.upload}
          onAction={() => setUploading(true)}
          hideActionButton={!canEdit}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border-light">
          {docs.map(doc => (
            <li key={doc.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0 flex flex-col">
                <span className="text-sm text-typography-900 truncate">{doc.title}</span>
                <span className="text-xs text-typography-500">{timeAgo(doc.updatedAt)}</span>
                {/* The row carries no reason, so say what it means and what to do about it. */}
                {doc.status === KbDocumentStatus.FAILED ? (
                  <span className="text-xs text-destructive-600">{t.failedHint}</span>
                ) : (
                  doc.archived && <span className="text-xs text-warning-700">{t.archivedHint}</span>
                )}
              </div>
              <DocumentStatusTag status={doc.status} archived={doc.archived} />
              {doc.private && <StatusPill tone="neutral">{t.private}</StatusPill>}
              {doc.isGlobal && <StatusPill tone="neutral">{t.shared}</StatusPill>}
              {doc.archived && <StatusPill tone="warning">{t.archived}</StatusPill>}
              <Button variant={ButtonVariant.SECONDARY} onClick={() => setViewing(doc.id)}>
                {t.view}
              </Button>
              {canEdit && (
                <Button
                  variant={ButtonVariant.SECONDARY}
                  disabled={isSaving || isRemoving}
                  onClick={() =>
                    void (doc.private
                      ? removePrivate(doc)
                      : save(
                          sharedIds.filter(id => id !== doc.id),
                          t.removed,
                        ))
                  }
                >
                  {t.remove}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <LibraryPicker
        isOpen={picking}
        alreadyPicked={docs.map(d => d.id)}
        onClose={() => setPicking(false)}
        onAdd={async ids => {
          await save([...sharedIds, ...ids], t.saved);
          setPicking(false);
        }}
      />
      <KnowledgeUploadPanel botId={bot.id} isOpen={uploading} onClose={() => setUploading(false)} />
      <KnowledgeDocumentPanel
        botId={bot.id}
        documentId={viewing}
        canEdit={canEdit}
        onClose={() => setViewing(null)}
      />
    </Card>
  );
};

const LibraryPicker: React.FC<{
  isOpen: boolean;
  alreadyPicked: string[];
  onClose: () => void;
  onAdd: (ids: string[]) => Promise<void>;
}> = ({ isOpen, alreadyPicked, onClose, onAdd }) => {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const { data, isFetching, isError, refetch } = useGetKbDocumentsQuery(
    { corpus: KbCorpus.WHATSAPP_QA, limit: PICKER_LIMIT, ...(search ? { search } : {}) },
    { skip: !isOpen },
  );
  const available = useMemo(
    () => (data?.documents ?? []).filter(doc => !alreadyPicked.includes(doc.id)),
    [data, alreadyPicked],
  );
  // Nothing in the library at all, as against everything in it already being on this bot.
  const libraryEmpty = !search && (data?.documents ?? []).length === 0;
  const toggle = (id: string) =>
    setChosen(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <EntitySidePanel
      isOpen={isOpen}
      title={t.pickerTitle}
      dirty={chosen.size > 0}
      saveDisabled={chosen.size === 0}
      onClose={() => {
        setChosen(new Set());
        onClose();
      }}
      onSave={() => void onAdd([...chosen]).then(() => setChosen(new Set()))}
    >
      <Search
        id="library-search"
        labelText={t.pickerSearch}
        placeholder={t.pickerSearch}
        size="md"
        value={search}
        onChange={e => setSearch((e.target as HTMLInputElement).value)}
      />
      {isError ? (
        <LoadError title={t.pickerFailed} onRetry={() => void refetch()} />
      ) : isFetching && !data ? (
        <SkeletonText paragraph lineCount={4} />
      ) : available.length === 0 ? (
        <p className="text-sm text-typography-600">
          {search ? t.pickerEmpty : libraryEmpty ? t.pickerLibraryEmpty : t.pickerAllAdded}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {available.map(doc => (
            <Checkbox
              key={doc.id}
              id={`pick-${doc.id}`}
              labelText={doc.isGlobal ? `${doc.title} · ${t.shared}` : doc.title}
              checked={chosen.has(doc.id)}
              onChange={() => toggle(doc.id)}
            />
          ))}
        </div>
      )}
      {chosen.size > 0 && (
        <p className="text-xs text-typography-500">{fill(t.pickerAdd, { count: chosen.size })}</p>
      )}
    </EntitySidePanel>
  );
};
