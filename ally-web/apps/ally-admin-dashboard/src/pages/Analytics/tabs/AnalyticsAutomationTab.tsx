import { Fragment, useState } from "react";

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
  AnalyticsAutomationCi,
  AnalyticsAutomationDefinitionChange,
  AnalyticsAutomationFinding,
  AnalyticsAutomationFindingStatus,
  AnalyticsAutomationPrState,
  AnalyticsAutomationReviewVerdict,
  AnalyticsAutomationRunDetail,
  AnalyticsAutomationRunStatus,
  AnalyticsAutomationRunSummary,
} from "@types";

/**
 * Weekly automation — the tab for the run of two agents the server starts once
 * a week: a PostHog events agent and a dbt agent.
 *
 * Nothing here starts a run: the scheduler does. The tab lists runs in a sidebar
 * (newest open by default) and shows, in order: what the PostHog agent did; the
 * "Metrics / Definition changes" section (what changed in the backend database
 * and metric definitions, from the dbt agent's read-only analysis); and the dbt
 * agent's plan for the dbt repo, which a reader approves or rejects — the one
 * decision a person makes. The plan is shown before the decision and covers
 * both outcomes of the PostHog pull request: items that depend on its events are
 * marked, applied only if it is merged and left out if it is closed. Approve is
 * only offered by the server once the plan exists, and refused while the PostHog
 * pull request is open; the agent's note says what it is waiting for.
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
    <div className="mt-4 flex flex-col gap-2">
      <GroupLabel title={title} />
      <ul className="flex flex-col gap-2">
        {findings.map(finding => {
          const status = findingStatusMeta(finding.status);
          return (
            <li
              key={finding.id}
              className="flex items-start justify-between gap-2 rounded border border-border-light bg-neutral-50 p-3 text-sm text-typography-800"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="break-words font-medium text-typography-900">{finding.title}</span>
                {finding.detail && (
                  <span className="break-words text-typography-600">{finding.detail}</span>
                )}
              </span>
              <Tag size="sm" type={status.type} className="shrink-0">
                {status.label}
              </Tag>
            </li>
          );
        })}
      </ul>
    </div>
  );

const strList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const FILES_SHOWN = 3;

/** File paths as small chips; the rest are summarised ("+2 more") with the full list on hover. */
const FileChips = ({ label, files }: { label: string; files: string[] }) => {
  const strings = en.analyticsAutomation;
  if (files.length === 0) return null;
  const shown = files.slice(0, FILES_SHOWN);
  const rest = files.slice(FILES_SHOWN);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-typography-500">
      <span>{label}</span>
      {shown.map(file => (
        <code
          key={file}
          title={file}
          className="max-w-full break-all rounded bg-neutral-100 px-1.5 py-0.5 text-typography-700"
        >
          {file}
        </code>
      ))}
      {rest.length > 0 && (
        <span title={rest.join("\n")} className="cursor-help underline decoration-dotted">
          {fill(strings.filesMore, { count: rest.length })}
        </span>
      )}
    </div>
  );
};

/** A small caption above a group of rows. */
const GroupLabel = ({ title, help }: { title: string; help?: string }) => (
  <div className="flex flex-col gap-0.5">
    <p className="text-xs font-semibold uppercase tracking-wide text-typography-600">{title}</p>
    {help && <p className="text-xs text-typography-500">{help}</p>}
  </div>
);

const CI_STATES: AnalyticsAutomationCi["state"][] = [
  "running",
  "fixing",
  "green",
  "failed",
  "none",
  "timeout",
  "stopped",
  "unreadable",
];

/** The dbt agent's view of its pull request's CI, from `output.ci`; null when none was recorded. */
const readCi = (output: Record<string, unknown>): AnalyticsAutomationCi | null => {
  const ci = output?.ci as Partial<AnalyticsAutomationCi> | undefined;
  if (!ci || typeof ci !== "object" || !CI_STATES.includes(ci.state as never)) return null;
  return {
    state: ci.state as AnalyticsAutomationCi["state"],
    attempts: typeof ci.attempts === "number" ? ci.attempts : 0,
    message: typeof ci.message === "string" ? ci.message : "",
    failedChecks: strList(ci.failedChecks),
  };
};

const ciMeta = (state: AnalyticsAutomationCi["state"]): { type: TagColor; label: string } => {
  const strings = en.analyticsAutomation;
  switch (state) {
    case "running":
      return { type: "blue", label: strings.ciRunning };
    case "fixing":
      return { type: "purple", label: strings.ciFixing };
    case "green":
      return { type: "green", label: strings.ciGreen };
    case "failed":
      return { type: "red", label: strings.ciFailed };
    case "none":
      return { type: "cool-gray", label: strings.ciNone };
    case "timeout":
      return { type: "magenta", label: strings.ciTimeout };
    case "stopped":
      return { type: "gray", label: strings.ciStopped };
    default:
      return { type: "magenta", label: strings.ciUnreadable };
  }
};

/** One labelled line inside the pull request panel. */
const PanelRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
    <span className="w-24 shrink-0 text-xs font-medium text-typography-600">{label}</span>
    <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
  </div>
);

/**
 * The pull request an agent opened, in one panel: its state, the review agent's
 * verdict and, for the dbt agent, where the pull request's CI is.
 */
const PullRequestBlock = ({
  agent,
  showCi = false,
}: {
  agent: AnalyticsAutomationAgentRun;
  showCi?: boolean;
}) => {
  const strings = en.analyticsAutomation;
  const pr = agent.pullRequest;
  if (!pr) return null;
  const state = prStateMeta(pr.state);
  const ci = showCi ? readCi(agent.output) : null;
  const ciTag = ci ? ciMeta(ci.state) : null;
  return (
    <div className="mt-3 flex flex-col gap-2 rounded border border-border-light bg-neutral-50 p-3">
      <PanelRow label={strings.pullRequest}>
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
      </PanelRow>
      {ci && ciTag && (
        <PanelRow label={strings.ciTitle}>
          <Tag size="sm" type={ciTag.type}>
            {ciTag.label}
          </Tag>
          {ci.attempts > 0 && (
            <span className="text-xs text-typography-500">
              {fill(strings.ciAttempts, { attempts: ci.attempts })}
            </span>
          )}
          {ci.message && (
            <span className="min-w-0 break-words text-typography-600">{ci.message}</span>
          )}
        </PanelRow>
      )}
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

/** The dbt agent's definition changes, or null when none were recorded for this run. */
const readDefinitionChanges = (
  output: Record<string, unknown>,
): AnalyticsAutomationDefinitionChange[] | null => {
  const list = output?.definitionChanges;
  if (!Array.isArray(list)) return null;
  return list.filter(
    (c): c is AnalyticsAutomationDefinitionChange =>
      !!c && typeof c === "object" && typeof (c as { title?: unknown }).title === "string",
  );
};

const areaLabel = (area: AnalyticsAutomationDefinitionChange["area"]): string => {
  const strings = en.analyticsAutomation;
  if (area === "database") return strings.areaDatabase;
  if (area === "metric_definition") return strings.areaMetricDefinition;
  if (area === "enum") return strings.areaEnum;
  return strings.areaOther;
};

/** A card's title with its help tooltip. */
const CardTitle = ({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children?: React.ReactNode;
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <h3 className="text-base font-medium text-typography-900">{title}</h3>
    <Tooltip label={help} align="top">
      <button type="button" aria-label={help} className="inline-flex cursor-pointer items-center">
        <TooltipIcon />
      </button>
    </Tooltip>
    {children}
  </div>
);

const DefinitionChangeRow = ({ change }: { change: AnalyticsAutomationDefinitionChange }) => {
  const strings = en.analyticsAutomation;
  return (
    <li
      className={`flex flex-col gap-2 rounded border border-border-light p-3 text-sm ${
        change.affectsDbt ? "bg-purple-50" : "bg-neutral-50"
      }`}
    >
      <div className="flex items-start gap-2">
        <Tag size="sm" type="outline" className="shrink-0">
          {areaLabel(change.area)}
        </Tag>
        <span className="min-w-0 break-words font-medium text-typography-900">{change.title}</span>
      </div>
      <p className="break-words text-typography-700">{change.description}</p>
      <FileChips label={strings.platformFilesLabel} files={strList(change.sourcePaths)} />
    </li>
  );
};

/**
 * "Metrics / Definition changes": what changed in the backend database and in
 * metric definitions. It comes from the dbt agent's read-only analysis, so it is
 * there before anything is approved; it is its own section only in the UI.
 * Changes that need a dbt change come first.
 */
const DefinitionChangesCard = ({ agent }: { agent: AnalyticsAutomationAgentRun }) => {
  const strings = en.analyticsAutomation;
  const changes = readDefinitionChanges(agent.output);
  const working = agent.status === "waiting" || agent.status === "analysing";
  const needDbt = changes?.filter(c => c.affectsDbt) ?? [];
  const awareness = changes?.filter(c => !c.affectsDbt) ?? [];

  let body;
  if (changes && changes.length > 0) {
    body = (
      <div className="mt-3 flex flex-col gap-4">
        {needDbt.length > 0 && (
          <div className="flex flex-col gap-2">
            <GroupLabel title={strings.affectsDbt} />
            <ul className="flex flex-col gap-2">
              {needDbt.map((change, index) => (
                <DefinitionChangeRow key={`${change.title}-${index}`} change={change} />
              ))}
            </ul>
          </div>
        )}
        {awareness.length > 0 && (
          <div className="flex flex-col gap-2">
            <GroupLabel title={strings.noDbtImpact} />
            <ul className="flex flex-col gap-2">
              {awareness.map((change, index) => (
                <DefinitionChangeRow key={`${change.title}-${index}`} change={change} />
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  } else if (changes) {
    body = <p className="mt-2 text-sm text-typography-600">{strings.definitionNone}</p>;
  } else if (working) {
    body = <p className="mt-2 text-sm text-typography-600">{strings.definitionWorking}</p>;
  } else if (agent.status === "failed" && agent.note) {
    body = <p className="mt-2 text-sm text-typography-600">{agent.note}</p>;
  } else {
    // A run with no new commits, or one from before this section existed.
    body = (
      <p className="mt-2 text-sm text-typography-600">
        {agent.status === "completed" && agent.summary
          ? agent.summary
          : strings.definitionUnavailable}
      </p>
    );
  }

  return (
    <Tile className="min-w-0">
      <CardTitle title={strings.definitionTitle} help={strings.definitionHelp}>
        {changes && changes.length > 0 && (
          <>
            <Tag size="sm" type="gray">
              {fill(strings.definitionCount, { count: changes.length })}
            </Tag>
            {needDbt.length > 0 && (
              <Tag size="sm" type="purple">
                {fill(strings.definitionNeedDbtCount, { count: needDbt.length })}
              </Tag>
            )}
          </>
        )}
      </CardTitle>
      {body}
    </Tile>
  );
};

const PlanItem = ({ finding, index }: { finding: AnalyticsAutomationFinding; index: number }) => {
  const strings = en.analyticsAutomation;
  const status = findingStatusMeta(finding.status);
  const steps = strList(finding.payload.steps);
  const files = strList(finding.payload.dbtFiles);
  return (
    <li className="flex items-start gap-3 rounded border border-border-light bg-neutral-50 p-3 text-sm text-typography-800">
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-medium text-typography-800"
      >
        {index}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <span className="break-words font-medium text-typography-900">{finding.title}</span>
          <Tag size="sm" type={status.type} className="shrink-0">
            {status.label}
          </Tag>
        </div>
        {finding.detail && <p className="break-words text-typography-600">{finding.detail}</p>}
        {steps.length > 0 && (
          <div>
            <p className="text-xs font-medium text-typography-700">{strings.planSteps}</p>
            <ol className="mt-1 list-decimal pl-5 text-typography-700">
              {steps.map((step, stepIndex) => (
                <li key={stepIndex} className="break-words">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}
        <FileChips label={strings.dbtFilesLabel} files={files} />
      </div>
    </li>
  );
};

/** What the plan comes to under each outcome of the PostHog pull request. */
const ScenarioTile = ({ title, count, help }: { title: string; count: number; help: string }) => (
  <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded border border-border-light bg-background-secondary p-3">
    <span className="text-xs font-medium text-typography-600">{title}</span>
    <span className="text-lg font-medium text-typography-900">{count}</span>
    <span className="text-xs text-typography-500">{help}</span>
  </div>
);

/**
 * The dbt agent's plan, shown before and after the decision. Items that exist
 * only because of the PostHog events are grouped apart: they are applied if the
 * PostHog pull request is merged, and left out if it is closed.
 */
const PlanBlock = ({ agent }: { agent: AnalyticsAutomationAgentRun }) => {
  const strings = en.analyticsAutomation;
  const plan = agent.findings.filter(f => f.kind === "dbt_change");
  if (plan.length === 0) return null;
  const always = plan.filter(f => f.payload.dependsOnPosthog !== true);
  const ifMerged = plan.filter(f => f.payload.dependsOnPosthog === true);
  const split = ifMerged.length > 0;

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-typography-900">{strings.planTitle}</h4>
        <Tag size="sm" type="gray">
          {fill(strings.planCount, { count: plan.length })}
        </Tag>
      </div>
      {agent.status === "awaiting_approval" && split && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <ScenarioTile
            title={strings.planScenarioMerged}
            count={plan.length}
            help={strings.planScenarioMergedHelp}
          />
          <ScenarioTile
            title={strings.planScenarioClosed}
            count={always.length}
            help={strings.planScenarioClosedHelp}
          />
        </div>
      )}
      {always.length > 0 && (
        <div className="flex flex-col gap-2">
          {split && <GroupLabel title={strings.planAlways} />}
          <ul className="flex flex-col gap-2">
            {always.map((finding, index) => (
              <PlanItem key={finding.id} finding={finding} index={index + 1} />
            ))}
          </ul>
        </div>
      )}
      {split && (
        <div className="flex flex-col gap-2">
          <GroupLabel title={strings.planIfMerged} help={strings.planIfMergedHelp} />
          <ul className="flex flex-col gap-2">
            {ifMerged.map((finding, index) => (
              <PlanItem key={finding.id} finding={finding} index={always.length + index + 1} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const AGENT_TITLE: Record<AnalyticsAutomationAgentName, () => { title: string; help: string }> = {
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
  const retry = isDbt && agent.decision === "approved" && agent.canApprove;

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
        <div className="mt-3 rounded bg-neutral-50 p-3">
          <Markdown>{agent.summary}</Markdown>
        </div>
      ) : (
        !agent.note && <p className="mt-2 text-sm text-typography-600">{strings.noSummary}</p>
      )}

      <PullRequestBlock agent={agent} showCi={isDbt} />

      {isDbt ? (
        <PlanBlock agent={agent} />
      ) : (
        <FindingList title={strings.findingsEvents} findings={agent.findings} />
      )}

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
        <Fragment key={agent.id}>
          {/* The dbt agent's analysis gets its own section, ahead of its plan and decision. */}
          {agent.agent === "dbt_metrics" && <DefinitionChangesCard agent={agent} />}
          <AgentCard
            agent={agent}
            deciding={approving ? "approve" : rejecting ? "reject" : null}
            decideError={agent.agent === "dbt_metrics" ? error : null}
            onApprove={() => void decide("approve", agent.id)}
            onReject={() => void decide("reject", agent.id)}
          />
        </Fragment>
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

  // "Run now": the same run the weekly schedule starts, on demand.
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

        <div className="mb-3 flex flex-col gap-2">
          <div>
            <Button
              kind="tertiary"
              size="sm"
              disabled={starting || shouldPoll}
              title={strings.runNowHelp}
              onClick={() => void onStart()}
            >
              {starting ? strings.runNowStarting : strings.runNow}
            </Button>
          </div>
          {startError && (
            <InlineNotification
              kind="error"
              lowContrast
              hideCloseButton
              title=""
              subtitle={strings.runNowFailed}
              className="max-w-full"
            />
          )}
        </div>

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
