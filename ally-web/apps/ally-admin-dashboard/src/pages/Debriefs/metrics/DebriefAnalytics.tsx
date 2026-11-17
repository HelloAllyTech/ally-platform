import React from "react";

import { useGetDebriefAnalyticsQuery } from "@api";
import { en } from "@constants";
import { AnalyticsRange } from "@types";

import { MetricsTab } from "../MetricsTab";
import { ConsoleOverviewSection } from "./ConsoleOverviewSection";
import { ImprovementSection } from "./ImprovementSection";
import { JudgeAgreementSection } from "./JudgeAgreementSection";
import { NightlyCheckSection } from "./NightlyCheckSection";
import { ScoreByLanguage } from "./ScoreSection";

/** ally-be's `analytics` takes 1–90 days; the page's longer ranges read the last 90. */
const DAYS: Record<AnalyticsRange, number> = { "30d": 30, "90d": 90, "12m": 90, all: 90 };

/**
 * Analytics › Debriefs: what the system improves first (one chart of the overall score and its
 * parts, the quality score in detail, the two gates). Everything else sits under "More detail":
 * the score by language, the success metrics and their filters, operator numbers and spend, judge
 * agreement and the nightly check.
 */
export const DebriefAnalytics: React.FC<{ range?: AnalyticsRange }> = ({ range = "90d" }) => {
  const q = useGetDebriefAnalyticsQuery({ days: DAYS[range] });
  return (
    <div className="flex flex-col gap-10">
      <ImprovementSection />
      <details className="group" data-testid="analytics-more-detail">
        <summary className="cursor-pointer select-none text-base font-semibold text-typography-900">
          {en.debriefs.v2.improve.moreDetail}
        </summary>
        <div className="mt-6 flex flex-col gap-10">
          {en.debriefs.metrics.rangeCapNote[range] && (
            <p role="note" className="text-sm text-typography-600">
              {en.debriefs.metrics.rangeCapNote[range]}
            </p>
          )}
          <ScoreByLanguage />
          <MetricsTab range={range} />
          <ConsoleOverviewSection
            view={q.data}
            loading={q.isLoading}
            error={q.isError}
            onRetry={() => void q.refetch()}
          />
          <JudgeAgreementSection
            agreement={q.data?.judgeAgreement}
            loading={q.isLoading}
            error={q.isError ? q.error : null}
            onRetry={() => void q.refetch()}
          />
          <NightlyCheckSection />
        </div>
      </details>
    </div>
  );
};
