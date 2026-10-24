import React from "react";

import { Button, InlineLoading } from "@ally-ui-mono/ui-shared";
import {
  formatMs,
  releaseVersionLabel,
  toPrettyJson,
} from "@components/ally-guide/allyGuideFormat";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { AllyGuidePlaygroundResult } from "@types";

import { PaneTurn, sumUsage } from "./playgroundScenario";

const PRE =
  "max-h-64 overflow-auto whitespace-pre-wrap break-words bg-background-secondary p-3 font-mono text-xs text-typography-900";

const Turn: React.FC<{
  turn: PaneTurn;
  version: string;
  onRetry: () => void;
  onStop: () => void;
}> = ({ turn, version, onRetry, onStop }) => {
  const strings = en.allyConsole.playground;
  const pane = strings.pane;
  const result: AllyGuidePlaygroundResult | undefined = turn.result;
  const tokens = sumUsage(result?.usage);
  const sentinel = result?.sentinel;

  return (
    <div className="flex flex-col gap-2" data-testid="pane-turn">
      <div className="text-sm" data-testid="pane-learner-line">
        <span className="font-semibold text-typography-900">{strings.conversation.learner}: </span>
        {turn.learner || <span className="text-typography-700">—</span>}
        {turn.intent && (
          <span className="ml-2 text-xs text-typography-700">
            {strings.conversation.action(strings.action.options[turn.intent] ?? turn.intent)}
          </span>
        )}
      </div>

      {turn.status === "running" && (
        <div data-testid="pane-running">
          <InlineLoading description={pane.running(version)} />
          <p className="text-xs text-typography-700">{pane.runningHint}</p>
          <Button kind="ghost" size="sm" onClick={onStop}>
            {pane.stop}
          </Button>
        </div>
      )}

      {turn.status === "error" && (
        <div className="flex flex-col items-start gap-2" data-testid="pane-error">
          <p className="text-sm text-destructive-600">
            {turn.stopped ? pane.stopped : `${pane.failed} ${turn.error ?? ""}`}
          </p>
          <Button kind="tertiary" size="sm" onClick={onRetry}>
            {pane.retry}
          </Button>
        </div>
      )}

      {turn.status === "done" && result && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-typography-900">
                {strings.conversation.ally}
              </span>
              <Pill tone={result.replyKind === "crisis" ? "danger" : "neutral"}>
                {pane.replyKinds[result.replyKind] ?? result.replyKind}
              </Pill>
            </div>
            {result.replyKind === "crisis" && (
              <p className="text-xs text-typography-700">{pane.crisisNote}</p>
            )}
            <p
              className="whitespace-pre-wrap break-words border-l-4 border-border-light pl-3 text-sm text-typography-900"
              data-testid="pane-reply"
            >
              {result.reply}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-typography-700">
            <dt>{pane.facts.model}</dt>
            <dd className="text-typography-900">{result.model ?? "—"}</dd>
            <dt>{pane.facts.time}</dt>
            <dd className="text-typography-900">{formatMs(result.latencyMs)}</dd>
            <dt>{pane.facts.cost}</dt>
            <dd className="text-typography-900">{`$${result.costUsd.toFixed(4)}`}</dd>
            <dt>{pane.facts.tokens}</dt>
            <dd className="text-typography-900">
              {pane.tokens(tokens.input, tokens.output, tokens.cached)}
            </dd>
          </dl>

          <div data-testid="pane-sentinel">
            <h4 className="text-sm font-semibold text-typography-900">{pane.sentinelHeading}</h4>
            {sentinel ? (
              <p className="text-sm text-typography-800">
                {en.allyConsole.inspector.sentinel.risk}: {sentinel.risk} ·{" "}
                {en.allyConsole.inspector.sentinel.about}: {sentinel.about} ·{" "}
                {en.allyConsole.inspector.sentinel.overlay}: {sentinel.overlay ?? "none"}
              </p>
            ) : (
              <p className="text-sm text-typography-700">{pane.sentinelNone}</p>
            )}
          </div>

          <details data-testid="pane-situation">
            <summary className="cursor-pointer text-sm font-semibold text-typography-900">
              {pane.situationHeading}
            </summary>
            <p className="my-1 text-xs text-typography-700">{pane.situationHelp}</p>
            <pre className={PRE} tabIndex={0}>
              {result.situation}
            </pre>
          </details>

          <div data-testid="pane-tools">
            <div className="flex items-center gap-1">
              <h4 className="text-sm font-semibold text-typography-900">{pane.toolsHeading}</h4>
              <InfoTip label={pane.toolsHelp} ariaLabel="About tools called" />
            </div>
            {result.toolCalls.length === 0 ? (
              <p className="text-sm text-typography-700">{pane.toolsNone}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {result.toolCalls.map((call, index) => (
                  <li
                    key={`${call.name}-${index}`}
                    className="flex flex-col gap-1"
                    data-testid="pane-tool"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-typography-900">{call.name}</span>
                      {call.simulated && (
                        <span className="inline-flex items-center gap-1">
                          <Pill tone="info">{pane.dryRun}</Pill>
                          <InfoTip label={pane.dryRunHelp} ariaLabel="About dry runs" />
                        </span>
                      )}
                      {call.isError && <Pill tone="danger">{pane.toolFailed}</Pill>}
                    </div>
                    <pre className={PRE} tabIndex={0} aria-label={`${call.name} ${pane.toolInput}`}>
                      {toPrettyJson(call.input)}
                    </pre>
                    <pre
                      className={PRE}
                      tabIndex={0}
                      aria-label={`${call.name} ${pane.toolResult}`}
                    >
                      {call.result}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface PlaygroundPaneProps {
  /** Which release this column is, as a heading. */
  heading: string;
  releaseId: string;
  version: number;
  statusLabel: string;
  turns: PaneTurn[];
  onRetry: (turnId: number) => void;
  onStop: (turnId: number) => void;
}

/** One release's column: its own conversation, each turn with the reply, the numbers and the working. */
export const PlaygroundPane: React.FC<PlaygroundPaneProps> = ({
  heading,
  releaseId,
  version,
  statusLabel,
  turns,
  onRetry,
  onStop,
}) => {
  const label = releaseVersionLabel(version);
  return (
    <section
      className="flex min-w-0 flex-col gap-4 border border-border-light p-4"
      aria-label={`${heading}: ${label}`}
      data-testid={`pane-${releaseId}`}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold text-typography-900">{label}</h3>
        <Pill tone="neutral">{statusLabel}</Pill>
      </div>
      {turns.length === 0 ? (
        <p className="text-sm text-typography-700">
          {en.allyConsole.playground.conversation.empty}
        </p>
      ) : (
        turns.map(turn => (
          <Turn
            key={turn.id}
            turn={turn}
            version={label}
            onRetry={() => onRetry(turn.id)}
            onStop={() => onStop(turn.id)}
          />
        ))
      )}
    </section>
  );
};
