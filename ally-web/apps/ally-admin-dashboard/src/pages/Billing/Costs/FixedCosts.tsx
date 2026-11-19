import React, { useState } from "react";

import { toast } from "sonner";

import {
  FixedCost,
  useAddFixedCostMutation,
  useDeleteFixedCostMutation,
  useEditFixedCostMutation,
  useGetFixedCostsQuery,
} from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";

import { BILLING, fill } from "../copy";
import { formatUsd, microsToUsd, parseUsdField, thisMonth } from "../money";
import { NoteConfirm, NoteConfirmRequest } from "../NoteConfirm";
import { inputClass } from "../SidePanel";

const F = BILLING.costs.fixed;

const errorMessage = (error: unknown): string =>
  (error as { data?: { message?: string } })?.data?.message || BILLING.models.toast.failed;

type Draft = { id?: string; label: string; amount: string };

/** Fixed monthly costs (chunk-cr1 §A3): hosting, database, subscriptions, by hand per month. */
export const FixedCosts: React.FC = () => {
  const [month, setMonth] = useState(thisMonth());
  const { data: costs = [] } = useGetFixedCostsQuery(month);
  const [addCost] = useAddFixedCostMutation();
  const [editCost] = useEditFixedCostMutation();
  const [deleteCost] = useDeleteFixedCostMutation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<NoteConfirmRequest | null>(null);

  const total = costs.reduce((sum, c) => sum + (microsToUsd(c.amountMicros) ?? 0), 0);

  const save = () => {
    if (!draft) return;
    const label = draft.label.trim();
    const amount = parseUsdField(draft.amount);
    if (!label) return setError(F.badLabel);
    if (amount === null || !Number.isFinite(amount) || amount < 0) return setError(F.badAmount);
    setError(null);
    const copy = draft.id ? F.confirm.edit : F.confirm.add;
    setConfirm({
      title: copy.title,
      description: fill(copy.body, { label, amount: formatUsd(amount), month }),
      confirmLabel: F.save,
      onConfirm: async note => {
        try {
          const body = { month, label, amountUsd: amount, note };
          if (draft.id) await editCost({ id: draft.id, ...body }).unwrap();
          else await addCost(body).unwrap();
          toast.success(F.toast.saved);
          setDraft(null);
        } catch (e) {
          toast.error(errorMessage(e));
          throw e;
        }
      },
    });
  };

  const remove = (cost: FixedCost) =>
    setConfirm({
      title: F.confirm.delete.title,
      description: fill(F.confirm.delete.body, { label: cost.label, month }),
      confirmLabel: F.delete,
      destructive: true,
      onConfirm: async note => {
        try {
          await deleteCost({ id: cost.id, note }).unwrap();
          toast.success(F.toast.deleted);
        } catch (e) {
          toast.error(errorMessage(e));
          throw e;
        }
      },
    });

  return (
    <section className="space-y-3" data-testid="billing-fixed-costs">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">{F.title}</h2>
          <p className="text-sm text-typography-600">{F.intro}</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-sm text-typography-700">
            {F.month}
            <input
              type="month"
              className={`${inputClass} mt-1`}
              value={month}
              onChange={event => {
                setMonth(event.target.value || thisMonth());
                setDraft(null);
              }}
            />
          </label>
          <Button
            variant={ButtonVariant.TERTIARY}
            onClick={() => {
              setError(null);
              setDraft({ label: "", amount: "" });
            }}
          >
            {F.add}
          </Button>
        </div>
      </div>

      <ul className="divide-y divide-border-light border border-border-light rounded-md">
        {costs.length === 0 && !draft && (
          <li className="px-3 py-3 text-sm text-typography-500">{F.empty}</li>
        )}
        {costs.map(cost =>
          draft?.id === cost.id ? null : (
            <li
              key={cost.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="min-w-0 break-words">{cost.label}</span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{formatUsd(microsToUsd(cost.amountMicros))}</span>
                <button
                  type="button"
                  className="underline text-primary-600 min-h-[32px]"
                  onClick={() => {
                    setError(null);
                    setDraft({
                      id: cost.id,
                      label: cost.label,
                      amount: String(microsToUsd(cost.amountMicros) ?? ""),
                    });
                  }}
                >
                  {F.edit}
                </button>
                <button
                  type="button"
                  className="underline text-destructive-500 min-h-[32px]"
                  onClick={() => remove(cost)}
                >
                  {F.delete}
                </button>
              </span>
            </li>
          ),
        )}
        {draft && (
          <li className="px-3 py-3 space-y-2" data-testid="billing-fixed-cost-form">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-2">
              <input
                aria-label={F.label}
                className={inputClass}
                value={draft.label}
                placeholder={F.labelPlaceholder}
                onChange={event => setDraft({ ...draft, label: event.target.value })}
              />
              <input
                aria-label={F.amount}
                className={inputClass}
                inputMode="decimal"
                value={draft.amount}
                placeholder="0.00"
                onChange={event => setDraft({ ...draft, amount: event.target.value })}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive-500">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant={ButtonVariant.PRIMARY} onClick={save}>
                {F.save}
              </Button>
              <Button variant={ButtonVariant.SECONDARY} onClick={() => setDraft(null)}>
                {F.cancel}
              </Button>
            </div>
          </li>
        )}
        {costs.length > 0 && (
          <li className="flex justify-between px-3 py-2 text-sm font-medium">
            <span>{F.total}</span>
            <span className="tabular-nums">{formatUsd(total)}</span>
          </li>
        )}
      </ul>
      <NoteConfirm request={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
};
