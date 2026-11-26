import { FC, useState } from "react";

import { Delete } from "@icons";
import { toast } from "sonner";

import { TextArea } from "@ally-ui-mono/ui-shared";
import { CrmContactLog, useAddCrmLogMutation, useDeleteCrmLogMutation } from "@api";
import { ActionConfirmationPopup, Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";

import { formatDay } from "./formatDay";

const todayIso = () => new Date().toISOString().slice(0, 10);

interface ContactLogProps {
  contactId: string;
  /** Newest first. */
  logs: CrmContactLog[];
}

/** The conversation log under one contact: add an entry, read the team's, delete one. */
export const ContactLog: FC<ContactLogProps> = ({ contactId, logs }) => {
  const t = en.crm.logs;
  const [summary, setSummary] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayIso);
  const [removing, setRemoving] = useState<CrmContactLog | null>(null);
  const [addLog, { isLoading: isAdding }] = useAddCrmLogMutation();
  const [deleteLog] = useDeleteCrmLogMutation();

  const handleAdd = async () => {
    const result = await addLog({
      contactId,
      data: { summary: summary.trim(), occurredOn: occurredOn || undefined },
    });
    if ("error" in result && result.error) {
      toast.error(en.crm.toasts.logFailed);
      return;
    }
    setSummary("");
    setOccurredOn(todayIso());
    toast.success(en.crm.toasts.logAdded);
  };

  const handleRemove = async () => {
    if (!removing) return;
    const result = await deleteLog({ contactId, logId: removing.id });
    setRemoving(null);
    if ("error" in result && result.error) {
      toast.error(en.crm.toasts.logRemoveFailed);
      return;
    }
    toast.success(en.crm.toasts.logRemoved);
  };

  return (
    <section className="border-t border-border-light pt-4" data-testid="crm-log">
      <h2 className="text-base text-typography-900 font-secondary">{t.title}</h2>
      <p className="text-sm text-typography-700 mt-1">{t.description}</p>

      <div className="flex flex-col gap-2 mt-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="crm-log-date" className="text-xs text-typography-700">
            {t.dateLabel}
          </label>
          <input
            id="crm-log-date"
            type="date"
            max={todayIso()}
            value={occurredOn}
            onChange={e => setOccurredOn(e.target.value)}
            className="w-full md:w-[200px] rounded border border-border-light px-3 py-2 bg-white text-sm outline-none focus:border-primary-500"
          />
        </div>
        <label htmlFor="crm-log-summary" className="text-xs text-typography-700">
          {t.summaryLabel}
        </label>
        <TextArea
          id="crm-log-summary"
          labelText={t.summaryLabel}
          hideLabel
          rows={3}
          placeholder={t.summaryPlaceholder}
          value={summary}
          onChange={e => setSummary(e.target.value)}
        />
        <div>
          <Button
            variant={ButtonVariant.SECONDARY}
            onClick={handleAdd}
            disabled={isAdding || !summary.trim()}
          >
            {t.add}
          </Button>
        </div>
      </div>

      {logs.length === 0 ? (
        <p className="text-sm text-typography-700 mt-4">{t.empty}</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border-light">
          {logs.map(log => (
            <li key={log.id} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-typography-700">
                  {formatDay(log.occurredOn)}
                  {log.authorName ? ` · ${t.by(log.authorName)}` : ""}
                </p>
                <p className="text-sm text-typography-900 whitespace-pre-wrap break-words mt-0.5">
                  {log.summary}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRemoving(log)}
                aria-label={t.remove}
                title={t.remove}
                className="shrink-0 p-1 text-typography-700 hover:text-destructive-500"
              >
                <Delete size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ActionConfirmationPopup
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        title={t.removeTitle}
        description={t.removeDescription}
        primaryButton={{ label: en.crm.panel.deleteConfirm, onClick: handleRemove }}
        secondaryButton={{ label: en.crm.panel.deleteCancel, onClick: () => setRemoving(null) }}
      />
    </section>
  );
};
