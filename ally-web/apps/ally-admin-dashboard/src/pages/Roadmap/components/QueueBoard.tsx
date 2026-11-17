import React, { useMemo, useState } from "react";

import { ContentSwitcher, Switch } from "@ally-ui-mono/ui-shared";
import {
  useGetRoadmapBoardQuery,
  useGetRoadmapFacetsQuery,
  useGetRoadmapProductGoalsQuery,
  useGetRoadmapVoteBudgetQuery,
} from "@api";
import { Permissions, en } from "@constants";
import { useUser } from "@hooks";
import { RoadmapBoardGroupBy, RoadmapBoardQuery } from "@types";

import { MonthBoard } from "../../ProductRoadmap/MonthBoard";
import { EMPTY_ADVANCED_FILTERS } from "../../ProductRoadmap/utils/filters";
import { monthKeyOf, shiftMonthKey } from "../../ProductRoadmap/utils/monthBoard";
import { ROADMAP_PREF_KEYS, readPref, writePref } from "../utils/prefs";

const noop = () => undefined;
const NONE: never[] = [];

type Lanes = "goal" | "month";

const defaultWindow = () => {
  const current = monthKeyOf(new Date());
  return { from: shiftMonthKey(current, -1), to: shiftMonthKey(current, 4) };
};

/**
 * The Board layout (§4.3), for Builders and Owners: today's Kanban for planning, reused as it is.
 * Lanes are goal or month, which drag; there are no stage lanes, because stages are facts now
 * (§2.2). The board keeps its own filters off — the Queue's chips are the filter UI — and a card
 * opens the same reading pane as a row (the read model accepts the card's uuid).
 */
export const QueueBoard: React.FC<{ onOpen: (idOrCode: string) => void }> = ({ onOpen }) => {
  const copy = en.roadmapV2.layout;
  const { permissions } = useUser();
  const [lanes, setLanes] = useState<Lanes>(() =>
    readPref<Lanes>(ROADMAP_PREF_KEYS.boardLanes, "goal"),
  );
  const [monthWindow, setMonthWindow] = useState(defaultWindow);
  const groupBy = lanes === "month" ? RoadmapBoardGroupBy.MONTH : RoadmapBoardGroupBy.PRODUCT_GOAL;

  // The SAME memoised object goes to the query and to MonthBoard: useSetVotes patches by args.
  const boardArgs = useMemo<RoadmapBoardQuery>(
    () => ({ groupBy, from: monthWindow.from, to: monthWindow.to }),
    [groupBy, monthWindow],
  );
  const { data, isLoading, isFetching, isError, refetch } = useGetRoadmapBoardQuery(boardArgs);
  const { data: budget } = useGetRoadmapVoteBudgetQuery();
  const { data: goals } = useGetRoadmapProductGoalsQuery();
  const { data: facets } = useGetRoadmapFacetsQuery();

  const canVote = !!permissions?.includes(Permissions.VOTE_PRODUCT_ROADMAP);
  const canManage = !!permissions?.includes(Permissions.EDIT_PRODUCT_ROADMAP);

  const lanesSwitch = (
    <ContentSwitcher
      size="sm"
      selectedIndex={lanes === "month" ? 1 : 0}
      onChange={({ name }: { name?: string | number }) => {
        const next: Lanes = name === "month" ? "month" : "goal";
        setLanes(next);
        writePref(ROADMAP_PREF_KEYS.boardLanes, next);
      }}
      className="w-48"
    >
      <Switch name="goal" text={copy.boardByGoal} />
      <Switch name="month" text={copy.boardByMonth} />
    </ContentSwitcher>
  );

  return (
    <div className="p-4">
      <MonthBoard
        groupBy={groupBy}
        boardArgs={boardArgs}
        data={data}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        onRetry={() => refetch()}
        budget={budget}
        goals={goals ?? NONE}
        facets={facets}
        showFilters={false}
        search=""
        onSearchChange={noop}
        typeFilter={NONE}
        onTypeFilterChange={noop}
        stageFilter={NONE}
        onStageFilterChange={noop}
        sourceFilter={NONE}
        onSourceFilterChange={noop}
        effortFilter={NONE}
        onEffortFilterChange={noop}
        goalFilter={NONE}
        onGoalFilterChange={noop}
        ownerFilter={NONE}
        onOwnerFilterChange={noop}
        advanced={EMPTY_ADVANCED_FILTERS}
        onAdvancedChange={noop}
        canVote={canVote}
        canManage={canManage}
        onOpenOpportunity={onOpen}
        // TODO(P3): "New idea" opens the draft page; the board's own add button does nothing yet.
        onAddClick={noop}
        window={monthWindow}
        onWindowChange={setMonthWindow}
        layoutToggle={lanesSwitch}
      />
    </div>
  );
};
