import { useState } from "react";

import { Add, Play } from "@carbon/icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  Accordion,
  AccordionItem,
  Button,
  CarbonDropdown as Dropdown,
  InlineNotification,
  ProgressBar,
  SkeletonPlaceholder,
  Tag,
  Tile,
  Tooltip,
} from "@ally-ui-mono/ui-shared";
import {
  useGetAnalyticsAuditQuery,
  useGetAnalyticsAuditsQuery,
  useStartAnalyticsAuditMutation,
} from "@api";
import { TooltipIcon } from "@assets";
import { sharedMarkdownComponents } from "@components";
import { en } from "@constants";
import {
  AnalyticsAuditCountKey,
  AnalyticsAuditDetail,
  AnalyticsAuditedMessage,
  AnalyticsAuditSeverity,
  AnalyticsAuditStatus,
  AnalyticsAuditSummary,
  AnalyticsAuditTrigger,
} from "@types";

/**
 * Audit agent — the tab where an auditor re-checks the Analytics Agent's recent
 * answers.
 *
 * Starting an audit does not wait for it: a run takes minutes (every answer is
 * its own agent run, querying BigQuery and reading the dbt and product repos), so
 * the server accepts it, keeps going in the background, and saves each answer's
 * finding as it finishes. This tab follows the open run by polling, which is why a
 * reader can start one, leave, and come back to the result in the sidebar.
 *
 * Only one audit runs at a time — the server refuses a second — so Start is
 * disabled while one is in progress rather than left to fail.
 *
 * Unlike the Agent tab's conversations, which are private to their author, an
 * audit covers every admin's questions. The sidebar says so.
 */

/** How many recent answers a run may cover. Each is a full agent run, so the
 *  list stops well short of the server's ceiling. */
const COUNT_OPTIONS = [5, 10, 15, 25, 50];
const DEFAULT_COUNT = 15;
/** How often a running audit (and the list) is refetched. */
const POLL_MS = 4000;
/** How often the list is refetched while nothing is running, so a scheduled run
 *  that starts while the tab sits open is noticed (and then polled at POLL_MS). */
const IDLE_POLL_MS = 60_000;

type TagColor = "green" | "red" | "blue" | "magenta" | "gray" | "cool-gray";

const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Verdict order is also the order the count tags are shown in: good news first. */
const VERDICT_ORDER: AnalyticsAuditCountKey[] = [
  "correct",
  "minor_issues",
  "incorrect",
  "unverifiable",
  "error",
];

const verdictMeta = (key: AnalyticsAuditCountKey): { type: TagColor; label: string } => {
  const strings = en.analyticsAudit;
  switch (key) {
    case "correct":
      return { type: "green", label: strings.verdictCorrect };
    case "minor_issues":
      return { type: "blue", label: strings.verdictMinorIssues };
    case "incorrect":
      return { type: "red", label: strings.verdictIncorrect };
    case "unverifiable":
      return { type: "gray", label: strings.verdictUnverifiable };
    default:
      return { type: "magenta", label: strings.verdictError };
  }
};

const severityMeta = (severity: AnalyticsAuditSeverity): { type: TagColor; label: string } => {
  const strings = en.analyticsAudit;
  if (severity === "high") return { type: "red", label: strings.severityHigh };
  if (severity === "medium") return { type: "magenta", label: strings.severityMedium };
  return { type: "gray", label: strings.severityLow };
};

const statusMeta = (status: AnalyticsAuditStatus): { type: TagColor; label: string } => {
  const strings = en.analyticsAudit;
  if (status === "running") return { type: "blue", label: strings.statusRunning };
  if (status === "failed") return { type: "red", label: strings.statusFailed };
  return { type: "cool-gray", label: strings.statusCompleted };
};

const triggerLabel = (trigger: AnalyticsAuditTrigger): string =>
  trigger === "scheduled" ? en.analyticsAudit.triggerScheduled : en.analyticsAudit.triggerManual;

/** One audited answer: the question, the verdict, what the auditor found, and
 *  the answer it was judging behind one click. */
const AuditEntry = ({ entry }: { entry: AnalyticsAuditedMessage }) => {
  const strings = en.analyticsAudit;
  const { audit } = entry;
  const verdict = verdictMeta(audit ? audit.verdict : "error");

  return (
    <Tile className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words rounded bg-neutral-100 px-3 py-2 text-sm text-typography-900">
            {entry.question}
          </div>
          <p className="text-xs text-typography-500 mt-1">
            {fill(strings.askedAt, { date: formatDate(entry.askedAt) })}
          </p>
        </div>
        <Tag type={verdict.type} className="shrink-0">
          {verdict.label}
        </Tag>
      </div>

      {audit ? (
        <div className="mt-3 min-w-0">
          <div className="break-words text-sm text-typography-900">
            <ReactMarkdown components={sharedMarkdownComponents} remarkPlugins={[remarkGfm]}>
              {audit.summary}
            </ReactMarkdown>
          </div>

          {audit.issues.length > 0 ? (
            <div className="mt-3 border-l-2 border-border-light pl-3">
              <p className="text-xs font-medium text-typography-700">{strings.issuesTitle}</p>
              <ul className="mt-1 flex flex-col gap-2">
                {audit.issues.map((issue, index) => {
                  const severity = severityMeta(issue.severity);
                  return (
                    <li key={index} className="flex items-start gap-2 text-sm text-typography-800">
                      <Tag size="sm" type={severity.type} className="shrink-0">
                        {severity.label}
                      </Tag>
                      <span className="min-w-0 break-words">{issue.description}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-xs text-typography-600">{strings.noIssues}</p>
          )}
        </div>
      ) : (
        // The auditor failing is not the answer being wrong, so it is not styled
        // as a verdict on it: it says what happened and that it will be retried.
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={strings.entryFailedTitle}
          subtitle={[entry.error, strings.entryFailedNote].filter(Boolean).join(" ")}
          className="mt-3 max-w-full"
        />
      )}

      {entry.answer && (
        <Accordion size="sm" className="mt-3">
          <AccordionItem title={strings.showAnswer}>
            <div className="break-words text-sm text-typography-900">
              <ReactMarkdown components={sharedMarkdownComponents} remarkPlugins={[remarkGfm]}>
                {entry.answer}
              </ReactMarkdown>
            </div>
          </AccordionItem>
        </Accordion>
      )}
    </Tile>
  );
};

/** The open run: its state, progress while it is going, the verdict tally, and
 *  every message audited so far. */
const AuditRun = ({ run }: { run: AnalyticsAuditDetail }) => {
  const strings = en.analyticsAudit;
  const status = statusMeta(run.status);
  const pending = Math.max(0, run.totalMessages - run.messages.length);
  const tally = VERDICT_ORDER.filter(key => (run.verdictCounts[key] ?? 0) > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-medium text-typography-900">
            {fill(strings.runTitle, { date: formatDate(run.ranAt) })}
          </h3>
          <Tag type={status.type}>{status.label}</Tag>
          <Tag type="outline">{triggerLabel(run.trigger)}</Tag>
        </div>

        {run.status === "running" && (
          <ProgressBar
            label={fill(strings.progress, {
              done: run.messages.length,
              total: run.totalMessages,
            })}
            value={run.messages.length}
            max={Math.max(run.totalMessages, 1)}
            size="small"
          />
        )}

        {tally.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tally.map(key => {
              const meta = verdictMeta(key);
              return (
                <Tag key={key} type={meta.type}>
                  {meta.label} · {run.verdictCounts[key]}
                </Tag>
              );
            })}
          </div>
        )}
      </div>

      {run.status === "failed" && (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title=""
          subtitle={strings.runFailed}
          className="max-w-full"
        />
      )}

      {run.messages.map(entry => (
        <AuditEntry key={entry.messageId} entry={entry} />
      ))}

      {/* Still going: say how many are left, rather than a list that looks done. */}
      {run.status === "running" && pending > 0 && (
        <Tile>
          <p className="text-sm text-typography-600">
            {fill(strings.morePending, { count: pending })}
          </p>
          <SkeletonPlaceholder className="mt-2 w-full h-16" />
        </Tile>
      )}

      {run.status === "completed" && run.messages.length === 0 && (
        <p className="text-sm text-typography-600">{strings.runEmpty}</p>
      )}
    </div>
  );
};

/** "New audit" and the past runs, newest first. A running one shows its progress live. */
const AuditSidebar = ({
  runs,
  isLoading,
  isError,
  activeId,
  onSelect,
  onNew,
}: {
  runs: AnalyticsAuditSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
  activeId: string | null;
  onSelect: (run: AnalyticsAuditSummary) => void;
  onNew: () => void;
}) => {
  const strings = en.analyticsAudit;

  return (
    <aside
      aria-label={strings.historyTitle}
      className="flex flex-col gap-2 md:w-64 md:shrink-0 md:border-r md:border-border-light md:pr-3"
    >
      <Button
        kind="tertiary"
        size="sm"
        className="w-full max-w-full"
        renderIcon={Add}
        aria-current={activeId === null ? "true" : undefined}
        onClick={onNew}
      >
        {strings.newAudit}
      </Button>

      <p className="text-xs font-medium text-typography-700 mt-2">{strings.historyTitle}</p>

      {/* Bounded on a phone so the open audit is still on screen under the list. */}
      <div className="max-md:max-h-40 overflow-y-auto">
        {isLoading && <SkeletonPlaceholder className="w-full h-16" />}
        {isError && <p className="text-sm text-typography-600">{strings.historyLoadFailed}</p>}
        {runs && runs.length === 0 && (
          <p className="text-sm text-typography-600">{strings.historyEmpty}</p>
        )}
        {runs && runs.length > 0 && (
          <ul className="flex flex-col gap-1">
            {runs.map(run => {
              const active = run.id === activeId;
              const status = statusMeta(run.status);
              const incorrect = run.verdictCounts.incorrect ?? 0;
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelect(run)}
                    className={`w-full cursor-pointer rounded px-2 py-2 text-left text-sm text-typography-900 hover:bg-neutral-100 ${
                      active ? "bg-neutral-100 font-medium" : ""
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">{formatDate(run.ranAt)}</span>
                      <Tag size="sm" type={status.type} className="shrink-0">
                        {status.label}
                      </Tag>
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-typography-600">
                      {triggerLabel(run.trigger)} ·{" "}
                      {fill(strings.runProgress, {
                        done: run.completedMessages,
                        total: run.totalMessages,
                      })}
                      {incorrect > 0 && ` · ${incorrect} ${strings.verdictIncorrect.toLowerCase()}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-typography-500">{strings.historyScope}</p>
    </aside>
  );
};

export const AnalyticsAuditTab = () => {
  const strings = en.analyticsAudit;
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "warning" | "error"; text: string } | null>(
    null,
  );
  // Whether anything on screen is still running. A flag in state rather than
  // derived inline because the queries below need it as their polling interval,
  // and it comes from their own data.
  const [polling, setPolling] = useState(false);

  const [startAudit, { isLoading: starting }] = useStartAnalyticsAuditMutation();
  const runsQuery = useGetAnalyticsAuditsQuery(undefined, {
    pollingInterval: polling ? POLL_MS : IDLE_POLL_MS,
    // Don't show a cached list on return: a scheduled run may have started since.
    refetchOnMountOrArgChange: true,
  });
  const runs = runsQuery.data;

  // null is the "new audit" view, where a run is started; picking a run (or
  // starting one) opens it in place of that view.
  const activeId = selectedId;
  const detailQuery = useGetAnalyticsAuditQuery(activeId ?? "", {
    skip: !activeId,
    pollingInterval: polling ? POLL_MS : 0,
    refetchOnMountOrArgChange: true,
  });
  const detail = detailQuery.data;

  const anyRunning = runs?.some(run => run.status === "running") ?? false;
  const openRunning = detail?.status === "running";
  // Derived from the queries' own data, so it is adjusted while rendering
  // (React re-renders at once) rather than from an effect.
  const shouldPoll = anyRunning || openRunning;
  if (polling !== shouldPoll) setPolling(shouldPoll);

  const items = COUNT_OPTIONS.map(n => ({ id: n, label: String(n) }));
  const selectedItem = items.find(item => item.id === count) ?? items[0];

  const onStart = async () => {
    setNotice(null);
    try {
      const response = await startAudit({ messageCount: count }).unwrap();
      if (response.audit) {
        setSelectedId(response.audit.id);
      } else {
        setNotice({ kind: "info", text: fill(strings.nothingToAudit, { count }) });
      }
    } catch (error) {
      const status = (error as { status?: number } | undefined)?.status;
      if (status === 409) {
        // Another run is going that this list had not caught up with yet.
        setNotice({ kind: "warning", text: strings.alreadyRunning });
        void runsQuery.refetch();
      } else {
        setNotice({ kind: "error", text: strings.startFailed });
      }
    }
  };

  return (
    <div className="pt-2 flex flex-col gap-4 md:flex-row">
      <AuditSidebar
        runs={runs}
        isLoading={runsQuery.isLoading}
        isError={runsQuery.isError}
        activeId={activeId}
        onSelect={run => {
          setNotice(null);
          setSelectedId(run.id);
        }}
        onNew={() => {
          setNotice(null);
          setSelectedId(null);
        }}
      />

      <div className="min-w-0 flex-1">
        {activeId === null ? (
          <>
            <h2 className="text-lg font-medium text-typography-900">{strings.heading}</h2>
            <p className="mt-1 mb-3 text-sm text-typography-600">{strings.intro}</p>

            <div className="mb-4 flex flex-wrap items-end gap-2">
              <div className="w-48">
                <Dropdown
                  id="analytics-audit-count"
                  size="md"
                  titleText={strings.countLabel}
                  label={strings.countLabel}
                  items={items}
                  selectedItem={selectedItem}
                  itemToString={item => item?.label ?? ""}
                  onChange={({ selectedItem: picked }) => {
                    if (picked) setCount(picked.id);
                  }}
                />
              </div>
              <Tooltip label={strings.countHelp} align="top">
                <button
                  type="button"
                  aria-label={strings.countHelp}
                  className="mb-3 inline-flex cursor-pointer items-center"
                >
                  <TooltipIcon />
                </button>
              </Tooltip>
              <Button
                kind="primary"
                size="md"
                className="shrink-0"
                renderIcon={Play}
                disabled={starting || anyRunning}
                onClick={() => void onStart()}
              >
                {starting ? strings.starting : strings.start}
              </Button>
            </div>

            {anyRunning && !notice && (
              <InlineNotification
                kind="info"
                lowContrast
                hideCloseButton
                title=""
                subtitle={strings.runningNotice}
                className="mb-4 max-w-full"
              />
            )}
            {notice && (
              <InlineNotification
                kind={notice.kind}
                lowContrast
                title=""
                subtitle={notice.text}
                onCloseButtonClick={() => setNotice(null)}
                className="mb-4 max-w-full"
              />
            )}
          </>
        ) : detail ? (
          <AuditRun run={detail} />
        ) : detailQuery.isError ? (
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title=""
            subtitle={strings.auditLoadFailed}
            className="max-w-full"
          />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-typography-600">{strings.auditLoading}</p>
            <SkeletonPlaceholder className="w-full h-24" />
          </div>
        )}
      </div>
    </div>
  );
};
