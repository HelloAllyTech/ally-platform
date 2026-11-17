import React from "react";

import { toast } from "sonner";

import { Button, SkeletonText } from "@ally-ui-mono/ui-shared";
import {
  useDismissPmAgentCardMutation,
  useGetPmAgentFeedStateQuery,
  useGetPmAgentTrackingQuery,
  useRetryPmAgentCardMutation,
} from "@api";
import type { PmCard, PmImpactCheck, PmImpactSummary } from "@types";

import { copy } from "./copy";
import { absoluteTime, formatMetricValue, formatUsd, relativeTime, stepIndex } from "./format";
import { NeedsYouPanel } from "./NeedsYouPanel";
import { BreakerBanner } from "./statePanels";
import { usePmAgentControls } from "./usePmAgentControls";
import { InfoTip } from "../../components/ally-guide/InfoTip";

/** Six steps. Done, current and not-reached are words (hidden visually) as well as marks. */
export const Stepper: React.FC<{ card: PmCard }> = ({ card }) => {
  const at = stepIndex(card.status);
  if (at < 0) return null;
  const stuck =
    card.status === "failed" ||
    card.status === "needs_attention" ||
    card.status === "merged_not_released";
  return (
    <ol aria-label={copy.tracking.stepsLabel} className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {copy.tracking.steps.map((label, i) => {
        const state = i < at ? "done" : i === at ? "current" : "next";
        return (
          <li
            key={label}
            aria-current={state === "current" ? "step" : undefined}
            className={
              state === "current"
                ? `font-semibold ${stuck ? "text-red-700" : "text-primary-700"}`
                : state === "done"
                  ? "text-typography-800"
                  : "text-typography-500"
            }
          >
            <span aria-hidden="true">
              {state === "done" ? "✓ " : state === "current" ? (stuck ? "⚠ " : "● ") : "○ "}
            </span>
            {label}
            <span className="sr-only">
              {" "}
              (
              {state === "done"
                ? copy.tracking.stepDone
                : state === "current"
                  ? copy.tracking.stepCurrent
                  : copy.tracking.stepNext}
              )
            </span>
          </li>
        );
      })}
    </ol>
  );
};

const imp = copy.tracking.impact;

const CheckStep: React.FC<{ check: PmImpactCheck; unit?: PmImpactSummary["unit"] }> = ({
  check,
  unit,
}) => {
  let text: string;
  let when = check.dueAt;
  if (check.status === "measured") {
    when = check.readAt ?? check.dueAt;
    const v =
      check.value !== undefined ? formatMetricValue(check.value, unit) : imp.measuredNoValue;
    const verdict = check.verdict ? ` (${imp.verdict[check.verdict] ?? check.verdict})` : "";
    text = `${v}${verdict.toLowerCase()}`;
  } else if (check.status === "pending") text = imp.pending(relativeTime(check.dueAt));
  else if (check.status === "insufficient_data") text = imp.insufficient;
  else text = imp.unavailable;
  return (
    <li className="text-xs text-typography-700" title={absoluteTime(when)}>
      <span className="font-medium">{imp.day(check.day)}</span>
      <span aria-hidden="true">: </span>
      <span className="sr-only">: </span>
      {text}
    </li>
  );
};

/** Impact of a shipped change: summary and verdict, baseline, and the +14 d / +30 d checks. */
export const ImpactLine: React.FC<{ impact?: PmImpactSummary | null }> = ({ impact }) => {
  if (!impact || !impact.metricName) {
    return (
      <div className="flex items-center gap-1 text-xs text-typography-600">
        {imp.notMeasurable}
        <InfoTip label={imp.notMeasurableTip} ariaLabel="About impact not measurable" />
      </div>
    );
  }
  const checks = [...(impact.checks ?? [])].sort((x, y) => x.day - y.day);
  const latest = [...checks].reverse().find(c => c.status === "measured" && c.verdict);
  const verdict = latest?.verdict;
  const hasBaseline = impact.baseline !== undefined && impact.baseline !== null;
  return (
    <div className="flex flex-col gap-1" aria-label={imp.label}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-typography-800">
        <span>{impact.summary || impact.metricName}</span>
        {verdict && (
          <span
            className={`rounded border px-1.5 py-0.5 text-xs font-medium ${
              verdict === "improved"
                ? "border-green-700 text-green-800"
                : verdict === "worse"
                  ? "border-red-700 text-red-800"
                  : "border-neutral-500 text-typography-700"
            }`}
          >
            <span aria-hidden="true">{imp.verdictIcon[verdict]} </span>
            {imp.verdict[verdict]}
          </span>
        )}
        {hasBaseline && (
          <span className="flex items-center gap-1 text-xs text-typography-600">
            {imp.baseline(formatMetricValue(impact.baseline, impact.unit))}
            <InfoTip label={imp.baselineTip} ariaLabel="About the baseline" />
          </span>
        )}
      </div>
      {checks.length > 0 && (
        <ul aria-label={imp.checksLabel} className="flex flex-wrap gap-x-4 gap-y-0.5">
          {checks.map(c => (
            <CheckStep key={c.day} check={c} unit={impact.unit} />
          ))}
        </ul>
      )}
    </div>
  );
};

const Row: React.FC<{
  card: PmCard;
  needsYou?: boolean;
  shipped?: boolean;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}> = ({ card, needsYou, shipped, onRetry, onDismiss }) => {
  const when = card.decidedAt ?? card.createdAt;
  const prs = card.delivery?.prs ?? [];
  return (
    <li className="flex flex-col gap-2 rounded border border-neutral-500 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-base font-medium text-typography-900">{card.title}</h4>
        <span className="text-xs text-typography-600" title={absoluteTime(when)}>
          {relativeTime(when)}
        </span>
      </div>
      <Stepper card={card} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-typography-700">
        {prs.map((pr, i) => (
          <a
            key={pr.url}
            href={pr.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary-700 underline"
          >
            {copy.tracking.prLink(i + 1)}
            {pr.releaseTag ? ` · ${pr.releaseTag}` : ""}
          </a>
        ))}
        {card.delivery?.costUsd != null && (
          <span>{copy.tracking.cost(formatUsd(card.delivery.costUsd))}</span>
        )}
      </div>
      {shipped && <ImpactLine impact={card.delivery?.impact} />}
      {needsYou && <NeedsYouPanel card={card} onRetry={onRetry} onDismiss={onDismiss} />}
    </li>
  );
};

const Group: React.FC<{
  title: string;
  cards: PmCard[];
  needsYou?: boolean;
  shipped?: boolean;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}> = ({ title, cards, needsYou, shipped, onRetry, onDismiss }) => (
  <section aria-label={title} className="flex flex-col gap-2">
    <h3 className="text-sm font-semibold uppercase tracking-wide text-typography-600">
      {title} <span className="font-normal">({cards.length})</span>
    </h3>
    {cards.length === 0 ? (
      <p className="text-sm text-typography-600">{copy.tracking.emptyGroup}</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {cards.map(c => (
          <Row
            key={c.id}
            card={c}
            needsYou={needsYou}
            shipped={shipped}
            onRetry={onRetry}
            onDismiss={onDismiss}
          />
        ))}
      </ul>
    )}
  </section>
);

export const TrackingView: React.FC = () => {
  const { data, isLoading, isError, refetch } = useGetPmAgentTrackingQuery();
  const { data: state } = useGetPmAgentFeedStateQuery();
  const [retryCard] = useRetryPmAgentCardMutation();
  const [dismissCard] = useDismissPmAgentCardMutation();
  const controls = usePmAgentControls();

  const act = async (run: () => Promise<unknown>, ok: string) => {
    try {
      await run();
      toast.success(ok);
    } catch {
      toast.error(copy.actionFailed);
    }
  };

  if (isLoading) return <SkeletonText paragraph lineCount={4} />;
  if (isError && !data) {
    return (
      <div className="flex items-center gap-3" role="alert">
        <p className="text-sm text-red-700">{copy.tracking.loadError}</p>
        <Button kind="tertiary" size="sm" onClick={() => refetch()}>
          {copy.retryLoad}
        </Button>
      </div>
    );
  }
  const t = data ?? { needsYou: [], inProgress: [], shipped: [], other: [] };
  const total = t.needsYou.length + t.inProgress.length + t.shipped.length + t.other.length;
  const onRetry = (id: string) => act(() => retryCard(id).unwrap(), copy.retried);
  const onDismiss = (id: string) => act(() => dismissCard(id).unwrap(), copy.dismissed);

  return (
    <div className="flex flex-col gap-5">
      <BreakerBanner state={state} onResume={controls.resumeBuilds} />
      {total === 0 ? (
        <p className="text-sm text-typography-700">{copy.tracking.empty}</p>
      ) : (
        <>
          <Group
            title={copy.tracking.groups.needsYou}
            cards={t.needsYou}
            needsYou
            onRetry={onRetry}
            onDismiss={onDismiss}
          />
          <Group
            title={copy.tracking.groups.inProgress}
            cards={t.inProgress}
            onRetry={onRetry}
            onDismiss={onDismiss}
          />
          <Group
            title={copy.tracking.groups.shipped}
            cards={t.shipped}
            shipped
            onRetry={onRetry}
            onDismiss={onDismiss}
          />
          <Group
            title={copy.tracking.groups.other}
            cards={t.other}
            onRetry={onRetry}
            onDismiss={onDismiss}
          />
        </>
      )}
    </div>
  );
};
