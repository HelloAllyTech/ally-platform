import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import { Checkbox, Search, SkeletonText } from "@ally-ui-mono/ui-shared";
import {
  useGetChatbotDocumentsQuery,
  useGetKbDocumentsQuery,
  useSetChatbotDocumentsMutation,
  useUpdateChatbotMutation,
} from "@api";
import { Button, EmptyState, EntitySidePanel } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { Chatbot, ChatbotKnowledgeSource, KbCorpus } from "@types";

import { Card, errorMessage, fill, LoadError, StatusPill, timeAgo } from "./shared";

const t = en.whatsappBot.bots.knowledge;
/** The library list endpoint accepts at most 100 per request. */
const PICKER_LIMIT = 100;

/**
 * The documents a bot answers from, picked from the shared library. Removing one here only takes
 * it off this bot; the document stays in the library for every other bot that uses it.
 */
export const KnowledgeTab: React.FC<{ bot: Chatbot; canEdit: boolean }> = ({ bot, canEdit }) => {
  const { data: docs = [], isLoading, isError, refetch } = useGetChatbotDocumentsQuery(bot.id);
  const [setDocuments, { isLoading: isSaving }] = useSetChatbotDocumentsMutation();
  const [updateBot] = useUpdateChatbotMutation();
  const [picking, setPicking] = useState(false);

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
  if (isError) return <LoadError title={t.saveFailed} onRetry={() => void refetch()} />;

  const save = async (ids: string[], message: string) => {
    try {
      await setDocuments({ id: bot.id, documentIds: ids }).unwrap();
      toast.success(message);
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
          <Button variant={ButtonVariant.PRIMARY} onClick={() => setPicking(true)}>
            {t.add}
          </Button>
        )
      }
    >
      {docs.length === 0 ? (
        <EmptyState
          title={t.empty}
          actionLabel={t.add}
          onAction={() => setPicking(true)}
          hideActionButton={!canEdit}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border-light">
          {docs.map(doc => (
            <li key={doc.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0 flex flex-col">
                <span className="text-sm text-typography-900 truncate">{doc.title}</span>
                <span className="text-xs text-typography-500">{timeAgo(doc.updatedAt)}</span>
              </div>
              {doc.isGlobal && <StatusPill tone="neutral">{t.shared}</StatusPill>}
              {doc.archived && <StatusPill tone="warning">{t.archived}</StatusPill>}
              {canEdit && (
                <Button
                  variant={ButtonVariant.SECONDARY}
                  disabled={isSaving}
                  onClick={() =>
                    void save(
                      docs.filter(d => d.id !== doc.id).map(d => d.id),
                      t.removed,
                    )
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
          await save([...docs.map(d => d.id), ...ids], t.saved);
          setPicking(false);
        }}
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
        <p className="text-sm text-typography-600">{search ? t.pickerEmpty : t.pickerAllAdded}</p>
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
