import React from "react";

import { SidePanel } from "@ally-ui-mono/ui-shared";
import { useGetDebriefModelsQuery, useGetDebriefRunQuery } from "@api";
import { formatUsd, shortId } from "@components/ally-guide/allyGuideFormat";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en, ROUTES } from "@constants";
import { DebriefCardsData, DebriefRunDetail } from "@types";

import {
  checkLabel,
  hardFailLabel,
  modelLabels,
  recipeLabel,
  sectionLabel,
  skipReasonLabel,
} from "./consoleLabels";
import { score } from "./consoleTable";
import { DraftChanges, HowItWasMade, ReplyTraces } from "./RunReasoning";

/**
 * The roleplay itself — transcript, audio and scored events — in a new tab, so
 * a reviewer can check the debrief against what actually happened.
 */
export const SessionLogLink: React.FC<{ sessionId: string }> = ({ sessionId }) => (
  <a
    href={ROUTES.ROLEPLAY_SESSION_LOG_DETAIL(sessionId)}
    target="_blank"
    rel="noreferrer"
    className="text-primary-600 underline"
  >
    {en.debriefs.run.sessionLog}
  </a>
);

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
            “{cards.important_moment.quote}” {s.turn(cards.important_moment.turn_index)}
          </p>
          <p>{cards.important_moment.body}</p>
          {(cards.important_moment.others ?? []).map(o => (
            <p key={o.turn_index} className="pl-3">
              <span className="italic">“{o.quote}”</span> {s.turn(o.turn_index)} {o.note}
            </p>
          ))}
        </div>
      )}
      {cards.what_worked.length > 0 && (
        <div>
          <p className="font-semibold">{s.whatWorked}</p>
          <ul className="list-disc pl-5">
            {cards.what_worked.map((c, i) => (
              <li key={i}>
                {c.lead} <span className="italic">“{c.quote}”</span> {s.turn(c.turn_index)} {c.body}
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
                {c.lead} <span className="italic">“{c.quote}”</span> {s.turn(c.turn_index)} {c.why}{" "}
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
  const evaluations = run.workspace?.evaluations ?? [];
  const models = useGetDebriefModelsQuery();
  const modelLabel = modelLabels(models.data);
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
        <span>{recipeLabel(run.recipeKey)}</span>
        <span>· {s.fallback(run.fallbackRung)}</span>
        <SessionLogLink sessionId={run.scenarioSessionId} />
        <span>· {s.cost(formatUsd(run.estimatedCostUsd), formatUsd(run.actualCostUsd))}</span>
        {run.skipReason && <span>· {skipReasonLabel(run.skipReason)}</span>}
      </div>
      {run.error && <p className="text-sm text-typography-700">{run.error}</p>}

      <Section title={s.howMade}>
        <HowItWasMade run={run} modelLabel={modelLabel} />
      </Section>

      <Section title={s.checks}>
        {run.checkFailures.length === 0 ? (
          <p className="text-sm">{s.checksPassed}</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {run.checkFailures.map((f, i) => (
              <li key={i}>
                <span className="font-semibold">{checkLabel(f.code)}</span> ·{" "}
                {sectionLabel(f.section)}: {f.detail}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={s.verdicts}>
        {evaluations.length === 0 ? (
          <p className="text-sm" data-testid="run-not-evaluated">
            {s.notEvaluated}
          </p>
        ) : (
          <ul className="text-sm">
            {evaluations.map(e => (
              <li key={e.round}>
                {s.round(e.round)}: {score(e.overall)}
                {e.hardFails.length > 0 &&
                  ` · ${s.hardFails}: ${e.hardFails.map(hardFailLabel).join(", ")}`}
                {e.checks.length > 0 && ` · ${s.checks}: ${e.checks.map(checkLabel).join(", ")}`}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={s.draftChanges}>
        <DraftChanges run={run} />
      </Section>

      <Section title={s.judge}>
        {judge ? (
          <p className="text-sm">
            {score(judge.overall)}
            {judge.hardFails.length > 0 &&
              ` · ${s.hardFails}: ${judge.hardFails.map(h => hardFailLabel(h.code)).join(", ")}`}
          </p>
        ) : (
          <p className="text-sm">{s.notJudged}</p>
        )}
      </Section>

      {(run.workspace?.replyTraces?.length ?? 0) > 0 && (
        <Section title={s.replies}>
          <ReplyTraces run={run} modelLabel={modelLabel} />
        </Section>
      )}

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
