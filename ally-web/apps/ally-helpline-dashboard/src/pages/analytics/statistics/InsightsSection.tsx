import { FunctionComponent } from "react";

import { useTranslation } from "react-i18next";

import { useGetStatisticsInsightsQuery, useUpdateStatisticsInsightStateMutation } from "@api";
import type { StatisticsInsight } from "@types";

interface InsightsSectionProps {
  /** Opens the chart a finding comes from, on its tab, for the course or learner it is about. */
  onOpen: (insight: StatisticsInsight) => void;
}

/** "learners.dormant" is a finding about learners: the part before the dot says what kind. */
const kindOf = (ruleId: string) => ruleId.split(".")[0];

/**
 * Your focus today: what Ally found in the organisation's own charts. Things
 * worth a look come first, then things worth celebrating. Each finding is
 * written here, in the reader's language, from the rule that found it and its
 * numbers; nothing arrives as finished text. A finding can be opened (the chart
 * it comes from), marked done, or put off for a week. Whatever is put away is
 * the person's own.
 */
export const InsightsSection: FunctionComponent<InsightsSectionProps> = ({ onOpen }) => {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError } = useGetStatisticsInsightsQuery();
  const [putAway] = useUpdateStatisticsInsightStateMutation();

  // A failed read must not take the pinned cards below it down: say nothing.
  if (isLoading || isError || !data) return null;
  const { attention, celebrate } = data;

  /** A skill is named in the reader's language; anything else is written as it came. */
  const params = (insight: StatisticsInsight) => {
    const out: Record<string, string | number> = { ...insight.params };
    const skill = insight.params.skill;
    if (typeof skill === "string") {
      out.skill = i18n.exists(`statisticsLibrary.skills.names.${skill}`)
        ? t(`statisticsLibrary.skills.names.${skill}`)
        : skill;
    }
    return out;
  };

  const card = (insight: StatisticsInsight) => {
    const tone = insight.polarity === "attention";
    const values = params(insight);
    return (
      <li
        key={insight.fingerprint}
        className="flex gap-4 border-t border-[#efebe0] py-4 first:border-t-0"
        data-testid={`statistics-insight-${insight.ruleId}`}
      >
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm font-semibold ${
            tone ? "bg-[#f6e0d2] text-[#7a3205]" : "bg-[#dceee2] text-[#1e6b3a]"
          }`}
        >
          {tone ? "!" : "✓"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-typography-600">
            {t(`statisticsLibrary.insights.kinds.${kindOf(insight.ruleId)}`)}
          </span>
          <h4 className="text-base font-semibold text-typography-900">
            {t(`statisticsLibrary.insights.items.${insight.ruleId}.title`, values)}
          </h4>
          <p className="text-sm text-typography-700">
            {t(`statisticsLibrary.insights.items.${insight.ruleId}.evidence`, values)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpen(insight)}
              className={`min-h-11 rounded border px-4 text-sm font-medium ${
                tone
                  ? "border-[#264d8e] bg-[#264d8e] text-white"
                  : "border-[#264d8e] bg-white text-[#264d8e]"
              }`}
              data-testid={`statistics-insight-open-${insight.ruleId}`}
            >
              {t("statisticsLibrary.insights.seeChart")}
            </button>
            <button
              type="button"
              onClick={() => putAway({ fingerprint: insight.fingerprint, state: "done" })}
              className="min-h-11 rounded border border-border-light bg-white px-4 text-sm font-medium text-typography-900"
              data-testid={`statistics-insight-done-${insight.ruleId}`}
            >
              {t("statisticsLibrary.insights.done")}
            </button>
            {tone && (
              <button
                type="button"
                onClick={() => putAway({ fingerprint: insight.fingerprint, state: "snoozed" })}
                className="min-h-11 px-3 text-sm font-medium text-typography-600"
                data-testid={`statistics-insight-later-${insight.ruleId}`}
              >
                {t("statisticsLibrary.insights.later")}
              </button>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-[#e3ded2] bg-white px-6 py-5"
      aria-label={t("statisticsLibrary.insights.heading")}
      data-testid="statistics-insights"
    >
      <h3 className="text-xl font-semibold text-typography-900">
        {t("statisticsLibrary.insights.heading")}
      </h3>
      {attention.length === 0 && celebrate.length === 0 && (
        <p className="text-sm text-typography-600" data-testid="statistics-insights-none">
          {t("statisticsLibrary.insights.none")}
        </p>
      )}
      {attention.length > 0 && (
        <>
          <h4 className="mt-2 text-xs font-semibold uppercase tracking-wide text-[#7a3205]">
            {t("statisticsLibrary.insights.attention")}
          </h4>
          <ul>{attention.map(card)}</ul>
        </>
      )}
      {celebrate.length > 0 && (
        <>
          <h4 className="mt-2 text-xs font-semibold uppercase tracking-wide text-[#1e6b3a]">
            {t("statisticsLibrary.insights.celebrate")}
          </h4>
          <ul>{celebrate.map(card)}</ul>
        </>
      )}
    </section>
  );
};
