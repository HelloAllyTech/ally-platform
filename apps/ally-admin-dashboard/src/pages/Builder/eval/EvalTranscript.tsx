import React, { useState } from "react";

import { Button, Tag } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import type { BuilderEvalTurnRecord } from "@types";
import { asAgentText } from "@utils/agentAuthored";

import { asArray } from "./evalFormat";

interface EvalTranscriptProps {
  turns: BuilderEvalTurnRecord[] | null | undefined;
}

const Line: React.FC<{ label: string; text: string; tone?: "correction" }> = ({
  label,
  text,
  tone,
}) => (
  <div
    className={
      tone === "correction" ? "border-l-4 border-warning-300 bg-warning-50 py-1 pl-2" : "pl-3"
    }
  >
    <span className="text-xs font-semibold uppercase tracking-wide text-typography-500">
      {label}
    </span>
    <p className="whitespace-pre-wrap text-sm text-typography-900">{text}</p>
  </div>
);

/**
 * A replay, turn by turn: what the simulated admin said, what Builder said,
 * the question that ended the turn, and every tool call with its outcome.
 *
 * Two things are marked on purpose. A turn where the simulated admin was
 * correcting Builder is highlighted and tagged, because corrections are what
 * the eval counts against a run and the transcript is where you find which
 * answer prompted one. A failed tool call says "Failed" in words as well as
 * colour, because the failures a reply was written without seeing are the
 * first thing a gate counts.
 *
 * The transcript is agent-written, so every field is read defensively: a turn
 * that is not an object, a tool call list that is not a list, or a text that is
 * not a string degrades to what can be shown rather than throwing.
 */
export const EvalTranscript: React.FC<EvalTranscriptProps> = ({ turns }) => {
  const strings = en.builder.eval.transcript;
  const [open, setOpen] = useState(false);

  const records = asArray<BuilderEvalTurnRecord>(turns).filter(
    turn => typeof turn === "object" && turn !== null,
  );

  if (records.length === 0) {
    return <p className="text-xs text-typography-600">{strings.none}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          kind="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen(current => !current)}
        >
          {open ? strings.hide : strings.show(records.length)}
        </Button>
      </div>

      {open && (
        <ol className="flex flex-col gap-4">
          {records.map((turn, index) => {
            const toolCalls = asArray<BuilderEvalTurnRecord["toolCalls"][number]>(
              turn.toolCalls,
            ).filter(call => typeof call === "object" && call !== null);
            const question = asAgentText(turn.question);
            const isCorrection = Boolean(turn.correction);

            return (
              <li key={index} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-typography-700">
                    {strings.turn(typeof turn.turn === "number" ? turn.turn : index + 1)}
                  </span>
                  {isCorrection && (
                    <Tag type="red" size="sm" className="shrink-0">
                      {strings.correctionTag}
                    </Tag>
                  )}
                </div>
                <Line
                  label={isCorrection ? strings.adminCorrects : strings.admin}
                  text={asAgentText(turn.admin) || strings.empty}
                  tone={isCorrection ? "correction" : undefined}
                />
                <Line label={strings.builder} text={asAgentText(turn.builder) || strings.empty} />
                {question && <Line label={strings.question} text={question} />}
                {toolCalls.length > 0 && (
                  <ul className="flex flex-col gap-0.5 pl-3">
                    {toolCalls.map((call, callIndex) => {
                      const failed = call.ok === false;
                      const summary = asAgentText(call.summary);
                      return (
                        <li
                          key={callIndex}
                          className={`flex flex-wrap items-baseline gap-x-2 text-xs ${
                            failed ? "text-destructive-600" : "text-typography-600"
                          }`}
                        >
                          <span className="font-mono">
                            {asAgentText(call.name) || strings.tool}
                          </span>
                          {failed && <span className="font-semibold">{strings.failed}</span>}
                          {summary && (
                            <span className="min-w-0 flex-1 break-words text-typography-600">
                              {summary}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
