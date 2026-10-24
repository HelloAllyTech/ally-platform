import { FC, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import { useGetLearnTrackDetailQuery, useStartTrackItemMutation } from "@api";
import { ErrorBoundary } from "@components/error-boundary/ErrorBoundary";
import { buildTrackItemRoute } from "@constants";
import {
  StartTrackItemResponse,
  TrackDetailItem,
  TrackItemCompletionResult,
  TrackItemStatus,
} from "@types";

import { AskAnchor, AskKind, AskLayer } from "./AskLayer";
import { itemCardFor } from "./registry";

import type { GuideAnchor, GuideCard } from "../contract/wire";

export interface ItemPlayerHostProps {
  card: GuideCard;
  trackId: string;
  threadId: string;
  /** The player finished the item; the journey posts the claim. Called at most once. */
  onClaim: (cardId: string, result: TrackItemCompletionResult) => void;
  onClose: (cardId: string) => void;
  onLaunch: (cardId: string) => void;
  /** "Ask about this" (plan §5.8): a turn with the item, and a quote or a moment, attached. */
  onAsk?: (cardId: string, anchor: GuideAnchor, kind: AskKind) => void;
  /** Off while Ally is replying, and for a visitor. */
  askEnabled?: boolean;
}

const FAILED_COPY: Record<string, string> = {
  ARTICLE: "guide.card.failed.article",
  VIDEO: "guide.card.failed.video",
  QUIZ: "guide.card.failed.quiz",
  JOURNAL: "guide.card.failed.journal",
  BRANCHING_SCENARIO: "guide.card.failed.quiz",
  BUCKET_SORT: "guide.card.failed.bucketSort",
  ROLEPLAY: "guide.card.failed.roleplay",
  CASE: "guide.card.failed.roleplay",
  ANNOTATED_ARTIFACT: "guide.card.failed.annotation",
  GAME: "guide.card.failed.game",
};

export const failedCopyKey = (type: string | undefined): string =>
  (type && FAILED_COPY[type]) || "guide.card.failed.generic";

const findItem = (
  sections: Array<{ items: TrackDetailItem[] }> | undefined,
  itemId: string,
): TrackDetailItem | null => {
  for (const section of sections ?? []) {
    const match = section.items.find(item => item.id === itemId);
    if (match) return match;
  }
  return null;
};

/**
 * Opens a course item the way classic does (start → type-specific payload)
 * and renders its adapter. Mounted only for the one active card, so a past
 * card never re-mounts a player (plan §5.6).
 */
export const ItemPlayerHost: FC<ItemPlayerHostProps> = ({
  card,
  trackId,
  threadId,
  onClaim,
  onClose,
  onLaunch,
  onAsk,
  askEnabled = true,
}) => {
  const { t, i18n } = useTranslation();
  const itemId = card.trackItem?.id ?? "";
  const entry = itemCardFor(card.trackItem?.type);
  const [startTrackItem] = useStartTrackItemMutation();
  const { data: detail } = useGetLearnTrackDetailQuery(
    { trackId, languageCode: i18n.language },
    { skip: !trackId },
  );
  const item = useMemo(() => findItem(detail?.sections, itemId), [detail, itemId]);

  const [payload, setPayload] = useState<StartTrackItemResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (!itemId) return;
    setLoadFailed(false);
    setPayload(null);
    try {
      setPayload(await startTrackItem({ itemId }).unwrap());
    } catch {
      setLoadFailed(true);
    }
  }, [itemId, startTrackItem]);

  useEffect(() => {
    void load();
  }, [load]);

  // Stable for the card's life and fires once: the game player reports from
  // an effect keyed on this callback, and a claim must be posted only once.
  const claimed = useRef(false);
  const latest = useRef({ onClaim, cardId: card.cardId });
  latest.current = { onClaim, cardId: card.cardId };
  const handleCompleted = useCallback((result: TrackItemCompletionResult) => {
    if (!result?.completed || claimed.current) return;
    claimed.current = true;
    latest.current.onClaim(latest.current.cardId, result);
  }, []);
  const handleClose = useCallback(() => onClose(card.cardId), [onClose, card.cardId]);
  const handleLaunch = useCallback(() => onLaunch(card.cardId), [onLaunch, card.cardId]);
  const returnContext = useMemo(
    () => ({ returnTo: "guided" as const, threadId, cardId: card.cardId }),
    [threadId, card.cardId],
  );
  // The video reports its playhead here; the Ask layer listens.
  const positionRef = useRef<((seconds: number) => void) | null>(null);
  const handlePosition = useCallback((seconds: number) => positionRef.current?.(seconds), []);
  const latestAsk = useRef(onAsk);
  latestAsk.current = onAsk;
  const handleAsk = useCallback(
    (anchor: AskAnchor, kind: AskKind) =>
      latestAsk.current?.(card.cardId, { itemId, ...anchor }, kind),
    [card.cardId, itemId],
  );

  if (!entry || !itemId) return null;

  if (loadFailed) {
    return (
      <div
        className="flex h-full flex-col items-start justify-center gap-3 p-6"
        data-testid="player-failed"
      >
        <p className="g-prose">{t(failedCopyKey(card.trackItem?.type))}</p>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => void load()}
            className="min-h-10 rounded-[10px] bg-[var(--g-action)] px-4 font-primary text-[15px] font-semibold text-[var(--g-on-action)] max-md:min-h-11"
          >
            {t("guide.common.retry")}
          </button>
          <a
            href={buildTrackItemRoute(trackId, itemId)}
            className="font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2"
          >
            {t("guide.common.openClassic")}
          </a>
        </div>
      </div>
    );
  }

  if (!payload) return <HostLoading />;

  const { Adapter } = entry;
  const alreadyCompleted = item?.status === TrackItemStatus.COMPLETED || card.state === "done";
  return (
    <ErrorBoundary variant="panel" resetKey={card.cardId}>
      <Suspense fallback={<HostLoading />}>
        <AskLayer
          type={card.trackItem?.type}
          enabled={Boolean(onAsk) && askEnabled}
          onAsk={handleAsk}
          positionRef={positionRef}
        >
          <Adapter
            payload={payload}
            itemId={itemId}
            trackId={trackId}
            item={item}
            alreadyCompleted={alreadyCompleted}
            onCompleted={handleCompleted}
            onClose={handleClose}
            onBeforeLaunch={handleLaunch}
            returnContext={returnContext}
            onPosition={handlePosition}
          />
        </AskLayer>
      </Suspense>
    </ErrorBoundary>
  );
};

const HostLoading: FC = () => {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full flex-col gap-3 p-6"
      role="status"
      aria-label={t("guide.card.opening")}
    >
      <div className="g-skeleton h-6 w-1/2" />
      <div className="g-skeleton h-4 w-full" />
      <div className="g-skeleton h-4 w-5/6" />
    </div>
  );
};
