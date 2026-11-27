import React from "react";

import { useGetCourseCopilotStagesQuery } from "@api";
import { en } from "@constants";
import type {
  CoursePilotStageAgent,
  CoursePilotStageCheck,
  CoursePilotStageRow,
  CoursePilotStageStatus,
  CoursePilotStagesReport,
} from "@types";

import { asArray } from "./courseCopilotFormat";

export interface StagesPanelProps {
  sessionId: string;
}

const STATUS_STYLE: Record<CoursePilotStageStatus, string> = {
  passed: "bg-green-50 text-green-800 border-green-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  failed: "bg-red-50 text-red-800 border-red-200",
  current: "bg-primary-50 text-primary-700 border-primary-200",
  not_reached: "bg-neutral-50 text-typography-600 border-neutral-200",
};

const CHECK_MARK: Record<CoursePilotStageCheck["result"], { mark: string; style: string }> = {
  pass: { mark: "✓", style: "text-green-700" },
  fail: { mark: "✕", style: "text-red-700" },
  warn: { mark: "!", style: "text-amber-700" },
  info: { mark: "•", style: "text-typography-600" },
};

const time = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

const StageRow: React.FC<{ stage: CoursePilotStageRow; defaultOpen: boolean }> = ({
  stage,
  defaultOpen,
}) => {
  const strings = en.courseCopilotPane.stages;
  const checks = asArray<CoursePilotStageCheck>(stage.checks);
  const events = asArray<CoursePilotStageRow["events"][number]>(stage.events);
  const points = asArray<{ text: string; sources: string[] }>(stage.research?.points);
  const gaps = asArray<string>(stage.research?.gaps);
  const agents = asArray<CoursePilotStageAgent>(stage.agents);
  return (
    <details
      open={defaultOpen}
      className="rounded border border-neutral-200 bg-white"
      data-testid={`stage-${stage.id}`}
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 px-3 py-2.5">
        <span
          className={`mt-0.5 shrink-0 rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[stage.status] ?? STATUS_STYLE.not_reached}`}
        >
          {strings.status[stage.status] ?? stage.status}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-typography-900">{stage.title}</span>
          <span className="block text-sm text-typography-700">{stage.why}</span>
          {agents.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1" aria-label={strings.agents}>
              {agents.map(agent => (
                <span
                  key={agent.name}
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    agent.state === "off" || agent.state === "not_run"
                      ? "border-neutral-200 text-typography-600 line-through"
                      : "border-primary-200 bg-primary-50 text-primary-700"
                  }`}
                >
                  {agent.name}
                </span>
              ))}
            </span>
          )}
        </span>
        {stage.enteredAt && (
          <span className="shrink-0 text-xs text-typography-600">
            {strings.timing(time(stage.enteredAt), stage.leftAt ? time(stage.leftAt) : null)}
          </span>
        )}
      </summary>

      <div className="space-y-3 border-t border-neutral-100 px-3 py-3 text-sm">
        <div>
          <div className="text-xs font-medium uppercase text-typography-600">{strings.what}</div>
          <p className="text-typography-800">{stage.what}</p>
          {stage.questions && stage.questions.limit > 0 && (
            <p className="text-typography-600">
              {strings.questions(stage.questions.asked, stage.questions.limit)}
            </p>
          )}
        </div>

        {agents.length > 0 && (
          <div>
            <div className="text-xs font-medium uppercase text-typography-600">
              {strings.agents}
            </div>
            <ul className="space-y-1">
              {agents.map(agent => (
                <li key={agent.name}>
                  <span className="font-medium text-typography-900">{agent.name}</span>
                  <span className="text-typography-600">
                    {" "}
                    · {strings.agentState[agent.state] ?? agent.state}
                    {agent.detail ? ` · ${agent.detail}` : ""}
                  </span>
                  <span className="block text-typography-600">{agent.role}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {checks.length > 0 && (
          <div>
            <div className="text-xs font-medium uppercase text-typography-600">
              {strings.checks}
            </div>
            <ul className="space-y-1">
              {checks.map((check, index) => {
                const mark = CHECK_MARK[check.result] ?? CHECK_MARK.info;
                return (
                  <li key={index} className="flex gap-2">
                    <span aria-hidden className={`w-3 shrink-0 font-semibold ${mark.style}`}>
                      {mark.mark}
                    </span>
                    <span className="min-w-0">
                      <span className="text-typography-900">{check.label}</span>
                      {check.detail && (
                        <span className="block text-typography-600">{check.detail}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {stage.researchState && (
          <div>
            <div className="text-xs font-medium uppercase text-typography-600">
              {strings.research}
            </div>
            <p className="text-typography-600">{strings.researchState[stage.researchState]}</p>
            {stage.research?.summary && (
              <p className="text-typography-800">{stage.research.summary}</p>
            )}
            {points.length > 0 && (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {points.map((point, index) => (
                  <li key={index} className="text-typography-800">
                    {point.text}{" "}
                    <span className="text-typography-600">
                      [{asArray<string>(point.sources).join("; ")}]
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {gaps.length > 0 && (
              <p className="mt-1 text-typography-600">
                {strings.gaps}: {gaps.join("; ")}
              </p>
            )}
          </div>
        )}

        <div>
          <div className="text-xs font-medium uppercase text-typography-600">{strings.events}</div>
          {events.length ? (
            <ul className="space-y-1">
              {events.map((event, index) => (
                <li key={index} className="flex gap-2">
                  <span className="w-12 shrink-0 text-xs text-typography-600">
                    {time(event.at)}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`mr-1 text-xs font-medium ${
                        event.kind === "sent_back" || event.kind === "refused"
                          ? "text-amber-700"
                          : "text-typography-700"
                      }`}
                    >
                      {strings.eventKind[event.kind] ?? event.kind}:
                    </span>
                    <span className="text-typography-800">{event.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-typography-600">{strings.noEvents}</p>
          )}
        </div>
      </div>
    </details>
  );
};

/**
 * Platform admins: the Course Pilot stages of this session, in order, each with what happens
 * there, what code checked and why it passed or failed. Read-only; the backend computes it with
 * the same checks the pipeline runs.
 */
export const StagesPanel: React.FC<StagesPanelProps> = ({ sessionId }) => {
  const strings = en.courseCopilotPane.stages;
  const { data, isLoading, isError, refetch } = useGetCourseCopilotStagesQuery(sessionId, {
    refetchOnMountOrArgChange: true,
  });

  if (isLoading) return <p className="p-4 text-sm text-typography-600">{strings.loading}</p>;
  if (isError || !data) {
    return (
      <div className="p-4 text-sm">
        <p className="text-red-700">{strings.error}</p>
        <button type="button" className="mt-2 text-primary-700 underline" onClick={() => refetch()}>
          {strings.retry}
        </button>
      </div>
    );
  }

  const report = data as CoursePilotStagesReport;
  const stages = asArray<CoursePilotStageRow>(report.stages);
  const groups = (["interview", "plan", "build", "course"] as const).map(group => ({
    group,
    stages: stages.filter(stage => stage.group === group),
  }));
  // Open the stage that needs attention: the first failed one, else the one in progress.
  const focus =
    stages.find(stage => stage.status === "failed") ??
    stages.find(stage => stage.status === "current");

  return (
    <div className="space-y-4 p-4" data-testid="course-copilot-stages">
      <p className="text-sm text-typography-700">{strings.intro}</p>
      {!report.staged && <p className="text-sm text-amber-800">{strings.notStaged}</p>}
      {groups
        .filter(entry => entry.stages.length)
        .map(entry => (
          <section key={entry.group} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-typography-600">
              {strings.groups[entry.group]}
            </h3>
            {entry.stages.map(stage => (
              <StageRow key={stage.id} stage={stage} defaultOpen={stage.id === focus?.id} />
            ))}
          </section>
        ))}
    </div>
  );
};
