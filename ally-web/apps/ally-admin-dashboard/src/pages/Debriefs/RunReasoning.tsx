import React from "react";

import { formatMs, formatUsd } from "@components/ally-guide/allyGuideFormat";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { DebriefRunDetail, DebriefRunStep } from "@types";

import { sectionLabel } from "./consoleLabels";
import { draftChanges } from "./draftChanges";

/** A model id in words: the catalog's label, from the run panel's models query. */
type ModelLabel = (id: string) => string;
const asIs: ModelLabel = id => id;

/** What each step produced, by the workspace key that holds it. */
const STEP_OUTPUTS: Record<string, Array<keyof typeof en.debriefs.run.outputs>> = {
  safety_reader: ["safety"],
  analyst: ["evidence", "liveDetections"],
  progress_reader: ["progress"],
  writer: ["cohort"],
};

const WORKSPACE_KEY: Record<keyof typeof en.debriefs.run.outputs, string> = {
  safety: "safety",
  evidence: "evidence",
  liveDetections: "liveDetections",
  progress: "progress",
  cohort: "cohort",
};

const Line: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <p className="text-sm text-typography-900">
    <span className="font-semibold">{label}:</span> {children}
  </p>
);

const stepTone = (status: DebriefRunStep["status"]) =>
  status === "done" ? "success" : status === "failed" ? "warning" : "neutral";

/** One step, said out loud: why it ran, what it got, what it thought, what it made. */
const StepCard: React.FC<{
  step: DebriefRunStep;
  workspace: DebriefRunDetail["workspace"];
  showOutputs: boolean;
  modelLabel: ModelLabel;
}> = ({ step, workspace, showOutputs, modelLabel }) => {
  const s = en.debriefs.run;
  const outputs = showOutputs
    ? (STEP_OUTPUTS[step.step] ?? []).filter(k => workspace?.[WORKSPACE_KEY[k]] != null)
    : [];
  return (
    <li className="flex flex-col gap-1 border-l-2 border-primary-200 pl-3" data-testid="run-step">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-typography-900">
          {s.stepNames[step.step] ?? step.step}
          {step.round ? ` · ${s.round(step.round)}` : ""}
        </span>
        <Pill tone={stepTone(step.status)}>
          {step.status === "done"
            ? formatMs(step.ms)
            : step.status === "failed"
              ? s.failed
              : s.skipped}
        </Pill>
        {step.model && (
          <span className="text-xs" title={step.model} data-testid="run-step-model">
            {modelLabel(step.model)}
          </span>
        )}
        {step.estimatedUsd != null && step.estimatedUsd > 0 && (
          <span className="text-xs text-typography-700">
            {s.stepCost(formatUsd(step.estimatedUsd))}
          </span>
        )}
        {step.budgetLeftUsd != null && (
          <span className="text-xs text-typography-700">
            {s.budgetLeft(formatUsd(step.budgetLeftUsd))}
          </span>
        )}
      </div>
      {step.why && <Line label={s.why}>{step.why}</Line>}
      {step.inputs && step.inputs.length > 0 && (
        <Line label={s.given}>{step.inputs.join(" · ")}</Line>
      )}
      {step.reasoning && (
        <Line label={s.thinking}>
          <span className="italic">{step.reasoning}</span>
        </Line>
      )}
      {step.output && <Line label={s.result}>{step.output}</Line>}
      {step.note && step.status !== "done" && (
        <p className="text-sm text-typography-700">{step.note}</p>
      )}
      {outputs.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-primary-600">{s.showOutput}</summary>
          {outputs.map(k => (
            <div key={k} className="mt-2">
              <p className="font-semibold">{s.outputs[k]}</p>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap bg-neutral-50 p-2 text-xs">
                {JSON.stringify(workspace?.[WORKSPACE_KEY[k]], null, 2)}
              </pre>
            </div>
          ))}
        </details>
      )}
    </li>
  );
};

/**
 * Reasoning out loud (v9 FR-7, FR-38): the run as a narrated sequence. The
 * runner's own reasons come from code (the recipe decides); the "Thinking"
 * lines are each step's rationale. A run from before these were recorded
 * still shows its timings and notes.
 */
export const HowItWasMade: React.FC<{ run: DebriefRunDetail; modelLabel?: ModelLabel }> = ({
  run,
  modelLabel = asIs,
}) => {
  const s = en.debriefs.run;
  const decision = run.workspace?.decision;
  const narrated = run.steps.some(st => st.why || st.reasoning || st.output);
  // The outputs are shown once, on the step's first record (a retry has none).
  const seen = new Set<string>();
  return (
    <div className="flex flex-col gap-3" data-testid="run-how-made">
      <p className="text-sm text-typography-700">{s.howMadeHelp}</p>
      {!narrated && run.steps.length > 0 && (
        <p className="text-sm text-typography-700">{s.noReasoning}</p>
      )}
      <ol className="flex flex-col gap-4">
        {run.steps.map((step, i) => {
          const first = step.status === "done" && !seen.has(step.step);
          if (first) seen.add(step.step);
          return (
            <StepCard
              key={i}
              step={step}
              workspace={run.workspace}
              showOutputs={first}
              modelLabel={modelLabel}
            />
          );
        })}
      </ol>
      {decision && (
        <div className="border border-primary-200 p-3" data-testid="run-decision">
          <Line label={s.decision}>{decision.why}</Line>
        </div>
      )}
    </div>
  );
};

/** What each revision changed, and what it was asked to fix. */
export const DraftChanges: React.FC<{ run: DebriefRunDetail }> = ({ run }) => {
  const s = en.debriefs.run;
  const drafts = run.workspace?.drafts ?? [];
  if (drafts.length < 2) return <p className="text-sm">{s.draftChangesNone}</p>;
  return (
    <div className="flex flex-col gap-4" data-testid="run-draft-changes">
      {drafts.slice(1).map((d, i) => {
        const changes = draftChanges(drafts[i].cards, d.cards);
        return (
          <details key={d.round} className="text-sm" open={i === drafts.length - 2}>
            <summary className="cursor-pointer font-semibold">
              {s.revisionChanged(d.round, changes.length)}
            </summary>
            {d.critique.length > 0 && (
              <div className="mt-2">
                <p className="font-semibold">{s.critique}</p>
                <ul className="list-disc pl-5">
                  {d.critique.map((c, j) => (
                    <li key={j}>
                      <span className="font-semibold">{sectionLabel(c.section)}</span> · {c.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {changes.map(c => (
              <div key={c.section} className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                <p className="text-xs font-semibold md:col-span-2">{sectionLabel(c.section)}</p>
                <div className="bg-neutral-50 p-2">
                  <p className="text-xs font-semibold">{s.before}</p>
                  <p>{c.before ?? s.added}</p>
                </div>
                <div className="bg-neutral-50 p-2">
                  <p className="text-xs font-semibold">{s.after}</p>
                  <p>{c.after ?? s.removed}</p>
                </div>
              </div>
            ))}
          </details>
        );
      })}
    </div>
  );
};

/** How each Ask Ally reply was reached: its lookups, passes and cost. */
export const ReplyTraces: React.FC<{ run: DebriefRunDetail; modelLabel?: ModelLabel }> = ({
  run,
  modelLabel = asIs,
}) => {
  const s = en.debriefs.run;
  const traces = run.workspace?.replyTraces ?? [];
  if (traces.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="run-reply-traces">
      <p className="text-sm text-typography-700">{s.repliesHelp}</p>
      <ul className="flex flex-col gap-3">
        {[...traces].reverse().map((t, i) => (
          <li key={`${t.at}-${i}`} className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-typography-700">
              {s.replyLine(new Date(t.at).toLocaleString(), t.turns, formatUsd(t.costUsd))}
              {" · "}
              <span title={t.model}>{modelLabel(t.model)}</span>
            </span>
            {t.tools.length === 0 ? (
              <span>{s.noTools}</span>
            ) : (
              <ul className="list-disc pl-5">
                {t.tools.map((tool, j) => (
                  <li key={j}>
                    {s.toolNames[tool.name] ?? tool.name}
                    {tool.topic ? ` “${tool.topic}”` : ""}: {tool.found}
                  </li>
                ))}
              </ul>
            )}
            {t.stoppedBy && <span className="text-typography-700">{s.stoppedBy[t.stoppedBy]}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
};
