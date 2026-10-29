import React, { useState } from "react";

import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
import {
  useBuildDebriefTestSetsMutation,
  useDecideIdeaMutation,
  useGetDebriefOverviewQuery,
  useGetImproverStateQuery,
  useRunImproverMutation,
  useScreenIdeaMutation,
} from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { ImproverIdeaRow } from "@types";
import { getErrorMessage } from "@utils";

import { formatWhen } from "./consoleTable";

const SCREENABLE = new Set(["prompt_edit", "setting"]);

const IdeaCard: React.FC<{
  idea: ImproverIdeaRow;
  onDecide: (d: "approve" | "reject") => void;
}> = ({ idea, onDecide }) => {
  const s = en.debriefs.improver;
  const [screen, { isLoading: screening }] = useScreenIdeaMutation();
  const r = idea.evidence.screen;
  const open = idea.status === "proposed";
  return (
    <li className="flex flex-col gap-2 border border-border-light p-4" data-testid="idea">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-base font-semibold text-typography-900">{idea.title}</h4>
        <Pill tone="neutral">{s.kinds[idea.change.ideaKind] ?? idea.change.ideaKind}</Pill>
        {(() => {
          // "Live" only while the release it went out in is the live one.
          const live = idea.status === "active" && idea.releaseStatus === "ga";
          const label =
            idea.status === "active" && !live
              ? s.noLongerLive
              : (s.ideaStatus[idea.status] ?? idea.status);
          return (
            <Pill tone={live ? "success" : idea.status === "proposed" ? "info" : "neutral"}>
              {label}
            </Pill>
          );
        })()}
      </div>
      {idea.evidence.hypothesis && (
        <p className="text-sm">
          <span className="font-semibold">{s.why}:</span> {idea.evidence.hypothesis}{" "}
          {idea.evidence.evidence}
        </p>
      )}
      {idea.evidence.expectedEffect && (
        <p className="text-sm">
          <span className="font-semibold">{s.expected}:</span> {idea.evidence.expectedEffect}
        </p>
      )}
      {idea.change.ideaKind === "prompt_edit" && idea.change.find && (
        <div className="text-sm">
          <p className="font-semibold">
            {s.change} · <span className="font-mono text-xs">{idea.change.promptCode}</span>
          </p>
          <p className="whitespace-pre-wrap bg-neutral-50 p-2 line-through">{idea.change.find}</p>
          <p className="font-semibold">{s.replaceWith}</p>
          <p className="whitespace-pre-wrap bg-neutral-50 p-2">{idea.change.replace}</p>
        </div>
      )}
      {idea.change.ideaKind === "setting" && (
        <p className="font-mono text-sm">
          {idea.change.settingKey} → {idea.change.settingValue}
        </p>
      )}
      {SCREENABLE.has(idea.change.ideaKind) && (
        <p className="text-sm" data-testid="idea-screen">
          {!r ? (
            s.notScreened
          ) : r.status === "running" ? (
            s.screening
          ) : r.status === "failed" ? (
            s.screenError
          ) : (
            <>
              <Pill tone={r.passed ? "success" : "neutral"}>
                {r.passed ? s.screenPassed : s.screenFailed}
              </Pill>{" "}
              {s.screened(
                r.lift == null ? "—" : `${r.lift > 0 ? "+" : ""}${r.lift.toFixed(2)}`,
                r.pairs,
              )}{" "}
              · {formatUsd(r.costUsd)}
              {r.challengerFailures > 0 && ` · ${s.unfinished(r.challengerFailures)}`}
            </>
          )}
        </p>
      )}
      {open && (
        <div className="flex flex-wrap gap-2">
          {SCREENABLE.has(idea.change.ideaKind) && (
            <Button
              kind="tertiary"
              size="sm"
              disabled={screening || r?.status === "running"}
              onClick={() =>
                void screen(idea.id)
                  .unwrap()
                  .catch(e => toast.error(getErrorMessage(e, s.actionFailed)))
              }
            >
              {screening || r?.status === "running" ? s.screening : s.screen}
            </Button>
          )}
          {SCREENABLE.has(idea.change.ideaKind) && (
            <Button
              kind="primary"
              size="sm"
              disabled={r?.status !== "done" || !r.passed}
              title={r?.status === "done" && r.passed ? undefined : s.approveNeedsScreen}
              onClick={() => onDecide("approve")}
            >
              {s.approve}
            </Button>
          )}
          <Button kind="tertiary" size="sm" onClick={() => onDecide("reject")}>
            {s.reject}
          </Button>
        </div>
      )}
    </li>
  );
};

/** The Improver: its report, its test sets, and its ideas with the approval layer. */
export const ImproverTab: React.FC = () => {
  const s = en.debriefs.improver;
  const state = useGetImproverStateQuery();
  const overview = useGetDebriefOverviewQuery();
  const [run, { isLoading: running }] = useRunImproverMutation();
  const [build, { isLoading: building }] = useBuildDebriefTestSetsMutation();
  const [decide, { isLoading: deciding }] = useDecideIdeaMutation();
  const [pending, setPending] = useState<{ id: string; decision: "approve" | "reject" } | null>(
    null,
  );

  const runNow = async () => {
    try {
      const res = await run().unwrap();
      if (res.skipped) toast.success(s.skipped(res.skipped));
      else toast.success(s.ran);
    } catch (e) {
      toast.error(getErrorMessage(e, s.runFailed));
    }
  };
  const confirm = async () => {
    if (!pending) return;
    try {
      await decide(pending).unwrap();
      toast.success(pending.decision === "approve" ? s.approved : s.rejected);
      setPending(null);
    } catch (e) {
      toast.error(getErrorMessage(e, s.actionFailed));
    }
  };

  const o = overview.data;
  return (
    <div className="flex flex-col gap-8" data-testid="improver-tab">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-normal text-typography-900">{s.heading}</h2>
          <p className="max-w-3xl pt-1 text-sm text-typography-700">{s.help}</p>
          {o && (
            <p className="pt-1 text-sm text-typography-700">
              {s.budget(
                formatUsd(o.budget.learningSpentUsd),
                formatUsd(o.budget.learningBudgetUsd),
              )}
            </p>
          )}
        </div>
        <Button kind="primary" size="md" disabled={running} onClick={() => void runNow()}>
          {running ? s.running : s.runNow}
        </Button>
      </div>

      {state.isError ? (
        <ErrorPanel what={s.loadFailed} error={state.error} onRetry={() => void state.refetch()} />
      ) : !state.data ? (
        <LoadingBlock lines={6} />
      ) : (
        <>
          <section className="flex flex-col gap-2" data-testid="improver-report">
            <h3 className="text-xl font-normal text-typography-900">{s.report}</h3>
            {state.data.report ? (
              <>
                <p className="text-xs text-typography-700">{s.ranAt(formatWhen(state.data.at))}</p>
                <p className="max-w-3xl whitespace-pre-wrap text-sm text-typography-900">
                  {state.data.report}
                </p>
              </>
            ) : (
              <p className="text-sm text-typography-700">{s.noReport}</p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1 text-xl font-normal text-typography-900">
              {s.testSets}
              <InfoTip label={s.testSetsHelp} ariaLabel="About the test sets" />
            </h3>
            <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="test-sets">
              {o &&
                Object.entries(o.testSets).map(([k, n]) => (
                  <Pill key={k} tone="neutral">
                    {s.sets[k] ?? k}: {n}
                  </Pill>
                ))}
              <Button kind="tertiary" size="sm" disabled={building} onClick={() => void build()}>
                {s.buildSets}
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xl font-normal text-typography-900">{s.ideas}</h3>
            {state.data.ideas.length === 0 ? (
              <EmptyPanel title={s.noIdeas} message={s.noReport} />
            ) : (
              <ul className="flex flex-col gap-3">
                {state.data.ideas.map(idea => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onDecide={decision => setPending({ id: idea.id, decision })}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        isOpen={pending !== null}
        title={pending?.decision === "approve" ? s.approveTitle : s.rejectTitle}
        cancelLabel={s.cancel}
        confirmLabel={pending?.decision === "approve" ? s.approveConfirm : s.rejectConfirm}
        isWorking={deciding}
        onConfirm={() => void confirm()}
        onClose={() => setPending(null)}
      >
        <p>{pending?.decision === "approve" ? s.approveBody : s.rejectBody}</p>
      </ConfirmDialog>
    </div>
  );
};
