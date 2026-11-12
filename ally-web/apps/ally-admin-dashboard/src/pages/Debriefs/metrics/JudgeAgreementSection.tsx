import React from "react";

import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { DebriefAnalyticsView } from "@types";

import { ChartCard, KpiTile } from "../../Analytics/chartKit";
import { gateMeasureLabel } from "../consoleLabels";
import { BulletRows, kappaWords, NumbersTable } from "./metricsCharts";
import { TargetState } from "./metricsData";

type Agreement = NonNullable<DebriefAnalyticsView["judgeAgreement"]>;
type Measure = Agreement["measures"][number];

const STATE: Record<Measure["state"], TargetState> = {
  not_enough: "no_data",
  undefined: "no_data",
  below: "missed",
  met: "met",
};

/** The agreement in words beside the bar: "0.72, substantial", or what it still needs. */
const inWords = (m: Measure, minReviews: number) => {
  const strings = en.debriefs.calibration;
  if (m.state === "not_enough") return strings.notYet(m.n, minReviews);
  if (m.state === "undefined" || m.kappa === null) return strings.states.undefined;
  return strings.kappaWords(m.kappa.toFixed(2), kappaWords(m.kappa));
};

/**
 * Analytics › Debriefs › Judge agreement: how far the independent check agrees with the clinical
 * advisor's yes/no answers under their verdicts (the same numbers as Settings › What the PM agent
 * may do alone). Hand scoring was removed on 2026-11-12; this replaced its κ-by-rubric-part
 * charts. Read from `GET analytics` with the rest of the page's console numbers.
 */
export const JudgeAgreementSection: React.FC<{
  agreement: DebriefAnalyticsView["judgeAgreement"] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}> = ({ agreement, loading, error, onRetry }) => {
  const strings = en.debriefs.calibration;
  const tileState = { loading, error: !!error, onRetry };
  const reviews = agreement ? Math.max(0, ...agreement.measures.map(m => m.n)) : null;
  const line = agreement?.kappa ?? 0.6;
  return (
    <section className="flex flex-col gap-6" data-testid="judge-agreement">
      <div>
        <h3 className="text-xl font-normal text-typography-900">{strings.sectionHeading}</h3>
        <p className="max-w-3xl pt-1 text-sm text-typography-700">{strings.sectionHelp}</p>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiTile
          label={strings.kpis.rated}
          description={strings.kpis.ratedHelp}
          value={agreement && reviews !== null ? String(reviews) : "—"}
          {...tileState}
        />
        <KpiTile
          label={strings.kpis.sample}
          description={strings.kpis.sampleHelp}
          value={
            agreement
              ? strings.kpis.sampleValue(agreement.sample.thisWeek, agreement.sample.waiting)
              : "—"
          }
          {...tileState}
        />
        <KpiTile
          label={strings.kpis.gate}
          description={strings.kpis.gateHelp}
          value={agreement?.gate.met ? strings.kpis.met : strings.kpis.notMet}
          {...tileState}
        />
      </div>
      {error ? (
        <ErrorPanel
          forbiddenMessage={en.debriefs.noAccess}
          what={strings.agreementFailed}
          error={error}
          onRetry={onRetry}
        />
      ) : loading ? (
        <LoadingBlock lines={4} />
      ) : agreement && agreement.measures.length > 0 ? (
        <section className="flex flex-col gap-2" data-testid="calibration-gate">
          <h3 className="flex items-center gap-1 text-xl font-normal text-typography-900">
            {strings.gateHeading}
            <InfoTip label={strings.gateHelp(agreement.minReviews)} ariaLabel={strings.gateAbout} />
          </h3>
          <ChartCard title={strings.columns.agreement} caption={strings.chartCaption}>
            <BulletRows
              testId="gate-chart"
              head={[strings.columns.measure, strings.chartAxis, strings.columns.agreement]}
              rows={agreement.measures.map(m => ({
                key: m.measure,
                label: gateMeasureLabel(m.measure),
                value: m.kappa,
                min: 0,
                max: 1,
                targets: [line],
                targetLabel: `≥ ${line.toFixed(1)}`,
                words: (
                  <>
                    {inWords(m, agreement.minReviews)}
                    <span className="block text-typography-500">
                      {strings.caught(m.recallOnNo.caught, m.recallOnNo.of)}
                    </span>
                  </>
                ),
                state: STATE[m.state],
              }))}
            />
            <NumbersTable
              testId="gate-numbers"
              head={Object.values(strings.columns)}
              rows={agreement.measures.map(m => [
                gateMeasureLabel(m.measure),
                m.kappa === null ? "—" : m.kappa.toFixed(2),
                strings.reviews(m.n, agreement.minReviews),
                m.agreementPct === null ? "—" : `${m.agreementPct}%`,
                m.recallOnNo.of === 0 ? "—" : `${m.recallOnNo.caught} of ${m.recallOnNo.of}`,
                strings.states[m.state],
              ])}
            />
          </ChartCard>
        </section>
      ) : (
        <p className="text-sm text-typography-700" data-testid="judge-agreement-empty">
          {strings.noAgreement}
        </p>
      )}
    </section>
  );
};
