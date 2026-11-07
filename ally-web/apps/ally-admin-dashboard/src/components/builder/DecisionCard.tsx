import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Tag, TextArea, Tile } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { AnswerBuilderDecisionRequest, BuilderDecision, BuilderDecisionOption } from "@types";

import {
  isTypingTarget,
  optionIndexForKey,
  orderOptions,
  recommendedOption,
  splitRationale,
} from "../../pages/Builder/decisionFeed";

/** What the card sends back: the request body, minus the id the page already knows. */
export type DecisionAnswer = Omit<AnswerBuilderDecisionRequest, "id">;

export interface DecisionCardProps {
  decision: BuilderDecision;
  onAnswer: (answer: DecisionAnswer) => void;
  onSkip: () => void;
  onOpenSession: () => void;
  /** True while this card's answer is in flight; the card locks. */
  busy: boolean;
  /** "3m ago" — formatted by the page so the card stays free of date helpers. */
  waitingLabel: string;
  /** Whether this card owns the keyboard. False while a dialog or the shortcut list has it. */
  active?: boolean;
}

/** How many context lines show before the rest fold. */
const CONTEXT_SHOWN = 3;

const CATEGORY_TAG: Record<BuilderDecision["category"], "purple" | "teal" | "magenta"> = {
  what: "purple",
  how: "teal",
  issue: "magenta",
};

/**
 * One decision, laid out to be made in seconds.
 *
 * Everything a person needs is on the card in a fixed order — what is blocked,
 * the question, why it is being asked, the options with the recommendation
 * first — so the eye learns where to look and stops reading the layout. The
 * keyboard answers it: a digit picks, the same digit again (or Enter) sends,
 * Enter alone sends the recommendation, C writes a custom answer. A click
 * still works, but a feed cleared by mouse is a feed cleared slowly. The one
 * exception to "one press" is an option flagged `confirm` (merge, remove the
 * ceiling, stop the build): it is picked first and sent on a second press.
 *
 * The card never decides what an answer *means*; it posts the ids and words
 * and the server routes them. That keeps the card the same for a merge button
 * and a scope question, which is what lets a person clear both without
 * switching tools.
 */
export const DecisionCard: React.FC<DecisionCardProps> = ({
  decision,
  onAnswer,
  onSkip,
  onOpenSession,
  busy,
  waitingLabel,
  active = true,
}) => {
  const strings = en.builder.decisions;
  const options = useMemo(() => orderOptions(decision.options), [decision.options]);
  const recommended = useMemo(() => recommendedOption(options), [options]);
  const rationale = useMemo(() => splitRationale(decision.rationale), [decision.rationale]);
  const isMulti = decision.selection === "multi";

  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [showAllContext, setShowAllContext] = useState(false);
  const customRef = useRef<HTMLTextAreaElement>(null);

  // A new card starts clean. Keyed on the id, not the object: polling hands
  // back a fresh object for the same decision every few seconds.
  useEffect(() => {
    setPicked([]);
    setCustom("");
    setShowAllContext(false);
  }, [decision.id]);

  const minSelections = decision.minSelections ?? 1;
  const locked = busy;

  const send = useCallback(
    (answer: DecisionAnswer) => {
      if (locked) return;
      onAnswer(answer);
    },
    [locked, onAnswer],
  );

  const sendOption = useCallback(
    (option: BuilderDecisionOption) => send({ selectedOptionIds: [option.id] }),
    [send],
  );

  const sendCustom = useCallback(() => {
    const words = custom.trim();
    if (!words) return;
    send({
      ...(isMulti && picked.length ? { selectedOptionIds: picked } : {}),
      customValues: [words],
      message: words,
    });
  }, [custom, isMulti, picked, send]);

  const sendMulti = useCallback(() => {
    const words = custom.trim();
    if (picked.length + (words ? 1 : 0) < minSelections) return;
    send({
      ...(picked.length ? { selectedOptionIds: picked } : {}),
      ...(words ? { customValues: [words], message: words } : {}),
    });
  }, [custom, minSelections, picked, send]);

  const sendNone = useCallback(() => send({ none: true }), [send]);

  /** The single-select "pick" — highlighted on first press, sent on the second. */
  const pickSingle = useCallback(
    (option: BuilderDecisionOption) => {
      if (picked[0] === option.id) {
        sendOption(option);
        return;
      }
      setPicked([option.id]);
    },
    [picked, sendOption],
  );

  /**
   * A click sends — except on an option that is hard to take back, where it
   * picks first and the second click sends. The keyboard already works that way
   * for every option; this gives the mouse the same deliberate step only where a
   * slip costs something (a merge, an uncapped budget, a stopped build).
   */
  const clickSingle = useCallback(
    (option: BuilderDecisionOption) => {
      if (option.confirm) pickSingle(option);
      else sendOption(option);
    },
    [pickSingle, sendOption],
  );

  const toggleMulti = useCallback((option: BuilderDecisionOption) => {
    setPicked(prev =>
      prev.includes(option.id) ? prev.filter(id => id !== option.id) : [...prev, option.id],
    );
  }, []);

  /**
   * Enter: the pick if there is one, otherwise the recommendation — which, if it
   * is hard to take back, is picked rather than sent, so a stray Enter on a merge
   * card cannot merge. Enter again sends it.
   */
  const sendDefault = useCallback(() => {
    if (isMulti) {
      sendMulti();
      return;
    }
    const chosen = options.find(option => option.id === picked[0]);
    if (chosen) {
      sendOption(chosen);
      return;
    }
    if (recommended?.confirm) {
      setPicked([recommended.id]);
      return;
    }
    if (recommended) sendOption(recommended);
    else if (custom.trim()) sendCustom();
  }, [custom, isMulti, options, picked, recommended, sendCustom, sendMulti, sendOption]);

  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (locked || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) {
        // The textarea handles its own Enter; Escape hands the keyboard back.
        if (event.key === "Escape") (event.target as HTMLElement).blur();
        return;
      }
      const index = optionIndexForKey(event.key);
      if (index !== null) {
        const option = options[index];
        if (!option) return;
        event.preventDefault();
        if (isMulti) toggleMulti(option);
        else pickSingle(option);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        sendDefault();
        return;
      }
      if ((event.key === "c" || event.key === "C") && decision.allowCustom) {
        event.preventDefault();
        customRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    active,
    decision.allowCustom,
    isMulti,
    locked,
    options,
    pickSingle,
    sendDefault,
    toggleMulti,
  ]);

  const contextLines = showAllContext ? decision.context : decision.context.slice(0, CONTEXT_SHOWN);
  const hiddenContext = decision.context.length - contextLines.length;
  const multiCount = picked.length + (custom.trim() ? 1 : 0);
  const canConfirmMulti = multiCount >= minSelections;

  return (
    <Tile className="flex flex-col gap-4" data-testid="decision-card">
      {/* Who and where — one line, muted, so the question below is the first thing read. */}
      <header className="flex flex-wrap items-center gap-2 text-xs text-typography-500">
        <Tag type={CATEGORY_TAG[decision.category]} size="sm">
          {strings.categories[decision.category] ?? decision.category}
        </Tag>
        <Tag type="gray" size="sm">
          {strings.kinds[decision.kind] ?? decision.kind}
        </Tag>
        {decision.questionType && (
          <Tag type="outline" size="sm">
            {strings.questionTypes[decision.questionType] ?? decision.questionType}
          </Tag>
        )}
        <span className="truncate font-medium text-typography-700">{decision.sessionTitle}</span>
        {decision.createdByName && <span>· {strings.card.startedBy(decision.createdByName)}</span>}
        <span className="ml-auto whitespace-nowrap tabular-nums">
          {strings.card.waiting(waitingLabel)}
        </span>
      </header>

      <div>
        <p className="text-base font-semibold text-typography-900">{decision.prompt}</p>
        <p className="mt-1 text-xs text-typography-600">
          <span className="font-semibold">{strings.card.blocked}:</span> {decision.blocked}
        </p>
      </div>

      {(rationale.why || rationale.basis || rationale.yours) && (
        <dl className="grid gap-1 text-xs text-typography-700 sm:grid-cols-[auto_1fr] sm:gap-x-3">
          {rationale.why && (
            <>
              <dt className="sr-only">Why</dt>
              <dd className="italic sm:col-span-2">{rationale.why}</dd>
            </>
          )}
          {rationale.basis && (
            <>
              <dt className="font-semibold text-typography-500">{strings.card.basedOn}</dt>
              <dd>{rationale.basis}</dd>
            </>
          )}
          {rationale.yours && (
            <>
              <dt className="font-semibold text-typography-500">{strings.card.yours}</dt>
              <dd>{rationale.yours}</dd>
            </>
          )}
        </dl>
      )}

      {decision.context.length > 0 && (
        <div className="rounded border border-border-light bg-neutral-50 px-3 py-2 text-xs text-typography-700">
          <p className="mb-1 font-semibold text-typography-500">{strings.card.context}</p>
          <ul className="flex flex-col gap-1">
            {contextLines.map(line => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
          {hiddenContext > 0 && (
            <button
              type="button"
              className="mt-1 cursor-pointer text-primary-600 hover:underline"
              onClick={() => setShowAllContext(true)}
            >
              {strings.card.showContext(hiddenContext)}
            </button>
          )}
          {showAllContext && decision.context.length > CONTEXT_SHOWN && (
            <button
              type="button"
              className="mt-1 cursor-pointer text-primary-600 hover:underline"
              onClick={() => setShowAllContext(false)}
            >
              {strings.card.hideContext}
            </button>
          )}
        </div>
      )}

      {options.length > 0 && (
        <ol className="flex flex-col gap-2" aria-label="Options">
          {options.map((option, index) => {
            const isPicked = picked.includes(option.id);
            return (
              <li key={option.id}>
                <button
                  type="button"
                  disabled={locked}
                  aria-pressed={isPicked}
                  onClick={() => (isMulti ? toggleMulti(option) : clickSingle(option))}
                  className={[
                    "flex w-full items-start gap-3 rounded border px-3 py-2 text-left transition-colors",
                    "hover:border-primary-500 hover:bg-primary-50",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                    isPicked
                      ? "border-primary-600 bg-primary-50 ring-1 ring-primary-600"
                      : option.recommended
                        ? "border-primary-400 bg-primary-50/40"
                        : "border-neutral-300",
                  ].join(" ")}
                >
                  {/* The key that picks it, as a badge: the shortcut is taught where it is used. */}
                  <kbd className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded border border-neutral-300 bg-white px-1 font-mono text-xs text-typography-700">
                    {index + 1}
                  </kbd>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-typography-900">
                        {option.label}
                      </span>
                      {option.recommended && (
                        <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700">
                          {strings.card.recommended}
                          {!isMulti &&
                            ` · ${option.confirm ? strings.card.pressEnterTwice : strings.card.pressEnter}`}
                        </span>
                      )}
                    </span>
                    {option.description && (
                      <span className="mt-0.5 block text-xs text-typography-600">
                        {option.description}
                      </span>
                    )}
                    {!isMulti && option.confirm && (
                      <span className="mt-0.5 block text-xs font-medium text-typography-700">
                        {isPicked ? strings.card.confirmPicked : strings.card.hardToUndo}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {decision.allowCustom && (
        <div className="flex flex-col gap-1">
          <TextArea
            ref={customRef}
            id={`decision-custom-${decision.id}`}
            labelText={strings.card.custom}
            hideLabel
            rows={2}
            value={custom}
            disabled={locked}
            placeholder={decision.customPlaceholder ?? strings.card.customPlaceholder}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              setCustom(event.target.value)
            }
            onKeyDown={(event: React.KeyboardEvent) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (isMulti) sendMulti();
                else sendCustom();
              }
            }}
          />
          <span className="text-xs text-typography-500">{strings.card.customHint}</span>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2">
        {isMulti && (
          <>
            <span className="text-xs text-typography-500">
              {strings.card.selectedCount(multiCount)}
              {minSelections > 1 && multiCount < minSelections
                ? ` · ${strings.card.minSelectionsHint(minSelections)}`
                : ""}
            </span>
            <Button
              kind="primary"
              size="sm"
              disabled={locked || !canConfirmMulti}
              onClick={sendMulti}
            >
              {strings.card.confirm}
            </Button>
          </>
        )}
        {decision.allowNone && (
          <Button kind="ghost" size="sm" disabled={locked} onClick={sendNone}>
            {strings.card.noneOfThese}
          </Button>
        )}
        <span className="flex-1" />
        {decision.pullRequestUrl && (
          <a
            href={decision.pullRequestUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary-600 hover:underline"
          >
            {strings.card.openPullRequest}
          </a>
        )}
        <Button kind="ghost" size="sm" onClick={onOpenSession}>
          {strings.card.openSession} <kbd className="ml-1 font-mono text-xs">O</kbd>
        </Button>
        <Button kind="tertiary" size="sm" disabled={locked} onClick={onSkip}>
          {strings.card.skip} <kbd className="ml-1 font-mono text-xs">S</kbd>
        </Button>
        {busy && <span className="text-xs text-typography-500">{strings.card.sending}</span>}
      </footer>
    </Tile>
  );
};
