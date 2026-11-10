import React, { useMemo, useState } from "react";

import {
  useGetWaAnalyticsLanguagesQuery,
  useGetWaAnalyticsOverviewQuery,
  useGetWaAnalyticsTimeseriesQuery,
  useGetWaCorpusCoverageQuery,
} from "@api";
import { Button, Segmented } from "@components/v2";
import type { WaAnalyticsBucket } from "@types";

import { fill, HOME } from "../copy";
import { day } from "../dates";

const t = HOME.allNumbers;

const PERIODS = [
  { id: "7", label: HOME.overview.last7 },
  { id: "30", label: HOME.overview.last30 },
  { id: "90", label: t.last90 },
] as const;
type Period = (typeof PERIODS)[number]["id"];

/** The outcomes an owner reads, in this order; anything else (templates, consent, limits) is Other. */
const OUTCOMES = [
  { key: "answered", handledBy: ["rag"], label: t.answered },
  { key: "declined", handledBy: ["declined"], label: t.declined },
  { key: "clarified", handledBy: ["clarified"], label: t.clarified },
  { key: "crisis", handledBy: ["crisis"], label: t.crisis },
] as const;
type OutcomeKey = (typeof OUTCOMES)[number]["key"] | "other";

const outcomeOf = (handledBy: string): OutcomeKey =>
  OUTCOMES.find(o => (o.handledBy as readonly string[]).includes(handledBy))?.key ?? "other";

/** Documents listed by use; the rest are counted in one line. */
const DOCUMENT_ROWS = 10;

const count = (n: number | undefined) => (n === undefined ? "–" : n.toLocaleString("en-IN"));
const percent = (rate: number | null | undefined) =>
  rate === null || rate === undefined ? null : `${Math.round(rate * 100)}%`;
const seconds = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? "–" : fill(t.seconds, { s: (ms / 1000).toFixed(1) });

type Day = { day: string; total: number } & Record<OutcomeKey, number>;

/** Daily buckets → one row per day, each outcome summed. */
const byDay = (buckets: WaAnalyticsBucket[]): Day[] => {
  const days = new Map<string, Day>();
  for (const b of buckets) {
    const key = new Date(b.bucket).toISOString().slice(0, 10);
    const row = days.get(key) ?? {
      day: key,
      total: 0,
      answered: 0,
      declined: 0,
      clarified: 0,
      crisis: 0,
      other: 0,
    };
    row[outcomeOf(b.handledBy)] += b.count;
    row.total += b.count;
    days.set(key, row);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
};

/**
 * Every number the classic usage tab had (chunk CL1), drawn with the home's own pieces: plain bars
 * sized by share, no chart library. It loads only once opened, as the classic tab did.
 */
export const AllNumbers: React.FC<{ botId: string }> = ({ botId }) => {
  const [period, setPeriod] = useState<Period>("30");
  // One window for every query, fixed until the period changes.
  const window = useMemo(
    () => ({
      from: new Date(Date.now() - Number(period) * 86_400_000).toISOString(),
      chatbotId: botId,
    }),
    [period, botId],
  );
  const overview = useGetWaAnalyticsOverviewQuery(window);
  const timeseries = useGetWaAnalyticsTimeseriesQuery(window);
  const languages = useGetWaAnalyticsLanguagesQuery(window);
  const coverage = useGetWaCorpusCoverageQuery(window);

  const stats = overview.data;
  const days = useMemo(() => byDay(timeseries.data ?? []), [timeseries.data]);
  const busiest = Math.max(1, ...days.map(d => d.total));
  const documents = (coverage.data?.rows ?? []).filter(row => !row.isArchived);
  const used = documents.filter(row => row.citations > 0).slice(0, DOCUMENT_ROWS);
  const mostUsed = Math.max(1, ...used.map(row => row.citations));
  const notUsed = documents.filter(row => row.citations === 0).length;

  const failed = overview.isError || timeseries.isError || languages.isError || coverage.isError;
  const retry = () => {
    void overview.refetch();
    void timeseries.refetch();
    void languages.refetch();
    void coverage.refetch();
  };

  return (
    <div className="ally-numbers" data-testid="all-numbers">
      <Segmented
        label={HOME.overview.numbersPeriod}
        options={PERIODS.map(p => ({ id: p.id, label: p.label }))}
        value={period}
        onChange={id => setPeriod(id as Period)}
      />

      {failed ? (
        <div className="ally-home__row" role="alert">
          <p className="ally-error">{t.loadFailed}</p>
          <Button onClick={retry}>{t.retry}</Button>
        </div>
      ) : stats && stats.inbound === 0 ? (
        <p className="ally-empty">{t.empty}</p>
      ) : (
        <>
          <dl className="ally-home__stats" aria-busy={!stats || undefined}>
            <div className="ally-home__stat">
              <dt className="ally-small">{t.messagesIn}</dt>
              <dd>{count(stats?.inbound)}</dd>
            </div>
            <div className="ally-home__stat">
              <dt className="ally-small">{t.people}</dt>
              <dd>{count(stats?.uniqueContacts)}</dd>
            </div>
            <div className="ally-home__stat">
              <dt className="ally-small">{t.didntKnow}</dt>
              <dd>{stats ? (percent(stats.declineRate) ?? "–") : "–"}</dd>
              <dd className="ally-small ally-numbers__note">
                {stats && stats.declineRate === null ? t.tooFew : t.didntKnowNote}
              </dd>
            </div>
            <div className="ally-home__stat">
              <dt className="ally-small">{t.replyTime}</dt>
              <dd>{seconds(stats?.latencyP50Ms)}</dd>
              {stats?.latencyP95Ms != null && (
                <dd className="ally-small ally-numbers__note">
                  {fill(t.replyTimeNote, { s: (stats.latencyP95Ms / 1000).toFixed(1) })}
                </dd>
              )}
            </div>
          </dl>

          <section className="ally-numbers__part" aria-labelledby="numbers-outcomes">
            <h4 id="numbers-outcomes" className="ally-label">
              {t.outcomesTitle}
            </h4>
            <dl className="ally-numbers__counts">
              {(
                [
                  [t.answered, stats?.answered],
                  [t.declined, stats?.declined],
                  [t.clarified, stats?.clarified],
                  [t.crisis, stats?.crisis],
                  [t.unidentified, stats?.unidentified],
                  [t.errors, stats?.errors],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="ally-small">{label}</dt>
                  <dd>{count(value)}</dd>
                </div>
              ))}
            </dl>
          </section>

          {days.length > 0 && (
            <section className="ally-numbers__part" aria-labelledby="numbers-days">
              <h4 id="numbers-days" className="ally-label">
                {t.perDay}
              </h4>
              <ul className="ally-numbers__legend" aria-hidden="true">
                {[...OUTCOMES.map(o => [o.key, o.label]), ["other", t.other]].map(
                  ([key, label]) => (
                    <li key={key}>
                      <span className={`ally-numbers__swatch ally-numbers__swatch--${key}`} />
                      {label}
                    </li>
                  ),
                )}
              </ul>
              <ul className="ally-numbers__days">
                {days.map(d => (
                  <li key={d.day} className="ally-numbers__day">
                    <span className="ally-small">{day(d.day)}</span>
                    <span
                      className="ally-numbers__bar"
                      role="img"
                      aria-label={fill(t.perDayRow, { day: day(d.day), n: d.total })}
                      style={{ width: `${(d.total / busiest) * 100}%` }}
                    >
                      {(["answered", "declined", "clarified", "crisis", "other"] as const).map(
                        key =>
                          d[key] > 0 && (
                            <span
                              key={key}
                              className={`ally-numbers__swatch--${key}`}
                              style={{ flexGrow: d[key] }}
                            />
                          ),
                      )}
                    </span>
                    <span className="ally-small">{count(d.total)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(languages.data ?? []).length > 0 && (
            <section className="ally-numbers__part" aria-labelledby="numbers-languages">
              <h4 id="numbers-languages" className="ally-label">
                {t.languages}
              </h4>
              <table className="ally-numbers__table">
                <thead>
                  <tr>
                    <th scope="col">{t.language}</th>
                    <th scope="col">{t.questions}</th>
                    <th scope="col">{t.didntKnow}</th>
                  </tr>
                </thead>
                <tbody>
                  {(languages.data ?? []).map(row => (
                    <tr key={row.language}>
                      <td>{row.language}</td>
                      <td>{count(row.total)}</td>
                      <td>{percent(row.declineRate) ?? t.tooFew}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {documents.length > 0 && (
            <section className="ally-numbers__part" aria-labelledby="numbers-documents">
              <h4 id="numbers-documents" className="ally-label">
                {t.documents}
              </h4>
              <ul className="ally-numbers__docs">
                {used.map(row => (
                  <li key={row.documentId}>
                    <span className="ally-body">{row.title}</span>
                    <span
                      className="ally-numbers__bar ally-numbers__bar--single"
                      aria-hidden="true"
                      style={{ width: `${(row.citations / mostUsed) * 100}%` }}
                    />
                    <span className="ally-small">{fill(t.documentUses, { n: row.citations })}</span>
                  </li>
                ))}
              </ul>
              {notUsed > 0 && (
                <p className="ally-small">
                  {notUsed === 1 ? t.notUsedOne : fill(t.notUsedMany, { n: notUsed })}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};
