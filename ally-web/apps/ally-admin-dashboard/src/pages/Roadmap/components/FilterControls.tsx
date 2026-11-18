import React, { useMemo, useRef, useState } from "react";

import { Close, Filter } from "@icons";
import { AnimatePresence, motion } from "framer-motion";

import { Button, Checkbox } from "@ally-ui-mono/ui-shared";
import {
  useGetRoadmapFacetsQuery,
  useGetRoadmapItemsQuery,
  useGetRoadmapProductGoalsQuery,
} from "@api";
import { FilterDropdown } from "@components/filters";
import type { FilterSectionConfig } from "@components/types";
import { en } from "@constants";
import type { RoadmapItemRow, RoadmapItemsResponse } from "@types";

import { BottomSheet } from "./BottomSheet";
import { motionTransition, popVariants, useReducedMotionPreference } from "../../../motion";
import {
  FLAG_FILTER_KEYS,
  FilterChip,
  LIST_FILTER_KEYS,
  QueueFilters,
  QueueState,
  activeFilterCount,
  filterChips,
  normaliseFilters,
  toItemsQuery,
} from "../utils/queueState";

/** What FilterDropdown edits: one string list per section. Flags and month ride as lists too. */
type FilterDropdownState = Record<string, string[]>;

const STAGE_OPTIONS = ["backlog", "being_built", "shipped", "declined"];
const SERVICE_OPTIONS = ["be", "ai", "learn", "frontend", "mobile"];

/** The next 6 and the last 6 months, newest first, as YYYY-MM. */
export const monthOptions = (now: Date = new Date()): { value: string; label: string }[] => {
  const out: { value: string; label: string }[] = [];
  for (let delta = 6; delta >= -6; delta -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + delta, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({
      value,
      label: d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }),
    });
  }
  return out;
};

export interface FilterOptions {
  sections: FilterSectionConfig<FilterDropdownState>[];
  /** value → label per section, for chips. */
  labels: Record<string, Record<string, string>>;
}

/**
 * The Filter menu's sections (§4.3): stage, review state, goal, author, lead, service touched,
 * starred / open question / voted by me, planned month. Every section is ALWAYS present, even before
 * its options load, so FilterDropdown never drops a key from its result (the house-pattern trap).
 * People come from the facets plus the rows on screen, by name, never by id alone.
 */
export const useFilterOptions = (
  rows: RoadmapItemRow[],
  /** On a stage's own view (To do, Building ...) the stage is already chosen: no Stage section. */
  hideStage = false,
): FilterOptions => {
  const { data: goals } = useGetRoadmapProductGoalsQuery();
  const { data: facets } = useGetRoadmapFacetsQuery();
  return useMemo(() => {
    const f = en.roadmapV2.filter;
    const stages = en.roadmapV2.stages;
    const authors = new Map<string, string>();
    (Array.isArray(facets?.creators) ? facets!.creators : []).forEach(c =>
      authors.set(String(c.id), c.name),
    );
    const leads = new Map<string, string>();
    rows.forEach(row => {
      if (row.author) authors.set(String(row.author.id), row.author.name);
      if (row.lead) leads.set(String(row.lead.id), row.lead.name);
    });
    const goalMap = new Map<string, string>();
    (Array.isArray(goals) ? goals : []).forEach(g => goalMap.set(g.id, g.name));
    rows.forEach(row => row.goal && goalMap.set(row.goal.id, row.goal.name));

    const toOptions = (map: Map<string, string>) =>
      [...map.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));

    const sections: FilterSectionConfig<FilterDropdownState>[] = [
      ...(hideStage
        ? []
        : [
            {
              id: "stage",
              label: f.stage,
              options: STAGE_OPTIONS.map(v => ({ value: v, label: stages[v] })),
            },
          ]),
      { id: "goal", label: f.goal, options: toOptions(goalMap) },
      { id: "author", label: f.author, options: toOptions(authors) },
      { id: "lead", label: f.lead, options: toOptions(leads) },
      {
        id: "service",
        label: f.service,
        options: SERVICE_OPTIONS.map(v => ({ value: v, label: f.services[v] })),
      },
      {
        id: "flags",
        label: f.flags,
        options: [
          { value: "starred", label: f.starred },
          { value: "openQuestion", label: f.openQuestion },
          { value: "votedByMe", label: f.votedByMe },
          { value: "ledByMe", label: f.ledByMe },
          { value: "wroteByMe", label: f.wroteByMe },
          { value: "needsYou", label: f.needsYou },
        ],
      },
      { id: "month", label: f.month, options: monthOptions() },
    ];
    const labels: Record<string, Record<string, string>> = {};
    sections.forEach(section => {
      labels[String(section.id)] = Object.fromEntries(section.options.map(o => [o.value, o.label]));
    });
    return { sections, labels };
  }, [goals, facets, rows, hideStage]);
};

/** QueueFilters → the dropdown's shape. */
export const toDropdownState = (filters: QueueFilters): FilterDropdownState => {
  const clean = normaliseFilters(filters);
  const state: FilterDropdownState = {};
  for (const key of LIST_FILTER_KEYS) state[key] = clean[key] ?? [];
  state.flags = FLAG_FILTER_KEYS.filter(key => clean[key]);
  state.month = clean.month ? [clean.month] : [];
  return state;
};

/**
 * The dropdown's result → QueueFilters, merged key by key: a key the result lacks is "no opinion"
 * and keeps its current value; `[]` clears it. Month is single-valued, so the latest month wins.
 */
export const fromDropdownState = (
  current: QueueFilters,
  result: Partial<FilterDropdownState>,
): QueueFilters => {
  const next: QueueFilters = { ...normaliseFilters(current) };
  for (const key of LIST_FILTER_KEYS) {
    if (Array.isArray(result[key])) next[key] = result[key];
  }
  if (Array.isArray(result.flags)) {
    for (const key of FLAG_FILTER_KEYS) next[key] = result.flags.includes(key);
  }
  if (Array.isArray(result.month)) {
    const months = [...result.month].sort();
    next.month = months.length ? months[months.length - 1] : undefined;
  }
  return normaliseFilters(next);
};

/** One chip's text: "Stage: Planning", or the flag's own name. */
export const chipText = (chip: FilterChip, labels: FilterOptions["labels"]): string => {
  const f = en.roadmapV2.filter;
  switch (chip.key) {
    case "q":
      return f.chipText(f.search, chip.value ?? "");
    case "starred":
    case "openQuestion":
    case "votedByMe":
    case "ledByMe":
    case "wroteByMe":
    case "needsYou":
      return f[chip.key];
    default: {
      const group = {
        stage: f.stage,
        review: f.review,
        goal: f.goal,
        author: f.author,
        lead: f.lead,
        service: f.service,
        month: f.month,
      }[chip.key];
      const value = labels[chip.key]?.[chip.value ?? ""] ?? chip.value ?? "";
      return f.chipText(group, value);
    }
  }
};

/** Desktop: the Filter ▾ button and its sectioned popover (the admin's list-filter pattern). */
export const FilterButton: React.FC<{
  filters: QueueFilters;
  options: FilterOptions;
  onChange: (filters: QueueFilters) => void;
}> = ({ filters, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const count = activeFilterCount(filters);
  const f = en.roadmapV2.filter;
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="inline-flex min-h-8 items-center gap-1.5 rounded border border-border-light px-3 text-sm text-typography-primary hover:bg-neutral-50"
      >
        <Filter size={16} aria-hidden />
        {count ? f.buttonCount(count) : f.button}
      </button>
      <FilterDropdown<FilterDropdownState>
        isOpen={open}
        onClose={() => setOpen(false)}
        sections={options.sections}
        currentFilters={toDropdownState(filters)}
        anchorRect={ref.current?.getBoundingClientRect() ?? null}
        onApplyFilters={result => {
          onChange(fromDropdownState(filters, result));
          setOpen(false);
        }}
      />
    </>
  );
};

/** Sum of rows a response holds: `total` for flat views, the section rows otherwise. */
const resultCount = (data: RoadmapItemsResponse | undefined): number | null => {
  if (!data) return null;
  if ("rows" in data) return typeof data.total === "number" ? data.total : data.rows.length;
  return Object.values(data.sections ?? {}).reduce(
    (sum, section) => sum + (Array.isArray(section) ? section.length : 0),
    0,
  );
};

/**
 * Phone and tablet: filter and sort in one bottom sheet with large toggles (§4.17). Edits are a
 * draft until Apply, which says how many ideas it will show ("Show 12 ideas").
 */
export const FilterSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  state: QueueState;
  options: FilterOptions;
  onApply: (filters: QueueFilters) => void;
  sortControl: React.ReactNode;
}> = ({ open, onClose, state, options, onApply, sortControl }) => {
  const f = en.roadmapV2.filter;
  const [draft, setDraft] = useState<FilterDropdownState>(() => toDropdownState(state.filters));
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setDraft(toDropdownState(state.filters));
  }
  const draftFilters = fromDropdownState(state.filters, draft);
  const { data } = useGetRoadmapItemsQuery(toItemsQuery({ ...state, filters: draftFilters }), {
    skip: !open,
  });
  const count = resultCount(data);

  const toggle = (section: string, value: string, checked: boolean) =>
    setDraft(prev => {
      const current = prev[section] ?? [];
      const next = checked ? [...current, value] : current.filter(v => v !== value);
      // Month is one value: picking a month replaces the last.
      return { ...prev, [section]: section === "month" && checked ? [value] : next };
    });

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={en.roadmapV2.mobile.filterSort}
      closeLabel={en.roadmapV2.mobile.close}
      full
      footer={
        <div className="flex gap-2">
          <Button kind="secondary" className="flex-1" onClick={() => setDraft(toDropdownState({}))}>
            {f.clear}
          </Button>
          <Button
            kind="primary"
            className="flex-1"
            onClick={() => {
              onApply(draftFilters);
              onClose();
            }}
          >
            {count === null ? f.showResults : f.showCount(count)}
          </Button>
        </div>
      }
    >
      <div className="mb-4">{sortControl}</div>
      {options.sections.map(section => {
        const id = String(section.id);
        if (section.options.length === 0) return null;
        return (
          <fieldset key={id} className="mb-4">
            <legend className="mb-1 text-sm font-semibold text-typography-primary">
              {section.label}
            </legend>
            <div className="flex flex-col">
              {section.options.map(option => (
                <div key={option.value} className="flex min-h-11 items-center">
                  <Checkbox
                    id={`roadmap-filter-${id}-${option.value}`}
                    labelText={option.label}
                    checked={(draft[id] ?? []).includes(option.value)}
                    onChange={(_event: unknown, { checked }: { checked: boolean }) =>
                      toggle(id, option.value, checked)
                    }
                  />
                </div>
              ))}
            </div>
          </fieldset>
        );
      })}
    </BottomSheet>
  );
};

/** Active filters as removable chips under the view bar; they pop in and shrink out (§4.18). */
export const FilterChips: React.FC<{
  filters: QueueFilters;
  labels: FilterOptions["labels"];
  onRemove: (chip: FilterChip) => void;
  onClear: () => void;
}> = ({ filters, labels, onRemove, onClear }) => {
  const reduced = useReducedMotionPreference();
  const chips = filterChips(filters);
  const f = en.roadmapV2.filter;
  if (chips.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0" aria-label={f.title}>
      <AnimatePresence initial={false}>
        {chips.map(chip => {
          const text = chipText(chip, labels);
          return (
            <motion.li
              key={`${chip.key}:${chip.value ?? ""}`}
              layout={reduced ? false : "position"}
              {...popVariants(reduced)}
              transition={motionTransition("fast", "productive", reduced)}
              className="inline-flex items-center gap-1 rounded-[20px] border border-border-light py-0.5 pl-2.5 pr-1 text-xs text-typography-primary"
            >
              {text}
              <button
                type="button"
                aria-label={f.removeChip(text)}
                onClick={() => onRemove(chip)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-neutral-100"
              >
                <Close size={12} aria-hidden />
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
      <li>
        <button
          type="button"
          onClick={onClear}
          className="min-h-6 px-1 text-xs text-primary-700 underline-offset-2 hover:underline"
        >
          {f.clear}
        </button>
      </li>
    </ul>
  );
};
