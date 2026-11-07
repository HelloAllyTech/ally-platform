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

import { DEBRIEF_DIMENSIONS, RatingPanel } from "./RatingPanel";
import { KpiTile } from "../Analytics/chartKit";

const FILTERS = ["todo", "all"] as const;
type Filter = (typeof FILTERS)[number];

const kappa = (value: number | null) =>
  value === null ? en.debriefs.calibration.needsMore : value.toFixed(2);

const GateTable: React.FC<{ agreement: DebriefCalibrationAgreement }> = ({ agreement }) => {
  const strings = en.debriefs.calibration;
  return (
    <section className="flex flex-col gap-2" data-testid="calibration-gate">
      <h3 className="flex items-center gap-1 text-xl font-normal text-typography-900">
        {strings.gateHeading}
        <InfoTip label={strings.gateHelp} ariaLabel="About the autonomy checks" />
      </h3>
      <Table className="w-full border-collapse text-left">
        <TableHead>
          <TableRow className="border-b border-border-light text-sm text-typography-700">
            <TableHeader className="py-2 pr-4 font-medium">
              {strings.gateColumns.measure}
            </TableHeader>
            <TableHeader className="py-2 pr-4 font-medium">
              {strings.gateColumns.agreement}
            </TableHeader>
            <TableHeader className="py-2 pr-4 font-medium">
              {strings.gateColumns.status}
            </TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {agreement.gate.checks.map(check => (
            <TableRow
              key={check.measure}
              className="border-b border-border-light text-sm text-typography-900"
              data-testid={`gate-${check.measure}`}
            >
              <TableCell className="py-2 pr-4">
                {en.debriefs.gateMeasures[check.measure] ?? check.measure}
              </TableCell>
              <TableCell className="py-2 pr-4">{kappa(check.kappa)}</TableCell>
              <TableCell className="py-2 pr-4">
                <Pill tone={check.passes ? "success" : "neutral"}>
                  {check.passes ? strings.gatePasses : strings.gateNotYet}
                </Pill>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
};

const AgreementTable: React.FC<{ agreement: DebriefCalibrationAgreement }> = ({ agreement }) => {
  const strings = en.debriefs.calibration;
  const lean = (d: number | null) =>
    d === null
      ? "—"
      : Math.abs(d) < 0.05
        ? strings.leanEven
        : d > 0
          ? strings.leanHigher(d)
          : strings.leanLower(d);
  return (
    <section className="flex flex-col gap-2" data-testid="calibration-agreement">
      <h3 className="text-xl font-normal text-typography-900">{strings.agreementHeading}</h3>
      <div className="overflow-x-auto">
        <Table className="w-full border-collapse text-left">
          <TableHead>
            <TableRow className="border-b border-border-light text-sm text-typography-700">
              {Object.values(strings.agreementColumns).map(label => (
                <TableHeader key={label} className="py-2 pr-4 font-medium">
                  {label}
                </TableHeader>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {DEBRIEF_DIMENSIONS.map(dimension => {
              const judge = agreement.judgeVsHuman.dimensions[dimension];
              const people = agreement.humanVsHuman.dimensions[dimension];
              return (
                <TableRow
                  key={dimension}
                  className="border-b border-border-light text-sm text-typography-900"
                >
                  <TableCell className="py-2 pr-4">
                    {en.debriefs.dimensions[dimension].label}
                  </TableCell>
                  <TableCell className="py-2 pr-4">{kappa(judge?.weightedKappa ?? null)}</TableCell>
                  <TableCell className="py-2 pr-4">
                    {judge?.withinOnePct == null ? "—" : `${judge.withinOnePct}%`}
                  </TableCell>
                  {/* The judge is the first rater in judge-vs-human, so positive = judge higher. */}
                  <TableCell className="py-2 pr-4">{lean(judge?.meanDifference ?? null)}</TableCell>
                  <TableCell className="py-2 pr-4">
                    {kappa(people?.weightedKappa ?? null)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
};

/**
 * The calibration set: people score a seeded sample of judged debriefs blind, and their
 * agreement with the judge is the standing gate on the Improver's autonomy. The list shows no
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
          <GateTable agreement={agreement.data} />
          <AgreementTable agreement={agreement.data} />
        </>
      ) : (
        <LoadingBlock lines={4} />
      )}

      <section className="flex flex-col gap-4" data-testid="calibration-sample">
        <div className="flex items-center gap-1">
          <h3 className="text-xl font-normal text-typography-900">{strings.sampleHeading}</h3>
          <InfoTip label={strings.sampleHelp} ariaLabel="About the sample" />
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
                    <span className="sr-only">Actions</span>
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
                    <TableCell className="py-3 pr-4">{item.language}</TableCell>
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
