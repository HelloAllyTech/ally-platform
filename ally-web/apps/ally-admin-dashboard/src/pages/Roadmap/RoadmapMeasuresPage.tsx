import React, { useMemo } from "react";

import { Link, Navigate, useSearchParams } from "react-router-dom";

import { Button, Select, SelectItem, SkeletonText } from "@ally-ui-mono/ui-shared";
import { useGetRoadmapMetricsQuery } from "@api";
import { ROUTES, en } from "@constants";
import type { RoadmapMetrics } from "@types";

import { RoadmapAreaHeader } from "./components/RoadmapAreaHeader";
import { RoadmapBottomBar } from "./components/RoadmapBottomBar";
import { useRoadmapBreakpoint } from "./hooks/useRoadmapBreakpoint";
import { useRoadmapRole } from "./RoadmapGate";
import { shortDate, usd } from "./utils/copy";
import {
  MEASURE_RANGES,
  amberLineMs,
  formatDuration,
  measureRangeOf,
  measuresEmpty,
  percentOf,
  queryForRange,
} from "./utils/measures";
import { canSeeMeasures } from "./utils/redirects";

const t = () => en.roadmapV2Measures;

const Section: React.FC<{ id: string; title: string; help: string; children: React.ReactNode }> = ({
  id,
  title,
  help,
  children,
}) => (
  <section aria-labelledby={id} className="flex flex-col gap-3">
    <div>
      <h2 id={id} className="m-0 text-lg font-semibold text-typography-900">
        {title}
      </h2>
      <p className="m-0 text-sm text-typography-600">{help}</p>
    </div>
    {children}
  </section>
);

/** A plain bar: the number beside it carries the meaning, so the bar is decoration. */
const Bar: React.FC<{ pct: number }> = ({ pct }) => (
  <div className="h-2 w-full rounded bg-neutral-100" aria-hidden>
    <div
      className="h-2 rounded bg-primary-600"
      style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
    />
  </div>
);

const Stat: React.FC<{ label: string; value: string; note?: string }> = ({
  label,
  value,
  note,
}) => (
  <div className="flex min-w-[8rem] flex-col gap-0.5 rounded-md border border-border-light bg-white p-3">
    <span className="text-xs text-typography-600">{label}</span>
    <span className="text-xl font-semibold tabular-nums text-typography-900">{value}</span>
    {note && <span className="text-xs text-typography-600">{note}</span>}
  </div>
);

const cell = "border-b border-border-light px-3 py-2 text-left align-top";
const head = `${cell} text-xs font-semibold text-typography-600`;

/**
 * Captured → submitted → accepted → shipped → measured, for the ideas captured in the range: a
 * cohort, so each step is a real share of the one before [FP-2613]. Plain rows and bars rather
 * than a chart: five numbers read best as five numbers.
 */
export const FunnelTable: React.FC<{ funnel: RoadmapMetrics["funnel"] }> = ({ funnel }) => {
  const copy = t().funnel;
  const steps = ["captured", "submitted", "accepted", "shipped", "measured"] as const;
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{copy.title}</caption>
        <tbody>
          {steps.map(step => {
            const n = funnel[step];
            const pct = percentOf(n, funnel.captured);
            return (
              <tr key={step}>
                <th scope="row" className={`${cell} w-32 font-normal text-typography-900`}>
                  {copy.steps[step]}
                </th>
                <td className={`${cell} w-16 text-right font-semibold tabular-nums`}>{n}</td>
                <td className={`${cell} w-full min-w-[6rem]`}>
                  <Bar pct={pct} />
                </td>
                <td className={`${cell} whitespace-nowrap text-xs text-typography-600`}>
                  {step === "captured" ? "" : copy.share(pct)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {funnel.filedWithoutDraft > 0 && (
        <p className="m-0 text-xs text-typography-600">
          {copy.withoutDraft(funnel.filedWithoutDraft)}
        </p>
      )}
    </div>
  );
};

export const StageTable: React.FC<{ stages: RoadmapMetrics["stages"] }> = ({ stages }) => {
  const copy = t().stages;
  const none = t().none;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{copy.title}</caption>
        <thead>
          <tr>
            <th scope="col" className={head}>
              {copy.stage}
            </th>
            <th scope="col" className={`${head} text-right`}>
              {copy.median}
            </th>
            <th scope="col" className={`${head} text-right`}>
              {copy.p75}
            </th>
            <th scope="col" className={`${head} text-right`}>
              {copy.ideas}
            </th>
          </tr>
        </thead>
        <tbody>
          {stages.map(stage => (
            <tr key={stage.key}>
              <th scope="row" className={`${cell} font-normal text-typography-900`}>
                {copy.names[stage.key] ?? stage.key}
              </th>
              <td className={`${cell} text-right tabular-nums`}>
                {formatDuration(stage.medianMs) || none}
              </td>
              <td className={`${cell} text-right tabular-nums`}>
                {formatDuration(stage.p75Ms) || none}
              </td>
              <td className={`${cell} text-right tabular-nums`}>{stage.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * The Owner-review wait against its amber line (§4.6, the bottleneck guard in the plan's risks):
 * the median and the 3-in-4 wait drawn on one scale with the amber line marked.
 */
export const ReviewWait: React.FC<{ wait: RoadmapMetrics["reviewWait"] }> = ({ wait }) => {
  const copy = t().review;
  const none = t().none;
  const amber = amberLineMs(wait.amberDays);
  const scale = Math.max(amber * 2, wait.p75Ms ?? 0, wait.medianMs ?? 0);
  const at = (ms: number) => `${Math.min(100, (ms / scale) * 100)}%`;
  const medianText = formatDuration(wait.medianMs) || none;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Stat label={copy.median} value={medianText} note={copy.reviewed(wait.n)} />
        <Stat label={copy.p75} value={formatDuration(wait.p75Ms) || none} />
        <Stat label={copy.waitingNow} value={String(wait.waitingNow)} />
        <Stat label={copy.overAmber(wait.amberDays)} value={String(wait.overAmberNow)} />
        <Stat label={copy.longest} value={formatDuration(wait.longestWaitingMs) || none} />
      </div>
      {wait.medianMs !== null && (
        <figure className="m-0 flex flex-col gap-1">
          <div
            className="relative h-3 w-full rounded bg-neutral-100"
            role="img"
            aria-label={copy.chartLabel(medianText, wait.amberDays)}
          >
            {wait.p75Ms !== null && (
              <div
                className="absolute inset-y-0 left-0 rounded bg-primary-200"
                style={{ width: at(wait.p75Ms) }}
              />
            )}
            <div
              className="absolute inset-y-0 left-0 rounded bg-primary-600"
              style={{ width: at(wait.medianMs) }}
            />
            <div
              className="absolute -inset-y-1 w-0.5 bg-warning-700"
              style={{ left: at(amber) }}
              data-testid="measures-amber-line"
            />
          </div>
          <figcaption className="text-xs text-typography-600">
            {copy.amberLine(wait.amberDays)}
          </figcaption>
        </figure>
      )}
    </div>
  );
};

const ServiceCounts: React.FC<{ rows: { service: string; count: number }[] }> = ({ rows }) => {
  const names = t().releases.services;
  if (!rows.length) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-typography-600">
      {rows.map(row => (
        <li key={row.service}>
          {names[row.service] ?? row.service}: <span className="tabular-nums">{row.count}</span>
        </li>
      ))}
    </ul>
  );
};

export const Releases: React.FC<{ metrics: RoadmapMetrics }> = ({ metrics }) => {
  const copy = t().releases;
  const { releases, idleLeadReleases } = metrics;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <Stat
            label={copy.held}
            value={String(releases.held.total)}
            note={releases.held.shadow ? copy.heldShadow(releases.held.shadow) : undefined}
          />
          <ServiceCounts rows={releases.held.byService} />
        </div>
        <div className="flex flex-col gap-1">
          <Stat label={copy.failed} value={String(releases.failed.total)} />
          <ServiceCounts rows={releases.failed.byService} />
        </div>
        <Stat label={copy.failingNow} value={String(releases.failingIdeasNow)} />
        <Stat
          label={copy.idleLeads}
          value={idleLeadReleases === null ? copy.unknown : String(idleLeadReleases)}
        />
      </div>
      <p className="m-0 text-xs text-typography-600">{copy.idleLeadsHelp}</p>
    </div>
  );
};

export const SpendPerIdea: React.FC<{ spend: RoadmapMetrics["spend"] }> = ({ spend }) => {
  const copy = t().spend;
  const none = t().none;
  if (spend.ideas === 0) return <p className="m-0 text-sm text-typography-600">{copy.none}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Stat label={copy.median} value={spend.medianUsd === null ? none : usd(spend.medianUsd)} />
        <Stat label={copy.p75} value={spend.p75Usd === null ? none : usd(spend.p75Usd)} />
        <Stat label={copy.total} value={usd(spend.totalUsd)} note={copy.ideas(spend.ideas)} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="m-0 pb-1 text-left text-xs font-semibold text-typography-600">
            {copy.top}
          </caption>
          <thead>
            <tr>
              <th scope="col" className={head}>
                {copy.idea}
              </th>
              <th scope="col" className={`${head} text-right`}>
                {copy.amount}
              </th>
            </tr>
          </thead>
          <tbody>
            {spend.top.map(row => (
              <tr key={row.code ?? row.title ?? String(row.totalUsd)}>
                <td className={cell}>
                  {row.title && row.code ? (
                    <Link
                      to={ROUTES.ROADMAP_IDEA(row.code)}
                      className="text-primary-700 hover:underline"
                    >
                      <span className="font-mono text-xs">{row.code}</span> {row.title}
                    </Link>
                  ) : (
                    <span className="text-typography-600">
                      {row.code && <span className="font-mono text-xs">{row.code} </span>}
                      {copy.privateDraft}
                    </span>
                  )}
                </td>
                <td className={`${cell} text-right tabular-nums`}>{usd(row.totalUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {spend.approximate && <p className="m-0 text-xs text-typography-600">{copy.approximate}</p>}
    </div>
  );
};

/** §4.16's targets, as written in the plan. The measured medians are in PostHog. */
export const TargetsTable: React.FC = () => {
  const copy = t().targets;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{copy.title}</caption>
        <thead>
          <tr>
            <th scope="col" className={head}>
              {copy.job}
            </th>
            <th scope="col" className={head}>
              {copy.who}
            </th>
            <th scope="col" className={head}>
              {copy.target}
            </th>
            <th scope="col" className={head}>
              {copy.event}
            </th>
          </tr>
        </thead>
        <tbody>
          {copy.rows.map(row => (
            <tr key={row.job}>
              <th scope="row" className={`${cell} font-normal text-typography-900`}>
                {row.name}
              </th>
              <td className={cell}>{row.who}</td>
              <td className={`${cell} whitespace-nowrap`}>{row.target}</td>
              <td className={`${cell} font-mono text-xs text-typography-600`}>{row.job}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const MeasuresSkeleton: React.FC = () => (
  <div className="flex flex-col gap-6" aria-busy="true">
    <SkeletonText heading width="30%" />
    <SkeletonText paragraph lineCount={5} />
    <SkeletonText heading width="30%" />
    <SkeletonText paragraph lineCount={4} />
  </div>
);

/**
 * `/roadmap/measures` (P8, Owner only): how ideas move from capture to shipped, from ally-be's
 * own tables, over a date range (last 30 days by default). Job times live in PostHog; this page
 * shows their targets and never queries PostHog from the browser.
 */
export const RoadmapMeasuresPage: React.FC = () => {
  const copy = t();
  const { role } = useRoadmapRole();
  const breakpoint = useRoadmapBreakpoint();
  const phone = breakpoint === "phone";
  const allowed = canSeeMeasures(role);
  const [params, setParams] = useSearchParams();
  const range = measureRangeOf(params.get("range"));
  const query = useMemo(() => queryForRange(range), [range]);
  const { data, isLoading, isFetching, isError, refetch } = useGetRoadmapMetricsQuery(query, {
    skip: !allowed,
  });

  if (!allowed) return <Navigate to={ROUTES.ROADMAP} replace />;

  const rangePicker = (
    <div className="flex flex-wrap items-end gap-3">
      <Select
        id="roadmap-measures-range"
        labelText={copy.rangeLabel}
        size="sm"
        value={range}
        onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
          setParams({ range: event.target.value }, { replace: true })
        }
        className="w-48"
      >
        {MEASURE_RANGES.map(value => (
          <SelectItem key={value} value={value} text={copy.ranges[value]} />
        ))}
      </Select>
      {data && (
        <p className="m-0 pb-1 text-xs text-typography-600" aria-live="polite">
          {copy.rangeShown(shortDate(query.from), shortDate(query.to))}
        </p>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (isLoading || (isFetching && !data)) {
    body = <MeasuresSkeleton />;
  } else if (isError || !data) {
    body = (
      <div className="flex flex-col items-start gap-3" role="alert">
        <p className="m-0 text-sm text-typography-900">{copy.loadFailed}</p>
        <Button kind="tertiary" size="sm" onClick={() => void refetch()}>
          {copy.retry}
        </Button>
      </div>
    );
  } else if (measuresEmpty(data)) {
    body = (
      <div className="flex flex-col gap-1 rounded-md border border-border-light bg-neutral-50 p-6">
        <p className="m-0 text-base font-semibold text-typography-900">{copy.empty}</p>
        <p className="m-0 text-sm text-typography-600">{copy.emptyHint}</p>
      </div>
    );
  } else {
    body = (
      <div className={`flex flex-col gap-8 ${isFetching ? "opacity-70" : ""}`}>
        <Section id="measures-funnel" title={copy.funnel.title} help={copy.funnel.help}>
          <FunnelTable funnel={data.funnel} />
        </Section>
        <Section id="measures-stages" title={copy.stages.title} help={copy.stages.help}>
          <StageTable stages={data.stages} />
        </Section>
        <Section id="measures-review" title={copy.review.title} help={copy.review.help}>
          <ReviewWait wait={data.reviewWait} />
        </Section>
        <Section id="measures-releases" title={copy.releases.title} help={copy.releases.help}>
          <Releases metrics={data} />
        </Section>
        <Section id="measures-spend" title={copy.spend.title} help={copy.spend.help}>
          <SpendPerIdea spend={data.spend} />
        </Section>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <RoadmapAreaHeader phone={phone} current={copy.title} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto flex max-w-4xl flex-col gap-8 px-4 py-6 ${phone ? "pb-24" : ""}`}>
          <p className="m-0 text-sm text-typography-600">{copy.intro}</p>
          {rangePicker}
          {body}
          <Section id="measures-targets" title={copy.targets.title} help={copy.targets.help}>
            <TargetsTable />
          </Section>
        </div>
      </div>
      {phone && <RoadmapBottomBar hidden={false} />}
    </div>
  );
};
