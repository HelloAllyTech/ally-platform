import React from "react";

import { useGetBuilderPartnerScoreboardQuery } from "@api";
import { en } from "@constants";

const strings = en.builder.room.scoreboard;
const kindLabels = en.builder.decisions.kinds;

const minutes = (value: number) =>
  value >= 60 ? `${Math.round(value / 6) / 10}h` : `${Math.round(value)}m`;

/**
 * How well the person and Builder work together, from History. Waiting on
 * you is the headline and the number to drive down; how fast decisions are
 * made is a private diagnostic here and never a target on the Now page —
 * a speed score on a screen whose risk is rubber-stamping trains it.
 * Every figure carries its sample size.
 */
export const PartnerScoreboard: React.FC<{ windowDays: number }> = ({ windowDays }) => {
  const { data } = useGetBuilderPartnerScoreboardQuery({ windowDays });
  if (!data) return null;

  return (
    <section
      aria-labelledby="partner-title"
      className="flex flex-col gap-3 border border-border-light bg-white p-4"
    >
      <div>
        <h2 id="partner-title" className="text-base font-semibold">
          {strings.title}
        </h2>
        <p className="mt-0.5 text-sm text-typography-600">{strings.subtitle}</p>
      </div>
      {data.decisions === 0 ? (
        <p className="text-sm text-typography-500">{strings.empty}</p>
      ) : (
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold tracking-wide text-typography-600">
              {strings.waiting}
            </dt>
            <dd className="mt-1 text-2xl tabular-nums">
              {minutes(data.waitingOnYou.totalMinutes)}
            </dd>
            <dd className="mt-1 text-xs text-typography-500">
              {data.waitingOnYou.byKind
                .slice(0, 3)
                .map(
                  row =>
                    `${kindLabels[row.kind] ?? row.kind} ${minutes(row.minutes)} (n=${row.count})`,
                )
                .join(" · ")}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-typography-600">
              {strings.askedTwice}
            </dt>
            <dd className="mt-1 text-2xl tabular-nums">{data.askedTwice.count}</dd>
            <dd className="mt-1 text-xs text-typography-500">
              n={data.askedTwice.ofDecisions} · {strings.rules(data.decidedByRules)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-typography-600">
              {strings.agreement}
            </dt>
            <dd className="mt-1 flex flex-col gap-0.5 text-xs">
              {data.agreement.slice(0, 4).map(row => (
                <span key={`${row.kind}-${row.questionType}`} className="tabular-nums">
                  {kindLabels[row.kind] ?? row.kind}
                  {row.questionType ? ` · ${row.questionType}` : ""}: {row.agreed}/{row.total}
                </span>
              ))}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-typography-600">
              {strings.caution}
            </dt>
            <dd className="mt-1 text-xs">
              {strings.hasty(data.caution.hastyOneWay, data.caution.oneWay)}
            </dd>
            <dd className="text-xs">{strings.undo(data.caution.undone, data.caution.answered)}</dd>
            <dd className="mt-2 text-xs text-typography-500">
              {strings.pace}: {strings.perHour(data.pace.perHour)}
            </dd>
            <dd className="text-xs text-typography-500">
              {strings.byDevice}:{" "}
              {data.byClient
                .map(row => `${row.client} ${row.decisions} (${row.undone} undone)`)
                .join(" · ")}
            </dd>
            <dd className="text-xs text-typography-500">
              {strings.outcome(data.outcome.started, data.outcome.released)}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
};
