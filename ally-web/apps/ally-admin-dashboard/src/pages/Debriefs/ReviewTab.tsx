import React, { useEffect, useMemo, useRef, useState } from "react";

import { toast } from "sonner";

import { Button, TextArea } from "@ally-ui-mono/ui-shared";
import {
  useActOnDebriefRunMutation,
  useEscalateDebriefMutation,
  useGetDebriefReviewQuery,
  useResolveDebriefFlagMutation,
} from "@api";
import { shortId } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { DebriefCardCorrection, DebriefReviewFlag, DebriefReviewRun } from "@types";
import { getErrorMessage } from "@utils";

import { hardFailLabel, languageLabel, sectionLabel } from "./consoleLabels";
import { formatWhen, score } from "./consoleTable";
import { RunPanel, SessionLogLink } from "./RunPanel";

type RunAction = "publish" | "todays-debrief" | "reviewed";

/** v9 FR-38: send an item to the clinical advisor. It stays in the queue, marked. */
const EscalateButton: React.FC<{ kind: "flags" | "runs"; id: string; reason?: string }> = ({
  kind,
  id,
  reason,
}) => {
  const s = en.debriefs.review;
  const [escalate, { isLoading }] = useEscalateDebriefMutation();
  const go = async () => {
    try {
      await escalate({ kind, id, reason: reason?.trim() || undefined }).unwrap();
      toast.success(s.escalatedDone);
    } catch (e) {
      toast.error(getErrorMessage(e, s.failed));
    }
  };
  return (
    <Button kind="tertiary" size="sm" disabled={isLoading} onClick={() => void go()}>
      {s.escalate}
    </Button>
  );
};

const RunItem: React.FC<{
  selected?: boolean;
  run: DebriefReviewRun;
  onOpen: () => void;
  onAct: (action: RunAction) => void;
}> = ({ run, onOpen, onAct, selected }) => {
  const s = en.debriefs.review;
  // A published debrief is here because the learner showed distress (FR-23)
  // or because the independent judge scored it below the bar (FR-21).
  const published = run.status === "published";
  const distressOnly = published && run.learnerDistress;
  const judgeOnly = published && !run.learnerDistress && run.judgeBelowBar;
  const waiting = run.status !== "below_bar" && !published;
  return (
    <li
      className={`flex flex-col gap-2 border p-4 ${selected ? "border-primary-600 ring-2 ring-primary-200" : "border-border-light"}`}
      data-testid="review-run"
      data-selected={selected ? "true" : undefined}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill tone={waiting ? "warning" : "neutral"}>{en.debriefs.status[run.status]}</Pill>
        {run.hasRiskCue && <Pill tone="info">{en.debriefs.runs.riskCue}</Pill>}
        {run.learnerDistress && <Pill tone="warning">{s.distress}</Pill>}
        {run.judgeBelowBar && <Pill tone="warning">{s.judgeBelow}</Pill>}
        {run.escalation && <Pill tone="info">{s.escalated}</Pill>}
        <span className="font-mono text-xs">{shortId(run.scenarioSessionId)}</span>
        <SessionLogLink sessionId={run.scenarioSessionId} />
        <span>{run.tenantName ?? "—"}</span>
        <span>· {languageLabel(run.language)}</span>
        <span>· {formatWhen(run.createdAt)}</span>
      </div>
      <p className="text-sm text-typography-800">
        {distressOnly
          ? s.distressHelp
          : judgeOnly
            ? s.judgeHelp
            : waiting
              ? s.waitingHelp
              : s.belowBarHelp}{" "}
        {s.scores(score(run.evaluatorOverall), score(run.judgeOverall))}
      </p>
      {run.escalation && (
        <p className="text-sm text-typography-700">
          {s.escalatedHelp(formatWhen(run.escalation.at))}
          {run.escalation.note ? ` ${run.escalation.note}` : ""}
        </p>
      )}
      {(run.checkFailures.length > 0 ||
        run.evaluatorHardFails.length > 0 ||
        (run.judgeHardFails?.length ?? 0) > 0) && (
        <ul className="list-disc pl-5 text-sm">
          {run.checkFailures.map((f, i) => (
            <li key={`c${i}`}>
              {sectionLabel(f.section)}: {f.detail}
            </li>
          ))}
          {run.evaluatorHardFails.map((h, i) => (
            <li key={`h${i}`}>
              {hardFailLabel(h.code)}: {h.evidence}
            </li>
          ))}
          {(run.judgeHardFails ?? []).map((h, i) => (
            <li key={`j${i}`}>
              {hardFailLabel(h.code)}: {h.evidence}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button kind="tertiary" size="sm" onClick={onOpen}>
          {s.read}
        </Button>
        {waiting ? (
          <>
            <Button kind="primary" size="sm" onClick={() => onAct("publish")}>
              {s.publish}
            </Button>
            <Button kind="tertiary" size="sm" onClick={() => onAct("todays-debrief")}>
              {s.fallback}
            </Button>
          </>
        ) : (
          <Button kind="tertiary" size="sm" onClick={() => onAct("reviewed")}>
            {distressOnly ? s.checkedOn : s.looksFine}
          </Button>
        )}
        {!run.escalation && <EscalateButton kind="runs" id={run.id} />}
      </div>
    </li>
  );
};

const FlagItem: React.FC<{
  flag: DebriefReviewFlag;
  onOpenRun: () => void;
  selected?: boolean;
}> = ({ flag, onOpenRun, selected }) => {
  const s = en.debriefs.review;
  const [resolve, { isLoading }] = useResolveDebriefFlagMutation();
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<DebriefCardCorrection | null>(null);
  const act = async (outcome: "kept" | "removed" | "corrected") => {
    try {
      await resolve({
        id: flag.id,
        outcome,
        note: note.trim() || undefined,
        correction: outcome === "corrected" ? (draft ?? undefined) : undefined,
      }).unwrap();
      toast.success(
        outcome === "kept" ? s.kept : outcome === "corrected" ? s.corrected : s.removed,
      );
    } catch (e) {
      toast.error(getErrorMessage(e, s.failed));
    }
  };
  const changed =
    draft !== null &&
    Object.entries(draft).some(
      ([field, text]) => text.trim() && text !== flag.card?.[field as keyof DebriefCardCorrection],
    );
  return (
    <li
      className={`flex flex-col gap-2 border p-4 ${selected ? "border-primary-600 ring-2 ring-primary-200" : "border-border-light"}`}
      data-testid="review-flag"
      data-selected={selected ? "true" : undefined}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {flag.urgent && <Pill tone="warning">{s.urgent}</Pill>}
        {flag.status === "escalated" && <Pill tone="info">{s.escalated}</Pill>}
        <Pill tone="neutral">{s.reasons[flag.reason]}</Pill>
        <span>{sectionLabel(flag.section)}</span>
        <SessionLogLink sessionId={flag.scenarioSessionId} />
        <span>{flag.tenantName ?? "—"}</span>
        <span>· {formatWhen(flag.createdAt)}</span>
      </div>
      {draft ? (
        <div
          className="flex flex-col gap-2 border border-border-light p-3"
          data-testid="correct-card"
        >
          <p className="text-sm font-semibold">{s.correctHeading}</p>
          <p className="text-sm text-typography-700">{s.correctHelp}</p>
          {Object.keys(draft).map(field => (
            <TextArea
              key={field}
              id={`flag-${flag.id}-${field}`}
              labelText={s.fields[field] ?? field}
              rows={2}
              value={draft[field as keyof DebriefCardCorrection] ?? ""}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                setDraft({ ...draft, [field]: event.target.value })
              }
            />
          ))}
        </div>
      ) : (
        <p className="whitespace-pre-wrap bg-neutral-50 p-2 text-sm">{flag.cardText ?? "—"}</p>
      )}
      {flag.note && (
        <p className="text-sm">
          <span className="font-semibold">{s.learnerSaid}</span> {flag.note}
        </p>
      )}
      <TextArea
        id={`flag-note-${flag.id}`}
        labelText={s.noteLabel}
        helperText={s.noteHelp}
        rows={2}
        maxCount={500}
        enableCounter
        value={note}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button kind="tertiary" size="sm" onClick={onOpenRun}>
          {s.read}
        </Button>
        {draft ? (
          <>
            <Button
              kind="primary"
              size="sm"
              disabled={isLoading || !note.trim() || !changed}
              onClick={() => void act("corrected")}
            >
              {s.saveCorrection}
            </Button>
            <Button kind="tertiary" size="sm" onClick={() => setDraft(null)}>
              {s.cancel}
            </Button>
          </>
        ) : (
          <>
            <Button
              kind="tertiary"
              size="sm"
              disabled={isLoading || !note.trim()}
              onClick={() => void act("kept")}
            >
              {s.keep}
            </Button>
            {flag.card && (
              <Button kind="tertiary" size="sm" onClick={() => setDraft({ ...flag.card })}>
                {s.correct}
              </Button>
            )}
            <Button
              kind="primary"
              size="sm"
              disabled={isLoading}
              onClick={() => void act("removed")}
            >
              {s.remove}
            </Button>
            {flag.status !== "escalated" && (
              <EscalateButton kind="flags" id={flag.id} reason={note} />
            )}
          </>
        )}
      </div>
    </li>
  );
};

/**
 * Review: the live debriefs a person must finish or check, and learners' flags.
 * Important moments and distress first; a flag still inside the learner's
 * ten-minute undo window is not shown yet.
 */
export const ReviewTab: React.FC = () => {
  const s = en.debriefs.review;
  const queue = useGetDebriefReviewQuery();
  const [act, { isLoading }] = useActOnDebriefRunMutation();
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; action: RunAction } | null>(null);
  const [escalate] = useEscalateDebriefMutation();

  // v9 FR-38: the queue works by keyboard — j / k move, Enter opens the
  // debrief, e escalates to the clinical advisor. Runs first, then flags, in
  // the order shown.
  const items = useMemo(
    () => [
      ...(queue.data?.runs ?? []).map(r => ({
        kind: "runs" as const,
        id: r.id,
        runId: r.id,
        escalated: !!r.escalation,
      })),
      ...(queue.data?.flags ?? []).map(f => ({
        kind: "flags" as const,
        id: f.id,
        runId: f.runId,
        escalated: f.status === "escalated",
      })),
    ],
    [queue.data],
  );
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // An item that left the queue moves the selection back onto the last one (adjusted while
  // rendering, as React recommends, rather than in an effect).
  if (selected >= items.length && selected !== Math.max(0, items.length - 1)) {
    setSelected(Math.max(0, items.length - 1));
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (openRun !== null || pending !== null || items.length === 0) return;
      const current = items[Math.min(selected, items.length - 1)];
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const next =
          e.key === "j" ? Math.min(items.length - 1, selected + 1) : Math.max(0, selected - 1);
        setSelected(next);
        listRef.current
          ?.querySelectorAll<HTMLElement>("[data-testid='review-run'],[data-testid='review-flag']")
          [next]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        setOpenRun(current.runId);
      } else if (e.key === "e" && !current.escalated) {
        e.preventDefault();
        escalate({ kind: current.kind, id: current.id })
          .unwrap()
          .then(() => toast.success(s.escalatedDone))
          .catch(err => toast.error(getErrorMessage(err, s.failed)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected, openRun, pending, escalate, s]);
  const isSelected = (kind: "runs" | "flags", id: string) =>
    items[selected]?.kind === kind && items[selected]?.id === id;

  const confirm = async () => {
    if (!pending) return;
    try {
      await act(pending).unwrap();
      toast.success(s.done);
      setPending(null);
    } catch (e) {
      toast.error(getErrorMessage(e, s.failed));
    }
  };

  return (
    <div className="flex flex-col gap-8" data-testid="review-tab">
      <div>
        <h2 className="text-xl font-normal text-typography-900">{s.heading}</h2>
        <p className="max-w-3xl pt-1 text-sm text-typography-700">{s.help}</p>
        <p className="pt-1 text-xs text-typography-700" data-testid="review-keys">
          {s.keyboardHint}
        </p>
      </div>
      {queue.isError ? (
        <ErrorPanel what={s.loadFailed} error={queue.error} onRetry={() => void queue.refetch()} />
      ) : !queue.data ? (
        <LoadingBlock lines={5} />
      ) : queue.data.runs.length === 0 && queue.data.flags.length === 0 ? (
        <EmptyPanel title={s.emptyTitle} message={s.emptyMessage} />
      ) : (
        <div ref={listRef} className="flex flex-col gap-8">
          {queue.data.runs.length > 0 && (
            <section className="flex flex-col gap-3">
              <h3 className="text-xl font-normal text-typography-900">{s.runsHeading}</h3>
              <ul className="flex flex-col gap-3">
                {queue.data.runs.map(run => (
                  <RunItem
                    key={run.id}
                    run={run}
                    selected={isSelected("runs", run.id)}
                    onOpen={() => setOpenRun(run.id)}
                    onAct={action => setPending({ id: run.id, action })}
                  />
                ))}
              </ul>
            </section>
          )}
          {queue.data.flags.length > 0 && (
            <section className="flex flex-col gap-3">
              <h3 className="text-xl font-normal text-typography-900">{s.flagsHeading}</h3>
              <ul className="flex flex-col gap-3">
                {queue.data.flags.map(flag => (
                  <FlagItem
                    key={flag.id}
                    flag={flag}
                    selected={isSelected("flags", flag.id)}
                    onOpenRun={() => setOpenRun(flag.runId)}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      <RunPanel runId={openRun} onClose={() => setOpenRun(null)} />
      <ConfirmDialog
        isOpen={pending !== null}
        title={pending ? s.confirmTitle[pending.action] : ""}
        cancelLabel={en.debriefs.pmAgent.cancel}
        confirmLabel={pending ? s.confirmLabel[pending.action] : ""}
        isWorking={isLoading}
        onConfirm={() => void confirm()}
        onClose={() => setPending(null)}
      >
        <p>{pending ? s.confirmBody[pending.action] : ""}</p>
      </ConfirmDialog>
    </div>
  );
};
