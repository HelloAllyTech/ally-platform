import { useState } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  Accordion,
  AccordionItem,
  Button,
  InlineNotification,
  SkeletonPlaceholder,
  Tag,
  Tile,
  Tooltip,
} from "@ally-ui-mono/ui-shared";
import {
  useApproveAnalyticsAutomationAgentMutation,
  useGetAnalyticsAutomationConfigQuery,
  useGetAnalyticsAutomationRunQuery,
  useGetAnalyticsAutomationRunsQuery,
  useRejectAnalyticsAutomationAgentMutation,
  useStartAnalyticsAutomationRunMutation,
} from "@api";
import { TooltipIcon } from "@assets";
import { sharedMarkdownComponents } from "@components";
import { en } from "@constants";
import {
  AnalyticsAutomationAgentName,
  AnalyticsAutomationAgentRun,
  AnalyticsAutomationAgentStatus,
  AnalyticsAutomationFinding,
  AnalyticsAutomationFindingStatus,
  AnalyticsAutomationPrState,
  AnalyticsAutomationReviewVerdict,
  AnalyticsAutomationRunDetail,
  AnalyticsAutomationRunStatus,
  AnalyticsAutomationRunSummary,
} from "@types";

/**
 * Weekly automation — the tab for the run of three agents the server starts once
 * a week: a backend review, a PostHog events agent and a dbt agent.
 *
 * Nothing here starts a run: the scheduler does. The tab lists runs in a sidebar
 * (newest open by default), shows what each of the three agents did, and lets a
 * reader approve or reject the dbt agent's proposal — the one decision a person
 * makes. Approve is only offered by the server once the PostHog pull request is
 * merged or closed and the proposal exists, so the button is simply absent
 * before then and the agent's note says what it is waiting for.
 *
 * Polls quickly while an agent is working and slowly otherwise, so a run that
 * starts (or a pull request that gets merged) while the tab is open is noticed.
 */

const POLL_MS = 4000;
const IDLE_POLL_MS = 60_000;

/** Statuses in which an agent is actively doing something on the server. */
const ACTIVE: AnalyticsAutomationAgentStatus[] = ["running", "analysing", "applying"];

type TagColor = "green" | "red" | "blue" | "magenta" | "gray" | "cool-gray" | "purple";

const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const shortSha = (sha: string | null | undefined): string => (sha ? sha.slice(0, 7) : "—");

const agentStatusMeta = (
  status: AnalyticsAutomationAgentStatus,
): { type: TagColor; label: string } => {
  const strings = en.analyticsAutomation;
  switch (status) {
    case "running":
      return { type: "blue", label: strings.statusRunning };
    case "analysing":
      return { type: "blue", label: strings.statusAnalysing };
    case "applying":
      return { type: "blue", label: strings.statusApplying };
    case "waiting":
      return { type: "gray", label: strings.statusWaiting };
    case "awaiting_approval":
      return { type: "purple", label: strings.statusAwaitingApproval };
    case "pr_opened":
      return { type: "green", label: strings.statusPrOpened };
    case "rejected":
      return { type: "magenta", label: strings.statusRejected };
    case "failed":
      return { type: "red", label: strings.statusFailed };
    default:
      return { type: "cool-gray", label: strings.statusCompleted };
  }
};

const runStatusMeta = (status: AnalyticsAutomationRunStatus): { type: TagColor; label: string } => {
  const strings = en.analyticsAutomation;
  if (status === "running") return { type: "blue", label: strings.statusRunning };
  if (status === "failed") return { type: "red", label: strings.statusFailed };
  return { type: "cool-gray", label: strings.statusCompleted };
};

const prStateMeta = (state: AnalyticsAutomationPrState): { type: TagColor; label: string } => {
  const strings = en.analyticsAutomation;
  if (state === "merged") return { type: "green", label: strings.prMerged };
  if (state === "closed") return { type: "gray", label: strings.prClosed };
  return { type: "blue", label: strings.prOpen };
};

const verdictMeta = (
  verdict: AnalyticsAutomationReviewVerdict | null,
): { type: TagColor; label: string } => {
  const strings = en.analyticsAutomation;
  if (verdict === "approve") return { type: "green", label: strings.reviewApprove };
  if (verdict === "concerns") return { type: "magenta", label: strings.reviewConcerns };
  if (verdict === "reject") return { type: "red", label: strings.reviewReject };
  return { type: "gray", label: strings.reviewFailed };
};

const findingStatusMeta = (
  status: AnalyticsAutomationFindingStatus,
): { type: TagColor; label: string } => {
  const strings = en.analyticsAutomation;
  if (status === "included") return { type: "green", label: strings.findingIncluded };
  if (status === "dropped") return { type: "gray", label: strings.findingDropped };
  if (status === "rejected") return { type: "magenta", label: strings.findingRejected };
  return { type: "blue", label: strings.findingProposed };
};

const Markdown = ({ children }: { children: string }) => (
  <div className="break-words text-sm text-typography-900">
    <ReactMarkdown components={sharedMarkdownComponents} remarkPlugins={[remarkGfm]}>
      {children}
    </ReactMarkdown>
  </div>
);

const FindingList = ({
  title,
  findings,
}: {
  title: string;
  findings: AnalyticsAutomationFinding[];
}) =>
  findings.length === 0 ? null : (
    <div className="mt-3 border-l-2 border-border-light pl-3">
      <p className="text-xs font-medium text-typography-700">{title}</p>
      <ul className="mt-1 flex flex-col gap-2">
        {findings.map(finding => {
          const status = findingStatusMeta(finding.status);
          return (
            <li key={finding.id} className="flex items-start gap-2 text-sm text-typography-800">
              <Tag size="sm" type={status.type} className="shrink-0">
                {status.label}
              </Tag>
              <span className="min-w-0 break-words">
                <span className="font-medium">{finding.title}</span>
                {finding.detail && <span className="text-typography-600"> — {finding.detail}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );

/** The pull request an agent opened, its state, and the review agent's verdict on it. */
const PullRequestBlock = ({ agent }: { agent: AnalyticsAutomationAgentRun }) => {
  const strings = en.analyticsAutomation;
  const pr = agent.pullRequest;
  if (!pr) return null;
  const state = prStateMeta(pr.state);
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-typography-700">{strings.pullRequest}</span>
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-link-primary underline"
        >
          {pr.repo}#{pr.number}
        </a>
        <Tag size="sm" type={state.type}>
          {state.label}
        </Tag>
      </div>
      {agent.review && (
        <Accordion size="sm">
          <AccordionItem
            title={
              <span className="inline-flex items-center gap-2">
                {strings.reviewTitle}
                <Tag size="sm" type={verdictMeta(agent.review.verdict).type}>
                  {verdictMeta(agent.review.verdict).label}
                </Tag>
              </span>
            }
          >
            <Markdown>{agent.review.summary}</Markdown>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
};

const AGENT_TITLE: Record<AnalyticsAutomationAgentName, () => { title: string; help: string }> = {
  backend_review: () => ({
    title: en.analyticsAutomation.agentBackendReview,
    help: en.analyticsAutomation.agentBackendReviewHelp,
  }),
  posthog_events: () => ({
    title: en.analyticsAutomation.agentPosthog,
    help: en.analyticsAutomation.agentPosthogHelp,
  }),
  dbt_metrics: () => ({
    title: en.analyticsAutomation.agentDbt,
    help: en.analyticsAutomation.agentDbtHelp,
  }),
};

/** One agent of the open run. The dbt agent also carries the approve / reject decision. */
const AgentCard = ({
  agent,
  onApprove,
  onReject,
  deciding,
  decideError,
}: {
  agent: AnalyticsAutomationAgentRun;
  onApprove: () => void;
  onReject: () => void;
  deciding: "approve" | "reject" | null;
  decideError: string | null;
}) => {
  const strings = en.analyticsAutomation;
  const { title, help } = AGENT_TITLE[agent.agent]();
  const status = agentStatusMeta(agent.status);
  const isDbt = agent.agent === "dbt_metrics";
  const retry = isDbt && agent.status === "failed" && agent.canApprove;

  return (
    <Tile className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-medium text-typography-900">{title}</h3>
        <Tooltip label={help} align="top">
          <button
            type="button"
            aria-label={help}
            className="inline-flex cursor-pointer items-center"
          >
            <TooltipIcon />
          </button>
        </Tooltip>
        <Tag type={status.type}>{status.label}</Tag>
        {agent.decision && (
          <Tag type="outline">
            {agent.decision === "approved" ? strings.decisionApproved : strings.decisionRejected}
          </Tag>
        )}
      </div>

      {/* Waiting / failed: say why, in the server's own words. */}
      {agent.note && <p className="mt-2 text-sm text-typography-600">{agent.note}</p>}
      {retry && <p className="mt-1 text-sm text-typography-600">{strings.retryNote}</p>}

      {agent.summary ? (
        <div className="mt-3">
          <Markdown>{agent.summary}</Markdown>
        </div>
      ) : (
        !agent.note && <p className="mt-2 text-sm text-typography-600">{strings.noSummary}</p>
      )}

      <PullRequestBlock agent={agent} />

      <FindingList
        title={isDbt ? strings.findingsProposal : strings.findingsEvents}
        findings={agent.findings}
      />

      {isDbt && (agent.canApprove || agent.canReject) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {agent.canApprove && (
            <Button
              kind="primary"
              size="md"
              disabled={deciding !== null}
              onClick={onApprove}
              title={strings.approveHelp}
            >
              {deciding === "approve" ? strings.approving : strings.approve}
            </Button>
          )}
          {agent.canReject && (
            <Button
              kind="danger--tertiary"
              size="md"
              disabled={deciding !== null}
              onClick={onReject}
              title={strings.rejectHelp}
            >
              {deciding === "reject" ? strings.rejecting : strings.reject}
            </Button>
          )}
        </div>
      )}
      {decideError && (
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title=""
          subtitle={decideError}
          className="mt-3 max-w-full"
        />
      )}
    </Tile>
  );
};

const RunView = ({ run }: { run: AnalyticsAutomationRunDetail }) => {
  const strings = en.analyticsAutomation;
  const status = runStatusMeta(run.status);
  const [approve, { isLoading: approving }] = useApproveAnalyticsAutomationAgentMutation();
  const [reject, { isLoading: rejecting }] = useRejectAnalyticsAutomationAgentMutation();
  const [error, setError] = useState<string | null>(null);

  const decide = async (kind: "approve" | "reject", agentRunId: string) => {
    setError(null);
    try {
      await (kind === "approve" ? approve(agentRunId) : reject(agentRunId)).unwrap();
    } catch (err) {
      // The server says why when it refuses (e.g. the PostHog pull request is still open).
      const reason = (err as { data?: { message?: unknown } })?.data?.message;
      setError(
        typeof reason === "string" && reason
          ? reason
          : kind === "approve"
            ? strings.approveFailed
            : strings.rejectFailed,
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-medium text-typography-900">
            {fill(strings.runTitle, { date: formatDate(run.ranAt) })}
          </h3>
          <Tag type={status.type}>{status.label}</Tag>
        </div>
        <p className="text-xs text-typography-500">
          {fill(strings.commits, {
            platform: shortSha(run.commitShas?.platform?.head),
            dbt: shortSha(run.commitShas?.dbt?.head),
          })}
        </p>
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

      {run.agentRuns.map(agent => (
        <AgentCard
          key={agent.id}
          agent={agent}
          deciding={approving ? "approve" : rejecting ? "reject" : null}
          decideError={agent.agent === "dbt_metrics" ? error : null}
          onApprove={() => void decide("approve", agent.id)}
          onReject={() => void decide("reject", agent.id)}
        />
      ))}
    </div>
  );
};

const RunSidebar = ({
  runs,
  isLoading,
  isError,
  activeId,
  onSelect,
}: {
  runs: AnalyticsAutomationRunSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
  activeId: string | null;
  onSelect: (run: AnalyticsAutomationRunSummary) => void;
}) => {
  const strings = en.analyticsAutomation;
  return (
    <aside
      aria-label={strings.historyTitle}
      className="flex flex-col gap-2 md:w-64 md:shrink-0 md:border-r md:border-border-light md:pr-3"
    >
      <p className="text-xs font-medium text-typography-700">{strings.historyTitle}</p>
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
              const status = runStatusMeta(run.status);
              // An approval waiting on a person is the one thing worth surfacing in the list.
              const needsYou = run.agents.some(a => a.status === "awaiting_approval");
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
                    {needsYou && (
                      <span className="mt-1 block">
                        <Tag size="sm" type="purple">
                          {strings.statusAwaitingApproval}
                        </Tag>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
};

export const AnalyticsAutomationTab = () => {
  const strings = en.analyticsAutomation;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [startError, setStartError] = useState(false);

  // Testing aid: shown only while the server allows a manual start.
  const config = useGetAnalyticsAutomationConfigQuery();
  const [startRun, { isLoading: starting }] = useStartAnalyticsAutomationRunMutation();

  const runsQuery = useGetAnalyticsAutomationRunsQuery(undefined, {
    pollingInterval: polling ? POLL_MS : IDLE_POLL_MS,
    refetchOnMountOrArgChange: true,
  });
  const runs = runsQuery.data;

  // The newest run is open until the reader picks another.
  const activeId = selectedId ?? runs?.[0]?.id ?? null;
  const detailQuery = useGetAnalyticsAutomationRunQuery(activeId ?? "", {
    skip: !activeId,
    pollingInterval: polling ? POLL_MS : IDLE_POLL_MS,
    refetchOnMountOrArgChange: true,
  });
  const detail = detailQuery.data;

  const anyActive =
    runs?.some(
      run => run.status === "running" || run.agents.some(a => ACTIVE.includes(a.status)),
    ) ?? false;
  const openActive =
    detail?.agentRuns.some(a => ACTIVE.includes(a.status)) || detail?.status === "running";
  const shouldPoll = anyActive || !!openActive;
  if (polling !== shouldPoll) setPolling(shouldPoll);

  const onStart = async () => {
    setStartError(false);
    try {
      const started = await startRun().unwrap();
      setSelectedId(started.id);
    } catch {
      setStartError(true);
    }
  };

  return (
    <div className="pt-2 flex flex-col gap-4 md:flex-row">
      <RunSidebar
        runs={runs}
        isLoading={runsQuery.isLoading}
        isError={runsQuery.isError}
        activeId={activeId}
        onSelect={run => setSelectedId(run.id)}
      />

      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-medium text-typography-900">{strings.heading}</h2>
        <p className="mt-1 mb-3 text-sm text-typography-600">{strings.intro}</p>

        {config.data?.manualStartEnabled && (
          <div className="mb-3 flex flex-col gap-2">
            <div>
              <Button
                kind="tertiary"
                size="sm"
                disabled={starting || shouldPoll}
                title={strings.startTestRunHelp}
                onClick={() => void onStart()}
              >
                {starting ? strings.startingTestRun : strings.startTestRun}
              </Button>
            </div>
            {startError && (
              <InlineNotification
                kind="error"
                lowContrast
                hideCloseButton
                title=""
                subtitle={strings.startTestRunFailed}
                className="max-w-full"
              />
            )}
          </div>
        )}

        {!activeId ? null : detail ? (
          <RunView key={detail.id} run={detail} />
        ) : detailQuery.isError ? (
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title=""
            subtitle={strings.runLoadFailed}
            className="max-w-full"
          />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-typography-600">{strings.runLoading}</p>
            <SkeletonPlaceholder className="w-full h-24" />
          </div>
        )}
      </div>
    </div>
  );
};
