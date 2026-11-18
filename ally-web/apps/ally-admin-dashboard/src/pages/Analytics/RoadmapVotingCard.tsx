import { useMemo, useState } from "react";

import { useGetRoadmapVotingQuery } from "@api";
import { StackedBarChart } from "@components/charts";

import { ChartDetailModal } from "./ChartDetailModal";
import { ChartCard, ScrollableChart, buildSource, stackedBarOpts } from "./chartKit";
import { monthLabel } from "./cohortChart";
import {
  MAX_VOTER_BANDS,
  OTHER_ADMINS,
  RoadmapVotingResponse,
  accessNote,
  buildRoadmapVotingScale,
  buildRoadmapVotingSeries,
  buildRoadmapVotingTable,
  buildWhoVotedGrid,
  partialFootnote,
  participationLabel,
  roadmapVotingEmptyText,
  roadmapVotingTakeaway,
  voterBands,
} from "./roadmapVotingChart";

const asOfStamp = (computedAt?: string): string | undefined => {
  if (!computedAt) return undefined;
  const d = new Date(computedAt);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const TITLE = "Roadmap votes cast, by admin";

const thBase = "py-1 px-2 font-medium text-typography-600 whitespace-nowrap";
const th = `${thBase} text-right`;
const td = "py-1 px-2 text-right tabular-nums";

/**
 * Who on the team is shaping the product roadmap, month by month — an adoption
 * chart: the aim is more admins voting, not more votes.
 *
 * Two parts. The stacked bars show how many votes each admin cast per month (top
 * eight by all-time votes, the rest rolled up). The grid under it is the part that
 * drives adoption: every admin with access, a column per recent month, and a 0
 * where they could have voted and didn't — the people a chart of votes cast can
 * never show. Its footer row is participation, "4 of 11 voted".
 *
 * Owns its own query: all-time and month-grained, platform-wide (the roadmap is
 * Ally's own backlog and carries no tenant).
 */
export const RoadmapVotingCard = () => {
  const { data, isLoading, isError, refetch } = useGetRoadmapVotingQuery();
  const [expanded, setExpanded] = useState(false);

  const bands = useMemo(() => voterBands(data), [data]);
  const series = useMemo(() => buildRoadmapVotingSeries(data, bands), [data, bands]);
  const scale = useMemo(() => buildRoadmapVotingScale(bands), [bands]);
  const table = useMemo(() => buildRoadmapVotingTable(data), [data]);
  const grid = useMemo(() => buildWhoVotedGrid(data), [data]);

  const emptyText = roadmapVotingEmptyText(data);
  const takeaway = roadmapVotingTakeaway(data);
  const footnote = partialFootnote(data);
  const access = accessNote(data);

  const opts = useMemo(
    () =>
      stackedBarOpts({
        leftTitle: "Votes cast",
        bottomTitle: "Month",
        colorScale: scale,
        height: "300px",
      }),
    [scale],
  );

  const caption =
    `How many roadmap votes each admin with access cast per month. A month counts the ` +
    `votes cast in it that still stand — a vote taken back is gone; a vote on something ` +
    `that has since shipped still counts. "Could vote" is everyone issued votes for that ` +
    `month. All-time and monthly — not affected by any date range.`;

  const source = buildSource({
    derivation:
      "SUM(roadmap_allocations.votes) per user per periodKey; could vote = monthly/daily roadmap_vote_grants for the month + anyone who voted + current vote permission holders (current month)",
    window: "All time",
    n: data?.users.length,
    nUnit: "admins",
    extra: "Ally's own roadmap — platform-wide, no tenant scope",
    asOf: asOfStamp(data?.computedAt),
  });

  return (
    <>
      <ChartCard
        wide
        title={TITLE}
        caption={caption}
        collapseMeta
        takeaway={takeaway}
        source={source}
        loading={isLoading && !data}
        error={isError}
        onRetry={refetch}
        empty={!isLoading && Boolean(emptyText)}
        emptyText={emptyText}
        onExpand={() => setExpanded(true)}
        chartId="AAQ-254"
      >
        <div className="flex flex-col gap-4">
          <ScrollableChart data={series}>
            <StackedBarChart data={series} options={opts} />
          </ScrollableChart>

          <WhoVotedTable data={data} grid={grid} />

          <div className="flex flex-col gap-1 text-xs text-typography-500">
            {footnote && <span>{footnote}</span>}
            {access && <span>{access}</span>}
            {bands.includes(OTHER_ADMINS) && (
              <span>
                &quot;{OTHER_ADMINS}&quot; in the bars rolls up everyone past the top{" "}
                {MAX_VOTER_BANDS - 1} by all-time votes; the table names them all.
              </span>
            )}
          </div>
        </div>
      </ChartCard>

      {expanded && (
        <ChartDetailModal
          open={expanded}
          onClose={() => setExpanded(false)}
          title={TITLE}
          caption="Every admin in every month they could vote, non-voters included, with the votes issued to them that month."
          source={source}
          table={table}
          exportContext={[
            "Window: all time, monthly",
            "Votes cast = votes cast in the month that still stand",
            "Votes issued = monthly + daily grants for the month (refunds excluded)",
          ]}
          render={({ height }) => (
            <ScrollableChart data={series}>
              <StackedBarChart data={series} options={{ ...opts, height }} />
            </ScrollableChart>
          )}
        />
      )}
    </>
  );
};

/**
 * The adoption grid: admins down the side in name order (not ranked — the bars
 * already rank, and a bottom-of-the-table row is a reason to disengage), recent
 * months across. "0" is an admin who could vote and didn't; "–" is a month they
 * were not on the list.
 */
const WhoVotedTable = ({
  data,
  grid,
}: {
  data: RoadmapVotingResponse | undefined;
  grid: ReturnType<typeof buildWhoVotedGrid>;
}) => {
  if (!data || grid.rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" data-testid="roadmap-who-voted">
        <thead>
          <tr>
            <th className={`${thBase} text-left`}>Admin</th>
            {grid.months.map(m => (
              <th key={m.month} className={th}>
                {monthLabel(m.month)}
                {m.partial ? " *" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map(row => (
            <tr key={row.userId} className="border-t border-border-light">
              <td className="py-1 px-2 text-left whitespace-nowrap">{row.name}</td>
              {row.cells.map((cell, i) => {
                const month = grid.months[i].month;
                if (cell.votes === null) {
                  return (
                    <td key={month} className={`${td} text-typography-400`}>
                      –
                    </td>
                  );
                }
                const issued =
                  cell.granted !== null ? ` of ${cell.granted.toLocaleString()} issued` : "";
                return (
                  <td
                    key={month}
                    className={`${td} ${cell.votes === 0 ? "text-typography-400" : "font-medium"}`}
                    title={`${row.name}, ${monthLabel(month)}: ${cell.votes.toLocaleString()} votes${issued}`}
                  >
                    {cell.votes.toLocaleString()}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="border-t border-border-light">
            <td className="py-1 px-2 text-left font-medium text-typography-600">Voted</td>
            {grid.months.map(m => (
              <td key={m.month} className={`${td} font-medium text-typography-600`}>
                {participationLabel(m).replace(" voted", "")}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
};
