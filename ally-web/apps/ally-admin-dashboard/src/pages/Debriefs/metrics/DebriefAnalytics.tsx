import React from "react";

import { AnalyticsRange } from "@types";

import { MetricsTab } from "../MetricsTab";
import { ConsoleOverviewSection } from "./ConsoleOverviewSection";
import { JudgeAgreementSection } from "./JudgeAgreementSection";

/**
 * Analytics › Debriefs: the success metrics and pass rate (with their filters), then the
 * operator numbers and spend, then how far the judge agrees with people.
 */
export const DebriefAnalytics: React.FC<{ range?: AnalyticsRange }> = ({ range }) => (
  <div className="flex flex-col gap-10">
    <MetricsTab range={range} />
    <ConsoleOverviewSection />
    <JudgeAgreementSection />
  </div>
);
