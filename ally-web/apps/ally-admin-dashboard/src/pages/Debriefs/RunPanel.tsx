import React from "react";

import { SidePanel } from "@ally-ui-mono/ui-shared";
import { useGetDebriefRunQuery } from "@api";
import { formatMs, formatUsd, shortId } from "@components/ally-guide/allyGuideFormat";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { DebriefCardsData, DebriefRunDetail } from "@types";

import { score } from "./consoleTable";

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="flex flex-col gap-2">
    <h3 className="text-xl font-normal text-typography-900">{title}</h3>
    {children}
  </section>
);

const Cards: React.FC<{ cards: DebriefCardsData }> = ({ cards }) => {
  const s = en.debriefs.run;
  return (
    <div className="flex flex-col gap-4 text-sm text-typography-900" data-testid="run-cards">
      <p>{cards.opening}</p>
      {cards.important_moment && (
        <div className="border border-warning-500 p-3">
          <p className="font-semibold">{s.importantMoment}</p>
          <p>{cards.important_moment.lead}</p>
          <p className="italic">
            “{cards.important_moment.quote}” (turn {cards.important_moment.turn_index})
          </p>
          <p>{cards.important_moment.body}</p>
        </div>
      )}
      {cards.what_worked.length > 0 && (
        <div>
          <p className="font-semibold">{s.whatWorked}</p>
          <ul className="list-disc pl-5">
            {cards.what_worked.map((c, i) => (
              <li key={i}>
                {c.lead} <span className="italic">“{c.quote}”</span> (turn {c.turn_index}) {c.body}
              </li>
            ))}
          </ul>
        </div>
      )}
      {cards.work_on_this.length > 0 && (
        <div>
          <p className="font-semibold">{s.workOnThis}</p>
          <ul className="list-disc pl-5">
            {cards.work_on_this.map((c, i) => (
              <li key={i}>
                {c.lead} <span className="italic">“{c.quote}”</span> (turn {c.turn_index}) {c.why}{" "}
                <span className="font-semibold">{s.trySaying}:</span> “{c.try_saying}”
              </li>
            ))}
          </ul>
        </div>
      )}
      {cards.practise_next && (
        <p>
          <span className="font-semibold">{s.practiseNext}:</span> {cards.practise_next.skill}.{" "}
          {cards.practise_next.reason}
        </p>
      )}
      {cards.progress_note && <p>{cards.progress_note}</p>}
      {cards.reflective_question && (
        <p>
          <span className="font-semibold">{s.question}:</span> {cards.reflective_question}
        </p>
      )}
    </div>
  );
};

const RunBody: React.FC<{ run: DebriefRunDetail }> = ({ run }) => {
  const s = en.debriefs.run;
  const judge = run.workspace?.judge;
  return (
    <div className="flex flex-col gap-8" data-testid="run-body">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill tone={run.mode === "live" ? "info" : "neutral"}>{en.debriefs.mode[run.mode]}</Pill>
        <Pill
          tone={
            run.status === "published"
              ? "success"
              : run.status === "needs_person" || run.status === "failed"
                ? "warning"
                : "neutral"
          }
        >
          {en.debriefs.status[run.status]}
        </Pill>
        <span>{run.recipeKey ?? "—"}</span>
        <span>· {s.fallback(run.fallbackRung)}</span>
        <span>· {s.cost(formatUsd(run.estimatedCostUsd), formatUsd(run.actualCostUsd))}</span>
        {run.skipReason && <span>· {run.skipReason}</span>}
      </div>
      {run.error && <p className="text-sm text-typography-700">{run.error}</p>}

      <Section title={s.timeline}>
        <ol className="flex flex-col gap-1 text-sm" data-testid="run-steps">
          {run.steps.map((step, i) => (
            <li key={i} className="flex flex-wrap gap-2">
              <span className="w-36 font-mono text-xs">
                {step.step}
                {step.round ? ` · ${step.round}` : ""}
              </span>
              <Pill
                tone={
                  step.status === "done"
                    ? "success"
                    : step.status === "failed"
                      ? "warning"
                      : "neutral"
                }
              >
                {step.status === "done"
                  ? formatMs(step.ms)
                  : step.status === "failed"
                    ? s.failed
                    : s.skipped}
              </Pill>
              {step.model && <span className="font-mono text-xs">{step.model}</span>}
              {step.note && <span className="text-typography-700">{step.note}</span>}
            </li>
          ))}
        </ol>
      </Section>

      <Section title={s.checks}>
        {run.checkFailures.length === 0 ? (
          <p className="text-sm">{s.checksPassed}</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {run.checkFailures.map((f, i) => (
              <li key={i}>
                <span className="font-mono text-xs">{f.code}</span> · {f.section}: {f.detail}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={s.verdicts}>
        <ul className="text-sm">
          {(run.workspace?.evaluations ?? []).map(e => (
            <li key={e.round}>
              {s.round(e.round)}: {score(e.overall)}
              {e.hardFails.length > 0 && ` · ${s.hardFails}: ${e.hardFails.join(", ")}`}
              {e.checks.length > 0 && ` · ${s.checks}: ${e.checks.join(", ")}`}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={s.judge}>
        {judge ? (
          <p className="text-sm">
            {score(judge.overall)}
            {judge.hardFails.length > 0 &&
              ` · ${s.hardFails}: ${judge.hardFails.map(h => h.code).join(", ")}`}
          </p>
        ) : (
          <p className="text-sm">{s.notJudged}</p>
        )}
      </Section>

      <Section title={s.cards}>
        {run.cards ? <Cards cards={run.cards} /> : <p className="text-sm">{s.noCards}</p>}
      </Section>
    </div>
  );
};

const RunLoader: React.FC<{ id: string }> = ({ id }) => {
  const { data, isLoading, isError, error, refetch } = useGetDebriefRunQuery(id);
  if (isLoading) return <LoadingBlock lines={8} />;
  if (isError || !data) {
    return (
      <ErrorPanel what={en.debriefs.run.loadFailed} error={error} onRetry={() => void refetch()} />
    );
  }
  return <RunBody run={data} />;
};

/** One run in a drawer: its steps, checks, verdicts and the debrief it wrote. */
export const RunPanel: React.FC<{ runId: string | null; onClose: () => void }> = ({
  runId,
  onClose,
}) => (
  <SidePanel
    open={runId !== null}
    onClose={onClose}
    title={
      <h2 className="truncate text-lg font-semibold text-typography-900">
        {en.debriefs.run.title}
        {runId && <span className="ml-2 font-mono text-sm font-normal">{shortId(runId)}</span>}
      </h2>
    }
    closeLabel={en.debriefs.run.close}
    className="w-[min(860px,100vw)]"
  >
    {runId && <RunLoader key={runId} id={runId} />}
  </SidePanel>
);
