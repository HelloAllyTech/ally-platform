import React, { useState } from "react";

import { toast } from "sonner";

import {
  useAssignTokensMutation,
  useDeleteTokenGrantMutation,
  useGetUserTokensQuery,
  useRevokeTokenGrantMutation,
  useSetUnlimitedTokensMutation,
  useUpdateTokenGrantMutation,
} from "@api";
import type { TokenGrant, TokenSummary } from "@api";
import { Button, ToggleSwitch } from "@components";
import { ButtonVariant } from "@components/types";

import { longDay } from "../../Plan/format";
import { BILLING, fill, labelOf } from "../copy";
import { formatCost, formatCount } from "../money";
import { NoteConfirm, NoteConfirmRequest } from "../NoteConfirm";
import { PLANS } from "../plansCopy";
import { Field, inputClass } from "../SidePanel";
import { Column, DataTable, HistoryList, serverMessage, Stat } from "../Table";

const T = PLANS.tokens;

type Draft = { grantId?: string; amount: string; renewMonthly: boolean; expiresAt: string };

const toDraft = (grant?: TokenGrant): Draft => ({
  grantId: grant?.id,
  amount: grant ? String(grant.amount) : "",
  renewMonthly: grant?.renewMonthly ?? false,
  expiresAt: grant?.expiresAt ? grant.expiresAt.slice(0, 10) : "",
});

const GrantForm: React.FC<{
  draft: Draft;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  error: string | null;
}> = ({ draft, onChange, onSave, onCancel, error }) => (
  <div
    className="rounded-md border border-border-light p-3 space-y-3"
    data-testid="token-grant-form"
  >
    <p className="text-sm font-medium">{draft.grantId ? T.updateTitle : T.assignTitle}</p>
    {draft.grantId && <p className="text-xs text-typography-500">{T.updateHelp}</p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field id="token-amount" label={T.amount} help={T.amountHelp}>
        <input
          id="token-amount"
          inputMode="numeric"
          className={inputClass}
          value={draft.amount}
          onChange={event => onChange({ ...draft, amount: event.target.value })}
        />
      </Field>
      <Field id="token-expires" label={T.expiresAt} help={T.expiresHelp}>
        <input
          id="token-expires"
          type="date"
          className={inputClass}
          value={draft.expiresAt}
          onChange={event => onChange({ ...draft, expiresAt: event.target.value })}
        />
      </Field>
    </div>
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        checked={draft.renewMonthly}
        onChange={event => onChange({ ...draft, renewMonthly: event.target.checked })}
      />
      <span>
        <span className="block text-typography-900">{T.renewMonthly}</span>
        <span className="block text-xs text-typography-500">{T.renewMonthlyHelp}</span>
      </span>
    </label>
    {error && (
      <p role="alert" className="text-sm text-destructive-500">
        {error}
      </p>
    )}
    <div className="flex flex-wrap gap-2">
      <Button variant={ButtonVariant.PRIMARY} onClick={onSave} data-testid="token-grant-save">
        {T.save}
      </Button>
      <Button variant={ButtonVariant.SECONDARY} onClick={onCancel}>
        {T.cancel}
      </Button>
    </div>
  </div>
);

const grantMeta = (grant: TokenGrant) =>
  [
    T.statuses[grant.status] ?? grant.status,
    grant.renewMonthly && grant.nextRenewalAt ? T.renewsOn(longDay(grant.nextRenewalAt)) : null,
    grant.expiresAt ? T.expiresOn(longDay(grant.expiresAt)) : null,
    grant.note,
  ]
    .filter(Boolean)
    .join(" · ");

/** The summary and lists, given the data (also drawn by the tests). */
export const TokensView: React.FC<{
  summary: TokenSummary;
  onUnlimited: (on: boolean) => void;
  onAssign: () => void;
  onUpdate: (grant: TokenGrant) => void;
  onRevoke: (grant: TokenGrant) => void;
  onDelete: (grant: TokenGrant) => void;
  form?: React.ReactNode;
}> = ({ summary, onUnlimited, onAssign, onUpdate, onRevoke, onDelete, form }) => {
  const usageColumns = (
    kind: boolean,
  ): Column<{ name: string; tokens: number; costUsd: number }>[] => [
    {
      key: "name",
      label: T.columns.name,
      cell: r => (kind ? labelOf(BILLING.costs.kinds, r.name) : r.name),
    },
    { key: "tokens", label: T.columns.tokens, numeric: true, cell: r => formatCount(r.tokens) },
    { key: "cost", label: T.columns.cost, numeric: true, cell: r => formatCost(r.costUsd) },
  ];
  return (
    <div className="space-y-4" data-testid="user-tokens">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-light px-3 md:px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-typography-900">{T.unlimited}</p>
          <p className="text-sm text-typography-600">{T.unlimitedHelp}</p>
        </div>
        <ToggleSwitch enabled={summary.unlimited} onChange={onUnlimited} label={T.unlimited} />
      </div>

      {summary.hasAllowance ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 rounded-md border border-border-light p-3 md:p-4">
          <Stat
            label={T.left}
            value={summary.unlimited ? T.unlimited : formatCount(Math.max(0, summary.left))}
            testId="tokens-left"
          />
          <Stat label={T.granted} value={formatCount(summary.granted)} />
          <Stat label={T.usedThisMonth} value={formatCount(summary.usedThisMonth)} />
          <Stat
            label={summary.overdraft > 0 ? T.overdraft : T.resets}
            value={
              summary.overdraft > 0 ? formatCount(summary.overdraft) : longDay(summary.resetsOn)
            }
          />
        </div>
      ) : (
        <p className="text-sm text-typography-600">{T.none}</p>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-medium text-typography-900">{T.grants}</h4>
          <Button variant={ButtonVariant.TERTIARY} onClick={onAssign} data-testid="token-assign">
            {T.assign}
          </Button>
        </div>
        {form}
        {summary.grants.length === 0 ? (
          <p className="text-sm text-typography-500">{T.noGrants}</p>
        ) : (
          <ul className="divide-y divide-border-light border border-border-light rounded-md">
            {summary.grants.map(grant => (
              <li
                key={grant.id}
                className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm"
                data-testid="token-grant"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-typography-900 tabular-nums">
                    {T.grantLine(formatCount(grant.amount), formatCount(grant.remaining))}
                  </p>
                  <p className="text-typography-600 break-words">{grantMeta(grant)}</p>
                </div>
                {grant.status === "active" && (
                  <span className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="underline text-primary-600 min-h-[32px]"
                      onClick={() => onUpdate(grant)}
                    >
                      {T.update}
                    </button>
                    <button
                      type="button"
                      className="underline text-destructive-500 min-h-[32px]"
                      onClick={() => onRevoke(grant)}
                    >
                      {T.revoke}
                    </button>
                    <button
                      type="button"
                      className="underline text-destructive-500 min-h-[32px] disabled:opacity-50 disabled:no-underline"
                      disabled={grant.used > 0}
                      title={grant.used > 0 ? T.deleteUsed : undefined}
                      onClick={() => onDelete(grant)}
                    >
                      {T.delete}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-typography-900">{T.usage}</h4>
        <p className="text-xs text-typography-500">{T.byAssistant}</p>
        <DataTable
          columns={usageColumns(false)}
          rows={summary.usage.byAssistant}
          rowKey={r => `${r.chatbotId}/${r.name}`}
          empty={T.noUsage}
        />
        <p className="text-xs text-typography-500 pt-1">{T.byKind}</p>
        <DataTable
          columns={usageColumns(true)}
          rows={summary.usage.byKind.map(r => ({ ...r, name: r.kind }))}
          rowKey={r => r.name}
          empty={T.noUsage}
        />
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-typography-900">{T.history}</h4>
        <HistoryList entries={summary.history} empty={T.noHistory} />
      </div>
    </div>
  );
};

/**
 * Ally admin → a user → Tokens (CR1 §B2): the allowance, its grants (assign, update, revoke,
 * delete while unused), Unlimited, this month's use with what it cost Ally, and the history.
 * Super admins with `manage_costs` only; every change needs a note.
 */
export const UserTokens: React.FC<{ userId: number; name: string }> = ({ userId, name }) => {
  const { data, isLoading, isError } = useGetUserTokensQuery(userId);
  const [assign] = useAssignTokensMutation();
  const [update] = useUpdateTokenGrantMutation();
  const [revoke] = useRevokeTokenGrantMutation();
  const [remove] = useDeleteTokenGrantMutation();
  const [setUnlimited] = useSetUnlimitedTokensMutation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<NoteConfirmRequest | null>(null);

  const ask = (
    copy: { title: string; body: string },
    values: Record<string, string>,
    label: string,
    action: (note: string) => Promise<unknown>,
    success: string,
    destructive = false,
  ) =>
    setConfirm({
      title: copy.title,
      description: fill(copy.body, values),
      confirmLabel: label,
      destructive,
      onConfirm: async note => {
        try {
          await action(note);
          toast.success(success);
        } catch (failure) {
          toast.error(serverMessage(failure, PLANS.failed));
          throw failure;
        }
      },
    });

  const saveDraft = () => {
    if (!draft) return;
    const amount = Number(draft.amount.replace(/,/g, "").trim());
    if (!Number.isInteger(amount) || amount <= 0) return setError(T.badAmount);
    setError(null);
    const body = {
      amount,
      renewMonthly: draft.renewMonthly,
      expiresAt: draft.expiresAt || null,
    };
    const shown = formatCount(amount);
    if (draft.grantId) {
      const grantId = draft.grantId;
      ask(
        T.confirm.update,
        { amount: shown },
        T.save,
        async note => {
          await update({ userId, grantId, ...body, note }).unwrap();
          setDraft(null);
        },
        T.toast.updated,
      );
    } else {
      ask(
        T.confirm.assign,
        { amount: shown, user: name },
        T.assign,
        async note => {
          await assign({ userId, ...body, note }).unwrap();
          setDraft(null);
        },
        T.toast.assigned,
      );
    }
  };

  if (isLoading) return <p className="text-sm text-typography-500">{T.loading}</p>;
  if (isError || !data) return <p className="text-sm text-destructive-500">{T.loadFailed}</p>;

  return (
    <>
      <TokensView
        summary={data}
        onUnlimited={on =>
          ask(
            on ? T.unlimitedOn : T.unlimitedOff,
            {},
            T.save,
            note => setUnlimited({ userId, unlimited: on, note }).unwrap(),
            T.toast.unlimited,
          )
        }
        onAssign={() => {
          setError(null);
          setDraft(toDraft());
        }}
        onUpdate={grant => {
          setError(null);
          setDraft(toDraft(grant));
        }}
        onRevoke={grant =>
          ask(
            T.confirm.revoke,
            {},
            T.revoke,
            note => revoke({ userId, grantId: grant.id, note }).unwrap(),
            T.toast.revoked,
            true,
          )
        }
        onDelete={grant =>
          ask(
            T.confirm.delete,
            {},
            T.delete,
            note => remove({ userId, grantId: grant.id, note }).unwrap(),
            T.toast.deleted,
            true,
          )
        }
        form={
          draft && (
            <GrantForm
              draft={draft}
              onChange={setDraft}
              onSave={saveDraft}
              onCancel={() => setDraft(null)}
              error={error}
            />
          )
        }
      />
      <NoteConfirm request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
};
