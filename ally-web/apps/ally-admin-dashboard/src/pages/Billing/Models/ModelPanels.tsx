import React, { useEffect, useState } from "react";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import {
  AddBillingModelInput,
  BillingModel,
  BillingModelType,
  BillingStatus,
  PriceInput,
  useGetBillingModelHistoryQuery,
} from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";

import { BILLING, fill } from "../copy";
import { formatPerMillion, formatUnitPrice } from "../money";
import { NoteConfirm, NoteConfirmRequest } from "../NoteConfirm";
import { Field, inputClass, SidePanel } from "../SidePanel";
import {
  emptyPrice,
  PriceFields,
  PriceFormState,
  priceFromCurrent,
  validatePrice,
} from "./PriceFields";

const M = BILLING.models;
const TYPES: BillingModelType[] = [
  "chat",
  "embedding",
  "classifier",
  "transcription",
  "tts",
  "other",
];

const ErrorLine: React.FC<{ text: string | null }> = ({ text }) =>
  text ? (
    <p role="alert" className="text-sm text-destructive-500">
      {text}
    </p>
  ) : null;

// ── Add ──────────────────────────────────────────────────────────────

export const AddModelPanel: React.FC<{
  /** From the unknown-models banner: the provider and model id usage reported. */
  prefill?: { provider: string | null; model: string } | null;
  onClose: () => void;
  onSave: (input: AddBillingModelInput) => Promise<void>;
}> = ({ prefill, onClose, onSave }) => {
  const [provider, setProvider] = useState(prefill?.provider ?? "");
  const [model, setModel] = useState(prefill?.model ?? "");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<BillingModelType>("chat");
  const [notes, setNotes] = useState("");
  const [price, setPrice] = useState<PriceFormState>(emptyPrice());
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<NoteConfirmRequest | null>(null);

  const save = () => {
    const checked = validatePrice(price);
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    setError(null);
    setConfirm({
      title: M.confirm.add.title,
      description: fill(M.confirm.add.body, { model: model.trim() }),
      confirmLabel: M.panel.save,
      onConfirm: note =>
        onSave({
          provider: provider.trim(),
          model: model.trim(),
          label: label.trim() || undefined,
          type,
          notes: notes.trim() || null,
          ...checked.payload,
          note,
        }),
    });
  };

  return (
    <SidePanel onClose={onClose} testId="billing-add-model-panel">
      <h2 className="text-2xl font-light">{M.panel.addTitle}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field id="billing-provider" label={M.panel.provider} help={M.panel.providerHelp}>
          <input
            id="billing-provider"
            className={inputClass}
            value={provider}
            onChange={event => setProvider(event.target.value)}
            placeholder="openai"
          />
        </Field>
        <Field id="billing-model" label={M.panel.model} help={M.panel.modelHelp}>
          <input
            id="billing-model"
            className={inputClass}
            value={model}
            onChange={event => setModel(event.target.value)}
            placeholder="gpt-4.1-mini"
          />
        </Field>
        <Field id="billing-label" label={M.panel.label} help={M.panel.labelHelp}>
          <input
            id="billing-label"
            className={inputClass}
            value={label}
            onChange={event => setLabel(event.target.value)}
            placeholder="GPT-4.1 mini"
          />
        </Field>
        <Field id="billing-type" label={M.panel.type}>
          <select
            id="billing-type"
            className={inputClass}
            value={type}
            onChange={event => setType(event.target.value as BillingModelType)}
          >
            {TYPES.map(t => (
              <option key={t} value={t}>
                {M.types[t]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <PriceFields idPrefix="billing-add" value={price} onChange={setPrice} />
      <Field id="billing-notes" label={M.panel.notes}>
        <input
          id="billing-notes"
          className={inputClass}
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder={M.panel.notesPlaceholder}
        />
      </Field>
      <ErrorLine text={error} />
      <Button
        variant={ButtonVariant.PRIMARY}
        onClick={save}
        disabled={!provider.trim() || !model.trim()}
        className="w-full sm:w-auto"
      >
        {M.panel.save}
      </Button>
      <NoteConfirm request={confirm} onClose={() => setConfirm(null)} />
    </SidePanel>
  );
};

// ── One model ────────────────────────────────────────────────────────

const PriceSummary: React.FC<{ model: BillingModel }> = ({ model }) => {
  const c = model.current;
  if (!c) return <p className="text-sm text-typography-600">{M.panel.noCurrentPrice}</p>;
  const rows: [string, string][] = [
    [M.columns.input, formatPerMillion(c.inputPer1MMicros)],
    [M.columns.cached, formatPerMillion(c.cachedInputPer1MMicros)],
    [M.columns.output, formatPerMillion(c.outputPer1MMicros)],
    [
      M.columns.unit,
      c.unitPriceMicros === null
        ? "—"
        : `${formatUnitPrice(c.unitPriceMicros)} / ${M.units[c.unit ?? ""] ?? c.unit}`,
    ],
    [M.columns.effectiveFrom, `${c.effectiveFrom} · ${M.panel.version(c.version)}`],
  ];
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="flex justify-between gap-3 border-b border-border-light py-1">
          <dt className="text-typography-600">{term}</dt>
          <dd className="text-typography-900 tabular-nums text-right">{value}</dd>
        </div>
      ))}
    </dl>
  );
};

const History: React.FC<{ modelId: string }> = ({ modelId }) => {
  const { data, isLoading } = useGetBillingModelHistoryQuery(modelId);
  if (isLoading) return <p className="text-sm text-typography-500">{M.loading}</p>;
  const versions = data?.versions ?? [];
  const history = data?.history ?? [];
  return (
    <div className="space-y-4" data-testid="billing-model-history">
      <h3 className="text-lg font-medium">{M.panel.history}</h3>
      <div className="overflow-x-auto border border-border-light rounded-md">
        <table className="min-w-full text-sm">
          <thead className="bg-background-secondary text-left text-typography-700">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">{M.columns.effectiveFrom}</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">{M.columns.input}</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">{M.columns.cached}</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">{M.columns.output}</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">{M.columns.unit}</th>
              <th className="px-3 py-2 font-medium">{BILLING.note.label.replace("?", "")}</th>
            </tr>
          </thead>
          <tbody>
            {versions.map(v => (
              <tr key={v.id} className="border-t border-border-light align-top">
                <td className="px-3 py-2 tabular-nums">{v.version}</td>
                <td className="px-3 py-2 whitespace-nowrap">{v.effectiveFrom}</td>
                <td className="px-3 py-2 tabular-nums">{formatPerMillion(v.inputPer1MMicros)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {formatPerMillion(v.cachedInputPer1MMicros)}
                </td>
                <td className="px-3 py-2 tabular-nums">{formatPerMillion(v.outputPer1MMicros)}</td>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                  {v.unitPriceMicros === null
                    ? "—"
                    : `${formatUnitPrice(v.unitPriceMicros)} / ${M.units[v.unit ?? ""] ?? v.unit}`}
                </td>
                <td className="px-3 py-2 min-w-[180px]">{v.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 className="text-base font-medium">{M.panel.changes}</h4>
      {history.length === 0 ? (
        <p className="text-sm text-typography-500">{M.panel.noHistory}</p>
      ) : (
        <ul className="space-y-2">
          {history.map(entry => (
            <li key={entry.id} className="text-sm border-b border-border-light pb-2">
              <div className="flex flex-wrap gap-x-2 text-typography-600">
                <span className="font-medium text-typography-900 capitalize">{entry.action}</span>
                <span>{new Date(entry.createdAt).toLocaleString("en-GB")}</span>
                <span>· {M.panel.by(entry)}</span>
              </div>
              <p className="text-typography-800 break-words">{entry.note}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export interface ModelDetailActions {
  onUpdatePrice: (input: PriceInput & { note: string }) => Promise<void>;
  onEdit: (input: {
    label: string;
    type: BillingModelType;
    notes: string | null;
    note: string;
  }) => Promise<void>;
  onSetStatus: (status: BillingStatus, note: string) => Promise<void>;
  onDelete: (note: string) => Promise<void>;
}

/**
 * One model: its current price, Update price (a new version from a date), Edit details,
 * Retire or Reactivate, Delete (only with no usage), and the price history with who and when.
 */
export const ModelDetailPanel: React.FC<
  { model: BillingModel; onClose: () => void } & ModelDetailActions
> = ({ model, onClose, onUpdatePrice, onEdit, onSetStatus, onDelete }) => {
  const [mode, setMode] = useState<"view" | "price" | "edit">("view");
  const [price, setPrice] = useState<PriceFormState>(priceFromCurrent(model.current));
  const [label, setLabel] = useState(model.label);
  const [type, setType] = useState<BillingModelType>(model.type);
  const [notes, setNotes] = useState(model.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<NoteConfirmRequest | null>(null);

  useEffect(() => {
    setMode("view");
    setPrice(priceFromCurrent(model.current));
    setLabel(model.label);
    setType(model.type);
    setNotes(model.notes ?? "");
    setError(null);
    // Re-seed when another model opens, not on every refetch of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.id]);

  const name = model.label || model.model;
  const used = model.usageCount > 0;
  const retired = model.status === "retired";

  const savePrice = () => {
    const checked = validatePrice(price);
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    setError(null);
    setConfirm({
      title: M.confirm.price.title,
      description: fill(M.confirm.price.body, {
        model: name,
        date: checked.payload.effectiveFrom ?? "",
      }),
      confirmLabel: M.panel.save,
      onConfirm: async note => {
        await onUpdatePrice({ ...checked.payload, note });
        setMode("view");
      },
    });
  };

  const saveDetails = () =>
    setConfirm({
      title: M.confirm.edit.title,
      description: fill(M.confirm.edit.body, { model: name }),
      confirmLabel: M.panel.save,
      onConfirm: async note => {
        await onEdit({ label: label.trim(), type, notes: notes.trim() || null, note });
        setMode("view");
      },
    });

  const toggleStatus = () => {
    const next: BillingStatus = retired ? "active" : "retired";
    const copy = retired ? M.confirm.reactivate : M.confirm.retire;
    setConfirm({
      title: copy.title,
      description: fill(copy.body, { model: name }),
      confirmLabel: retired ? M.panel.reactivate : M.panel.retire,
      onConfirm: note => onSetStatus(next, note),
    });
  };

  const remove = () =>
    setConfirm({
      title: M.confirm.delete.title,
      description: fill(M.confirm.delete.body, { model: name }),
      confirmLabel: M.panel.delete,
      destructive: true,
      onConfirm: note => onDelete(note),
    });

  const deleteButton = (
    <Button
      variant={ButtonVariant.SECONDARY}
      onClick={remove}
      disabled={used}
      data-testid="billing-model-delete"
    >
      {M.panel.delete}
    </Button>
  );

  const actions =
    mode === "view" ? (
      <>
        <Button variant={ButtonVariant.SECONDARY} onClick={toggleStatus}>
          {retired ? M.panel.reactivate : M.panel.retire}
        </Button>
        {used ? (
          // A disabled button fires no hover, so the tooltip sits on a wrapper.
          <Tooltip label={M.panel.deleteDisabled} align="bottom-right">
            <span className="inline-flex" tabIndex={0} data-testid="billing-model-delete-wrap">
              {deleteButton}
            </span>
          </Tooltip>
        ) : (
          deleteButton
        )}
      </>
    ) : (
      <Button variant={ButtonVariant.SECONDARY} onClick={() => setMode("view")}>
        {M.panel.back}
      </Button>
    );

  return (
    <SidePanel onClose={onClose} actions={actions} testId="billing-model-panel">
      <div className="min-w-0">
        <h2 className="text-2xl font-light break-words">{name}</h2>
        <p className="text-sm text-typography-600 break-all">
          {model.provider} · {model.model} · {M.types[model.type] ?? model.type} ·{" "}
          {M.status[model.status]}
        </p>
        <p className="text-sm text-typography-600">
          {M.panel.usage(model.usageCount, model.unpricedCount)}
        </p>
        {model.notes && <p className="text-sm text-typography-800 mt-1">{model.notes}</p>}
      </div>

      {mode === "view" && (
        <>
          <section className="space-y-3">
            <h3 className="text-lg font-medium">{M.panel.currentPrice}</h3>
            <PriceSummary model={model} />
            <div className="flex flex-wrap gap-2">
              <Button variant={ButtonVariant.PRIMARY} onClick={() => setMode("price")}>
                {M.panel.updatePrice}
              </Button>
              <Button variant={ButtonVariant.TERTIARY} onClick={() => setMode("edit")}>
                {M.panel.editDetails}
              </Button>
            </div>
          </section>
          <History modelId={model.id} />
        </>
      )}

      {mode === "price" && (
        <section className="space-y-4">
          <h3 className="text-lg font-medium">{M.panel.updatePriceTitle}</h3>
          <div className="rounded-md bg-background-secondary px-4 py-3 space-y-2">
            <p className="text-sm text-typography-700">{M.panel.currentPrice}</p>
            <PriceSummary model={model} />
          </div>
          <p className="text-sm text-typography-700">{M.panel.updatePriceHelp}</p>
          <PriceFields idPrefix="billing-price" value={price} onChange={setPrice} />
          <ErrorLine text={error} />
          <Button variant={ButtonVariant.PRIMARY} onClick={savePrice} className="w-full sm:w-auto">
            {M.panel.save}
          </Button>
        </section>
      )}

      {mode === "edit" && (
        <section className="space-y-4">
          <h3 className="text-lg font-medium">{M.panel.editTitle}</h3>
          <Field id="billing-edit-label" label={M.panel.label} help={M.panel.labelHelp}>
            <input
              id="billing-edit-label"
              className={inputClass}
              value={label}
              onChange={event => setLabel(event.target.value)}
            />
          </Field>
          <Field id="billing-edit-type" label={M.panel.type}>
            <select
              id="billing-edit-type"
              className={inputClass}
              value={type}
              onChange={event => setType(event.target.value as BillingModelType)}
            >
              {TYPES.map(t => (
                <option key={t} value={t}>
                  {M.types[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="billing-edit-notes" label={M.panel.notes}>
            <input
              id="billing-edit-notes"
              className={inputClass}
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder={M.panel.notesPlaceholder}
            />
          </Field>
          <Button
            variant={ButtonVariant.PRIMARY}
            onClick={saveDetails}
            className="w-full sm:w-auto"
          >
            {M.panel.save}
          </Button>
        </section>
      )}

      <NoteConfirm request={confirm} onClose={() => setConfirm(null)} />
    </SidePanel>
  );
};
