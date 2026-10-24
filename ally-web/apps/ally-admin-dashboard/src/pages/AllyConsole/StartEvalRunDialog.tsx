import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import { useGetAllyGuideEvalCasesQuery, useStartAllyGuideEvalRunMutation } from "@api";
import { releaseVersionLabel } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { en } from "@constants";
import { getErrorMessage } from "@utils";

import { ReleaseRef } from "./ReleaseDialogs";

const KINDS = ["smoke", "gate"] as const;
const TARGET_LIMIT = 50;

/**
 * Start an eval run for a release from its page: smoke (the quick suite, once, for a draft) or gate
 * (every active case, repeated, against the live release). The run is queued and goes on in the
 * background, so the dialog closes at once and points at the Evals tab. For a gate the person may
 * name the cases the release is meant to fix, so the gate expects it to pass more of them.
 */
export const StartEvalRunDialog: React.FC<{
  release: ReleaseRef | null;
  onClose: () => void;
}> = ({ release, onClose }) => {
  const strings = en.allyConsole.evals.runs.startDialog;
  const [start, { isLoading }] = useStartAllyGuideEvalRunMutation();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("smoke");
  const [targets, setTargets] = useState<Set<string>>(new Set());

  const releaseId = release?.id ?? null;
  useEffect(() => {
    if (releaseId) {
      setKind("smoke");
      setTargets(new Set());
    }
  }, [releaseId]);

  const cases = useGetAllyGuideEvalCasesQuery(
    { status: "active", limit: 200 },
    { skip: !releaseId || kind !== "gate" },
  );

  const toggle = (id: string) =>
    setTargets(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < TARGET_LIMIT) next.add(id);
      return next;
    });

  const handleConfirm = async () => {
    if (!release) return;
    try {
      await start({
        releaseId: release.id,
        kind,
        targetCaseIds: kind === "gate" ? [...targets] : undefined,
      }).unwrap();
      toast.success(strings.started);
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.failed));
    }
  };

  const version = release ? releaseVersionLabel(release.version) : "";
  return (
    <ConfirmDialog
      isOpen={release !== null}
      title={strings.title(version)}
      cancelLabel={strings.cancel}
      confirmLabel={
        isLoading ? strings.working : strings.confirm(en.allyConsole.evals.runs.kinds[kind])
      }
      isWorking={isLoading}
      onConfirm={() => void handleConfirm()}
      onClose={onClose}
    >
      <p>{strings.body}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs tracking-wide text-typography-700">
          {strings.kindLabel}
        </legend>
        {KINDS.map(option => (
          <label key={option} className="flex items-start gap-2 text-sm text-typography-900">
            <input
              type="radio"
              name="eval-run-kind"
              value={option}
              checked={kind === option}
              onChange={() => setKind(option)}
              className="mt-1"
            />
            <span>{strings[option]}</span>
          </label>
        ))}
      </fieldset>
      {kind === "gate" && (
        <fieldset className="flex flex-col gap-1" data-testid="eval-run-targets">
          <legend className="text-xs tracking-wide text-typography-700">
            {strings.targetsLabel}
          </legend>
          <p className="text-xs text-typography-700">{strings.targetsHelp}</p>
          {cases.isLoading ? null : (cases.data ?? []).length === 0 ? (
            <p className="text-sm text-typography-700">{strings.targetsNone}</p>
          ) : (
            <ul className="max-h-48 overflow-y-auto">
              {(cases.data ?? []).map(item => (
                <li key={item.id}>
                  <label className="flex items-start gap-2 py-1 text-sm text-typography-900">
                    <input
                      type="checkbox"
                      checked={targets.has(item.id)}
                      onChange={() => toggle(item.id)}
                      className="mt-1"
                    />
                    <span>{item.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}
    </ConfirmDialog>
  );
};
