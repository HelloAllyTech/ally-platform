import { DragEvent, FC, useCallback, useMemo, useRef, useState } from "react";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  usePlaceBucketSortItemMutation,
  useRestartBucketSortMutation,
  useStartTrackItemMutation,
} from "@api";
import {
  BucketSortFeedback,
  StartBucketSortItemPayload,
  TrackItemCompletionResult,
  TrackItemType,
} from "@types";

interface BucketSortPlayerProps {
  payload: StartBucketSortItemPayload;
  itemId: string;
  onCompleted: (result: TrackItemCompletionResult) => void;
  onRequestNext: () => void;
}

const PRIMARY_BUTTON =
  "rounded-full bg-primary-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 max-md:min-h-11";
const SECONDARY_BUTTON =
  "rounded-full border border-border-light px-6 py-2 text-sm font-medium text-typography-800 transition-colors hover:bg-gray-50 max-md:min-h-11";

/**
 * Bucket sort: one item at a time, dropped into a bucket by dragging it there
 * or tapping the bucket (tapping is the whole interaction on a phone, and the
 * keyboard route for everyone else). The server owns the answer key, so every
 * placement is a round trip, and what comes back — verdict, the right bucket,
 * the author's explanation — is shown before the next item appears. A wrong
 * guess is deliberately final: the first placement is what the course learns
 * from, and after the feedback the item sits in its correct bucket.
 */
export const BucketSortPlayer: FC<BucketSortPlayerProps> = ({
  payload: initialPayload,
  itemId,
  onCompleted,
  onRequestNext,
}) => {
  const { t } = useTranslation();
  const [payload, setPayload] = useState(initialPayload);
  const [answered, setAnswered] = useState<Record<string, BucketSortFeedback>>(
    initialPayload.bucketSort.answered,
  );
  /** The item whose feedback is on screen; the next item waits behind "Next". */
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [placeItem, { isLoading: isPlacing }] = usePlaceBucketSortItemMutation();
  const [restart, { isLoading: isRestarting }] = useRestartBucketSortMutation();
  const [startTrackItem] = useStartTrackItemMutation();
  /**
   * The completion the last placement earned. The server has already recorded
   * it, but reporting it opens the "course complete" celebration over the whole
   * player, which would bury the final item's feedback and the results screen.
   * So it is held until the learner has read both.
   */
  const pendingCompletion = useRef<TrackItemCompletionResult | null>(null);

  const { buckets, items } = payload.bucketSort;
  const bucketName = useMemo(() => new Map(buckets.map(b => [b.id, b.label])), [buckets]);
  const placedCount = Object.keys(answered).length;
  const nextItem = items.find(item => !answered[item.id]);
  const reviewing = reviewingId ? items.find(item => item.id === reviewingId) : undefined;
  const reviewingFeedback = reviewingId ? answered[reviewingId] : undefined;
  const finished = placedCount === items.length && !reviewing;
  const current = reviewing ?? nextItem;

  const place = useCallback(
    async (sortItemId: string, bucketId: string) => {
      if (isPlacing || reviewingId) return;
      try {
        const result = await placeItem({ itemId, sortItemId, bucketId }).unwrap();
        setAnswered(prev => ({
          ...prev,
          [sortItemId]: {
            correct: result.correct,
            placedBucketId: result.placedBucketId,
            correctBucketId: result.correctBucketId,
            explanation: result.explanation,
          },
        }));
        setReviewingId(sortItemId);
        if (result.completion) pendingCompletion.current = result.completion;
      } catch {
        toast.error(t("common.somethingWentWrong"));
      }
    },
    [isPlacing, reviewingId, placeItem, itemId, t],
  );

  const handleRestart = async () => {
    try {
      await restart({ itemId }).unwrap();
      const fresh = await startTrackItem({ itemId }).unwrap();
      if (fresh.type !== TrackItemType.BUCKET_SORT) return;
      setPayload(fresh);
      setAnswered(fresh.bucketSort.answered);
      setReviewingId(null);
    } catch {
      toast.error(t("common.somethingWentWrong"));
    }
  };

  const handleDrop = (event: DragEvent<HTMLElement>, bucketId: string) => {
    event.preventDefault();
    setDragOverId(null);
    const sortItemId = event.dataTransfer.getData("text/plain");
    if (sortItemId && sortItemId === current?.id && !reviewing) void place(sortItemId, bucketId);
  };

  const firstTryPct = Math.round(
    (Object.values(answered).filter(a => a.correct).length / Math.max(items.length, 1)) * 100,
  );
  const missed = items.filter(item => answered[item.id] && !answered[item.id].correct);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      {payload.bucketSort.intro && (
        <p className="text-sm text-typography-700">{payload.bucketSort.intro}</p>
      )}

      {!finished && current && (
        <>
          <div className="flex items-center justify-between text-xs text-typography-600">
            <span>{t("tracks2.bucketSort.whereDoesItGo")}</span>
            <span aria-live="polite">
              {t("tracks2.bucketSort.progress", {
                placed: placedCount,
                total: items.length,
              })}
            </span>
          </div>
          <div
            draggable={!reviewing && !isPlacing}
            onDragStart={event => event.dataTransfer.setData("text/plain", current.id)}
            aria-label={t("tracks2.bucketSort.yourItem")}
            className="cursor-grab rounded-xl border-2 border-primary-300 bg-white p-5 text-base font-medium text-typography-900 shadow-sm"
          >
            {current.text}
          </div>
          {!reviewing && (
            <p className="text-xs text-typography-500">{t("tracks2.bucketSort.dragHint")}</p>
          )}
        </>
      )}

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
      >
        {buckets.map(bucket => {
          const settled = items.filter(
            item => answered[item.id]?.correctBucketId === bucket.id && item.id !== reviewingId,
          );
          const isReviewTarget = reviewingFeedback?.correctBucketId === bucket.id;
          const isReviewWrong =
            reviewingFeedback && !reviewingFeedback.correct
              ? reviewingFeedback.placedBucketId === bucket.id
              : false;
          const canPlace = !!current && !reviewing && !isPlacing;
          return (
            <section
              key={bucket.id}
              onDragOver={event => {
                if (!canPlace) return;
                event.preventDefault();
                setDragOverId(bucket.id);
              }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={event => handleDrop(event, bucket.id)}
              className={`flex flex-col gap-2 rounded-xl border-2 p-3 transition-colors ${
                isReviewTarget
                  ? "border-green-500 bg-green-50"
                  : isReviewWrong
                    ? "border-red-400 bg-red-50"
                    : dragOverId === bucket.id
                      ? "border-primary-500 bg-primary-50"
                      : "border-border-light bg-white"
              }`}
            >
              <button
                type="button"
                disabled={!canPlace}
                onClick={() => current && void place(current.id, bucket.id)}
                aria-label={
                  current
                    ? t("tracks2.bucketSort.bucketAria", {
                        item: current.text,
                        bucket: bucket.label,
                      })
                    : bucket.label
                }
                className="text-left disabled:cursor-default max-md:min-h-11"
              >
                <span className="block text-sm font-semibold text-typography-900">
                  {bucket.label}
                </span>
                {bucket.description && (
                  <span className="block text-xs text-typography-600">{bucket.description}</span>
                )}
              </button>
              <ul className="flex flex-col gap-1">
                {isReviewTarget && current && (
                  <li className="rounded-md bg-white px-2 py-1 text-xs font-medium text-typography-900">
                    {current.text}
                  </li>
                )}
                {settled.map(item => (
                  <li
                    key={item.id}
                    className="rounded-md bg-gray-100 px-2 py-1 text-xs text-typography-800"
                  >
                    {item.text}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {reviewing && reviewingFeedback && (
        <div
          role="status"
          className={`rounded-xl border p-4 ${
            reviewingFeedback.correct
              ? "border-green-300 bg-green-50 text-green-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          <p className="text-sm font-semibold">
            {reviewingFeedback.correct
              ? t("tracks2.bucketSort.correct")
              : t("tracks2.bucketSort.notQuite")}
          </p>
          {!reviewingFeedback.correct && (
            <p className="mt-1 text-sm">
              {t("tracks2.bucketSort.youChose", {
                bucket: bucketName.get(reviewingFeedback.placedBucketId),
              })}{" "}
              {t("tracks2.bucketSort.belongsIn", {
                bucket: bucketName.get(reviewingFeedback.correctBucketId),
              })}
            </p>
          )}
          {reviewingFeedback.explanation && (
            <p className="mt-1 text-sm">{reviewingFeedback.explanation}</p>
          )}
          <button
            type="button"
            onClick={() => {
              setReviewingId(null);
              if (pendingCompletion.current) {
                onCompleted(pendingCompletion.current);
                pendingCompletion.current = null;
              }
            }}
            className={`${PRIMARY_BUTTON} mt-3`}
            autoFocus
          >
            {placedCount === items.length
              ? t("tracks2.bucketSort.seeResults")
              : t("tracks2.bucketSort.next")}
          </button>
        </div>
      )}

      {finished && (
        <div className="flex flex-col gap-3 rounded-xl border border-border-light bg-white p-5">
          <h2 className="text-lg font-semibold text-typography-900">
            {t("tracks2.bucketSort.resultsHeading")}
          </h2>
          <p className="text-sm text-typography-800">
            {t("tracks2.bucketSort.firstTry", { pct: firstTryPct })}
          </p>
          {payload.bestFirstTryPct !== null && (
            <p className="text-xs text-typography-600">
              {t("tracks2.bucketSort.best", { pct: payload.bestFirstTryPct })}
            </p>
          )}
          {missed.length === 0 ? (
            <p className="text-sm text-typography-700">{t("tracks2.bucketSort.allRight")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-typography-900">
                {t("tracks2.bucketSort.reviewHeading")}
              </h3>
              <ul className="flex flex-col gap-2">
                {missed.map(item => (
                  <li
                    key={item.id}
                    className="rounded-md bg-red-50 p-3 text-sm text-typography-900"
                  >
                    <span className="font-medium">{item.text}</span>
                    <span className="block text-xs text-typography-700">
                      {t("tracks2.bucketSort.belongsIn", {
                        bucket: bucketName.get(answered[item.id].correctBucketId),
                      })}
                    </span>
                    {answered[item.id].explanation && (
                      <span className="block text-xs text-typography-700">
                        {answered[item.id].explanation}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-3 pt-1">
            <button type="button" onClick={onRequestNext} className={PRIMARY_BUTTON}>
              {t("tracks2.bucketSort.continue")}
            </button>
            <button
              type="button"
              onClick={handleRestart}
              disabled={isRestarting}
              className={SECONDARY_BUTTON}
            >
              {t("tracks2.bucketSort.practiceAgain")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
