import React, { useState } from "react";

import type { BillingPlan, BillingSeatType, PlanInput, SeatTypeInput } from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";

import { parseUsdField } from "../money";
import { PLANS } from "../plansCopy";
import { Field, inputClass, SidePanel } from "../SidePanel";
import { parseLimit } from "../Table";

const F = PLANS.form;

const text = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

const Toggle: React.FC<{
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}> = ({ id, label, help, checked, onChange }) => (
  <div className="min-w-0">
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-typography-900">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
      />
      {label}
    </label>
    <p className="mt-1 text-xs text-typography-500">{help}</p>
  </div>
);

const Actions: React.FC<{ onCancel: () => void; onSave: () => void; testId: string }> = ({
  onCancel,
  onSave,
  testId,
}) => (
  <>
    <Button variant={ButtonVariant.SECONDARY} onClick={onCancel}>
      {F.cancel}
    </Button>
    <Button variant={ButtonVariant.PRIMARY} onClick={onSave} data-testid={testId}>
      {F.save}
    </Button>
  </>
);

/** Add or edit a plan. Hands the checked values on; the page asks for the note. */
export const PlanPanel: React.FC<{
  plan: BillingPlan | null;
  seatTypes: BillingSeatType[];
  onClose: () => void;
  onSave: (input: Omit<PlanInput, "note">) => void;
}> = ({ plan, seatTypes, onClose, onSave }) => {
  const includedType = seatTypes.find(type => type.id === plan?.includedSeatTypeId);
  const [draft, setDraft] = useState({
    name: plan?.name ?? "",
    key: plan?.key ?? "",
    maxPublished: text(plan?.maxPublished),
    includedSeats: text(plan?.includedSeats ?? 5),
    includedSeatTypeKey: includedType?.key ?? seatTypes[0]?.key ?? "",
    customerConversations: text(plan?.customerConversations),
    ownerRuns: text(plan?.ownerRuns),
    seatsRequired: plan?.seatsRequired ?? true,
    price: text(plan?.price),
    active: plan?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof draft>) => setDraft(previous => ({ ...previous, ...patch }));

  const save = () => {
    const name = draft.name.trim();
    if (!name) return setError(F.needName);
    const maxPublished = parseLimit(draft.maxPublished);
    const includedSeats = parseLimit(draft.includedSeats) ?? 0;
    const customerConversations = parseLimit(draft.customerConversations);
    const ownerRuns = parseLimit(draft.ownerRuns);
    if ([maxPublished, includedSeats, customerConversations, ownerRuns].some(n => Number.isNaN(n)))
      return setError(F.badNumber);
    const price = parseUsdField(draft.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) return setError(F.badPrice);
    setError(null);
    onSave({
      ...(plan ? { id: plan.id } : draft.key.trim() ? { key: draft.key.trim() } : {}),
      name,
      maxPublished,
      includedSeats,
      includedSeatTypeKey: draft.includedSeatTypeKey || null,
      customerConversations,
      ownerRuns,
      seatsRequired: draft.seatsRequired,
      priceUsd: price,
      active: draft.active,
    });
  };

  return (
    <SidePanel
      onClose={onClose}
      testId="billing-plan-panel"
      actions={<Actions onCancel={onClose} onSave={save} testId="billing-plan-save" />}
    >
      <h2 className="font-secondary text-xl text-typography-900">
        {plan ? F.editPlan(plan.name) : F.addPlan}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field id="plan-name" label={F.name}>
          <input
            id="plan-name"
            className={inputClass}
            value={draft.name}
            onChange={event => set({ name: event.target.value })}
          />
        </Field>
        <Field id="plan-key" label={F.key} help={plan ? undefined : F.keyHelp}>
          <input
            id="plan-key"
            className={inputClass}
            value={draft.key}
            disabled={Boolean(plan)}
            onChange={event => set({ key: event.target.value })}
          />
        </Field>
        <Field id="plan-max" label={F.maxPublished} help={F.maxPublishedHelp}>
          <input
            id="plan-max"
            inputMode="numeric"
            className={inputClass}
            value={draft.maxPublished}
            placeholder={PLANS.plans.unlimited}
            onChange={event => set({ maxPublished: event.target.value })}
          />
        </Field>
        <Field id="plan-runs" label={F.ownerRuns} help={F.ownerRunsHelp}>
          <input
            id="plan-runs"
            inputMode="numeric"
            className={inputClass}
            value={draft.ownerRuns}
            placeholder={PLANS.plans.unlimited}
            onChange={event => set({ ownerRuns: event.target.value })}
          />
        </Field>
        <Field id="plan-seats" label={F.includedSeats} help={F.includedSeatsHelp}>
          <input
            id="plan-seats"
            inputMode="numeric"
            className={inputClass}
            value={draft.includedSeats}
            onChange={event => set({ includedSeats: event.target.value })}
          />
        </Field>
        <Field id="plan-seat-type" label={F.includedSeatType}>
          <select
            id="plan-seat-type"
            className={inputClass}
            value={draft.includedSeatTypeKey}
            onChange={event => set({ includedSeatTypeKey: event.target.value })}
          >
            {seatTypes.map(type => (
              <option key={type.id} value={type.key}>
                {type.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="plan-customers"
          label={F.customerConversations}
          help={F.customerConversationsHelp}
        >
          <input
            id="plan-customers"
            inputMode="numeric"
            className={inputClass}
            value={draft.customerConversations}
            placeholder={PLANS.plans.unlimited}
            onChange={event => set({ customerConversations: event.target.value })}
          />
        </Field>
        <Field id="plan-price" label={F.price} help={F.priceHelp}>
          <input
            id="plan-price"
            inputMode="decimal"
            className={inputClass}
            value={draft.price}
            onChange={event => set({ price: event.target.value })}
          />
        </Field>
        <Toggle
          id="plan-seats-required"
          label={F.seatsRequired}
          help={F.seatsRequiredHelp}
          checked={draft.seatsRequired}
          onChange={seatsRequired => set({ seatsRequired })}
        />
        <Toggle
          id="plan-active"
          label={F.active}
          help={F.activeHelp}
          checked={draft.active}
          onChange={active => set({ active })}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-500">
          {error}
        </p>
      )}
    </SidePanel>
  );
};

/** Add or edit a seat type. */
export const SeatTypePanel: React.FC<{
  seatType: BillingSeatType | null;
  onClose: () => void;
  onSave: (input: Omit<SeatTypeInput, "note">) => void;
}> = ({ seatType, onClose, onSave }) => {
  const [draft, setDraft] = useState({
    name: seatType?.name ?? "",
    key: seatType?.key ?? "",
    messages: text(seatType?.messagesPerMonth),
    rank: text(seatType?.rank ?? 1),
    price: text(seatType?.price),
    active: seatType?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof draft>) => setDraft(previous => ({ ...previous, ...patch }));

  const save = () => {
    const name = draft.name.trim();
    if (!name) return setError(F.needName);
    const messagesPerMonth = parseLimit(draft.messages);
    const rank = parseLimit(draft.rank) ?? 1;
    if (Number.isNaN(messagesPerMonth) || Number.isNaN(rank)) return setError(F.badNumber);
    const price = parseUsdField(draft.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) return setError(F.badPrice);
    setError(null);
    onSave({
      ...(seatType ? { id: seatType.id } : draft.key.trim() ? { key: draft.key.trim() } : {}),
      name,
      messagesPerMonth,
      rank,
      priceUsd: price,
      active: draft.active,
    });
  };

  return (
    <SidePanel
      onClose={onClose}
      testId="billing-seat-type-panel"
      actions={<Actions onCancel={onClose} onSave={save} testId="billing-seat-type-save" />}
    >
      <h2 className="font-secondary text-xl text-typography-900">
        {seatType ? F.editSeatType(seatType.name) : F.addSeatType}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field id="seat-name" label={F.name}>
          <input
            id="seat-name"
            className={inputClass}
            value={draft.name}
            onChange={event => set({ name: event.target.value })}
          />
        </Field>
        <Field id="seat-key" label={F.key} help={seatType ? undefined : F.keyHelp}>
          <input
            id="seat-key"
            className={inputClass}
            value={draft.key}
            disabled={Boolean(seatType)}
            onChange={event => set({ key: event.target.value })}
          />
        </Field>
        <Field id="seat-messages" label={F.messages} help={F.messagesHelp}>
          <input
            id="seat-messages"
            inputMode="numeric"
            className={inputClass}
            value={draft.messages}
            placeholder={PLANS.plans.unlimited}
            onChange={event => set({ messages: event.target.value })}
          />
        </Field>
        <Field id="seat-rank" label={F.rank} help={F.rankHelp}>
          <input
            id="seat-rank"
            inputMode="numeric"
            className={inputClass}
            value={draft.rank}
            onChange={event => set({ rank: event.target.value })}
          />
        </Field>
        <Field id="seat-price" label={F.price} help={F.priceHelp}>
          <input
            id="seat-price"
            inputMode="decimal"
            className={inputClass}
            value={draft.price}
            onChange={event => set({ price: event.target.value })}
          />
        </Field>
        <Toggle
          id="seat-active"
          label={F.active}
          help={F.activeHelp}
          checked={draft.active}
          onChange={active => set({ active })}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-500">
          {error}
        </p>
      )}
    </SidePanel>
  );
};
