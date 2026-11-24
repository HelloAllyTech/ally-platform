import React, { useMemo, useState } from "react";

import {
  useGetCreditAccountQuery,
  useGetCreditAccountsQuery,
  useGrantCreditsMutation,
  useRunCreditsCutoverMutation,
  useTransferChatbotBudgetMutation,
} from "@api";
import type { CreditAccountRow, CutoverReport } from "@api";

import { STAFF_CREDITS_COPY as C } from "./copy";
import { money, parseDollars } from "./format";
import { GrantHistory, SpendCharts } from "./MyCredits";

const Card: React.FC<{ title: string; testId?: string; children: React.ReactNode }> = ({
  title,
  testId,
  children,
}) => (
  <section
    className="rounded-md border border-border-light bg-white p-4 md:p-5 min-w-0 space-y-3"
    data-testid={testId}
  >
    <h2 className="text-lg font-medium">{title}</h2>
    {children}
  </section>
);

const inputClass = "border border-border-light rounded-md px-3 py-2 text-sm w-full";
const buttonClass =
  "rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

const errorText = (error: unknown, fallback: string): string => {
  const message = (error as { data?: { message?: string | string[] } })?.data?.message;
  if (Array.isArray(message)) return message.join(" ");
  return message || fallback;
};

export const GrantForm: React.FC<{ accountId: string; ownerUserId?: number }> = ({ accountId }) => {
  const [grant, { isLoading }] = useGrantCreditsMutation();
  const [kind, setKind] = useState<"grant" | "adjustment">("grant");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const g = C.grant;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = parseDollars(amount);
    if (value === null || Number.isNaN(value)) return setMessage({ ok: false, text: g.needAmount });
    if (kind === "grant" && value <= 0) return setMessage({ ok: false, text: g.negativeGrant });
    if (!note.trim()) return setMessage({ ok: false, text: g.needNote });
    try {
      await grant({ accountId, amountUsd: value, kind, note: note.trim() }).unwrap();
      setAmount("");
      setNote("");
      setMessage({ ok: true, text: g.done });
    } catch (error) {
      setMessage({ ok: false, text: errorText(error, g.failed) });
    }
  };

  return (
    <Card title={g.title} testId="staff-grant">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <label className="block text-sm">
          {g.kind}
          <select
            className={inputClass}
            value={kind}
            onChange={e => setKind(e.target.value as "grant" | "adjustment")}
          >
            <option value="grant">{g.grant}</option>
            <option value="adjustment">{g.adjustment}</option>
          </select>
        </label>
        <label className="block text-sm">
          {g.amount}
          <input
            className={inputClass}
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
          <span className="text-xs text-typography-600">{g.amountHint}</span>
        </label>
        <label className="block text-sm">
          {g.note}
          <input className={inputClass} value={note} onChange={e => setNote(e.target.value)} />
        </label>
        <button type="submit" className={buttonClass} disabled={isLoading}>
          {g.action}
        </button>
        {message && (
          <p
            role={message.ok ? "status" : "alert"}
            className={message.ok ? "text-sm" : "text-sm text-red-700"}
            data-testid="staff-grant-message"
          >
            {message.text}
          </p>
        )}
      </form>
    </Card>
  );
};

export const TransferForm: React.FC<{ budgets: { chatbotId: string; name: string | null }[] }> = ({
  budgets,
}) => {
  const [transfer, { isLoading }] = useTransferChatbotBudgetMutation();
  const [chatbotId, setChatbotId] = useState(budgets[0]?.chatbotId ?? "");
  const [toUser, setToUser] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const t = C.transfer;
  if (budgets.length === 0) {
    return (
      <Card title={t.title} testId="staff-transfer">
        <p className="text-sm">{t.none}</p>
      </Card>
    );
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const userId = Number(toUser);
    if (!Number.isInteger(userId) || userId <= 0)
      return setMessage({ ok: false, text: t.needUser });
    try {
      await transfer({ chatbotId: chatbotId || budgets[0].chatbotId, toUserId: userId }).unwrap();
      setToUser("");
      setMessage({ ok: true, text: t.done });
    } catch (error) {
      setMessage({ ok: false, text: errorText(error, t.failed) });
    }
  };
  return (
    <Card title={t.title} testId="staff-transfer">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <label className="block text-sm">
          {t.chatbot}
          <select
            className={inputClass}
            value={chatbotId || budgets[0].chatbotId}
            onChange={e => setChatbotId(e.target.value)}
          >
            {budgets.map(b => (
              <option key={b.chatbotId} value={b.chatbotId}>
                {b.name ?? b.chatbotId}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          {t.toUser}
          <input
            className={inputClass}
            inputMode="numeric"
            value={toUser}
            onChange={e => setToUser(e.target.value)}
          />
        </label>
        <button type="submit" className={buttonClass} disabled={isLoading}>
          {t.action}
        </button>
        {message && (
          <p
            role={message.ok ? "status" : "alert"}
            className={message.ok ? "text-sm" : "text-sm text-red-700"}
            data-testid="staff-transfer-message"
          >
            {message.text}
          </p>
        )}
      </form>
    </Card>
  );
};

export const CutoverReportView: React.FC<{ report: CutoverReport }> = ({ report }) => {
  const r = C.cutover.report;
  return (
    <div className="space-y-1 text-sm" data-testid="staff-cutover-report">
      <p className="font-medium">{report.dryRun ? r.dryTitle : r.doneTitle}</p>
      <p>
        {r.credits}: {money(report.startingCreditsUsd)} · {r.budget}:{" "}
        {money(report.startingBudgetUsd)}
      </p>
      <p>
        {r.builders}: {report.totals.buildersGranted} · {r.budgets}: {report.totals.budgetsSet} ·{" "}
        {r.skipped}: {report.totals.skipped} · {r.total}: {money(report.totals.grantedUsd)}
      </p>
      {report.budgets
        .filter(b => b.outcome === "skipped")
        .map(b => (
          <p key={b.chatbotId} className="text-xs text-typography-600">
            {b.chatbotId}: {b.reason ?? "skipped"}
          </p>
        ))}
    </div>
  );
};

export const CutoverCard: React.FC = () => {
  const [run, { isLoading }] = useRunCreditsCutoverMutation();
  const [report, setReport] = useState<CutoverReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = C.cutover;
  const go = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm(t.confirm)) return;
    setError(null);
    try {
      setReport(await run({ dryRun }).unwrap());
    } catch (e) {
      setError(errorText(e, t.failed));
    }
  };
  return (
    <Card title={t.title} testId="staff-cutover">
      <p className="text-sm">{t.body}</p>
      <div className="flex gap-3">
        <button type="button" className={buttonClass} disabled={isLoading} onClick={() => go(true)}>
          {t.dry}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={isLoading || !report?.dryRun}
          onClick={() => go(false)}
        >
          {t.run}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {report && <CutoverReportView report={report} />}
    </Card>
  );
};

const Ledger: React.FC<{ accountId: string; onBack: () => void }> = ({ accountId, onBack }) => {
  const { data, isLoading, isError } = useGetCreditAccountQuery(accountId);
  if (isLoading) return <p className="text-sm">…</p>;
  if (isError || !data)
    return (
      <p role="alert" className="text-sm text-red-700">
        {C.loadFailed}
      </p>
    );
  return (
    <div className="space-y-4" data-testid="staff-ledger">
      <button type="button" className="text-sm underline" onClick={onBack}>
        {C.ledger.back}
      </button>
      <Card title={C.ledger.title}>
        <p className="text-sm">
          {money(data.grantedUsd)} · {money(data.usedUsd)} · {money(data.setAsideUsd)} ·{" "}
          <strong data-testid="staff-ledger-free">{money(data.freeBalanceUsd)}</strong>
        </p>
        <table className="w-full text-sm" data-testid="staff-ledger-budgets">
          <caption className="text-left font-medium">{C.ledger.budgets}</caption>
          <tbody>
            {data.budgets.map(b => (
              <tr key={b.chatbotId}>
                <td>{b.name ?? b.chatbotId}</td>
                <td align="right">{money(b.setAsideUsd)}</td>
                <td align="right">{money(b.spentUsd)}</td>
                <td align="right">{money(b.remainingUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <SpendCharts view={data} testId="staff-ledger-spend" />
      <GrantHistory grants={data.grants} title={C.ledger.grants} />
      <GrantForm accountId={accountId} />
      <TransferForm budgets={data.budgets.filter(b => !b.archived)} />
    </div>
  );
};

const matches = (row: CreditAccountRow, q: string) =>
  !q || (row.name ?? "").toLowerCase().includes(q) || (row.email ?? "").toLowerCase().includes(q);

/** Ally admin -> Credits (`manage_costs`, checked by ally-be and by the route). */
export const StaffCredits: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { data, isLoading, isError } = useGetCreditAccountsQuery();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(
    () => (data ?? []).filter(r => matches(r, query.trim().toLowerCase())),
    [data, query],
  );
  const a = C.accounts;
  return (
    <div className={embedded ? "space-y-4" : "p-4 md:p-6 space-y-4"} data-testid="staff-credits">
      {!embedded && (
        <header>
          <h1 className="text-2xl font-medium">{C.title}</h1>
          <p className="text-sm text-typography-600">{C.intro}</p>
        </header>
      )}
      {open ? (
        <Ledger accountId={open} onBack={() => setOpen(null)} />
      ) : (
        <>
          <Card title={a.title} testId="staff-accounts">
            <input
              className={inputClass}
              aria-label={a.search}
              placeholder={a.search}
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {isLoading && <p className="text-sm">…</p>}
            {isError && (
              <p role="alert" className="text-sm text-red-700">
                {C.loadFailed}
              </p>
            )}
            {data && rows.length === 0 && <p className="text-sm">{a.none}</p>}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th align="left">{a.columns.builder}</th>
                      <th align="left">{a.columns.status}</th>
                      <th align="right">{a.columns.granted}</th>
                      <th align="right">{a.columns.setAside}</th>
                      <th align="right">{a.columns.used}</th>
                      <th align="right">{a.columns.free}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.accountId} data-testid="staff-account-row">
                        <td>{r.name ?? r.email ?? `#${r.ownerUserId}`}</td>
                        <td>{r.status}</td>
                        <td align="right">{money(r.grantedUsd)}</td>
                        <td align="right">{money(r.setAsideUsd)}</td>
                        <td align="right">{money(r.builderSpentUsd)}</td>
                        <td align="right">{money(r.freeBalanceUsd)}</td>
                        <td>
                          <button
                            type="button"
                            className="underline"
                            onClick={() => setOpen(r.accountId)}
                          >
                            {a.open}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <CutoverCard />
        </>
      )}
    </div>
  );
};
