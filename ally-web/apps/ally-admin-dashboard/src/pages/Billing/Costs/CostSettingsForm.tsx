import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import { CostOverview, useUpdateCostSettingsMutation } from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";

import { BILLING } from "../copy";
import { NoteConfirm, NoteConfirmRequest } from "../NoteConfirm";
import { Field, inputClass } from "../SidePanel";

const S = BILLING.costs.settings;

type Settings = NonNullable<CostOverview["settings"]>;
type FormState = Record<keyof Settings, string>;

const toForm = (s: Settings | null): FormState => ({
  dailyBudget: s ? String(s.dailyBudget) : "",
  conversationAlert: s ? String(s.conversationAlert) : "",
  spikeMultiplier: s ? String(s.spikeMultiplier) : "",
  spikeMin: s ? String(s.spikeMin) : "",
});

/** The alert thresholds: daily budget, one conversation, spike multiplier and minimum. */
export const CostSettingsForm: React.FC<{ settings: Settings | null }> = ({ settings }) => {
  const [form, setForm] = useState<FormState>(toForm(settings));
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<NoteConfirmRequest | null>(null);
  const [update] = useUpdateCostSettingsMutation();

  useEffect(() => setForm(toForm(settings)), [settings]);

  const save = () => {
    const n = (v: string) => (v.trim() === "" ? NaN : Number(v));
    const values = {
      dailyBudgetUsd: n(form.dailyBudget),
      conversationAlertUsd: n(form.conversationAlert),
      spikeMultiplier: n(form.spikeMultiplier),
      spikeMinUsd: n(form.spikeMin),
    };
    const bad =
      Object.values(values).some(v => !Number.isFinite(v) || v < 0) || values.spikeMultiplier < 1;
    if (bad) {
      setError(S.bad);
      return;
    }
    setError(null);
    setConfirm({
      title: S.confirm.title,
      description: S.confirm.body,
      confirmLabel: S.save,
      onConfirm: async note => {
        try {
          await update({ ...values, note }).unwrap();
          toast.success(S.toast);
        } catch (e) {
          toast.error(
            (e as { data?: { message?: string } })?.data?.message || BILLING.models.toast.failed,
          );
          throw e;
        }
      },
    });
  };

  const field = (key: keyof FormState, id: string, label: string, help: string) => (
    <Field id={id} label={label} help={help}>
      <input
        id={id}
        className={inputClass}
        inputMode="decimal"
        value={form[key]}
        onChange={event => setForm({ ...form, [key]: event.target.value })}
      />
    </Field>
  );

  return (
    <section className="space-y-3" data-testid="billing-cost-settings">
      <div>
        <h2 className="text-lg font-medium">{S.title}</h2>
        <p className="text-sm text-typography-600">{S.intro}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("dailyBudget", "cost-daily-budget", S.dailyBudget, S.dailyBudgetHelp)}
        {field(
          "conversationAlert",
          "cost-conversation-alert",
          S.conversationAlert,
          S.conversationAlertHelp,
        )}
        {field(
          "spikeMultiplier",
          "cost-spike-multiplier",
          S.spikeMultiplier,
          S.spikeMultiplierHelp,
        )}
        {field("spikeMin", "cost-spike-min", S.spikeMin, S.spikeMinHelp)}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-500">
          {error}
        </p>
      )}
      <Button variant={ButtonVariant.PRIMARY} onClick={save} className="w-full sm:w-auto">
        {S.save}
      </Button>
      <NoteConfirm request={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
};
