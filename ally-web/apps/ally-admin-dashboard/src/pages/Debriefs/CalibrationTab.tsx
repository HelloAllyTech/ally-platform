import React, { useState } from "react";

import {
  Button,
  ContentSwitcher,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import { useGetDebriefCalibrationAgreementQuery, useGetDebriefCalibrationSampleQuery } from "@api";
import { shortId } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { DebriefCalibrationAgreement } from "@types";

import { codeWords, languageLabel } from "./consoleLabels";
import { BulletRow, BulletRows, kappaWords, NumbersTable } from "./metrics/metricsCharts";
import { TargetState } from "./metrics/metricsData";
import { DEBRIEF_DIMENSIONS, RatingPanel } from "./RatingPanel";
import { ChartCard, KpiTile } from "../Analytics/chartKit";

const FILTERS = ["todo", "all"] as const;
type Filter = (typeof FILTERS)[number];

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

/**
 * The calibration set: people score a seeded sample of judged debriefs blind, and their
 * agreement with the judge is the standing gate on the PM agent's autonomy. The list shows no
 * judge scores and no quality band — either would anchor the rater.
 */
export const CalibrationTab: React.FC = () => {
  const strings = en.debriefs.calibration;
  const [filter, setFilter] = useState<Filter>("todo");
  const [openId, setOpenId] = useState<string | null>(null);
  const sample = useGetDebriefCalibrationSampleQuery();
  const agreement = useGetDebriefCalibrationAgreementQuery();

  const items = sample.data?.items ?? [];
  const rated = items.filter(item => item.raters > 0).length;
  const mine = items.filter(item => item.ratedByMe).length;
  const shown = filter === "todo" ? items.filter(item => !item.ratedByMe) : items;
  const tileState = {
    loading: agreement.isLoading,
    error: agreement.isError,
    onRetry: () => void agreement.refetch(),
  };

  return (
    <div className="flex flex-col gap-8" data-testid="calibration-tab">
      <div>
        <h2 className="text-xl font-normal text-typography-900">{strings.heading}</h2>
        <p className="max-w-3xl pt-1 text-sm text-typography-700">{strings.help}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          label={strings.kpis.rated}
          description={strings.kpis.ratedHelp}
          value={sample.data ? strings.ofTarget(rated, sample.data.target) : "—"}
          loading={sample.isLoading}
          error={sample.isError}
          onRetry={() => void sample.refetch()}
        />
        <KpiTile
          label={strings.kpis.raters}
          description={strings.kpis.ratersHelp}
          value={String(agreement.data?.coverage.raters ?? "—")}
          {...tileState}
        />
        <KpiTile
          label={strings.kpis.mine}
          description={strings.kpis.mineHelp}
          value={String(mine)}
          loading={sample.isLoading}
          error={sample.isError}
          onRetry={() => void sample.refetch()}
        />
        <KpiTile
          label={strings.kpis.gate}
          description={strings.kpis.gateHelp}
          value={agreement.data?.gate.met ? strings.kpis.met : strings.kpis.notMet}
          {...tileState}
        />
      </div>

      {agreement.isError ? (
        <ErrorPanel
          what={strings.agreementFailed}
          error={agreement.error}
          onRetry={() => void agreement.refetch()}
        />
      ) : agreement.data ? (
        <>
          <GateChart agreement={agreement.data} />
          <AgreementChart agreement={agreement.data} />
        </>
      ) : (
        <LoadingBlock lines={4} />
      )}

      <section className="flex flex-col gap-4" data-testid="calibration-sample">
        <div className="flex items-center gap-1">
          <h3 className="text-xl font-normal text-typography-900">{strings.sampleHeading}</h3>
          <InfoTip label={strings.sampleHelp} ariaLabel={strings.sampleAbout} />
        </div>
        <ContentSwitcher
          size="md"
          selectedIndex={FILTERS.indexOf(filter)}
          onChange={(event: { name?: string | number }) => setFilter(event.name as Filter)}
          className="max-w-xs"
          aria-label={strings.filterLabel}
        >
          {FILTERS.map(name => (
            <Switch key={name} name={name} text={strings.filters[name]} />
          ))}
        </ContentSwitcher>

        {sample.isError ? (
          <ErrorPanel
            what={strings.loadFailed}
            error={sample.error}
            onRetry={() => void sample.refetch()}
          />
        ) : !sample.data ? (
          <LoadingBlock lines={5} />
        ) : items.length === 0 ? (
          <EmptyPanel title={strings.emptyTitle} message={strings.emptyMessage} />
        ) : shown.length === 0 ? (
          <EmptyPanel title={strings.allDoneTitle} message={strings.allDoneMessage} />
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full border-collapse text-left" data-testid="calibration-table">
              <TableHead>
                <TableRow className="border-b border-border-light text-sm text-typography-700">
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.debrief}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.language}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.raters}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">{strings.columns.you}</TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    <span className="sr-only">{strings.actions}</span>
                  </TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {shown.map(item => (
                  <TableRow
                    key={item.scenarioSessionId}
                    className="border-b border-border-light text-sm text-typography-900"
                    data-testid="calibration-row"
                  >
                    <TableCell className="py-3 pr-4 font-mono text-xs">
                      {shortId(item.scenarioSessionId)}
                    </TableCell>
                    <TableCell className="py-3 pr-4">{languageLabel(item.language)}</TableCell>
                    <TableCell className="py-3 pr-4">{item.raters}</TableCell>
                    <TableCell className="py-3 pr-4">
                      <Pill tone={item.ratedByMe ? "success" : "neutral"}>
                        {item.ratedByMe ? strings.youRated : strings.youNot}
                      </Pill>
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      <Button
                        kind="tertiary"
                        size="sm"
                        aria-label={strings.rateLabel(shortId(item.scenarioSessionId))}
                        onClick={() => setOpenId(item.scenarioSessionId)}
                      >
                        {item.ratedByMe ? strings.edit : strings.rate}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <RatingPanel sessionId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
};
