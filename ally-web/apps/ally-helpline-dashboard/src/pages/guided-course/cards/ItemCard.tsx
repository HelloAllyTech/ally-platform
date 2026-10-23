import { FC, useCallback, useRef } from "react";

import { useTranslation } from "react-i18next";

import { buildTrackItemRoute } from "@constants";

import { CardFrame } from "./CardFrame";
import { failedCopyKey, ItemPlayerHost, ItemPlayerHostProps } from "./ItemPlayerHost";
import { itemCardFor } from "./registry";

import type { GuideCard } from "../contract/wire";
import type { CelebrationTier } from "../state/atmosphere";

export interface ItemCardProps extends Omit<ItemPlayerHostProps, "card"> {
  card: GuideCard;
  /** This card's player is the open one. */
  active: boolean;
  /** Its Shelf or Theatre is on screen (not stepped back from). */
  panelVisible?: boolean;
  /** Phone layout: the Shelf opens as a sheet, not "on the right". */
  compact: boolean;
  celebration: CelebrationTier;
  onOpen: (cardId: string, returnFocusTo: HTMLElement | null) => void;
}

const RECEIPT: Record<string, string> = {
  ARTICLE: "guide.card.receipt.read",
  VIDEO: "guide.card.receipt.watched",
  QUIZ: "guide.card.receipt.passed",
  JOURNAL: "guide.card.receipt.written",
  BRANCHING_SCENARIO: "guide.card.receipt.finished",
  BUCKET_SORT: "guide.card.receipt.sorted",
  ROLEPLAY: "guide.card.receipt.practised",
  CASE: "guide.card.receipt.caseComplete",
  ANNOTATED_ARTIFACT: "guide.card.receipt.finished",
  GAME: "guide.card.receipt.played",
};

/** Extra states a course card can carry in its payload (card grammar §2). */
const PAYLOAD_STATE: Record<string, string> = {
  pending: "guide.card.state.pending",
  blocked: "guide.card.state.blocked",
  resumable: "guide.card.state.resumable",
  locked: "guide.card.state.locked",
  partial: "guide.card.state.partial",
};

const payloadString = (card: GuideCard, key: string): string | null => {
  const value = (card.payload as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value ? value : null;
};

/**
 * A course item in the conversation. Inline types (quiz, journal, scenario
 * quiz) expand in place; Shelf and Theatre types collapse to a slim "open
 * elsewhere" card while their player sits in the panel.
 */
export const ItemCard: FC<ItemCardProps> = ({
  card,
  active,
  panelVisible = false,
  compact,
  celebration,
  onOpen,
  trackId,
  threadId,
  onClaim,
  onClose,
  onLaunch,
}) => {
  const { t } = useTranslation();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const entry = itemCardFor(card.trackItem?.type);
  const type = card.trackItem?.type;
  const open = useCallback(() => onOpen(card.cardId, primaryRef.current), [onOpen, card.cardId]);

  if (!entry || !type) return null;

  const typeWord = t(entry.typeWordKey);
  const minutes = card.meta?.minutes;
  const format = card.meta?.format && card.meta.format !== typeWord ? card.meta.format : null;
  const meta =
    [format, minutes ? t("guide.card.meta.minutes", { count: minutes }) : null]
      .filter(Boolean)
      .join(" · ") || null;

  const extra = payloadString(card, "status");
  const extraLabel = extra && PAYLOAD_STATE[extra] ? t(PAYLOAD_STATE[extra]) : null;
  const locked = extra === "locked";

  const hint =
    entry.presentation === "theatre"
      ? t("guide.card.opensFullScreen")
      : entry.presentation === "shelf"
        ? t(compact ? "guide.card.opensOnTop" : "guide.card.opensRight")
        : null;

  const state =
    active && (card.state === "ready" || card.state === "active") ? "active" : card.state;
  const classicHref = card.trackItem ? buildTrackItemRoute(trackId, card.trackItem.id) : null;

  if (state === "done" || state === "superseded") {
    const behaviour = payloadString(card, "behaviourLabel");
    const receipt =
      state === "superseded"
        ? t("guide.card.state.superseded")
        : [t(RECEIPT[type] ?? "guide.card.receipt.finished"), behaviour]
            .filter(Boolean)
            .join(" · ");
    return (
      <CardFrame
        testId={`card-${card.cardId}`}
        state={state}
        surface="course"
        typeWord={typeWord}
        title={card.title}
        receipt={receipt}
        celebration={celebration}
        secondary={{ label: t("guide.card.openAgain"), onClick: open }}
      >
        {active && entry.presentation === "inline" && (
          <div className="g-inline-player mt-2 w-full overflow-hidden rounded-xl border border-[var(--g-line)] bg-white">
            <ItemPlayerHost
              card={card}
              trackId={trackId}
              threadId={threadId}
              onClaim={onClaim}
              onClose={onClose}
              onLaunch={onLaunch}
            />
          </div>
        )}
      </CardFrame>
    );
  }

  const isInlineActive = state === "active" && entry.presentation === "inline";
  const openElsewhere = state === "active" && entry.presentation !== "inline";

  return (
    <CardFrame
      testId={`card-${card.cardId}`}
      state={state}
      surface="course"
      glyph={entry.glyph}
      typeWord={typeWord}
      meta={meta}
      title={card.title}
      framing={card.framing}
      stateLabel={
        openElsewhere
          ? t(
              entry.presentation === "theatre"
                ? "guide.card.state.openFullScreen"
                : "guide.card.state.openBeside",
            )
          : extraLabel
      }
      primaryRef={primaryRef}
      primary={
        locked || isInlineActive || (openElsewhere && panelVisible)
          ? null
          : openElsewhere
            ? { label: t("guide.card.backToIt"), onClick: open }
            : { label: card.cta?.label ?? t(entry.verbKey), onClick: open, hint }
      }
      secondary={
        isInlineActive
          ? { label: t("guide.card.close"), onClick: () => onClose(card.cardId) }
          : null
      }
      failure={
        state === "failed" ? { message: t(failedCopyKey(type)), onRetry: open, classicHref } : null
      }
    >
      {isInlineActive && (
        <div className="g-inline-player mt-3 overflow-hidden rounded-xl border border-[var(--g-line)] bg-white">
          <ItemPlayerHost
            card={card}
            trackId={trackId}
            threadId={threadId}
            onClaim={onClaim}
            onClose={onClose}
            onLaunch={onLaunch}
          />
        </div>
      )}
    </CardFrame>
  );
};
