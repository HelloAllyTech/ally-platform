import React, { useMemo, useState } from "react";

import { Button, Tag, TextArea, Tile } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import type {
  BuilderBriefLine,
  BuilderBriefLineKind,
  BuilderBriefResponse,
  BuilderSituationBrief,
} from "@types";

type Draft = { verdict: "confirm" | "correct" | null; correction: string };

interface SituationBriefCardProps {
  brief: BuilderSituationBrief;
  /** Set once answered: the card renders locked, with the verdicts. */
  answered?: BuilderBriefResponse;
  /** The answer, and the one line the feed shows for it. */
  onSubmit: (response: BuilderBriefResponse, summary: string) => void;
  disabled?: boolean;
}

const SECTION_ORDER: BuilderBriefLineKind[] = ["exists", "alreadyMet", "proposal", "repo"];

const APPROACH_TAG: Record<string, "green" | "blue" | "purple"> = {
  reuse: "green",
  extend: "blue",
  new: "purple",
};

/**
 * The situation brief: Builder's first visible turn under the interview protocol — what already
 * exists (each line with the lookup that found it), what is already met, a reuse / extend / new
 * proposal per part, and the repos. The admin confirms or corrects every line, and Builder writes
 * the PRD from that before it asks anything.
 *
 * Laid out as a checklist with a column for the reviewer's word, with one line of instructions
 * on top saying what to check — "Guiding Reviewers with Explicit Instructions and
 * Checklists". Unanswered lines are confirmed by the send button, which says so: a brief that is
 * mostly right should cost one correction and one click, not a click per line.
 */
export const SituationBriefCard: React.FC<SituationBriefCardProps> = ({
  brief,
  answered,
  onSubmit,
  disabled = false,
}) => {
  const strings = en.builder.chat.brief;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [note, setNote] = useState("");
  const verdictOf = useMemo(
    () => new Map((answered?.lines ?? []).map(line => [line.id, line])),
    [answered],
  );

  const draftOf = (id: string): Draft => drafts[id] ?? { verdict: null, correction: "" };
  const setDraft = (id: string, next: Partial<Draft>) =>
    setDrafts(current => ({ ...current, [id]: { ...draftOf(id), ...next } }));

  // A line no file read supports cannot be confirmed — only corrected or left unverified
  // [FP-0490] — so it is not waiting on a decision.
  const isUnverified = (line: BuilderBriefLine) => line.verified === false;
  const undecided = brief.lines.filter(
    line => !draftOf(line.id).verdict && !isUnverified(line),
  ).length;
  const confirmable = brief.lines.filter(line => !isUnverified(line)).length;
  const missingCorrection = brief.lines.some(
    line => draftOf(line.id).verdict === "correct" && !draftOf(line.id).correction.trim(),
  );

  const submit = () => {
    const lines = brief.lines.map(line => {
      const draft = draftOf(line.id);
      return draft.verdict === "correct" && draft.correction.trim()
        ? { id: line.id, verdict: "correct" as const, correction: draft.correction.trim() }
        : isUnverified(line)
          ? { id: line.id, verdict: "unverified" as const }
          : { id: line.id, verdict: "confirm" as const };
    });
    const corrected = lines.filter(line => line.verdict === "correct").length;
    const leftUnverified = lines.filter(line => line.verdict === "unverified").length;
    const trimmedNote = note.trim();
    const summary = [
      strings.summary(lines.length - corrected - leftUnverified, corrected),
      trimmedNote ? strings.note(trimmedNote) : "",
    ]
      .filter(Boolean)
      .join(" ");
    onSubmit({ briefId: brief.id, lines, ...(trimmedNote ? { note: trimmedNote } : {}) }, summary);
  };

  const renderHead = (line: BuilderBriefLine) => (
    <div className="flex flex-wrap items-center gap-2">
      {line.kind === "proposal" && line.approach && (
        <span className="shrink-0">
          <Tag type={APPROACH_TAG[line.approach] ?? "gray"} size="sm">
            {strings.approaches[line.approach]}
          </Tag>
        </span>
      )}
      {line.kind === "proposal" && line.part && (
        <span className="text-xs font-medium text-typography-600">{line.part}</span>
      )}
      {line.kind === "repo" && line.repo && (
        <span className="font-mono text-xs font-medium text-typography-700">{line.repo}</span>
      )}
    </div>
  );

  const renderLine = (line: BuilderBriefLine) => {
    const draft = draftOf(line.id);
    const verdict = verdictOf.get(line.id);
    return (
      <li
        key={line.id}
        className="rounded border border-neutral-200 p-2"
        data-testid={`brief-line-${line.id}`}
      >
        {renderHead(line)}
        <p className="mt-1 text-sm text-typography-900">{line.text}</p>
        {line.cites.length > 0 && (
          <p className="mt-1 break-words text-xs text-typography-500">
            <span className="font-medium">{strings.foundBy}:</span>{" "}
            {line.cites.map(cite => cite.label).join(" · ")}
          </p>
        )}
        {line.verified === true && line.verifiedBy && (
          <p className="mt-1 break-words text-xs text-typography-500">
            <span className="font-medium">{strings.checkedIn}:</span> {line.verifiedBy}
          </p>
        )}
        {isUnverified(line) && !answered && draft.verdict !== "correct" && (
          <p className="mt-1 text-xs text-typography-600">{strings.unverifiedHint}</p>
        )}

        {answered ? (
          verdict?.verdict === "correct" ? (
            <div className="mt-1 flex items-start gap-2">
              <span className="shrink-0">
                <Tag type="warm-gray" size="sm">
                  {strings.corrected}
                </Tag>
              </span>
              <p className="text-sm italic text-typography-700">{verdict.correction}</p>
            </div>
          ) : verdict?.verdict === "unverified" || (!verdict && isUnverified(line)) ? (
            <div className="mt-1">
              <Tag type="warm-gray" size="sm">
                {strings.unverified}
              </Tag>
            </div>
          ) : (
            <div className="mt-1">
              <Tag type="green" size="sm">
                {strings.confirmed}
              </Tag>
            </div>
          )
        ) : (
          <>
            <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
              {draft.verdict === "confirm" && (
                <span className="mr-auto shrink-0">
                  <Tag type="green" size="sm">
                    {strings.confirmed}
                  </Tag>
                </span>
              )}
              {!draft.verdict && isUnverified(line) && (
                <span className="mr-auto shrink-0">
                  <Tag type="warm-gray" size="sm">
                    {strings.unverified}
                  </Tag>
                </span>
              )}
              {draft.verdict ? (
                <Button
                  kind="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => setDraft(line.id, { verdict: null })}
                >
                  {strings.undo}
                </Button>
              ) : (
                <>
                  {!isUnverified(line) && (
                    <Button
                      kind="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => setDraft(line.id, { verdict: "confirm" })}
                    >
                      {strings.confirm}
                    </Button>
                  )}
                  <Button
                    kind="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => setDraft(line.id, { verdict: "correct" })}
                  >
                    {strings.correct}
                  </Button>
                </>
              )}
            </div>
            {draft.verdict === "correct" && (
              <div className="mt-1">
                <TextArea
                  id={`brief-correction-${brief.id}-${line.id}`}
                  labelText={strings.correctionLabel}
                  placeholder={strings.correctionPlaceholder}
                  rows={2}
                  value={draft.correction}
                  disabled={disabled}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setDraft(line.id, { correction: event.target.value })
                  }
                />
              </div>
            )}
          </>
        )}
      </li>
    );
  };

  return (
    <Tile className="w-full max-w-[92%]" aria-label={strings.label}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-typography-900">{strings.heading}</p>
          {answered && (
            <Tag type="green" size="sm">
              {strings.answered}
            </Tag>
          )}
        </div>
        {!answered && <p className="text-xs text-typography-600">{strings.instructions}</p>}

        {SECTION_ORDER.map(kind => {
          const lines = brief.lines.filter(line => line.kind === kind);
          if (!lines.length) return null;
          return (
            <section key={kind} className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-typography-500">
                {strings.sections[kind]}
              </p>
              <ul className="flex flex-col gap-2">{lines.map(renderLine)}</ul>
            </section>
          );
        })}

        {answered?.note && (
          <p className="text-sm text-typography-700">{strings.note(answered.note)}</p>
        )}

        {!answered && (
          <>
            <TextArea
              id={`brief-note-${brief.id}`}
              labelText={strings.noteLabel}
              rows={2}
              value={note}
              disabled={disabled}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                setNote(event.target.value)
              }
            />
            {missingCorrection && (
              <p className="text-xs text-destructive-600">{strings.needsCorrection}</p>
            )}
            <div className="flex justify-end">
              <Button
                kind="primary"
                size="sm"
                disabled={disabled || missingCorrection}
                onClick={submit}
              >
                {undecided === 0
                  ? strings.send
                  : undecided === confirmable
                    ? strings.confirmAllAndSend
                    : strings.sendConfirmingRest(undecided)}
              </Button>
            </div>
          </>
        )}
      </div>
    </Tile>
  );
};
