import React from "react";

import type { BillingModelPrice, PriceInput, PriceUnit } from "@api";

import { BILLING } from "../copy";
import { microsToUsd, parseUsdField, todayIso } from "../money";
import { Field, inputClass } from "../SidePanel";

const P = BILLING.models.price;

export interface PriceFormState {
  input: string;
  cached: string;
  output: string;
  unitPrice: string;
  unit: PriceUnit | "";
  effectiveFrom: string;
}

export const emptyPrice = (): PriceFormState => ({
  input: "",
  cached: "",
  output: "",
  unitPrice: "",
  unit: "",
  effectiveFrom: todayIso(),
});

const asField = (micros: number | null | undefined) => {
  const usd = microsToUsd(micros);
  return usd === null ? "" : String(Number(usd.toFixed(6)));
};

/** The current price as a starting point for the next version, effective today. */
export const priceFromCurrent = (current: BillingModelPrice | null): PriceFormState =>
  current
    ? {
        input: asField(current.inputPer1MMicros),
        cached: asField(current.cachedInputPer1MMicros),
        output: asField(current.outputPer1MMicros),
        unitPrice: asField(current.unitPriceMicros),
        unit: current.unit ?? "",
        effectiveFrom: todayIso(),
      }
    : emptyPrice();

/** The same checks ally-be makes, so a mistake is caught before the note is asked for. */
export const validatePrice = (
  state: PriceFormState,
): { error: string } | { payload: PriceInput } => {
  const values = {
    inputPerMillionUsd: parseUsdField(state.input),
    cachedInputPerMillionUsd: parseUsdField(state.cached),
    outputPerMillionUsd: parseUsdField(state.output),
    unitPriceUsd: parseUsdField(state.unitPrice),
  };
  if (Object.values(values).some(v => v !== null && (!Number.isFinite(v) || v < 0))) {
    return { error: P.notNumber };
  }
  if (
    values.inputPerMillionUsd === null &&
    values.outputPerMillionUsd === null &&
    values.unitPriceUsd === null
  ) {
    return { error: P.needOne };
  }
  if (values.unitPriceUsd !== null && !state.unit) return { error: P.needUnit };
  return {
    payload: {
      ...values,
      unit: state.unit || null,
      effectiveFrom: state.effectiveFrom || todayIso(),
    },
  };
};

const UNITS: PriceUnit[] = ["minute", "page", "million_chars", "call"];

/** Input, cached input, output per million tokens; an optional unit price; the effective date. */
export const PriceFields: React.FC<{
  idPrefix: string;
  value: PriceFormState;
  onChange: (next: PriceFormState) => void;
}> = ({ idPrefix, value, onChange }) => {
  const set =
    (key: keyof PriceFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ ...value, [key]: event.target.value });
  const money = (
    key: "input" | "cached" | "output" | "unitPrice",
    label: string,
    help?: string,
  ) => (
    <Field id={`${idPrefix}-${key}`} label={label} help={help}>
      <input
        id={`${idPrefix}-${key}`}
        className={inputClass}
        inputMode="decimal"
        value={value[key]}
        onChange={set(key)}
        placeholder="0.00"
      />
    </Field>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {money("input", P.input)}
        {money("cached", P.cached)}
        {money("output", P.output)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {money("unitPrice", P.unitPrice, P.unitPriceHelp)}
        <Field id={`${idPrefix}-unit`} label={P.unit}>
          <select
            id={`${idPrefix}-unit`}
            className={inputClass}
            value={value.unit}
            onChange={set("unit")}
          >
            <option value="">{P.noUnit}</option>
            {UNITS.map(unit => (
              <option key={unit} value={unit}>
                {BILLING.models.units[unit]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field id={`${idPrefix}-effective`} label={P.effectiveFrom} help={P.effectiveHelp}>
        <input
          id={`${idPrefix}-effective`}
          type="date"
          className={inputClass}
          value={value.effectiveFrom}
          onChange={set("effectiveFrom")}
        />
      </Field>
    </div>
  );
};
