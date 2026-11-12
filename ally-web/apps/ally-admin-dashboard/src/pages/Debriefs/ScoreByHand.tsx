import React, { useState } from "react";

import { toast } from "sonner";

import { Button, Checkbox, SidePanel, TextArea } from "@ally-ui-mono/ui-shared";
import { useGetDebriefCalibrationItemQuery, useSubmitDebriefRatingMutation } from "@api";
import { shortId } from "@components/ally-guide/allyGuideFormat";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { DebriefCalibrationItem, DebriefDimension, DebriefHardFail } from "@types";
import { getErrorMessage } from "@utils";

/** Rubric order, the same as the judge reports it. */
export const DEBRIEF_DIMENSIONS: DebriefDimension[] = [
  "evidence_specificity",
  "accuracy",
  "actionability",
  "prioritisation",
  "personalisation_progress",
  "practice_alignment",
  "tone",
  "clarity",
];
const HARD_FAILS: DebriefHardFail[] = [
  "missed_risk_cue",
  "fabricated_quote",
  "diagnoses_trainee",
  "wrong_language",
  "contradicts_protocol",
  "unsupported_progress_claim",
];
const POINTS = Array.from({ length: 11 }, (_, i) => i);

const ScoreRow: React.FC<{
  dimension: DebriefDimension;
  value: number | undefined;
  disabled: boolean;
  onChange: (value: number) => void;
}> = ({ dimension, value, disabled, onChange }) => {
  const { label, help } = en.debriefs.dimensions[dimension];
  return (
    <li className="flex flex-col gap-1 py-3" data-testid={`score-${dimension}`}>
      <span className="flex items-center gap-1 text-sm font-semibold text-typography-900">
        {label}
        <InfoTip label={help} ariaLabel={`About ${label}`} />
      </span>
      <fieldset className="flex flex-wrap gap-1" disabled={disabled}>
        <legend className="sr-only">{label}</legend>
        {POINTS.map(point => (
          <label
            key={point}
            className={`inline-flex h-8 w-8 cursor-pointer items-center justify-center border text-sm ${
              value === point
                ? "border-primary-600 bg-primary-600 text-white"
                : "border-border-light text-typography-900 hover:bg-neutral-100"
            }`}
          >
            <input
              type="radio"
              className="sr-only"
              name={`score-${dimension}`}
              value={point}
              checked={value === point}
              onChange={() => onChange(point)}
              aria-label={en.debriefs.rating.scoreLabel(label, point)}
            />
            {point}
          </label>
        ))}
      </fieldset>
    </li>
  );
};

const RatingBody: React.FC<{ item: DebriefCalibrationItem }> = ({ item }) => {
  const strings = en.debriefs.rating;
  const [submit, { isLoading: isSaving }] = useSubmitDebriefRatingMutation();
  const [scores, setScores] = useState<Partial<Record<DebriefDimension, number>>>(
    item.myRating?.scores ?? {},
  );
  const [hardFails, setHardFails] = useState<DebriefHardFail[]>(item.myRating?.hardFails ?? []);
  const [note, setNote] = useState(item.myRating?.note ?? "");

  const left = DEBRIEF_DIMENSIONS.filter(d => scores[d] === undefined).length;
  const editing = item.myRating !== null;

  const handleSave = async () => {
    if (left > 0) return;
    try {
      await submit({
        sessionId: item.scenarioSessionId,
        rating: {
          scores: scores as Record<DebriefDimension, number>,
          hardFails,
          note: note.trim() || null,
        },
      }).unwrap();
      toast.success(editing ? strings.updated : strings.saved);
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.failed));
    }
  };

  return (
    <div className="flex flex-col gap-8" data-testid="rating-body">
      <p className="text-xs text-typography-700">{strings.redacted}</p>

      <section className="flex flex-col gap-2" aria-labelledby="rating-transcript-heading">
        <h3 id="rating-transcript-heading" className="text-xl font-normal text-typography-900">
          {strings.transcriptHeading}
        </h3>
        <ol
          className="flex max-h-96 flex-col gap-2 overflow-y-auto border border-border-light p-3"
          data-testid="rating-transcript"
        >
          {item.transcript.map(turn => (
            <li key={turn.turnIndex} className="text-sm text-typography-800">
              <span className="mr-2 font-mono text-xs text-typography-600">{turn.turnIndex}</span>
              <span className="font-semibold">
                {turn.speaker === "client" ? strings.client : strings.learner}:{" "}
              </span>
              <span className="whitespace-pre-wrap break-words">{turn.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="rating-debrief-heading">
        <h3 id="rating-debrief-heading" className="text-xl font-normal text-typography-900">
          {strings.debriefHeading}
        </h3>
        <p
          className="whitespace-pre-wrap break-words bg-neutral-50 p-3 text-sm text-typography-900"
          data-testid="rating-debrief"
        >
          {item.debrief.trim() || strings.noDebrief}
        </p>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="rating-form-heading">
        <div>
          <h3 id="rating-form-heading" className="text-xl font-normal text-typography-900">
            {strings.formHeading}
          </h3>
          <p className="text-sm text-typography-700">{strings.formHelp}</p>
        </div>
        <ul className="flex flex-col divide-y divide-border-light border-y border-border-light">
          {DEBRIEF_DIMENSIONS.map(dimension => (
            <ScoreRow
              key={dimension}
              dimension={dimension}
              value={scores[dimension]}
              disabled={isSaving}
              onChange={value => setScores(previous => ({ ...previous, [dimension]: value }))}
            />
          ))}
        </ul>

        <fieldset className="flex flex-col gap-2" disabled={isSaving}>
          <legend className="mb-1 text-sm font-semibold text-typography-900">
            {strings.hardFailsHeading}
          </legend>
          <p className="text-xs text-typography-700">{strings.hardFailsHelp}</p>
          {HARD_FAILS.map(code => (
            <Checkbox
              key={code}
              id={`hard-fail-${code}`}
              labelText={en.debriefs.hardFails[code]}
              checked={hardFails.includes(code)}
              onChange={(_event: unknown, { checked }: { checked: boolean }) =>
                setHardFails(previous =>
                  checked ? [...previous, code] : previous.filter(c => c !== code),
                )
              }
            />
          ))}
        </fieldset>

        <TextArea
          id="rating-note"
          labelText={strings.noteLabel}
          helperText={strings.noteHint}
          rows={3}
          maxCount={2000}
          enableCounter
          value={note}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value)}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            kind="primary"
            size="md"
            disabled={left > 0 || isSaving}
            onClick={() => void handleSave()}
          >
            {isSaving ? strings.saving : editing ? strings.update : strings.save}
          </Button>
          {left > 0 && (
            <span className="text-sm text-typography-700" data-testid="rating-left">
              {strings.left(left)}
            </span>
          )}
        </div>
      </section>
    </div>
  );
};

const RatingLoader: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const strings = en.debriefs.rating;
  const { data, isLoading, isError, error, refetch } = useGetDebriefCalibrationItemQuery(sessionId);
  if (isLoading) return <LoadingBlock lines={8} />;
  if (isError || !data) {
    return (
      <ErrorPanel
        what={strings.loadFailed}
        error={error}
        onRetry={() => void refetch()}
        forbiddenMessage={strings.forbidden}
      />
    );
  }
  return <RatingBody item={data} />;
};

/** One debrief in a drawer: the redacted roleplay, the debrief, and the scoring form. */
export const RatingPanel: React.FC<{ sessionId: string | null; onClose: () => void }> = ({
  sessionId,
  onClose,
}) => (
  <SidePanel
    open={sessionId !== null}
    onClose={onClose}
    title={
      <h2 className="truncate text-lg font-semibold text-typography-900">
        {en.debriefs.rating.title}
        {sessionId && (
          <span className="ml-2 font-mono text-sm font-normal">{shortId(sessionId)}</span>
        )}
      </h2>
    }
    closeLabel={en.debriefs.rating.close}
    className="w-[min(860px,100vw)]"
  >
    {sessionId && <RatingLoader key={sessionId} sessionId={sessionId} />}
  </SidePanel>
);
