import React, { useState } from "react";

import { Link } from "react-router-dom";

import {
  CostDimension,
  CostPeriod,
  useGetAssistantCostQuery,
  useGetCostBreakdownQuery,
} from "@api";
import { ROUTES } from "@constants";

import { BILLING, labelOf } from "../copy";
import { formatCost, formatCount } from "../money";
import { inputClass, SidePanel } from "../SidePanel";
import { PERIOD_PRESETS, PeriodPreset } from "./period";

const B = BILLING.costs.breakdown;
const A = BILLING.costs.assistant;
const DIMENSIONS: CostDimension[] = ["assistant", "publisher", "kind", "model", "channel"];

/** The Inbox for one conversation: the assistant home's Inbox section, that chat open. */
export const inboxLinkFor = (chatbotId: string, conversationId: string): string =>
  `${ROUTES.CHATBOT_DETAIL.replace(":botId", chatbotId)}?section=conversations&conversation=${encodeURIComponent(conversationId)}`;

const rowLabel = (by: CostDimension, label: string) => {
  if (by === "kind") return labelOf(BILLING.costs.kinds, label);
  if (by === "channel") return labelOf(BILLING.costs.channels, label);
  return label;
};

/** One assistant this period: its cost by kind and its most expensive conversations. */
export const AssistantCostPanel: React.FC<{
  chatbotId: string;
  period: CostPeriod;
  onClose: () => void;
}> = ({ chatbotId, period, onClose }) => {
  const { data, isLoading, isError } = useGetAssistantCostQuery({ chatbotId, ...period });
  return (
    <SidePanel onClose={onClose} testId="billing-assistant-panel">
      {isLoading ? (
        <p className="text-sm text-typography-500">{BILLING.models.loading}</p>
      ) : isError || !data ? (
        <p role="alert" className="text-sm text-destructive-500">
          {A.loadFailed}
        </p>
      ) : (
        <>
          <div className="min-w-0">
            <h2 className="text-2xl font-light break-words">{data.assistant.name ?? A.title}</h2>
            {data.assistant.creatorEmail && (
              <p className="text-sm text-typography-600 break-all">
                {A.creator(data.assistant.creatorEmail)}
              </p>
            )}
            <p className="mt-2 text-sm text-typography-600">{A.total}</p>
            <p className="text-2xl font-secondary tabular-nums">{formatCost(data.total)}</p>
          </div>
          <section className="space-y-2">
            <h3 className="text-lg font-medium">{A.byKind}</h3>
            <ul className="divide-y divide-border-light border border-border-light rounded-md">
              {data.byKind.map(row => (
                <li key={row.kind} className="flex justify-between gap-3 px-3 py-2 text-sm">
                  <span>{labelOf(BILLING.costs.kinds, row.kind)}</span>
                  <span className="tabular-nums text-right">
                    {formatCost(row.cost)}
                    <span className="text-typography-500"> · {formatCount(row.calls)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-2">
            <h3 className="text-lg font-medium">{A.top}</h3>
            {data.topConversations.length === 0 ? (
              <p className="text-sm text-typography-500">{A.noTop}</p>
            ) : (
              <ul className="divide-y divide-border-light border border-border-light rounded-md">
                {data.topConversations.map(c => (
                  <li
                    key={c.conversationId}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="tabular-nums font-medium">{formatCost(c.cost)}</span>
                      <span className="text-typography-600">
                        {" · "}
                        {labelOf(BILLING.costs.channels, c.channel)} · {A.messages(c.messages)} ·{" "}
                        {new Date(c.started).toLocaleDateString("en-GB")}
                      </span>
                    </span>
                    <Link
                      to={inboxLinkFor(chatbotId, c.conversationId)}
                      className="underline text-primary-600"
                    >
                      {A.openInbox}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </SidePanel>
  );
};

/** The breakdown table: a dimension switcher and a period picker. Assistants open a drill-down. */
export const CostBreakdown: React.FC<{
  preset: PeriodPreset;
  period: CostPeriod;
  onPresetChange: (preset: PeriodPreset) => void;
}> = ({ preset, period, onPresetChange }) => {
  const [by, setBy] = useState<CostDimension>("assistant");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: rows = [], isFetching } = useGetCostBreakdownQuery({ by, ...period });

  return (
    <section className="space-y-3" data-testid="billing-cost-breakdown">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <h2 className="text-lg font-medium">{B.title}</h2>
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <label className="text-sm text-typography-700">
            {B.by}
            <select
              className={`${inputClass} mt-1`}
              value={by}
              onChange={event => setBy(event.target.value as CostDimension)}
            >
              {DIMENSIONS.map(d => (
                <option key={d} value={d}>
                  {B.dimensions[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-typography-700">
            {B.period}
            <select
              className={`${inputClass} mt-1`}
              value={preset}
              onChange={event => onPresetChange(event.target.value as PeriodPreset)}
            >
              {PERIOD_PRESETS.map(p => (
                <option key={p} value={p}>
                  {B.periods[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {by === "assistant" && rows.length > 0 && (
        <p className="text-xs text-typography-500">{B.openHint}</p>
      )}
      <div className="overflow-x-auto border border-border-light rounded-md">
        <table className="min-w-full text-sm">
          <thead className="bg-background-secondary text-left text-typography-700">
            <tr>
              <th className="px-3 py-2 font-medium">{B.columns.name}</th>
              <th className="px-3 py-2 font-medium text-right">{B.columns.cost}</th>
              <th className="px-3 py-2 font-medium text-right">{B.columns.calls}</th>
              <th className="px-3 py-2 font-medium text-right">{B.columns.tokens}</th>
              <th className="px-3 py-2 font-medium text-right">{B.columns.unpriced}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-typography-500">
                  {isFetching ? BILLING.models.loading : B.empty}
                </td>
              </tr>
            )}
            {rows.map(row => {
              const clickable = by === "assistant" && Boolean(row.key);
              const name = rowLabel(by, row.label);
              return (
                <tr
                  key={`${row.key}/${row.label}`}
                  className={`border-t border-border-light ${clickable ? "hover:bg-background-secondary" : ""}`}
                >
                  <td className="px-3 py-2 min-w-[160px] break-words">
                    {clickable ? (
                      <button
                        type="button"
                        className="text-left underline text-primary-600"
                        onClick={() => setOpenId(row.key)}
                      >
                        {name}
                      </button>
                    ) : (
                      name
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {formatCost(row.cost)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCount(row.calls)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCount(row.tokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.unpriced ? formatCount(row.unpriced) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {openId && (
        <AssistantCostPanel chatbotId={openId} period={period} onClose={() => setOpenId(null)} />
      )}
    </section>
  );
};
