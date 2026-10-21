import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useRecordBranchingResultMutation } from "@api";
import {
  BranchingChoice,
  BranchingNode,
  BranchingOutcomeTone,
  BranchingResult,
  StartBranchingScenarioItemPayload,
  TrackItemCompletionResult,
} from "@types";

interface BranchingScenarioPlayerProps {
  payload: StartBranchingScenarioItemPayload;
  itemId: string;
  onCompleted: (result: TrackItemCompletionResult) => void;
  onRequestNext: () => void;
}

const OUTCOME_STYLES: Record<BranchingOutcomeTone, string> = {
  POSITIVE: "bg-green-100 text-green-800",
  MIXED: "bg-yellow-100 text-yellow-800",
  NEGATIVE: "bg-red-100 text-red-800",
};

const isEnding = (node: BranchingNode) => !node.choices || node.choices.length === 0;

/**
 * Branching scenario: the learner reads a scene, picks a reply, and lives the
 * consequence. The whole story is played locally; only the ids of the choices
 * made go to the server at an ending, and its response — not anything computed
 * here — decides the score, pass/fail and attempts left.
 *
 * A choice is final (no way back): the point is to feel the consequence of a
 * decision, and a back button would turn it into trial and error.
 */
export const BranchingScenarioPlayer: FC<BranchingScenarioPlayerProps> = ({
  payload,
  itemId,
  onCompleted,
  onRequestNext,
}) => {
  const { t } = useTranslation();
  const [recordResult, { isLoading: isRecording }] = useRecordBranchingResultMutation();
  const nodesById = useMemo(() => new Map(payload.nodes.map(n => [n.id, n])), [payload.nodes]);

  const [currentId, setCurrentId] = useState(payload.startNodeId);
  const [path, setPath] = useState<BranchingChoice[]>([]);
  const [result, setResult] = useState<BranchingResult | null>(null);
  const [attemptsExhausted, setAttemptsExhausted] = useState(false);
  const [recordFailed, setRecordFailed] = useState(false);
  const [endingsReached, setEndingsReached] = useState(payload.endingsReached);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const node = nodesById.get(currentId);
  const totalEndings = useMemo(() => payload.nodes.filter(isEnding).length, [payload.nodes]);
  const hasPassMark = payload.passScore != null && payload.passScore > 0;
  const replayFree = payload.completed;

  // Move focus to the new scene so a keyboard or screen-reader user lands on
  // what changed instead of on a button that no longer exists.
  useEffect(() => {
    headingRef.current?.focus();
  }, [currentId, result, attemptsExhausted]);

  const submitPath = useCallback(
    async (finalPath: BranchingChoice[]) => {
      setRecordFailed(false);
      try {
        const response = await recordResult({
          itemId,
          path: finalPath.map(c => c.id),
        }).unwrap();
        setResult(response);
        setEndingsReached(response.endingsReached);
        if (response.passed || response.itemCompleted) onCompleted(response.completion);
      } catch (error) {
        const message = (error as { data?: { message?: string | string[] } })?.data?.message;
        const text = Array.isArray(message) ? message.join(" ") : message;
        if (text?.includes("used all attempts")) {
          setAttemptsExhausted(true);
        } else {
          setRecordFailed(true);
          toast.error(t("common.somethingWentWrong"));
        }
      }
    },
    [itemId, onCompleted, recordResult, t],
  );

  const handleChoose = (choice: BranchingChoice) => {
    if (isRecording) return;
    const nextPath = [...path, choice];
    setPath(nextPath);
    setCurrentId(choice.nextNodeId);
    const next = nodesById.get(choice.nextNodeId);
    if (next && isEnding(next)) void submitPath(nextPath);
  };

  const handleRestart = () => {
    setCurrentId(payload.startNodeId);
    setPath([]);
    setResult(null);
    setAttemptsExhausted(false);
    setRecordFailed(false);
  };

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-typography-700">
        {t("tracks2.player.loadFailed")}
      </div>
    );
  }

  const ending = isEnding(node);
  const isStart = currentId === payload.startNodeId && path.length === 0;
  const canContinue = !!result && (result.passed || result.itemCompleted);
  const canRetry =
    !!result && !canContinue && (result.attemptsLeft == null || result.attemptsLeft > 0);
  const outOfAttempts = attemptsExhausted || (!!result && !canContinue && !canRetry);
  const lastChoice = path[path.length - 1];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-[68ch] flex-col gap-4">
          {isStart && payload.intro && (
            <p className="text-sm text-typography-700">{payload.intro}</p>
          )}

          {isStart && !replayFree && payload.attemptsUsed > 0 && (
            <p className="text-xs text-typography-500">
              {payload.maxAttempts != null
                ? t("tracks2.branching.attemptsLeft", {
                    count: Math.max(0, payload.maxAttempts - payload.attemptsUsed),
                  })
                : null}
            </p>
          )}

          {isStart && endingsReached.length > 0 && (
            <p className="text-xs text-typography-500">
              {t("tracks2.branching.endingsSeen", {
                seen: endingsReached.length,
                total: totalEndings,
              })}
            </p>
          )}

          {lastChoice && (
            <p className="w-fit max-w-full rounded-full bg-primary-50 px-3 py-1 text-xs text-primary-700">
              {t("tracks2.branching.youChose", { choice: lastChoice.text })}
            </p>
          )}

          <section
            aria-labelledby="branching-scene-heading"
            className="flex flex-col gap-4 rounded-xl border border-border-light bg-white p-4 sm:p-6"
          >
            {ending && node.outcome && (
              <span
                className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${OUTCOME_STYLES[node.outcome]}`}
              >
                {t(`tracks2.branching.outcome.${node.outcome}`)}
              </span>
            )}

            {node.image && (
              <img
                src={node.image.url}
                alt={node.image.alt ?? ""}
                className="max-h-72 w-full rounded-lg object-cover"
              />
            )}

            <h2
              id="branching-scene-heading"
              ref={headingRef}
              tabIndex={-1}
              className={`text-lg font-semibold text-typography-900 outline-none ${
                node.title ? "" : "sr-only"
              }`}
            >
              {node.title || t("tracks2.branching.sceneHeading")}
            </h2>

            <p className="whitespace-pre-wrap text-base text-typography-800">{node.text}</p>

            {ending && node.takeaway && (
              <div className="rounded-lg bg-background-50 p-3">
                <p className="text-xs font-medium uppercase text-typography-500">
                  {t("tracks2.branching.takeaway")}
                </p>
                <p className="mt-1 text-sm text-typography-800">{node.takeaway}</p>
              </div>
            )}

            {ending && result && hasPassMark && !replayFree && (
              <div role="status" className="flex flex-col gap-1 text-sm">
                <p className="font-medium text-typography-900">
                  {t("tracks2.branching.scoreVsPass", {
                    score: result.score,
                    pass: result.passScore ?? payload.passScore,
                  })}
                </p>
                <p className={result.passed ? "text-green-700" : "text-typography-600"}>
                  {result.passed ? t("tracks2.branching.passed") : t("tracks2.branching.notPassed")}
                </p>
                {result.attemptsLeft != null && !result.passed && (
                  <p className="text-typography-500">
                    {t("tracks2.branching.attemptsLeft", { count: result.attemptsLeft })}
                  </p>
                )}
              </div>
            )}

            {ending && outOfAttempts && (
              <p role="alert" className="text-sm text-typography-700">
                {t("tracks2.branching.attemptsExhausted")}
              </p>
            )}

            {ending && result && (
              <p className="text-xs text-typography-500">
                {t("tracks2.branching.endingsSeen", {
                  seen: result.endingsReached.length,
                  total: totalEndings,
                })}
              </p>
            )}

            {!ending && (
              <ul className="flex flex-col gap-2" aria-label={t("tracks2.branching.choicesLabel")}>
                {node.choices?.map(choice => (
                  <li key={choice.id}>
                    <button
                      type="button"
                      onClick={() => handleChoose(choice)}
                      disabled={isRecording}
                      className="w-full rounded-xl border border-border-light bg-white px-4 py-3 text-left text-base text-typography-900 transition-colors hover:border-primary-500 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 disabled:opacity-50 max-md:min-h-11"
                    >
                      {choice.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {ending && (
        <div className="flex flex-shrink-0 flex-wrap items-center justify-center gap-3 border-t border-border-light bg-white px-4 py-3">
          {isRecording && (
            <span role="status" className="text-sm text-typography-500">
              {t("tracks2.branching.saving")}
            </span>
          )}
          {recordFailed && (
            <button
              type="button"
              onClick={() => void submitPath(path)}
              className="rounded-full bg-primary-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 max-md:min-h-11"
            >
              {t("tracks2.player.retry")}
            </button>
          )}
          {(canContinue || (replayFree && !!result)) && (
            <button
              type="button"
              onClick={onRequestNext}
              className="rounded-full bg-primary-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 max-md:min-h-11"
            >
              {t("tracks2.branching.continueCourse")}
            </button>
          )}
          {(canRetry || ((canContinue || replayFree) && !!result)) && (
            <button
              type="button"
              onClick={handleRestart}
              className={
                canRetry
                  ? "rounded-full bg-primary-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 max-md:min-h-11"
                  : "rounded-full border border-border-light px-6 py-2 text-sm font-medium text-typography-700 hover:bg-background-50 max-md:min-h-11"
              }
            >
              {canRetry ? t("tracks2.branching.tryAgain") : t("tracks2.branching.playAgain")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
