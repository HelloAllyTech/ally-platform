import { FC, ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import type { GuideAnchor, GuideItemType } from "../contract/wire";

/** Where "Ask about this" was used (plan §5.8). */
export type AskKind = "article" | "video" | "quiz";

export type AskAnchor = Omit<GuideAnchor, "itemId">;

/** A selection worth asking about: a few words, not a stray click or a whole page. */
const QUOTE_MIN = 3;
const QUOTE_MAX = 600;
/** The playhead hasn't moved for this long: the video is paused. */
const PAUSED_AFTER_MS = 1200;

const chipClass =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--g-ally-edge)] bg-[var(--g-card)] px-4 font-primary text-sm font-semibold text-[var(--g-ink)] shadow-md hover:border-[var(--g-ink-faint)] disabled:opacity-50";

/** "1:23" or "1:02:03". */
export const formatMoment = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

export interface AskLayerProps {
  type: GuideItemType | undefined;
  /** Off for a visitor, in a crisis, or while Ally is replying. */
  enabled: boolean;
  onAsk: (anchor: AskAnchor, kind: AskKind) => void;
  /** Video only: wire this to the player's `onPosition`. */
  positionRef?: { current: ((seconds: number) => void) | null };
  children: ReactNode;
}

/**
 * "Ask about this" around an open item (plan §5.8): select text in an
 * article for "Ask Ally"; pause a video for "Ask about this moment"; and,
 * while a quiz is open, "Where is this covered?", which only ever points to
 * the material (the server's quiz firewall keeps it that way).
 */
export const AskLayer: FC<AskLayerProps> = ({ type, enabled, onAsk, positionRef, children }) => {
  if (type === "ARTICLE") return <ArticleAsk {...{ enabled, onAsk }}>{children}</ArticleAsk>;
  if (type === "VIDEO") {
    return <VideoAsk {...{ enabled, onAsk, positionRef }}>{children}</VideoAsk>;
  }
  if (type === "QUIZ") return <QuizAsk {...{ enabled, onAsk }}>{children}</QuizAsk>;
  return <>{children}</>;
};

const ArticleAsk: FC<Omit<AskLayerProps, "type" | "positionRef">> = ({
  enabled,
  onAsk,
  children,
}) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [chip, setChip] = useState<{ quote: string; top: number; left: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setChip(null);
      return undefined;
    }
    const onSelection = () => {
      const root = ref.current;
      const selection = document.getSelection();
      if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        setChip(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        setChip(null);
        return;
      }
      const quote = selection.toString().replace(/\s+/g, " ").trim();
      if (quote.length < QUOTE_MIN || quote.length > QUOTE_MAX) {
        setChip(null);
        return;
      }
      const frame = root.getBoundingClientRect();
      // Below the selection, so it doesn't sit under the phone's own selection
      // menu. Without a range rect (older engines), the top of the article.
      const box =
        typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
      setChip({
        quote,
        top: box ? box.bottom - frame.top + 8 : 8,
        left: box ? Math.max(8, Math.min(box.left - frame.left, frame.width - 160)) : 8,
      });
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [enabled]);

  return (
    <div
      ref={ref}
      className="relative h-full"
      // The article scrolls inside the player: a chip left behind would point at nothing.
      onScrollCapture={() => setChip(null)}
    >
      {children}
      {chip && (
        <button
          type="button"
          className={`${chipClass} absolute z-10`}
          style={{ top: chip.top, left: chip.left }}
          // Keep the selection: a mousedown on the chip would otherwise clear it first.
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            onAsk({ quote: chip.quote }, "article");
            setChip(null);
            document.getSelection()?.removeAllRanges();
          }}
          data-testid="ask-article"
        >
          {t("guide.ask.article")}
        </button>
      )}
    </div>
  );
};

const VideoAsk: FC<Omit<AskLayerProps, "type">> = ({ enabled, onAsk, positionRef, children }) => {
  const { t } = useTranslation();
  const last = useRef({ position: 0, movedAt: 0 });
  const [pausedAt, setPausedAt] = useState<number | null>(null);

  const onPosition = useCallback((seconds: number) => {
    if (Math.abs(seconds - last.current.position) > 0.2) {
      last.current = { position: seconds, movedAt: Date.now() };
      setPausedAt(null);
    }
  }, []);

  useEffect(() => {
    if (!positionRef) return undefined;
    positionRef.current = onPosition;
    return () => {
      positionRef.current = null;
    };
  }, [positionRef, onPosition]);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      const { position, movedAt } = last.current;
      if (position > 0 && movedAt && Date.now() - movedAt > PAUSED_AFTER_MS) {
        setPausedAt(current => (current === null ? position : current));
      }
    }, 400);
    return () => clearInterval(timer);
  }, [enabled]);

  return (
    <div className="relative h-full">
      {children}
      {enabled && pausedAt !== null && (
        <button
          type="button"
          className={`${chipClass} absolute left-3 top-3 z-10`}
          onClick={() => {
            onAsk({ timestampSec: Math.floor(pausedAt) }, "video");
            setPausedAt(null);
          }}
          data-testid="ask-video"
        >
          {t("guide.ask.video", { time: formatMoment(pausedAt) })}
        </button>
      )}
    </div>
  );
};

const QuizAsk: FC<Omit<AskLayerProps, "type" | "positionRef">> = ({ enabled, onAsk, children }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col">
      <div className="flex justify-end border-b border-[var(--g-line)] bg-[var(--g-card)] px-2 py-1">
        <button
          type="button"
          className="min-h-11 rounded-full px-3 font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2 disabled:opacity-50"
          disabled={!enabled}
          onClick={() => onAsk({}, "quiz")}
          data-testid="ask-quiz"
        >
          {t("guide.ask.quiz")}
        </button>
      </div>
      {children}
    </div>
  );
};
