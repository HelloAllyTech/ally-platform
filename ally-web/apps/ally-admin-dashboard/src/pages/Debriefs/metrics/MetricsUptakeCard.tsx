import React from "react";

import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { DebriefMetricsView } from "@types";

import { fixed } from "./metricsShared";
import { ChangeWhiskers, WhiskerRow } from "../../Analytics/ChangeWhiskers";
import { ChartCard } from "../../Analytics/chartKit";

export const UptakeCard: React.FC<{ uptake: DebriefMetricsView["uptake"] }> = ({ uptake }) => {
  const s = en.debriefs.metrics;
  const rows: WhiskerRow[] = uptake.map(u => {
    const ci: [number, number] | null =
      u.lower != null && u.upper != null ? [u.lower, u.upper] : null;
    return {
      key: u.month,
      label: u.month,
      sublabel: u.insufficient ? s.uptake.insufficient(u.pairs) : s.sections.pairs(u.pairs),
      change: u.insufficient ? null : u.lift,
      ci,
      n: u.pairs,
      detectable: !u.insufficient && !!ci && (ci[0] > 0 || ci[1] < 0),
    };
  });
  return (
    <section data-testid="metrics-uptake">
      <ChartCard
        title={s.uptake.heading}
        titleHelp={<InfoTip label={s.uptake.help} ariaLabel="About uptake lift" />}
        caption={s.sections.uptakeCaption}
        empty={!rows.length}
        emptyText={s.sections.uptakeEmpty}
        height="120px"
      >
        <ChangeWhiskers rows={rows} emptyLabel={s.sections.uptakeEmptyLabel} />
        <ul className="sr-only">
          {uptake.map(u => (
            <li key={u.month} data-testid={`uptake-${u.month}`}>
              {u.month}:{" "}
              {u.insufficient
                ? s.uptake.insufficient(u.pairs)
                : s.uptake.lift(fixed(u.lift, 2), fixed(u.lower, 2), fixed(u.upper, 2), u.pairs)}
            </li>
          ))}
        </ul>
      </ChartCard>
    </section>
  );
};

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */
