import { FunctionComponent, useEffect, useState } from "react";

import { useTranslation } from "react-i18next";

import { useGetStatisticsScopeOptionsQuery } from "@api";
import type { StatisticsScopeKind, StatisticsScopeOption } from "@types";

interface ScopeChooserProps {
  kind: StatisticsScopeKind;
  onPick: (option: StatisticsScopeOption) => void;
  onCancel: () => void;
}

/**
 * Chooses the course, simulation or learner a chart is drawn for: a search box
 * and the matching names. Used when a chart is added from the library and when
 * the choice on a card is changed.
 */
export const ScopeChooser: FunctionComponent<ScopeChooserProps> = ({ kind, onPick, onCancel }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");

  // Wait for a pause in typing before asking the server again.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching, isError } = useGetStatisticsScopeOptionsQuery({
    kind,
    search: search || undefined,
  });

  return (
    <div className="flex flex-col gap-3" data-testid="statistics-scope-chooser">
      <div className="flex items-center gap-2">
        <input
          type="search"
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label={t(`statisticsLibrary.scope.search.${kind}`)}
          placeholder={t(`statisticsLibrary.scope.search.${kind}`)}
          className="min-h-11 flex-1 rounded border border-border-light px-3 text-sm text-typography-900"
          data-testid="statistics-scope-search"
        />
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded border border-border-light bg-white px-3 text-sm text-typography-900"
          data-testid="statistics-scope-cancel"
        >
          {t("statisticsLibrary.scope.cancel")}
        </button>
      </div>
      {isError ? (
        <p className="text-sm text-typography-600">{t("statisticsLibrary.scope.error")}</p>
      ) : isFetching && !data ? (
        <p className="text-sm text-typography-600" role="status">
          {t("statisticsLibrary.scope.loading")}
        </p>
      ) : data && data.length === 0 ? (
        <p className="text-sm text-typography-600">{t(`statisticsLibrary.scope.none.${kind}`)}</p>
      ) : (
        <ul className="flex max-h-72 flex-col overflow-y-auto" data-testid="statistics-scope-list">
          {data?.map(option => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => onPick(option)}
                className="min-h-11 w-full border-b border-border-light px-1 py-2 text-left text-sm text-typography-900 hover:bg-background-secondary"
                data-testid={`statistics-scope-option-${option.id}`}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
