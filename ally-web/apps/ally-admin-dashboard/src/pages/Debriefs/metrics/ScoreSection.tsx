import React from "react";

import { useGetDebriefScoreQuery } from "@api";
import { en } from "@constants";

import { ChartCard } from "../../Analytics/chartKit";
import { languageLabel } from "../consoleLabels";
import { SCORE_DAYS } from "./ImprovementSection";

/** Fewer debriefs than this in a slice and its score is too few to read (as elsewhere on the page). */
export const SCORE_MIN_N = 20;

const one = (v: number) => v.toFixed(1);

/**
 * Analytics › Debriefs › More detail: the overall score by language this week. The score, its
 * parts and the two gates lead the page in "What Debrief improves"; only this split is not there.
 */
export const ScoreByLanguage: React.FC = () => {
  const t = en.debriefs.v2.score;
  const q = useGetDebriefScoreQuery({ days: SCORE_DAYS });
  const view = q.data;
  if (q.isError && !view) {
    return (
      <ChartCard
        title={t.byLanguageHeading}
        error
        errorTitle={t.loadFailedTitle}
        errorSubtitle={t.loadFailedSubtitle}
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (!view) return <ChartCard title={t.byLanguageHeading} loading />;
  if (view.byLanguage.length === 0) return null;
  return (
    <section
      id="debrief-score-language"
      className="flex flex-col gap-2 rounded-sm bg-neutral-50 px-5 py-4"
      data-testid="score-by-language"
    >
      <h3 className="m-0 text-base font-semibold">{t.byLanguageHeading}</h3>
      <p className="m-0 text-xs text-neutral-600">{t.byLanguageHelp}</p>
      {view.byLanguage.map(l => {
        const thin = l.n < SCORE_MIN_N;
        const w = l.score === null ? 0 : Math.max(0, Math.min(10, l.score)) * 10;
        return (
          <div key={l.language} className="flex flex-nowrap items-center gap-3 text-sm">
            <span className="w-28 shrink-0 truncate">{languageLabel(l.language)}</span>
            <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-neutral-100">
              <span
                className={`block h-full ${thin ? "bg-neutral-400" : "bg-primary-500"}`}
                style={{ width: `${w}%` }}
              />
            </span>
            <span className="w-12 shrink-0 text-right font-semibold">
              {l.score === null ? "—" : one(l.score)}
            </span>
            <span className="w-44 shrink-0 truncate text-xs text-neutral-600">
              {thin ? t.tooFew(l.n) : t.debriefs(l.n)}
            </span>
          </div>
        );
      })}
    </section>
  );
};
