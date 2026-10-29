import { FC, useEffect, useId, useState } from "react";

import { Flag, ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  useFlagDebriefCardMutation,
  useSetDebriefHelpfulMutation,
  useUndoDebriefFlagMutation,
} from "@api";
import { DebriefCorrection, DebriefFlagReason, DebriefMyFlag } from "@types";

const REASONS: DebriefFlagReason[] = [
  "didnt_say",
  "described_wrongly",
  "advice_doesnt_fit",
  "something_else",
];

const linkButton =
  "inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 font-primary text-sm text-typography-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600";

/** True while the learner can still take the flag back. */
const canUndo = (flag?: DebriefMyFlag) =>
  !!flag?.canUndoUntil && new Date(flag.canUndoUntil).getTime() > Date.now();

/**
 * "This isn't right" for one card: pick a reason, add a note if you like,
 * send, and undo for ten minutes. A reviewed flag shows what the Ally team
 * decided instead of the control.
 */
export const CardFlag: FC<{
  sessionId: string;
  section: string;
  cardLabel: string;
  flag?: DebriefMyFlag;
  correction?: DebriefCorrection;
}> = ({ sessionId, section, cardLabel, flag, correction }) => {
  const { t } = useTranslation();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DebriefFlagReason | null>(null);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  const [sendFlag, { isLoading: sending }] = useFlagDebriefCardMutation();
  const [undoFlag, { isLoading: undoing }] = useUndoDebriefFlagMutation();
  // Re-render when the undo window closes, so Undo does not outlive it.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!canUndo(flag)) return undefined;
    const ms = new Date(flag!.canUndoUntil!).getTime() - Date.now();
    const timer = setTimeout(() => tick(n => n + 1), ms + 50);
    return () => clearTimeout(timer);
  }, [flag]);

  if (correction?.outcome === "kept") {
    return (
      <p data-testid="debrief-correction" className="font-primary text-xs text-typography-700">
        {t("postSim.debriefCards.corrections.kept", { note: correction.note ?? "" })}
      </p>
    );
  }
  if (flag) {
    return (
      <p
        role="status"
        className="flex flex-wrap items-center gap-2 font-primary text-xs text-typography-700"
      >
        {canUndo(flag)
          ? t("postSim.debriefCards.flag.sent")
          : t("postSim.debriefCards.flag.waiting")}
        {canUndo(flag) && (
          <button
            type="button"
            className={linkButton}
            disabled={undoing}
            onClick={() => void undoFlag({ sessionId, flagId: flag.id })}
          >
            {t("postSim.debriefCards.flag.undo")}
          </button>
        )}
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        className={`${linkButton} self-start`}
        aria-label={t("postSim.debriefCards.flag.openLabel", { card: cardLabel })}
        onClick={() => setOpen(true)}
      >
        <Flag aria-hidden="true" className="h-3.5 w-3.5" />
        {t("postSim.debriefCards.flag.open")}
      </button>
    );
  }

  const submit = async () => {
    if (!reason) return;
    setFailed(false);
    try {
      await sendFlag({ sessionId, section, reason, note: note.trim() || undefined }).unwrap();
      setOpen(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-primary-100 bg-primary-50 p-3"
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={event => {
        if (event.key === "Escape") setOpen(false);
      }}
      data-testid="debrief-flag-form"
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-primary text-sm font-semibold text-typography-900">
          {t("postSim.debriefCards.flag.question")}
        </legend>
        {REASONS.map((r, i) => (
          <label key={r} className="flex min-h-[44px] items-center gap-2 font-primary text-sm">
            <input
              type="radio"
              name={`${formId}-reason`}
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
              // The first choice takes focus when the form opens.
              autoFocus={i === 0}
            />
            {t(`postSim.debriefCards.flag.reasons.${r}`)}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 font-primary text-sm">
        {t("postSim.debriefCards.flag.noteLabel")}
        <textarea
          className="rounded-md border border-primary-200 p-2 text-sm"
          rows={2}
          maxLength={1000}
          value={note}
          onChange={event => setNote(event.target.value)}
        />
      </label>
      {failed && (
        <p role="alert" className="font-primary text-sm text-typography-900">
          {t("postSim.debriefCards.flag.failed")}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!reason || sending}
          className="min-h-[44px] rounded-md bg-primary-600 px-4 font-primary text-sm font-semibold text-white disabled:opacity-50"
        >
          {sending ? t("postSim.debriefCards.flag.sending") : t("postSim.debriefCards.flag.send")}
        </button>
        <button type="button" className={linkButton} onClick={() => setOpen(false)}>
          {t("postSim.debriefCards.flag.cancel")}
        </button>
      </div>
    </form>
  );
};

/** "Was this helpful?" at the end of the debrief; answering again changes it. */
export const DebriefHelpful: FC<{ sessionId: string; helpful: boolean | null }> = ({
  sessionId,
  helpful,
}) => {
  const { t } = useTranslation();
  const [setHelpful, { isLoading }] = useSetDebriefHelpfulMutation();
  const choice = (value: boolean, label: string, Icon: typeof ThumbsUp) => (
    <button
      type="button"
      aria-pressed={helpful === value}
      disabled={isLoading}
      onClick={() => void setHelpful({ sessionId, helpful: value })}
      className={`inline-flex min-h-[44px] items-center gap-1 rounded-md border px-3 font-primary text-sm ${
        helpful === value
          ? "border-primary-600 bg-primary-50 font-semibold text-typography-900"
          : "border-primary-100 text-typography-800"
      }`}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      {label}
    </button>
  );
  return (
    <div data-testid="debrief-helpful" className="flex flex-wrap items-center gap-2">
      <p className="font-primary text-sm font-semibold text-typography-900">
        {t("postSim.debriefCards.helpful.question")}
      </p>
      {choice(true, t("postSim.debriefCards.helpful.yes"), ThumbsUp)}
      {choice(false, t("postSim.debriefCards.helpful.no"), ThumbsDown)}
      {helpful !== null && (
        <span role="status" className="font-primary text-xs text-typography-700">
          {t("postSim.debriefCards.helpful.thanks")}
        </span>
      )}
    </div>
  );
};
