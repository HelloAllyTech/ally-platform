import React from "react";

import type { CostAlert, CostOverview } from "@api";

import { BILLING, labelOf } from "../copy";
import { formatCost } from "../money";

const C = BILLING.costs;

const Tile: React.FC<{
  label: string;
  value: string;
  help?: string;
  testId?: string;
  className?: string;
}> = ({ label, value, help, testId, className }) => (
  <div
    className={`rounded-md border border-border-light bg-white px-4 py-3 min-w-0 ${className ?? ""}`}
    data-testid={testId}
  >
    <p className="text-sm text-typography-600">{label}</p>
    <p className="text-2xl font-secondary text-typography-900 tabular-nums break-words">{value}</p>
    {help && <p className="mt-1 text-xs text-typography-500">{help}</p>}
  </div>
);

/** Today, this week, this month; the month all in; WhatsApp fees on their own. */
export const CostTotals: React.FC<{ overview: CostOverview }> = ({ overview }) => (
  <div className="space-y-3">
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="billing-cost-totals">
      <Tile label={C.totals.today} value={formatCost(overview.today)} testId="cost-today" />
      <Tile label={C.totals.week} value={formatCost(overview.week)} testId="cost-week" />
      <Tile label={C.totals.month} value={formatCost(overview.month)} testId="cost-month" />
      <Tile
        label={C.totals.monthWithFixed}
        value={formatCost(overview.monthWithFixed)}
        help={C.totals.monthWithFixedHelp(
          formatCost(overview.fixedMonth),
          formatCost(overview.otherProductsMonth),
        )}
        testId="cost-month-all-in"
      />
      <Tile
        label={C.totals.whatsapp}
        value={formatCost(overview.whatsappMonth)}
        help={C.totals.whatsappHelp}
        testId="cost-whatsapp"
        // The fifth tile: across both columns on a phone rather than alone in half a row.
        className="col-span-2 lg:col-span-1"
      />
    </div>
    {overview.unpricedEventsMonth > 0 && (
      <p className="text-sm text-warning-800 bg-warning-50 border border-warning-300 rounded-md px-3 py-2">
        {C.totals.unpriced(overview.unpricedEventsMonth)}
      </p>
    )}
  </div>
);

/** Cost per customer conversation and per customer message, this month. */
export const PerCustomer: React.FC<{ overview: CostOverview }> = ({ overview }) => (
  <section className="space-y-2" data-testid="billing-per-customer">
    <h2 className="text-lg font-medium">{C.perUnit.title}</h2>
    {overview.customerConversations === 0 ? (
      <p className="text-sm text-typography-500">{C.perUnit.none}</p>
    ) : (
      <>
        <div className="grid grid-cols-2 gap-3">
          <Tile label={C.perUnit.conversation} value={formatCost(overview.costPerConversation)} />
          <Tile label={C.perUnit.message} value={formatCost(overview.costPerMessage)} />
        </div>
        <p className="text-xs text-typography-500">
          {C.perUnit.counts(overview.customerConversations, overview.customerMessages)}
        </p>
      </>
    )}
  </section>
);

/** The alerts banner: what crossed a line in the last 7 days. */
export const AlertsBanner: React.FC<{ alerts: CostAlert[] }> = ({ alerts }) =>
  alerts.length ? (
    <div
      role="status"
      data-testid="billing-cost-alerts"
      className="rounded-md border border-warning-300 bg-warning-50 px-4 py-3"
    >
      <p className="font-medium text-typography-900">{C.alerts.title}</p>
      <ul className="mt-1 space-y-1 text-sm">
        {alerts.map(alert => (
          <li key={`${alert.kind}/${alert.subjectKey}/${alert.day}`} className="break-words">
            <span className="font-medium">{labelOf(C.alerts.kinds, alert.kind)}</span>
            {" · "}
            <span className="text-typography-800">{alert.detail?.message ?? alert.subjectKey}</span>
            <span className="text-typography-500"> · {alert.day}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
