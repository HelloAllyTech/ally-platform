import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import { Button, InlineNotification, SidePanel, SkeletonText, Tag } from "@ally-ui-mono/ui-shared";
import { useCancelBuilderEvalSuiteMutation, useGetBuilderEvalSuiteQuery } from "@api";
import { en } from "@constants";
import type {
  BuilderEvalFixture,
  BuilderEvalFixtureKind,
  BuilderEvalRun,
  BuilderEvalSuiteDetail,
} from "@types";
import { asAgentText } from "@utils/agentAuthored";

import {
  asArray,
  checklistOf,
  EVAL_POLL_MS,
  formatEvalCost,
  formatJudgeScore,
  formatPassed,
  formatRunDuration,
  formatStarted,
  gateEntries,
  gateViolationCount,
  groupRunsByFixture,
  RUN_STATUS_TAG_TYPE,
  SUITE_STATUS_TAG_TYPE,
  SUITE_TRIGGER_TAG_TYPE,
} from "./evalFormat";
import { EvalTranscript } from "./EvalTranscript";

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-col">
    <span className="text-xs text-typography-500">{label}</span>
    <span className="text-sm font-medium tabular-nums text-typography-900">{value}</span>
  </div>
);

/* ── One run ────────────────────────────────────────────────────────────── */

interface RunCardProps {
  run: BuilderEvalRun;
  /** What the fixture is. A PRD-review run has no interview: no turns, corrections or transcript. */
  kind: BuilderEvalFixtureKind | null;
  /** The fixture's checklist, by item id, so the judge's verdicts can say what they judged. */
  checklistText: Map<string, string>;
}

/**
 * One fixture played once. The header always shows the outcome and which gates
 * failed (the thing to scan a suite for); everything else is behind "Details" so
 * that thirty runs stay readable.
 */
const RunCard: React.FC<RunCardProps> = ({ run, kind, checklistText }) => {
  const strings = en.builder.eval.runCard;
  const [expanded, setExpanded] = useState(false);
  // The fixture's kind when it is known; otherwise the critic outcome only a review run carries.
  const isReview = kind === "prd_review" || (kind === null && Boolean(run.critic));

  const gates = gateEntries(run.gates);
  const failingGates = gates.filter(gate => gate.failing);
  const metrics = run.metrics;
  const judge = run.judge;
  const judgeItems = asArray<NonNullable<BuilderEvalRun["judge"]>["items"][number]>(judge?.items);
  const critic = run.critic;
  const correctedItems = asArray<string>(metrics?.correctedItems);

  return (
    <li className="flex flex-col gap-2 border border-neutral-200 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-typography-900">
          {strings.run(run.repetition)}
        </span>
        <Tag type={RUN_STATUS_TAG_TYPE[run.status] ?? "cool-gray"} size="sm" className="shrink-0">
          {strings.status[run.status] ?? run.status}
        </Tag>
        <span className="text-xs text-typography-600">
          {formatRunDuration(metrics?.durationMs)}
        </span>
        {!isReview && metrics && (
          <span className="text-xs text-typography-600">
            {strings.turns(metrics.turns)} · {strings.corrections(metrics.corrections)}
          </span>
        )}
        {isReview && critic && (
          <span
            className={`text-xs ${critic.asExpected ? "text-typography-600" : "text-destructive-600"}`}
          >
            {critic.asExpected ? strings.criticShortAsExpected : strings.criticShortNotAsExpected}
          </span>
        )}
        {judge && judge.total > 0 && (
          <span className="text-xs text-typography-600">
            {strings.judge(judge.met, judge.total)}
          </span>
        )}
        {metrics && (
          <span className="text-xs text-typography-600">{formatEvalCost(metrics.costUsd)}</span>
        )}
        <span className="flex-1" />
        <Button
          kind="ghost"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(current => !current)}
        >
          {expanded ? strings.hideDetails : strings.showDetails}
        </Button>
      </div>

      {run.gates && (
        <div className="flex flex-wrap items-center gap-1.5">
          {failingGates.length === 0 ? (
            <span className="text-xs text-typography-600">{strings.gatesClean}</span>
          ) : (
            failingGates.map(gate => (
              <Tag key={gate.key} type="red" size="sm" className="shrink-0">
                {strings.gateFailing(
                  en.builder.eval.gates[gate.key].label,
                  typeof gate.value === "number" ? gate.value : null,
                )}
              </Tag>
            ))
          )}
        </div>
      )}

      {run.error && (
        <p className="whitespace-pre-wrap text-xs text-destructive-600">
          {strings.error(asAgentText(run.error))}
        </p>
      )}

      {expanded && (
        <div className="flex flex-col gap-4 border-t border-neutral-200 pt-3">
          {run.gates && (
            <section>
              <h5 className="mb-1 text-xs font-semibold tracking-wide text-typography-500">
                {strings.gatesHeading(gateViolationCount(run.gates))}
              </h5>
              <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
                {gates.map(gate => (
                  <li
                    key={gate.key}
                    className={`flex justify-between gap-2 text-xs ${
                      gate.failing ? "font-semibold text-destructive-600" : "text-typography-600"
                    }`}
                  >
                    <span>{en.builder.eval.gates[gate.key].label}</span>
                    <span className="tabular-nums">
                      {typeof gate.value === "number"
                        ? gate.value
                        : gate.value
                          ? strings.yes
                          : strings.no}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!isReview && metrics && (
            <section>
              <h5 className="mb-1 text-xs font-semibold tracking-wide text-typography-500">
                {strings.metricsHeading}
              </h5>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                <Stat label={strings.metric.turns} value={String(metrics.turns)} />
                <Stat label={strings.metric.questions} value={String(metrics.questions)} />
                <Stat label={strings.metric.corrections} value={String(metrics.corrections)} />
                <Stat
                  label={strings.metric.ready}
                  value={
                    metrics.readyReached
                      ? strings.readyYes(metrics.readinessScore)
                      : strings.readyNo(metrics.readinessScore)
                  }
                />
                <Stat
                  label={strings.metric.toolCalls}
                  value={strings.toolCalls(metrics.toolCalls, metrics.toolFailures)}
                />
                <Stat label={strings.metric.cost} value={formatEvalCost(metrics.costUsd)} />
              </dl>
              {correctedItems.length > 0 && (
                <p className="mt-1 text-xs text-typography-600">
                  {strings.correctedItems(correctedItems.map(String).join(", "))}
                </p>
              )}
            </section>
          )}

          {judge && (
            <section>
              <h5 className="mb-1 text-xs font-semibold tracking-wide text-typography-500">
                {strings.judgeHeading(judge.met, judge.total, formatJudgeScore(judge.score))}
              </h5>
              {judge.error && (
                <p className="mb-1 text-xs text-destructive-600">
                  {strings.judgeError(asAgentText(judge.error))}
                </p>
              )}
              {judgeItems.length === 0 ? (
                <p className="text-xs text-typography-600">{strings.judgeNone}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {judgeItems.map((item, index) => (
                    <li key={`${asAgentText(item?.id)}-${index}`} className="flex flex-col gap-0.5">
                      <div className="flex items-baseline gap-2">
                        <span
                          className={`shrink-0 text-xs font-semibold ${
                            item?.met ? "text-success-600" : "text-destructive-600"
                          }`}
                        >
                          {item?.met ? strings.met : strings.unmet}
                        </span>
                        <span className="min-w-0 flex-1 text-sm text-typography-900">
                          <span className="font-mono text-xs text-typography-500">
                            {asAgentText(item?.id)}
                          </span>{" "}
                          {checklistText.get(asAgentText(item?.id)) ?? ""}
                        </span>
                      </div>
                      {asAgentText(item?.evidence) && (
                        <p className="whitespace-pre-wrap pl-4 text-xs text-typography-600">
                          {asAgentText(item?.evidence)}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {critic && (
            <section>
              <h5 className="mb-1 text-xs font-semibold tracking-wide text-typography-500">
                {strings.criticHeading}
              </h5>
              <p
                className={`text-sm font-medium ${
                  critic.asExpected ? "text-success-600" : "text-destructive-600"
                }`}
              >
                {critic.asExpected ? strings.criticAsExpected : strings.criticNotAsExpected}
              </p>
              <p className="text-xs text-typography-600">
                {asArray<string>(critic.blockingRows).length > 0
                  ? strings.criticBlockedOn(asArray<string>(critic.blockingRows).join(", "))
                  : strings.criticDidNotBlock}
              </p>
              {asArray<NonNullable<BuilderEvalRun["critic"]>["findings"][number]>(critic.findings)
                .length > 0 && (
                <ul className="mt-1 flex flex-col gap-1">
                  {asArray<NonNullable<BuilderEvalRun["critic"]>["findings"][number]>(
                    critic.findings,
                  ).map((finding, index) => (
                    <li key={index} className="text-xs text-typography-700">
                      <span className="font-semibold">{asAgentText(finding?.category)}</span>
                      {": "}
                      {asAgentText(finding?.detail)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {!isReview && (
            <section>
              <h5 className="mb-1 text-xs font-semibold tracking-wide text-typography-500">
                {strings.transcriptHeading}
              </h5>
              <EvalTranscript turns={run.transcript} />
            </section>
          )}
        </div>
      )}
    </li>
  );
};

/* ── The panel ──────────────────────────────────────────────────────────── */

interface SuiteDetailPanelProps {
  suiteId: string | null;
  fixtures: BuilderEvalFixture[] | undefined;
  onClose: () => void;
  /** Open another suite (the baseline a gate compared against). */
  onOpenSuite: (id: string) => void;
}

const SuiteBody: React.FC<{
  suite: BuilderEvalSuiteDetail;
  fixtures: BuilderEvalFixture[] | undefined;
  onOpenSuite: (id: string) => void;
  onCancel?: () => Promise<void>;
}> = ({ suite, fixtures, onOpenSuite, onCancel }) => {
  const strings = en.builder.eval.suiteDetail;
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const summary = suite.summary;
  const groups = groupRunsByFixture(suite, fixtures);
  const liveFixtures = new Map(asArray<BuilderEvalFixture>(fixtures).map(row => [row.id, row]));
  const reasons = asArray<string>(suite.verdict?.reasons);
  const candidate = suite.candidate;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Tag
          type={SUITE_TRIGGER_TAG_TYPE[suite.trigger] ?? "cool-gray"}
          size="sm"
          className="shrink-0"
        >
          {en.builder.eval.trigger[suite.trigger] ?? suite.trigger}
        </Tag>
        <Tag
          type={SUITE_STATUS_TAG_TYPE[suite.status] ?? "cool-gray"}
          size="sm"
          className="shrink-0"
        >
          {en.builder.eval.suiteStatus[suite.status] ?? suite.status}
        </Tag>
        <span className="text-xs text-typography-600">
          {strings.startedAt(formatStarted(suite.createdAt))} ·{" "}
          {strings.shape(asArray(suite.fixtureIds).length, suite.repetitions)}
        </span>
      </div>

      {suite.status === "running" && (
        <p className="text-sm text-typography-700">
          {strings.running(
            // The runs are all created queued when the suite starts, so what is worth
            // counting is how many have finished, not how many exist.
            asArray<BuilderEvalRun>(suite.runs).filter(
              run => run.status !== "queued" && run.status !== "running",
            ).length,
            asArray(suite.fixtureIds).length * suite.repetitions,
          )}
        </p>
      )}

      {/* Two steps, not one: a suite is dozens of paid runs, and a stray click
          should not throw away the ones still to come. A plain div, not a
          notification — the controls are buttons. */}
      {suite.status === "running" && onCancel && (
        <div className="flex flex-wrap items-center gap-2">
          {confirmingCancel ? (
            <>
              <p className="w-full text-sm text-typography-700">{strings.cancelAsk}</p>
              <Button
                kind="danger"
                size="sm"
                disabled={cancelling}
                onClick={async () => {
                  setCancelling(true);
                  try {
                    await onCancel();
                    setConfirmingCancel(false);
                  } finally {
                    setCancelling(false);
                  }
                }}
              >
                {strings.cancelConfirm}
              </Button>
              <Button
                kind="ghost"
                size="sm"
                disabled={cancelling}
                onClick={() => setConfirmingCancel(false)}
              >
                {strings.cancelKeep}
              </Button>
            </>
          ) : (
            <Button kind="danger--ghost" size="sm" onClick={() => setConfirmingCancel(true)}>
              {strings.cancel}
            </Button>
          )}
        </div>
      )}

      {suite.error && (
        <InlineNotification
          kind={suite.status === "cancelled" ? "info" : "error"}
          lowContrast
          hideCloseButton
          title={suite.status === "cancelled" ? strings.cancelledTitle : strings.errored}
          subtitle={asAgentText(suite.error)}
        />
      )}

      {summary && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
          <Stat label={strings.stat.passed} value={formatPassed(summary.passed, summary.runs)} />
          <Stat label={strings.stat.gateViolations} value={String(summary.gateViolations)} />
          <Stat label={strings.stat.corrections} value={String(summary.corrections)} />
          <Stat label={strings.stat.judge} value={formatJudgeScore(summary.judgeScore)} />
          <Stat label={strings.stat.cost} value={formatEvalCost(summary.costUsd)} />
        </dl>
      )}

      {candidate && (
        <section className="flex flex-col gap-1">
          <h4 className="text-sm font-semibold text-typography-900">{strings.candidateHeading}</h4>
          <p className="font-mono text-xs text-typography-700">{candidate.promptCode}</p>
          <ul className="list-disc pl-5 text-xs text-typography-600">
            {candidate.content ? <li>{strings.candidateText(candidate.content.length)}</li> : null}
            {candidate.model !== undefined && (
              <li>{strings.candidateModel(candidate.model || null, candidate.provider || null)}</li>
            )}
            {typeof candidate.temperature === "number" && (
              <li>{strings.candidateTemperature(candidate.temperature)}</li>
            )}
          </ul>
        </section>
      )}

      {suite.trigger === "prompt_gate" && (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-typography-900">{strings.verdictHeading}</h4>
          {suite.verdict ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Tag type={suite.verdict.pass ? "green" : "red"} size="sm" className="shrink-0">
                  {suite.verdict.pass ? strings.verdictPass : strings.verdictFail}
                </Tag>
                <span className="text-xs text-typography-600">
                  {suite.publishedAt
                    ? strings.published(formatStarted(suite.publishedAt))
                    : suite.verdict.pass
                      ? strings.passedNotPublished
                      : strings.notPublished}
                </span>
              </div>
              {reasons.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-typography-700">
                  {reasons.map((reason, index) => (
                    <li key={index}>{asAgentText(reason)}</li>
                  ))}
                </ul>
              )}
              {suite.verdict.baselineSuiteId && (
                <div>
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() => onOpenSuite(suite.verdict?.baselineSuiteId as string)}
                  >
                    {strings.openBaseline}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-typography-600">
              {suite.status === "running" ? strings.verdictPending : strings.verdictNone}
            </p>
          )}
        </section>
      )}

      <details className="text-xs text-typography-600">
        <summary className="cursor-pointer">{strings.gatesLegend}</summary>
        <ul className="mt-1 flex flex-col gap-1 pl-3">
          {(Object.keys(en.builder.eval.gates) as (keyof typeof en.builder.eval.gates)[]).map(
            key => (
              <li key={key}>
                <span className="font-semibold">{en.builder.eval.gates[key].label}</span>
                {": "}
                {en.builder.eval.gates[key].hint}
              </li>
            ),
          )}
        </ul>
        <p className="mt-2">{strings.passRule}</p>
      </details>

      {groups.length === 0 ? (
        <p className="text-sm text-typography-600">{strings.noRuns}</p>
      ) : (
        groups.map(group => {
          const live = liveFixtures.get(group.fixtureId);
          const checklistText = new Map(
            (live ? checklistOf(live) : []).map(item => [item.id, item.text]),
          );
          return (
            <section key={group.fixtureId} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-typography-900">
                  {group.name ?? strings.deletedFixture}
                </h4>
                <span className="shrink-0 text-xs text-typography-600">
                  {strings.fixturePassed(group.passed, group.runs.length)}
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {group.runs.map(run => (
                  <RunCard key={run.id} run={run} kind={group.kind} checklistText={checklistText} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
};

/**
 * A suite, run by run. Reads the suite with its runs and polls it while it is
 * still running, so a suite opened mid-flight fills in as runs finish.
 */
export const SuiteDetailPanel: React.FC<SuiteDetailPanelProps> = ({
  suiteId,
  fixtures,
  onClose,
  onOpenSuite,
}) => {
  const strings = en.builder.eval.suiteDetail;
  const [pollMs, setPollMs] = useState(0);
  const { data, isLoading, isError, refetch } = useGetBuilderEvalSuiteQuery(suiteId ?? "", {
    skip: !suiteId,
    pollingInterval: pollMs,
  });
  const [cancelSuite] = useCancelBuilderEvalSuiteMutation();
  const handleCancel = async () => {
    if (!suiteId) return;
    try {
      await cancelSuite(suiteId).unwrap();
    } catch {
      toast.error(strings.cancelFailed);
    }
  };

  // `data` lingers from the previous suite while a new one loads, so it only counts
  // as "running" when it is the suite on screen.
  const running = Boolean(suiteId) && data?.id === suiteId && data?.status === "running";
  useEffect(() => {
    setPollMs(running ? EVAL_POLL_MS : 0);
  }, [running, suiteId]);

  return (
    <SidePanel
      open={Boolean(suiteId)}
      onClose={onClose}
      title={strings.title}
      className="w-[60vw] min-w-[600px]"
      closeLabel={strings.close}
    >
      {isLoading ? (
        <SkeletonText paragraph lineCount={6} />
      ) : isError || !data ? (
        <div className="flex flex-col items-start gap-2">
          <InlineNotification kind="error" lowContrast hideCloseButton title={strings.loadFailed} />
          <Button kind="tertiary" size="sm" onClick={() => void refetch()}>
            {strings.retry}
          </Button>
        </div>
      ) : (
        <SuiteBody
          suite={data}
          fixtures={fixtures}
          onOpenSuite={onOpenSuite}
          onCancel={handleCancel}
        />
      )}
    </SidePanel>
  );
};
