import React, { useState } from "react";

import { toast } from "sonner";

import { Button, TextInput } from "@ally-ui-mono/ui-shared";
import { useApproveDebriefChangeMutation, useTurnDownDebriefChangeMutation } from "@api";
import { en } from "@constants";
import { DebriefChange } from "@types";
import { getErrorMessage } from "@utils";

import { DebriefAccess } from "../debriefAccess";

type Kind = "budget" | "change";

const kindOf = (c: DebriefChange): Kind => {
  if (c.kindKey === "budget" || /^budget/i.test(c.kind)) return "budget";
  return "change";
};

/** Who may decide this kind: budgets the owner, else the team. */
export const canDecide = (c: DebriefChange, access: DebriefAccess) => {
  const k = kindOf(c);
  if (k === "budget") return access.owner;
  return access.pmAgent;
};

/**
 * The decision on a change that waits for a person (review 2026-11-16): real buttons right after
 * the change itself, so the person reads first and then decides. Shown only to someone who may
 * decide this kind.
 */
export const DecisionButtons: React.FC<{
  change: DebriefChange;
  access: DebriefAccess;
}> = ({ change, access }) => {
  const t = en.debriefs.v2.decision;
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [approve, approving] = useApproveDebriefChangeMutation();
  const [turnDown, turningDown] = useTurnDownDebriefChangeMutation();
  if (change.state !== "waits" || !canDecide(change, access)) return null;
  const busy = approving.isLoading || turningDown.isLoading;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      setReasonOpen(false);
      setReason("");
    } catch (e) {
      toast.error(getErrorMessage(e, t.failed));
    }
  };
  const onApprove = () => run(() => approve({ id: change.id }).unwrap(), t.approved);
  const onTurnDown = () =>
    run(() => turnDown({ id: change.id, reason: reason.trim() }).unwrap(), t.turnedDown);
  return (
    <div className="flex flex-col gap-2" data-testid="decision-buttons">
      <div className="flex flex-nowrap items-center gap-3">
        <Button kind="primary" size="md" disabled={busy} onClick={() => void onApprove()}>
          {t.approve}
        </Button>
        <Button
          kind="danger--tertiary"
          size="md"
          disabled={busy}
          aria-expanded={reasonOpen}
          onClick={() => setReasonOpen(o => !o)}
        >
          {t.turnDown}
        </Button>
      </div>
      {reasonOpen && (
        <div className="flex flex-nowrap items-end gap-2" data-testid="decision-reason">
          <div className="min-w-0 flex-1">
            <TextInput
              id={`turn-down-${change.id}`}
              labelText={t.reasonLabel}
              placeholder={t.reasonPlaceholder}
              value={reason}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
            />
          </div>
          <Button
            kind="danger"
            size="md"
            disabled={busy || !reason.trim()}
            onClick={() => void onTurnDown()}
          >
            {t.confirmTurnDown}
          </Button>
        </div>
      )}
    </div>
  );
};
