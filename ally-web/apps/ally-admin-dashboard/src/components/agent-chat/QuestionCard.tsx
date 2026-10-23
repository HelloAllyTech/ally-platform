import React, { useMemo, useState } from "react";

import {
  Button,
  Checkbox,
  FilterableMultiSelect,
  Tag,
  TextArea,
  TextInput,
  Tile,
} from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { AgentQuestionEvent, AgentQuestionOption, AgentStructuredAnswer } from "@types";

/** What the chat sends back for an answered card. */
export interface AgentAnswerPayload {
  message: string;
  questionId: string;
  answer?: AgentStructuredAnswer;
}

export type AgentQuestionStrings = typeof en.agentChat.question;

/** What a `renderOptions` picker is handed: the options, the current pick, and how to pick. */
export interface AgentOptionPickerProps {
  options: AgentQuestionOption[];
  /** Selected option ids. Always empty for singleSelect, where a pick answers at once. */
  selected: string[];
  onSelect: (optionId: string) => void;
  disabled: boolean;
}

export interface QuestionCardProps {
  question: AgentQuestionEvent;
  /** On resume: a plain freeText/singleSelect answer (locks the card). */
  answeredWith?: string;
  /** On resume: a structured multi-select/dropdown answer (locks the card). */
  answeredAnswer?: AgentStructuredAnswer;
  /**
   * Sends the answer. May resolve `false` to say the server never received it (the turn was
   * refused because another was still streaming), which unlocks the card so it can be answered
   * again instead of sitting frozen on a reply nobody got.
   */
  onAnswer: (payload: AgentAnswerPayload) => void | Promise<boolean | void>;
  disabled?: boolean;
  /** Pinned above the feed (Builder's mid-build pause) rather than inline: marked until answered. */
  emphasised?: boolean;
  /** The feature's own wording where it differs from the shared `en.agentChat.question`. */
  strings?: Partial<AgentQuestionStrings>;
  /**
   * Draws a select question's options in place of the card's own list, for options that need more
   * than a label to choose between — the character interview's voices, which are picked by ear.
   * A pick through it is single (a second pick replaces the first): singleSelect answers on the
   * click, and the other kinds confirm as usual.
   */
  renderOptions?: (picker: AgentOptionPickerProps) => React.ReactNode;
}

/**
 * A question from the agent, rendered as an answer card — shared by Builder, Course Copilot and
 * the character interview.
 *
 * Single-select and free text answer inline; multi-select and dropdown gather a set and confirm.
 * The recommended option is marked and sorted first so the common case is one click without
 * reading four descriptions, the `rationale` says why the question is being asked now, and an
 * "own answer" entry is offered whenever the agent allows one — an option list the admin can't
 * step outside of forces a wrong answer.
 *
 * Once answered the card locks and shows what was said, including on resume: a re-openable
 * question would let the transcript and what the agent recorded disagree.
 */
export const QuestionCard: React.FC<QuestionCardProps> = ({
  question,
  answeredWith,
  answeredAnswer,
  onAnswer,
  disabled = false,
  emphasised = false,
  strings: stringOverrides,
  renderOptions,
}) => {
  const strings: AgentQuestionStrings = { ...en.agentChat.question, ...stringOverrides };

  // The question is agent-authored, so `options` can arrive as anything. Normalise once, then
  // sort recommended first — the eye lands on it before the alternatives, which is the point of
  // recommending anything.
  const options = useMemo(() => {
    const normalized = Array.isArray(question.options) ? question.options : [];
    return [...normalized].sort(
      (a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)),
    );
  }, [question.options]);

  const labelFor = (id: string) => options.find(o => o.id === id)?.label ?? id;

  const isSelect =
    question.kind === "singleSelect" ||
    question.kind === "multiSelect" ||
    question.kind === "dropdown";

  const summarizeAnswer = (answer?: AgentStructuredAnswer): string | null => {
    if (!answer) return null;
    if (answer.none) return strings.noneOfThese;
    const parts = [
      ...(Array.isArray(answer.selectedOptionIds) ? answer.selectedOptionIds : []).map(labelFor),
      ...(Array.isArray(answer.customValues) ? answer.customValues : []),
    ];
    return parts.length ? parts.join(", ") : null;
  };

  const [lockedSummary, setLockedSummary] = useState<string | null>(
    answeredWith ?? summarizeAnswer(answeredAnswer),
  );
  const answered = lockedSummary !== null;

  // Multi-select / dropdown working state.
  const [selected, setSelected] = useState<string[]>([]);
  const [customValues, setCustomValues] = useState<string[]>([]);
  const [noneSelected, setNoneSelected] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [freeText, setFreeText] = useState("");

  /**
   * Lock the card, then send. It locks optimistically so the same answer can't be clicked twice,
   * but a turn the server refused outright leaves nothing behind — so the lock comes back off.
   */
  const submit = (summary: string, payload: AgentAnswerPayload) => {
    setLockedSummary(summary || strings.noneOfThese);
    void Promise.resolve(onAnswer(payload)).then(delivered => {
      if (delivered === false) setLockedSummary(null);
    });
  };

  const submitFreeText = () => {
    const trimmed = freeText.trim();
    if (!trimmed || answered || disabled) return;
    submit(trimmed, { message: trimmed, questionId: question.id });
  };

  const submitSingle = (option: AgentQuestionOption) => {
    if (answered || disabled) return;
    submit(option.label, {
      message: option.label,
      questionId: question.id,
      answer: { selectedOptionIds: [option.id] },
    });
  };

  const submitSingleCustom = () => {
    const trimmed = customDraft.trim();
    if (!trimmed || answered || disabled) return;
    submit(trimmed, {
      message: trimmed,
      questionId: question.id,
      answer: { customValues: [trimmed] },
    });
  };

  const submitNone = () => {
    if (answered || disabled) return;
    submit(strings.noneOfThese, {
      message: strings.noneOfThese,
      questionId: question.id,
      answer: { none: true },
    });
  };

  /** A `renderOptions` pick is single, so picking replaces the pick (and picking it again clears it). */
  const selectOnly = (id: string) => {
    setNoneSelected(false);
    setSelected(prev => (prev[0] === id ? [] : [id]));
  };

  const toggleOption = (id: string, checked: boolean) => {
    setNoneSelected(false);
    setSelected(prev => (checked ? [...prev, id] : prev.filter(x => x !== id)));
  };

  const addCustomValue = () => {
    const trimmed = customDraft.trim();
    if (!trimmed) return;
    setNoneSelected(false);
    setCustomValues(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setCustomDraft("");
  };

  const selectedCount = selected.length + customValues.length;
  const minSelections = question.minSelections ?? 1;
  const canConfirmMulti = noneSelected || selectedCount >= minSelections;

  const confirmMulti = () => {
    if (answered || disabled || !canConfirmMulti) return;
    if (noneSelected) {
      submitNone();
      return;
    }
    const message = [...selected.map(labelFor), ...customValues].join(", ");
    submit(message, {
      message,
      questionId: question.id,
      answer: {
        ...(selected.length ? { selectedOptionIds: selected } : {}),
        ...(customValues.length ? { customValues } : {}),
      },
    });
  };

  const renderCustomEntry = (onAdd: () => void) => (
    <div className="mt-3 flex items-end gap-2">
      <TextInput
        id={`agent-chat-custom-${question.id}`}
        labelText={strings.addCustom}
        hideLabel
        size="sm"
        placeholder={strings.addCustomPlaceholder}
        value={customDraft}
        disabled={disabled || answered}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
          setCustomDraft(event.target.value)
        }
        onKeyDown={(event: React.KeyboardEvent) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onAdd();
          }
        }}
      />
      <Button
        kind="tertiary"
        size="sm"
        disabled={disabled || answered || !customDraft.trim()}
        onClick={onAdd}
      >
        {strings.add}
      </Button>
    </div>
  );

  /**
   * "None of these" for the confirm-then-submit kinds, wherever the agent allows it — a dropdown
   * that left it out made `allowNone` unanswerable (the interview's voice question is asked as a
   * dropdown precisely so a character can be saved without a voice).
   */
  const renderNoneOption = () =>
    question.allowNone ? (
      <Checkbox
        id={`agent-chat-none-${question.id}`}
        labelText={strings.noneOfThese}
        checked={noneSelected}
        disabled={disabled}
        onChange={(_event: unknown, { checked }: { checked: boolean }) => {
          setNoneSelected(checked);
          if (checked) {
            setSelected([]);
            setCustomValues([]);
          }
        }}
      />
    ) : null;

  const renderConfirmRow = () => (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-typography-500">
        {noneSelected ? strings.noneOfThese : strings.selectedCountLabel(selectedCount)}
        {!noneSelected && minSelections > 1 && selectedCount < minSelections
          ? ` · ${strings.minSelectionsHint(minSelections)}`
          : ""}
      </span>
      <Button
        kind="primary"
        size="sm"
        disabled={disabled || !canConfirmMulti}
        onClick={confirmMulti}
      >
        {strings.confirmSelection}
      </Button>
    </div>
  );

  const renderBody = () => {
    if (answered) {
      return (
        <div className="mt-2 flex items-center gap-2">
          <Tag type="green" size="sm">
            {strings.answeredLabel}
          </Tag>
          <p className="text-sm italic text-typography-700">{lockedSummary}</p>
        </div>
      );
    }

    if (!isSelect) {
      return (
        <div className="mt-3 flex flex-col gap-2">
          <TextArea
            id={`agent-chat-question-${question.id}`}
            labelText={strings.freeTextPlaceholder}
            hideLabel
            value={freeText}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              setFreeText(event.target.value)
            }
            placeholder={strings.freeTextPlaceholder}
            disabled={disabled}
            rows={2}
            onKeyDown={(event: React.KeyboardEvent) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitFreeText();
              }
            }}
          />
          <div className="flex justify-end">
            <Button
              kind="primary"
              size="sm"
              disabled={disabled || !freeText.trim()}
              onClick={submitFreeText}
            >
              {strings.submitAnswer}
            </Button>
          </div>
        </div>
      );
    }

    // The feature draws the options; the card keeps the answering contract. Keyed on the feature
    // choosing to, not on `question.kind`: the interviewer asks about voices as `dropdown` or as
    // `singleSelect`, and both need the voice rows.
    if (renderOptions) {
      const answersOnClick = question.kind === "singleSelect";
      return (
        <div className="mt-3 flex flex-col gap-2">
          {renderOptions({
            options,
            selected: answersOnClick ? [] : selected,
            onSelect: id => {
              if (!answersOnClick) {
                selectOnly(id);
                return;
              }
              const option = options.find(o => o.id === id);
              if (option) submitSingle(option);
            },
            disabled,
          })}
          {answersOnClick ? (
            question.allowNone && (
              <div>
                <Button kind="ghost" size="sm" disabled={disabled} onClick={submitNone}>
                  {strings.noneOfThese}
                </Button>
              </div>
            )
          ) : (
            <>
              {renderNoneOption()}
              {renderConfirmRow()}
            </>
          )}
        </div>
      );
    }

    // Single select — one click answers. Each option shows its trade-off, so the choice is made
    // from the card rather than from memory of the chat.
    if (question.kind === "singleSelect") {
      return (
        <>
          <div className="mt-3 flex flex-col gap-2">
            {options.map((option, index) => (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                autoFocus={index === 0 && Boolean(option.recommended) && !disabled}
                onClick={() => submitSingle(option)}
                className={[
                  "w-full rounded border px-3 py-2 text-left transition-colors",
                  "hover:border-primary-500 hover:bg-primary-50",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  option.recommended ? "border-primary-400 bg-primary-50/40" : "border-neutral-300",
                ].join(" ")}
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-typography-900">{option.label}</span>
                  {/* A plain span, not a Carbon <Tag>: Tag renders a <button>, and a button inside
                      this option button is invalid DOM that also steals the click. */}
                  {option.recommended && (
                    <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700">
                      {strings.recommended}
                    </span>
                  )}
                </span>
                {option.description && (
                  <span className="mt-0.5 block text-xs text-typography-600">
                    {option.description}
                  </span>
                )}
              </button>
            ))}
            {question.allowNone && (
              <Button kind="ghost" size="sm" disabled={disabled} onClick={submitNone}>
                {strings.noneOfThese}
              </Button>
            )}
          </div>
          {question.allowCustom && renderCustomEntry(submitSingleCustom)}
        </>
      );
    }

    if (question.kind === "dropdown") {
      const selectedItems = options.filter(o => selected.includes(o.id));
      return (
        <div className="mt-3 flex flex-col gap-2">
          <FilterableMultiSelect
            id={`agent-chat-dropdown-${question.id}`}
            titleText=""
            placeholder={strings.selectPlaceholder}
            items={options}
            itemToString={(item: AgentQuestionOption | null) => item?.label ?? ""}
            selectedItems={selectedItems}
            disabled={disabled}
            onChange={({
              selectedItems: next,
            }: {
              selectedItems: AgentQuestionOption[] | null;
            }) => {
              setNoneSelected(false);
              setSelected((next ?? []).map(item => item.id));
            }}
          />
          {question.allowCustom && renderCustomEntry(addCustomValue)}
          {customValues.length > 0 && (
            <p className="text-xs text-typography-600">{customValues.join(", ")}</p>
          )}
          {renderNoneOption()}
          {renderConfirmRow()}
        </div>
      );
    }

    return (
      <div className="mt-3 flex flex-col gap-1.5">
        {options.map(option => (
          <Checkbox
            key={option.id}
            id={`agent-chat-opt-${question.id}-${option.id}`}
            labelText={
              option.description ? `${option.label} — ${option.description}` : option.label
            }
            checked={selected.includes(option.id)}
            disabled={disabled}
            onChange={(_event: unknown, { checked }: { checked: boolean }) =>
              toggleOption(option.id, checked)
            }
          />
        ))}
        {customValues.map(value => (
          <Checkbox
            key={`custom-${value}`}
            id={`agent-chat-custom-opt-${question.id}-${value}`}
            labelText={value}
            checked
            disabled={disabled}
            onChange={(_event: unknown, { checked }: { checked: boolean }) => {
              if (!checked) setCustomValues(prev => prev.filter(v => v !== value));
            }}
          />
        ))}
        {renderNoneOption()}
        {question.allowCustom && renderCustomEntry(addCustomValue)}
        {renderConfirmRow()}
      </div>
    );
  };

  return (
    <div className="flex justify-start">
      <Tile
        className={[
          "w-full max-w-[92%]",
          emphasised && !answered ? "border-l-4 border-l-primary-500" : null,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <p className="text-sm font-medium text-typography-900">{question.prompt}</p>
        {/* Why this question, now — tells a clarification apart from a fresh line of enquiry,
            which is otherwise invisible to the reader. */}
        {question.rationale && (
          <p className="mt-1 text-xs italic text-typography-500">{question.rationale}</p>
        )}
        {renderBody()}
      </Tile>
    </div>
  );
};
