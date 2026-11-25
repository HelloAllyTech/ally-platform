import React, { useState } from "react";

import { CHATBOT_UPDATE_AREA, useGetPublicProductUpdatesQuery } from "@api";
import { en } from "@constants";

const t = en.assistantsShell.cornerMenu.changeLogPanel;

const PAGE = 10;
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

/**
 * The drawer's Change log tab: the public change log (`/v1/product-updates/public`, the same feed
 * as the public page) narrowed to Ally Chatbots by its product area. Nothing is written by hand
 * here: an update appears when it goes live, in the order it did, a month at a time.
 */
export const ChangeLogPanel: React.FC = () => {
  const [limit, setLimit] = useState(PAGE);
  const { data, isLoading, isError, isFetching, refetch } = useGetPublicProductUpdatesQuery({
    area: CHATBOT_UPDATE_AREA,
    limit,
  });
  const updates = data?.updates ?? [];

  // Newest first already; start a new heading whenever the month changes.
  const months: { key: string; label: string; items: typeof updates }[] = [];
  for (const update of updates) {
    const when = new Date(update.liveAt);
    const key = `${when.getUTCFullYear()}-${when.getUTCMonth()}`;
    const last = months[months.length - 1];
    if (last?.key === key) last.items.push(update);
    else months.push({ key, label: MONTH.format(when), items: [update] });
  }

  return (
    <div className="ally-v2 corner-changelog" data-testid="corner-menu-changelog">
      <p className="corner-changelog__intro">{t.intro}</p>
      {isLoading && <p className="ally-small">{t.loading}</p>}
      {isError && (
        <div role="alert" className="ally-plan__note" data-testid="changelog-error">
          {t.loadFailed}{" "}
          <button type="button" className="corner-changelog__link" onClick={() => void refetch()}>
            {t.retry}
          </button>
        </div>
      )}
      {data && updates.length === 0 && (
        <p className="ally-small" data-testid="changelog-empty">
          {t.empty}
        </p>
      )}
      {months.map(month => (
        <section key={month.key} aria-label={month.label}>
          <h4 className="corner-changelog__month">{month.label}</h4>
          <ul className="corner-changelog__list">
            {month.items.map(update => (
              <li key={update.id} className="corner-changelog__item" data-testid="changelog-entry">
                <div className="corner-changelog__meta">
                  <span className={`corner-changelog__tag corner-changelog__tag--${update.kind}`}>
                    {t.kinds[update.kind] ?? update.kind}
                  </span>
                  <time dateTime={update.liveAt}>{DAY.format(new Date(update.liveAt))}</time>
                </div>
                <strong>{update.title}</strong>
                <span>{update.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {data && data.count > updates.length && (
        <div className="corner-changelog__more">
          <span className="ally-small">{t.shown(updates.length, data.count)}</span>
          <button
            type="button"
            className="ally-btn"
            disabled={isFetching}
            onClick={() => setLimit(l => l + PAGE)}
            data-testid="changelog-more"
          >
            {t.more}
          </button>
        </div>
      )}
    </div>
  );
};
