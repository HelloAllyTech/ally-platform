import React, { useState } from "react";

import { toast } from "sonner";

import { Button, TextArea, TextInput } from "@ally-ui-mono/ui-shared";
import { useCorrectDebriefRunMutation, useResolveDebriefFlagMutation } from "@api";
import { en } from "@constants";
import { DebriefCardCorrection } from "@types";
import { getErrorMessage } from "@utils";

/** The fields a reviewer may rewrite, in the order the card shows them. */
const FIELD_ORDER: Array<keyof DebriefCardCorrection> = [
  "lead",
  "body",
  "why",
  "try_saying",
  "reason",
];

/**
 * Correct in place (PRD §6.7, build notes item 2): the card turns into a form where it sits. The
 * quote stays locked; "What changed" is what the learner reads with the new words. With a flag it
 * resolves the flag as corrected; without one (a held or below-the-bar debrief) it corrects the
 * run. Either way ally-be saves the card's next version.
 */
export const CorrectInPlace: React.FC<{
  runId: string;
  section: string;
  flagId: string | null;
  fields: DebriefCardCorrection;
  title: string;
  quote: { text: string; turn: number } | null;
  version: number;
  onSaved: () => void;
  onCancel: () => void;
}> = ({ runId, section, flagId, fields: original, title, quote, version, onSaved, onCancel }) => {
  const s = en.debriefs.session.correct;
  const [draft, setDraft] = useState<DebriefCardCorrection>({ ...original });
  const [note, setNote] = useState("");
  const [resolve, resolving] = useResolveDebriefFlagMutation();
  const [correctRun, correcting] = useCorrectDebriefRunMutation();
  const fields = FIELD_ORDER.filter(f => original[f] !== undefined);
  const changed = fields.some(f => (draft[f] ?? "").trim() && draft[f] !== original[f]);
  const today = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const id = flagId ?? `${runId}-${section}`;

  const save = async () => {
    const correction = Object.fromEntries(
      fields.filter(f => draft[f] !== original[f]).map(f => [f, (draft[f] ?? "").trim()]),
    ) as DebriefCardCorrection;
    try {
      if (flagId) {
        await resolve({ id: flagId, outcome: "corrected", note: note.trim(), correction }).unwrap();
      } else {
        await correctRun({ id: runId, section, correction, note: note.trim() }).unwrap();
      }
      toast.success(en.debriefs.review.corrected);
      onSaved();
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.review.failed));
    }
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-sm border-2 border-primary-500 bg-white px-5 py-[18px]"
      data-testid="correct-in-place"
      onSubmit={e => e.preventDefault()}
    >
      <div className="flex items-center gap-2">
        <div className="text-xs tracking-[.32px] text-[#8A3800]">{title}</div>
        <span className="ml-auto text-xs text-neutral-600">{s.correcting(version)}</span>
      </div>
      {fields.map(f =>
        f === "lead" ? (
          <TextInput
            key={f}
            id={`correct-${id}-${f}`}
            labelText={en.debriefs.review.fields[f]}
            value={draft[f] ?? ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setDraft({ ...draft, [f]: e.target.value })
            }
          />
        ) : (
          <TextArea
            key={f}
            id={`correct-${id}-${f}`}
            labelText={en.debriefs.review.fields[f] ?? f}
            rows={2}
            value={draft[f] ?? ""}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setDraft({ ...draft, [f]: e.target.value })
            }
          />
        ),
      )}
      {quote && (
        <div className="flex flex-col gap-1 text-xs text-neutral-600">
          {s.quoteLocked}
          <div
            className="flex items-center gap-2 bg-neutral-100 px-3 py-2.5 text-sm text-neutral-700"
            data-testid="correct-quote"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <rect x="3" y="7" width="10" height="7" rx="1" />
              <path d="M5 7V5a3 3 0 016 0v2" />
            </svg>
            “{quote.text}” · {en.debriefs.session.turn(quote.turn)}
          </div>
        </div>
      )}
      <TextInput
        id={`correct-${id}-note`}
        labelText={s.whatChanged}
        value={note}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
      />
      <div
        className="bg-neutral-50 px-3 py-2.5 text-[13px] text-neutral-700"
        data-testid="correct-preview"
      >
        {s.preview(today, note.trim() || s.previewEmpty)}
      </div>
      <div className="flex gap-2">
        <Button
          kind="primary"
          size="md"
          disabled={resolving.isLoading || correcting.isLoading || !changed || !note.trim()}
          onClick={() => void save()}
        >
          {s.save(version)}
        </Button>
        <Button kind="ghost" size="md" onClick={onCancel}>
          {en.debriefs.review.cancel}
        </Button>
      </div>
    </form>
  );
};
