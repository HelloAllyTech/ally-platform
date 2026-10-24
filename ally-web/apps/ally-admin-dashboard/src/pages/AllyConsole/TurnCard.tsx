import React from "react";

import { useGetAllyGuideTurnTraceQuery } from "@api";
import { formatMs, formatCount, formatUsd } from "@components/ally-guide/allyGuideFormat";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill, PillTone } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { AllyGuideThreadTrace, AllyGuideTraceSummary } from "@types";
import { formatTimestamp } from "@utils";

import { SaveEvalCaseButton } from "./SaveEvalCaseButton";
import { StageWaterfall } from "./StageWaterfall";
import { TurnPayload } from "./TurnPayload";

interface TurnCardProps {
  trace: AllyGuideThreadTrace;
  /** "v3" for the release this turn ran on, when the release list knows it. */
  releaseLabel: string | null;
  expanded: boolean;
  /** This turn's message is the one chosen in the transcript. */
  highlighted: boolean;
  /** Payloads hold the learner's words: only offered with the transcripts grant. */
  canReadPayload: boolean;
  onToggle: () => void;
}

const Fact: React.FC<{
  label: string;
  help?: string;
  children: React.ReactNode;
  testId?: string;
}> = ({ label, help, children, testId }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="flex items-center gap-1 text-xs tracking-wide text-typography-700">
      {label}
      {help && <InfoTip label={help} ariaLabel={`About ${label}`} />}
    </dt>
    <dd className="break-words text-sm text-typography-900" data-testid={testId}>
      {children}
    </dd>
  </div>
);

const Heading: React.FC<{ children: React.ReactNode; help?: string }> = ({ children, help }) => (
  <h4 className="mb-2 flex items-center gap-1 text-base font-semibold text-typography-900">
    {children}
    {help && <InfoTip label={help} ariaLabel="More information" />}
  </h4>
);

const steerText = (steer: AllyGuideTraceSummary["steer"]): string => {
  const strings = en.allyConsole.inspector;
  if (!steer) return strings.steerNone;
  const meaning = strings.steerLevels[String(steer.level)];
  const level = `Level ${steer.level}${meaning ? ` (${meaning})` : ""}`;
  return steer.reason ? `${level}: ${steer.reason}` : level;
};

const modeText = (summary: AllyGuideTraceSummary): string => {
  const strings = en.allyConsole.inspector;
  const label = (mode: string | null) => (mode ? (en.allyConsole.modes[mode] ?? mode) : "—");
  if (summary.modeBefore === summary.modeAfter)
    return strings.modeUnchanged(label(summary.modeAfter));
  return strings.modeChanged(label(summary.modeBefore), label(summary.modeAfter));
};

const epochText = (summary: AllyGuideTraceSummary): string => {
  const strings = en.allyConsole.inspector;
  if (!summary.epoch) return "—";
  return summary.epoch.isNew
    ? strings.epochNew(summary.epoch.number, summary.epoch.reason, summary.epoch.historyMessages)
    : strings.epochContinued(summary.epoch.number, summary.epoch.historyMessages);
};

const replyTone = (kind: string | null): PillTone =>
  kind === "crisis" ? "danger" : kind === "refusal" ? "warning" : "neutral";

/**
 * One turn in the Turn Inspector. Collapsed it is a single line (time, outcome, reply kind, timing,
 * cost); open it is the whole story of that turn: the stage waterfall, why Ally steered as it did,
 * what the safety monitor decided, which tools and cards were used, what it cost, how the epoch and
 * release were set, and, with the transcripts grant, the payload.
 *
 * The single-turn endpoint is read only once the card is open. It adds what the summary lacks: what
 * started the turn, the channel, the turn's own status and error code, and whether a payload exists.
 */
export const TurnCard: React.FC<TurnCardProps> = ({
  trace,
  releaseLabel,
  expanded,
  highlighted,
  canReadPayload,
  onToggle,
}) => {
  const strings = en.allyConsole.inspector;
  const { summary } = trace;
  const time = formatTimestamp(trace.createdAt);
  const detail = useGetAllyGuideTurnTraceQuery(trace.turnId, { skip: !expanded });
  const turn = detail.data?.turn;
  const regionId = `turn-${trace.turnId}`;

  return (
    <li
      id={regionId}
      className={`border ${highlighted ? "border-primary-500" : "border-border-light"} bg-white`}
      data-testid="turn-card"
    >
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-background-secondary"
        aria-expanded={expanded}
        aria-controls={`${regionId}-body`}
        aria-label={strings.turnLabel(time)}
        onClick={onToggle}
      >
        <span className="text-sm font-semibold text-typography-900">{time}</span>
        <Pill tone={summary.outcome === "failed" ? "danger" : "success"}>
          {strings.outcomes[summary.outcome] ?? summary.outcome}
        </Pill>
        {summary.replyKind && summary.replyKind !== "chat" && (
          <Pill tone={replyTone(summary.replyKind)}>
            {strings.replyKinds[summary.replyKind] ?? summary.replyKind}
          </Pill>
        )}
        {summary.restarted && <Pill tone="warning">{strings.facts.restarted}</Pill>}
        <span className="ml-auto flex gap-4 text-xs tabular-nums text-typography-700">
          <span>{formatMs(summary.durationMs)}</span>
          <span>{formatUsd(summary.costUsd)}</span>
        </span>
      </button>

      {expanded && (
        <div
          id={`${regionId}-body`}
          className="flex flex-col gap-5 border-t border-border-light px-3 py-4"
          data-testid="turn-body"
        >
          {summary.failure && (
            <div
              className="border-l-4 border-destructive-500 bg-destructive-50 p-3 text-sm text-typography-900"
              data-testid="turn-failure"
            >
              <p className="font-semibold">{strings.failureHeading}</p>
              <p>{strings.failure(summary.failure.stage, summary.failure.code)}</p>
              {summary.failure.message && (
                <p className="mt-1 break-words font-mono text-xs">{summary.failure.message}</p>
              )}
            </div>
          )}

          <section>
            <Heading help={strings.stagesHelp}>{strings.stagesHeading}</Heading>
            <StageWaterfall stages={summary.stages} ttftMs={summary.ttftMs} />
          </section>

          <section>
            <Heading>{strings.factsHeading}</Heading>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {turn && (
                <>
                  <Fact label={strings.facts.trigger} testId="fact-trigger">
                    {strings.triggers[turn.trigger] ?? turn.trigger}
                  </Fact>
                  <Fact label={strings.facts.channel} testId="fact-channel">
                    {en.allyConsole.channels[turn.channel] ?? turn.channel}
                  </Fact>
                </>
              )}
              <Fact label={strings.facts.release} testId="fact-release">
                {releaseLabel ?? (trace.releaseId ? trace.releaseId.slice(0, 8) : "—")}
              </Fact>
              <Fact label={strings.facts.model} testId="fact-model">
                {summary.model ?? "—"}
              </Fact>
              <Fact label={strings.facts.tier} help={strings.factHelp.tier} testId="fact-tier">
                {summary.tier ?? "—"}
              </Fact>
              <Fact label={strings.facts.steer} help={strings.factHelp.steer} testId="fact-steer">
                {steerText(summary.steer)}
              </Fact>
              <Fact label={strings.facts.mode} help={en.allyConsole.modeHelp} testId="fact-mode">
                {modeText(summary)}
              </Fact>
              <Fact label={strings.facts.epoch} help={strings.factHelp.epoch} testId="fact-epoch">
                {epochText(summary)}
              </Fact>
              <Fact label={strings.facts.passes} testId="fact-passes">
                {summary.passes}
              </Fact>
              <Fact
                label={strings.facts.restarted}
                help={strings.factHelp.restarted}
                testId="fact-restarted"
              >
                {summary.restarted ? strings.yes : strings.no}
              </Fact>
            </dl>
            {detail.isError && (
              <p className="mt-2 text-xs text-typography-700">{strings.turnDetailFailed}</p>
            )}
          </section>

          <section>
            <Heading help={strings.sentinelHelp}>{strings.sentinelHeading}</Heading>
            {summary.sentinel ? (
              <dl
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
                data-testid="sentinel-verdict"
              >
                <Fact label={strings.sentinel.risk}>{summary.sentinel.risk}</Fact>
                <Fact label={strings.sentinel.about}>{summary.sentinel.about}</Fact>
                <Fact label={strings.sentinel.overlay}>{summary.sentinel.overlay ?? "none"}</Fact>
                <Fact label={strings.sentinel.confidence}>
                  {summary.sentinel.confidence === null
                    ? "—"
                    : `${Math.round(summary.sentinel.confidence * 100)}%`}
                </Fact>
                <Fact label={strings.sentinel.source}>{summary.sentinel.source}</Fact>
                <Fact label={strings.sentinel.latency}>{formatMs(summary.sentinel.latencyMs)}</Fact>
              </dl>
            ) : (
              <p className="text-sm text-typography-700">{strings.sentinelNone}</p>
            )}
          </section>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <section>
              <Heading>{strings.toolsHeading}</Heading>
              {summary.tools.length === 0 ? (
                <p className="text-sm text-typography-700">{strings.toolsNone}</p>
              ) : (
                <ul className="flex flex-wrap gap-2" data-testid="turn-tools">
                  {summary.tools.map((tool, index) => (
                    <li key={`${tool.name}-${index}`}>
                      <Pill tone={tool.isError ? "danger" : "neutral"} className="font-mono">
                        {tool.name}
                        {tool.isError ? ` · ${strings.toolFailed}` : ""}
                      </Pill>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <Heading>{strings.cardsHeading}</Heading>
              {summary.cards.length === 0 ? (
                <p className="text-sm text-typography-700">{strings.cardsNone}</p>
              ) : (
                <ul
                  className="flex flex-col gap-1 text-sm text-typography-900"
                  data-testid="turn-cards"
                >
                  {summary.cards.map((card, index) => (
                    <li key={`${card.kind}-${index}`}>
                      <span className="font-mono text-xs">{card.kind}</span>
                      {card.title ? ` · ${card.title}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section>
            <Heading>{strings.usageHeading}</Heading>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="turn-usage">
              <Fact label={strings.usage.input}>{formatCount(summary.usage.input)}</Fact>
              <Fact label={strings.usage.output}>{formatCount(summary.usage.output)}</Fact>
              <Fact label={strings.usage.cacheRead}>{formatCount(summary.usage.cacheRead)}</Fact>
              <Fact label={strings.usage.cacheWrite}>{formatCount(summary.usage.cacheWrite)}</Fact>
              <Fact label={strings.usage.cost}>{formatUsd(summary.costUsd)}</Fact>
            </dl>
          </section>

          {turn && turn.errorCode && (
            <p className="text-xs text-typography-700">
              {strings.turnRecordError}: <span className="font-mono">{turn.errorCode}</span>
            </p>
          )}

          {canReadPayload && (
            <>
              <TurnPayload turnId={trace.turnId} hasPayload={detail.data?.trace?.hasPayload} />
              <div>
                <SaveEvalCaseButton turnId={trace.turnId} />
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
};
