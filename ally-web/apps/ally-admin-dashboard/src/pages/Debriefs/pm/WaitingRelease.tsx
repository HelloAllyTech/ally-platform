import React, { useState } from "react";

import { toast } from "sonner";

import { Button, TextInput } from "@ally-ui-mono/ui-shared";
import { useDismissWaitingReleaseMutation, usePromoteWaitingReleaseMutation } from "@api";
import { releaseVersionLabel } from "@components/ally-guide/allyGuideFormat";
import { en } from "@constants";
import { DebriefWaitingRelease } from "@types";
import { getErrorMessage } from "@utils";

import { promptName } from "../consoleLabels";

const shown = (v: unknown): string =>
  v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

/**
 * A Skills Store or code release that would undo a change people promoted, so it waits as a draft
 * (CONSOLE_API.md "one rule"). It says what it would undo, and the Ally team or the owner promotes
 * it (accepting the overwrite) or dismisses it, so it never goes live.
 */
export const WaitingRelease: React.FC<{ release: DebriefWaitingRelease; canAct: boolean }> = ({
  release: w,
  canAct,
}) => {
  const p = en.debriefs.pmPage.releases;
  const [promote, promoting] = usePromoteWaitingReleaseMutation();
  const [dismiss, dismissing] = useDismissWaitingReleaseMutation();
  const [asking, setAsking] = useState<"promote" | "dismiss" | null>(null);
  const [reason, setReason] = useState("");
  const source =
    w.source.kind === "skills_store"
      ? p.waitingFromStore(
          w.source.promptCode ? promptName(w.source.promptCode) : null,
          w.source.from,
          w.source.to,
        )
      : p.waitingFromCode(w.source.tag);

  const go = async () => {
    try {
      if (asking === "promote") {
        await promote({ id: w.id, reason: reason.trim() || undefined }).unwrap();
        toast.success(p.waitingPromoted);
      } else {
        await dismiss({ id: w.id, reason: reason.trim() || undefined }).unwrap();
        toast.success(p.waitingDismissed);
      }
      setAsking(null);
      setReason("");
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.pmAgent.actionFailed));
    }
  };

  return (
    <div
      role="alert"
      data-testid="release-waiting"
      className="flex flex-col gap-2 border-l-[3px] border-destructive-500 bg-destructive-50 px-4 py-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[16rem] flex-1">
          <b>
            {p.waiting(
              releaseVersionLabel(w.version),
              w.wouldUndo.map(u => u.changedBy.label).join(", ") || p.aChange,
            )}
          </b>{" "}
          {w.title} · {source}
          {w.source.note ? ` · “${w.source.note}”` : ""}
        </div>
        {canAct && !asking && (
          <div className="flex gap-2">
            <Button kind="primary" size="sm" onClick={() => setAsking("promote")}>
              {p.promoteDraft}
            </Button>
            <Button kind="tertiary" size="sm" onClick={() => setAsking("dismiss")}>
              {p.dismiss}
            </Button>
          </div>
        )}
      </div>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px]" data-testid="would-undo">
        {w.wouldUndo.map(u => (
          <li key={u.path}>
            {p.undoLine(u.what, shown(u.live), shown(u.wouldBecome), u.changedBy.label)}
          </li>
        ))}
      </ul>
      {w.problems.length > 0 && (
        <p className="text-[13px] text-destructive-600">{p.problems(w.problems.join("; "))}</p>
      )}
      {asking && (
        <div className="flex flex-wrap items-end gap-2" data-testid="waiting-confirm">
          <p className="w-full text-[13px]">
            {asking === "promote" ? p.promoteWaitingBody : p.dismissWaitingBody}
          </p>
          <div className="min-w-[16rem] flex-1">
            <TextInput
              id={`waiting-reason-${w.id}`}
              labelText={p.reasonLabel}
              value={reason}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
            />
          </div>
          <Button
            kind={asking === "promote" ? "primary" : "danger"}
            size="sm"
            disabled={promoting.isLoading || dismissing.isLoading}
            onClick={() => void go()}
          >
            {asking === "promote" ? p.promoteDraft : p.dismiss}
          </Button>
          <Button kind="ghost" size="sm" onClick={() => setAsking(null)}>
            {en.debriefs.pmAgent.cancel}
          </Button>
        </div>
      )}
    </div>
  );
};
