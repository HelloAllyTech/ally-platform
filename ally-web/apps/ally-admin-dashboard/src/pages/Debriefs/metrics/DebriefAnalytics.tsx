import React from "react";

import { useGetDebriefAnalyticsQuery } from "@api";
import { AnalyticsRange } from "@types";

import { MetricsTab } from "../MetricsTab";
import { ConsoleOverviewSection } from "./ConsoleOverviewSection";
import { JudgeAgreementSection } from "./JudgeAgreementSection";

/** ally-be's `analytics` takes 1–90 days; the page's longer ranges read the last 90. */
const DAYS: Record<AnalyticsRange, number> = { "30d": 30, "90d": 90, "12m": 90, all: 90 };

/**
 * Analytics › Debriefs: the success metrics and pass rate (with their filters), then the
 * operator numbers and spend, then how far the judge agrees with people — the last two from one
 * `GET analytics` call.
 */
export const DebriefAnalytics: React.FC<{ range?: AnalyticsRange }> = ({ range = "90d" }) => {
  const q = useGetDebriefAnalyticsQuery({ days: DAYS[range] });
  return (
    <div className="flex flex-col gap-10">
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
    </div>
  );
};
