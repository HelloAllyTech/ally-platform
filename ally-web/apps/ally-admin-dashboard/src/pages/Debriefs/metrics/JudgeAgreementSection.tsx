import React from "react";

import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { DebriefAnalyticsView, DebriefCalibrationAgreement } from "@types";

import { ChartCard, KpiTile } from "../../Analytics/chartKit";
import { codeWords } from "../consoleLabels";
import { DEBRIEF_DIMENSIONS } from "../ScoreByHand";
import { BulletRow, BulletRows, kappaWords, NumbersTable } from "./metricsCharts";
import { TargetState } from "./metricsData";

const kappa = (value: number | null) =>
  value === null ? en.debriefs.calibration.needsMore : value.toFixed(2);

/** ally-be `DEBRIEF_AUTONOMY_KAPPA`: each gate check needs κ ≥ 0.6. */
const GATE_KAPPA = 0.6;

/** κ in words beside the bar: "0.72, substantial", or what it still needs. */
const kappaInWords = (value: number | null) =>
  value === null
    ? en.debriefs.calibration.needsMore
    : en.debriefs.calibration.kappaWords(value.toFixed(2), kappaWords(value));

const stateOf = (value: number | null, passes?: boolean): TargetState =>
  value === null ? "no_data" : (passes ?? value >= GATE_KAPPA) ? "met" : "missed";

const kappaRow = (
  key: string,
  label: string,
  value: number | null,
  passes: boolean | undefined,
  extra?: string,
): BulletRow => ({
  key,
  label,
  value,
  min: 0,
  max: 1,
  targets: [GATE_KAPPA],
  targetLabel: `≥ ${GATE_KAPPA.toFixed(1)}`,
  words: (
    <>
      {kappaInWords(value)}
      {extra && <span className="block text-typography-500">{extra}</span>}
    </>
  ),
  state: stateOf(value, passes),
});

/** The autonomy gate: each check's κ against the 0.6 it needs, with the table behind it. */
const GateChart: React.FC<{ agreement: DebriefCalibrationAgreement }> = ({ agreement }) => {
  const strings = en.debriefs.calibration;
  const label = (m: string) => en.debriefs.gateMeasures[m] ?? codeWords(m);
  return (
    <section className="flex flex-col gap-2" data-testid="calibration-gate">
      <h3 className="flex items-center gap-1 text-xl font-normal text-typography-900">
        {strings.gateHeading}
        <InfoTip label={strings.gateHelp} ariaLabel={strings.gateAbout} />
      </h3>
      <ChartCard title={strings.gateColumns.agreement} caption={strings.kappaGloss}>
        <BulletRows
          testId="gate-chart"
          head={[strings.gateColumns.measure, strings.chartAxis, strings.gateColumns.agreement]}
          rows={agreement.gate.checks.map(check =>
            kappaRow(check.measure, label(check.measure), check.kappa, check.passes),
          )}
        />
        <NumbersTable
          testId="gate-numbers"
          head={Object.values(strings.gateColumns)}
          rows={agreement.gate.checks.map(check => [
            label(check.measure),
            kappa(check.kappa),
            check.passes ? strings.gatePasses : strings.gateNotYet,
          ])}
        />
      </ChartCard>
    </section>
  );
};

/** Agreement on each part of the rubric: the judge against people, κ against the same 0.6. */
const AgreementChart: React.FC<{ agreement: DebriefCalibrationAgreement }> = ({ agreement }) => {
  const strings = en.debriefs.calibration;
  const lean = (d: number | null) =>
    d === null
      ? "—"
      : Math.abs(d) < 0.05
        ? strings.leanEven
        : d > 0
          ? strings.leanHigher(d)
          : strings.leanLower(d);
  const parts = DEBRIEF_DIMENSIONS.map(dimension => ({
    dimension,
    label: en.debriefs.dimensions[dimension].label,
    judge: agreement.judgeVsHuman.dimensions[dimension],
    people: agreement.humanVsHuman.dimensions[dimension],
  }));
  return (
    <section className="flex flex-col gap-2" data-testid="calibration-agreement">
      <h3 className="text-xl font-normal text-typography-900">{strings.agreementHeading}</h3>
      <ChartCard title={strings.agreementColumns.judge} caption={strings.kappaGloss}>
        <BulletRows
          testId="agreement-chart"
          head={[strings.agreementColumns.part, strings.chartAxis, strings.agreementColumns.judge]}
          rows={parts.map(p =>
            kappaRow(
              p.dimension,
              p.label,
              p.judge?.weightedKappa ?? null,
              undefined,
              strings.peopleLine(kappa(p.people?.weightedKappa ?? null)),
            ),
          )}
        />
        <NumbersTable
          testId="agreement-numbers"
          head={Object.values(strings.agreementColumns)}
          rows={parts.map(p => [
            p.label,
            kappa(p.judge?.weightedKappa ?? null),
            p.judge?.withinOnePct == null ? "—" : `${p.judge.withinOnePct}%`,
            // The judge is the first rater in judge-vs-human, so positive = judge higher.
            lean(p.judge?.meanDifference ?? null),
            kappa(p.people?.weightedKappa ?? null),
          ])}
        />
      </ChartCard>
    </section>
  );
};

type Agreement = NonNullable<DebriefAnalyticsView["judgeAgreement"]>;

/** `GET analytics`'s judge agreement in the shape the two charts read. */
export const toCalibrationShape = (a: Agreement): DebriefCalibrationAgreement =>
  ({
    gate: a.gate,
    target: a.target,
    judgeVsHuman: {
      dimensions: Object.fromEntries(
        a.dimensions.map(d => [
          d.dimension,
          {
            pairs: d.pairs,
            debriefs: d.pairs,
            weightedKappa: d.kappa,
            withinOnePct: d.withinOnePct,
            meanDifference: d.meanDifference,
          },
        ]),
      ),
      hardFails: {},
    },
    humanVsHuman: (a.humanVsHuman as DebriefCalibrationAgreement["humanVsHuman"] | null) ?? {
      dimensions: {},
      hardFails: {},
    },
  }) as unknown as DebriefCalibrationAgreement;

/**
 * Analytics › Debriefs › Judge agreement (moved from the console's Calibration tab, 2026-11-12):
 * how far the judge agrees with people who score by hand, which gates the PM agent's autonomy.
 * Read from `GET analytics` with the rest of the page's console numbers.
 */
export const JudgeAgreementSection: React.FC<{
  agreement: DebriefAnalyticsView["judgeAgreement"] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}> = ({ agreement, loading, error, onRetry }) => {
  const strings = en.debriefs.calibration;
  const tileState = { loading, error: !!error, onRetry };
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
          value={agreement ? strings.ofTarget(agreement.debriefsRated, agreement.target) : "—"}
          {...tileState}
        />
        <KpiTile
          label={strings.kpis.raters}
          description={strings.kpis.ratersHelp}
          value={String(agreement?.peopleRating ?? "—")}
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
      ) : agreement ? (
        <>
          <GateChart agreement={toCalibrationShape(agreement)} />
          <AgreementChart agreement={toCalibrationShape(agreement)} />
        </>
      ) : (
        <p className="text-sm text-typography-700" data-testid="judge-agreement-empty">
          {strings.noAgreement}
        </p>
      )}
    </section>
  );
};
