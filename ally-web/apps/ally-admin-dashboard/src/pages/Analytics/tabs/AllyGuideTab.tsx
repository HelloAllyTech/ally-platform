import { useMemo, useState } from "react";

import { ComboChart, LineChart } from "@carbon/charts-react";

import {
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import {
  useGetAllyGuideAnalyticsCoursesQuery,
  useGetAllyGuideAnalyticsSummaryQuery,
  useGetAllyGuideAnalyticsWeeklyQuery,
  useGetAllyGuideEngagementVsLearningQuery,
  useGetTenantsQuery,
} from "@api";
import { en } from "@constants";
import { AllyRate, AllyWeek } from "@types";

import {
  FLAGGED,
  flaggedWeeks,
  formatFigure,
  formatPercentValue,
  hasPoints,
  hasWithheld,
  pair,
  pairedEngagementSeries,
  pairedLearningSeries,
  rateSeries,
  single,
  toPercent,
  twoSeries,
  valueSeries,
} from "../allyGuideChart";
import { asOfStamp, AnalyticsTabFilters, windowLabel } from "../analyticsFilters";
import { useAnalyticsOrgScope } from "../analyticsOrgScope";
import { buildSource, ChartCard, ChartIdBadge, comboOpts, KpiTile, lineOpts } from "../chartKit";
import { ColorScale } from "../chartScales";
import { ChartDatum } from "../engagementChart";
import { TabControls } from "../tabControlsSlot";

const PERCENT_DOMAIN: [number, number] = [0, 100];

interface LineCardProps {
  chartId: string;
  title: string;
  caption: string;
  data: ChartDatum[];
  colorScale: ColorScale;
  leftTitle: string;
  /** True for a 0-100 percent axis; false lets the axis fit the figure. */
  percent: boolean;
  legend?: boolean;
  withheldNote?: string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  source: string;
}

/** One weekly line chart, on the kit's card: id badge, provenance, thin-data and error states. */
const LineCard = ({
  chartId,
  title,
  caption,
  data,
  colorScale,
  leftTitle,
  percent,
  legend = true,
  withheldNote,
  loading,
  error,
  onRetry,
  source,
}: LineCardProps) => {
  const strings = en.allyAnalytics;
  const opts = useMemo(
    () =>
      lineOpts({
        leftTitle,
        bottomTitle: strings.weekAxis,
        colorScale,
        legend,
        ...(percent ? { domain: PERCENT_DOMAIN } : {}),
        extra: {
          points: { enabled: true, radius: 4 },
          tooltip: {
            valueFormatter: (value: unknown) =>
              typeof value === "number"
                ? percent
                  ? formatPercentValue(value)
                  : formatFigure(value, 2)
                : String(value),
          },
        },
      }),
    [leftTitle, colorScale, legend, percent, strings.weekAxis],
  );
  return (
    <ChartCard
      title={title}
      chartId={chartId}
      caption={caption}
      collapseMeta
      metaExtra={withheldNote}
      source={source}
      loading={loading}
      error={error}
      onRetry={onRetry}
      errorSubtitle={strings.states.loadFailed}
      empty={!loading && !hasPoints(data)}
      // Activity whose every rate was withheld is not "no activity".
      emptyText={withheldNote ?? strings.states.empty}
    >
      <LineChart data={data} options={opts} />
    </ChartCard>
  );
};

/**
 * The Analytics page's Ally tab (AAQ-240 to AAQ-251): how learners use Ally and, beside it, whether
 * they are learning. The paired engagement-vs-learning chart (AAQ-248) leads, because it is the
 * guard: engagement that rises while learning stays flat or falls is the pattern the plan says to
 * revert. Every rate over too few learners is withheld by the server and drawn here as a gap with
 * the reason, never as a zero. Comparison lines for learners without Ally are a reference, not a
 * control, and say so. Open to an admin restricted to some organisations, narrowed to their page's
 * organisation.
 */
export const AllyGuideTab = ({ query }: AnalyticsTabFilters) => {
  const strings = en.allyAnalytics;
  const orgScope = useAnalyticsOrgScope();
  const { data: tenantData } = useGetTenantsQuery({ limit: 200 }, { skip: orgScope.restricted });
  const [orgId, setOrgId] = useState("");
  const orgItems = useMemo(
    () =>
      (tenantData?.data ?? [])
        .filter(tenant => !tenant.isTestOrganization)
        .map(tenant => ({ id: tenant.id, label: tenant.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [tenantData],
  );

  // A restricted admin reads the page's organisation; everyone else picks here.
  const tenantId = orgScope.restricted ? query.tenantId : orgId || undefined;
  const windowQuery = useMemo(() => ({ ...query, tenantId }), [query, tenantId]);

  const summary = useGetAllyGuideAnalyticsSummaryQuery(windowQuery);
  const weekly = useGetAllyGuideAnalyticsWeeklyQuery(windowQuery);
  const paired = useGetAllyGuideEngagementVsLearningQuery(windowQuery);
  const courses = useGetAllyGuideAnalyticsCoursesQuery(windowQuery);

  const weeks: AllyWeek[] = useMemo(() => weekly.data?.weeks ?? [], [weekly.data]);
  const weeklyLoading = weekly.isLoading && !weekly.data;
  const weeklyError = weekly.isError && !weekly.data;
  const asOf = asOfStamp(weekly.data?.window.computedAt);
  const minGroup = weekly.data?.minGroupSize ?? summary.data?.minGroupSize ?? 5;

  const source = (derivation: string, extra?: string) =>
    buildSource({
      derivation,
      window: windowLabel(weekly.data?.window ?? summary.data?.window),
      extra,
      asOf,
    });
  const weeklySource = source(strings.source.weekly);
  const withheldFor = (picks: ((week: AllyWeek) => AllyRate)[]) =>
    hasWithheld(weeks, picks) ? strings.withheld(minGroup) : undefined;

  const pairedSeries = useMemo(
    () =>
      pairedEngagementSeries(paired.data?.weeks ?? [], {
        items: strings.paired.items,
        thumbs: strings.paired.thumbs,
      }),
    [paired.data, strings.paired.items, strings.paired.thumbs],
  );
  const learningSeries = useMemo(
    () => pairedLearningSeries(paired.data?.weeks ?? [], strings.paired.pass),
    [paired.data, strings.paired.pass],
  );
  const flagged = useMemo(() => flaggedWeeks(paired.data?.weeks ?? []), [paired.data]);

  const pairedOpts = (leftTitle: string, colorScale: ColorScale, percent: boolean) =>
    lineOpts({
      leftTitle,
      bottomTitle: strings.weekAxis,
      colorScale,
      height: "220px",
      ...(percent ? { domain: PERCENT_DOMAIN } : {}),
      extra: { points: { enabled: true, radius: 4 } },
    });

  const comboData: ChartDatum[] = useMemo(
    () => [
      ...valueSeries(weeks, week => week.appointmentsSet, strings.appointments.set),
      ...rateSeries(weeks, week => week.appointmentsKept, strings.appointments.kept),
    ],
    [weeks, strings.appointments.set, strings.appointments.kept],
  );
  const comboScale = useMemo(
    () => twoSeries(strings.appointments.set, strings.appointments.kept),
    [strings.appointments.set, strings.appointments.kept],
  );

  const common = {
    loading: weeklyLoading,
    error: weeklyError,
    onRetry: () => void weekly.refetch(),
    source: weeklySource,
  };

  return (
    <div className="flex flex-col gap-6" data-testid="ally-guide-analytics">
      {!orgScope.restricted && (
        <TabControls>
          <Select
            id="ally-analytics-org"
            labelText="Organisation"
            value={orgId}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setOrgId(event.target.value)}
          >
            <SelectItem value="" text="All organisations" />
            {orgItems.map(item => (
              <SelectItem key={item.id} value={item.id} text={item.label} />
            ))}
          </Select>
        </TabControls>
      )}

      <p className="max-w-3xl text-sm text-typography-700">{strings.intro}</p>
      {(summary.data?.scoping.unscopedSections ?? []).length > 0 && tenantId && (
        <p className="text-xs text-typography-700" data-testid="ally-analytics-scope-note">
          {strings.scopeNote(summary.data?.scoping.unscopedSections ?? [])}
        </p>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="ally-glance-heading">
        <div className="flex items-center gap-2">
          <h3 id="ally-glance-heading" className="text-lg font-medium text-typography-900">
            {strings.glance.title}
          </h3>
          <ChartIdBadge id="AAQ-240" />
        </div>
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5"
          data-testid="ally-glance"
        >
          <KpiTile
            label={strings.glance.learners}
            value={(summary.data?.learners ?? 0).toLocaleString()}
            loading={summary.isLoading && !summary.data}
            error={summary.isError && !summary.data}
            onRetry={() => void summary.refetch()}
          />
          <KpiTile
            label={strings.glance.conversations}
            value={(summary.data?.conversations ?? 0).toLocaleString()}
            loading={summary.isLoading && !summary.data}
            error={summary.isError && !summary.data}
            onRetry={() => void summary.refetch()}
          />
          <KpiTile
            label={strings.glance.messages}
            value={(summary.data?.learnerMessages ?? 0).toLocaleString()}
            loading={summary.isLoading && !summary.data}
            error={summary.isError && !summary.data}
            onRetry={() => void summary.refetch()}
          />
          <KpiTile
            label={strings.glance.thumbsUp}
            value={
              summary.data?.thumbsUp.suppressed
                ? "—"
                : formatPercentValue(toPercent(summary.data?.thumbsUp.rate))
            }
            description={
              summary.data
                ? summary.data.thumbsUp.suppressed
                  ? strings.withheld(summary.data.minGroupSize)
                  : strings.glance.thumbsUpDetail(
                      summary.data.thumbsUp.count,
                      summary.data.thumbsUp.of,
                    )
                : undefined
            }
            loading={summary.isLoading && !summary.data}
            error={summary.isError && !summary.data}
            onRetry={() => void summary.refetch()}
          />
          <KpiTile
            label={strings.glance.cost}
            value={summary.data ? `$${summary.data.costUsd.toFixed(2)}` : "—"}
            description={
              summary.data?.costPerLearnerUsd === null || summary.data === undefined
                ? strings.glance.withheldCost
                : `${strings.glance.costPerLearner}: $${summary.data.costPerLearnerUsd.toFixed(2)}`
            }
            loading={summary.isLoading && !summary.data}
            error={summary.isError && !summary.data}
            onRetry={() => void summary.refetch()}
          />
        </div>
      </section>

      <ChartCard
        wide
        title={strings.paired.title}
        chartId="AAQ-248"
        caption={strings.paired.caption}
        collapseMeta
        source={source(strings.source.weekly, paired.data?.provenance)}
        loading={paired.isLoading && !paired.data}
        error={paired.isError && !paired.data}
        onRetry={() => void paired.refetch()}
        errorSubtitle={strings.states.loadFailed}
        empty={
          !paired.isLoading &&
          !hasPoints(pairedSeries.items) &&
          !hasPoints(pairedSeries.thumbs) &&
          !hasPoints(learningSeries)
        }
        emptyText={
          (summary.data?.learners ?? 0) > 0 ? strings.withheld(minGroup) : strings.states.empty
        }
        height="auto"
      >
        <div className="flex flex-col gap-4" data-testid="ally-paired">
          <div>
            <h4 className="text-sm font-semibold text-typography-900">
              {strings.paired.engagementHeading}
            </h4>
            <LineChart
              data={[...pairedSeries.items]}
              options={pairedOpts(
                strings.paired.axisEngagement,
                single(strings.paired.items),
                false,
              )}
            />
            <LineChart
              data={[...pairedSeries.thumbs]}
              options={pairedOpts(strings.paired.axisThumbs, single(strings.paired.thumbs), true)}
            />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-typography-900">
              {strings.paired.learningHeading}
            </h4>
            <LineChart
              data={[...learningSeries]}
              options={pairedOpts(strings.paired.axisLearning, single(strings.paired.pass), true)}
            />
          </div>
          <div data-testid="ally-paired-flags">
            <h4 className="text-sm font-semibold text-typography-900">
              {strings.paired.flagsHeading}
            </h4>
            {flagged.length === 0 ? (
              <p className="text-sm text-typography-700" data-testid="ally-paired-none">
                {strings.paired.noneFlagged}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {flagged.map(week => (
                  <li
                    key={week.week}
                    className="text-sm text-typography-900"
                    data-testid={`ally-flag-${week.week}`}
                    title={strings.paired.flagHelp[week.guard]}
                  >
                    <span className="font-mono">{week.week}</span>:{" "}
                    <span className="font-medium text-destructive-600">
                      {strings.paired.flagWords[week.guard]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="overflow-x-auto">
            <Table className="w-full border-collapse text-left" data-testid="ally-paired-table">
              <TableHead>
                <TableRow className="border-b border-border-light text-xs text-typography-700">
                  <TableHeader className="py-1 pr-4 font-medium">
                    {strings.paired.columns.week}
                  </TableHeader>
                  <TableHeader className="py-1 pr-4 font-medium">
                    {strings.paired.columns.items}
                  </TableHeader>
                  <TableHeader className="py-1 pr-4 font-medium">
                    {strings.paired.columns.thumbs}
                  </TableHeader>
                  <TableHeader className="py-1 pr-4 font-medium">
                    {strings.paired.columns.pass}
                  </TableHeader>
                  <TableHeader className="py-1 pr-4 font-medium">
                    {strings.paired.columns.guard}
                  </TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {(paired.data?.weeks ?? []).map(week => (
                  <TableRow key={week.week} className="border-b border-border-light text-sm">
                    <TableCell className="py-1 pr-4 font-mono text-xs">{week.week}</TableCell>
                    <TableCell className="py-1 pr-4 tabular-nums">
                      {formatFigure(week.itemsPerLearningDay, 2)}
                    </TableCell>
                    <TableCell className="py-1 pr-4 tabular-nums">
                      {formatPercentValue(toPercent(week.thumbsUpShare))}
                    </TableCell>
                    <TableCell className="py-1 pr-4 tabular-nums">
                      {formatPercentValue(toPercent(week.quizFirstAttemptPass))}
                    </TableCell>
                    <TableCell className="py-1 pr-4">
                      {FLAGGED.includes(week.guard) ? (
                        <span className="font-medium text-destructive-600">
                          {strings.paired.flagWords[week.guard]}
                        </span>
                      ) : (
                        strings.paired.flagWords[week.guard]
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </ChartCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LineCard
          {...common}
          chartId="AAQ-241"
          title={strings.firstWins.title}
          caption={strings.firstWins.caption}
          data={[
            ...rateSeries(weeks, week => week.firstSessionWin, strings.firstWins.session),
            ...rateSeries(weeks, week => week.firstWinWithin5Min, strings.firstWins.fiveMinutes),
          ]}
          colorScale={twoSeries(strings.firstWins.session, strings.firstWins.fiveMinutes)}
          leftTitle={strings.firstWins.axis}
          percent
          withheldNote={withheldFor([
            week => week.firstSessionWin,
            week => week.firstWinWithin5Min,
          ])}
        />
        <LineCard
          {...common}
          chartId="AAQ-242"
          title={strings.items.title}
          caption={strings.items.caption}
          data={valueSeries(weeks, week => week.itemsPerLearningDay, strings.items.series)}
          colorScale={single(strings.items.series)}
          leftTitle={strings.items.axis}
          percent={false}
          legend={false}
          // A figure, not a rate: the server withholds it below the group minimum.
          withheldNote={
            weeks.some(week => week.activeLearners > 0 && week.activeLearners < minGroup)
              ? strings.withheld(minGroup)
              : undefined
          }
        />
        <LineCard
          {...common}
          chartId="AAQ-243"
          title={strings.returns.title}
          caption={strings.returns.caption}
          data={rateSeries(weeks, week => week.sevenDayReturn, strings.returns.series)}
          colorScale={single(strings.returns.series)}
          leftTitle={strings.returns.axis}
          percent
          legend={false}
          withheldNote={withheldFor([week => week.sevenDayReturn])}
        />
        <ChartCard
          title={strings.appointments.title}
          chartId="AAQ-244"
          caption={strings.appointments.caption}
          collapseMeta
          metaExtra={withheldFor([week => week.appointmentsKept])}
          source={weeklySource}
          loading={weeklyLoading}
          error={weeklyError}
          onRetry={() => void weekly.refetch()}
          errorSubtitle={strings.states.loadFailed}
          empty={!weeklyLoading && !hasPoints(comboData)}
          emptyText={strings.states.empty}
        >
          <ComboChart
            data={comboData}
            options={comboOpts({
              barGroup: strings.appointments.set,
              lineGroup: strings.appointments.kept,
              leftTitle: strings.appointments.axisLeft,
              rightTitle: strings.appointments.axisRight,
              bottomTitle: strings.weekAxis,
              colorScale: comboScale,
            })}
          />
        </ChartCard>
        <LineCard
          {...common}
          chartId="AAQ-245"
          title={strings.voice.title}
          caption={strings.voice.caption}
          data={rateSeries(weeks, week => week.voiceAdoption, strings.voice.series)}
          colorScale={single(strings.voice.series)}
          leftTitle={strings.voice.axis}
          percent
          legend={false}
          withheldNote={withheldFor([week => week.voiceAdoption])}
        />
        <LineCard
          {...common}
          chartId="AAQ-246"
          title={strings.quiz.title}
          caption={strings.quiz.caption}
          data={[
            ...rateSeries(weeks, week => week.quizFirstAttemptPass, strings.quiz.ally),
            ...rateSeries(weeks, week => week.quizFirstAttemptPassClassic, strings.quiz.classic),
          ]}
          colorScale={pair(strings.quiz.ally, strings.quiz.classic)}
          leftTitle={strings.quiz.axis}
          percent
          withheldNote={withheldFor([
            week => week.quizFirstAttemptPass,
            week => week.quizFirstAttemptPassClassic,
          ])}
        />
        <LineCard
          {...common}
          chartId="AAQ-247"
          title={strings.roleplay.title}
          caption={strings.roleplay.caption}
          data={[
            ...valueSeries(weeks, week => week.roleplayScore, strings.roleplay.ally),
            ...valueSeries(weeks, week => week.roleplayScoreClassic, strings.roleplay.classic),
          ]}
          colorScale={pair(strings.roleplay.ally, strings.roleplay.classic)}
          leftTitle={strings.roleplay.axis}
          percent={false}
        />
        <LineCard
          {...common}
          chartId="AAQ-249"
          title={strings.health.title}
          caption={strings.health.caption}
          data={[
            ...valueSeries(weeks, week => week.careEntriesPer100, strings.health.care),
            ...valueSeries(weeks, week => week.crisisEntriesPer100, strings.health.crisis),
          ]}
          colorScale={twoSeries(strings.health.care, strings.health.crisis)}
          leftTitle={strings.health.axis}
          percent={false}
        />
        <LineCard
          {...common}
          chartId="AAQ-250"
          title={strings.offCourse.title}
          caption={strings.offCourse.caption}
          data={[
            ...rateSeries(weeks, week => week.offCourse, strings.offCourse.offCourse),
            ...rateSeries(weeks, week => week.refusals, strings.offCourse.refusals),
          ]}
          colorScale={twoSeries(strings.offCourse.offCourse, strings.offCourse.refusals)}
          leftTitle={strings.offCourse.axis}
          percent
          withheldNote={withheldFor([week => week.offCourse, week => week.refusals])}
        />
      </div>

      <ChartCard
        wide
        title={strings.courses.title}
        chartId="AAQ-251"
        caption={strings.courses.caption}
        collapseMeta
        source={source(strings.source.courses)}
        loading={courses.isLoading && !courses.data}
        error={courses.isError && !courses.data}
        onRetry={() => void courses.refetch()}
        errorSubtitle={strings.states.loadFailed}
        empty={!courses.isLoading && (courses.data?.courses ?? []).length === 0}
        emptyText={strings.states.empty}
        height="auto"
      >
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-left" data-testid="ally-courses-table">
            <TableHead>
              <TableRow className="border-b border-border-light text-sm text-typography-700">
                <TableHeader className="py-2 pr-4 font-medium">
                  {strings.courses.columns.course}
                </TableHeader>
                <TableHeader className="py-2 pr-4 font-medium">
                  {strings.courses.columns.learners}
                </TableHeader>
                <TableHeader className="py-2 pr-4 font-medium">
                  {strings.courses.columns.turns}
                </TableHeader>
                <TableHeader className="py-2 pr-4 font-medium">
                  {strings.courses.columns.cost}
                </TableHeader>
                <TableHeader className="py-2 pr-4 font-medium">
                  {strings.courses.columns.perLearner}
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {(courses.data?.courses ?? []).map(course => (
                <TableRow
                  key={course.trackId ?? "other"}
                  className="border-b border-border-light text-sm text-typography-900"
                  data-testid="ally-course-row"
                >
                  <TableCell className="py-2 pr-4">
                    {course.trackId === null ? strings.courses.folded(course.folded) : course.title}
                  </TableCell>
                  <TableCell className="py-2 pr-4 tabular-nums">{course.learners}</TableCell>
                  <TableCell className="py-2 pr-4 tabular-nums">{course.turns}</TableCell>
                  <TableCell className="py-2 pr-4 tabular-nums">
                    ${course.costUsd.toFixed(2)}
                  </TableCell>
                  <TableCell className="py-2 pr-4 tabular-nums">
                    {course.costPerLearnerUsd === null
                      ? "—"
                      : `$${course.costPerLearnerUsd.toFixed(2)}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ChartCard>
    </div>
  );
};
