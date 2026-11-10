import React, { useState } from "react";

import {
  useAnswerGapMutation,
  useGetChangesQuery,
  useGetCheckupQuery,
  useMarkNotOfferedMutation,
  useRunCheckupMutation,
} from "@api";
import { Button, GapCard, MeasureCard } from "@components/v2";

import { Sparkline } from "../../Analytics/chartKit";
import { COPY, fill } from "../../Onboarding/copy";
import { accuracyPct, gapsOf, hasTotals } from "../checkup";
import { stepOf } from "../checkupCases";
import { HOME } from "../copy";
import { dateTime } from "../dates";
import { Collapsed, Group, SectionHead } from "../fields";
import { CheckupCases } from "./CheckupCases";

import type { SectionProps } from "./props";

const t = COPY.checkup;
const c = HOME.checkupControls;
const POLL_MS = 2000;

/** The decline wording, as a quote inside a sentence: no full stop of its own. */
const quoted = (fallback: string) =>
  fallback ? `“${fallback.trim().replace(/[.\s]+$/, "")}”` : "";

/** The four live steps (chunk 20d-2): which is done, which is running, which waits. */
const Steps: React.FC<{ step: 1 | 2 | 3 | 4; asked: number; total: number }> = ({
  step,
  asked,
  total,
}) => {
  const items = [
    c.steps.writing,
    fill(c.steps.asking, { n: Math.min(asked, total), total }),
    c.steps.checking,
    c.steps.result,
  ];
  return (
    <ol className="ally-checkup__steps" aria-live="polite" data-testid="checkup-steps">
      {items.map((label, index) => {
        const n = index + 1;
        const state = n < step ? "done" : n === step ? "now" : "next";
        return (
          <li key={n} className={`ally-checkup__step ally-checkup__step--${state}`}>
            <span className="ally-checkup__step-mark" aria-hidden="true">
              {state === "done" ? "✓" : n}
            </span>
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
};

/**
 * The checkup (chunk 20a-2, screenshot 04; chunk 20d-2 gives the owner control): what a checkup is,
 * live steps while it runs (it keeps going if the owner leaves), how checking works, the four
 * measures, the questions it couldn't answer one at a time, and every question with its result,
 * which the owner can add to, edit, turn off, delete and try on its own.
 */
export const CheckupSection: React.FC<Pick<SectionProps, "bot" | "canEdit">> = ({
  bot,
  canEdit,
}) => {
  const [polling, setPolling] = useState(false);
  const checkup = useGetCheckupQuery(bot.id, { pollingInterval: polling ? POLL_MS : 0 });
  const { data: changes } = useGetChangesQuery(bot.id);
  const [run, runState] = useRunCheckupMutation();
  const [answer, answerState] = useAnswerGapMutation();
  const [notOffered, notOfferedState] = useMarkNotOfferedMutation();
  const [explain, setExplain] = useState(false);
  const [gapIndex, setGapIndex] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [compared, setCompared] = useState(false);

  const view = checkup.data?.latest ?? null;
  const running = view?.run.status === "running";
  if (running !== polling) setPolling(running);

  const start = async (only?: "failed") => {
    setNote(null);
    const result = await run(only ? { id: bot.id, only } : bot.id);
    if ("error" in result) {
      const status = (result.error as { status?: number }).status;
      setNote(status === 429 ? t.blocked.limit : t.blocked.start);
    } else {
      setCompared(true);
    }
  };

  // A change made since the last checkup: offer to run one and show the effect.
  const lastChange = (changes ?? []).find(entry => !entry.undone)?.at;
  const changedSince =
    !!lastChange && !!view && !running && Date.parse(lastChange) > Date.parse(view.run.startedAt);
  const compare = checkup.data?.compare;

  const head = (
    <SectionHead
      title={HOME.sections.checkup}
      subtitle={c.intro}
      help={HOME.subtitles.checkup}
      action={
        canEdit && (
          <div className="ally-btn-row">
            <Button
              className="ally-btn--sm"
              onClick={() => void start("failed")}
              disabled={running || runState.isLoading || !view}
            >
              {c.runs.failed}
            </Button>
            <Button
              variant="primary"
              className="ally-btn--sm"
              onClick={() => void start()}
              disabled={running || runState.isLoading}
            >
              {c.runs.all}
            </Button>
          </div>
        )
      }
    />
  );

  const howItWorks = (
    <Collapsed summary={c.how.title}>
      <ul className="ally-checkup__how">
        {[
          c.how.passed,
          c.how.partly,
          c.how.failed,
          c.how.needsInput,
          c.how.mustPass,
          c.how.blocks,
        ].map(line => (
          <li key={line} className="ally-small">
            {line}
          </li>
        ))}
      </ul>
    </Collapsed>
  );

  if (!view) {
    return (
      <>
        {head}
        <Group testId="checkup-empty">
          <p className="ally-empty">{note ?? HOME.checkup.empty}</p>
          {howItWorks}
        </Group>
        <CheckupCases botId={bot.id} canEdit={canEdit} run={null} />
      </>
    );
  }

  const fallback = quoted(checkup.data?.fallback || "");
  const clients = (checkup.data?.audience || "clients").toLowerCase();
  const gaps = gapsOf(view);
  const gap = gaps[Math.min(gapIndex, Math.max(gaps.length - 1, 0))];

  return (
    <>
      {head}
      {note && (
        <p className="ally-small" role="status">
          {note}
        </p>
      )}

      {changedSince && canEdit && (
        <div className="ally-note ally-checkup__banner" role="status" data-testid="checkup-banner">
          <span>{c.banner}</span>
          <Button className="ally-btn--sm" onClick={() => void start()}>
            {c.bannerRun}
          </Button>
        </div>
      )}

      {running || !hasTotals(view) ? (
        <Group testId="checkup-running">
          <Steps
            step={stepOf(view.run)}
            asked={view.run.asked ?? view.run.done}
            total={view.run.total}
          />
          <p className="ally-small">{c.leave}</p>
          {howItWorks}
        </Group>
      ) : (
        <>
          {compared && compare?.before && compare.after && (
            <p className="ally-note" role="status" data-testid="checkup-compare">
              {fill(c.before, { a: compare.before.passed, n: compare.before.total })} ·{" "}
              {fill(c.after, { b: compare.after.passed, n: compare.after.total })}
            </p>
          )}
          <p className="ally-small">
            {fill(t.subtitle, {
              total: view.totals.questions,
              clients,
              when: dateTime(view.run.finishedAt ?? view.run.startedAt),
            })}
          </p>
          <section className="ally-card ally-checkup__summary" data-testid="checkup-summary">
            <div className="ally-checkup__ring" aria-hidden="true">
              <strong>{accuracyPct(view.totals)}%</strong>
              <span>{t.accurate}</span>
            </div>
            <div>
              <h3 className="ally-heading">
                {view.totals.gaps === 1
                  ? fill(c.summaryGap, { clients })
                  : view.totals.gaps
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
          {howItWorks}

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
                  empty={c.measureEmpty}
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
              // The next gap (the answered one leaves the list when the checkup refreshes).
              setGapIndex(i => Math.min(i + 1, Math.max(gaps.length - 1, 0)));
              return true;
            }}
            onNotOffered={async () => {
              const result = await notOffered({ id: bot.id, caseId: gap.caseId });
              if ("error" in result) return false;
              setGapIndex(i => Math.min(i + 1, Math.max(gaps.length - 1, 0)));
              return true;
            }}
          />
        </>
      )}

      <CheckupCases botId={bot.id} canEdit={canEdit} run={view} />
    </>
  );
};
