import React, { useState } from "react";

import {
  useAnswerGapMutation,
  useGetCheckupQuery,
  useMarkNotOfferedMutation,
  useRunCheckupMutation,
} from "@api";
import { Button, CheckRow, GapCard, MeasureCard, Segmented } from "@components/v2";

import { Sparkline } from "../../Analytics/chartKit";
import { COPY, fill } from "../../Onboarding/copy";
import {
  CheckupFilter,
  accuracyPct,
  filtered,
  gapsOf,
  hasTotals,
  sourceLabel,
  statusOf,
} from "../checkup";
import { HOME } from "../copy";
import { Group, SectionHead } from "../fields";

import type { SectionProps } from "./props";

const t = COPY.checkup;
const POLL_MS = 2000;

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * The checkup (chunk 20a-2, screenshot 04): how the assistant did on its test questions, in the
 * deck's four measures, the questions it couldn't answer one at a time, and every question with
 * how it went. Run again starts a new run; while one runs, the rows fill in.
 */
export const CheckupSection: React.FC<Pick<SectionProps, "bot" | "canEdit">> = ({
  bot,
  canEdit,
}) => {
  const [polling, setPolling] = useState(false);
  const checkup = useGetCheckupQuery(bot.id, { pollingInterval: polling ? POLL_MS : 0 });
  const [run, runState] = useRunCheckupMutation();
  const [answer, answerState] = useAnswerGapMutation();
  const [notOffered, notOfferedState] = useMarkNotOfferedMutation();
  const [explain, setExplain] = useState(false);
  const [filter, setFilter] = useState<CheckupFilter>("all");
  const [gapIndex, setGapIndex] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  const view = checkup.data?.latest ?? null;
  const running = view?.run.status === "running";
  if (running !== polling) setPolling(running);

  const start = async () => {
    setNote(null);
    const result = await run(bot.id);
    if ("error" in result) {
      const status = (result.error as { status?: number }).status;
      setNote(status === 429 ? t.blocked.limit : t.blocked.start);
    }
  };

  const head = (
    <div className="ally-home__row">
      <SectionHead
        title={HOME.sections.checkup}
        subtitle={HOME.subtitles.checkup}
        help={HOME.help.checkup}
      />
      {canEdit && (
        <Button onClick={() => void start()} disabled={running || runState.isLoading}>
          {t.runAgain}
        </Button>
      )}
    </div>
  );

  if (!view) {
    return (
      <>
        {head}
        <Group testId="checkup-empty">
          <p className="ally-empty">{note ?? HOME.checkup.empty}</p>
        </Group>
      </>
    );
  }

  const fallback = checkup.data?.fallback || "";
  const clients = checkup.data?.audience || "clients";
  const gaps = gapsOf(view);
  const gap = gaps[Math.min(gapIndex, Math.max(gaps.length - 1, 0))];
  const results = filtered(view.results, filter);

  return (
    <>
      {head}
      {note && (
        <p className="ally-small" role="status">
          {note}
        </p>
      )}

      {running || !hasTotals(view) ? (
        <Group testId="checkup-running">
          <p className="ally-body" role="status" aria-live="polite">
            {fill(t.running, {
              n: Math.min(view.run.done + 1, view.run.total),
              total: view.run.total,
            })}
          </p>
        </Group>
      ) : (
        <>
          <p className="ally-small">
            {fill(t.subtitle, {
              total: view.totals.questions,
              clients,
              when: when(view.run.finishedAt ?? view.run.startedAt),
            })}
          </p>
          <section className="ally-card ally-checkup__summary" data-testid="checkup-summary">
            <div className="ally-checkup__ring" aria-hidden="true">
              <strong>{accuracyPct(view.totals)}%</strong>
              <span>{t.accurate}</span>
            </div>
            <div>
              <h3 className="ally-heading">
                {view.totals.gaps
                  ? fill(t.summaryGaps, { clients, gaps: view.totals.gaps })
                  : fill(t.summaryClear, { clients })}
              </h3>
              {view.totals.gaps > 0 && (
                <p className="ally-body">
                  {fill(t.summaryBody, {
                    passed: view.totals.accuracy.passed,
                    total: view.totals.accuracy.total,
                    gaps: view.totals.gaps,
                    fallback,
                  })}
                </p>
              )}
            </div>
            {(checkup.data?.trend.length ?? 0) > 1 && (
              <div className="ally-checkup__trend">
                <Sparkline
                  values={checkup.data!.trend.map(p => p.accuracy)}
                  width={180}
                  height={40}
                  label={fill(t.trend, { n: checkup.data!.trend.length })}
                />
                <p className="ally-small">{fill(t.trend, { n: checkup.data!.trend.length })}</p>
              </div>
            )}
          </section>

          <div className="ally-home__row">
            <h3 className="ally-heading">{t.sections.checked}</h3>
            <Button variant="ghost" onClick={() => setExplain(v => !v)}>
              {explain ? t.hide : t.explain}
            </Button>
          </div>
          <div className="ally-measures">
            {(["accuracy", "sources", "honesty", "safety"] as const).map(key => {
              const m = t.measures[key];
              const measure = view.totals[key];
              return (
                <MeasureCard
                  key={key}
                  title={m.title}
                  word={m.word}
                  passed={measure.passed}
                  total={measure.total}
                  unit={fill(t.units[key], { n: measure.total })}
                  meaning={fill(m.meaning, { fallback })}
                  explanation={fill(m.explanation, { gaps: view.totals.gaps })}
                  explain={explain}
                  tone={key === "safety" ? "good" : "accent"}
                />
              );
            })}
          </div>
        </>
      )}

      {gap && !running && (
        <>
          <div className="ally-home__row">
            <h3 className="ally-heading">{t.sections.input}</h3>
          </div>
          <GapCard
            key={gap.caseId}
            said={gap.reply}
            busy={answerState.isLoading || notOfferedState.isLoading || !canEdit}
            labels={{
              prompt: fill(t.gapPrompt, { question: gap.question }),
              said: t.gapSaid,
              answer: t.gapAnswer,
              placeholder: t.gapPlaceholder,
              add: t.gapAdd,
              notOffered: t.gapNotOffered,
              counter: fill(t.gapCounter, { n: gapIndex + 1, total: gaps.length }),
            }}
            onAdd={async text => {
              const result = await answer({ id: bot.id, caseId: gap.caseId, text });
              if ("error" in result) return false;
              setNote(t.added);
              setGapIndex(i => i);
              return true;
            }}
            onNotOffered={async () => {
              const result = await notOffered({ id: bot.id, caseId: gap.caseId });
              return !("error" in result);
            }}
          />
        </>
      )}

      <div className="ally-home__row">
        <h3 className="ally-heading">{t.sections.asked}</h3>
        <Segmented<CheckupFilter>
          label={t.sections.asked}
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: fill(t.filters.all, { total: view.results.length }) },
            { id: "answered", label: t.filters.answered },
            { id: "safety", label: t.filters.safety },
            { id: "input", label: t.filters.input },
          ]}
        />
      </div>
      <ul className="ally-checks" data-testid="checkup-rows">
        {results.map((result, index) => (
          <CheckRow
            key={result.caseId}
            index={index}
            question={result.question}
            status={statusOf(result)}
            source={sourceLabel(result, t.safetyRule)}
            labels={t.rows}
          />
        ))}
      </ul>
    </>
  );
};
