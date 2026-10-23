import React, { useEffect, useState } from "react";

import { Button, ComposedModal, ModalBody, NumberInput } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import { formatUsd } from "./courseCopilotFormat";

/**
 * The ceiling the field opens on — clear of what has been spent and a round number.
 *
 * Adapted from Builder's `suggestNewCeiling` (copied rather than imported: that module
 * pulls in Builder's API hooks, which a pane that takes its mutations as props must
 * not depend on). Seeded from the SPEND, not the old ceiling, because the old ceiling
 * is by definition already too low — opening on it would hand back the figure that just
 * stopped the build. `neededUsd` is the estimate still to be spent when it is known
 * (raising before approval): headroom is then a couple of dollars over it instead of
 * Builder's ten, since a course build is a much smaller unit of work than a coding run.
 */
export const suggestCeiling = (
  spentUsd: number,
  ceilingUsd: number | null,
  neededUsd: number | null = null,
): number => {
  const floor = Math.max(spentUsd + (neededUsd ?? 0), ceilingUsd ?? 0);
  const headroom = neededUsd !== null ? 2 : 10;
  return Math.max(5, Math.ceil((floor + headroom) / 5) * 5);
};

export interface RaiseCeilingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  spentUsd: number;
  /** 0 = uncapped. */
  ceilingUsd: number;
  /** True while jobs are parked waiting on this — changes the copy from "raise" to "carry on". */
  held: boolean;
  /** Estimate of what is still to be spent, when raising before the build has started. */
  neededUsd?: number | null;
  /** Resolves true when the server took the new ceiling; false keeps the dialog open. */
  onRaise: (budgetUsd: number) => Promise<boolean>;
}

/**
 * Raise the session's spend ceiling — before approval (the estimate is over budget)
 * or mid-build (jobs are held at the ceiling). Mid-build it is "carry on", not
 * "start again with more money": held jobs keep their place and nothing written is
 * re-run, and the copy says so because the two are worth very different amounts to
 * the person deciding.
 */
export const RaiseCeilingDialog: React.FC<RaiseCeilingDialogProps> = ({
  isOpen,
  onClose,
  spentUsd,
  ceilingUsd,
  held,
  neededUsd = null,
  onRaise,
}) => {
  const strings = en.courseCopilotPane.budget.dialog;
  const [value, setValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Re-seed on every open: the spend moves while the dialog is closed, and a stale
  // suggestion is exactly the figure the server will refuse.
  useEffect(() => {
    if (!isOpen) return;
    setValue(String(suggestCeiling(spentUsd, ceilingUsd > 0 ? ceilingUsd : null, neededUsd)));
  }, [isOpen, spentUsd, ceilingUsd, neededUsd]);

  const parsed = value.trim() === "" ? null : Number(value);
  // 0 removes the ceiling; anything else has to clear the spend or the build would stop again at once.
  const isValid = parsed !== null && Number.isFinite(parsed) && (parsed === 0 || parsed > spentUsd);

  const handleSubmit = async () => {
    if (!isValid || parsed === null) return;
    setIsSaving(true);
    try {
      const ok = await onRaise(parsed);
      if (ok) onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ComposedModal open={isOpen} onClose={onClose} size="sm">
      <ModalBody>
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-typography-900">{strings.title}</h2>
          <p className="text-sm text-typography-800">{held ? strings.heldIntro : strings.intro}</p>

          <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-xs tracking-wide text-typography-700">{strings.spentLabel}</dt>
              <dd className="font-medium text-typography-900">{formatUsd(spentUsd)}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-typography-700">{strings.currentLabel}</dt>
              <dd className="font-medium text-typography-900">
                {ceilingUsd > 0 ? formatUsd(ceilingUsd) : strings.currentNone}
              </dd>
            </div>
            {neededUsd !== null && (
              <div>
                <dt className="text-xs tracking-wide text-typography-700">
                  {strings.estimateLabel}
                </dt>
                <dd className="font-medium text-typography-900">{formatUsd(neededUsd)}</dd>
              </div>
            )}
          </dl>

          <div>
            <NumberInput
              id="course-copilot-raise-budget"
              label={strings.newLabel}
              hideSteppers
              min={0}
              value={value}
              invalid={value.trim() !== "" && !isValid}
              invalidText={strings.invalid(formatUsd(spentUsd))}
              onChange={(_event: unknown, state: { value: number | string } | undefined) =>
                setValue(state?.value === undefined ? "" : String(state.value))
              }
            />
            <p className="mt-1 text-xs text-typography-700">{strings.newHint}</p>
          </div>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button kind="tertiary" className="max-sm:!w-full max-sm:!max-w-none" onClick={onClose}>
              {strings.cancel}
            </Button>
            <Button
              kind="primary"
              className="max-sm:!w-full max-sm:!max-w-none"
              disabled={!isValid || isSaving}
              onClick={() => void handleSubmit()}
            >
              {held ? strings.submitHeld : strings.submit}
            </Button>
          </div>
        </div>
      </ModalBody>
    </ComposedModal>
  );
};
