import React, { useState } from "react";

import { toast } from "sonner";

import { Button, Checkbox, Modal, Select, SelectItem } from "@ally-ui-mono/ui-shared";
import { useStartBuilderEvalSuiteMutation } from "@api";
import { en } from "@constants";
import type { BuilderEvalFixture } from "@types";
import { getErrorMessage } from "@utils/errorMessage";

import {
  asArray,
  DEFAULT_REPETITIONS,
  formatEvalCost,
  MAX_REPETITIONS,
  MIN_REPETITIONS,
} from "./evalFormat";

interface RunSuiteDialogProps {
  fixtures: BuilderEvalFixture[];
  /** What a run has cost on recent suites, if any have finished. */
  averageCostPerRun: number | null;
  onClose: () => void;
  onStarted: () => void;
}

const REPETITION_OPTIONS = Array.from(
  { length: MAX_REPETITIONS - MIN_REPETITIONS + 1 },
  (_, index) => MIN_REPETITIONS + index,
);

/**
 * "Run suite": pick the fixtures (every active one by default) and how many
 * times each is played, then start it on the live settings.
 *
 * The cost is said before the button, not after: a run is a full Builder
 * interview, with a simulated-admin call per turn and a judge call, so a suite
 * of eleven fixtures at the default three repetitions is about thirty
 * interviews. The number comes from recent suites when there are any.
 */
export const RunSuiteDialog: React.FC<RunSuiteDialogProps> = ({
  fixtures,
  averageCostPerRun,
  onClose,
  onStarted,
}) => {
  const strings = en.builder.eval.run;
  const [startSuite, { isLoading: isStarting }] = useStartBuilderEvalSuiteMutation();

  const all = asArray<BuilderEvalFixture>(fixtures);
  const [selected, setSelected] = useState<string[]>(() =>
    all.filter(fixture => fixture.active).map(fixture => fixture.id),
  );
  const [repetitions, setRepetitions] = useState(DEFAULT_REPETITIONS);

  const toggle = (id: string, checked: boolean) =>
    setSelected(current =>
      checked ? (current.includes(id) ? current : [...current, id]) : current.filter(x => x !== id),
    );

  const runs = selected.length * repetitions;
  const estimate = averageCostPerRun === null ? null : averageCostPerRun * runs;

  const submit = async () => {
    try {
      await startSuite({ fixtureIds: selected, repetitions }).unwrap();
      toast.success(strings.started);
      onStarted();
      onClose();
    } catch (error) {
      // A 409 (two suites already running) and a 400 (an unknown fixture) both
      // say what to do; the generic fallback is for a network failure.
      toast.error(getErrorMessage(error, strings.failed));
    }
  };

  return (
    <Modal
      open
      size="md"
      modalHeading={strings.title}
      primaryButtonText={isStarting ? strings.starting : strings.submit(runs)}
      secondaryButtonText={en.builder.eval.cancel}
      primaryButtonDisabled={selected.length === 0 || isStarting}
      onRequestSubmit={() => void submit()}
      onRequestClose={onClose}
      onSecondarySubmit={onClose}
    >
      <div className="flex flex-col gap-4">
        {/* A plain div, not an InlineNotification: this is read, not acted on, but the
            sibling dialogs learned that Carbon's notifications are not a place to put
            anything interactive, and keeping the warning plain keeps it that way. */}
        <div
          role="note"
          className="border-l-4 border-warning-300 bg-warning-50 p-3 text-sm text-typography-800"
        >
          <p className="font-medium">{strings.costTitle}</p>
          <p className="mt-1">{strings.costBody}</p>
          <p className="mt-1">
            {strings.costEstimate(
              runs,
              estimate === null ? null : formatEvalCost(estimate),
              averageCostPerRun === null ? null : formatEvalCost(averageCostPerRun),
            )}
          </p>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium text-typography-900">
            <span>{strings.fixturesLegend}</span>
            <span className="flex gap-1">
              <Button
                kind="ghost"
                size="sm"
                onClick={() =>
                  setSelected(all.filter(fixture => fixture.active).map(fixture => fixture.id))
                }
              >
                {strings.selectActive}
              </Button>
              <Button kind="ghost" size="sm" onClick={() => setSelected([])}>
                {strings.selectNone}
              </Button>
            </span>
          </legend>
          {all.map(fixture => (
            <Checkbox
              key={fixture.id}
              id={`builder-eval-run-fixture-${fixture.id}`}
              labelText={strings.fixtureOption(
                fixture.name,
                en.builder.eval.kind[fixture.kind] ?? fixture.kind,
                fixture.active,
              )}
              checked={selected.includes(fixture.id)}
              onChange={(_event: unknown, { checked }: { checked: boolean }) =>
                toggle(fixture.id, checked)
              }
            />
          ))}
        </fieldset>

        <Select
          id="builder-eval-run-repetitions"
          labelText={strings.repetitionsLabel}
          helperText={strings.repetitionsHelper}
          value={String(repetitions)}
          onChange={event => setRepetitions(Number(event.target.value))}
        >
          {REPETITION_OPTIONS.map(count => (
            <SelectItem key={count} value={String(count)} text={String(count)} />
          ))}
        </Select>
      </div>
    </Modal>
  );
};
