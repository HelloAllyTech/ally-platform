import React, { useId } from "react";

import { en } from "@constants";

import type { RoadmapDraftProposal, RoadmapSubmitChoice } from "../../../types/roadmapV2Flow";

/** The choice as the page holds it while the author edits. */
export interface SubmitChoiceState {
  use: "mine" | "agent";
  statement: string;
}

/**
 * The agent's version is offered first when there is one: it is what the interview produced. The
 * author can take it whole, edit it, or keep their own words, so accepting the suggestion is never
 * all-or-nothing [FP-1708]. The title is separate: the submit dialog's required Title box.
 */
export const initialSubmitChoice = (
  proposal: RoadmapDraftProposal | null | undefined,
): SubmitChoiceState =>
  proposal ? { use: "agent", statement: proposal.statement } : { use: "mine", statement: "" };

/** Characters Submit will file as the summary for the agent's version. */
export const agentLength = (choice: SubmitChoiceState): number => choice.statement.trim().length;

/** Why Submit can't go ahead with this choice, or null. Mirrors the server, which decides. */
export const submitChoiceProblem = (
  choice: SubmitChoiceState,
  max: number,
): "empty" | "tooLong" | null => {
  if (choice.use !== "agent") return null;
  const length = agentLength(choice);
  if (length === 0) return "empty";
  return length > max ? "tooLong" : null;
};

/** What the submit request carries. "mine" is also what an older page, sending nothing, gets. */
export const toSubmitChoice = (choice: SubmitChoiceState): RoadmapSubmitChoice =>
  choice.use === "agent" ? { use: "agent", statement: choice.statement } : { use: "mine" };

interface SubmitChoiceProps {
  authorText: string;
  proposal: RoadmapDraftProposal | null | undefined;
  max: number;
  value: SubmitChoiceState;
  onChange: (next: SubmitChoiceState) => void;
}

const inputClass =
  "w-full rounded border border-border-light bg-white px-2 py-1.5 text-sm text-typography-primary focus:border-primary-600 focus:outline-none";

/**
 * "What will be submitted" (audit rec. 6), at 5 of 5: the idea agent's statement, editable, or the
 * author's own words, as the summary beneath the title. The checks always grade the author's words;
 * this only picks what the idea says once filed. The author's words stay on the idea either way.
 */
export const SubmitChoice: React.FC<SubmitChoiceProps> = ({
  authorText,
  proposal,
  max,
  value,
  onChange,
}) => {
  const copy = en.roadmapV2.draft;
  const words = copy.submitChoice;
  const name = useId();
  const statementId = useId();
  const countId = useId();

  if (!proposal) {
    return (
      <section aria-label={words.title} className="flex flex-col gap-1">
        <h2 className="m-0 text-sm font-semibold text-typography-primary">{words.title}</h2>
        <p className="m-0 text-sm text-typography-secondary">{words.noStatement}</p>
      </section>
    );
  }

  const length = agentLength(value);
  const problem = submitChoiceProblem(value, max);
  const option = (use: SubmitChoiceState["use"], label: string, help: string) => (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-sm ${
        value.use === use ? "border-primary-600 bg-primary-50" : "border-border-light"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={use}
        checked={value.use === use}
        onChange={() => onChange({ ...value, use })}
        className="mt-0.5"
      />
      <span className="flex flex-col">
        <span className="font-semibold text-typography-primary">{label}</span>
        <span className="text-xs text-typography-secondary">{help}</span>
      </span>
    </label>
  );

  return (
    <section aria-label={words.title} className="flex flex-col gap-2">
      <h2 className="m-0 text-sm font-semibold text-typography-primary">{words.title}</h2>
      <p className="m-0 text-xs text-typography-secondary">{words.help}</p>
      <div role="radiogroup" aria-label={words.title} className="grid gap-2 sm:grid-cols-2">
        {option("agent", words.useThis, words.useThisHelp)}
        {option("mine", words.useMine, words.useMineHelp)}
      </div>
      {value.use === "agent" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <label
              htmlFor={statementId}
              className="text-xs font-semibold text-typography-secondary"
            >
              {words.statementLabel}
            </label>
            <textarea
              id={statementId}
              className={`${inputClass} min-h-24`}
              value={value.statement}
              onChange={event => onChange({ ...value, statement: event.target.value })}
              aria-describedby={countId}
              aria-invalid={problem === "tooLong" || undefined}
            />
          </div>
          <p
            id={countId}
            className={`m-0 text-xs tabular-nums ${
              problem ? "text-red-700" : "text-typography-secondary"
            }`}
            aria-live="polite"
          >
            {copy.textCount(length, max)}
            {problem === "tooLong" && ` · ${copy.submitTooLong(max)}`}
            {problem === "empty" && ` · ${copy.submitStatementEmpty}`}
          </p>
        </div>
      ) : (
        <p className="m-0 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-sm text-typography-primary">
          {authorText}
        </p>
      )}
    </section>
  );
};
