import { FC, ReactNode, Ref, useId } from "react";

import { useTranslation } from "react-i18next";

import { CardGlyph, CheckGlyph } from "./CardGlyph";

import type { ItemGlyph } from "./itemTypes";
import type { GuideCardState } from "../contract/wire";
import type { CelebrationTier } from "../state/atmosphere";

export interface CardAction {
  label: string;
  onClick: () => void;
  /** Where it opens, in words ("Opens on the right"). */
  hint?: string | null;
  disabled?: boolean;
}

export interface CardFrameProps {
  state: GuideCardState;
  /** Course material is a raised card; Ally's additions wear the clay wash. */
  surface: "course" | "ally";
  glyph?: ItemGlyph;
  typeWord: string;
  meta?: string | null;
  title: string;
  framing?: string | null;
  /** Overrides the state word (e.g. "Reading · 2 min left", "Being graded"). */
  stateLabel?: string | null;
  primary?: CardAction | null;
  secondary?: CardAction | null;
  /** The done receipt's line after the ✓ ("Read · 5 min"). */
  receipt?: string | null;
  failure?: { message: string; onRetry?: () => void; classicHref?: string | null } | null;
  celebration?: CelebrationTier;
  primaryRef?: Ref<HTMLButtonElement>;
  footer?: ReactNode;
  /** The player, while the card is active inline. */
  children?: ReactNode;
  testId?: string;
}

const STATE_WORD: Record<GuideCardState, string | null> = {
  announced: null,
  ready: "guide.card.state.ready",
  active: "guide.card.state.open",
  done: "guide.card.state.done",
  failed: "guide.card.state.failed",
  superseded: "guide.card.state.superseded",
  dismissed: "guide.card.state.skipped",
};

/**
 * One anatomy for every card (card grammar §1): glyph and type word with the
 * meta, a state shown as a glyph plus a word, the title, one framing line,
 * one primary action with a verb, at most one quiet secondary. The lifecycle
 * is announced (skeleton) → ready → active → done, with failed beside it.
 * Primary actions are ink, never blue: the dock is the only blue button.
 */
export const CardFrame: FC<CardFrameProps> = ({
  state,
  surface,
  glyph,
  typeWord,
  meta,
  title,
  framing,
  stateLabel,
  primary,
  secondary,
  receipt,
  failure,
  celebration = "quiet",
  primaryRef,
  footer,
  children,
  testId,
}) => {
  const { t } = useTranslation();
  const titleId = useId();
  const typeId = useId();
  const isAlly = surface === "ally";
  const surfaceClass = isAlly
    ? "bg-[var(--g-ally-wash)] border-[var(--g-ally-edge)]"
    : "bg-[var(--g-card)] border-[var(--g-line)]";

  if (state === "announced") {
    return (
      <article
        aria-busy="true"
        aria-labelledby={typeId}
        data-testid={testId}
        data-state="announced"
        className={`rounded-2xl border p-4 sm:p-5 ${surfaceClass}`}
      >
        <TypeRow id={typeId} glyph={glyph} typeWord={typeWord} meta={meta} isAlly={isAlly} />
        <div className="g-skeleton mt-3 h-5 w-2/3" />
        <div className="g-skeleton mt-2 h-4 w-full" />
      </article>
    );
  }

  const word = stateLabel ?? (STATE_WORD[state] ? t(STATE_WORD[state] as string) : null);

  if (state === "done" || state === "superseded" || state === "dismissed") {
    return (
      <article
        aria-labelledby={titleId}
        data-testid={testId}
        data-state={state}
        data-celebration={celebration}
        className="g-rise flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-[var(--g-line)] bg-[var(--g-card)] px-4 py-3"
      >
        {state !== "dismissed" && <CheckGlyph className="text-[var(--g-progress)]" />}
        <span id={titleId} className="font-primary text-[15px] font-semibold text-[var(--g-ink)]">
          {title}
        </span>
        <span className="g-caption">{receipt ?? word}</span>
        {secondary && (
          <button
            type="button"
            onClick={secondary.onClick}
            className="ml-auto min-h-6 font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2 max-md:min-h-11"
          >
            {secondary.label}
          </button>
        )}
        {children}
      </article>
    );
  }

  return (
    <article
      aria-labelledby={titleId}
      aria-describedby={typeId}
      data-testid={testId}
      data-state={state}
      className={`g-rise rounded-2xl border p-4 sm:p-5 ${surfaceClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        <TypeRow id={typeId} glyph={glyph} typeWord={typeWord} meta={meta} isAlly={isAlly} />
        {word && (
          <span className="g-caption shrink-0 whitespace-nowrap" data-testid="card-state-word">
            {word}
          </span>
        )}
      </div>
      <h3 id={titleId} className="g-title mt-2 text-[var(--g-ink)]">
        {title}
      </h3>
      {framing && (
        <p className="mt-1 font-secondary text-base leading-6 text-[var(--g-ink-soft)]">
          {framing}
        </p>
      )}

      {state === "failed" && failure && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="g-prose text-base">{failure.message}</p>
          <div className="flex flex-wrap items-center gap-3">
            {failure.onRetry && (
              <button
                type="button"
                onClick={failure.onRetry}
                className="min-h-10 rounded-[10px] bg-[var(--g-action)] px-4 font-primary text-[15px] font-semibold text-[var(--g-on-action)] max-md:min-h-11"
              >
                {t("guide.common.retry")}
              </button>
            )}
            {failure.classicHref && (
              <a
                href={failure.classicHref}
                className="font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2"
              >
                {t("guide.common.openClassic")}
              </a>
            )}
          </div>
        </div>
      )}

      {children}

      {state !== "failed" && (primary || secondary) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {primary && (
            <button
              ref={primaryRef}
              type="button"
              onClick={primary.onClick}
              disabled={primary.disabled}
              className="inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-[var(--g-action)] px-4 font-primary text-[15px] font-semibold text-[var(--g-on-action)] transition-opacity disabled:opacity-50 max-md:min-h-11"
            >
              {primary.label}
              <span aria-hidden="true">→</span>
            </button>
          )}
          {secondary && (
            <button
              type="button"
              onClick={secondary.onClick}
              className="min-h-6 font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2 max-md:min-h-11"
            >
              {secondary.label}
            </button>
          )}
          {primary?.hint && <span className="g-caption ml-auto">{primary.hint}</span>}
        </div>
      )}
      {footer}
    </article>
  );
};

const TypeRow: FC<{
  id: string;
  glyph?: ItemGlyph;
  typeWord: string;
  meta?: string | null;
  isAlly: boolean;
}> = ({ id, glyph, typeWord, meta, isAlly }) => (
  <p
    id={id}
    className={`flex min-w-0 flex-wrap items-center gap-x-1.5 ${isAlly ? "text-[var(--g-ally-label)]" : "text-[var(--g-ink-faint)]"}`}
  >
    {isAlly ? (
      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[var(--orb-core)]" />
    ) : (
      glyph && <CardGlyph glyph={glyph} />
    )}
    <span className="g-label">{typeWord}</span>
    {meta && <span className="g-caption normal-case tracking-normal">· {meta}</span>}
  </p>
);
