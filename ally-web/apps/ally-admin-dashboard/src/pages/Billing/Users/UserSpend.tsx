import React, { useState } from "react";

import { toast } from "sonner";

import { useGetUserSpendQuery, useSetUserSpendCapMutation } from "@api";
import type { SpendSummary } from "@api";
import { Button, ToggleSwitch } from "@components";
import { ButtonVariant } from "@components/types";

import { longDay } from "../../Plan/format";
import { BILLING, fill, labelOf } from "../copy";
import { formatCost, formatCount, formatUsd, parseUsdField } from "../money";
import { NoteConfirm, NoteConfirmRequest } from "../NoteConfirm";
import { PLANS } from "../plansCopy";
import { Field, inputClass } from "../SidePanel";
import { Column, DataTable, HistoryList, serverMessage, Stat } from "../Table";

const S = PLANS.spend;

/** "$40.00", "No cap" or "Never capped". */
export const capLabel = (summary: Pick<SpendSummary, "capUsd" | "capSource">): string =>
  summary.capSource === "off"
    ? S.neverCapped
    : summary.capUsd === null
      ? S.noCap
      : formatUsd(summary.capUsd);

/** Where the cap in force comes from, in words. */
export const capSourceLabel = (summary: Pick<SpendSummary, "capSource" | "planName">): string =>
  summary.capSource === "own"
    ? S.sources.own
    : summary.capSource === "off"
      ? S.sources.off
      : summary.capSource === "plan"
        ? S.sources.plan(summary.planName)
        : S.sources.none(summary.planName);

/** The numbers, the controls and the lists, given the data (also drawn by the tests). */
export const SpendView: React.FC<{
  summary: SpendSummary;
  ownCap: string;
  onOwnCap: (value: string) => void;
  onSaveCap: () => void;
  onUsePlan: () => void;
  onNeverCapped: (on: boolean) => void;
  error?: string | null;
}> = ({ summary, ownCap, onOwnCap, onSaveCap, onUsePlan, onNeverCapped, error }) => {
  const usageColumns = (
    kind: boolean,
  ): Column<{ name: string; tokens: number; costUsd: number }>[] => [
    {
      key: "name",
      label: S.columns.name,
      cell: r => (kind ? labelOf(BILLING.costs.kinds, r.name) : r.name),
    },
    { key: "cost", label: S.columns.cost, numeric: true, cell: r => formatCost(r.costUsd) },
    { key: "tokens", label: S.columns.tokens, numeric: true, cell: r => formatCount(r.tokens) },
  ];
  const atCap = summary.capUsd !== null && summary.usedUsd >= summary.capUsd;
  return (
    <div className="space-y-4" data-testid="user-spend">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 rounded-md border border-border-light p-3 md:p-4">
        <Stat label={S.spent} value={formatCost(summary.usedUsd)} testId="spend-used" />
        <Stat label={S.cap} value={capLabel(summary)} testId="spend-cap" />
        <Stat label={S.capFrom} value={capSourceLabel(summary)} />
        <Stat label={S.resets} value={longDay(summary.resetsOn)} />
      </div>
      {atCap && (
        <p role="status" className="text-sm text-destructive-500" data-testid="spend-at-cap">
          {S.atCap}
        </p>
      )}

      {summary.isCreator ? (
        <div className="space-y-3 rounded-md border border-border-light p-3 md:p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <Field id="spend-own-cap" label={S.ownCap} help={S.ownCapHelp}>
                <input
                  id="spend-own-cap"
                  inputMode="decimal"
                  className={inputClass}
                  value={ownCap}
                  onChange={event => onOwnCap(event.target.value)}
                />
              </Field>
            </div>
            <Button
              variant={ButtonVariant.PRIMARY}
              onClick={onSaveCap}
              data-testid="spend-cap-save"
            >
              {S.saveCap}
            </Button>
            {summary.capSource === "own" && (
              <Button
                variant={ButtonVariant.SECONDARY}
                onClick={onUsePlan}
                data-testid="spend-use-plan"
              >
                {S.usePlan}
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive-500">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-typography-900">{S.neverCapped}</p>
              <p className="text-sm text-typography-600">{S.neverCappedHelp}</p>
            </div>
            <ToggleSwitch
              enabled={summary.capSource === "off"}
              onChange={onNeverCapped}
              label={S.neverCapped}
            />
          </div>
        </div>
      ) : (
        <p className="text-sm text-typography-600">{S.notCreator}</p>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-typography-900">{S.usage}</h4>
        <p className="text-xs text-typography-500">{S.byAssistant}</p>
        <DataTable
          columns={usageColumns(false)}
          rows={summary.usage.byAssistant}
          rowKey={r => `${r.chatbotId}/${r.name}`}
          empty={S.noUsage}
        />
        <p className="text-xs text-typography-500 pt-1">{S.byKind}</p>
        <DataTable
          columns={usageColumns(true)}
          rows={summary.usage.byKind.map(r => ({ ...r, name: r.kind }))}
          rowKey={r => r.name}
          empty={S.noUsage}
        />
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-typography-900">{S.history}</h4>
        <HistoryList entries={summary.history} empty={S.noHistory} />
      </div>
    </div>
  );
};

/**
 * Ally admin → a user → Spend: what this creator's assistants have cost Ally this period against
 * their cost cap, the cap itself (their plan's, their own, or never capped), where the cost went,
 * and the history. Super admins with `manage_costs` only; every change needs a note. The owner
 * never sees any of it: only that their monthly usage is used up, if the cap is reached.
 */
export const UserSpend: React.FC<{ userId: number; name: string }> = ({ userId, name }) => {
  const { data, isLoading, isError } = useGetUserSpendQuery(userId);
  const [setCap] = useSetUserSpendCapMutation();
  const [ownCap, setOwnCap] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<NoteConfirmRequest | null>(null);

  const ask = (
    copy: { title: string; body: string },
    values: Record<string, string>,
    body: { capUsd?: number | null; off?: boolean },
    success: string,
  ) =>
    setConfirm({
      title: copy.title,
      description: fill(copy.body, values),
      confirmLabel: S.save,
      onConfirm: async note => {
        try {
          await setCap({ userId, ...body, note }).unwrap();
          setOwnCap(null);
          toast.success(success);
        } catch (failure) {
          toast.error(serverMessage(failure, PLANS.failed));
          throw failure;
        }
      },
    });

  if (isLoading) return <p className="text-sm text-typography-500">{S.loading}</p>;
  if (isError || !data) return <p className="text-sm text-destructive-500">{S.loadFailed}</p>;

  const shown =
    ownCap ?? (data.capSource === "own" && data.capUsd !== null ? String(data.capUsd) : "");

  return (
    <>
      <SpendView
        summary={data}
        ownCap={shown}
        onOwnCap={value => {
          setError(null);
          setOwnCap(value);
        }}
        error={error}
        onSaveCap={() => {
          const capUsd = parseUsdField(shown);
          if (capUsd === null || !Number.isFinite(capUsd) || capUsd <= 0) {
            return setError(S.badCap);
          }
          setError(null);
          ask(S.confirm.own, { amount: formatUsd(capUsd), user: name }, { capUsd }, S.toast.saved);
        }}
        onUsePlan={() =>
          ask(
            S.confirm.plan,
            { user: name, cap: capLabel({ capUsd: data.planCapUsd, capSource: "plan" }) },
            { capUsd: null },
            S.toast.saved,
          )
        }
        onNeverCapped={on =>
          ask(
            on ? S.confirm.off : S.confirm.on,
            { user: name },
            on ? { off: true } : { capUsd: null, off: false },
            S.toast.saved,
          )
        }
      />
      <NoteConfirm request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
};
