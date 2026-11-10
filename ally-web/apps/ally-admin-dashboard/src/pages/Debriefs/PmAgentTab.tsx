import React, { useState } from "react";

import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
import {
  useBuildDebriefTestSetsMutation,
  useDecideIdeaMutation,
  useGetDebriefOverviewQuery,
  useGetPmAgentStateQuery,
  useRunPmAgentMutation,
  useScreenIdeaMutation,
} from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { PmAgentIdeaRow } from "@types";
import { getErrorMessage } from "@utils";

import { formatWhen } from "./consoleTable";

const SCREENABLE = new Set(["prompt_edit", "setting"]);

/** What approving does next: start the canary after a passed trial, promote after a passed canary. */
export const stage = (idea: PmAgentIdeaRow): "canary" | "promote" | null => {
  if (idea.evidence.canary?.status === "passed") return "promote";
  if (idea.evidence.canary?.status === "running") return null;
  return idea.evidence.trial?.status === "passed" ? "canary" : null;
};

const signed = (x: number | null | undefined) =>
  x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(2)}`;
const score = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(1));

/** The idea's climb through the test ladder (v9 FR-52): one line per rung. */
const Ladder: React.FC<{ idea: PmAgentIdeaRow }> = ({ idea }) => {
  const s = en.debriefs.pmAgent;
  const { screen: q, gate: g, trial: t, canary: c } = idea.evidence;
  const state = (x?: { status: string; passed?: boolean }) =>
    !x ? (
      <Pill tone="neutral">{s.rungWaiting}</Pill>
    ) : x.status === "running" ? (
      <Pill tone="info">{s.rungRunning}</Pill>
    ) : x.status === "failed" && x.passed === undefined ? (
      <Pill tone="warning">{s.rungFailed}</Pill>
    ) : x.passed || x.status === "passed" ? (
      <Pill tone="success">{s.rungPassed}</Pill>
    ) : (
      <Pill tone="neutral">{s.rungNotPassed}</Pill>
    );
  return (
    <ol className="flex flex-col gap-1 text-sm" data-testid="idea-ladder">
      <li className="flex flex-wrap items-center gap-2" data-testid="idea-screen">
        <span className="w-28 font-semibold">{s.ladder.quick}</span>
        {!q ? s.notScreened : state(q)}
        {q?.status === "done" && (
          <span>
            {s.screened(signed(q.lift), q.pairs)} · {formatUsd(q.costUsd)}
            {q.challengerFailures > 0 && ` · ${s.unfinished(q.challengerFailures)}`}
          </span>
        )}
      </li>
      <li className="flex flex-wrap items-center gap-2" data-testid="idea-gate">
        <span className="w-28 font-semibold">{s.ladder.gate}</span>
        {state(g)}
        {g?.status === "done" && (
          <span>
            {s.gateLine(score(g.baselineMedian), score(g.challengerMedian), g.pairs)}
            {!g.passed &&
              ` · ${Object.entries(g.rules)
                .filter(([, ok]) => !ok)
                .map(([k]) => s.gateRules[k])
                .join(", ")}`}
          </span>
        )}
      </li>
      <li className="flex flex-wrap items-center gap-2" data-testid="idea-trial">
        <span className="w-28 font-semibold">{s.ladder.trial}</span>
        {state(
          t && {
            status: t.status === "running" ? "running" : "done",
            passed: t.status === "passed",
          },
        )}
        {t && (
          <span>
            {s.trialLine(t.comparisons, signed(t.meanDifference), signed(t.lower), signed(t.upper))}
          </span>
        )}
      </li>
      <li className="flex flex-wrap items-center gap-2" data-testid="idea-canary">
        <span className="w-28 font-semibold">{s.ladder.canary}</span>
        {!c ? (
          <Pill tone="neutral">{s.rungWaiting}</Pill>
        ) : (
          <Pill
            tone={
              c.status === "passed" || c.status === "promoted"
                ? "success"
                : c.status === "reverted"
                  ? "warning"
                  : "info"
            }
          >
            {s.canaryStatus[c.status] ?? c.status}
          </Pill>
        )}
        {c && (
          <span>
            {s.canaryLine(
              Math.round(c.share * 100),
              c.canaryRuns ?? 0,
              score(c.canaryMedian),
              score(c.controlMedian),
            )}
            {c.reason && c.status === "reverted" && ` · ${c.reason}`}
          </span>
        )}
      </li>
    </ol>
  );
};

const IdeaCard: React.FC<{
  idea: PmAgentIdeaRow;
  onDecide: (d: "approve" | "reject") => void;
}> = ({ idea, onDecide }) => {
  const s = en.debriefs.pmAgent;
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
      {SCREENABLE.has(idea.change.ideaKind) && <Ladder idea={idea} />}
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
              disabled={stage(idea) === null}
              title={stage(idea) === null ? s.canaryNeedsTrial : undefined}
              onClick={() => onDecide("approve")}
            >
              {stage(idea) === "promote" ? s.promote : s.startCanary}
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

/** The PM agent: its report, its test sets, and its ideas with the approval layer. */
export const PmAgentTab: React.FC = () => {
  const s = en.debriefs.pmAgent;
  const state = useGetPmAgentStateQuery();
  const overview = useGetDebriefOverviewQuery();
  const [run, { isLoading: running }] = useRunPmAgentMutation();
  const [build, { isLoading: building }] = useBuildDebriefTestSetsMutation();
  const [decide, { isLoading: deciding }] = useDecideIdeaMutation();
  const [pending, setPending] = useState<{ id: string; decision: "approve" | "reject" } | null>(
    null,
  );

  const ideas = state.data?.ideas ?? [];
  const pendingIdea = pending ? ideas.find(i => i.id === pending.id) : undefined;
  const pendingStage = pendingIdea ? stage(pendingIdea) : null;

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
      toast.success(
        pending.decision === "approve"
          ? pendingStage === "promote"
            ? s.promoted
            : s.canaryStarted
          : s.rejected,
      );
      setPending(null);
    } catch (e) {
      toast.error(getErrorMessage(e, s.actionFailed));
    }
  };

  const o = overview.data;
  return (
    <div className="flex flex-col gap-8" data-testid="pm-agent-tab">
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
          <section className="flex flex-col gap-2" data-testid="pm-agent-report">
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
        title={
          pending?.decision === "approve"
            ? pendingStage === "promote"
              ? s.promoteTitle
              : s.canaryTitle
            : s.rejectTitle
        }
        cancelLabel={s.cancel}
        confirmLabel={
          pending?.decision === "approve"
            ? pendingStage === "promote"
              ? s.promoteConfirm
              : s.canaryConfirm
            : s.rejectConfirm
        }
        isWorking={deciding}
        onConfirm={() => void confirm()}
        onClose={() => setPending(null)}
      >
        <p>
          {pending?.decision === "approve"
            ? pendingStage === "promote"
              ? s.promoteBody
              : s.canaryBody
            : s.rejectBody}
        </p>
      </ConfirmDialog>
    </div>
  );
};
