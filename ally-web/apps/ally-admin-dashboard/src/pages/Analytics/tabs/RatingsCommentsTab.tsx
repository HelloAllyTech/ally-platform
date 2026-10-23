import { useEffect, useMemo, useState } from "react";

import { useSelector } from "react-redux";
import { Link } from "react-router-dom";

import {
  CarbonDropdown as Dropdown,
  CarbonToggle,
  MultiSelect,
  Search,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Tile,
} from "@ally-ui-mono/ui-shared";
import { useGetLearnerFeedbackQuery, useGetTenantsQuery } from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { FeatureToggleKey, ROUTES } from "@constants";
import { RootState } from "@store";
import { LearnerFeedbackItem, LearnerFeedbackSummary } from "@types";
import { formatDate, hasFeature } from "@utils";

import { asOfStamp, AnalyticsTabFilters, windowLabel } from "../analyticsFilters";
import { useAnalyticsOrgScope } from "../analyticsOrgScope";
import { buildSource, ChartCard } from "../chartKit";
import { TabControls } from "../tabControlsSlot";

/** Rows per page of the feed. */
export const RATINGS_PAGE_SIZE = 25;

const STAR_ITEMS: { id: number; label: string }[] = [1, 2, 3, 4, 5].map(s => ({
  id: s,
  label: `${s} star${s === 1 ? "" : "s"}`,
}));

/** Red for 1-2, neutral for 3, green for 4-5: the reading a triager needs first. */
export const ratingTagType = (rating: number): "red" | "gray" | "green" =>
  rating <= 2 ? "red" : rating === 3 ? "gray" : "green";

const useDebouncedValue = <T,>(value: T, ms: number): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
};

/**
 * What to say when the feed is empty, which depends on why it is empty: a quiet
 * window, ratings that came without words, or filters that excluded everything.
 */
export const emptyFeedText = (
  summary: LearnerFeedbackSummary | undefined,
  filters: { commentsOnly: boolean; stars: number[]; search: string },
): string => {
  if (!summary || summary.ratings === 0) {
    return "No roleplay was rated in this period. Try a longer time range.";
  }
  const narrowed = filters.stars.length > 0 || filters.search !== "";
  if (!narrowed && filters.commentsOnly && summary.withComment === 0) {
    const n = summary.ratings;
    return `No written comments in this period. ${n} rating${n === 1 ? "" : "s"} came without one. Turn off "Only with a comment" to see them.`;
  }
  return "Nothing matches these filters.";
};

const RatingTag = ({ rating }: { rating: number }) => (
  <Tag type={ratingTagType(rating)} size="sm" className="!m-0">
    <span aria-hidden="true">{rating} ★</span>
    <span className="sr-only">{rating} out of 5</span>
  </Tag>
);

const SummaryStrip = ({
  summary,
  stars,
  onPickStar,
}: {
  summary: LearnerFeedbackSummary;
  stars: number[];
  onPickStar: (star: number) => void;
}) => {
  const commentPct = summary.ratings
    ? Math.round((summary.withComment / summary.ratings) * 100)
    : null;
  const max = Math.max(1, ...summary.distribution.map(d => d.count));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile className="analytics-kpi">
          <p className="text-sm text-typography-600 mb-2">Ratings</p>
          <p className="text-2xl font-medium text-typography-900">
            {summary.ratings.toLocaleString()}
          </p>
          <p className="text-xs text-typography-500 mt-1">Roleplays a learner rated</p>
        </Tile>
        <Tile className="analytics-kpi">
          <p className="text-sm text-typography-600 mb-2">With a comment</p>
          <p className="text-2xl font-medium text-typography-900">
            {summary.withComment.toLocaleString()}
          </p>
          <p className="text-xs text-typography-500 mt-1">
            {commentPct === null ? "—" : `${commentPct}% of ratings`}
          </p>
        </Tile>
        <Tile className="analytics-kpi">
          <p className="text-sm text-typography-600 mb-2">Average rating</p>
          <p className="text-2xl font-medium text-typography-900">
            {summary.avgRating === null ? "—" : `${summary.avgRating.toFixed(2)} / 5`}
          </p>
          <p className="text-xs text-typography-500 mt-1">Mean of the 1–5 stars</p>
        </Tile>
      </div>
      {/* One button per star: the bar is the count, the click narrows the feed
          to that star (and clicking it again clears it). */}
      <div
        className="grid grid-cols-5 gap-2"
        role="group"
        aria-label="Ratings by star; select one to show only those"
      >
        {summary.distribution.map(d => {
          const active = stars.length === 1 && stars[0] === d.rating;
          return (
            <button
              key={d.rating}
              type="button"
              aria-pressed={active}
              onClick={() => onPickStar(d.rating)}
              title={`${d.count} rated ${d.rating}, ${d.withComment} with a comment`}
              className={`flex flex-col gap-1 rounded border px-2 py-2 text-left text-xs transition-colors ${
                active ? "border-[#0f62fe] bg-[#edf5ff]" : "border-border-light hover:bg-[#f4f4f4]"
              }`}
            >
              <span className="font-medium text-typography-900">{d.rating} ★</span>
              <span
                className="block h-1.5 rounded-sm bg-[#8d8d8d]"
                style={{ width: `${Math.max(4, (d.count / max) * 100)}%` }}
                aria-hidden="true"
              />
              <span className="text-typography-600">
                {d.count}
                <span className="max-sm:hidden"> · {d.withComment} with a comment</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const FeedRow = ({
  item,
  showOrg,
  canOpenSession,
}: {
  item: LearnerFeedbackItem;
  showOrg: boolean;
  canOpenSession: boolean;
}) => (
  <TableRow className="border-b border-border-light align-top text-sm text-typography-900">
    <TableCell className="py-3 pr-4 whitespace-nowrap">
      {canOpenSession ? (
        <Link
          to={ROUTES.ROLEPLAY_SESSION_LOG_DETAIL(item.sessionId)}
          title="Open this session in Roleplay Logs"
          className="text-[#0f62fe] hover:underline"
        >
          {formatDate(item.sessionAt)}
        </Link>
      ) : (
        formatDate(item.sessionAt)
      )}
    </TableCell>
    <TableCell className="py-3 pr-4">
      <RatingTag rating={item.rating} />
    </TableCell>
    <TableCell className="py-3 pr-4 min-w-[16rem] max-w-[36rem]">
      {item.comment ? (
        <p className="whitespace-pre-wrap break-words">{item.comment}</p>
      ) : (
        <p className="italic text-typography-500">No comment</p>
      )}
      {item.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.tags.map(t => (
            <Tag key={t} type="gray" size="sm" className="!m-0">
              {t}
            </Tag>
          ))}
        </div>
      )}
    </TableCell>
    <TableCell className="py-3 pr-4 min-w-[9rem]">
      <p>{item.learnerName ?? "Unknown learner"}</p>
      {item.language && <p className="text-xs text-typography-500">{item.language}</p>}
    </TableCell>
    {showOrg && <TableCell className="py-3 pr-4 min-w-[8rem]">{item.orgName ?? "—"}</TableCell>}
    <TableCell className="py-3 pr-4 min-w-[12rem] max-w-[20rem]">
      <p className="line-clamp-2" title={item.scenarioTitle ?? undefined}>
        {item.scenarioTitle ?? "—"}
      </p>
    </TableCell>
  </TableRow>
);

/**
 * Ratings & comments — what learners wrote about their roleplays.
 *
 * Everything else on Analytics reduces the post-session rating to a number
 * (Average rating, proxy NPS). This is the one place the words are readable,
 * because the words are where the reasons are: most low ratings explain
 * themselves ("AI not responding", "audio is poor"), and a number cannot.
 *
 * - The summary covers the whole window and ignores the feed's own filters, so
 *   the reader can always see how much the filters left out.
 * - "Only with a comment" is on by default: a rating with no words adds a row
 *   with nothing to read, and the summary already counts it.
 * - A row opens the session in Roleplay Logs for an admin who has that page,
 *   so a complaint can be checked against the transcript.
 */
export const RatingsCommentsTab = ({ query }: AnalyticsTabFilters) => {
  const orgScope = useAnalyticsOrgScope();
  const features = useSelector((state: RootState) => state.user.features);
  // Roleplay Logs is platform-only: a restricted admin cannot open it.
  const canOpenSession =
    !orgScope.restricted && hasFeature(features, FeatureToggleKey.ROLEPLAY_SESSION_LOGS);

  const { data: tenantData } = useGetTenantsQuery({ limit: 200 }, { skip: orgScope.restricted });
  const orgItems = useMemo(
    () => [
      { id: "", label: "All organisations" },
      ...(tenantData?.data ?? [])
        .filter(t => !t.isTestOrganization)
        .map(t => ({ id: t.id, label: t.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ],
    [tenantData],
  );

  const [orgId, setOrgId] = useState("");
  const [stars, setStars] = useState<number[]>([]);
  const [commentsOnly, setCommentsOnly] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 300);

  // A restricted admin reads the page's organisation; everyone else picks here.
  const tenantId = orgScope.restricted ? query.tenantId : orgId || undefined;

  // The page resets whenever anything that changes the result set changes —
  // derived rather than reset in an effect, so a filter change never fires one
  // request for the stale page first.
  const filterKey = [
    query.range,
    query.from,
    query.to,
    tenantId,
    stars.join(),
    commentsOnly,
    search,
  ].join("|");
  const [page, setPage] = useState({ key: filterKey, offset: 0 });
  const offset = page.key === filterKey ? page.offset : 0;

  const { data, isLoading, isFetching, isError, refetch } = useGetLearnerFeedbackQuery({
    range: query.range,
    from: query.from,
    to: query.to,
    tenantId,
    ratings: stars,
    commentsOnly,
    search: search || undefined,
    limit: RATINGS_PAGE_SIZE,
    offset,
  });

  const pickStar = (star: number) =>
    setStars(current => (current.length === 1 && current[0] === star ? [] : [star]));

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + items.length, total);
  const canPrev = offset > 0;
  const canNext = offset + RATINGS_PAGE_SIZE < total;
  const goTo = (next: number) => setPage({ key: filterKey, offset: Math.max(0, next) });
  const showOrg = !tenantId;
  const asOf = asOfStamp(data?.window.computedAt);

  return (
    <div className="flex flex-col gap-6">
      <TabControls>
        {!orgScope.restricted && (
          <div className="w-full sm:w-56">
            <Dropdown
              id="ratings-org"
              size="md"
              titleText="Organisation"
              hideLabel
              label="All organisations"
              items={orgItems}
              selectedItem={orgItems.find(o => o.id === orgId) ?? orgItems[0]}
              itemToString={item => item?.label ?? ""}
              onChange={({ selectedItem }) => setOrgId(selectedItem?.id ?? "")}
            />
          </div>
        )}
        <div className="w-full sm:w-44">
          <MultiSelect
            id="ratings-stars"
            size="md"
            titleText="Rating"
            hideLabel
            label="All ratings"
            items={STAR_ITEMS}
            selectedItems={STAR_ITEMS.filter(i => stars.includes(i.id))}
            itemToString={item => item?.label ?? ""}
            sortItems={list => [...list]}
            onChange={({ selectedItems }) =>
              setStars((selectedItems ?? []).map(i => i.id).sort((a, b) => a - b))
            }
          />
        </div>
        <div className="w-full sm:w-64">
          <Search
            id="ratings-search"
            size="md"
            labelText="Search comments"
            placeholder="Search comments, learners, roleplays"
            value={searchInput}
            onChange={(e: { target: { value: string } }) => setSearchInput(e.target.value)}
            closeButtonLabelText="Clear search"
          />
        </div>
        <div className="flex items-center">
          <CarbonToggle
            id="ratings-comments-only"
            size="sm"
            // With hideLabel, Carbon shows labelText as the side label in both
            // states, so the control reads as one sentence rather than On/Off.
            labelText="Only with a comment"
            hideLabel
            toggled={commentsOnly}
            onToggle={setCommentsOnly}
          />
        </div>
      </TabControls>

      <ChartCard
        title="Ratings in this window"
        chartId="AAQ-238"
        caption="Every roleplay a learner rated, including those that ended with no conversation, so the count can run slightly above the Average rating chart. Not narrowed by the filters below. Select a star to show only those."
        source={
          data
            ? buildSource({
                derivation: "Learner's own 1–5 rating after a roleplay, latest per session",
                window: windowLabel(data.window),
                asOf,
              })
            : undefined
        }
        loading={isLoading}
        error={isError && !data}
        onRetry={refetch}
        height="auto"
      >
        {data && <SummaryStrip summary={data.summary} stars={stars} onPickStar={pickStar} />}
      </ChartCard>

      <ChartCard
        title="What learners wrote"
        chartId="AAQ-239"
        caption="Newest first, one row per rated roleplay. Most low ratings say why in the comment."
        source={
          data
            ? buildSource({
                derivation: "Post-session ratings and comments",
                window: windowLabel(data.window),
                n: total,
                nUnit: "ratings",
                asOf,
              })
            : undefined
        }
        loading={isLoading}
        error={isError && !data}
        onRetry={refetch}
        empty={!!data && total === 0}
        emptyText={emptyFeedText(data?.summary, { commentsOnly, stars, search })}
        height="12rem"
      >
        <div className={isFetching ? "opacity-60 transition-opacity" : undefined}>
          <div className="overflow-x-auto">
            <Table className="w-full text-left border-collapse">
              <TableHead>
                <TableRow className="border-b border-border-light text-sm text-typography-700">
                  <TableHeader className="py-3 pr-4 font-medium">Date</TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">Rating</TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">Comment</TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">Learner</TableHeader>
                  {showOrg && (
                    <TableHeader className="py-3 pr-4 font-medium">Organisation</TableHeader>
                  )}
                  <TableHeader className="py-3 pr-4 font-medium">Roleplay</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map(item => (
                  <FeedRow
                    key={item.feedbackId}
                    item={item}
                    showOrg={showOrg}
                    canOpenSession={canOpenSession}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-light pt-3 mt-2">
            <span className="text-sm text-typography-700">
              Showing {rangeStart}–{rangeEnd} of {total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <Button
                variant={ButtonVariant.SECONDARY}
                onClick={() => goTo(offset - RATINGS_PAGE_SIZE)}
                disabled={!canPrev || isFetching}
                className="px-4 sm:h-[36px]"
              >
                Previous
              </Button>
              <Button
                variant={ButtonVariant.SECONDARY}
                onClick={() => goTo(offset + RATINGS_PAGE_SIZE)}
                disabled={!canNext || isFetching}
                className="px-4 sm:h-[36px]"
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </ChartCard>
    </div>
  );
};
