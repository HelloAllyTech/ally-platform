import React from "react";

import { useGetWidgetSitesQuery } from "@api";

import { fill } from "../../Onboarding/copy";
import { CHANNELS_COPY } from "../copy/channels";
import { Group } from "../fields";

const t = CHANNELS_COPY.sites;

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * "Sites it has loaded on" (stage 7): the widget may load on any site, so the owner sees where it
 * has been. Editors only (the route is editor+); nothing shows for a viewer.
 */
export const WidgetSites: React.FC<{ botId: string; canEdit: boolean }> = ({ botId, canEdit }) => {
  const { data, isLoading, isError } = useGetWidgetSitesQuery(botId, { skip: !canEdit });
  if (!canEdit) return null;
  const sites = data?.sites ?? [];
  return (
    <Group title={t.title} hint={t.hint} testId="widget-sites">
      {isError ? (
        <p className="ally-error" role="alert">
          {t.loadFailed}
        </p>
      ) : isLoading ? null : sites.length === 0 ? (
        <p className="ally-field__hint">{t.empty}</p>
      ) : (
        <ul className="ally-home__domains">
          {sites.map(site => (
            <li key={site.host}>
              <span className="ally-home__strong">{site.host}</span>
              <span className="ally-small">
                {fill(t.lastSeen, { date: day(site.lastSeen) })} ·{" "}
                {fill(t.loads, { n: String(site.loadCount) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Group>
  );
};
