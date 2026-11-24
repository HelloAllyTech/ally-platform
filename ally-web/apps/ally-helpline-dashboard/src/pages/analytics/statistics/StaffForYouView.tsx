import { FunctionComponent, useMemo, useState } from "react";

import { useTranslation } from "react-i18next";

import { useUser } from "@hooks";
import type { CustomerOverview } from "@types";

import {
  CUSTOMER_CARD_IDS,
  CustomerCard,
  CustomerCardId,
  DEFAULT_CUSTOMER_LAYOUT,
} from "./CustomersView";
import { LiveNumbers } from "./seen";
import { useSeenComparison } from "./useSeenComparison";

export const CUSTOMERS_SEEN_PREF_KEY = "statistics_seen_customers";

/** The cards a person kept, in the page's own order, or the defaults for someone who never chose. */
export const resolveCustomerLayout = (saved: unknown): CustomerCardId[] => {
  if (!Array.isArray(saved)) return DEFAULT_CUSTOMER_LAYOUT;
  const known = new Set<string>(CUSTOMER_CARD_IDS);
  const kept = new Set(saved.filter((id): id is string => typeof id === "string" && known.has(id)));
  return CUSTOMER_CARD_IDS.filter(id => kept.has(id));
};

interface StaffForYouViewProps {
  overview: CustomerOverview;
  /** The saved list of card ids, or nothing for someone who never chose. */
  saved: unknown;
  onLayoutChange: (ids: CustomerCardId[]) => void;
}

/**
 * For you, for Ally staff: how every customer organisation is doing and who to
 * get in touch with. Staff start with a default set of cards and can remove any
 * and add others (the ones they have not got) under Customise.
 */
export const StaffForYouView: FunctionComponent<StaffForYouViewProps> = ({
  overview,
  saved,
  onLayoutChange,
}) => {
  const { t, i18n } = useTranslation();
  const { user } = useUser();
  const [editing, setEditing] = useState(false);
  const layout = useMemo(() => resolveCustomerLayout(saved), [saved]);
  const available = CUSTOMER_CARD_IDS.filter(id => !layout.includes(id));

  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? "";

  // The organisations asking for a message: the findings this page compares with last time.
  const live: LiveNumbers = {
    fingerprints: overview.orgs
      .filter(o => o.score > 0 && !o.recentlyContacted)
      .map(o => o.tenantId),
    active: overview.summary.activeOrgs,
    sessions: overview.summary.orgs,
  };
  const { since } = useSeenComparison(CUSTOMERS_SEEN_PREF_KEY, live);
  const total = live.fingerprints.length;
  const date = since
    ? new Date(since.at).toLocaleDateString(i18n.language, {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "";
  let focus: string;
  if (!since) {
    focus =
      total > 0
        ? t("statisticsLibrary.customers.summary.needs", { count: total })
        : t("statisticsLibrary.customers.summary.none");
  } else if (since.added > 0 || since.resolved > 0) {
    focus =
      total > 0
        ? t("statisticsLibrary.customers.summary.since.changed", {
            date,
            added: since.added,
            resolved: since.resolved,
            count: total,
          })
        : t("statisticsLibrary.customers.summary.since.allClear", {
            date,
            resolved: since.resolved,
          });
  } else {
    focus =
      total > 0
        ? t("statisticsLibrary.customers.summary.since.same", { date, count: total })
        : t("statisticsLibrary.customers.summary.since.sameClear", { date });
  }

  const remove = (id: CustomerCardId) => onLayoutChange(layout.filter(x => x !== id));
  const add = (id: CustomerCardId) =>
    onLayoutChange(CUSTOMER_CARD_IDS.filter(x => x === id || layout.includes(x)));

  return (
    <div className="flex flex-col gap-6 py-4" data-testid="statistics-view-foryou">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2
          className="font-secondary text-3xl font-medium text-typography-900"
          data-testid="statistics-greeting"
        >
          {firstName
            ? t(`statisticsLibrary.forYou.greeting.${part}`, { name: firstName })
            : t(`statisticsLibrary.forYou.greetingNoName.${part}`)}
        </h2>
        {editing ? (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="min-h-11 rounded border border-[#264d8e] bg-[#264d8e] px-4 text-sm font-medium text-white"
            data-testid="customers-done"
          >
            {t("statisticsLibrary.done")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-11 rounded border border-[#264d8e] bg-white px-4 text-sm font-medium text-[#264d8e]"
            data-testid="customers-customise"
          >
            {t("statisticsLibrary.customise")}
          </button>
        )}
      </div>

      <div
        className="flex flex-col gap-1 text-base text-typography-700"
        data-testid="statistics-summary"
      >
        <p>
          {t("statisticsLibrary.customers.summary.activity", {
            active: overview.summary.activeOrgs,
            count: overview.summary.orgs,
          })}
        </p>
        <p>{focus}</p>
      </div>

      {layout.length === 0 && (
        <p
          className="rounded border border-dashed border-border-light p-6 text-sm text-typography-600"
          data-testid="customers-empty"
        >
          {t("statisticsLibrary.customers.empty")}
        </p>
      )}
      {layout.map(id => (
        <div key={id} className="relative">
          {editing && (
            <button
              type="button"
              onClick={() => remove(id)}
              aria-label={t("statisticsLibrary.customers.removeAria", {
                title: t(`statisticsLibrary.customers.cards.${id}`),
              })}
              className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded text-typography-500 hover:bg-background-secondary hover:text-typography-900"
              data-testid={`customers-remove-${id}`}
            >
              &times;
            </button>
          )}
          <CustomerCard id={id} overview={overview} />
        </div>
      ))}

      {editing && (
        <section
          className="flex flex-col gap-3 rounded-xl border border-dashed border-[#9db5dd] p-5"
          aria-label={t("statisticsLibrary.customers.library")}
          data-testid="customers-library"
        >
          <h3 className="text-base font-semibold text-typography-900">
            {t("statisticsLibrary.customers.library")}
          </h3>
          {available.length === 0 ? (
            <p className="text-sm text-typography-600">
              {t("statisticsLibrary.customers.libraryNone")}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {available.map(id => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => add(id)}
                    className="min-h-11 rounded border border-border-light bg-white px-4 text-sm text-typography-900"
                    data-testid={`customers-add-${id}`}
                  >
                    + {t(`statisticsLibrary.customers.cards.${id}`)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
};
