import { FC, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import type { JourneyNextStep } from "../contract/bootstrap";
import type { ReplyVerb } from "../state/atmosphere";
import type { FailureAction } from "../state/failureStates";

/** Plan Appendix A: `message.maxChars`. */
export const MESSAGE_MAX_CHARS = 2_000;
/** The counter appears once this few characters remain. */
const COUNTER_FROM = 200;

/**
 * The one blue button above the composer: "Continue · Reflecting feelings ·
 * 4 min" (plan §5.7). The only filled, saturated blue on screen; hidden at
 * steer level 0, in hushed and still rooms, and when nothing is next.
 */
export const NextStepDock: FC<{
  nextStep: JourneyNextStep;
  disabled?: boolean;
  onContinue: () => void;
}> = ({ nextStep, disabled, onContinue }) => {
  const { t } = useTranslation();
  const parts = [
    t("guide.dock.continue"),
    nextStep.title,
    nextStep.minutes ? t("guide.card.meta.minutes", { count: nextStep.minutes }) : null,
  ].filter(Boolean);
  return (
    <button
      type="button"
      onClick={onContinue}
      disabled={disabled}
      data-testid="next-step-dock"
      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--g-dock)] px-4 font-primary text-[15px] font-semibold text-[var(--g-on-dock)] transition-colors hover:bg-[var(--g-dock-hover)] disabled:opacity-60 md:text-base"
    >
      <span className="truncate">{parts.join(" · ")}</span>
      <span aria-hidden="true">→</span>
    </button>
  );
};

/** Quiet chips: standard verbs, plus "That's not what I meant" after Ally answers (plan §5.7). */
export const ReplyVerbs: FC<{
  verbs: ReplyVerb[];
  disabled?: boolean;
  onVerb: (verb: ReplyVerb) => void;
}> = ({ verbs, disabled, onVerb }) => {
  const { t } = useTranslation();
  if (!verbs.length) return null;
  return (
    <div
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
      role="group"
      aria-label={t("guide.verbs.label")}
      data-testid="reply-verbs"
    >
      {verbs.map(verb => (
        <button
          key={verb}
          type="button"
          disabled={disabled}
          onClick={() => onVerb(verb)}
          className="min-h-8 shrink-0 rounded-lg border border-[var(--g-line)] bg-[var(--g-card)] px-3 font-primary text-sm text-[var(--g-ink-soft)] transition-colors hover:border-[var(--g-ink-faint)] hover:text-[var(--g-ink)] disabled:opacity-50 max-md:min-h-11"
        >
          {t(`guide.verbs.${verb}`)}
        </button>
      ))}
    </div>
  );
};

/** "Article · Back to it": an item is open in the Shelf or Theatre while the learner is in the conversation. */
export const NowPlayingBar: FC<{ label: string; onBack: () => void }> = ({ label, onBack }) => {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-h-11 items-center justify-between gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-card)] px-3"
      data-testid="now-playing"
    >
      <span className="truncate font-primary text-sm text-[var(--g-ink)]">{label}</span>
      <button
        type="button"
        onClick={onBack}
        className="shrink-0 font-primary text-sm font-semibold text-[var(--g-progress)] underline-offset-2 hover:underline"
      >
        {t("guide.card.backToIt")}
      </button>
    </div>
  );
};

export interface FailureNoticeProps {
  /** Already-translated line in Ally's voice. */
  message: string;
  action: FailureAction;
  onRetry?: () => void;
  onClassic?: () => void;
  onSignIn?: () => void;
  onMyCourses?: () => void;
  onDismiss?: () => void;
}

/**
 * A failure, said by Ally with a way forward (plan §5.12; Stacks: "Apologetic
 * Language and Resolution Paths in Agent Failures"). Never red, never a code.
 */
export const FailureNotice: FC<FailureNoticeProps> = ({
  message,
  action,
  onRetry,
  onClassic,
  onSignIn,
  onMyCourses,
  onDismiss,
}) => {
  const { t } = useTranslation();
  const button =
    "min-h-9 rounded-[10px] bg-[var(--g-action)] px-3 font-primary text-sm font-semibold text-[var(--g-on-action)] max-md:min-h-11";
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-card)] px-3 py-2"
      role="status"
      data-testid="failure-notice"
    >
      <p className="min-w-0 flex-1 font-secondary text-base text-[var(--g-ink)]">{message}</p>
      {action === "retry" && onRetry && (
        <button type="button" className={button} onClick={onRetry}>
          {t("guide.common.retry")}
        </button>
      )}
      {action === "classic" && onClassic && (
        <button type="button" className={button} onClick={onClassic}>
          {t("guide.common.openClassic")}
        </button>
      )}
      {action === "signIn" && onSignIn && (
        <button type="button" className={button} onClick={onSignIn}>
          {t("guide.signIn.button")}
        </button>
      )}
      {action === "myCourses" && onMyCourses && (
        <button type="button" className={button} onClick={onMyCourses}>
          {t("guide.common.myCourses")}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("guide.common.dismiss")}
          className="min-h-9 min-w-9 font-primary text-lg text-[var(--g-ink-faint)] max-md:min-h-11 max-md:min-w-11"
        >
          ×
        </button>
      )}
    </div>
  );
};

/**
 * Type or talk; typing is always available (plan §5.7). Enter sends, Shift
 * and Enter adds a line. Over 2,000 characters the composer says so and won't
 * send (plan §11 D-7). Sending is held while Ally is replying, never typing.
 */
export const Composer: FC<{
  disabled?: boolean;
  sendBlocked?: boolean;
  onSend: (text: string) => void;
  /** Bumped to pull focus into the composer ("Type or say it"). */
  focusToken?: number;
}> = ({ disabled, sendBlocked, onSend, focusToken }) => {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const remaining = MESSAGE_MAX_CHARS - text.length;
  const tooLong = remaining < 0;
  const canSend = text.trim().length > 0 && !tooLong && !disabled && !sendBlocked;

  useEffect(() => {
    if (focusToken) ref.current?.focus();
  }, [focusToken]);

  // Grow with the text, up to about six lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1" data-testid="composer">
      <div className="flex items-end gap-2 rounded-2xl border border-[var(--g-line)] bg-[var(--g-card)] p-2 focus-within:border-[var(--g-ink-faint)]">
        <label htmlFor="guide-composer" className="sr-only">
          {t("guide.composer.label")}
        </label>
        <textarea
          id="guide-composer"
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={event => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("guide.composer.placeholder")}
          aria-invalid={tooLong}
          aria-describedby={remaining <= COUNTER_FROM ? "guide-composer-count" : undefined}
          className="max-h-[168px] min-h-10 flex-1 resize-none bg-transparent px-2 py-2 font-secondary text-[17px] leading-6 text-[var(--g-ink)] outline-none placeholder:text-[var(--g-ink-faint)]"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label={t("guide.composer.send")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--g-action)] text-[var(--g-on-action)] transition-opacity disabled:opacity-40 max-md:h-11 max-md:w-11"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              d="M3 8h9M8.5 4.5L12 8l-3.5 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {remaining <= COUNTER_FROM && (
        <p id="guide-composer-count" className="g-caption px-2" aria-live="polite">
          {tooLong
            ? t("guide.composer.tooLong", { max: MESSAGE_MAX_CHARS.toLocaleString() })
            : t("guide.composer.left", { count: remaining })}
        </p>
      )}
    </form>
  );
};
