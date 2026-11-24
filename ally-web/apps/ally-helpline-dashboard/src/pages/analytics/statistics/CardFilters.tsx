import { FunctionComponent, useState } from "react";

import { useTranslation } from "react-i18next";

import type {
  StatisticsChartFilter,
  StatisticsFilterKey,
  StatisticsFilterValues,
  StatisticsScopeOption,
} from "@types";

import { ScopeChooser } from "./ScopeChooser";

interface CardFiltersProps {
  /** The filters this card offers, from the library. */
  filters: readonly StatisticsChartFilter[];
  values: StatisticsFilterValues;
  /** Filters the page supplies for the whole view (its course or learner); not offered on the card. */
  hidden?: readonly StatisticsFilterKey[];
  /** Names of the chosen course, simulation or learner, as the chart reported them. */
  labels: Partial<Record<StatisticsFilterKey, string>>;
  onChange: (values: StatisticsFilterValues, picked?: StatisticsScopeOption) => void;
}

/**
 * The filter row of a card: one chip per filter the card offers, saying what
 * it is set to ("All courses" or the name chosen). A chip opens a list to
 * choose from. Entirely driven by the filters the library declares, so a new
 * filter on a chart needs no change here.
 */
export const CardFilters: FunctionComponent<CardFiltersProps> = ({
  filters: declared,
  values,
  hidden = [],
  labels,
  onChange,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState<StatisticsFilterKey | null>(null);
  const [known, setKnown] = useState<Partial<Record<StatisticsFilterKey, string>>>({});

  const filters = declared.filter(f => !hidden.includes(f.key));
  if (filters.length === 0) return null;

  const nameOf = (key: StatisticsFilterKey) => known[key] ?? labels[key] ?? "…";

  return (
    <div className="flex flex-col gap-2" data-testid="statistics-card-filters">
      <div className="flex flex-wrap gap-2">
        {filters.map(filter => {
          const value = values[filter.key];
          return (
            <button
              key={filter.key}
              type="button"
              aria-expanded={open === filter.key}
              onClick={() => setOpen(current => (current === filter.key ? null : filter.key))}
              className={`inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border px-3 text-xs font-medium ${
                value
                  ? "border-[#264d8e] bg-[#dce6f6] text-[#1c3a6e]"
                  : "border-[#cfc9bb] bg-white text-typography-700"
              }`}
              data-testid={`statistics-filter-${filter.key}`}
            >
              <span className="truncate">
                {value
                  ? nameOf(filter.key)
                  : filter.required
                    ? t(`statisticsLibrary.filters.choose.${filter.key}`)
                    : t(`statisticsLibrary.filters.all.${filter.key}`)}
              </span>
              <span aria-hidden>▾</span>
            </button>
          );
        })}
      </div>
      {open && (
        <div
          className="rounded border border-border-light p-3"
          data-testid="statistics-filter-menu"
        >
          {!filters.find(f => f.key === open)?.required && values[open] && (
            <button
              type="button"
              onClick={() => {
                const next = { ...values };
                delete next[open];
                setOpen(null);
                onChange(next);
              }}
              className="mb-2 min-h-9 w-full rounded border border-border-light bg-white px-3 text-left text-sm text-typography-900"
              data-testid="statistics-filter-clear"
            >
              {t(`statisticsLibrary.filters.all.${open}`)}
            </button>
          )}
          <ScopeChooser
            kind={open}
            onCancel={() => setOpen(null)}
            onPick={option => {
              setKnown(current => ({ ...current, [open]: option.label }));
              setOpen(null);
              onChange({ ...values, [open]: option.id }, option);
            }}
          />
        </div>
      )}
    </div>
  );
};
