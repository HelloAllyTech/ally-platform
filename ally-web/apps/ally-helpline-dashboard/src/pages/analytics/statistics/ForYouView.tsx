import { FunctionComponent, useMemo, useState } from "react";

import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";

import { useGetStatisticsChartQuery } from "@api";
import { useUser } from "@hooks";
import type { StatisticsChartEntry, StatisticsViewConfig } from "@types";

import { SortableMetricBlock } from "../SortableMetricBlock";
import { filterParams } from "./ChartHost";
import { LayoutItem, layoutKey, parseLayoutKey, viewChartIds } from "./layout";
import { LibraryDrawer } from "./LibraryDrawer";
import { CHART_RENDERERS, PinSummary } from "./renderers";

/** Pinned cards compare over the last month. */
const PIN_RANGE = "30d";

interface ForYouViewProps {
  charts: readonly StatisticsChartEntry[];
  views: readonly StatisticsViewConfig[];
  /** The pinned card keys, in order. */
  pinKeys: readonly string[];
  onPinsChange: (keys: string[]) => void;
  /** Opens the chart a pinned card is about, on the tab it lives on. */
  onOpen: (item: LayoutItem) => void;
}

const TONE_CLASS = {
  good: "text-[#1e6b3a]",
  bad: "text-[#7a3205]",
  same: "text-typography-600",
} as const;

/** A small trend line for a series of values. */
const Sparkline: FunctionComponent<{ series: number[] }> = ({ series }) => {
  if (series.length < 2) return null;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const span = max - min || 1;
  const points = series
    .map((value, i) => `${(i / (series.length - 1)) * 200},${36 - ((value - min) / span) * 32}`)
    .join(" ");
  return (
    <svg viewBox="0 0 200 40" width="100%" height="40" aria-hidden="true">
      <polyline points={points} fill="none" stroke="#2A5DB0" strokeWidth="2" />
    </svg>
  );
};

/** One pinned chart as a compact card: a number, what it is, a trend and the change. */
const PinnedCard: FunctionComponent<{
  item: LayoutItem;
  entry: StatisticsChartEntry;
  editing: boolean;
  onOpen: () => void;
  onRemove: () => void;
}> = ({ item, entry, editing, onOpen, onRemove }) => {
  const { t } = useTranslation();
  const renderer = CHART_RENDERERS[item.id];
  const { currentData, isFetching, isError } = useGetStatisticsChartQuery(
    { id: item.id, range: PIN_RANGE, ...filterParams(item.filters) },
    { skip: entry.state === "unavailable" || !renderer || renderer.kind !== "data" },
  );
  const summary: PinSummary | null =
    currentData && renderer?.kind === "data" && renderer.pin
      ? renderer.pin(currentData.data, t)
      : null;

  const body = (
    <>
      <span className="text-sm text-typography-600">{summary?.label ?? entry.title}</span>
      {summary ? (
        <>
          <span className="font-secondary text-3xl font-semibold leading-none text-typography-900">
            {summary.value}
          </span>
          {summary.series && <Sparkline series={summary.series} />}
          {summary.change && (
            <span className={`text-sm font-medium ${TONE_CLASS[summary.change.tone]}`}>
              {summary.change.text}
            </span>
          )}
          {summary.caption && (
            <span className="text-xs text-typography-500">{summary.caption}</span>
          )}
        </>
      ) : (
        <span className="text-sm text-typography-500">
          {isFetching && !currentData
            ? t("statisticsLibrary.card.loading")
            : isError
              ? t("statisticsLibrary.card.couldNotLoad")
              : t("statisticsLibrary.pins.noData")}
        </span>
      )}
    </>
  );

  if (editing) {
    return (
      <div className="relative flex min-h-[150px] flex-col gap-2 rounded-xl border-2 border-dashed border-[#9db5dd] bg-white p-5 pr-12">
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("statisticsLibrary.pins.unpinAria", { title: entry.title })}
          className="absolute right-10 top-2 z-10 flex h-6 w-6 items-center justify-center rounded text-typography-500 hover:bg-background-secondary hover:text-typography-900"
          data-testid={`statistics-unpin-${item.id}`}
        >
          &times;
        </button>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[150px] w-full flex-col gap-2 rounded-xl border border-[#e3ded2] bg-white p-5 text-left hover:border-[#9db5dd]"
      data-testid={`statistics-pinned-${item.id}`}
    >
      {body}
    </button>
  );
};

/**
 * For you: the charts a person pinned from any tab, drawn compactly. Customise
 * arranges them and opens a library of what can be pinned.
 */
export const ForYouView: FunctionComponent<ForYouViewProps> = ({
  charts,
  views,
  pinKeys,
  onPinsChange,
  onOpen,
}) => {
  const { t } = useTranslation();
  const { user } = useUser();
  const [editing, setEditing] = useState(false);
  const byId = useMemo(() => new Map(charts.map(c => [c.id, c])), [charts]);

  const items = pinKeys
    .map(parseLayoutKey)
    .filter((item): item is LayoutItem => !!item && byId.has(item.id));
  const ids = items.map(item => item.id);
  const keys = items.map(item => item.key);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onPinsChange(arrayMove(keys, from, to));
  };

  // Every chart that can be pinned, listed once, under the tab it belongs on.
  const entries = views.flatMap(view =>
    viewChartIds(view)
      .map(id => byId.get(id))
      .filter(
        (chart): chart is StatisticsChartEntry =>
          !!chart &&
          chart.home === view.id &&
          CHART_RENDERERS[chart.id]?.kind === "data" &&
          !!(CHART_RENDERERS[chart.id] as { pin?: unknown }).pin,
      )
      .map(chart => ({ chart, group: view.id })),
  );
  const groups = views.map(view => ({
    key: view.id,
    label: t(`statisticsLibrary.tabs.${view.id}`),
  }));

  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? "";

  return (
    <div className="flex flex-col gap-6 py-4" data-testid="statistics-view-foryou">
      <h2
        className="font-secondary text-3xl font-medium text-typography-900"
        data-testid="statistics-greeting"
      >
        {firstName
          ? t(`statisticsLibrary.forYou.greeting.${part}`, { name: firstName })
          : t(`statisticsLibrary.forYou.greetingNoName.${part}`)}
      </h2>

      <section className="flex flex-col gap-3" aria-label={t("statisticsLibrary.pins.heading")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-semibold text-typography-900">
            {t("statisticsLibrary.pins.heading")}
          </h3>
          {editing ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="min-h-11 rounded border border-[#264d8e] bg-[#264d8e] px-4 text-sm font-medium text-white"
              data-testid="statistics-done"
            >
              {t("statisticsLibrary.done")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="min-h-11 rounded border border-[#264d8e] bg-white px-4 text-sm font-medium text-[#264d8e]"
              data-testid="statistics-customise"
            >
              {t("statisticsLibrary.customise")}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1">
            {items.length === 0 ? (
              <p
                className="rounded border border-dashed border-border-light p-6 text-sm text-typography-600"
                data-testid="statistics-pins-empty"
              >
                {t("statisticsLibrary.pins.empty")}
              </p>
            ) : editing ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={ids} strategy={rectSortingStrategy}>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map(item => (
                      <SortableMetricBlock key={item.id} id={item.id}>
                        <PinnedCard
                          item={item}
                          entry={byId.get(item.id) as StatisticsChartEntry}
                          editing
                          onOpen={() => onOpen(item)}
                          onRemove={() =>
                            onPinsChange(items.filter(i => i.id !== item.id).map(i => i.key))
                          }
                        />
                      </SortableMetricBlock>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map(item => (
                  <PinnedCard
                    key={item.id}
                    item={item}
                    entry={byId.get(item.id) as StatisticsChartEntry}
                    editing={false}
                    onOpen={() => onOpen(item)}
                    onRemove={() => undefined}
                  />
                ))}
              </div>
            )}
          </div>

          {editing && (
            <LibraryDrawer
              mode="pin"
              entries={entries}
              groups={groups}
              addedIds={ids}
              onAdd={id => {
                if (!ids.includes(id)) onPinsChange([...keys, layoutKey(id)]);
              }}
            />
          )}
        </div>
      </section>
    </div>
  );
};
