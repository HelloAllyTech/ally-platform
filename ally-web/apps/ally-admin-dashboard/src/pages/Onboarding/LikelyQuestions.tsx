import React, { useEffect, useState } from "react";

import { useRunLikelyBotDraftMutation } from "@api";
import type { LikelyResult } from "@api";
import { Button, Orb } from "@components/v2";

import { SPLIT_COPY, fill } from "./copy";

const T_LIKELY = SPLIT_COPY.likely;

/** The first line of a reply, kept short for a collapsed row. */
const oneLine = (text: string): string => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
};

const finishedStatus = (error: unknown): boolean => {
  const e = error as { status?: number; data?: { errorCode?: string } } | undefined;
  return e?.status === 409 || e?.data?.errorCode === "setup_finished";
};

/**
 * "Run 10 likely questions": mounted when the owner asks, and runs once on mount (remount it to run
 * again). The call can take up to about 90 seconds. Setup finished (409) hides the feature.
 */
export const LikelyQuestions: React.FC<{
  draftId: string;
  /** The chat is busy: rows can't be opened into it now. */
  disabled: boolean;
  /** Puts a row into the test chat; without it (the Check-up) rows can't be opened. */
  onOpen?: (row: LikelyResult) => void;
  onFinished: () => void;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
}> = ({ draftId, disabled, onOpen, onFinished, onBusy, onClose }) => {
  const [runLikely] = useRunLikelyBotDraftMutation();
  const [state, setState] = useState<"running" | "done" | "failed">("running");
  const [results, setResults] = useState<LikelyResult[]>([]);
  const [openRow, setOpenRow] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const out = await runLikely({ id: draftId, count: 10 }).unwrap();
        if (!live) return;
        setResults(out.results ?? []);
        setState("done");
      } catch (error) {
        if (!live) return;
        if (finishedStatus(error)) {
          onFinished();
          onClose();
          return;
        }
        setState("failed");
      } finally {
        onBusy(false);
      }
    })();
    return () => {
      live = false;
    };
    // Runs once per mount: the parent remounts it for a new run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="ally-dt__likely" aria-label={T_LIKELY.heading}>
      <div className="ally-dt__fix-head">
        <strong className="ally-small">{T_LIKELY.heading}</strong>
        {state !== "running" && (
          <button type="button" className="ally-dt__link" onClick={() => onClose()}>
            {T_LIKELY.close}
          </button>
        )}
      </div>
      {state === "running" && (
        <p className="ally-small ally-dt__status" role="status">
          <Orb size={14} working />
          {T_LIKELY.running}
        </p>
      )}
      {state === "failed" && (
        <p className="ally-small" role="alert">
          {T_LIKELY.failed}
        </p>
      )}
      {state === "done" && results.length === 0 && (
        <p className="ally-small" role="status">
          {T_LIKELY.empty}
        </p>
      )}
      {state === "done" && results.length > 0 && (
        <>
          <p className="ally-small" role="status">
            {fill(T_LIKELY.summary, {
              n: results.filter(r => r.verdict === "ok").length,
              total: results.length,
            })}
          </p>
          <ul className="ally-dt__likely-list">
            {results.map((row, n) => {
              const open = openRow === n;
              const good = row.verdict === "ok";
              return (
                <li key={`${n}-${row.question}`} className="ally-dt__likely-row">
                  <div className="ally-dt__likely-head">
                    <span
                      role="img"
                      aria-label={good ? T_LIKELY.ok : T_LIKELY.check}
                      className={`ally-dt__mark ${good ? "is-ok" : "is-check"}`}
                    >
                      {good ? "✓" : "⚠"}
                    </span>
                    <button
                      type="button"
                      className="ally-dt__likely-toggle"
                      aria-expanded={open}
                      aria-label={`${open ? T_LIKELY.hide : T_LIKELY.show}: ${row.question}`}
                      onClick={() => setOpenRow(open ? null : n)}
                    >
                      <strong>{row.question}</strong>
                      {!open && <span className="ally-small">{oneLine(row.reply)}</span>}
                    </button>
                  </div>
                  {open && (
                    <div className="ally-dt__likely-body">
                      <p>{row.reply}</p>
                      {row.reason && (
                        <p className="ally-small">
                          {T_LIKELY.reason}: {row.reason}
                        </p>
                      )}
                    </div>
                  )}
                  {onOpen && (
                    <Button variant="secondary" disabled={disabled} onClick={() => onOpen(row)}>
                      {T_LIKELY.openInChat}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
};
