import React, { useState } from "react";

import {
  AssistantLine,
  Chip,
  OptionList,
  PrimaryButton,
  Question,
  keysHintFor,
  useEnterToSubmit,
} from "@components/v2";

import { COPY } from "../copy";
import { withBold } from "./text";

// ── 5…n. One question per screen ──────────────────────────────────────────

export const QuestionScreen: React.FC<{
  /** The builder's words before the question ("Done. I added those fees."). */
  lead?: string;
  title: string;
  subtitle: string;
  eyebrow: string | null;
  options: string[];
  multiSelect: boolean;
  textAnswer?: boolean;
  busy: boolean;
  working: string | null;
  streaming: string;
  onChoose: (chip: string) => void;
  onSay: (text: string) => void;
}> = ({
  lead,
  title,
  subtitle,
  eyebrow,
  options,
  multiSelect,
  textAnswer = !options.length,
  busy,
  working,
  streaming,
  onChoose,
  onSay,
}) => {
  const [chosen, setChosen] = useState<string[]>([]);
  const [text, setText] = useState("");
  const submitMulti = () => {
    if (chosen.length) onSay(chosen.join(", "));
  };
  const submitText = () => {
    if (text.trim()) onSay(text.trim());
  };
  useEnterToSubmit(multiSelect ? submitMulti : submitText, !busy && (multiSelect || textAnswer));

  if (busy) {
    return (
      <AssistantLine working streaming={Boolean(streaming)}>
        {streaming || working || ""}
      </AssistantLine>
    );
  }
  const answerBox = textAnswer && !multiSelect && (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      onSubmit={event => {
        event.preventDefault();
        submitText();
      }}
    >
      <textarea
        className="ally-input"
        aria-label={title}
        placeholder={COPY.gaps.answerPlaceholder}
        value={text}
        autoFocus
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submitText();
          }
        }}
      />
      <PrimaryButton type="submit" enterHint={COPY.frame.enterHint} disabled={!text.trim()}>
        {COPY.gaps.ok}
      </PrimaryButton>
    </form>
  );
  return (
    <>
      {lead && <AssistantLine>{withBold(lead)}</AssistantLine>}
      <Question eyebrow={eyebrow ?? undefined} title={title} subtitle={subtitle || undefined}>
        {answerBox}
        {multiSelect ? (
          <>
            <div className="ally-chips" role="group" aria-label={title}>
              {options.map(option => (
                <Chip
                  key={option}
                  selected={chosen.includes(option)}
                  onToggle={() =>
                    setChosen(c =>
                      c.includes(option) ? c.filter(x => x !== option) : [...c, option],
                    )
                  }
                >
                  {option}
                </Chip>
              ))}
            </div>
            <PrimaryButton
              enterHint={COPY.frame.enterHint}
              disabled={!chosen.length}
              onClick={submitMulti}
            >
              {COPY.gaps.ok}
            </PrimaryButton>
          </>
        ) : options.length ? (
          <OptionList
            label={title}
            keysHint={keysHintFor(COPY.frame.optionsHint, options.length)}
            options={options.map(option => ({ id: option, label: option }))}
            onChoose={option => onChoose(option.id)}
          />
        ) : null}
      </Question>
    </>
  );
};
