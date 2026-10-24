import { FC, ReactNode, useState } from "react";

import { useTranslation } from "react-i18next";

import { formatMoment } from "../cards/AskLayer";
import { AllyPresence } from "../presence/AllyPresence";

import type { GuideMemoryRef } from "../contract/wire";
import type { MessageEntry } from "../state/guideFeedReducer";

const paragraphs = (text: string): string[] =>
  text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);

/**
 * Ally's voice (plan §5.4): unbubbled editorial serif with the orb glyph in
 * the margin. The glyph pulses only while this message streams. Text streams
 * by appending words, never a typewriter (presence spec §4 rule 6).
 */
export const AllyProse: FC<{
  entry: MessageEntry;
  showLabel?: boolean;
  /** Thumbs under the message (signed-in, NORMAL mode, model text only). */
  feedback?: MessageFeedbackProps | null;
}> = ({ entry, showLabel, feedback }) => {
  const { t } = useTranslation();
  const streaming = entry.status === "streaming";
  return (
    <div className="g-rise group flex gap-3" data-testid={`ally-${entry.id}`}>
      <div className="pt-[7px]">
        <AllyPresence state={streaming ? "speaking" : "still"} size={14} />
      </div>
      <div className="min-w-0 flex-1">
        {showLabel && (
          <p className="g-label mb-1 text-[var(--g-ally-label)]">{t("guide.header.allyLabel")}</p>
        )}
        <div
          className="g-prose flex flex-col gap-3 whitespace-pre-wrap break-words"
          aria-busy={streaming}
        >
          {paragraphs(entry.text).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {streaming && !entry.text && <span className="g-caption">…</span>}
        </div>
        {entry.interrupted && <p className="g-caption mt-1">{t("guide.message.interrupted")}</p>}
        {entry.memoryRefs && entry.memoryRefs.length > 0 && (
          <MemoryProvenance refs={entry.memoryRefs} />
        )}
        {feedback && !streaming && <MessageFeedback {...feedback} />}
      </div>
    </div>
  );
};

export interface MessageFeedbackProps {
  rating: 1 | -1 | null;
  /** The comment after a thumbs-down was sent. */
  commented: boolean;
  failed: boolean;
  /** Always shown on Ally's latest message; on hover or focus for the rest. */
  prominent: boolean;
  /** Given on an earlier visit: shown as given, without a fresh "Thanks". */
  seeded?: boolean;
  onRate: (rating: 1 | -1, comment?: string) => void;
}

const Thumb: FC<{ down?: boolean }> = ({ down }) => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    aria-hidden="true"
    style={down ? { transform: "rotate(180deg)" } : undefined}
  >
    <path
      d="M5 7v6.5H2.5V7H5zm0 0l2.6-4.6c.3-.5 1-.6 1.4-.2.3.3.4.7.3 1.1L8.7 6H12c.8 0 1.4.8 1.2 1.6l-1 4.6c-.1.7-.7 1.3-1.4 1.3H5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Was this helpful? Thumbs on Ally's messages, an explicit signal the team
 * reviews (Stacks: "Collect User Feedback to Evaluate Agent Performance").
 * Quiet: shown on the latest message, on hover or focus for the others. A
 * thumbs-down offers one optional line on what missed.
 */
export const MessageFeedback: FC<MessageFeedbackProps> = ({
  rating,
  commented,
  failed,
  prominent,
  seeded = false,
  onRate,
}) => {
  const { t } = useTranslation();
  const [comment, setComment] = useState("");
  const [askingWhy, setAskingWhy] = useState(false);
  const thumb = (value: 1 | -1, label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={rating === value}
      onClick={() => {
        onRate(value);
        setAskingWhy(value === -1);
      }}
      className={`flex h-9 w-9 items-center justify-center rounded-[10px] max-md:h-11 max-md:w-11 ${
        rating === value
          ? "bg-[var(--g-learner-bubble)] text-[var(--g-ink)]"
          : "text-[var(--g-ink-faint)] hover:text-[var(--g-ink-soft)]"
      }`}
    >
      <Thumb down={value === -1} />
    </button>
  );
  return (
    <div
      className={`mt-1 flex flex-col gap-1 ${
        prominent || rating !== null
          ? ""
          : "opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
      }`}
      data-testid="message-feedback"
    >
      <div className="flex items-center gap-1">
        {thumb(1, t("guide.message.helpful"))}
        {thumb(-1, t("guide.message.notHelpful"))}
        {failed && <span className="g-caption ml-1">{t("guide.message.feedbackFailed")}</span>}
        {rating !== null && !failed && !askingWhy && !seeded && (
          <span className="g-caption ml-1">{t("guide.message.feedbackThanks")}</span>
        )}
      </div>
      {askingWhy && rating === -1 && !commented && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={event => {
            event.preventDefault();
            if (!comment.trim()) return;
            onRate(-1, comment);
            setAskingWhy(false);
          }}
        >
          <label className="sr-only" htmlFor="guide-feedback-why">
            {t("guide.message.whyLabel")}
          </label>
          <input
            id="guide-feedback-why"
            value={comment}
            maxLength={1000}
            onChange={event => setComment(event.target.value)}
            placeholder={t("guide.message.whyPlaceholder")}
            className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-card)] px-3 font-secondary text-base text-[var(--g-ink)] outline-none placeholder:text-[var(--g-ink-faint)] focus:border-[var(--g-ink-faint)]"
          />
          <button
            type="submit"
            disabled={!comment.trim()}
            className="min-h-11 rounded-[10px] border border-[var(--g-line)] px-3 font-primary text-sm text-[var(--g-ink)] disabled:opacity-50"
          >
            {t("guide.message.whySend")}
          </button>
          <button
            type="button"
            onClick={() => setAskingWhy(false)}
            className="min-h-11 px-2 font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2"
          >
            {t("guide.common.dismiss")}
          </button>
        </form>
      )}
    </div>
  );
};

/** Where a remembered fact came from (plan §5.1 principle 6). */
export const MemoryProvenance: FC<{ refs: GuideMemoryRef[] }> = ({ refs }) => {
  const { t } = useTranslation();
  return (
    <p className="g-caption mt-2">
      {t("guide.message.remembered", { from: refs.map(ref => ref.label).join(", ") })}
    </p>
  );
};

/** The learner's own words: right-aligned bubble in a blue tint (plan §5.4). */
export const LearnerBubble: FC<{
  entry: MessageEntry;
  onRetry?: (entry: MessageEntry) => void;
}> = ({ entry, onRetry }) => {
  const { t } = useTranslation();
  return (
    <div className="g-rise flex flex-col items-end gap-1" data-testid={`learner-${entry.id}`}>
      {entry.anchor?.quote ? (
        <p className="g-caption max-w-[85%] truncate">
          {t("guide.message.about", { quote: entry.anchor.quote })}
        </p>
      ) : typeof entry.anchor?.timestampSec === "number" ? (
        <p className="g-caption max-w-[85%]">
          {t("guide.message.aboutMoment", { time: formatMoment(entry.anchor.timestampSec) })}
        </p>
      ) : null}
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-[var(--g-learner-edge)] bg-[var(--g-learner-bubble)] px-4 py-2.5 font-secondary text-[17px] leading-[26px] text-[var(--g-ink)] ${
          entry.status === "sending" ? "opacity-80" : ""
        }`}
      >
        {entry.text}
      </div>
      {entry.status === "queued" && <p className="g-caption">{t("guide.message.queued")}</p>}
      {entry.status === "failed" && (
        <p className="g-caption flex items-center gap-2">
          {t("guide.message.notSent")}
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(entry)}
              className="min-h-6 font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2 max-md:min-h-11"
            >
              {t("guide.common.retry")}
            </button>
          )}
        </p>
      )}
    </div>
  );
};

/** A small neutral line from the system. Never a toast that hides content (plan §5.4). */
export const SystemCaption: FC<{ children: ReactNode; testId?: string }> = ({
  children,
  testId,
}) => (
  <p className="g-caption g-rise text-center" data-testid={testId}>
    {children}
  </p>
);

/**
 * Ally is working: the orb thinks, and after 600 ms a caption names what
 * Ally is doing; after 8 s Ally says it is taking a moment (plan §5.1).
 */
export const ThinkingLine: FC<{ caption: string | null; showCaption: boolean; slow: boolean }> = ({
  caption,
  showCaption,
  slow,
}) => {
  const { t } = useTranslation();
  const text = slow
    ? t("guide.presence.slow")
    : showCaption
      ? (caption ?? t("guide.presence.thinking"))
      : null;
  return (
    <div className="flex items-center gap-3" data-testid="thinking-line" role="status">
      <AllyPresence state="thinking" size={14} />
      <span className="g-caption" aria-live="polite">
        {text ?? <span className="sr-only">{t("guide.presence.thinking")}</span>}
      </span>
    </div>
  );
};
