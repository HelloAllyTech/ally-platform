import React, { useState } from "react";

import {
  type HomeOverview,
  type OverviewRange,
  type SafeCount,
  useGetHomeOverviewQuery,
} from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { Segmented } from "@components/v2";

import { Sparkline } from "../../Analytics/chartKit";
import { fill } from "../copy";
import { OVERVIEW_COPY as t } from "../copy/overview";
import { Group } from "../fields";

const RANGES = [
  { id: "7", label: t.last7 },
  { id: "30", label: t.last30 },
  { id: "90", label: t.last90 },
] as const;

const isLess = (c: SafeCount): c is { lessThan: number } => typeof c !== "number";

/** A count as the owner reads it: the number, or "Fewer than 5" as the server decided. */
export const countText = (c: SafeCount): string =>
  isLess(c) ? t.lessThan : c.toLocaleString("en-IN");

/** A value for the chart: "fewer than 5" days sit at the bottom, never at a guessed height. */
const plotted = (c: SafeCount): number => (isLess(c) ? 0 : c);

const minutesText = (n: number): string =>
  n < 120 ? fill(t.minutes, { n }) : fill(t.hours, { n: Math.round(n / 60) });

const Stat: React.FC<{ label: string; value: string; note?: string; testId?: string }> = ({
  label,
  value,
  note,
  testId,
}) => (
  <div className="ally-home__stat ally-overview__stat" data-testid={testId}>
    <dt className="ally-small">{label}</dt>
    <dd>{value}</dd>
    {note && <dd className="ally-small ally-numbers__note">{note}</dd>}
  </div>
);

const Series: React.FC<{
  label: string;
  data: HomeOverview["days"];
  pick: "conversations" | "people";
}> = ({ label, data, pick }) => (
  <div className="ally-overview__series">
    <span className="ally-small">{label}</span>
    <div className="ally-overview__spark">
      <Sparkline
        values={data.map(d => plotted(d[pick]))}
        width={280}
        height={40}
        label={fill(t.overTimeLabel, { label, n: data.length })}
      />
    </div>
  </div>
);

/** One theme row: why it went unanswered, as a count of people (never someone's words). */
const themeName = (theme: string) => t.themes[theme] ?? t.themeOther;

/**
 * How it's doing (stage 7): counts only, as the server returns them. Groups under 5 arrive as
 * `{ lessThan: 5 }` and are shown as "Fewer than 5"; nothing here works one out from other numbers.
 * Stacked cards on a phone, two columns from 640px.
 */
export const HowItsDoing: React.FC<{ botId: string }> = ({ botId }) => {
  const [range, setRange] = useState<OverviewRange>(30);
  const { data, isError, refetch } = useGetHomeOverviewQuery({ id: botId, range });

  const head = (
    <Segmented
      label={t.period}
      options={RANGES.map(r => ({ id: r.id, label: r.label }))}
      value={String(range) as "7" | "30" | "90"}
      onChange={id => setRange(Number(id) as OverviewRange)}
    />
  );

  if (isError) {
    return (
      <Group title={t.title} testId="overview-doing">
        {head}
        <div className="ally-home__row" role="alert">
          <p className="ally-error">{t.loadFailed}</p>
          <Button variant={ButtonVariant.TERTIARY} type="button" onClick={() => void refetch()}>
            {t.retry}
          </Button>
        </div>
      </Group>
    );
  }
  if (!data) {
    return (
      <Group title={t.title} testId="overview-doing">
        {head}
        <div className="ally-overview__cards" aria-busy="true">
          <div className="ally-home__skeleton-card ally-overview__skeleton" aria-hidden="true" />
        </div>
      </Group>
    );
  }

  const silent = data.conversations === 0;
  const lowDay = data.days.some(d => isLess(d.conversations) || isLess(d.people));
  const wait = data.handedToPerson.medianWaitMinutes;

  return (
    <Group title={t.title} testId="overview-doing">
      {head}
      {silent ? (
        <p className="ally-empty">{t.empty}</p>
      ) : (
        <div className="ally-overview__cards" data-testid="overview-cards">
          <section className="ally-overview__card" aria-label={t.overTime}>
            <dl className="ally-overview__pair">
              <Stat
                label={t.conversations}
                value={countText(data.conversations)}
                testId="ov-conversations"
              />
              <Stat label={t.people} value={countText(data.people)} testId="ov-people" />
            </dl>
            <Series label={t.conversations} data={data.days} pick="conversations" />
            <Series label={t.people} data={data.days} pick="people" />
            {lowDay && <p className="ally-small ally-field__hint">{t.lowDaysNote}</p>}
          </section>

          <section className="ally-overview__card">
            <dl>
              <Stat
                label={t.answered}
                value={data.answered.share === null ? "–" : `${data.answered.share}%`}
                note={data.answered.fewerThan5 ? t.answeredTooFew : t.answeredNote}
                testId="ov-answered"
              />
              <Stat
                label={t.handed}
                value={countText(data.handedToPerson.count)}
                note={
                  wait === null ? t.handedWaitNone : fill(t.handedWait, { n: minutesText(wait) })
                }
                testId="ov-handed"
              />
            </dl>
          </section>

          <section className="ally-overview__card" data-testid="ov-ratings">
            <h4 className="ally-label">{t.ratings}</h4>
            <ul className="ally-overview__list">
              <li>{fill(t.thumbsUp, { n: countText(data.ratings.up) })}</li>
              <li>{fill(t.thumbsDown, { n: countText(data.ratings.down) })}</li>
            </ul>
          </section>

          <section className="ally-overview__card" data-testid="ov-unanswered">
            <h4 className="ally-label">{t.topUnanswered}</h4>
            {data.topUnanswered.length === 0 ? (
              <p className="ally-empty">{t.topUnansweredNone}</p>
            ) : (
              <ul className="ally-overview__list">
                {data.topUnanswered.map(item =>
                  item.kind === "question" ? (
                    <li key={`q-${item.text}`}>
                      <span className="ally-body">“{item.text}”</span>{" "}
                      <span className="ally-small">{fill(t.askedTimes, { n: item.count })}</span>
                    </li>
                  ) : (
                    <li key={`t-${item.theme}`}>
                      {fill(t.themeLine, {
                        theme: themeName(item.theme),
                        count: countText(item.count),
                      })}
                    </li>
                  ),
                )}
              </ul>
            )}
            {data.topUnanswered.some(i => i.kind === "theme") && (
              <p className="ally-small ally-field__hint">{t.themeNote}</p>
            )}
          </section>
        </div>
      )}
    </Group>
  );
};
