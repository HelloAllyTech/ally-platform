import { FC, ReactNode } from "react";

import { useTranslation } from "react-i18next";

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
export const AllyProse: FC<{ entry: MessageEntry; showLabel?: boolean }> = ({
  entry,
  showLabel,
}) => {
  const { t } = useTranslation();
  const streaming = entry.status === "streaming";
  return (
    <div className="g-rise flex gap-3" data-testid={`ally-${entry.id}`}>
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
      </div>
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
      {entry.anchor?.quote && (
        <p className="g-caption max-w-[85%] truncate">
          {t("guide.message.about", { quote: entry.anchor.quote })}
        </p>
      )}
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
