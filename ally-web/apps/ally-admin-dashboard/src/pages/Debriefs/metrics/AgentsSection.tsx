import React, { ReactNode } from "react";

import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { DebriefAgentMetrics, DebriefOrchestratorMetrics, DebriefRate } from "@types";

import {
  BulletRows,
  CountBars,
  KappaScale,
  MiniStat,
  NumbersTable,
  RateDots,
  RateRow,
  SegmentBar,
  TimeRanges,
  TimeRow,
} from "./metricsCharts";
import { MIN_RATE_SAMPLE, rateWithRange, targetState } from "./metricsData";
import { ChartCard } from "../../Analytics/chartKit";
import { CONTEXT, PALETTE } from "../../Analytics/chartScales";
import { agentName, checkLabel, hardFailLabel, plannerFallbackLabel } from "../consoleLabels";

const fixed = (x: number | null | undefined, d = 1) =>
  x == null ? en.debriefs.metrics.none : x.toFixed(d);

const fallbackLabel = plannerFallbackLabel;

const codes = (list: Array<{ code: string; runs: number }>, label: (code: string) => string) =>
  list.length
    ? list
        .slice(0, 4)
        .map(f => `${label(f.code)} (${f.runs})`)
        .join(", ")
    : en.debriefs.metrics.none;

/**
 * The orchestrator's rows for the numbers table: the planner, the top-up, then
 * every registry agent and the agent-specific measures (ally-be
 * `orchestratorMetrics`). Nothing until a release with the orchestrator on has run.
 */
export const orchestratorRows = (
  o: DebriefOrchestratorMetrics,
  time: (h: { msP50: number | null; msP90: number | null }) => string,
): string[][] => {
  const a = en.debriefs.metrics.agents;
  const p = a.planner;
  const t = a.topUp;
  const g = a.registry;
  const r = rateWithRange;
  const mean = `${fixed(o.planner.agentsChosenMean)} / ${fixed(o.planner.agentsChosenP50, 0)}`;
  const rows: string[][] = [
    [p.name, p.runs, String(o.runs)],
    [p.name, p.fallback, r(o.planner.fallbackRate)],
    [p.name, p.timeout, r(o.planner.timeoutRate)],
    [p.name, p.reasons, codes(o.planner.fallbackReasons, fallbackLabel)],
    [p.name, p.time, time(o.planner)],
    [p.name, p.chosen, mean],
    [p.name, p.budget, r(o.planner.droppedForBudgetRate)],
    [p.name, p.deadline, r(o.planner.droppedForTimeRate)],
    [p.name, p.unavailable, r(o.planner.droppedUnavailableRate)],
    [p.name, p.mostChosen, codes(o.planner.chosen, agentName)],
    [p.name, p.skippedMissed, r(o.skippedThenMissed.overall)],
    ...o.skippedThenMissed.byAgent.flatMap(b => [
      [p.name, p.skippedMissedAgent(agentName(b.agent)), r(b.whenSkipped)],
      [p.name, p.chosenMissedAgent(agentName(b.agent)), r(b.whenChosen)],
    ]),
    [t.name, t.reached, r(o.topUp.reachedRate)],
    [t.name, t.added, r(o.topUp.addedRate)],
    [t.name, t.passAfter, r(o.topUp.passAfterTopUpRate)],
  ];
  for (const ag of o.agents) {
    const n = agentName(ag.agent);
    rows.push(
      [n, g.chosen, ag.floor ? g.floor : r(ag.chosenRate)],
      [n, g.fail, r(ag.failRate)],
      [n, g.time, time(ag)],
      [n, g.findings, fixed(ag.findingsPerRunMean)],
      [n, g.droppedQuotes, r(ag.droppedQuoteRate)],
      [n, g.used, r(ag.usedByWriterRate)],
      [n, g.hardFail, r(ag.judgedHardFailRate)],
      [n, g.topHardFails, codes(ag.topHardFails, hardFailLabel)],
    );
    if (ag.agent === "protocol_check") {
      rows.push(
        [n, g.contradicts, r(o.protocolCheck.contradictsProtocolRate)],
        [n, g.contradictsWithout, r(o.protocolCheck.contradictsProtocolWithoutRate)],
        [n, g.applied, r(o.protocolCheck.appliedRate)],
        [n, g.named, r(o.protocolCheck.protocolNamedRate)],
      );
    }
    if (ag.agent === "language_specialist") {
      rows.push(
        [n, g.languageSessions, String(o.languageSpecialist.sessions)],
        [n, g.languageWith, r(o.languageSpecialist.missWithRate)],
        [n, g.languageWithout, r(o.languageSpecialist.missWithoutRate)],
      );
    }
    if (ag.agent === "history_deep") {
      rows.push(
        [n, g.historyWith, r(o.historyDeep.unsupportedProgressWithRate)],
        [n, g.historyWithout, r(o.historyDeep.unsupportedProgressWithoutRate)],
      );
    }
    const agg = o.aggregates.find(x => x.agent === ag.agent);
    if (agg) {
      rows.push(
        [n, g.noQuote, r(agg.noQuoteRate)],
        [n, g.smallGroup, r(agg.smallGroupRefusedRate)],
      );
    }
  }
  return rows;
};

const timeWords = (h: { msP50: number | null; msP90: number | null }) => {
  const s = en.debriefs.metrics.agents;
  return h.msP50 == null || h.msP90 == null
    ? en.debriefs.metrics.none
    : s.time(s.seconds(h.msP50), s.seconds(h.msP90));
};

/** Every agent's numbers, one row per measure: the table view behind the charts. */
const allRows = (agents: DebriefAgentMetrics): string[][] => {
  const s = en.debriefs.metrics.agents;
  const { stages: st, askAlly, pmAgent } = agents;
  const r = rateWithRange;
  return [
    [s.safetyReader.name, s.safetyReader.fail, r(st.safetyReader.failRate)],
    [s.safetyReader.name, s.safetyReader.retry, r(st.safetyReader.retryRate)],
    [s.safetyReader.name, s.safetyReader.time, timeWords(st.safetyReader)],
    [s.safetyReader.name, s.safetyReader.riskCue, r(st.safetyReader.riskCueRate)],
    [
      s.safetyReader.name,
      s.safetyReader.missDespiteCoverage,
      r(st.safetyReader.judgeMissDespiteCoverage),
    ],
    [s.analyst.name, s.analyst.fail, r(st.analyst.failRate)],
    [s.analyst.name, s.analyst.time, timeWords(st.analyst)],
    [s.progressReader.name, s.progressReader.fail, r(st.progressReader.failRate)],
    [
      s.progressReader.name,
      s.progressReader.unsupported,
      r(st.progressReader.unsupportedProgressRate),
    ],
    [s.guidance.name, s.guidance.found, r(st.guidanceLookup.foundRate)],
    [s.guidance.name, s.guidance.perRun, fixed(st.guidanceLookup.passagesPerRunMean)],
    [s.guidance.name, s.guidance.clinicalNoRisk, r(st.guidanceLookup.clinicalOnNoRiskRate)],
    [s.guidance.name, s.guidance.wrongLevel, r(st.guidanceLookup.wrongLevelRate)],
    [s.writer.name, s.writer.firstDraft, r(st.writer.firstDraftPassRate)],
    [s.writer.name, s.writer.failures, codes(st.writer.firstDraftFailures, checkLabel)],
    [s.writer.name, s.writer.fail, r(st.writer.failRate)],
    [s.reviser.name, s.reviser.fix, r(st.reviser.fixRate)],
    [s.reviser.name, s.reviser.regression, r(st.reviser.regressionRate)],
    [s.reviser.name, s.reviser.deadline, r(st.reviser.deadlineSkipRate)],
    [s.evaluator.name, s.evaluator.kappa, fixed(st.evaluator.missedRiskCue.kappa, 2)],
    [s.evaluator.name, s.evaluator.recall, r(st.evaluator.missedRiskCue.recall)],
    [s.evaluator.name, s.evaluator.falseFlag, r(st.evaluator.missedRiskCue.falseFlagRate)],
    [s.evaluator.name, s.evaluator.held, r(st.evaluator.heldOnItsOwnRate)],
    [s.judge.name, s.judge.judged, r(st.judge.judgedRate)],
    [s.judge.name, s.judge.versions, st.judge.versions.join(", ") || en.debriefs.metrics.none],
    [s.askAlly.name, s.askAlly.replies, String(askAlly.replies)],
    [s.askAlly.name, s.askAlly.checks, r(askAlly.checkPassRate)],
    [s.askAlly.name, s.askAlly.pass, askAlly.passRate ? r(askAlly.passRate) : s.notMeasured],
    [s.askAlly.name, s.askAlly.distress, String(askAlly.distressFlags)],
    [
      s.askAlly.name,
      s.askAlly.cost,
      askAlly.costPerReplyMean == null
        ? en.debriefs.metrics.none
        : formatUsd(askAlly.costPerReplyMean),
    ],
    [s.pmAgent.name, s.pmAgent.ideas, String(pmAgent.ideas)],
    [s.pmAgent.name, s.pmAgent.tested, `${pmAgent.screened} / ${pmAgent.gated}`],
    [
      s.pmAgent.name,
      s.pmAgent.outcome,
      `${pmAgent.promoted} / ${pmAgent.reverted} / ${pmAgent.rejected} / ${pmAgent.pending}`,
    ],
    [s.pmAgent.name, s.pmAgent.held, rateWithRange(pmAgent.holdRate)],
    ...(st.orchestrator ? orchestratorRows(st.orchestrator, timeWords) : []),
  ];
};

const row = (key: string, label: ReactNode, rate: DebriefRate, sublabel?: ReactNode): RateRow => ({
  key,
  label,
  rate,
  sublabel,
});

/** One agent family: its name, and its measures as dot-and-whisker rows. */
const AgentCard: React.FC<{
  title: string;
  testId: string;
  stats?: ReactNode;
  rows?: RateRow[];
  sort?: boolean;
  children?: ReactNode;
}> = ({ title, testId, stats, rows, sort = false, children }) => (
  <ChartCard title={title}>
    <div className="flex flex-col gap-3" data-testid={testId}>
      {stats && <div className="flex flex-wrap gap-6">{stats}</div>}
      {rows && rows.length > 0 && <RateDots rows={rows} sort={sort} compact legend={false} />}
      {children}
    </div>
  </ChartCard>
);

const Sub: React.FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <div className="flex flex-col gap-1">
    <p className="text-xs font-medium text-typography-700">{title}</p>
    {children}
  </div>
);

/**
 * Live numbers for every agent in the debrief family. First the two views that
 * say which step is the problem (how often each gave nothing, and how long each
 * takes), then one card per agent family, then the full numbers as a table.
 */
/** Ask Ally's cost per reply against the PRD's ceiling, as a bullet like the guardrails' cost row. */
const AskAllyCost: React.FC<{ askAlly: DebriefAgentMetrics["askAlly"] }> = ({ askAlly }) => {
  const s = en.debriefs.metrics.agents.askAlly;
  const target = askAlly.costPerReplyTarget ?? 0.05;
  const mean = askAlly.costPerReplyMean ?? null;
  return (
    <BulletRows
      testId="ask-ally-cost"
      rows={[
        {
          key: "cost-per-reply",
          label: s.cost,
          targetLabel: s.costTarget(formatUsd(target)),
          value: mean,
          targets: [target],
          max: Math.max(target * 2, mean == null ? 0 : Math.ceil((mean * 1.2) / 0.01) * 0.01),
          words:
            mean == null ? (
              en.debriefs.metrics.none
            ) : (
              <span>
                {formatUsd(mean)}
                <span className="block text-xs text-typography-500">
                  {s.costSub(formatUsd(askAlly.spendUsd ?? 0), askAlly.replies)}
                </span>
              </span>
            ),
          state: targetState(mean, { atMost: target }, askAlly.replies),
        },
      ]}
    />
  );
};

export const AgentsSection: React.FC<{ agents: DebriefMetricsAgents }> = ({ agents }) => {
  const s = en.debriefs.metrics.agents;
  const c = en.debriefs.metrics.agentCharts;
  if (!agents) return null;
  const { stages: st, askAlly, pmAgent } = agents;
  const o = st.orchestrator;

  const failRows: RateRow[] = [
    row("safety", s.safetyReader.name, st.safetyReader.failRate),
    row("analyst", s.analyst.name, st.analyst.failRate),
    row("progress", s.progressReader.name, st.progressReader.failRate),
    row("writer", s.writer.name, st.writer.failRate),
    row("reviser", s.reviser.name, st.reviser.failRate),
    row("evaluator", s.evaluator.name, st.evaluator.failRate),
    ...(o
      ? [
          row("planner", s.planner.name, o.planner.failRate),
          ...o.agents.map(a => row(`agent-${a.agent}`, agentName(a.agent), a.failRate)),
        ]
      : []),
  ].filter(r => r.rate.of > 0);

  const timeRows: TimeRow[] = [
    { key: "safety", label: s.safetyReader.name, ...st.safetyReader },
    { key: "analyst", label: s.analyst.name, ...st.analyst },
    { key: "progress", label: s.progressReader.name, ...st.progressReader },
    { key: "writer", label: s.writer.name, ...st.writer },
    { key: "reviser", label: s.reviser.name, ...st.reviser },
    { key: "evaluator", label: s.evaluator.name, ...st.evaluator },
    ...(o
      ? [
          { key: "planner", label: s.planner.name, ...o.planner },
          ...o.agents.map(a => ({ key: `agent-${a.agent}`, label: agentName(a.agent), ...a })),
        ]
      : []),
  ].map(({ key, label, msP50, msP90 }) => ({ key, label, msP50, msP90 }));

  const agreement = st.evaluator.missedRiskCue;

  return (
    <section className="flex flex-col gap-4" data-testid="metrics-agents">
      <h3 className="flex items-center gap-1 text-xl font-normal text-typography-900">
        {s.heading}
        <InfoTip label={s.help} ariaLabel={`About ${s.heading}`} />
      </h3>
      <p className="-mt-2 text-xs text-typography-500">
        {en.debriefs.metrics.charts.thinLegend(MIN_RATE_SAMPLE)}
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title={c.failures}
          caption={c.failuresCaption}
          empty={!failRows.length}
          emptyText={c.empty}
          height="160px"
        >
          <RateDots rows={failRows} testId="agents-failures" />
        </ChartCard>
        <ChartCard title={c.time} caption={c.timeCaption}>
          <TimeRanges rows={timeRows} testId="agents-time" />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <AgentCard
          title={s.safetyReader.name}
          testId="agent-safety-reader"
          rows={[
            row("retry", s.safetyReader.retry, st.safetyReader.retryRate),
            row("risk", s.safetyReader.riskCue, st.safetyReader.riskCueRate),
            row(
              "miss",
              s.safetyReader.missDespiteCoverage,
              st.safetyReader.judgeMissDespiteCoverage,
            ),
          ]}
        />
        <AgentCard
          title={c.readers}
          testId="agent-readers"
          rows={[
            row(
              "progress-unsupported",
              s.progressReader.unsupported,
              st.progressReader.unsupportedProgressRate,
              s.progressReader.name,
            ),
          ]}
        />
        <AgentCard
          title={s.guidance.name}
          testId="agent-guidance"
          stats={
            <MiniStat
              label={s.guidance.perRun}
              value={fixed(st.guidanceLookup.passagesPerRunMean)}
            />
          }
          rows={[
            row("found", s.guidance.found, st.guidanceLookup.foundRate),
            row("clinical", s.guidance.clinicalNoRisk, st.guidanceLookup.clinicalOnNoRiskRate),
            row("level", s.guidance.wrongLevel, st.guidanceLookup.wrongLevelRate),
          ]}
        />
        <AgentCard
          title={s.writer.name}
          testId="agent-writer"
          rows={[row("first", s.writer.firstDraft, st.writer.firstDraftPassRate)]}
        >
          <Sub title={c.writerFailures}>
            <CountBars
              items={st.writer.firstDraftFailures.map(f => ({
                label: checkLabel(f.code),
                count: f.runs,
              }))}
              testId="writer-failures"
            />
          </Sub>
        </AgentCard>
        <AgentCard
          title={s.reviser.name}
          testId="agent-reviser"
          rows={[
            row("fix", s.reviser.fix, st.reviser.fixRate),
            row("regression", s.reviser.regression, st.reviser.regressionRate),
            row("deadline", s.reviser.deadline, st.reviser.deadlineSkipRate),
          ]}
        />
        <AgentCard
          title={s.evaluator.name}
          testId="agent-evaluator"
          rows={[
            row("recall", s.evaluator.recall, agreement.recall),
            row("false", s.evaluator.falseFlag, agreement.falseFlagRate),
            row("held", s.evaluator.held, st.evaluator.heldOnItsOwnRate),
          ]}
        >
          <Sub title={s.evaluator.kappa}>
            <KappaScale kappa={agreement.kappa} n={agreement.n} />
          </Sub>
        </AgentCard>
        <AgentCard
          title={s.judge.name}
          testId="agent-judge"
          rows={[row("judged", s.judge.judged, st.judge.judgedRate)]}
        >
          <p className="text-xs text-typography-700">
            {c.judgeVersions(st.judge.versions.join(", ") || en.debriefs.metrics.none)}
          </p>
        </AgentCard>
        <AgentCard
          title={s.askAlly.name}
          testId="agent-ask-ally"
          stats={
            <>
              <MiniStat label={s.askAlly.replies} value={askAlly.replies} />
              <MiniStat label={s.askAlly.distress} value={askAlly.distressFlags} />
            </>
          }
          rows={[
            row("checks", s.askAlly.checks, askAlly.checkPassRate),
            ...(askAlly.passRate ? [row("pass", s.askAlly.pass, askAlly.passRate)] : []),
          ]}
        >
          {!askAlly.passRate && (
            <p className="text-xs text-typography-500">
              {s.askAlly.pass}: {s.notMeasured}
            </p>
          )}
          {askAlly.costPerReplyTarget != null && <AskAllyCost askAlly={askAlly} />}
        </AgentCard>
        <AgentCard
          title={s.pmAgent.name}
          testId="agent-pm"
          stats={
            <>
              <MiniStat label={s.pmAgent.ideas} value={pmAgent.ideas} />
              <MiniStat label={s.pmAgent.tested} value={`${pmAgent.screened} / ${pmAgent.gated}`} />
            </>
          }
          rows={[row("held", s.pmAgent.held, pmAgent.holdRate)]}
        >
          <Sub title={c.outcome}>
            <SegmentBar
              testId="pm-outcome"
              parts={[
                { label: c.outcomes.promoted, count: pmAgent.promoted, color: PALETTE.green },
                { label: c.outcomes.reverted, count: pmAgent.reverted, color: PALETTE.red },
                { label: c.outcomes.rejected, count: pmAgent.rejected, color: CONTEXT.strong },
                { label: c.outcomes.pending, count: pmAgent.pending, color: CONTEXT.faint },
              ]}
            />
          </Sub>
        </AgentCard>
      </div>

      {o && <OrchestratorCards o={o} />}

      <NumbersTable
        testId="metrics-agents-table"
        summary={c.allNumbers}
        head={[s.cols.agent, s.cols.measure, s.cols.value]}
        rows={allRows(agents)}
      />
    </section>
  );
};

type DebriefMetricsAgents = DebriefAgentMetrics | undefined;

/** The planner, top-up, skipped-then-missed and one card per agent the planner chooses. */
const OrchestratorCards: React.FC<{ o: DebriefOrchestratorMetrics }> = ({ o }) => {
  const s = en.debriefs.metrics.agents;
  const c = en.debriefs.metrics.agentCharts;
  const p = s.planner;
  const g = s.registry;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <AgentCard
          title={c.planner}
          testId="agent-planner"
          stats={
            <>
              <MiniStat label={p.runs} value={o.runs} />
              <MiniStat
                label={p.chosen}
                value={`${fixed(o.planner.agentsChosenMean)} / ${fixed(o.planner.agentsChosenP50, 0)}`}
              />
            </>
          }
          rows={[
            row("fallback", p.fallback, o.planner.fallbackRate),
            row("timeout", p.timeout, o.planner.timeoutRate),
            row("budget", p.budget, o.planner.droppedForBudgetRate),
            row("deadline", p.deadline, o.planner.droppedForTimeRate),
            row("unavailable", p.unavailable, o.planner.droppedUnavailableRate),
          ]}
        >
          <Sub title={c.plannerReasons}>
            <CountBars
              items={o.planner.fallbackReasons.map(f => ({
                label: fallbackLabel(f.code),
                count: f.runs,
              }))}
            />
          </Sub>
          <Sub title={c.plannerChosen}>
            <CountBars
              items={o.planner.chosen.map(f => ({ label: agentName(f.code), count: f.runs }))}
            />
          </Sub>
        </AgentCard>
        <AgentCard
          title={c.topUp}
          testId="agent-top-up"
          rows={[
            row("reached", s.topUp.reached, o.topUp.reachedRate),
            row("added", s.topUp.added, o.topUp.addedRate),
            row("pass", s.topUp.passAfter, o.topUp.passAfterTopUpRate),
          ]}
        />
        <AgentCard
          title={c.skipped}
          testId="agent-skipped"
          rows={[
            row("overall", c.skippedOverall, o.skippedThenMissed.overall),
            ...o.skippedThenMissed.byAgent.flatMap(b => [
              row(`${b.agent}-skipped`, agentName(b.agent), b.whenSkipped, c.whenSkipped),
              row(`${b.agent}-chosen`, agentName(b.agent), b.whenChosen, c.whenRan),
            ]),
          ]}
        />
      </div>
      <h4 className="text-base font-semibold text-typography-900">{c.registryHeading}</h4>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {o.agents.map(ag => {
          const agg = o.aggregates.find(x => x.agent === ag.agent);
          const extra: RateRow[] =
            ag.agent === "protocol_check"
              ? [
                  row("contradicts", g.contradicts, o.protocolCheck.contradictsProtocolRate),
                  row(
                    "contradicts-without",
                    g.contradictsWithout,
                    o.protocolCheck.contradictsProtocolWithoutRate,
                  ),
                  row("applied", g.applied, o.protocolCheck.appliedRate),
                  row("named", g.named, o.protocolCheck.protocolNamedRate),
                ]
              : ag.agent === "language_specialist"
                ? [
                    row("with", g.languageWith, o.languageSpecialist.missWithRate),
                    row("without", g.languageWithout, o.languageSpecialist.missWithoutRate),
                  ]
                : ag.agent === "history_deep"
                  ? [
                      row("with", g.historyWith, o.historyDeep.unsupportedProgressWithRate),
                      row(
                        "without",
                        g.historyWithout,
                        o.historyDeep.unsupportedProgressWithoutRate,
                      ),
                    ]
                  : [];
          return (
            <AgentCard
              key={ag.agent}
              title={agentName(ag.agent)}
              testId={`agent-registry-${ag.agent}`}
              stats={
                <>
                  <MiniStat label={g.findings} value={fixed(ag.findingsPerRunMean)} />
                  {ag.floor && <MiniStat label={g.chosen} value={g.floor} />}
                  {ag.agent === "language_specialist" && (
                    <MiniStat label={g.languageSessions} value={o.languageSpecialist.sessions} />
                  )}
                </>
              }
              rows={[
                ...(ag.floor ? [] : [row("chosen", g.chosen, ag.chosenRate)]),
                row("used", g.used, ag.usedByWriterRate),
                row("dropped", g.droppedQuotes, ag.droppedQuoteRate),
                row("hard-fail", g.hardFail, ag.judgedHardFailRate),
                ...extra,
                ...(agg
                  ? [
                      row("no-quote", g.noQuote, agg.noQuoteRate),
                      row("small-group", g.smallGroup, agg.smallGroupRefusedRate),
                    ]
                  : []),
              ]}
            >
              {ag.topHardFails.length > 0 && (
                <Sub title={g.topHardFails}>
                  <CountBars
                    items={ag.topHardFails.map(f => ({
                      label: hardFailLabel(f.code),
                      count: f.runs,
                    }))}
                  />
                </Sub>
              )}
            </AgentCard>
          );
        })}
      </div>
    </>
  );
};
