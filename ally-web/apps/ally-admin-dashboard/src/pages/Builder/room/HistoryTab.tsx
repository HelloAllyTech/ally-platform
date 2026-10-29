import React, { useEffect, useMemo, useState } from "react";

import { Search } from "@icons";

import { useGetBuilderHistoryQuery } from "@api";
import { en } from "@constants";
import { BuilderHistoryItem, BuilderHistoryQuery } from "@types";

import { dayLabel, formatWait, timeOfDay } from "./roomFormat";

const strings = en.builder.room.history;

interface HistoryTabProps {
  /** Pre-set filters, e.g. a rule's "applied 6×" link. */
  initial: BuilderHistoryQuery;
  compact: boolean;
  onMakeRule: (entry: BuilderHistoryItem) => void;
}

const highlight = (text: string, q: string): React.ReactNode => {
  if (!q) return text;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-primary-100 text-inherit">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
};

const byLine = (entry: BuilderHistoryItem): string => {
  if (entry.surface === "rule") return strings.by.rule;
  if (entry.surface === "slack" && !entry.actorName) return strings.by.slack;
  return entry.actorName ?? strings.by.you;
};

/**
 * Every decision, ask and tell, newest first — searched, not read. Read-only:
 * a correction is a rule, never an edit to what happened.
 */
export const HistoryTab: React.FC<HistoryTabProps> = ({ initial, compact, onMakeRule }) => {
  const [q, setQ] = useState(initial.q ?? "");
  const [debounced, setDebounced] = useState(q);
  const [entryType, setEntryType] = useState(initial.entryType ?? "");
  const [who, setWho] = useState(initial.who ?? "");
  const [ruleId, setRuleId] = useState(initial.ruleId ?? "");
  const [before, setBefore] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(!compact);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => setBefore(undefined), [debounced, entryType, who, ruleId]);

  const query: BuilderHistoryQuery = {
    ...(debounced ? { q: debounced } : {}),
    ...(entryType ? { entryType: entryType as BuilderHistoryQuery["entryType"] } : {}),
    ...(who ? { who: who as BuilderHistoryQuery["who"] } : {}),
    ...(ruleId ? { ruleId } : {}),
    ...(before ? { before } : {}),
  };
  const { data, isFetching, isError, refetch } = useGetBuilderHistoryQuery(query);
  const entries = data?.entries ?? [];
  const filtersActive = [entryType, who, ruleId].filter(Boolean).length;
  const now = Date.now();

  const grouped = useMemo(() => {
    const out: { day: string; entries: BuilderHistoryItem[] }[] = [];
    for (const entry of entries) {
      const day = dayLabel(entry.decidedAt, now, strings);
      const last = out[out.length - 1];
      if (last?.day === day) last.entries.push(entry);
      else out.push({ day, entries: [entry] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const clear = () => {
    setQ("");
    setEntryType("");
    setWho("");
    setRuleId("");
  };

  return (
    <div className="flex max-w-[880px] flex-col gap-4">
      <header>
        <h1 className="text-[28px] font-normal leading-9">{strings.title}</h1>
        <p className="mt-1 max-w-[62ch] text-sm text-typography-600">{strings.subtitle}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-0 flex-[1_1_260px] items-center gap-2 border-b border-neutral-500 bg-white px-3 focus-within:ring-2 focus-within:ring-primary-600">
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span className="sr-only">{strings.search}</span>
          <input
            type="search"
            value={q}
            onChange={event => setQ(event.target.value)}
            placeholder={strings.search}
            className="h-full min-w-0 flex-1 bg-transparent text-base focus:outline-none sm:text-sm"
          />
        </label>
        {compact && (
          <button
            type="button"
            aria-expanded={showFilters}
            className="h-10 border border-neutral-500 px-3 text-sm"
            onClick={() => setShowFilters(value => !value)}
          >
            {strings.filterCount(filtersActive)}
          </button>
        )}
        {showFilters && (
          <>
            <label className="sr-only" htmlFor="history-type">
              {strings.filters}
            </label>
            <select
              id="history-type"
              value={entryType}
              onChange={event => setEntryType(event.target.value as typeof entryType)}
              className="h-10 border-b border-neutral-500 bg-white px-2 text-base sm:text-sm"
            >
              {Object.entries(strings.types).map(([value, label]) => (
                <option key={value} value={value === "all" ? "" : value}>
                  {label}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="history-who">
              {strings.filters}
            </label>
            <select
              id="history-who"
              value={who}
              onChange={event => setWho(event.target.value as typeof who)}
              className="h-10 border-b border-neutral-500 bg-white px-2 text-base sm:text-sm"
            >
              {Object.entries(strings.who).map(([value, label]) => (
                <option key={value} value={value === "all" ? "" : value}>
                  {label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {isError ? (
        <div className="text-sm">
          <p>{strings.loadFailed}</p>
          <button type="button" className="mt-2 underline" onClick={() => refetch()}>
            {en.builder.room.card.retry}
          </button>
        </div>
      ) : !entries.length && !isFetching ? (
        <div className="py-6 text-sm text-typography-700">
          {debounced || filtersActive ? (
            <>
              <p>{strings.emptyFiltered(debounced)}</p>
              <button
                type="button"
                className="mt-3 min-h-[40px] border border-typography-900 px-4"
                onClick={clear}
              >
                {strings.clear}
              </button>
            </>
          ) : (
            <p>{strings.empty}</p>
          )}
        </div>
      ) : (
        <div aria-busy={isFetching}>
          {grouped.map(group => (
            <section key={group.day}>
              <h2 className="mb-1.5 mt-5 text-xs font-semibold tracking-wide text-typography-600">
                {group.day}
              </h2>
              <ul>
                {group.entries.map(entry => {
                  const expanded = open === entry.id;
                  const prefix =
                    entry.entryType === "ask"
                      ? strings.asked
                      : entry.entryType === "tell"
                        ? strings.told
                        : "";
                  return (
                    <li key={entry.id} className="border-b border-border-light bg-white">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? null : entry.id)}
                        className="grid w-full grid-cols-[48px_minmax(0,1fr)] gap-x-4 gap-y-1 px-3 py-2.5 text-left hover:bg-neutral-100 sm:grid-cols-[56px_150px_minmax(0,1fr)_150px]"
                      >
                        <span className="text-xs tabular-nums text-typography-500">
                          {timeOfDay(entry.decidedAt)}
                        </span>
                        <span className="col-start-2 min-w-0 truncate text-xs text-typography-600 sm:col-start-auto">
                          {entry.sessionTitle}
                        </span>
                        <span
                          className={[
                            "col-start-2 min-w-0 sm:col-start-auto",
                            entry.undoneAt ? "text-typography-400 line-through" : "",
                          ].join(" ")}
                        >
                          {entry.entryType === "start" || entry.entryType === "putback" ? (
                            <span className="font-medium">
                              {highlight(entry.chosenLabel ?? entry.prompt, debounced)}
                            </span>
                          ) : (
                            <>
                              {prefix && <span className="text-typography-500">{prefix} </span>}
                              {highlight(entry.prompt, debounced)}
                              <span className="mt-0.5 block font-medium">
                                {highlight(
                                  entry.entryType === "ask"
                                    ? (entry.answerText ?? "").split("\n")[0]
                                    : (entry.chosenLabel ?? ""),
                                  debounced,
                                )}
                                {entry.undoneAt ? ` ${strings.undone}` : ""}
                              </span>
                            </>
                          )}
                        </span>
                        <span className="col-start-2 text-xs text-typography-600 sm:col-start-auto">
                          {byLine(entry)}
                        </span>
                      </button>
                      {expanded && (
                        <div className="flex flex-col gap-1.5 px-3 pb-3 text-[13px] text-typography-600 sm:pl-[88px]">
                          {entry.entryType === "ask" && entry.answerText && (
                            <p className="whitespace-pre-wrap">{entry.answerText}</p>
                          )}
                          {entry.waitSeconds != null && (
                            <p>{strings.waited(formatWait(entry.waitSeconds * 1000))}</p>
                          )}
                          {entry.applyError && (
                            <p className="text-red-700">{strings.failed(entry.applyError)}</p>
                          )}
                          {entry.entryType === "decision" && !entry.undoneAt && (
                            <button
                              type="button"
                              className="w-fit underline underline-offset-2"
                              onClick={() => onMakeRule(entry)}
                            >
                              {strings.makeRule}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {data?.nextBefore && (
            <button
              type="button"
              className="mt-4 min-h-[40px] border border-typography-900 px-4 text-sm"
              onClick={() => setBefore(data.nextBefore ?? undefined)}
            >
              {strings.loadMore}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
