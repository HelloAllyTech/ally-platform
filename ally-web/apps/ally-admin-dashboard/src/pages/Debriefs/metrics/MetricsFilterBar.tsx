import React, { useEffect, useState } from "react";

import { CarbonDropdown as Dropdown } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { DebriefFilterOptions, DebriefMetricsFilter, DebriefPassRateSegment } from "@types";

import { TabControls } from "../../Analytics/tabControlsSlot";
import { FilterChip, FilterChips, MoreFiltersButton } from "../consoleRows";
import { groupLabel } from "./MetricsQualitySection";

/**
 * The pass rate's own filters, under its heading: the segments it used to list as breakdowns.
 * They narrow only the pass rate (the backend applies them to it alone), so they sit with it
 * rather than in the page's row. Same Carbon dropdowns as the page's filters; each offers only
 * values seen in the window, and a filter with nothing to offer is left out.
 */
export const SegmentBar: React.FC<{
  options: DebriefFilterOptions | undefined;
  segment: DebriefPassRateSegment;
  onSegment: (s: DebriefPassRateSegment) => void;
}> = ({ options, segment, onSegment }) => {
  const g = en.debriefs.metrics.quality.segments;
  const [moreOpen, setMoreOpen] = useState(
    () => !!(segment.sessionLength || segment.stepModel || segment.risk),
  );
  if (!options) return null;
  type Item = { id: string; label: string };
  type Def = {
    id: keyof DebriefPassRateSegment;
    label: string;
    choices: Item[];
    onChange: (v: string) => void;
    width?: string;
  };
  const set = (patch: Partial<DebriefPassRateSegment>) => onSegment({ ...segment, ...patch });
  const defs: Def[] = [
    {
      id: "skill",
      label: g.skill,
      choices: (options.skills ?? []).map(x => ({ id: x, label: x })),
      onChange: v => set({ skill: v || undefined }),
    },
    {
      id: "scenarioId",
      label: g.scenario,
      choices: (options.scenarios ?? []).map(x => ({ id: String(x.id), label: x.name })),
      onChange: v => set({ scenarioId: v ? Number(v) : undefined }),
    },
    {
      id: "courseId",
      label: g.course,
      choices: (options.courses ?? []).map(x => ({ id: String(x.id), label: x.name })),
      onChange: v => set({ courseId: v ? Number(v) : undefined }),
    },
    {
      id: "sessionLength",
      label: g.sessionLength,
      choices: (options.sessionLengths ?? []).map(x => ({ id: x, label: g.length(x) })),
      onChange: v => set({ sessionLength: v || undefined }),
      width: "sm:w-48",
    },
    {
      id: "stepModel",
      label: g.stepModel,
      choices: (options.stepModels ?? []).map(x => ({ id: x, label: groupLabel(x) })),
      onChange: v => set({ stepModel: v || undefined }),
      width: "sm:w-64",
    },
    {
      id: "risk",
      label: g.risk,
      choices: (options.risks ?? []).map(x => ({ id: x, label: g.risks[x] ?? x })),
      onChange: v => set({ risk: (v || undefined) as DebriefPassRateSegment["risk"] }),
      width: "sm:w-64",
    },
  ];
  const valueOf = (d: Def) => {
    const v = segment[d.id];
    return v === undefined ? "" : String(v);
  };
  // Keep a set filter visible even if its value left the window, so it can be cleared.
  const offered = defs.filter(d => d.choices.length > 0 || valueOf(d));
  const pick = (d: Def) => {
    const items: Item[] = [{ id: "", label: g.allOf[d.id] }, ...d.choices];
    return (
      <div
        className={`w-full min-w-0 sm:shrink ${d.width ?? "sm:w-56"}`}
        key={d.id}
        data-testid={`metrics-segment-${d.id}`}
      >
        <Dropdown
          id={`debrief-pass-rate-${d.id}`}
          size="md"
          titleText={d.label}
          hideLabel
          label={d.label}
          items={items}
          selectedItem={items.find(i => i.id === valueOf(d)) ?? items[0]}
          itemToString={(item: Item | null) => item?.label ?? ""}
          onChange={({ selectedItem }: { selectedItem: Item | null }) =>
            d.onChange(selectedItem?.id ?? "")
          }
        />
      </div>
    );
  };
  // Skill, scenario and course stay in the row; the rest sit behind More filters.
  const main = offered.filter(d => ["skill", "scenarioId", "courseId"].includes(d.id));
  const more = offered.filter(d => !main.includes(d));
  const chips: FilterChip[] = offered
    .filter(d => valueOf(d))
    .map(d => ({
      id: d.id,
      label: `${d.label}: ${d.choices.find(c => c.id === valueOf(d))?.label ?? valueOf(d)}`,
      onRemove: () => {
        const next = { ...segment };
        delete next[d.id];
        onSegment(next);
      },
    }));
  return (
    <div className="flex flex-col gap-2" data-testid="metrics-segments">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-nowrap sm:items-end">
        {main.map(pick)}
        {more.length > 0 && (
          <MoreFiltersButton
            open={moreOpen}
            onToggle={() => setMoreOpen(o => !o)}
            active={more.filter(d => valueOf(d)).length}
            controls="metrics-segment-more"
            testId="metrics-segment-more-button"
          />
        )}
      </div>
      {moreOpen && more.length > 0 && (
        <div
          id="metrics-segment-more"
          className="flex flex-col gap-3 bg-neutral-50 p-3 sm:flex-row sm:flex-nowrap sm:items-end"
          data-testid="metrics-segment-more"
        >
          {more.map(pick)}
        </div>
      )}
      <FilterChips chips={chips} onClearAll={() => onSegment({})} testId="metrics-segment-chips" />
      {chips.length > 0 && <p className="text-xs text-typography-700">{g.note}</p>}
    </div>
  );
};

/**
 * Below this width the Analytics page's filter row cannot hold the time range plus three
 * dropdowns and More filters on one line (it needs ~920px of content width, ~1085px of
 * viewport), so Debrief type moves behind More filters. Only this tab's controls change.
 */
export const NARROW_FILTERS = "(max-width: 1179px)";

export const useMedia = (query: string): boolean => {
  const [matches, setMatches] = useState(() => Boolean(window.matchMedia?.(query)?.matches));
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return undefined;
    const on = () => setMatches(list.matches);
    on();
    list.addEventListener?.("change", on);
    return () => list.removeEventListener?.("change", on);
  }, [query]);
  return matches;
};

/**
 * The six filters, applied to every live metric on the page. They render into the Analytics page's
 * shared filter row (beside its time range), as Carbon dropdowns like every other tab's filters.
 * Only values that exist in the window are offered; the first item of each means "all".
 */
export const FilterBar: React.FC<{
  options: DebriefFilterOptions | undefined;
  filter: DebriefMetricsFilter;
  onFilter: (f: DebriefMetricsFilter) => void;
}> = ({ options, filter, onFilter }) => {
  const s = en.debriefs.metrics.filters;
  const narrow = useMedia(NARROW_FILTERS);
  const [moreOpen, setMoreOpen] = useState(
    () =>
      filter.learnerLevel !== undefined ||
      filter.releaseVersion !== undefined ||
      filter.judgeVersion !== undefined ||
      (Boolean(window.matchMedia?.(NARROW_FILTERS)?.matches) && filter.recipe !== undefined),
  );
  if (!options) return null;
  const set = (patch: Partial<DebriefMetricsFilter>) => onFilter({ ...filter, ...patch });
  type Item = { id: string; label: string };
  type Def = {
    id: string;
    key: keyof DebriefMetricsFilter;
    label: string;
    choices: Item[];
    onChange: (v: string) => void;
    width?: string;
  };
  const defs: Def[] = [
    {
      id: "organisation",
      key: "tenantId",
      label: s.organisation,
      choices: options.organisations.map(o => ({ id: o.id, label: o.name })),
      onChange: v => set({ tenantId: v || undefined }),
      width: "sm:w-52",
    },
    {
      id: "language",
      key: "language",
      label: s.language,
      choices: options.languages.map(l => ({ id: l, label: l })),
      onChange: v => set({ language: v || undefined }),
    },
    {
      id: "recipe",
      key: "recipe",
      label: s.recipe,
      choices: options.recipes.map(r => ({ id: r, label: s.recipes[r] ?? r })),
      onChange: v => set({ recipe: v || undefined }),
    },
    {
      id: "learnerLevel",
      key: "learnerLevel",
      label: s.learnerLevel,
      choices: options.learnerLevels.map(l => ({ id: l, label: s.levels[l] ?? l })),
      onChange: v => set({ learnerLevel: v || undefined }),
      width: "sm:w-56",
    },
    {
      id: "releaseVersion",
      key: "releaseVersion",
      label: s.releaseVersion,
      choices: options.releaseVersions.map(v => ({ id: String(v), label: s.release(v) })),
      onChange: v => set({ releaseVersion: v ? Number(v) : undefined }),
      width: "sm:w-40",
    },
    {
      id: "judgeVersion",
      key: "judgeVersion",
      label: s.judgeVersion,
      choices: options.judgeVersions.map(v => ({ id: v, label: v })),
      onChange: v => set({ judgeVersion: v || undefined }),
      width: "sm:w-56",
    },
  ];
  const valueOf = (d: Def) => {
    const v = filter[d.key];
    return v === undefined ? "" : String(v);
  };
  const pick = (d: Def) => {
    const items: Item[] = [{ id: "", label: s.allOf[d.id] ?? s.all }, ...d.choices];
    return (
      <div
        className={`w-full min-w-0 sm:shrink ${d.width ?? "sm:w-44"}`}
        key={d.id}
        data-testid={`metrics-filter-${d.id}`}
      >
        <Dropdown
          id={`debrief-metrics-${d.id}`}
          size="md"
          titleText={d.label}
          hideLabel
          label={d.label}
          items={items}
          selectedItem={items.find(i => i.id === valueOf(d)) ?? items[0]}
          itemToString={(item: Item | null) => item?.label ?? ""}
          onChange={({ selectedItem }: { selectedItem: Item | null }) =>
            d.onChange(selectedItem?.id ?? "")
          }
        />
      </div>
    );
  };
  // Organisation, language and debrief type sit in the page's filter row beside the time range;
  // learner level, release and judge version sit behind More filters, which counts the set ones.
  // Below 1180px debrief type joins them, so the row never wraps (the time range used to sit
  // alone on the first line between ~1056 and ~1108px).
  const inRow = narrow ? 2 : 3;
  const main = defs.slice(0, inRow);
  const more = defs.slice(inRow);
  const chips: FilterChip[] = defs
    .filter(d => valueOf(d))
    .map(d => ({
      id: d.id,
      label: `${d.label}: ${d.choices.find(c => c.id === valueOf(d))?.label ?? valueOf(d)}`,
      onRemove: () => {
        const next = { ...filter };
        delete next[d.key];
        onFilter(next);
      },
    }));
  return (
    <>
      <TabControls>
        {main.map(pick)}
        <MoreFiltersButton
          open={moreOpen}
          onToggle={() => setMoreOpen(o => !o)}
          active={more.filter(d => valueOf(d)).length}
          controls="metrics-filter-more"
          testId="metrics-filter-more-button"
        />
      </TabControls>
      {moreOpen && (
        <div
          id="metrics-filter-more"
          className="flex flex-col gap-3 bg-neutral-50 p-3 sm:flex-row sm:flex-nowrap sm:items-end"
          data-testid="metrics-filter-more"
        >
          {more.map(pick)}
        </div>
      )}
      <FilterChips chips={chips} onClearAll={() => onFilter({})} testId="metrics-filter-chips" />
    </>
  );
};
