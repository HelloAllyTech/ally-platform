import React, { useEffect, useMemo, useRef, useState } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button, Tag, Tile } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { BuilderBuildEvent } from "@types";
import { asAgentText, asAgentTextList, formatRelativeTime, formatTimestamp } from "@utils";

import { DiffBlock } from "./DiffBlock";
import { formatEventGap } from "./runFormat";
import {
  builderTransition,
  prefersReducedMotion,
  staggerDelayMs,
} from "../../pages/Builder/builderMotion";
import { sharedMarkdownComponents } from "../markdown/markdownComponents";

/**
 * Human labels for the coding agent's tool ids — the raw names leak plumbing.
 * Keyed on opencode's lowercase ids; the lookup lowercases, so older runs
 * recorded with Claude Code's capitalised names (`Bash`, `WebFetch`) still
 * read the same. Unknown tools (our MCP `builder_*` tools among them) fall
 * back to their raw name.
 */
const TOOL_LABELS: Record<string, string> = {
  bash: "Ran a command",
  read: "Read a file",
  glob: "Looked for files",
  grep: "Searched the code",
  task: "Asked a sub-agent",
  webfetch: "Fetched a page",
};

export const toolLabel = (name: string) => TOOL_LABELS[name.toLowerCase()] ?? name;

/**
 * Events with no row of their own. `tool_result` in particular is not
 * dropped — {@link pairToolResults} reads it out of the full event list and
 * folds it into its call's expandable detail, which is a more useful reading
 * than a duplicate row underneath the call that produced it. `phase_cost` is
 * bookkeeping the header's spend figure already reflects.
 */
const HIDDEN_TYPES = new Set(["cost", "phase_cost", "done", "tool_result", "todo"]);

/**
 * How many rows the feed would show — the count a folded feed puts beside its
 * heading. Stage dividers are not updates, so they are not counted.
 */
export const countFeedUpdates = (events: BuilderBuildEvent[]): number =>
  events.filter(event => !HIDDEN_TYPES.has(event.type) && event.type !== "stage_change").length;

interface BuildActivityFeedProps {
  events: BuilderBuildEvent[];
  /** True while the run is live — drives auto-scroll and the live pill. */
  isLive: boolean;
  /**
   * How this run ended, when it ended badly. Rendered as the last row of the
   * feed rather than as a banner over it — see {@link FailureRow}.
   */
  failure?: { title: string; detail?: string | null } | null;
  /**
   * True until this run's events have been fetched once. Without it the feed
   * said "Waiting for the first update…" over a run that already had hundreds
   * of events, for as long as the first fetch took.
   */
  isLoading?: boolean;
  /**
   * Set when the run on screen is an issue build. opencode does the work in
   * the target repo's Actions, so this feed only gets what Builder's 5-minute
   * check sees — the copy says so and points at the live log, and stage
   * dividers use issue wording ("CI running", not "Running the checks").
   */
  issueBuild?: { actionsLogUrl: string | null } | null;
}

/**
 * Markdown, parsed once per distinct body.
 *
 * Every `text`, `plan` and `report` row is a full remark parse, and none of the
 * rows were memoised — so one new event at the bottom of the feed re-parsed
 * every block above it. A long build produces thousands of events, and the feed
 * re-renders on each one.
 */
const Markdown = React.memo<{ children: string }>(({ children }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={sharedMarkdownComponents}>
    {children}
  </ReactMarkdown>
));
Markdown.displayName = "Markdown";

/** A relative timestamp with the exact moment one hover away, per house convention. */
const EventTimestamp: React.FC<{ createdAt: string }> = ({ createdAt }) => (
  <span
    className="shrink-0 whitespace-nowrap text-xs tabular-nums text-typography-400"
    title={formatTimestamp(createdAt)}
  >
    {formatRelativeTime(createdAt)}
  </span>
);

/** A collapsed row that expands to its full payload. */
const ExpandableRow: React.FC<{
  icon: React.ReactNode;
  summary: React.ReactNode;
  detail?: string;
  createdAt?: string;
}> = ({ icon, summary, detail, createdAt }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-neutral-50 disabled:cursor-default"
        disabled={!detail}
        onClick={() => setOpen(prev => !prev)}
      >
        <span className="shrink-0 text-typography-400">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-typography-600">{summary}</span>
        {createdAt && <EventTimestamp createdAt={createdAt} />}
        {detail && <span className="shrink-0 text-typography-400">{open ? "−" : "+"}</span>}
      </button>
      {open && detail && (
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-neutral-50 p-2 text-xs text-typography-700">
          {detail}
        </pre>
      )}
    </div>
  );
};

/**
 * How a build's failure reads, at the point in the feed where it happened.
 *
 * This used to be two banners. A session-level `InlineNotification` pinned
 * under the page header, and a second one for the run's own error below the
 * pull request list — so a failed build put one red block above the transcript
 * and another below it, with the transcript's own account of the same failure
 * in between. Neither moved when you scrolled past what they described, and
 * each one cost a fixed strip of a window that is mostly transcript.
 *
 * They are one row here instead, last in the feed, because that is where the
 * failure actually happened: the last thing the build did. The headline sentence
 * is always visible — this is the one event on the page a person came to read —
 * and anything more technical sits behind the same `+` every tool call in this
 * feed uses, so there is one way to open detail rather than a second vocabulary
 * for errors.
 *
 * Error-toned, not alarm-toned. By the time this renders the header already
 * says "Failed" and offers "Retry build"; a third red rectangle restating it
 * adds no information and makes the page harder to read.
 */
const FailureRow: React.FC<{ title: string; detail?: string | null }> = ({ title, detail }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-support-error/30 bg-support-error/5 px-3 py-2">
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5 shrink-0 text-support-error">
          ⊘
        </span>
        <div className="min-w-0 flex-1">
          {/* Markdown, so a URL in the error (an issue, a log) is a link
              rather than text to copy out by hand. */}
          <div className="prose prose-sm max-w-none text-sm text-typography-800">
            <Markdown>{title}</Markdown>
          </div>
          {detail && (
            <button
              type="button"
              className="mt-1 text-xs text-typography-500 underline-offset-2 hover:underline"
              onClick={() => setOpen(prev => !prev)}
              aria-expanded={open}
            >
              {open ? "−" : "+"} {en.builder.build.failureDetail}
            </button>
          )}
          {open && detail && (
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs text-typography-700">
              {detail}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};

/** A file edit, shown as a line-level diff rather than a tool row. */
const FileEditRow: React.FC<{ payload: Record<string, any>; createdAt: string }> = ({
  payload,
  createdAt,
}) => {
  const [open, setOpen] = useState(false);
  const oldText = String(payload.oldText ?? "");
  const newText = String(payload.newText ?? "");

  return (
    <div className="rounded border border-neutral-200 text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-neutral-50"
        onClick={() => setOpen(prev => !prev)}
      >
        <Tag type="purple" size="sm">
          {payload.operation === "write" ? "new" : "edit"}
        </Tag>
        <span className="min-w-0 flex-1 truncate font-mono text-typography-700">
          {String(payload.path ?? "")}
        </span>
        <EventTimestamp createdAt={createdAt} />
        <span className="shrink-0 text-typography-400">{open ? "−" : "+"}</span>
      </button>
      {open && <DiffBlock oldText={oldText} newText={newText} />}
    </div>
  );
};

/**
 * A tool call's arguments and — once one is found — its paired result,
 * joined into one expandable detail block. Nothing here assumes a particular
 * correlation field: {@link pairToolResults} tries an explicit call/result id
 * first and falls back to matching same-named calls and results in order.
 */
const buildToolCallDetail = (
  strings: typeof en.builder.build,
  payload: Record<string, any>,
  result: BuilderBuildEvent | undefined,
): string | undefined => {
  const argsSource = payload.input ?? payload.arguments ?? payload.args ?? null;
  const argsText =
    argsSource === null
      ? ""
      : typeof argsSource === "object"
        ? JSON.stringify(argsSource, null, 2)
        : asAgentText(argsSource);

  const parts: string[] = [];
  if (argsText.trim()) parts.push(`${strings.toolArgumentsHeading}\n${argsText}`);

  if (result) {
    const resultPayload = result.payload ?? {};
    const resultText =
      asAgentText(resultPayload.summary) ||
      asAgentText(resultPayload.result) ||
      asAgentText(resultPayload.text) ||
      asAgentText(resultPayload.output);
    parts.push(`${strings.toolResultHeading}\n${resultText || strings.noToolResult}`);
  }

  return parts.length ? parts.join("\n\n") : undefined;
};

/**
 * Pairs each `tool_call` event with the `tool_result` that answers it, over
 * the FULL event list (before the hidden-type filter drops `tool_result`
 * rows from view — they still carry the data a paired call needs to show).
 *
 * Tries an explicit correlation id first (`id`/`toolUseId`/`callId`, however
 * either side happens to carry it), then falls back to matching same-named
 * calls and results in the order they occur — sound because a run only ever
 * has one call for a given tool outstanding at a time.
 */
/**
 * How much of a tool call's summary belongs on the collapsed row.
 *
 * The summary is usually the command itself, and Builder's commands are long —
 * a `cd` into the runner's checkout, a heredoc, a curl with a JSON body. Printed
 * in full they wrap over several lines each, and a run with a hundred tool calls
 * becomes a wall nobody reads, which is how a feed with real signal in it
 * (gate results, verification, the plan) gets scrolled past.
 *
 * The full text is one click away in the expanded detail, so nothing is lost —
 * this only stops the collapsed row from being the whole command.
 */
const TOOL_SUMMARY_MAX = 96;

export const collapseToolSummary = (summary: string): string => {
  const oneLine = summary.replace(/\s+/g, " ").trim();
  if (oneLine.length <= TOOL_SUMMARY_MAX) return oneLine;
  // Cut at a word boundary when one is near the end, so the row does not end
  // mid-token — the same reasoning the session title uses.
  const cut = oneLine.slice(0, TOOL_SUMMARY_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > TOOL_SUMMARY_MAX * 0.7 ? cut.slice(0, lastSpace) : cut}…`;
};

const pairToolResults = (events: BuilderBuildEvent[]): Map<string, BuilderBuildEvent> => {
  const correlationId = (payload: Record<string, any> | undefined) =>
    asAgentText(payload?.id) || asAgentText(payload?.toolUseId) || asAgentText(payload?.callId);

  const callsById = new Map<string, BuilderBuildEvent>();
  const callQueueByName = new Map<string, BuilderBuildEvent[]>();

  for (const event of events) {
    if (event.type !== "tool_call") continue;
    const id = correlationId(event.payload);
    if (id) callsById.set(id, event);
    const name = asAgentText(event.payload?.name);
    const queue = callQueueByName.get(name) ?? [];
    queue.push(event);
    callQueueByName.set(name, queue);
  }

  const resultByCallRowId = new Map<string, BuilderBuildEvent>();
  const consumed = new Set<string>();

  for (const event of events) {
    if (event.type !== "tool_result") continue;
    const id = correlationId(event.payload);
    let call = id ? callsById.get(id) : undefined;
    if (!call) {
      const name = asAgentText(event.payload?.name);
      call = callQueueByName.get(name)?.find(candidate => !consumed.has(candidate.id));
    }
    if (call && !consumed.has(call.id)) {
      consumed.add(call.id);
      resultByCallRowId.set(call.id, event);
    }
  }

  return resultByCallRowId;
};

/**
 * The build transcript.
 *
 * Read the way a terminal is read, so it defaults to the agent's narration
 * and milestones, with tool detail collapsed behind a click. Showing every
 * tool call expanded would be more transparent and much less useful — the
 * point is to be able to follow along, not to audit every step.
 */
export const BuildActivityFeed: React.FC<BuildActivityFeedProps> = ({
  events,
  isLive,
  isLoading = false,
  failure,
  issueBuild = null,
}) => {
  const strings = en.builder.build;
  const stageLabels = issueBuild
    ? { ...en.builder.stages, ...en.builder.issueStages }
    : en.builder.stages;
  const budgetFeed = en.builder.budget.feed;
  const containerRef = useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  // Auto-scroll only while the reader is already at the bottom. Yanking the
  // view back down while someone is reading earlier output is the single most
  // irritating thing a live log can do.
  useEffect(() => {
    if (!pinnedToBottom || !containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [events, pinnedToBottom]);

  const handleScroll = () => {
    const element = containerRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    setPinnedToBottom(distance < 80);
  };

  const jumpToLive = () => {
    const element = containerRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    setPinnedToBottom(true);
  };

  // Memoised like `toolResultsByCall` below it. This ran on every render of a
  // feed that re-renders on every socket push.
  const visible = useMemo(() => events.filter(event => !HIDDEN_TYPES.has(event.type)), [events]);

  // Built over the FULL event list, not `visible` — a tool_result row is
  // filtered out of the feed but still has to be read to answer "what came
  // back" for the call it belongs to.
  const toolResultsByCall = useMemo(() => pairToolResults(events), [events]);

  const renderEvent = (event: BuilderBuildEvent, index: number) => {
    const payload = event.payload ?? {};
    const style = prefersReducedMotion()
      ? undefined
      : {
          animation: "builderFadeIn 240ms both",
          animationDelay: `${staggerDelayMs(index)}ms`,
          transition: builderTransition(["opacity"], "fast"),
        };

    switch (event.type) {
      case "text":
        return (
          <div key={event.id} style={style} className="prose prose-sm max-w-none text-sm">
            <Markdown>{String(payload.text ?? "")}</Markdown>
          </div>
        );

      case "tool_call":
        return (
          <div key={event.id} style={style}>
            <ExpandableRow
              icon="›"
              summary={
                <>
                  <span className="font-medium">{toolLabel(String(payload.name ?? ""))}</span>
                  {asAgentText(payload.summary)
                    ? ` — ${collapseToolSummary(asAgentText(payload.summary))}`
                    : ""}
                </>
              }
              detail={buildToolCallDetail(strings, payload, toolResultsByCall.get(event.id))}
              createdAt={event.createdAt}
            />
          </div>
        );

      case "file_edit":
        return (
          <div key={event.id} style={style}>
            <FileEditRow payload={payload} createdAt={event.createdAt} />
          </div>
        );

      case "stage_change":
        return (
          <div key={event.id} style={style} className="flex items-center gap-2 py-1">
            <span className="h-px flex-1 bg-neutral-200" />
            <span className="text-xs font-medium tracking-wide text-typography-500">
              {stageLabels[asAgentText(payload.stage)] ?? asAgentText(payload.stage)}
            </span>
            <span className="h-px flex-1 bg-neutral-200" />
          </div>
        );

      case "plan":
        return (
          <Tile key={event.id} style={style} className="text-sm">
            <p className="mb-1 text-xs font-semibold tracking-wide text-typography-500">
              {strings.planHeading}
            </p>
            <div className="prose prose-sm max-w-none">
              <Markdown>{String(payload.text ?? "")}</Markdown>
            </div>
          </Tile>
        );

      case "test_output":
        return (
          <div key={event.id} style={style}>
            <ExpandableRow
              icon="⌘"
              summary={strings.testOutput}
              detail={String(payload.text ?? "")}
              createdAt={event.createdAt}
            />
          </div>
        );

      case "gate_result": {
        // The one card that reports a machine-checked fact rather than the
        // agent's account of itself, so it says so: "Checked" beside a pass,
        // and — when a suite was already red — which failures this change
        // caused versus which it inherited.
        const passed = payload.passed === true;
        const newFailures = asAgentTextList(payload.newFailures);
        const preExisting = asAgentTextList(payload.preExistingFailures);
        const heading = `${asAgentText(payload.repo)} · ${asAgentText(payload.kind)}`;

        return (
          <Tile
            key={event.id}
            style={style}
            className={[
              "border-l-4 text-sm",
              passed ? "border-l-support-success" : "border-l-support-error",
            ].join(" ")}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-semibold tracking-wide text-typography-500">
                {heading}
              </span>
              <Tag type={passed ? "green" : "red"} size="sm" className="shrink-0">
                {passed ? strings.gatePassed : strings.gateFailed}
              </Tag>
              <span className="text-xs text-typography-400">{strings.gateVerified}</span>
              <span className="ml-auto">
                <EventTimestamp createdAt={event.createdAt} />
              </span>
            </div>
            {asAgentText(payload.command) ? (
              <p className="font-mono text-xs text-typography-500">
                {asAgentText(payload.command)}
              </p>
            ) : null}
            {newFailures.length ? (
              <div className="mt-2">
                <p className="text-xs font-medium text-support-error">
                  {strings.gateNewFailures(newFailures.length)}
                </p>
                <ul className="mt-1 list-inside list-disc font-mono text-xs text-typography-600">
                  {newFailures.map((failure, failureIndex) => (
                    <li key={`${event.id}-new-${failureIndex}`}>{failure}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preExisting.length ? (
              <p className="mt-2 text-xs text-typography-400">
                {strings.gatePreExisting(preExisting.length)}
              </p>
            ) : null}
            {asAgentText(payload.outputTail) ? (
              <div className="mt-2">
                <ExpandableRow
                  icon="⌘"
                  summary={strings.gateOutput}
                  detail={asAgentText(payload.outputTail)}
                />
              </div>
            ) : null}
          </Tile>
        );
      }

      case "ci_result": {
        // The repo's own CI on the pull request opencode opened — modelled on
        // the gate card above, and like it, a checked fact rather than the
        // agent's account of itself.
        const state = asAgentText(payload.state);
        const failedChecks = asAgentTextList(payload.failed);
        const tone =
          state === "success" ? "green" : state === "failure" ? "red" : ("blue" as const);
        const prNumber = asAgentText(payload.prNumber);
        const prUrl = asAgentText(payload.prUrl);
        const sha = asAgentText(payload.sha);

        return (
          <Tile
            key={event.id}
            style={style}
            className={[
              "border-l-4 text-sm",
              state === "success"
                ? "border-l-support-success"
                : state === "failure"
                  ? "border-l-support-error"
                  : "border-l-primary-500",
            ].join(" ")}
          >
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold tracking-wide text-typography-500">
                {asAgentText(payload.repo)}
                {prNumber ? ` · ` : ""}
              </span>
              {prNumber ? (
                prUrl ? (
                  <a
                    href={prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-primary-700 hover:underline"
                  >
                    {strings.prLink(Number(prNumber))}
                  </a>
                ) : (
                  <span className="text-xs font-semibold">{strings.prLink(Number(prNumber))}</span>
                )
              ) : null}
              <Tag type={tone} size="sm" className="shrink-0">
                {strings.ciStatus[state] ?? state}
              </Tag>
              <span className="text-xs text-typography-400">{strings.ciResultVerified}</span>
              <span className="ml-auto">
                <EventTimestamp createdAt={event.createdAt} />
              </span>
            </div>
            {sha ? (
              <p className="font-mono text-xs text-typography-500">{sha.slice(0, 7)}</p>
            ) : null}
            {failedChecks.length ? (
              <div className="mt-2">
                <p className="text-xs font-medium text-support-error">
                  {strings.ciResultFailedChecks(failedChecks.length)}
                </p>
                <ul className="mt-1 list-inside list-disc font-mono text-xs text-typography-600">
                  {failedChecks.map((check, checkIndex) => (
                    <li key={`${event.id}-ci-${checkIndex}`}>{check}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Tile>
        );
      }

      case "verification": {
        const verdict = asAgentText(payload.verdict);
        const objections = Array.isArray(payload.objections) ? payload.objections : [];
        const failed = verdict === "fail";
        const round = Number(payload.round) || null;

        return (
          <Tile
            key={event.id}
            style={style}
            className={[
              "border-l-4 text-sm",
              failed ? "border-l-support-warning" : "border-l-primary-500",
            ].join(" ")}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-semibold tracking-wide text-typography-500">
                {round ? strings.verificationRoundHeading(round) : strings.verificationHeading}
              </span>
              {verdict ? (
                <Tag type={failed ? "magenta" : "green"} size="sm" className="shrink-0">
                  {failed ? strings.verificationFailed : strings.verificationPassed}
                </Tag>
              ) : null}
              <span className="ml-auto">
                <EventTimestamp createdAt={event.createdAt} />
              </span>
            </div>

            {/* A failing verdict is not the end of the run any more — the coder
                gets re-invoked with these. Saying so stops a red card reading
                as a dead build. */}
            {failed ? (
              <p className="mb-2 text-xs text-typography-500">{strings.verificationRemediating}</p>
            ) : null}

            {objections.length ? (
              <ul className="mb-2 space-y-2">
                {objections.map((raw, objectionIndex) => {
                  const objection = (raw ?? {}) as Record<string, unknown>;
                  const where = [asAgentText(objection.repo), asAgentText(objection.file)]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <li key={`${event.id}-objection-${objectionIndex}`} className="text-sm">
                      <div className="flex items-start gap-2">
                        <Tag
                          type={asAgentText(objection.severity) === "blocking" ? "red" : "gray"}
                          size="sm"
                          className="mt-0.5 shrink-0"
                        >
                          {asAgentText(objection.severity) || "concern"}
                        </Tag>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{asAgentText(objection.summary)}</p>
                          {where ? (
                            <p className="font-mono text-xs text-typography-400">{where}</p>
                          ) : null}
                          {asAgentText(objection.detail) ? (
                            <p className="mt-0.5 text-xs text-typography-600">
                              {asAgentText(objection.detail)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {asAgentText(payload.notes) ? (
              <div className="prose prose-sm max-w-none">
                <Markdown>{asAgentText(payload.notes)}</Markdown>
              </div>
            ) : null}
          </Tile>
        );
      }

      case "e2e_evidence":
        return (
          <div key={event.id} style={style}>
            <ExpandableRow
              icon="◉"
              summary={strings.e2eEvidence}
              detail={String(payload.text ?? "")}
              createdAt={event.createdAt}
            />
          </div>
        );

      case "e2e_skipped":
        return (
          <p key={event.id} style={style} className="text-xs italic text-typography-500">
            {strings.e2eSkipped(String(payload.text ?? ""))}
          </p>
        );

      case "pr_opened":
        return (
          <Tile key={event.id} style={style} className="text-sm">
            <a
              href={String(payload.prUrl ?? "#")}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary-600 hover:underline"
            >
              {asAgentText(payload.repo)} #{asAgentText(payload.prNumber)}
            </a>
          </Tile>
        );

      case "report":
        return (
          <Tile key={event.id} style={style} className="text-sm">
            <p className="mb-1 text-xs font-semibold tracking-wide text-typography-500">
              {strings.reportHeading}
            </p>
            <div className="prose prose-sm max-w-none">
              <Markdown>{String(payload.text ?? payload.contentMd ?? "")}</Markdown>
            </div>
          </Tile>
        );

      // The one event that is neither progress nor failure: the run stopped
      // itself at a phase boundary and is waiting on a spend decision. Rendered
      // as its own row so the feed says where the work got to — the banner
      // above says what to do about it.
      case "budget_hold": {
        const money = (value: unknown) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? `$${parsed.toFixed(2)}` : "—";
        };
        const state = String(payload.state ?? "held");
        const text =
          state === "raised"
            ? budgetFeed.raised(money(payload.budgetUsd))
            : state === "headroom"
              ? budgetFeed.headroom(money(payload.budgetUsd))
              : state === "expired"
                ? budgetFeed.expired
                : budgetFeed.held(money(payload.spentUsd), money(payload.budgetUsd));
        return (
          <p
            key={event.id}
            style={style}
            className={
              state === "expired"
                ? "text-sm text-support-error"
                : "text-sm font-medium text-typography-800"
            }
          >
            {text}
          </p>
        );
      }

      case "error":
        return (
          <p key={event.id} style={style} className="text-sm text-support-error">
            {String(payload.text ?? payload.message ?? "")}
          </p>
        );

      default:
        return null;
    }
  };

  return (
    // Phone: the session column scrolls as a whole (see BuilderSession), so the feed takes a
    // bounded height of its own instead of whatever is left after the rails.
    <div className="relative flex min-h-0 flex-1 flex-col max-md:flex-none">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 max-md:max-h-[60dvh] max-md:min-h-[12rem]"
      >
        {/* An issue build's feed is sparse by nature — the work happens in
            the repo's Actions — so while it is live the way to watch it is
            stated up top, not only when the feed is empty. */}
        {issueBuild && isLive && !isLoading && (
          <p className="mb-2 text-xs text-typography-500">
            {issueBuild.actionsLogUrl ? strings.feedIssue : strings.feedIssueNoLog}{" "}
            {issueBuild.actionsLogUrl && (
              <a
                href={issueBuild.actionsLogUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary-700 hover:underline"
              >
                {strings.feedIssueLogLink}
              </a>
            )}
          </p>
        )}
        {visible.length === 0 && !failure ? (
          issueBuild && isLive && !isLoading ? null : (
            <p className="mt-8 text-center text-sm text-typography-500">
              {isLoading
                ? strings.feedLoading
                : events.length > 0
                  ? strings.feedWorking(events.length)
                  : isLive
                    ? strings.feedStarting
                    : strings.feedEmpty}
            </p>
          )
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((event, index) => {
              const previous = index > 0 ? visible[index - 1] : null;
              const gap = previous ? formatEventGap(previous.createdAt, event.createdAt) : null;
              return (
                <React.Fragment key={event.id}>
                  {gap && (
                    <p className="py-0.5 text-center text-xs text-typography-400">
                      {strings.eventGap(gap)}
                    </p>
                  )}
                  {renderEvent(event, index)}
                </React.Fragment>
              );
            })}
            {failure && <FailureRow title={failure.title} detail={failure.detail} />}
          </div>
        )}
      </div>

      {/* Only offered when it would actually do something: a pill inviting you
          to jump to a place you are already at is noise. */}
      {!pinnedToBottom && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <Button kind="secondary" size="sm" onClick={jumpToLive}>
            {strings.jumpToLive}
          </Button>
        </div>
      )}
    </div>
  );
};
