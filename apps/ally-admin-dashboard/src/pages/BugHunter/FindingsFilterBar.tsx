import { FC, ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";

import { Button, Search } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { BugFindingSeverity, BugFindingSource } from "@types";

import { BUG_FINDING_SEVERITY_LABELS, BUG_FINDING_SOURCE_LABELS } from "./bugFindingLabels";
import { activeFacetCount, AgeFilter, FindingsFilters } from "./findingsView";

/**
 * The bugs table's filter controls: a search box, one button that opens every
 * facet, and a line of pills saying what is currently on.
 *
 * ## Why one button and not eight controls
 *
 * The facets used to be `<Select>`s laid out beside the search box, and each
 * new one cost horizontal space on a row that was already wrapping. Three of
 * them fitted; the five this rebuild adds would not have, and a filter row that
 * wraps to three lines pushes the table itself below the fold — which is the
 * exact failure the profile card was shortened to fix.
 *
 * So the *core* control stays permanently visible (search, plus the tabs
 * directly above this) and everything else is one click away, with a
 * count on the button so a reader can never be filtering without knowing it.
 * That is Stacks' *Progressive Disclosure and Contextual Relevance in Agent
 * Interfaces* — show core capabilities first, reveal the rest progressively,
 * and use grouping rather than density to keep the surface navigable.
 *
 * Status and roadmap stage left the panel on 2026-10-13: the tabs above are
 * status, and stage is derived from it, so both sections were a second way to
 * ask a question the tabs already answer.
 *
 * ## The pills are the reason the panel can be hidden
 *
 * Hiding controls behind a button is only safe if the *state* stays visible: a
 * collapsed panel with three active facets inside it is a table silently
 * showing a third of its rows, which reads as data loss. Each pill names one
 * value and removes just that value, so undoing one facet never costs the other
 * two — which is what a "Clear filters" button on its own always did.
 *
 * ## Every option is one that exists
 *
 * The sections are built from what the loaded window actually holds
 * (`sourcesInWindow` and friends), not from the enums. A facet listing every
 * value the enum can hold when the window holds three is a list of options
 * that filter to nothing, and the reader has to click one to find out which. A facet with fewer than two values is dropped entirely —
 * there is nothing to choose between.
 */

/** One toggleable value inside a section. */
interface FacetOption<T extends string> {
  value: T;
  label: string;
  /** How many rows in the window carry this value, shown beside the label. */
  count: number;
}

interface FacetSectionProps<T extends string> {
  title: string;
  options: FacetOption<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
}

/**
 * One multi-select section: a heading, a checkbox per value, and a clear link
 * that appears only once something in it is ticked.
 *
 * Instant-apply, with no "Apply" button. That is a deliberate departure from
 * the admin's shared `FilterDropdown`, whose two-panel apply-gated flow suits a
 * server-filtered list where each change costs a request. Everything here is
 * client-side over a window already in memory, and every other control on this
 * page (tabs, search) writes the URL on the gesture — an apply step
 * would make the facets the one place where clicking a thing does not do the
 * thing.
 */
function FacetSection<T extends string>({
  title,
  options,
  selected,
  onChange,
}: FacetSectionProps<T>): ReactNode {
  if (options.length < 2) return null;

  const toggle = (value: T) =>
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);

  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-2 px-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-typography-500">
          {title}
        </p>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[11px] text-primary-600 hover:underline cursor-pointer"
          >
            {en.bugHunter.filterSectionClear}
          </button>
        )}
      </div>
      <div className="mt-1">
        {options.map(option => (
          <label
            key={option.value}
            className="flex items-center gap-2 px-3 py-2 text-sm text-typography-900 hover:bg-neutral-50 cursor-pointer md:py-1"
          >
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => toggle(option.value)}
              className="w-4 h-4 text-black border-border-light rounded focus:ring-black cursor-pointer"
            />
            <span className="flex-1 min-w-0 truncate">{option.label}</span>
            <span className="tabular-nums text-xs text-typography-500">{option.count}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** The age bands, as radios — unlike the facets above these are mutually exclusive. */
const AgeSection: FC<{
  value: AgeFilter;
  onChange: (age: AgeFilter) => void;
  counts: Record<AgeFilter, number>;
}> = ({ value, onChange, counts }) => {
  const options: { value: AgeFilter; label: string }[] = [
    { value: "all", label: en.bugHunter.filterAgeAll },
    { value: "day", label: en.bugHunter.filterAgeDay },
    { value: "week", label: en.bugHunter.filterAgeWeek },
    { value: "stale", label: en.bugHunter.filterAgeStale },
    { value: "ancient", label: en.bugHunter.filterAgeAncient },
  ];

  return (
    <div className="py-2">
      <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-typography-500">
        {en.bugHunter.filterSectionAge}
      </p>
      <div className="mt-1">
        {options.map(option => (
          <label
            key={option.value}
            className="flex items-center gap-2 px-3 py-2 text-sm text-typography-900 hover:bg-neutral-50 cursor-pointer md:py-1"
          >
            <input
              type="radio"
              name="bug-findings-age"
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="w-4 h-4 text-black border-border-light focus:ring-black cursor-pointer"
            />
            <span className="flex-1 min-w-0 truncate">{option.label}</span>
            <span className="tabular-nums text-xs text-typography-500">{counts[option.value]}</span>
          </label>
        ))}
      </div>
    </div>
  );
};

/** One active facet value, as a removable pill. */
const FilterPill: FC<{ label: string; onRemove: () => void }> = ({ label, onRemove }) => (
  <span className="inline-flex items-center gap-1 rounded-full border border-border-light bg-neutral-50 pl-2.5 pr-1 py-0.5 text-xs text-typography-800">
    {label}
    <button
      type="button"
      onClick={onRemove}
      aria-label={en.bugHunter.filterPillRemove.replace("{label}", label)}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-typography-500 hover:bg-neutral-200 hover:text-typography-900 cursor-pointer md:h-4 md:w-4"
    >
      <span aria-hidden="true">×</span>
    </button>
  </span>
);

export interface FindingsFilterBarProps {
  filters: FindingsFilters;
  /** The values actually present in the loaded window, so no facet offers a dead option. */
  available: {
    repos: string[];
    severities: BugFindingSeverity[];
    sources: BugFindingSource[];
  };
  /** How many rows in the window carry each value — the numbers beside the checkboxes. */
  counts: {
    repos: Record<string, number>;
    severities: Record<string, number>;
    sources: Record<string, number>;
    ages: Record<AgeFilter, number>;
    duplicates: number;
  };
  onSearch: (search: string) => void;
  onRepos: (repos: string[]) => void;
  onSeverities: (severities: BugFindingSeverity[]) => void;
  onSources: (sources: BugFindingSource[]) => void;
  onAge: (age: AgeFilter) => void;
  onDuplicatesOnly: (only: boolean) => void;
  onClearAll: () => void;
  /** So `/` can focus the search box from the table's keydown handler. */
  searchRef?: React.RefObject<HTMLDivElement>;
}

export const FindingsFilterBar: FC<FindingsFilterBarProps> = ({
  filters,
  available,
  counts,
  onSearch,
  onRepos,
  onSeverities,
  onSources,
  onAge,
  onDuplicatesOnly,
  onClearAll,
  searchRef,
}) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /**
   * How many facet values are on — the button's badge, and whether the pill
   * row has anything to say.
   *
   * The pill row is about the *panel*: it shows what the collapsed panel is
   * hiding. It used to render for search and the bucket chip too, neither of
   * which has a pill, so typing one letter produced a row holding nothing but
   * a "Clear filters" button. The search box clears itself with its own ×, and
   * the tab is where you are rather than a filter you set.
   */
  const facetCount = activeFacetCount(filters);

  const close = useCallback(() => {
    setOpen(false);
    // Focus goes back to the button that opened the panel rather than to the
    // document, so a keyboard reader is not dropped at the top of the page.
    triggerRef.current?.focus();
  }, []);

  // Escape closes, and so does a click anywhere outside. Both are registered
  // only while the panel is open — a always-on document listener that does
  // nothing 99% of the time is a keystroke tax on the whole page, and this one
  // would fight the table's own `j`/`k` handler for Escape.
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, close]);

  const label = <T extends string>(map: Record<string, string>, value: T): string =>
    map[value] ?? value;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[180px] max-w-md sm:min-w-[220px]" ref={searchRef}>
          <Search
            id="bug-findings-search"
            size="sm"
            labelText={en.bugHunter.searchLabel}
            placeholder={en.bugHunter.searchPlaceholder}
            value={filters.search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSearch(e.target.value)}
            onClear={() => onSearch("")}
          />
        </div>

        <div className="relative" ref={wrapperRef}>
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-controls={open ? panelId : undefined}
            onClick={() => setOpen(value => !value)}
            className={`inline-flex items-center gap-1.5 rounded border px-3 py-2 text-xs font-medium cursor-pointer transition-colors md:py-1.5 ${
              facetCount > 0
                ? "border-primary-300 bg-primary-50 text-primary-700"
                : "border-border-light bg-white text-typography-800 hover:bg-neutral-50"
            }`}
          >
            {en.bugHunter.filtersButton}
            {facetCount > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-semibold text-white tabular-nums">
                {facetCount}
              </span>
            )}
            <span aria-hidden="true" className="text-[9px] text-typography-500">
              ▼
            </span>
          </button>

          {open && (
            <div
              id={panelId}
              role="dialog"
              aria-label={en.bugHunter.filtersPanelLabel}
              // `right-0` rather than `left-0`: this button sits at the right
              // end of its row on a wide viewport, and a left-anchored panel
              // would open off the edge of the page.
              className="absolute right-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] max-h-[26rem] overflow-y-auto custom-scrollbar rounded-lg border border-border-light bg-white shadow-lg divide-y divide-border-light"
            >
              <FacetSection
                title={en.bugHunter.filterSectionRepo}
                options={available.repos.map(repo => ({
                  value: repo,
                  label: repo,
                  count: counts.repos[repo] ?? 0,
                }))}
                selected={filters.repos}
                onChange={onRepos}
              />
              <FacetSection
                title={en.bugHunter.filterSectionSeverity}
                options={available.severities.map(severity => ({
                  value: severity,
                  label: label(BUG_FINDING_SEVERITY_LABELS, severity),
                  count: counts.severities[severity] ?? 0,
                }))}
                selected={filters.severities}
                onChange={onSeverities}
              />
              <FacetSection
                title={en.bugHunter.filterSectionSource}
                options={available.sources.map(source => ({
                  value: source,
                  label: label(BUG_FINDING_SOURCE_LABELS, source),
                  count: counts.sources[source] ?? 0,
                }))}
                selected={filters.sources}
                onChange={onSources}
              />
              <AgeSection value={filters.age} onChange={onAge} counts={counts.ages} />

              {/* Only offered when the window actually holds a duplicate — a
                  toggle that can only ever empty the table is a trap. */}
              {counts.duplicates > 0 && (
                <div className="py-2">
                  <label className="flex items-center gap-2 px-3 py-2 text-sm text-typography-900 hover:bg-neutral-50 cursor-pointer md:py-1">
                    <input
                      type="checkbox"
                      checked={filters.duplicatesOnly}
                      onChange={() => onDuplicatesOnly(!filters.duplicatesOnly)}
                      className="w-4 h-4 text-black border-border-light rounded focus:ring-black cursor-pointer"
                    />
                    <span className="flex-1 min-w-0">{en.bugHunter.filterDuplicatesOnly}</span>
                    <span className="tabular-nums text-xs text-typography-500">
                      {counts.duplicates}
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* The state the collapsed panel would otherwise hide. Absent entirely
          when no facet is on, so a clean table has no chrome under its search
          box. */}
      {facetCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.repos.map(repo => (
            <FilterPill
              key={`repo-${repo}`}
              label={repo}
              onRemove={() => onRepos(filters.repos.filter(v => v !== repo))}
            />
          ))}
          {filters.severities.map(severity => (
            <FilterPill
              key={`sev-${severity}`}
              label={label(BUG_FINDING_SEVERITY_LABELS, severity)}
              onRemove={() => onSeverities(filters.severities.filter(v => v !== severity))}
            />
          ))}
          {filters.sources.map(source => (
            <FilterPill
              key={`src-${source}`}
              label={label(BUG_FINDING_SOURCE_LABELS, source)}
              onRemove={() => onSources(filters.sources.filter(v => v !== source))}
            />
          ))}
          {filters.age !== "all" && (
            <FilterPill
              label={
                {
                  day: en.bugHunter.filterAgeDay,
                  week: en.bugHunter.filterAgeWeek,
                  stale: en.bugHunter.filterAgeStale,
                  ancient: en.bugHunter.filterAgeAncient,
                }[filters.age]
              }
              onRemove={() => onAge("all")}
            />
          )}
          {filters.duplicatesOnly && (
            <FilterPill
              label={en.bugHunter.filterDuplicatesOnly}
              onRemove={() => onDuplicatesOnly(false)}
            />
          )}
          <Button size="sm" kind="ghost" onClick={onClearAll}>
            {en.bugHunter.clearFilters}
          </Button>
        </div>
      )}
    </div>
  );
};
