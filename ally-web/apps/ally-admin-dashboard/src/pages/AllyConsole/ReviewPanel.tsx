import React, { useState } from "react";

import { useSelector } from "react-redux";
import { toast } from "sonner";

import {
  Button,
  Checkbox,
  SidePanel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextArea,
} from "@ally-ui-mono/ui-shared";
import {
  useClaimAllyGuideReviewMutation,
  useDismissAllyGuideReviewMutation,
  useGetAllyGuideReviewQuery,
  useSubmitAllyGuideReviewMutation,
} from "@api";
import { shortId } from "@components/ally-guide/allyGuideFormat";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { lazyCopy } from "@components/ally-guide/lazyCopy";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { RootState } from "@store";
import { AllyGuideReviewDetail, AllyGuideRubricVerdict } from "@types";
import { getErrorMessage } from "@utils";

const strings = lazyCopy(() => en.allyConsole.evals.review);
const VERDICTS: AllyGuideRubricVerdict[] = ["pass", "fail", "na"];

const VerdictRadios: React.FC<{
  criterionId: string;
  label: string;
  value: AllyGuideRubricVerdict | undefined;
  disabled: boolean;
  onChange: (value: AllyGuideRubricVerdict) => void;
}> = ({ criterionId, label, value, disabled, onChange }) => (
  <fieldset className="flex flex-wrap items-center gap-4" disabled={disabled}>
    <legend className="sr-only">{label}</legend>
    {VERDICTS.map(verdict => (
      <label key={verdict} className="inline-flex items-center gap-1 text-sm text-typography-900">
        <input
          type="radio"
          name={`review-${criterionId}`}
          value={verdict}
          checked={value === verdict}
          onChange={() => onChange(verdict)}
          aria-label={`${label}: ${strings[verdict]}`}
        />
        {strings[verdict]}
      </label>
    ))}
  </fieldset>
);

const verdictOf = (
  judgement:
    | { criteria?: Record<string, { verdict: AllyGuideRubricVerdict; reason: string }> }
    | null
    | undefined,
  id: string,
) => judgement?.criteria?.[id];

const JudgesTable: React.FC<{ detail: AllyGuideReviewDetail }> = ({ detail }) => {
  const labels = detail.review.labels ?? {};
  const word = (verdict: AllyGuideRubricVerdict | undefined) =>
    verdict ? strings[verdict] : strings.noJudge;
  return (
    <section className="flex flex-col gap-2" data-testid="review-judges">
      <h3 className="flex items-center gap-1 text-xl font-normal text-typography-900">
        {strings.judgesHeading}
        <InfoTip label={strings.judgesHelp} ariaLabel="About the judges" />
      </h3>
      <p className="text-sm text-typography-700">{strings.judgesHelp}</p>
      <div className="overflow-x-auto">
        <Table className="w-full border-collapse text-left">
          <TableHead>
            <TableRow className="border-b border-border-light text-sm text-typography-700">
              <TableHeader className="py-2 pr-4 font-medium">
                {strings.judgesColumns.criterion}
              </TableHeader>
              <TableHeader className="py-2 pr-4 font-medium">
                {strings.judgesColumns.you}
              </TableHeader>
              <TableHeader className="py-2 pr-4 font-medium">
                {strings.judgesColumns.critic}
              </TableHeader>
              <TableHeader className="py-2 pr-4 font-medium">
                {strings.judgesColumns.verifier}
              </TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {detail.rubric.map(criterion => {
              const yours = labels[criterion.id];
              const critic = verdictOf(detail.evaluation?.critic, criterion.id);
              const verifier = verdictOf(detail.evaluation?.verifier, criterion.id);
              const cell = (judge: typeof critic) => (
                <>
                  {word(judge?.verdict)}
                  {judge && yours && judge.verdict !== yours && (
                    <span className="block text-xs text-destructive-600">
                      {strings.judgeDiffers}
                    </span>
                  )}
                  {judge?.reason && (
                    <span className="block max-w-xs text-xs text-typography-700">
                      {judge.reason}
                    </span>
                  )}
                </>
              );
              return (
                <TableRow
                  key={criterion.id}
                  className="border-b border-border-light align-top text-sm text-typography-900"
                  data-testid={`judge-row-${criterion.id}`}
                >
                  <TableCell className="py-2 pr-4">{criterion.label}</TableCell>
                  <TableCell className="py-2 pr-4">{word(yours)}</TableCell>
                  <TableCell className="py-2 pr-4">{cell(critic)}</TableCell>
                  <TableCell className="py-2 pr-4">{cell(verifier)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
};

const ReviewBody: React.FC<{ reviewId: string; onClose: () => void }> = ({ reviewId, onClose }) => {
  const currentUserId = useSelector((state: RootState) => state.user?.user?.id);
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideReviewQuery(reviewId);
  const [claim, { isLoading: isClaiming }] = useClaimAllyGuideReviewMutation();
  const [submit, { isLoading: isSubmitting }] = useSubmitAllyGuideReviewMutation();
  const [dismiss, { isLoading: isDismissing }] = useDismissAllyGuideReviewMutation();

  const [labels, setLabels] = useState<Record<string, AllyGuideRubricVerdict>>({});
  const [verdict, setVerdict] = useState<"ok" | "problem" | null>(null);
  const [notes, setNotes] = useState("");
  const [saveAsCase, setSaveAsCase] = useState(false);

  if (isLoading) return <LoadingBlock lines={8} />;
  if (isError || !data) {
    return <ErrorPanel what={strings.loadFailed} error={error} onRetry={() => void refetch()} />;
  }

  const { review, rubric, window: reviewWindow } = data;
  const closed = review.status === "done" || review.status === "dismissed";
  const mine =
    review.reviewerId !== null &&
    currentUserId !== undefined &&
    currentUserId !== null &&
    Number(currentUserId) === review.reviewerId;
  const takenByOther = review.status === "claimed" && review.reviewerId !== null && !mine;
  const unlabelled = rubric.filter(criterion => !labels[criterion.id]).length;
  const complete = unlabelled === 0 && verdict !== null;

  const handleClaim = async () => {
    try {
      await claim(reviewId).unwrap();
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.claimFailed));
    }
  };
  const handleSubmit = async () => {
    if (!complete || verdict === null) return;
    try {
      await submit({ id: reviewId, labels, verdict, notes, saveAsCase }).unwrap();
      toast.success(saveAsCase ? strings.submittedCase : strings.submitted);
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.failed));
    }
  };
  const handleDismiss = async () => {
    try {
      await dismiss({ id: reviewId, notes }).unwrap();
      toast.success(strings.dismissed);
      onClose();
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.dismissFailed));
    }
  };

  return (
    <div className="flex flex-col gap-8" data-testid="review-body">
      {reviewWindow === null ? (
        <p className="text-sm text-typography-800" data-testid="review-gone">
          {strings.gone}
        </p>
      ) : (
        <>
          <p className="text-xs text-typography-700">{strings.redacted}</p>
          <section className="flex flex-col gap-2" aria-labelledby="review-situation-heading">
            <h3 id="review-situation-heading" className="text-xl font-normal text-typography-900">
              {strings.situationHeading}
            </h3>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="review-situation">
              {[
                [
                  strings.situation.mode,
                  en.allyConsole.modes[reviewWindow.situation.mode] ?? reviewWindow.situation.mode,
                ],
                [
                  strings.situation.channel,
                  en.allyConsole.channels[reviewWindow.situation.channel] ??
                    reviewWindow.situation.channel,
                ],
                [strings.situation.budget, reviewWindow.situation.budgetWords ?? "—"],
                [strings.situation.quiz, reviewWindow.situation.quizOpen ? "Yes" : "No"],
                [strings.situation.window, reviewWindow.situation.releaseWindowOpen ? "Yes" : "No"],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex flex-col gap-0.5">
                  <dt className="text-xs tracking-wide text-typography-700">{label}</dt>
                  <dd className="text-sm text-typography-900">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="flex flex-col gap-2" aria-labelledby="review-convo-heading">
            <h3 id="review-convo-heading" className="text-xl font-normal text-typography-900">
              {strings.recentHeading}
            </h3>
            <ol className="flex flex-col gap-2" data-testid="review-recent">
              {reviewWindow.recent.map((message, index) => (
                <li key={index} className="text-sm text-typography-800">
                  <span className="font-semibold">
                    {message.role === "learner" ? strings.learner : strings.ally}:{" "}
                  </span>
                  <span className="whitespace-pre-wrap break-words">{message.text}</span>
                </li>
              ))}
              <li className="text-sm text-typography-900" data-testid="review-learner-text">
                <span className="font-semibold">{strings.learner}: </span>
                {reviewWindow.learnerText ? (
                  <span className="whitespace-pre-wrap break-words">
                    {reviewWindow.learnerText}
                  </span>
                ) : (
                  <em>{strings.learnerHidden}</em>
                )}
              </li>
              <li className="text-sm text-typography-900" data-testid="review-reply">
                <span className="font-semibold">{strings.replyHeading}: </span>
                <span className="whitespace-pre-wrap break-words">{reviewWindow.reply.text}</span>
              </li>
            </ol>
            {reviewWindow.tools.length > 0 && (
              <p className="text-sm text-typography-800">
                <span className="font-semibold">{strings.toolsHeading}: </span>
                {reviewWindow.tools
                  .map(tool => (tool.reason ? `${tool.name} (${tool.reason})` : tool.name))
                  .join(", ")}
              </p>
            )}
            {reviewWindow.flags.length > 0 && (
              <p className="text-sm text-typography-800">
                <span className="font-semibold">{strings.flags}: </span>
                {reviewWindow.flags.join(", ")}
              </p>
            )}
            {data.feedback && (
              <p className="text-sm text-typography-800" data-testid="review-feedback">
                <span className="font-semibold">{strings.feedbackHeading}: </span>
                {data.feedback.rating < 0 ? strings.thumbsDown : strings.thumbsUp}
                {data.feedback.comment ? `, "${data.feedback.comment}"` : ""}
              </p>
            )}
          </section>
        </>
      )}

      {closed ? (
        <>
          <p className="text-sm text-typography-800" data-testid="review-closed">
            {strings.closed}
          </p>
          {review.status === "done" && <JudgesTable detail={data} />}
        </>
      ) : (
        <>
          {review.status === "open" ? (
            <div className="flex items-center gap-3">
              <Button
                kind="tertiary"
                size="md"
                disabled={isClaiming}
                onClick={() => void handleClaim()}
              >
                {strings.claim}
              </Button>
            </div>
          ) : takenByOther ? (
            <p className="text-sm text-typography-800" data-testid="review-taken">
              {strings.claimedByOther}
            </p>
          ) : (
            <p className="text-sm text-typography-800" data-testid="review-mine">
              {strings.claimed}
            </p>
          )}

          <section className="flex flex-col gap-4" aria-labelledby="review-form-heading">
            <div>
              <h3 id="review-form-heading" className="text-xl font-normal text-typography-900">
                {strings.formHeading}
              </h3>
              <p className="text-sm text-typography-700">{strings.formHelp}</p>
            </div>
            <ul className="flex flex-col divide-y divide-border-light border-y border-border-light">
              {rubric.map(criterion => (
                <li
                  key={criterion.id}
                  className="flex flex-col gap-1 py-3"
                  data-testid={`review-criterion-${criterion.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-typography-900">
                      {criterion.label}
                    </span>
                    {criterion.safety && (
                      <Pill tone="warning">{en.allyConsole.evals.evaluator.safetyCriterion}</Pill>
                    )}
                  </div>
                  <details>
                    <summary className="cursor-pointer text-xs text-typography-700">
                      {strings.anchors}
                    </summary>
                    <p className="text-xs text-typography-800">
                      <span className="font-medium">{en.allyConsole.evals.evaluator.pass}: </span>
                      {criterion.pass}
                    </p>
                    <p className="text-xs text-typography-800">
                      <span className="font-medium">{en.allyConsole.evals.evaluator.fail}: </span>
                      {criterion.fail}
                    </p>
                  </details>
                  <VerdictRadios
                    criterionId={criterion.id}
                    label={strings.criterionLabel(criterion.label)}
                    value={labels[criterion.id]}
                    disabled={takenByOther || isSubmitting}
                    onChange={value =>
                      setLabels(previous => ({ ...previous, [criterion.id]: value }))
                    }
                  />
                </li>
              ))}
            </ul>

            <fieldset className="flex flex-col gap-2" disabled={takenByOther || isSubmitting}>
              <legend className="mb-1 text-sm font-semibold text-typography-900">
                {strings.overallLegend}
              </legend>
              {(["ok", "problem"] as const).map(option => (
                <label key={option} className="flex items-center gap-2 text-sm text-typography-900">
                  <input
                    type="radio"
                    name="review-overall"
                    value={option}
                    checked={verdict === option}
                    onChange={() => setVerdict(option)}
                  />
                  {strings[option]}
                </label>
              ))}
            </fieldset>

            <TextArea
              id="review-notes"
              labelText={strings.notesLabel}
              helperText={strings.notesHint}
              rows={3}
              maxCount={2000}
              enableCounter
              value={notes}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                setNotes(event.target.value)
              }
            />
            <div>
              <Checkbox
                id="review-save-case"
                labelText={strings.saveAsCase}
                checked={saveAsCase}
                disabled={takenByOther}
                onChange={(_event: unknown, { checked }: { checked: boolean }) =>
                  setSaveAsCase(checked)
                }
              />
              <p className="mt-1 pl-7 text-xs text-typography-700">{strings.saveAsCaseHelp}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                kind="primary"
                size="md"
                disabled={!complete || takenByOther || isSubmitting}
                onClick={() => void handleSubmit()}
              >
                {isSubmitting ? strings.submitting : strings.submit}
              </Button>
              {unlabelled > 0 && (
                <span className="text-sm text-typography-700" data-testid="review-unlabelled">
                  {strings.unlabelled(unlabelled)}
                </span>
              )}
            </div>

            <div className="flex flex-col items-start gap-1 border-t border-border-light pt-4">
              <Button
                kind="danger--tertiary"
                size="sm"
                disabled={takenByOther || isDismissing}
                onClick={() => void handleDismiss()}
              >
                {strings.dismiss}
              </Button>
              <span className="text-xs text-typography-700">{strings.dismissHelp}</span>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

/** One review in a drawer: the redacted window, the labelling form, and after submit the judges. */
export const ReviewPanel: React.FC<{ reviewId: string | null; onClose: () => void }> = ({
  reviewId,
  onClose,
}) => (
  <SidePanel
    open={reviewId !== null}
    onClose={onClose}
    title={
      <h2 className="truncate text-lg font-semibold text-typography-900">
        {strings.title}
        {reviewId && (
          <span className="ml-2 font-mono text-sm font-normal">{shortId(reviewId)}</span>
        )}
      </h2>
    }
    closeLabel={strings.close}
    className="w-[min(860px,100vw)]"
  >
    {reviewId && <ReviewBody key={reviewId} reviewId={reviewId} onClose={onClose} />}
  </SidePanel>
);
