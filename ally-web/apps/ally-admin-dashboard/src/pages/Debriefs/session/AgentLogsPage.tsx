import React, { useEffect, useMemo, useState } from "react";

import { useParams, useSearchParams } from "react-router-dom";

import { Button, Checkbox, Select, SelectItem } from "@ally-ui-mono/ui-shared";
import { useGetDebriefModelsQuery, useGetDebriefRunLogsQuery } from "@api";
import { formatMs, formatUsd, releaseVersionLabel } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en, ROUTES } from "@constants";
import { AgentLogEntry, AgentLogsView } from "@types";

import { modelLabels } from "../consoleLabels";
import { TruncatedTitle } from "../consoleRows";
import { BackLink } from "../consoleUi";
import { Found, foundHeading } from "./AgentLogFindings";
import {
  fillPct,
  filterEntries,
  givenFacts,
  givenItems,
  GivenItem,
  isProblem,
  LogFilters,
  NO_FILTERS,
  Origin,
  originOf,
  runSummary,
  SourceFilter,
  stepOptions,
  verdictOf,
} from "./agentLogParts";
import { entryName, exactInput, promptLabel } from "./agentLogText";
import { scenarioTitle } from "../home/SessionCard";

const usd3 = (n: number) => "$" + n.toFixed(3);

const PURPLE = "#8A3FFC";
const RED = "#DA1E28";

const longDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const ORIGIN_CHIP: Record<Origin, string> = {
  fixed: "bg-neutral-100 text-neutral-800",
  planned: "bg-[#F6F2FF] text-[#6929C4]",
  top_up: "bg-[#FCF4D6] text-[#8A3800]",
  unknown: "bg-neutral-100 text-neutral-600",
};

const ORIGIN_LABEL: Record<Origin, string> = {
  fixed: "Fixed",
  planned: "Planned",
  top_up: "Top-up",
  unknown: "Unknown",
};

/** The card's title: "Draft score · round 0". */
const titleOf = (e: AgentLogEntry): string =>
  e.round !== null ? `${entryName(e.step)} · round ${e.round}` : entryName(e.step);

/** "Why it ran", in words. */
export const whyItRan = (e: AgentLogEntry): string => {
  switch (originOf(e)) {
    case "fixed":
      return "Always runs.";
    case "planned":
      return e.planReason ? `The planner chose it: “${e.planReason}”` : "The planner chose it.";
    case "top_up":
      return e.planReason
        ? `Extra evidence after a failed draft score: “${e.planReason}”`
        : "Extra evidence after a failed draft score.";
    default:
      return e.planReason ?? "Not recorded: this entry was logged before sources were kept.";
  }
};

// ---------------------------------------------------------------- summary strip

const Tile: React.FC<{ label: string; children: React.ReactNode; testId: string }> = ({
  label,
  children,
  testId,
}) => (
  <div className="flex min-w-0 flex-1 flex-col gap-1.5 bg-[#F4F4F4] px-4 py-3" data-testid={testId}>
    <span className="text-xs text-neutral-600">{label}</span>
    {children}
  </div>
);

const Bar: React.FC<{ pct: number }> = ({ pct }) => (
  <span className="block h-1.5 w-full bg-white">
    <span
      className="block h-1.5"
      style={{ width: `${pct}%`, background: pct >= 100 ? RED : "#264D8E" }}
    />
  </span>
);

const SummaryStrip: React.FC<{ view: AgentLogsView }> = ({ view }) => {
  const s = runSummary(view);
  return (
    <div className="flex min-w-0 flex-nowrap gap-3" data-testid="agent-logs-strip">
      <Tile label="Time" testId="tile-time">
        <span className="truncate font-secondary text-[18px]">
          {s.seconds != null ? `${s.seconds} s` : "—"} of {s.deadlineSeconds} s
        </span>
        <Bar pct={fillPct(s.seconds, s.deadlineSeconds)} />
      </Tile>
      <Tile label="Cost" testId="tile-cost">
        <span className="truncate font-secondary text-[18px]">
          {s.costUsd != null ? usd3(s.costUsd) : "—"}
          {s.ceilingUsd != null ? ` of ${usd3(s.ceilingUsd)}` : ""}
        </span>
        <Bar pct={fillPct(s.costUsd, s.ceilingUsd)} />
      </Tile>
      <Tile label="Planner added" testId="tile-planner">
        <span
          className="truncate font-secondary text-[18px]"
          title={s.plannerAdded?.join(", ") ?? ""}
        >
          {s.plannerAdded === null
            ? "No planner in this run"
            : s.plannerAdded.length
              ? s.plannerAdded.join(", ")
              : "None"}
        </span>
        <span className="truncate text-xs text-neutral-600">
          {[
            view.run.releaseVersion != null
              ? `Release ${releaseVersionLabel(view.run.releaseVersion)}`
              : null,
            view.run.recipeKey,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </Tile>
    </div>
  );
};

// ---------------------------------------------------------------- one card

const Copy: React.FC<{ text: string }> = ({ text }) => {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 1500);
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="ml-auto border-0 bg-transparent p-0 text-xs text-primary-500 hover:underline"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : "Copy"}
    </button>
  );
};

const GivenBody: React.FC<{ item: GivenItem }> = ({ item }) =>
  item.body.kind === "transcript" ? (
    <ol className="m-0 flex max-h-[320px] list-none flex-col gap-1 overflow-auto bg-white p-3 text-[13px]">
      {item.body.lines.map((l, i) => (
        <li key={i} className="flex gap-2">
          <span className="w-[86px] shrink-0 text-neutral-600">
            {l.turn !== null ? `${l.turn} · ` : ""}
            {l.speaker}
          </span>
          <span className="min-w-0 whitespace-pre-wrap">{l.text}</span>
        </li>
      ))}
    </ol>
  ) : (
    <p className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words bg-white p-3 text-[13px] leading-normal">
      {item.body.text}
    </p>
  );

const Given: React.FC<{ entry: AgentLogEntry; expandAll: boolean }> = ({ entry: e, expandAll }) => {
  const items = useMemo(() => givenItems(e), [e]);
  const facts = useMemo(() => givenFacts(e), [e]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(
    () => setOpen(expandAll ? new Set(items.map(i => i.key)) : new Set()),
    [expandAll, items],
  );
  if (!items.length && !e.prompt && !facts.length) return null;
  const toggle = (k: string) =>
    setOpen(s => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <section className="flex flex-col gap-1.5" data-testid="log-given">
      <h4 className="m-0 text-xs font-normal text-neutral-600">What it was given</h4>
      <div className="flex min-w-0 flex-wrap gap-2">
        {items.map(i => (
          <button
            key={i.key}
            type="button"
            aria-expanded={open.has(i.key)}
            onClick={() => toggle(i.key)}
            className="h-7 whitespace-nowrap rounded-sm border border-neutral-300 bg-white px-2.5 text-[13px] text-neutral-900 hover:border-primary-500"
          >
            {i.label}
            {i.count ? ` · ${i.count}` : ""} {open.has(i.key) ? "▴" : "▾"}
          </button>
        ))}
        {e.prompt && (
          <a
            href={e.prompt.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center whitespace-nowrap rounded-sm border border-neutral-300 bg-white px-2.5 text-[13px]"
            data-testid="log-prompt-link"
          >
            Instructions: {promptLabel(e.prompt).replace(/'s prompt/, "")} ↗
          </a>
        )}
        {facts.map(f => (
          <span
            key={f.label}
            className="inline-flex h-7 items-center whitespace-nowrap px-1 text-xs text-neutral-600"
          >
            {f.label}: {f.value}
          </span>
        ))}
      </div>
      {items
        .filter(i => open.has(i.key))
        .map(i => (
          <div key={i.key} className="flex flex-col gap-1" data-testid={`given-${i.key}`}>
            <span className="text-xs font-semibold">{i.label}</span>
            <GivenBody item={i} />
          </div>
        ))}
    </section>
  );
};

const pretty = (v: unknown): string =>
  typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v, null, 2);

const Exact: React.FC<{ entry: AgentLogEntry; prompts: Record<string, string> }> = ({
  entry: e,
  prompts,
}) => {
  const [open, setOpen] = useState(false);
  const sent = exactInput(e, prompts);
  const reply = pretty(e.output) + (e.error ? `\n\nError: ${e.error}` : "");
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="border-0 bg-transparent p-0 text-[13px] text-primary-500 hover:underline"
        data-testid="log-exact-toggle"
      >
        Show the exact message and reply {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-3" data-testid="log-exact">
          {[
            { label: e.kind === "model" ? "Message as sent" : "Inputs", text: sent },
            { label: e.kind === "model" ? "Reply" : "Result", text: reply },
          ].map(p => (
            <div key={p.label} className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center text-xs font-semibold">
                {p.label}
                <Copy text={p.text} />
              </div>
              <pre className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words bg-white px-3 py-2.5 font-mono text-xs leading-normal">
                {p.text}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const metaLine = (e: AgentLogEntry, modelLabel: (id: string) => string): string =>
  [
    e.ms != null ? formatMs(e.ms) : null,
    e.costUsd != null ? formatUsd(e.costUsd) : null,
    e.model
      ? `${modelLabel(e.model)}${e.fallbackModel ? ` (backup ${modelLabel(e.fallbackModel)} ran)` : ""}`
      : "no model",
  ]
    .filter(Boolean)
    .join(" · ");

const Entry: React.FC<{
  entry: AgentLogEntry;
  entries: AgentLogEntry[];
  prompts: Record<string, string>;
  modelLabel: (id: string) => string;
  expandAll: boolean;
}> = ({ entry: e, entries, prompts, modelLabel, expandAll }) => {
  const origin = originOf(e);
  const problem = isProblem(e);
  const verdict = verdictOf(entries, e);
  return (
    <li
      id={`log-${e.seq}`}
      className="flex scroll-mt-4 flex-col gap-3 rounded-sm bg-[#F4F4F4] px-[18px] py-3.5"
      style={{
        border: problem ? `1px solid ${RED}` : "1px solid transparent",
        borderLeft: `3px solid ${origin === "planned" ? PURPLE : problem ? RED : "transparent"}`,
      }}
      data-testid="log-entry"
      data-origin={origin}
      data-attention={problem ? "true" : "false"}
    >
      <div className="flex min-w-0 flex-nowrap items-center gap-2.5" data-testid="log-entry-header">
        <span className="shrink-0 whitespace-nowrap font-secondary text-[17px]">{titleOf(e)}</span>
        <span
          className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${ORIGIN_CHIP[origin]}`}
          data-testid="log-origin"
        >
          {ORIGIN_LABEL[origin]}
        </span>
        {verdict && (
          <span
            className="shrink-0 whitespace-nowrap text-[13px] font-semibold"
            style={{ color: verdict.good ? "#0E6027" : RED }}
          >
            {verdict.text}
          </span>
        )}
        {e.error && (
          <span
            className="shrink-0 whitespace-nowrap text-[13px] font-semibold"
            style={{ color: RED }}
          >
            Failed
          </span>
        )}
        {!e.error && e.attention && (
          <span
            className="shrink-0 whitespace-nowrap text-[13px] font-semibold"
            style={{ color: RED }}
          >
            Needs attention
          </span>
        )}
        <span
          className="ml-auto min-w-0 truncate text-xs text-neutral-600"
          title={e.model ?? undefined}
          data-testid="log-meta"
        >
          {metaLine(e, modelLabel)}
          {e.retries ? ` · ${e.retries === 1 ? "retried once" : `${e.retries} retries`}` : ""}
        </span>
      </div>

      <p className="m-0 text-[13px] text-neutral-800" data-testid="log-why">
        <span className="text-neutral-600">Why it ran: </span>
        {whyItRan(e)}
      </p>

      <Given entry={e} expandAll={expandAll} />

      <section className="flex flex-col gap-1.5" data-testid="log-found">
        <h4 className="m-0 text-xs font-normal text-neutral-600">{foundHeading(e)}</h4>
        <Found entry={e} entries={entries} expandAll={expandAll} />
        {e.error && (
          <p className="m-0 text-[13px]" style={{ color: RED }}>
            Error: {e.error}
          </p>
        )}
      </section>

      <Exact entry={e} prompts={prompts} />
    </li>
  );
};

// ---------------------------------------------------------------- timeline

const Timeline: React.FC<{ entries: AgentLogEntry[] }> = ({ entries }) => (
  <nav
    aria-label="Run timeline"
    className="sticky top-4 hidden w-[200px] shrink-0 self-start lg:block"
    data-testid="agent-logs-timeline"
  >
    <div className="mb-2 text-xs text-neutral-600">Run timeline</div>
    <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
      {entries.map(e => {
        const planned = originOf(e) === "planned";
        const problem = isProblem(e);
        const colour = problem ? RED : planned ? PURPLE : "#264D8E";
        return (
          <li key={e.seq} className={planned ? "pl-4" : ""}>
            <button
              type="button"
              onClick={() =>
                document.getElementById(`log-${e.seq}`)?.scrollIntoView({ behavior: "smooth" })
              }
              className="flex w-full min-w-0 items-center gap-2 border-0 bg-transparent p-0 text-left text-[13px] text-neutral-900 hover:underline"
              data-testid="timeline-item"
              data-dot={planned ? "outline" : "filled"}
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  background: planned ? "transparent" : colour,
                  border: `2px solid ${colour}`,
                }}
              />
              <span className="min-w-0 truncate">{titleOf(e)}</span>
            </button>
          </li>
        );
      })}
    </ol>
    <div className="mt-3 text-xs text-neutral-600">● Fixed &nbsp; ○ Planned</div>
  </nav>
);

// ---------------------------------------------------------------- filters

const SOURCES: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "fixed", label: "Fixed" },
  { value: "planned", label: "Planned" },
  { value: "top_up", label: "Top-up" },
];

const FilterRow: React.FC<{
  filters: LogFilters;
  onChange: (f: LogFilters) => void;
  steps: { value: string; label: string }[];
  expandAll: boolean;
  onExpandAll: () => void;
}> = ({ filters, onChange, steps, expandAll, onExpandAll }) => (
  <div
    className="sticky top-0 z-[2] flex min-w-0 flex-nowrap items-end gap-4 border-b border-neutral-100 bg-white py-2"
    data-testid="agent-logs-filters"
  >
    <div className="w-[160px] shrink-0">
      <Select
        id="agent-logs-source"
        labelText="Source"
        size="sm"
        value={filters.source}
        onChange={(ev: React.ChangeEvent<HTMLSelectElement>) =>
          onChange({ ...filters, source: ev.target.value as SourceFilter })
        }
      >
        {SOURCES.map(s => (
          <SelectItem key={s.value} value={s.value} text={s.label} />
        ))}
      </Select>
    </div>
    <div className="w-[200px] shrink-0">
      <Select
        id="agent-logs-step"
        labelText="Step"
        size="sm"
        value={filters.step}
        onChange={(ev: React.ChangeEvent<HTMLSelectElement>) =>
          onChange({ ...filters, step: ev.target.value })
        }
      >
        <SelectItem value="all" text="All steps" />
        {steps.map(s => (
          <SelectItem key={s.value} value={s.value} text={s.label} />
        ))}
      </Select>
    </div>
    <div className="shrink-0 whitespace-nowrap pb-1">
      <Checkbox
        id="agent-logs-problems"
        labelText="Only problems"
        checked={filters.onlyProblems}
        onChange={(_: unknown, { checked }: { checked: boolean }) =>
          onChange({ ...filters, onlyProblems: checked })
        }
      />
    </div>
    <div className="ml-auto shrink-0">
      <Button kind="tertiary" size="sm" onClick={onExpandAll}>
        {expandAll ? "Collapse all" : "Expand all"}
      </Button>
    </div>
  </div>
);

// ---------------------------------------------------------------- page

/**
 * Agent logs (B4): what each step of one run did and why, readable at a glance — a summary
 * strip, a timeline, and one card per entry with the same parts every time. The exact message
 * and reply stay one click away. The Ally team only (ally-be answers 403 otherwise).
 */
export const AgentLogsPage: React.FC = () => {
  const { runId = "" } = useParams<{ runId: string }>();
  const [params] = useSearchParams();
  const t = en.debriefs.agentLogs;
  const q = useGetDebriefRunLogsQuery(runId, { refetchOnMountOrArgChange: true });
  const models = useGetDebriefModelsQuery();
  const modelLabel = modelLabels(models.data);
  const [filters, setFilters] = useState<LogFilters>(NO_FILTERS);
  const [expandAll, setExpandAll] = useState(false);

  const view = q.data;
  const entries = useMemo(() => view?.entries ?? [], [view]);
  const shown = useMemo(() => filterEntries(entries, filters), [entries, filters]);
  const steps = useMemo(() => stepOptions(entries), [entries]);

  const qs = params.toString();
  const head = (
    <div className="flex min-w-0 flex-nowrap items-center gap-3" data-testid="agent-logs-header">
      <span className="shrink-0">
        <BackLink to={`${ROUTES.DEBRIEF_SESSION(runId)}${qs ? `?${qs}` : ""}`}>{t.back}</BackLink>
      </span>
      <h1 className="shrink-0 whitespace-nowrap font-secondary text-[28px] font-normal">
        {t.title}
      </h1>
      {view && (
        <TruncatedTitle
          text={scenarioTitle(view.run.scenarioTitle, view.run.sessionId)}
          testId="agent-logs-summary"
          className="text-sm text-neutral-600"
        />
      )}
      <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-neutral-600">
        Ally team only
      </span>
    </div>
  );

  if (q.isError && !view) {
    return (
      <div className="flex flex-col gap-4 font-primary">
        {head}
        <ErrorPanel
          forbiddenMessage={t.noAccess}
          what={t.loadFailed}
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  }
  if (!view) {
    return (
      <div className="flex flex-col gap-4 font-primary">
        {head}
        <LoadingBlock lines={12} />
      </div>
    );
  }

  const loggedFrom = view.loggedFrom
    ? t.loggedFrom(longDate(view.loggedFrom))
    : t.loggedFromUnknown;

  return (
    <div className="flex flex-col gap-4 font-primary" data-testid="agent-logs">
      {head}
      <SummaryStrip view={view} />
      <FilterRow
        filters={filters}
        onChange={setFilters}
        steps={steps}
        expandAll={expandAll}
        onExpandAll={() => setExpandAll(x => !x)}
      />
      {entries.length === 0 ? (
        <EmptyPanel title={t.empty} message={loggedFrom} />
      ) : (
        <div className="flex min-w-0 gap-6">
          <Timeline entries={shown} />
          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            {shown.length === 0 ? (
              <EmptyPanel title="No entry matches these filters" />
            ) : (
              <ol className="m-0 flex list-none flex-col gap-3.5 p-0" data-testid="log-entries">
                {shown.map(e => (
                  <Entry
                    key={e.seq}
                    entry={e}
                    entries={entries}
                    prompts={view.prompts}
                    modelLabel={modelLabel}
                    expandAll={expandAll}
                  />
                ))}
              </ol>
            )}
            <p className="m-0 text-[13px] text-neutral-600">
              {loggedFrom} · {t.note}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentLogsPage;
