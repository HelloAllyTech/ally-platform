import { FC, PointerEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";

import { TickGreenBackground } from "@assets";
import { ArticleCover, ArticleResource, SubmitArticleQuestionAnswerResponse } from "@types";

import { ArticleCard, ArticleCardPhoto } from "../articleCards";
import { ArticleQuestionCard } from "../ArticleQuestionCard";
import { ArticleProse } from "./ArticleProse";
import { ArticleResourceList } from "./ArticleResourceList";
import { TakeawayList } from "./ArticleTakeaways";

/** Horizontal travel (px) that counts as a swipe rather than a tap or a scroll. */
const SWIPE_THRESHOLD = 60;

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "INPUT" ||
    target.tagName === "SELECT");

interface ArticleCardsProps {
  cards: ArticleCard[];
  itemId: string;
  cover: ArticleCover | null;
  title: string;
  description: string | null;
  sectionTitle: string;
  minutes: number;
  takeaways: string[];
  resources: ArticleResource[];
  answeredIds: Set<string>;
  onQuestionAnswered: (questionId: string, result: SubmitArticleQuestionAnswerResponse) => void;
  onOpenResource: (resource: ArticleResource) => void;
  /** Arriving at the last card is this layout's "read to the end". */
  onReachedEnd: () => void;
  marked: boolean;
  canMark: boolean;
  isMarking: boolean;
  /** The host's mark-as-read label (it already says why it's blocked). */
  markLabel: string;
  onMarkRead: () => void;
  /** The way on once read: the course's bottom nav is hidden under cards. */
  onRequestNext?: () => void;
}

const KICKER_CLASS = "mb-2 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-primary-500";

/** The white card: photo left (desktop) or on top (phone) when there is one. */
const CardFrame: FC<{ photo: ArticleCardPhoto | null; tall?: boolean; children: ReactNode }> = ({
  photo,
  tall = false,
  children,
}) => (
  <div
    className={`ally-article-card mx-auto w-full max-w-[420px] overflow-hidden rounded-[22px] bg-white shadow-[0_12px_32px_-14px_rgba(41,38,31,0.28)] md:max-w-[640px] ${
      photo ? "md:flex md:min-h-[400px]" : ""
    }`}
  >
    {photo && (
      <div
        className={`w-full flex-none overflow-hidden bg-neutral-100 md:h-auto md:w-2/5 ${
          tall ? "h-[300px]" : "h-[190px]"
        }`}
      >
        <img src={photo.src} alt={photo.alt} className="h-full w-full object-cover" />
      </div>
    )}
    <div className="min-w-0 flex-1 p-5 sm:p-6 md:p-7">{children}</div>
  </div>
);

/**
 * The Cards layout: the article paged one card at a time — a cover, a card
 * per section, a card per question, and an end card. The reader moves with
 * the back/next bar, the arrow keys or a swipe; the last card carries the
 * mark-as-read action, gated exactly as the scrolling layouts gate it.
 */
export const ArticleCards: FC<ArticleCardsProps> = ({
  cards,
  itemId,
  cover,
  title,
  description,
  sectionTitle,
  minutes,
  takeaways,
  resources,
  answeredIds,
  onQuestionAnswered,
  onOpenResource,
  onReachedEnd,
  marked,
  canMark,
  isMarking,
  markLabel,
  onMarkRead,
  onRequestNext,
}) => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const directionRef = useRef(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const swipeRef = useRef<{ x: number; y: number } | null>(null);

  const total = cards.length;
  const lastIndex = total - 1;
  const card = cards[Math.min(index, lastIndex)];
  const isFinal = index >= lastIndex;
  const blockedByQuestion = card.kind === "question" && !answeredIds.has(card.question.id);
  const canGoNext = !isFinal && !blockedByQuestion;

  useEffect(() => {
    if (index >= lastIndex) onReachedEnd();
  }, [index, lastIndex, onReachedEnd]);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next > lastIndex) return;
      directionRef.current = next > index ? 1 : -1;
      setIndex(next);
      stageRef.current?.scrollTo?.({ top: 0 });
    },
    [index, lastIndex],
  );
  const goNext = useCallback(() => {
    if (canGoNext) goTo(index + 1);
  }, [canGoNext, goTo, index]);
  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);

  // ←/→ turn cards. The track player stands its own arrow keys down while a
  // cards article is current, so these never also move between items.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  const onPointerDown = (e: PointerEvent) => {
    swipeRef.current = e.pointerType === "mouse" ? null : { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) goNext();
    else goPrev();
  };

  const offset = reduceMotion ? 0 : 36;
  const variants = {
    enter: (dir: number) => ({ opacity: 0, x: dir * offset }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir * -offset }),
  };

  const renderCard = () => {
    switch (card.kind) {
      case "cover": {
        const kicker = [sectionTitle, t("tracks2.article.minRead", { minutes })]
          .filter(Boolean)
          .join(" · ");
        const photo = cover ? { src: cover.url, alt: cover.alt ?? "" } : null;
        return (
          <CardFrame photo={photo} tall>
            <div className="flex h-full flex-col">
              <p className={KICKER_CLASS}>{kicker}</p>
              <h1 className="text-[26px] font-bold leading-[1.15] text-typography-900 md:text-[30px]">
                {title}
              </h1>
              {description && (
                <p className="mt-3 text-[16px] italic leading-snug text-typography-600">
                  {description}
                </p>
              )}
              {!isFinal && (
                <button
                  type="button"
                  onClick={goNext}
                  className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full bg-primary-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 max-md:w-full md:mt-auto"
                >
                  {t("tracks2.article.startReading")}
                  <span aria-hidden>→</span>
                </button>
              )}
            </div>
          </CardFrame>
        );
      }
      case "section":
        return (
          <CardFrame photo={card.photo}>
            {card.title ? (
              <>
                {title && <p className={KICKER_CLASS}>{title}</p>}
                <h2 className="mb-3 text-[22px] font-semibold leading-tight text-typography-900 md:text-[24px]">
                  {card.title}
                </h2>
              </>
            ) : (
              <p className={KICKER_CLASS}>{card.section ?? title}</p>
            )}
            <div className="text-[16px]">
              <ArticleProse html={card.html} />
            </div>
          </CardFrame>
        );
      case "question":
        return (
          <CardFrame photo={null}>
            <ArticleQuestionCard
              bare
              itemId={itemId}
              question={card.question}
              onAnswered={result => onQuestionAnswered(card.question.id, result)}
            />
          </CardFrame>
        );
      case "end":
        return (
          <CardFrame photo={null}>
            {takeaways.length > 0 && (
              <>
                <p className={KICKER_CLASS}>{t("tracks2.article.takeawaysHeading")}</p>
                <div className="text-[16px]">
                  <TakeawayList takeaways={takeaways} />
                </div>
              </>
            )}
            {resources.length > 0 && (
              <div className={takeaways.length > 0 ? "mt-6 border-t border-border-light pt-5" : ""}>
                <ArticleResourceList resources={resources} onOpen={onOpenResource} bare />
              </div>
            )}
          </CardFrame>
        );
      default:
        return null;
    }
  };

  const showBar = card.kind !== "cover" || isFinal;

  return (
    <div
      data-testid="article-cards"
      className="flex h-full min-h-0 flex-col bg-background-secondary"
    >
      <div className="flex-shrink-0 px-[14px] pt-3 md:px-6">
        <div className="mx-auto flex w-full max-w-[420px] items-center gap-3 md:max-w-[640px]">
          <div
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={index + 1}
            aria-valuetext={t("tracks2.article.cardProgress", { current: index + 1, total })}
            className="flex flex-1 gap-1"
          >
            {cards.map((c, i) => (
              <span
                key={c.key}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= index ? "bg-primary-500" : "bg-neutral-300"
                }`}
              />
            ))}
          </div>
          <span
            aria-hidden
            data-testid="article-cards-counter"
            className="text-xs font-medium tabular-nums text-typography-600"
          >
            {index + 1} / {total}
          </span>
        </div>
      </div>

      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipeRef.current = null)}
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto px-[14px] py-4 md:px-6 md:py-8"
      >
        <AnimatePresence mode="wait" initial={false} custom={directionRef.current}>
          <motion.div
            key={card.key}
            data-testid={`article-card-${card.kind}`}
            custom={directionRef.current}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reduceMotion ? 0.12 : 0.2, ease: "easeOut" }}
          >
            {renderCard()}
          </motion.div>
        </AnimatePresence>
      </div>

      {showBar && (
        <div className="flex-shrink-0 px-[14px] pb-4 pt-2 md:px-6">
          <div className="mx-auto flex w-full max-w-[420px] items-center gap-3 md:max-w-[640px]">
            {index > 0 && (
              <button
                type="button"
                onClick={goPrev}
                aria-label={t("tracks2.player.prev")}
                className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-border-light bg-white text-lg text-typography-800 transition-colors hover:bg-neutral-50"
              >
                <span aria-hidden>←</span>
              </button>
            )}
            <div className="flex flex-1 justify-end">
              {!isFinal ? (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canGoNext}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-40 md:w-auto"
                >
                  {blockedByQuestion ? (
                    t("tracks2.article.answerQuestionToContinue")
                  ) : (
                    <>
                      {t("tracks2.player.next")}
                      <span aria-hidden>→</span>
                    </>
                  )}
                </button>
              ) : marked ? (
                <div className="flex w-full items-center justify-end gap-3">
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-success-800">
                    <TickGreenBackground className="h-4 w-4" />
                    {t("tracks2.article.read")}
                  </span>
                  {onRequestNext && (
                    <button
                      type="button"
                      onClick={onRequestNext}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
                    >
                      {t("common.continue")}
                      <span aria-hidden>→</span>
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onMarkRead}
                  disabled={!canMark || isMarking}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-40 md:w-auto"
                >
                  {markLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
