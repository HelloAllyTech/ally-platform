import React, { useEffect, useMemo, useRef, useState } from "react";

import { Check, CheckCircle2, CircleDashed, Copy, Search, X } from "lucide-react";
import { toast } from "sonner";

import { useGetContextChunksQuery, useSearchContextLibraryQuery } from "@api";
import { en } from "@constants";
import {
  ContextAudienceFilter,
  ContextChunk,
  ContextChunkConfidence,
  ContextChunkListQuery,
  ContextChunkOrigin,
  ContextChunkStatus,
  ContextCollection,
  ContextSearchBand,
  ContextSearchDiagnostics,
} from "@types";

import {
  ORIGINS,
  bandLabel,
  capitalise,
  errorReason,
  facetLine,
  humanise,
  matchesFacets,
  nounsFor,
  originFilterLabel,
  sourceCountLine,
} from "./contextLibraryFormat";
import { useContextLibraryScope } from "./contextLibraryScope";
import {
  AudienceBadge,
  Chip,
  ChunkStatusWords,
  InlineError,
  LoadingRows,
  OriginBadge,
  StatusWord,
} from "./ContextLibraryUi";

export const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

export const useDebouncedValue = <T,>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

interface Filters {
  origin: ContextChunkOrigin | null;
  lowConfidence: boolean;
  archived: boolean;
  facets: Record<string, string[]>;
}

const NO_FILTERS: Filters = { origin: null, lowConfidence: false, archived: false, facets: {} };

const BAND_ICON: Record<ContextSearchBand, typeof Check> = {
  strong: CheckCircle2,
  good: Check,
  low: CircleDashed,
};

interface LibraryViewProps {
  collection?: ContextCollection;
  collections: ContextCollection[];
  /** `?audience=` on arrival, e.g. from an organisation's Ally tab: `global`, `mine` or an id. */
  initialAudience?: ContextAudienceFilter;
  onOpenChunk: (code: string) => void;
}

/**
 * Entries in the selected collection: search as you type (`/` focuses), facet chips from the
 * profile's vocabularies, origin and low-confidence filters, and "How was this found?".
 * Lists page with "Show more"; the codebase has no virtualisation helper to lean on.
 */
export const LibraryView: React.FC<LibraryViewProps> = ({
  collection,
  collections,
  initialAudience,
  onOpenChunk,
}) => {
  const strings = en.contextLibrary.library;
  const { tenantId, orgNames } = useContextLibraryScope();
  // Global · My organisation for an organisation's admin; Global · one organisation for the
  // platform, in collections that hold organisation entries at all.
  const [audience, setAudience] = useState<ContextAudienceFilter | null>(initialAudience ?? null);
  const showAudience = Boolean(tenantId) || Boolean(collection?.allowsOrgChunks);
  const { noun, nounPlural } = nounsFor(collection);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [explain, setExplain] = useState(false);
  const [pages, setPages] = useState(1);
  const searchRef = useRef<HTMLInputElement>(null);

  // A new collection starts with a clean slate.
  useEffect(() => {
    setFilters(NO_FILTERS);
    setPages(1);
  }, [collection?.id]);
  useEffect(() => setPages(1), [filters, debounced, audience]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || isTyping(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const facetSpecs = useMemo(
    () => Object.entries(collection?.facets ?? {}).filter(([, spec]) => spec.values?.length),
    [collection],
  );
  const anyFilter =
    Boolean(filters.origin) ||
    filters.lowConfidence ||
    filters.archived ||
    Object.values(filters.facets).some(values => values.length);

  const toggleFacet = (key: string, value: string) =>
    setFilters(previous => {
      const current = previous.facets[key] ?? [];
      return {
        ...previous,
        facets: {
          ...previous.facets,
          [key]: current.includes(value) ? current.filter(v => v !== value) : [...current, value],
        },
      };
    });

  const listArgs = (offset: number): ContextChunkListQuery => ({
    tenantId,
    audience: showAudience ? (audience ?? undefined) : undefined,
    collectionId: collection?.id,
    origin: filters.origin ?? undefined,
    confidence: filters.lowConfidence ? ("low" as ContextChunkConfidence) : undefined,
    status: filters.archived ? ("archived" as ContextChunkStatus) : undefined,
    offset,
    limit: PAGE_SIZE,
  });

  const searching = debounced.length > 0;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          size={16}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-typography-500"
        />
        <input
          ref={searchRef}
          type="search"
          aria-label={strings.searchLabel}
          placeholder={strings.searchPlaceholder(nounPlural)}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              setQuery("");
            }
          }}
          className="h-10 w-full rounded border border-border-light bg-white pl-9 pr-9 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          data-testid="cl-search"
        />
        {query && (
          <button
            type="button"
            aria-label={strings.clearSearch}
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded hover:bg-neutral-100"
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </div>

      <div className="space-y-2" role="group" aria-label={strings.filtersLabel}>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-typography-600">{strings.originLabel}</span>
          {ORIGINS.filter(origin => !collection || collection.allowedOrigins.includes(origin)).map(
            origin => (
              <Chip
                key={origin}
                pressed={filters.origin === origin}
                onClick={() =>
                  setFilters(previous => ({
                    ...previous,
                    origin: previous.origin === origin ? null : origin,
                  }))
                }
              >
                {originFilterLabel(origin)}
              </Chip>
            ),
          )}
          <span className="mx-1 h-4 w-px bg-border-light" aria-hidden />
          <Chip
            pressed={filters.lowConfidence}
            onClick={() =>
              setFilters(previous => ({ ...previous, lowConfidence: !previous.lowConfidence }))
            }
          >
            {strings.lowConfidence}
          </Chip>
          {!searching && (
            <Chip
              pressed={filters.archived}
              onClick={() =>
                setFilters(previous => ({ ...previous, archived: !previous.archived }))
              }
            >
              {strings.archived}
            </Chip>
          )}
          {searching && (
            <Chip
              pressed={explain}
              onClick={() => setExplain(value => !value)}
              testId="cl-how-found"
            >
              <span title={strings.howFoundHelp}>{strings.howFound}</span>
            </Chip>
          )}
          {anyFilter && (
            <button
              type="button"
              onClick={() => setFilters(NO_FILTERS)}
              className="ml-1 text-xs text-primary-600 underline-offset-2 hover:underline"
            >
              {strings.clearFilters}
            </button>
          )}
        </div>
        {showAudience && (
          <AudienceFilter
            value={audience}
            orgMode={Boolean(tenantId)}
            orgNames={orgNames}
            onChange={setAudience}
          />
        )}
        {facetSpecs.map(([key, spec]) => (
          <div key={key} className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-typography-600">{spec.label}</span>
            {spec.values!.map(value => (
              <Chip
                key={value}
                pressed={(filters.facets[key] ?? []).includes(value)}
                onClick={() => toggleFacet(key, value)}
              >
                {humanise(value)}
              </Chip>
            ))}
          </div>
        ))}
      </div>

      {searching ? (
        <SearchResults
          query={debounced}
          collection={collection}
          collections={collections}
          filters={filters}
          explain={explain}
          onOpen={onOpenChunk}
        />
      ) : (
        <ChunkList
          pages={pages}
          args={listArgs}
          filters={filters}
          noun={noun}
          nounPlural={nounPlural}
          collections={collections}
          onShowMore={() => setPages(p => p + 1)}
          onOpen={onOpenChunk}
        />
      )}
    </div>
  );
};

/**
 * Who the entries reach: All · Global · My organisation for an organisation's admin, All · Global ·
 * one named organisation for the platform.
 */
const AudienceFilter: React.FC<{
  value: ContextAudienceFilter | null;
  orgMode: boolean;
  orgNames: Record<string, string>;
  onChange: (value: ContextAudienceFilter | null) => void;
}> = ({ value, orgMode, orgNames, onChange }) => {
  const strings = en.contextLibrary.audience;
  const named = value && value !== "global" && value !== "mine" ? value : "";
  const orgOptions = Object.entries(orgNames).sort(([, a], [, b]) => a.localeCompare(b));
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      role="group"
      aria-label={strings.label}
      data-testid="cl-audience-filter"
    >
      <span className="mr-1 text-xs text-typography-600" title={strings.filterHelp}>
        {strings.label}
      </span>
      <Chip pressed={!value} onClick={() => onChange(null)}>
        {strings.all}
      </Chip>
      <Chip pressed={value === "global"} onClick={() => onChange("global")}>
        {strings.global}
      </Chip>
      {orgMode ? (
        <Chip pressed={value === "mine"} onClick={() => onChange("mine")}>
          {strings.mine}
        </Chip>
      ) : (
        <select
          aria-label={strings.pick}
          value={named}
          onChange={event => onChange(event.target.value || null)}
          className="h-7 rounded border border-border-light bg-white px-1 text-xs"
          data-testid="cl-audience-org"
        >
          <option value="">{strings.pick}</option>
          {orgOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
};

const applyClientFilters = (chunk: ContextChunk, filters: Filters) =>
  (!filters.origin || chunk.origin === filters.origin) &&
  (!filters.lowConfidence || chunk.confidence === "low") &&
  matchesFacets(chunk, filters.facets);

const ChunkList: React.FC<{
  pages: number;
  args: (offset: number) => ContextChunkListQuery;
  filters: Filters;
  noun: string;
  nounPlural: string;
  collections: ContextCollection[];
  onShowMore: () => void;
  onOpen: (code: string) => void;
}> = ({ pages, args, filters, noun, nounPlural, collections, onShowMore, onOpen }) => {
  const strings = en.contextLibrary.library;
  const first = useGetContextChunksQuery(args(0));
  if (first.isLoading) return <LoadingRows />;
  if (first.isError) {
    return (
      <InlineError
        what={nounPlural}
        reason={errorReason(first.error)}
        onRetry={() => void first.refetch()}
      />
    );
  }
  const total = first.data?.total ?? 0;
  const facetFiltering = Object.values(filters.facets).some(values => values.length);
  if (!total) {
    return (
      <p className="py-8 text-sm text-typography-600">
        {facetFiltering || filters.origin || filters.lowConfidence || filters.archived
          ? strings.emptyFiltered(nounPlural)
          : strings.emptyCollection(nounPlural)}
      </p>
    );
  }
  const shown = Math.min(total, pages * PAGE_SIZE);
  return (
    <div>
      <p className="mb-1 text-xs text-typography-600">
        {strings.count(total, total === 1 ? noun : nounPlural)}
      </p>
      {facetFiltering && (
        <p className="mb-1 text-xs text-typography-600">{strings.facetsTruncated}</p>
      )}
      <ul
        className="divide-y divide-border-light border-y border-border-light"
        data-testid="cl-chunk-list"
      >
        {Array.from({ length: pages }, (_, page) => (
          <ChunkListPage
            key={page}
            args={args(page * PAGE_SIZE)}
            filters={filters}
            collections={collections}
            onOpen={onOpen}
          />
        ))}
      </ul>
      {shown < total && (
        <button
          type="button"
          onClick={onShowMore}
          className="mt-3 rounded border border-border-light px-4 py-2 text-sm hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
        >
          {strings.showMore(shown, total)}
        </button>
      )}
    </div>
  );
};

const ChunkListPage: React.FC<{
  args: ContextChunkListQuery;
  filters: Filters;
  collections: ContextCollection[];
  onOpen: (code: string) => void;
}> = ({ args, filters, collections, onOpen }) => {
  const { data, isLoading, isError, error, refetch } = useGetContextChunksQuery(args);
  if (isLoading) {
    return (
      <li>
        <LoadingRows rows={2} />
      </li>
    );
  }
  if (isError) {
    return (
      <li className="py-2">
        <InlineError what="more" reason={errorReason(error)} onRetry={() => void refetch()} />
      </li>
    );
  }
  return (
    <>
      {(data?.items ?? [])
        .filter(chunk => matchesFacets(chunk, filters.facets))
        .map(chunk => (
          <ChunkRow
            key={chunk.id}
            chunk={chunk}
            collections={collections}
            showCollection={!args.collectionId}
            onOpen={onOpen}
          />
        ))}
    </>
  );
};

const SearchResults: React.FC<{
  query: string;
  collection?: ContextCollection;
  collections: ContextCollection[];
  filters: Filters;
  explain: boolean;
  onOpen: (code: string) => void;
}> = ({ query, collection, collections, filters, explain, onOpen }) => {
  const strings = en.contextLibrary.library;
  const { tenantId } = useContextLibraryScope();
  const { data, isLoading, isFetching, isError, error, refetch } = useSearchContextLibraryQuery({
    tenantId,
    query,
    collectionId: collection?.id,
    explain: explain || undefined,
  });
  if (isLoading) return <LoadingRows />;
  if (isError) {
    return (
      <InlineError
        what={strings.searchLabel.toLowerCase()}
        reason={errorReason(error)}
        onRetry={() => void refetch()}
      />
    );
  }
  const results = (data?.results ?? []).filter(r => applyClientFilters(r.chunk, filters));
  return (
    <div aria-busy={isFetching}>
      {data?.noConfidentMatch && (
        <p
          className="py-3 text-sm text-typography-700"
          role="status"
          data-testid="cl-no-confident-match"
        >
          {strings.noConfidentMatch}
          {results.length > 0 && ` ${strings.closestMatch}`}
        </p>
      )}
      {results.length > 0 && (
        <ul
          className="divide-y divide-border-light border-y border-border-light"
          data-testid="cl-search-results"
        >
          {results.map(result => (
            <ChunkRow
              key={result.chunk.id}
              chunk={result.chunk}
              collections={collections}
              band={result.band}
              diagnostics={explain ? result.diagnostics : undefined}
              showCollection={!collection}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
      {!data?.noConfidentMatch && results.length === 0 && (
        <p className="py-3 text-sm text-typography-700">
          {strings.emptyFiltered(nounsFor(collection).nounPlural)}
        </p>
      )}
    </div>
  );
};

const Diagnostics: React.FC<{ diagnostics: ContextSearchDiagnostics }> = ({ diagnostics }) => {
  const strings = en.contextLibrary.library.diagnostics;
  const rank = (value?: number | null) => (value ? `#${value}` : strings.notRanked);
  const parts = [
    `${strings.keyword} ${rank(diagnostics.bm25Rank)}`,
    `${strings.statement} ${rank(diagnostics.statementRank)}`,
    `${strings.situations} ${rank(diagnostics.situationsRank)}`,
    diagnostics.grade !== undefined && diagnostics.grade !== null
      ? `${strings.grade} ${diagnostics.grade}`
      : null,
    diagnostics.dropped ? `${strings.dropped}: ${humanise(diagnostics.dropped)}` : null,
  ].filter(Boolean);
  return (
    <p className="mt-1 font-mono text-[11px] text-typography-600" data-testid="cl-diagnostics">
      {parts.join(" · ")}
    </p>
  );
};

/**
 * One entry: the statement as the hero, a muted line of key facets and where it came from,
 * and the code in mono at the right with a copy button that shows on hover or focus.
 */
export const ChunkRow: React.FC<{
  chunk: ContextChunk;
  collections: ContextCollection[];
  band?: ContextSearchBand;
  diagnostics?: ContextSearchDiagnostics;
  /** Under "All", say which collection each entry is in. */
  showCollection?: boolean;
  onOpen: (code: string) => void;
}> = ({ chunk, collections, band, diagnostics, showCollection, onOpen }) => {
  const strings = en.contextLibrary.library;
  const { tenantId, orgNames } = useContextLibraryScope();
  const collection = collections.find(c => c.id === chunk.collectionId);
  const { noun } = nounsFor(collection);
  const meta = [facetLine(chunk.facets), sourceCountLine(chunk)].filter(Boolean).join(" · ");
  const BandIcon = band ? BAND_ICON[band] : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(chunk.code);
      toast(strings.copied(chunk.code));
    } catch {
      /* clipboard refused: nothing to undo */
    }
  };

  return (
    <li
      className="group relative flex gap-4 px-2 py-3 hover:bg-neutral-50"
      data-testid="cl-chunk-row"
    >
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(chunk.code)}
          className="text-left text-sm font-medium leading-snug text-typography-900 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-focus-within:underline"
        >
          {chunk.statement}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {meta && <span className="text-xs text-typography-600">{capitalise(meta)}</span>}
          {showCollection && (
            <span className="text-xs text-typography-500">
              {collection?.name ?? chunk.collectionId}
            </span>
          )}
          <OriginBadge origin={chunk.origin} />
          {(tenantId || collection?.allowsOrgChunks || !chunk.isGlobal) && (
            <AudienceBadge chunk={chunk} ownTenantId={tenantId} orgNames={orgNames} />
          )}
          <ChunkStatusWords chunk={chunk} noun={noun} />
        </div>
        {diagnostics && <Diagnostics diagnostics={diagnostics} />}
      </div>
      <div className="relative z-10 flex shrink-0 flex-col items-end gap-1">
        {band && BandIcon && (
          <StatusWord
            icon={BandIcon}
            label={bandLabel(band)}
            tone={band === "low" ? "muted" : "good"}
            testId="cl-band"
          />
        )}
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={strings.copyCode(chunk.code)}
            className="inline-flex h-6 w-6 items-center justify-center rounded opacity-0 hover:bg-neutral-200 focus:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 group-hover:opacity-100"
          >
            <Copy size={12} aria-hidden />
          </button>
          <span className="font-mono text-xs text-typography-600">{chunk.code}</span>
        </span>
      </div>
    </li>
  );
};
