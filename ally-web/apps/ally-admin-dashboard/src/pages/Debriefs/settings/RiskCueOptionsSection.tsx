import React, { useState } from "react";

import { toast } from "sonner";

import { Button, TextArea } from "@ally-ui-mono/ui-shared";
import {
  useApproveRiskCueOptionMutation,
  useGetRiskCueOptionsForReviewQuery,
  useRejectRiskCueOptionMutation,
  useRetireRiskCueOptionMutation,
  useReviewTestRiskCueOptionMutation,
} from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { riskCueErrorMessage, RiskCueTestView } from "@components/debrief-roleplay-options";
import { en } from "@constants";
import { RiskCueOption } from "@types";

const ORDER: Record<string, number> = { awaiting_approval: 0, draft: 1, approved: 2, retired: 3 };

/** Awaiting approval first, then drafts, approved, retired; each by name. */
export const orderForReview = (options: RiskCueOption[]): RiskCueOption[] =>
  [...options].sort(
    (a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || a.name.localeCompare(b.name),
  );

/**
 * Settings › Risk-cue options: a clinical advisor's review of the options authors write for
 * roleplays. Master–detail: every option on the left (waiting ones first); the chosen option's
 * wording, behaviour, examples and last test on the right, with Run test, Approve, Turn down and
 * Retire. ally-be refuses an approval without a passing test on this version and says why.
 */
export const RiskCueOptionsSection: React.FC<{ canReview: boolean }> = ({ canReview }) => {
  const s = en.debriefs.settingsPage.riskCues;
  const q = useGetRiskCueOptionsForReviewQuery();
  const [runTest, testing] = useReviewTestRiskCueOptionMutation();
  const [approve, approving] = useApproveRiskCueOptionMutation();
  const [reject, rejecting] = useRejectRiskCueOptionMutation();
  const [retire, retiring] = useRetireRiskCueOptionMutation();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [turningDown, setTurningDown] = useState(false);
  const [retiringOpen, setRetiringOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (q.isLoading) return <p className="text-sm text-neutral-600">{s.loading}</p>;
  if (!q.data) return <p className="text-sm text-neutral-600">{s.loadFailed}</p>;
  const options = orderForReview(q.data);
  if (options.length === 0) return <p className="text-sm text-neutral-600">{s.none}</p>;
  const picked = options.find(o => o.id === pickedId) ?? null;
  const busy =
    testing.isLoading || approving.isLoading || rejecting.isLoading || retiring.isLoading;

  const act = async (run: () => Promise<unknown>, done: string | null, failed: string) => {
    setError(null);
    try {
      await run();
      if (done) toast.success(done);
      return true;
    } catch (e) {
      setError(riskCueErrorMessage(e, failed));
      return false;
    }
  };
  const pick = (id: string) => {
    setPickedId(id);
    setError(null);
    setTurningDown(false);
    setNote("");
  };

  const behaviour = (o: RiskCueOption) => [
    o.handling === "alarm" ? s.alarmBehaviour : s.assessedBehaviour,
    o.wordListRaises ? s.wordListOn : s.wordListOff,
    o.supportLinesOnCue ? s.supportOn : s.supportOff,
  ];

  return (
    <div
      className="grid grid-cols-[minmax(260px,340px)_minmax(0,1fr)] gap-4"
      data-testid="risk-cue-options"
    >
      <nav aria-label={s.list} className="flex flex-col rounded-sm bg-neutral-50">
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            aria-current={o.id === picked?.id ? "true" : undefined}
            onClick={() => pick(o.id)}
            data-testid={`risk-cue-row-${o.key}`}
            className={`flex flex-nowrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3 text-left text-sm ${o.id === picked?.id ? "bg-white font-semibold" : ""}`}
          >
            <span className="min-w-0 flex-1 truncate" title={o.name}>
              {o.name}
            </span>
            <span className="shrink-0 truncate text-[13px] text-neutral-600">
              {s.status[o.status]} · {s.handling[o.handling]} · {s.version(o.version)}
            </span>
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-col gap-3" data-testid="risk-cue-detail">
        {!picked ? (
          <p className="text-sm text-neutral-600">{s.pick}</p>
        ) : (
          <>
            <h3 className="truncate text-base font-semibold" title={picked.name}>
              {picked.name}
            </h3>
            <section>
              <h4 className="text-[13px] font-semibold text-neutral-700">{s.wording}</h4>
              <p className="whitespace-pre-wrap text-sm">{picked.wording ?? s.standardWording}</p>
            </section>
            <section>
              <h4 className="text-[13px] font-semibold text-neutral-700">{s.behaviour}</h4>
              <ul className="list-disc pl-5 text-sm">
                {behaviour(picked).map(line => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
            {(
              [
                [s.cues, picked.examples.cues],
                [s.nonCues, picked.examples.nonCues],
              ] as const
            ).map(([title, list]) => (
              <section key={title}>
                <h4 className="text-[13px] font-semibold text-neutral-700">{title}</h4>
                <ul className="list-disc pl-5 text-sm">
                  {list.map(line => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            ))}
            <section>
              <h4 className="text-[13px] font-semibold text-neutral-700">{s.lastTest}</h4>
              {testing.isLoading ? (
                <p className="text-sm" role="status">
                  {s.testing}
                </p>
              ) : picked.testResult ? (
                <>
                  <RiskCueTestView
                    result={picked.testResult}
                    passedText={s.testPassed(picked.testResult.version)}
                    failedText={s.testNotPassed(picked.testResult.version)}
                  />
                  {picked.testResult.version !== picked.version && (
                    <p className="text-[13px] text-neutral-600">
                      {s.testOld(picked.testResult.version)}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-neutral-600">{s.noTest}</p>
              )}
            </section>
            {error && (
              <p className="text-sm text-destructive-500" role="alert" data-testid="risk-cue-error">
                {error}
              </p>
            )}
            {turningDown && (
              <div className="flex flex-col gap-2">
                <TextArea
                  id="risk-cue-turn-down-note"
                  labelText={s.noteLabel}
                  rows={3}
                  value={note}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    kind="danger"
                    size="md"
                    disabled={!note.trim() || busy}
                    onClick={() =>
                      void act(
                        () => reject({ id: picked.id, note: note.trim() }).unwrap(),
                        s.turnedDown,
                        s.turnDownFailed,
                      ).then(ok => {
                        if (ok) {
                          setTurningDown(false);
                          setNote("");
                        }
                      })
                    }
                  >
                    {s.turnDown}
                  </Button>
                  <Button kind="ghost" size="md" onClick={() => setTurningDown(false)}>
                    {s.cancel}
                  </Button>
                </div>
              </div>
            )}
            {canReview && !turningDown && (
              <div className="flex flex-nowrap items-center gap-2">
                {picked.status !== "retired" && (
                  <>
                    <Button
                      kind="tertiary"
                      size="md"
                      disabled={busy}
                      onClick={() =>
                        void act(() => runTest(picked.id).unwrap(), null, s.testFailed)
                      }
                    >
                      {s.runTest}
                    </Button>
                    {picked.status === "awaiting_approval" && (
                      <>
                        <Button
                          kind="primary"
                          size="md"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () => approve({ id: picked.id }).unwrap(),
                              s.approved,
                              s.approveFailed,
                            )
                          }
                        >
                          {s.approve}
                        </Button>
                        <Button
                          kind="tertiary"
                          size="md"
                          disabled={busy}
                          onClick={() => setTurningDown(true)}
                        >
                          {s.turnDown}
                        </Button>
                      </>
                    )}
                  </>
                )}
                {picked.status === "approved" && picked.key !== "standard" && (
                  <Button
                    kind="tertiary"
                    size="md"
                    disabled={busy}
                    onClick={() => setRetiringOpen(true)}
                  >
                    {s.retire}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        isOpen={retiringOpen}
        title={s.retireTitle}
        cancelLabel={s.cancel}
        confirmLabel={s.retire}
        danger
        isWorking={retiring.isLoading}
        onConfirm={() => {
          if (!picked) return;
          void act(() => retire(picked.id).unwrap(), s.retired, s.retireFailed).then(ok => {
            if (ok) setRetiringOpen(false);
          });
        }}
        onClose={() => setRetiringOpen(false)}
      >
        <p>{s.retireBody}</p>
      </ConfirmDialog>
    </div>
  );
};
