import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Locked, Timer } from "@icons";

import { en } from "@constants";
import { AnswerBuilderDecisionRequest, BuilderDecision, BuilderDecisionOption } from "@types";

import {
  isTypingTarget,
  optionIndexForKey,
  orderOptions,
  recommendedOption,
  splitRationale,
} from "../decisionFeed";
import {
  ARMING_DELAY_MS,
  WAIT_EMPHASIS_MS,
  formatWait,
  isOneWay,
  isStale,
  waitedMs,
} from "./roomFormat";

export type NowAnswer = Omit<AnswerBuilderDecisionRequest, "id" | "client" | "msToDecide">;

export interface NowCardProps {
  decision: BuilderDecision;
  sessionLabel: string;
  now: number;
  /** Owns the keyboard (digits, Enter, C, Esc). False while a sheet or palette has it. */
  active: boolean;
  /** Show key hints: only for a fine pointer. */
  showKeys: boolean;
  /** Phone layout: rationale collapsed, options full-width and tall. */
  compact: boolean;
  /** Raised right after you answered this session: it goes next. */
  followUp: boolean;
  /** Answered on another surface while on screen. */
  elsewhere: string | null;
  error: string | null;
  disabled: boolean;
  canPutBack: boolean;
  onSend: (answer: NowAnswer, label: string, oneWay: boolean) => void;
  onLater: () => void;
  onOpenSession: () => void;
  onPutBack: () => void;
  onRetry: () => void;
  /** So the page can turn swipe-to-move off while an option is armed. */
  onArmedChange?: (armed: boolean) => void;
}

const strings = en.builder.room.card;
const kindLabels = en.builder.decisions.kinds;

/**
 * One decision, the hero of the page.
 *
 * The question is the largest text on the page and the recommended option is
 * the only filled, coloured control. A reversible option sends on one press —
 * the page holds it for the undo window — while a one-way option arms on the
 * first press, says what it will do in place, and only counts a second press
 * after a short delay, so a double-tap can't merge anything. Scrolling or
 * pressing anywhere else disarms it.
 */
export const NowCard: React.FC<NowCardProps> = ({
  decision,
  sessionLabel,
  now,
  active,
  showKeys,
  compact,
  followUp,
  elsewhere,
  error,
  disabled,
  canPutBack,
  onSend,
  onLater,
  onOpenSession,
  onPutBack,
  onRetry,
  onArmedChange,
}) => {
  const options = useMemo(() => orderOptions(decision.options), [decision.options]);
  const recommended = useMemo(() => recommendedOption(options), [options]);
  const rationale = useMemo(() => splitRationale(decision.rationale), [decision.rationale]);
  const isMulti = decision.selection === "multi";
  const textOnly = options.length === 0;

  const [picked, setPicked] = useState<string[]>([]);
  const [armed, setArmed] = useState<{ id: string; at: number } | null>(null);
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const customRef = useRef<HTMLTextAreaElement>(null);
  const armedRef = useRef<HTMLButtonElement>(null);

  // A new card starts clean; keyed on the id because polling hands back a new object.
  useEffect(() => {
    setPicked(isMulti ? options.filter(option => option.recommended).map(option => option.id) : []);
    setArmed(null);
    setCustom("");
    setShowCustom(false);
    setShowWhy(false);
    setShowContext(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision.id]);

  // `elsewhere` is "" when nobody is named; null means not decided elsewhere.
  const decidedElsewhere = elsewhere !== null;
  const locked = disabled || decidedElsewhere;

  useEffect(() => {
    onArmedChange?.(Boolean(armed));
  }, [armed, onArmedChange]);

  const sendOption = useCallback(
    (option: BuilderDecisionOption) => {
      if (locked) return;
      setArmed(null);
      onSend({ selectedOptionIds: [option.id] }, option.label, isOneWay(option));
    },
    [locked, onSend],
  );

  /** First press arms and says what will happen; a second press after the delay confirms. */
  const armOrConfirm = useCallback(
    (option: BuilderDecisionOption) => {
      if (locked) return;
      if (armed?.id === option.id) {
        if (Date.now() - armed.at < ARMING_DELAY_MS) return;
        sendOption(option);
        return;
      }
      setPicked([option.id]);
      setArmed({ id: option.id, at: Date.now() });
      // A short tick where the browser supports it (Android). Never required.
      try {
        navigator.vibrate?.(10);
      } catch {
        // no haptics
      }
    },
    [armed, locked, sendOption],
  );

  const press = useCallback(
    (option: BuilderDecisionOption, viaClick: boolean) => {
      if (locked) return;
      if (isMulti) {
        setPicked(previous =>
          previous.includes(option.id)
            ? previous.filter(id => id !== option.id)
            : [...previous, option.id],
        );
        return;
      }
      if (isOneWay(option)) {
        armOrConfirm(option);
        return;
      }
      if (viaClick || picked[0] === option.id) {
        sendOption(option);
        return;
      }
      setPicked([option.id]);
    },
    [armOrConfirm, isMulti, locked, picked, sendOption],
  );

  const sendMulti = useCallback(() => {
    if (locked || !picked.length) return;
    const labels = options.filter(option => picked.includes(option.id)).map(option => option.label);
    onSend({ selectedOptionIds: picked }, labels.join(", "), false);
  }, [locked, onSend, options, picked]);

  const sendCustom = useCallback(() => {
    const words = custom.trim();
    if (locked || !words) return;
    onSend({ customValues: [words], message: words }, words, false);
  }, [custom, locked, onSend]);

  const sendDefault = useCallback(() => {
    if (isMulti) return sendMulti();
    if (textOnly) {
      customRef.current?.focus();
      return undefined;
    }
    const option = options.find(entry => entry.id === picked[0]) ?? recommended;
    if (!option) return undefined;
    if (isOneWay(option)) armOrConfirm(option);
    else sendOption(option);
    return undefined;
  }, [armOrConfirm, isMulti, options, picked, recommended, sendMulti, sendOption, textOnly]);

  // Scrolling, or pressing anywhere but the armed option, disarms: a tap that
  // ends a scroll must never land on an armed merge.
  useEffect(() => {
    if (!armed) return undefined;
    const disarm = () => setArmed(null);
    const onPointerDown = (event: PointerEvent) => {
      if (armedRef.current && armedRef.current.contains(event.target as Node)) return;
      disarm();
    };
    window.addEventListener("scroll", disarm, { passive: true, capture: true });
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", disarm, { capture: true });
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [armed]);

  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const index = optionIndexForKey(event.key);
      if (index !== null) {
        const option = options[index];
        if (!option) return;
        event.preventDefault();
        press(option, false);
        return;
      }
      if (event.key === "Enter") {
        if ((event.target as HTMLElement)?.closest?.("button, a")) return;
        event.preventDefault();
        sendDefault();
        return;
      }
      if (event.key === "Escape" && armed) {
        setArmed(null);
        return;
      }
      if ((event.key === "c" || event.key === "C") && decision.allowCustom && !textOnly) {
        event.preventDefault();
        setShowCustom(true);
        setTimeout(() => customRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, armed, decision.allowCustom, options, press, sendDefault, textOnly]);

  const waited = waitedMs(decision.waitingSince, now);
  const hot = waited > WAIT_EMPHASIS_MS;
  const stale = isStale(decision, now);
  const kindLine = [
    kindLabels[decision.kind] ?? decision.kind,
    decision.sessionStatus === "BUILDING" && decision.kind === "question"
      ? strings.duringBuild
      : null,
    decision.kind === "question" && decision.sessionStatus === "INTERVIEWING"
      ? strings.interview
      : null,
    isMulti ? strings.chooseAny : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const why = rationale.why ?? null;
  const basedOn = rationale.basis ?? null;
  const hasWhy = Boolean(why || basedOn || decision.context.length);

  return (
    <article
      className={[
        "rounded border border-border-light bg-white px-4 py-4 transition-opacity sm:px-6 sm:py-5",
        decidedElsewhere ? "opacity-50" : "",
      ].join(" ")}
      aria-labelledby={`now-q-${decision.id}`}
      data-testid="now-card"
    >
      <header className="flex items-baseline gap-3 text-sm text-typography-600">
        <button
          type="button"
          className="min-w-0 truncate text-left hover:text-typography-900 hover:underline"
          onClick={onOpenSession}
        >
          <span className="mr-1.5 font-mono text-xs">{sessionLabel}</span>
          {decision.sessionTitle}
        </button>
        <span
          className={[
            "ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs tabular-nums",
            hot ? "font-semibold text-amber-700" : "text-typography-500",
          ].join(" ")}
        >
          {hot && <Timer className="h-3.5 w-3.5" aria-hidden />}
          {strings.waiting(formatWait(waited))}
        </span>
      </header>

      <p className="mt-4 flex flex-wrap items-center gap-2 text-xs tracking-wide text-typography-500">
        {followUp && (
          <span className="font-semibold text-typography-900">
            {strings.nextFrom(sessionLabel)}
          </span>
        )}
        <span>{kindLine}</span>
      </p>
      <h2
        id={`now-q-${decision.id}`}
        className="mt-1.5 text-balance text-[22px] font-normal leading-7 text-typography-900 sm:text-[28px] sm:leading-9"
      >
        {decision.prompt}
      </h2>
      <p className="mt-2 text-sm text-typography-600">
        <span className="font-semibold text-typography-900">{strings.blocked}</span>{" "}
        {decision.blocked}
      </p>

      {stale && (
        <p className="mt-3 flex flex-wrap items-center gap-3 bg-neutral-100 px-3 py-2 text-sm text-typography-700">
          <Timer className="h-4 w-4" aria-hidden />
          <span>{strings.stale(Math.floor(waited / 86_400_000))}</span>
          {canPutBack && (
            <button type="button" className="underline underline-offset-2" onClick={onPutBack}>
              {strings.putBackInstead}
            </button>
          )}
        </p>
      )}

      {decidedElsewhere && (
        <p role="status" className="mt-3 bg-neutral-100 px-3 py-2 text-sm font-medium">
          {strings.elsewhere(elsewhere)}
        </p>
      )}

      {textOnly ? (
        <div className="mt-5">
          <label className="sr-only" htmlFor={`now-text-${decision.id}`}>
            {strings.textPlaceholder}
          </label>
          <textarea
            id={`now-text-${decision.id}`}
            ref={customRef}
            className="min-h-[88px] w-full resize-y border-0 border-b border-neutral-500 bg-neutral-100 px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            placeholder={strings.textPlaceholder}
            value={custom}
            disabled={locked}
            onChange={event => setCustom(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendCustom();
              }
            }}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className="min-h-[40px] bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              disabled={locked || !custom.trim()}
              onClick={sendCustom}
            >
              {strings.send}
            </button>
          </div>
        </div>
      ) : (
        <ol className="mt-5 flex flex-col gap-2" aria-label="Options">
          {options.map((option, index) => {
            const isPicked = picked.includes(option.id);
            const isArmed = armed?.id === option.id;
            const filled = option.recommended && !isMulti;
            return (
              <li key={option.id}>
                <button
                  ref={isArmed ? armedRef : undefined}
                  type="button"
                  disabled={locked}
                  aria-pressed={isPicked}
                  data-option={option.id}
                  onClick={() => press(option, true)}
                  className={[
                    "relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border px-4 text-left transition-colors",
                    showKeys ? "sm:grid-cols-[26px_minmax(0,1fr)_auto]" : "",
                    compact ? "min-h-[52px] py-3.5" : "min-h-[48px] py-3",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2",
                    "disabled:cursor-not-allowed",
                    filled
                      ? "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
                      : isPicked
                        ? "border-typography-900 bg-primary-50 ring-1 ring-typography-900"
                        : "border-neutral-500 bg-white hover:bg-neutral-100",
                    isArmed ? "ring-2 ring-typography-900 ring-offset-2" : "",
                  ].join(" ")}
                >
                  {showKeys && (
                    <kbd
                      className={[
                        "hidden h-5 min-w-5 items-center justify-center border px-1 font-mono text-[11px] sm:inline-flex",
                        filled
                          ? "border-white/60 text-white"
                          : "border-neutral-500 text-typography-600",
                      ].join(" ")}
                    >
                      {index + 1}
                    </kbd>
                  )}
                  <span className="min-w-0 font-medium">
                    {isMulti && (
                      <span
                        aria-hidden
                        className="mr-2 inline-flex h-4 w-4 items-center justify-center border border-current align-[-2px]"
                      >
                        {isPicked ? "✓" : ""}
                      </span>
                    )}
                    {isArmed ? (compact ? strings.tapAgain : strings.pressAgain) : option.label}
                  </span>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs">
                    {isOneWay(option) ? (
                      <>
                        <Locked className="h-3.5 w-3.5" aria-hidden />
                        {strings.oneWay}
                      </>
                    ) : option.recommended ? (
                      strings.recommended
                    ) : null}
                  </span>
                  {option.description && !isArmed && (
                    <span
                      className={[
                        "col-start-1 text-[13px]",
                        showKeys ? "sm:col-start-2" : "",
                        filled ? "text-white/90" : "text-typography-600",
                      ].join(" ")}
                    >
                      {option.description}
                    </span>
                  )}
                  {isArmed && option.consequence && (
                    <span
                      role="status"
                      className={[
                        "col-span-full mt-1 border-t border-current pt-1.5 text-[13px] font-medium",
                      ].join(" ")}
                    >
                      {option.consequence}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {isMulti && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="min-h-[40px] bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            disabled={locked || !picked.length}
            onClick={sendMulti}
          >
            {strings.sendSelected(picked.length)}
          </button>
        </div>
      )}

      {!textOnly && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {decision.allowCustom && !showCustom && (
            <button
              type="button"
              className="min-h-[32px] text-typography-700 underline underline-offset-2"
              onClick={() => {
                setShowCustom(true);
                setTimeout(() => customRef.current?.focus(), 0);
              }}
            >
              {strings.somethingElse}
              {showKeys && <kbd className="ml-1.5 font-mono text-[11px]">C</kbd>}
            </button>
          )}
          <button
            type="button"
            className="min-h-[32px] text-typography-700 underline underline-offset-2"
            onClick={onLater}
          >
            {strings.later}
            {showKeys && <kbd className="ml-1.5 font-mono text-[11px]">S</kbd>}
          </button>
          {decision.pullRequestUrl && (
            <a
              href={decision.pullRequestUrl}
              target="_blank"
              rel="noreferrer"
              className="min-h-[32px] text-typography-700 underline underline-offset-2"
            >
              {strings.openPullRequest}
            </a>
          )}
        </div>
      )}

      {showCustom && !textOnly && (
        <div className="mt-3">
          <label className="sr-only" htmlFor={`now-custom-${decision.id}`}>
            {strings.somethingElse}
          </label>
          <textarea
            id={`now-custom-${decision.id}`}
            ref={customRef}
            className="min-h-[72px] w-full resize-y border-0 border-b border-neutral-500 bg-neutral-100 px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            placeholder={decision.customPlaceholder ?? strings.customPlaceholder}
            value={custom}
            disabled={locked}
            onChange={event => setCustom(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendCustom();
              }
              if (event.key === "Escape") {
                setShowCustom(false);
                (event.target as HTMLElement).blur();
              }
            }}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              className="min-h-[40px] border border-typography-900 px-4 text-sm"
              onClick={() => setShowCustom(false)}
            >
              {strings.cancel}
            </button>
            <button
              type="button"
              className="min-h-[40px] border border-typography-900 px-4 text-sm disabled:opacity-50"
              disabled={locked || !custom.trim()}
              onClick={sendCustom}
            >
              {strings.send}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-3 border-l-[3px] border-red-600 bg-red-50 px-3 py-2 text-sm"
        >
          <span>{error}</span>
          <button
            type="button"
            className="border border-typography-900 px-3 py-1"
            onClick={onRetry}
          >
            {strings.retry}
          </button>
        </div>
      )}

      {hasWhy && (
        <div className="mt-5 max-w-[65ch] text-[13px] text-typography-600">
          {compact && !showWhy ? (
            <button
              type="button"
              className="min-h-[32px] underline underline-offset-2"
              aria-expanded={false}
              onClick={() => setShowWhy(true)}
            >
              {strings.whyToggle} ▸
            </button>
          ) : (
            <div className="flex flex-col gap-1">
              {why && (
                <p>
                  <span className="font-semibold text-typography-900">{strings.why}</span> {why}
                </p>
              )}
              <p>
                {basedOn && (
                  <>
                    <span className="font-semibold text-typography-900">{strings.basedOn}</span>{" "}
                    {basedOn}
                  </>
                )}
                {decision.context.length > 0 && (
                  <>
                    {basedOn ? " · " : ""}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      aria-expanded={showContext}
                      onClick={() => setShowContext(value => !value)}
                    >
                      {showContext ? strings.less : strings.more}
                    </button>
                  </>
                )}
              </p>
              {showContext && (
                <ul className="mt-1 list-disc pl-4">
                  {decision.context.map(line => (
                    <li key={line} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {showKeys && !textOnly && (
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-typography-500">
          <span>{strings.hints.pick(Math.min(options.length, 9))}</span>
          <span>{strings.hints.send}</span>
          <span>{strings.hints.later}</span>
          <span>{strings.hints.open}</span>
          <span>{strings.hints.keys}</span>
        </p>
      )}
    </article>
  );
};
