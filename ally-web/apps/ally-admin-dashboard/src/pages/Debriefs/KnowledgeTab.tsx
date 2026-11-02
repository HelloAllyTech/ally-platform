import React, { useState } from "react";

import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefKnowledgeQuery,
  useGetKbDocumentQuery,
  useSetDebriefKnowledgeClinicalMutation,
  useSignOffDebriefKnowledgeMutation,
} from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { CorpusDocumentPanel } from "@components/knowledge-corpus";
import { en } from "@constants";
import { DebriefKnowledgeDocument, KbCorpus } from "@types";
import { getErrorMessage } from "@utils";

import { formatWhen } from "./consoleTable";

const s = () => en.debriefs.knowledge;

const audience = (d: DebriefKnowledgeDocument) =>
  d.isGlobal ? s().everyone : d.tenantCount > 0 ? s().organisations(d.tenantCount) : s().nobody;

const ClinicalStatus: React.FC<{ doc: DebriefKnowledgeDocument }> = ({ doc }) => {
  if (doc.clinical === "not_clinical") return <Pill>{s().notClinical}</Pill>;
  if (doc.clinical === "awaiting") return <Pill tone="warning">{s().awaiting}</Pill>;
  return <Pill tone="success">{s().signedOff(doc.signedOffBy, formatWhen(doc.signedOffAt))}</Pill>;
};

/** Opens the knowledge base's own panel on one existing document. */
const EditPanel: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { data } = useGetKbDocumentQuery(id);
  if (!data) return null;
  return <CorpusDocumentPanel isOpen document={data} onClose={onClose} />;
};

/**
 * Debriefs → Knowledge (v9 FR-16, plan §12): the guidance the Debrief agent looks up, and the
 * clinical advisor's sign-off. Adding, editing and targeting a document reuse the knowledge
 * base's own panel with corpus `debrief_knowledge`; this tab adds the clinical mark and the
 * sign-off, which only an admin with the "Debriefs — Clinical sign-off" toggle sees.
 */
export const KnowledgeTab: React.FC = () => {
  const { data, isLoading, isError, error, refetch } = useGetDebriefKnowledgeQuery();
  const [setClinical, { isLoading: marking }] = useSetDebriefKnowledgeClinicalMutation();
  const [signOff, { isLoading: signing }] = useSignOffDebriefKnowledgeMutation();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DebriefKnowledgeDocument | null>(null);

  const mark = async (doc: DebriefKnowledgeDocument, needsSignOff: boolean) => {
    try {
      await setClinical({ id: doc.id, needsSignOff }).unwrap();
      toast.success(s().saved);
    } catch (e) {
      toast.error(getErrorMessage(e, s().failed));
    }
  };

  const confirmSignOff = async () => {
    if (!confirming) return;
    try {
      await signOff(confirming.id).unwrap();
      toast.success(s().signedOffToast);
      setConfirming(null);
    } catch (e) {
      toast.error(getErrorMessage(e, s().failed));
    }
  };

  let body: React.ReactNode;
  if (isLoading) body = <LoadingBlock />;
  else if (isError) body = <ErrorPanel what={s().title} error={error} onRetry={refetch} />;
  else if (!data?.documents.length) body = <EmptyPanel title={s().empty} />;
  else {
    body = (
      <table className="w-full text-left text-sm" data-testid="debrief-knowledge-table">
        <thead>
          <tr className="border-b border-border-light text-xs text-typography-700">
            <th className="py-2 pr-4 font-medium">{s().columns.title}</th>
            <th className="py-2 pr-4 font-medium">{s().columns.audience}</th>
            <th className="py-2 pr-4 font-medium">{s().columns.status}</th>
            <th className="py-2 pr-4 font-medium">{s().columns.clinical}</th>
            <th className="py-2 font-medium">
              <span className="sr-only">{s().columns.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.documents.map(doc => (
            <tr key={doc.id} className="border-b border-border-light align-top">
              <td className="py-3 pr-4">
                <span className="font-medium text-typography-900">{doc.title}</span>
                {doc.archived && <Pill className="ml-2">{s().archived}</Pill>}
              </td>
              <td className="py-3 pr-4">{audience(doc)}</td>
              <td className="py-3 pr-4">{doc.status}</td>
              <td className="py-3 pr-4">
                <ClinicalStatus doc={doc} />
              </td>
              <td className="py-3">
                <div className="flex flex-wrap justify-end gap-2">
                  <Button kind="ghost" size="sm" onClick={() => setEditing(doc.id)}>
                    {s().edit}
                  </Button>
                  <Button
                    kind="ghost"
                    size="sm"
                    disabled={marking}
                    onClick={() => void mark(doc, !doc.needsClinicalSignOff)}
                  >
                    {doc.needsClinicalSignOff ? s().markNotClinical : s().markClinical}
                  </Button>
                  {data.canSignOff && doc.clinical === "awaiting" && (
                    <Button kind="primary" size="sm" onClick={() => setConfirming(doc)}>
                      {s().signOff}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-testid="debrief-knowledge">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2 className="font-secondary text-lg text-typography-900">{s().title}</h2>
          <p className="pt-1 text-sm text-typography-700">{s().help}</p>
        </div>
        <Button kind="primary" onClick={() => setCreating(true)}>
          {s().add}
        </Button>
      </div>
      {body}
      {creating && (
        <CorpusDocumentPanel
          isOpen
          document={null}
          corpus={KbCorpus.DEBRIEF_KNOWLEDGE}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && <EditPanel id={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        isOpen={!!confirming}
        title={s().signOff}
        cancelLabel={en.common.cancel}
        confirmLabel={s().signOff}
        isWorking={signing}
        onConfirm={() => void confirmSignOff()}
        onClose={() => setConfirming(null)}
      >
        <p className="text-sm">
          <strong>{confirming?.title}</strong>
        </p>
        <p className="pt-2 text-sm">{s().signOffConfirm}</p>
      </ConfirmDialog>
    </section>
  );
};
