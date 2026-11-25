import { FunctionComponent, ReactNode, useState } from "react";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useRecordCustomerOutreachMutation } from "@api";
import type { CustomerMover, CustomerOrgRow, CustomerOverview, CustomerReason } from "@types";

import { draftMessage } from "./customerDrafts";

const Spark: FunctionComponent<{ series: number[] }> = ({ series }) => {
  const max = Math.max(1, ...series);
  const step = 80 / Math.max(1, series.length - 1);
  const points = series.map((v, i) => `${i * step},${22 - (v / max) * 20}`).join(" ");
  return (
    <svg viewBox="0 0 80 24" width="80" height="24" aria-hidden="true">
      <polyline points={points} fill="none" stroke="#2A5DB0" strokeWidth="1.5" />
    </svg>
  );
};

/** One reason, written from its numbers, in the reader's language. */
const ReasonChip: FunctionComponent<{ reason: CustomerOrgRow["reasons"][number] }> = ({
  reason,
}) => {
  const { t } = useTranslation();
  const worry = reason.polarity === "attention";
  const params = { ...reason.params, count: reason.params.count ?? reason.params.learners };
  return (
    <li
      className={`rounded-full px-3 py-1 text-xs ${
        worry ? "bg-[#f6e0d2] text-[#7a3205]" : "bg-[#dceee2] text-[#1e6b3a]"
      }`}
      data-testid={`customers-reason-${reason.id}`}
    >
      {t(`statisticsLibrary.customers.reasons.${reason.id}`, params)}
    </li>
  );
};

const ReachRow: FunctionComponent<{ org: CustomerOrgRow }> = ({ org }) => {
  const { t, i18n } = useTranslation();
  const [panel, setPanel] = useState<"draft" | "contacted" | null>(null);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [record, { isLoading }] = useRecordCustomerOutreachMutation();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draftMessage(org));
      setCopied(true);
    } catch {
      toast.error(t("statisticsLibrary.customers.copyFailed"));
    }
  };
  const save = async () => {
    try {
      await record({ tenantId: org.tenantId, note: note.trim() || undefined }).unwrap();
      setPanel(null);
      setNote("");
    } catch {
      toast.error(t("statisticsLibrary.customers.saveFailed"));
    }
  };

  return (
    <li
      className="flex flex-col gap-2 border-t border-[#efebe0] py-4 first:border-t-0"
      data-testid={`customers-reach-${org.tenantId}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-base font-semibold text-typography-900">{org.name}</h4>
        <span className="text-xs text-typography-600">
          {t("statisticsLibrary.customers.learnersLine", {
            count: org.learners,
            active: org.activeLearners28d,
          })}
        </span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {org.reasons.map(r => (
          <ReasonChip key={r.id} reason={r} />
        ))}
      </ul>
      {org.contactedAt && (
        <p className="text-xs text-typography-600" data-testid="customers-contacted">
          {t("statisticsLibrary.customers.contactedOn", {
            date: new Date(org.contactedAt).toLocaleDateString(i18n.language, {
              day: "numeric",
              month: "short",
            }),
          })}
          {org.contactNote ? ` — ${org.contactNote}` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setPanel(panel === "draft" ? null : "draft")}
          className="min-h-11 rounded border border-[#264d8e] bg-white px-4 text-sm font-medium text-[#264d8e]"
          data-testid={`customers-draft-${org.tenantId}`}
        >
          {t(
            panel === "draft"
              ? "statisticsLibrary.customers.hideDraft"
              : "statisticsLibrary.customers.draft",
          )}
        </button>
        <button
          type="button"
          onClick={() => setPanel(panel === "contacted" ? null : "contacted")}
          className="min-h-11 rounded border border-border-light bg-white px-4 text-sm font-medium text-typography-900"
          data-testid={`customers-contacted-open-${org.tenantId}`}
        >
          {t("statisticsLibrary.customers.markContacted")}
        </button>
      </div>
      {panel === "draft" && (
        <div className="flex flex-col gap-2 rounded border border-[#e3ded2] bg-[#faf8f3] p-4">
          <pre
            className="whitespace-pre-wrap font-sans text-sm text-typography-900"
            data-testid="customers-draft-text"
          >
            {draftMessage(org)}
          </pre>
          <button
            type="button"
            onClick={copy}
            className="min-h-11 self-start rounded border border-[#264d8e] bg-[#264d8e] px-4 text-sm font-medium text-white"
            data-testid="customers-copy"
          >
            {t(copied ? "statisticsLibrary.customers.copied" : "statisticsLibrary.customers.copy")}
          </button>
        </div>
      )}
      {panel === "contacted" && (
        <div className="flex flex-col gap-2 rounded border border-[#e3ded2] bg-[#faf8f3] p-4">
          <label className="flex flex-col gap-1 text-sm text-typography-900">
            {t("statisticsLibrary.customers.noteLabel")}
            <input
              type="text"
              maxLength={500}
              value={note}
              onChange={e => setNote(e.target.value)}
              className="min-h-11 rounded border border-border-light bg-white px-3"
              data-testid="customers-note"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={isLoading}
              className="min-h-11 rounded border border-[#264d8e] bg-[#264d8e] px-4 text-sm font-medium text-white disabled:opacity-60"
              data-testid="customers-save-contact"
            >
              {t("statisticsLibrary.customers.save")}
            </button>
            <button
              type="button"
              onClick={() => setPanel(null)}
              className="min-h-11 px-3 text-sm font-medium text-typography-600"
            >
              {t("statisticsLibrary.customers.cancel")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
};

const Mover: FunctionComponent<{ mover: CustomerMover }> = ({ mover }) => {
  const { t } = useTranslation();
  return (
    <li className="flex items-baseline justify-between gap-3 text-sm">
      <span className="truncate text-typography-900">{mover.name}</span>
      <span className="flex-none text-typography-600">
        {t("statisticsLibrary.customers.moverLine", { from: mover.from, to: mover.to })}
      </span>
    </li>
  );
};

const Strip: FunctionComponent<{ summary: CustomerOverview["summary"] }> = ({ summary }) => {
  const { t } = useTranslation();
  const tiles = [
    ["orgs", summary.orgs],
    ["active", summary.activeOrgs],
    ["quiet", summary.quietOrgs],
    ["needs", summary.needsOutreach],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4" data-testid="customers-strip">
      {tiles.map(([key, value]) => (
        <div key={key} className="rounded-xl border border-[#e3ded2] bg-white p-5">
          <p className="text-sm text-typography-600">
            {t(`statisticsLibrary.customers.strip.${key}`)}
          </p>
          <p className="font-secondary text-3xl font-semibold text-typography-900">{value}</p>
        </div>
      ))}
    </div>
  );
};

/**
 * The cards of the Customers page, which is Ally staff's For you. Each is a
 * small view of the same overview. A person keeps the ones they want
 * (`statistics_layouts.customers`); the first four are what everyone starts with.
 */
export const CUSTOMER_CARD_IDS = [
  "strip",
  "reach",
  "up",
  "down",
  "table",
  "quiet",
  "credits",
  "lowRating",
] as const;
export type CustomerCardId = (typeof CUSTOMER_CARD_IDS)[number];

/** What staff see until they choose their own. */
export const DEFAULT_CUSTOMER_LAYOUT: CustomerCardId[] = ["strip", "reach", "up", "down", "table"];

/** The cards that are a short list of the organisations with one kind of reason. */
const REASON_CARDS: Partial<Record<CustomerCardId, CustomerReason["id"][]>> = {
  quiet: ["neverActive", "quiet"],
  credits: ["creditsNearLimit"],
  lowRating: ["lowRating", "reviewsBehind"],
};

const Card: FunctionComponent<{ title: string; testId: string; children: ReactNode }> = ({
  title,
  testId,
  children,
}) => (
  <section
    className="flex flex-col gap-2 rounded-xl border border-[#e3ded2] bg-white px-6 py-5"
    aria-label={title}
    data-testid={testId}
  >
    <h3 className="text-xl font-semibold text-typography-900">{title}</h3>
    {children}
  </section>
);

const ReasonList: FunctionComponent<{ orgs: CustomerOrgRow[]; ids: CustomerReason["id"][] }> = ({
  orgs,
  ids,
}) => {
  const { t } = useTranslation();
  const rows = orgs
    .map(org => ({ org, reasons: org.reasons.filter(r => ids.includes(r.id)) }))
    .filter(row => row.reasons.length > 0);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-typography-600">{t("statisticsLibrary.customers.listNone")}</p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map(({ org, reasons }) => (
        <li key={org.tenantId} className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-typography-900">{org.name}</span>
          <ul className="flex flex-wrap gap-2">
            {reasons.map(r => (
              <ReasonChip key={r.id} reason={r} />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
};

/** One card of the Customers page, by id. */
export const CustomerCard: FunctionComponent<{
  id: CustomerCardId;
  overview: CustomerOverview;
}> = ({ id, overview }) => {
  const { t, i18n } = useTranslation();
  const title = t(`statisticsLibrary.customers.cards.${id}`);
  const testId = `customers-card-${id}`;

  if (id === "strip") {
    return (
      <div data-testid={testId}>
        <Strip summary={overview.summary} />
      </div>
    );
  }
  if (id === "reach") {
    const reach = overview.orgs.filter(o => o.score > 0);
    return (
      <Card title={title} testId={testId}>
        {reach.length === 0 ? (
          <p className="text-sm text-typography-600" data-testid="customers-reach-none">
            {t("statisticsLibrary.customers.reachNone")}
          </p>
        ) : (
          <ul>
            {reach.map(org => (
              <ReachRow key={org.tenantId} org={org} />
            ))}
          </ul>
        )}
      </Card>
    );
  }
  if (id === "up" || id === "down") {
    const list = overview.movers[id];
    return (
      <Card title={title} testId={testId}>
        {list.length === 0 ? (
          <p className="text-sm text-typography-600">{t("statisticsLibrary.customers.listNone")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map(m => (
              <Mover key={m.tenantId} mover={m} />
            ))}
          </ul>
        )}
      </Card>
    );
  }
  if (id === "table") {
    return (
      <Card title={title} testId={testId}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="customers-table">
            <thead className="text-xs text-typography-600">
              <tr>
                {[
                  "name",
                  "learners",
                  "active",
                  "sessions",
                  "lastActive",
                  "credits",
                  "rating",
                  "trend",
                ].map(col => (
                  <th key={col} className="px-4 py-3 font-medium">
                    {t(`statisticsLibrary.customers.columns.${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overview.orgs.map(org => (
                <tr
                  key={org.tenantId}
                  className="border-t border-[#efebe0]"
                  data-testid={`customers-row-${org.tenantId}`}
                >
                  <td className="px-4 py-3 font-medium text-typography-900">{org.name}</td>
                  <td className="px-4 py-3">{org.learners}</td>
                  <td className="px-4 py-3">{org.activeLearners28d}</td>
                  <td className="px-4 py-3">{org.completedLast28d}</td>
                  <td className="px-4 py-3">
                    {org.daysSinceLastCompleted === null
                      ? t("statisticsLibrary.customers.never")
                      : t("statisticsLibrary.customers.daysAgo", {
                          count: org.daysSinceLastCompleted,
                        })}
                  </td>
                  <td className="px-4 py-3">
                    {org.creditUtilisationPct === null
                      ? "—"
                      : `${Math.round(org.creditUtilisationPct)}%`}
                  </td>
                  <td className="px-4 py-3">
                    {org.ratingsAverage90d === null ? "—" : org.ratingsAverage90d.toFixed(1)}
                  </td>
                  <td className="px-4 py-3">
                    <Spark series={org.trend} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-typography-500">
          {t("statisticsLibrary.customers.updated", {
            time: new Date(overview.generatedAt).toLocaleTimeString(i18n.language, {
              hour: "2-digit",
              minute: "2-digit",
            }),
          })}
        </p>
      </Card>
    );
  }
  return (
    <Card title={title} testId={testId}>
      <ReasonList orgs={overview.orgs} ids={REASON_CARDS[id] ?? []} />
    </Card>
  );
};
