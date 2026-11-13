import React, { useMemo, useState } from "react";

import { useParams, useSearchParams } from "react-router-dom";

import { useGetDebriefModelsQuery, useGetDebriefRunLogsQuery } from "@api";
import {
  formatMs,
  formatUsd,
  releaseVersionLabel,
  shortId,
} from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en, ROUTES } from "@constants";
import { AgentLogEntry, AgentLogsView } from "@types";

import { modelLabels } from "../consoleLabels";
import { TruncatedTitle } from "../consoleRows";
import { BackLink } from "../consoleUi";
import {
  entryName,
  exactInput,
  paneLabels,
  promptLabel,
  rawInput,
  rawOutput,
  readableInput,
  readableOutput,
} from "./agentLogText";
import { scenarioTitle } from "../home/SessionCard";

type Mode = "readable" | "raw";

const ATTENTION = "#8A3800";

const num = (n: number) => n.toLocaleString("en-US");

const clock = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "";

const longDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** The text shown in a pane, with every match of `q` marked. */
const Highlighted: React.FC<{ text: string; q: string }> = ({ text, q }) => {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, at)) {
    if (i > at) parts.push(text.slice(at, i));
    parts.push(
      <mark key={i} className="bg-[#FDDC69] text-inherit" data-testid="log-match">
        {text.slice(i, i + needle.length)}
      </mark>,
    );
    at = i + needle.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
};

const CopyButton: React.FC<{ text: string; label: string }> = ({ text, label }) => {
  const t = en.debriefs.agentLogs;
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
      aria-label={`${t.copy}: ${label}`}
      className="ml-auto border-0 bg-transparent p-0 text-xs font-normal text-primary-500 hover:underline"
    >
      {state === "copied" ? t.copied : state === "failed" ? t.copyFailed : t.copy}
    </button>
  );
};

const Pane: React.FC<{
  label: string;
  text: string;
  copyText: string;
  q: string;
  testId: string;
  children?: React.ReactNode;
}> = ({ label, text, copyText, q, testId, children }) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <div className="flex items-center gap-2 text-xs font-semibold text-neutral-800">
      {label}
      <CopyButton text={copyText} label={label} />
    </div>
    {children}
    <pre
      className="m-0 max-h-[220px] overflow-auto whitespace-pre-wrap break-words bg-white px-3 py-2.5 font-mono text-xs leading-normal"
      data-testid={testId}
    >
      <Highlighted text={text} q={q} />
    </pre>
  </div>
);

const SystemPrompt: React.FC<{ entry: AgentLogEntry; prompts: Record<string, string> }> = ({
  entry,
  prompts,
}) => {
  const t = en.debriefs.agentLogs;
  const [open, setOpen] = useState(false);
  if (!entry.prompt) return null;
  const text = prompts[`${entry.prompt.code}@${entry.prompt.version}`];
  return (
    <div className="bg-white px-2.5 py-1.5 text-xs text-neutral-600" data-testid="system-prompt">
      {t.systemPrompt}: {promptLabel(entry.prompt)} ·{" "}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="border-0 bg-transparent p-0 text-xs text-primary-500 hover:underline"
      >
        {open ? t.hidePrompt : t.showPrompt}
      </button>
      {open && (
        <pre
          className="m-0 mt-1.5 max-h-[220px] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-neutral-800"
          data-testid="system-prompt-text"
        >
          {text ?? t.promptMissing}
        </pre>
      )}
    </div>
  );
};

const meta = (e: AgentLogEntry): string => {
  const t = en.debriefs.agentLogs;
  return [
    e.ms != null ? formatMs(e.ms) : null,
    e.tokensIn != null || e.tokensOut != null
      ? t.tokens(num(e.tokensIn ?? 0), num(e.tokensOut ?? 0))
      : null,
    e.costUsd != null ? formatUsd(e.costUsd) : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

const Entry: React.FC<{
  entry: AgentLogEntry;
  mode: Mode;
  q: string;
  prompts: Record<string, string>;
  modelLabel: (id: string) => string;
}> = ({ entry: e, mode, q, prompts, modelLabel }) => {
  const t = en.debriefs.agentLogs;
  const labels = paneLabels(e);
  const status = e.error ? t.failed : e.attention ? t.attention : t.done;
  const name = entryName(e.step);
  const input = mode === "raw" ? rawInput(e) : readableInput(e);
  const output = mode === "raw" ? rawOutput(e) : readableOutput(e);
  const extra = [
    e.round !== null ? t.round(e.round) : null,
    e.kind === "model" ? (e.retries ? t.retry(e.retries) : t.noRetries) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li
      className="rounded-sm bg-neutral-50"
      style={{ borderLeft: `3px solid ${e.attention || e.error ? ATTENTION : "transparent"}` }}
      data-testid="log-entry"
      data-attention={e.attention || !!e.error ? "true" : "false"}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 border-b border-neutral-100 px-[18px] py-3">
        <span className="text-xs text-neutral-600">
          {e.seq} · {clock(e.startedAt)}
        </span>
        <span className="text-[15px] font-semibold">{name}</span>
        <span
          className="text-[13px] font-semibold"
          style={{ color: e.attention || e.error ? ATTENTION : "#0E6027" }}
        >
          {status}
        </span>
        <span className="ml-auto text-xs text-neutral-600">{meta(e)}</span>
      </div>
      <div className="flex flex-wrap gap-x-[18px] gap-y-1 px-[18px] py-2 text-xs text-neutral-800">
        <span title={e.model ?? undefined}>
          {e.model ? modelLabel(e.model) : t.code}
          {e.fallbackModel ? ` · ${t.backup(modelLabel(e.fallbackModel))}` : ""}
        </span>
        {e.prompt && (
          <span>
            {t.prompt}:{" "}
            <a href={e.prompt.href} target="_blank" rel="noreferrer">
              {promptLabel(e.prompt)}
            </a>
          </span>
        )}
        {extra && <span>{extra}</span>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(380px,1fr))] gap-3 px-[18px] pb-3.5">
        <Pane
          label={labels.input}
          text={input}
          copyText={mode === "raw" ? input : exactInput(e, prompts)}
          q={q}
          testId="log-input"
        >
          {mode === "readable" && e.prompt?.inlined && <SystemPrompt entry={e} prompts={prompts} />}
        </Pane>
        <Pane label={labels.output} text={output} copyText={output} q={q} testId="log-output" />
      </div>
    </li>
  );
};

const summaryLine = (v: AgentLogsView): string => {
  const t = en.debriefs.agentLogs.summary;
  return [
    scenarioTitle(v.run.scenarioTitle, v.run.sessionId),
    t.run(shortId(v.runId)),
    v.run.releaseVersion != null ? t.version(releaseVersionLabel(v.run.releaseVersion)) : null,
    t.entries(v.entries.length),
    v.run.costUsd != null ? formatUsd(v.run.costUsd) : null,
    v.run.seconds != null ? t.seconds(v.run.seconds) : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

/** Everything an entry shows in either view, for the search. */
const haystack = (e: AgentLogEntry): string =>
  [
    entryName(e.step),
    e.step,
    e.model,
    e.fallbackModel,
    e.prompt ? promptLabel(e.prompt) : "",
    readableInput(e),
    readableOutput(e),
    rawInput(e),
    rawOutput(e),
  ]
    .join("\n")
    .toLowerCase();

/**
 * Agent logs (B3): the exact input every agent of one run was sent and its full reply, in
 * order, for debugging and improving the agents. The Ally team only (ally-be answers 403
 * otherwise); it holds the whole transcript and goes with the session.
 */
export const AgentLogsPage: React.FC = () => {
  const { runId = "" } = useParams<{ runId: string }>();
  const [params] = useSearchParams();
  const t = en.debriefs.agentLogs;
  const q = useGetDebriefRunLogsQuery(runId, { refetchOnMountOrArgChange: true });
  const models = useGetDebriefModelsQuery();
  const modelLabel = modelLabels(models.data);
  const [mode, setMode] = useState<Mode>("readable");
  const [search, setSearch] = useState("");
  const needle = search.trim();

  const view = q.data;
  const shown = useMemo(() => {
    const all = view?.entries ?? [];
    if (!needle) return all;
    const n = needle.toLowerCase();
    return all.filter(e => haystack(e).includes(n));
  }, [view, needle]);

  const qs = params.toString();
  const back = (
    <span className="shrink-0">
      <BackLink to={`${ROUTES.DEBRIEF_SESSION(runId)}${qs ? `?${qs}` : ""}`}>{t.back}</BackLink>
    </span>
  );
  const heading = (
    <h1 className="shrink-0 whitespace-nowrap font-secondary text-[28px] font-normal">{t.title}</h1>
  );

  if (q.isError && !view) {
    return (
      <div className="flex flex-col gap-4 font-primary">
        <div className="flex min-w-0 flex-nowrap items-center gap-3">
          {back}
          {heading}
        </div>
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
        <div className="flex min-w-0 flex-nowrap items-center gap-3">
          {back}
          {heading}
        </div>
        <LoadingBlock lines={12} />
      </div>
    );
  }

  const summary = summaryLine(view);
  const loggedFrom = view.loggedFrom
    ? t.loggedFrom(longDate(view.loggedFrom))
    : t.loggedFromUnknown;

  return (
    <div className="flex flex-col gap-4 font-primary" data-testid="agent-logs">
      <div className="flex min-w-0 flex-nowrap items-center gap-3" data-testid="agent-logs-header">
        {back}
        {heading}
        <TruncatedTitle
          text={summary}
          testId="agent-logs-summary"
          className="text-sm text-neutral-600"
        />
      </div>

      <div
        className="sticky top-0 z-[2] flex min-w-0 flex-nowrap items-center gap-3 border-b border-neutral-100 bg-white py-2"
        data-testid="agent-logs-toolbar"
      >
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t.search}
          aria-label={t.searchLabel}
          className="h-9 min-w-[180px] max-w-[520px] flex-[1_1_320px] border-0 border-b border-neutral-500 bg-neutral-50 px-3 text-sm"
        />
        <span
          role="group"
          aria-label={t.show}
          className="flex shrink-0 overflow-hidden rounded-sm border border-primary-500"
        >
          {(["readable", "raw"] as Mode[]).map(m => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`h-8 whitespace-nowrap border-0 px-3 text-[13px] ${
                mode === m ? "bg-primary-500 text-white" : "bg-white text-primary-500"
              }`}
            >
              {m === "readable" ? t.readable : t.raw}
            </button>
          ))}
        </span>
        <span title={t.note} className="min-w-0 truncate text-xs text-neutral-600">
          {needle && view.entries.length ? `${t.matches(shown.length)} · ` : ""}
          {t.note}
        </span>
      </div>

      {view.entries.length === 0 ? (
        <EmptyPanel title={t.empty} message={loggedFrom} />
      ) : shown.length === 0 ? (
        <EmptyPanel title={t.noMatch(needle)} />
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3.5 p-0" data-testid="log-entries">
          {shown.map(e => (
            <Entry
              key={e.seq}
              entry={e}
              mode={mode}
              q={needle}
              prompts={view.prompts}
              modelLabel={modelLabel}
            />
          ))}
        </ol>
      )}

      {view.entries.length > 0 && <p className="text-[13px] text-neutral-600">{loggedFrom}</p>}
    </div>
  );
};

export default AgentLogsPage;
