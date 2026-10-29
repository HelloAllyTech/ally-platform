import React, { useState } from "react";

import { toast } from "sonner";

import { Button, TextArea } from "@ally-ui-mono/ui-shared";
import {
  useActOnDebriefRunMutation,
  useGetDebriefReviewQuery,
  useResolveDebriefFlagMutation,
} from "@api";
import { shortId } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { DebriefReviewFlag, DebriefReviewRun } from "@types";
import { getErrorMessage } from "@utils";

import { formatWhen, score } from "./consoleTable";
import { RunPanel } from "./RunPanel";

type RunAction = "publish" | "todays-debrief" | "reviewed";

const RunItem: React.FC<{
  run: DebriefReviewRun;
  onOpen: () => void;
  onAct: (action: RunAction) => void;
}> = ({ run, onOpen, onAct }) => {
  const s = en.debriefs.review;
  const waiting = run.status !== "below_bar";
  return (
    <li className="flex flex-col gap-2 border border-border-light p-4" data-testid="review-run">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill tone={waiting ? "warning" : "neutral"}>{en.debriefs.status[run.status]}</Pill>
        {run.hasRiskCue && <Pill tone="info">{en.debriefs.runs.riskCue}</Pill>}
        {run.learnerDistress && <Pill tone="warning">{s.distress}</Pill>}
        <span className="font-mono text-xs">{shortId(run.scenarioSessionId)}</span>
        <span>{run.tenantName ?? "—"}</span>
        <span>· {run.language ?? "—"}</span>
        <span>· {formatWhen(run.createdAt)}</span>
      </div>
      <p className="text-sm text-typography-800">
        {waiting ? s.waitingHelp : s.belowBarHelp}{" "}
        {s.scores(score(run.evaluatorOverall), score(run.judgeOverall))}
      </p>
      {(run.checkFailures.length > 0 || run.evaluatorHardFails.length > 0) && (
        <ul className="list-disc pl-5 text-sm">
          {run.checkFailures.map((f, i) => (
            <li key={`c${i}`}>
              {f.section}: {f.detail}
            </li>
          ))}
          {run.evaluatorHardFails.map((h, i) => (
            <li key={`h${i}`}>
              {h.code}: {h.evidence}
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
            {s.looksFine}
          </Button>
        )}
      </div>
    </li>
  );
};

const FlagItem: React.FC<{ flag: DebriefReviewFlag; onOpenRun: () => void }> = ({
  flag,
  onOpenRun,
}) => {
  const s = en.debriefs.review;
  const [resolve, { isLoading }] = useResolveDebriefFlagMutation();
  const [note, setNote] = useState("");
  const act = async (outcome: "kept" | "removed") => {
    try {
      await resolve({ id: flag.id, outcome, note: note.trim() || undefined }).unwrap();
      toast.success(outcome === "kept" ? s.kept : s.removed);
    } catch (e) {
      toast.error(getErrorMessage(e, s.failed));
    }
  };
  return (
    <li className="flex flex-col gap-2 border border-border-light p-4" data-testid="review-flag">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {flag.urgent && <Pill tone="warning">{s.urgent}</Pill>}
        <Pill tone="neutral">{s.reasons[flag.reason]}</Pill>
        <span className="font-mono text-xs">{flag.section}</span>
        <span>{flag.tenantName ?? "—"}</span>
        <span>· {formatWhen(flag.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap bg-neutral-50 p-2 text-sm">{flag.cardText ?? "—"}</p>
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
        <Button
          kind="tertiary"
          size="sm"
          disabled={isLoading || !note.trim()}
          onClick={() => void act("kept")}
        >
          {s.keep}
        </Button>
        <Button kind="primary" size="sm" disabled={isLoading} onClick={() => void act("removed")}>
          {s.remove}
        </Button>
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
      </div>
      {queue.isError ? (
        <ErrorPanel what={s.loadFailed} error={queue.error} onRetry={() => void queue.refetch()} />
      ) : !queue.data ? (
        <LoadingBlock lines={5} />
      ) : queue.data.runs.length === 0 && queue.data.flags.length === 0 ? (
        <EmptyPanel title={s.emptyTitle} message={s.emptyMessage} />
      ) : (
        <>
          {queue.data.runs.length > 0 && (
            <section className="flex flex-col gap-3">
              <h3 className="text-xl font-normal text-typography-900">{s.runsHeading}</h3>
              <ul className="flex flex-col gap-3">
                {queue.data.runs.map(run => (
                  <RunItem
                    key={run.id}
                    run={run}
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
                  <FlagItem key={flag.id} flag={flag} onOpenRun={() => setOpenRun(flag.runId)} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <RunPanel runId={openRun} onClose={() => setOpenRun(null)} />
      <ConfirmDialog
        isOpen={pending !== null}
        title={pending ? s.confirmTitle[pending.action] : ""}
        cancelLabel={en.debriefs.improver.cancel}
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
