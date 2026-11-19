import React, { useCallback, useMemo, useState } from "react";

import { toast } from "sonner";

import {
  AddBillingModelInput,
  BillingModel,
  useAddBillingModelMutation,
  useDeleteBillingModelMutation,
  useEditBillingModelMutation,
  useGetBillingModelsQuery,
  useGetUnknownBillingModelsQuery,
  useSetBillingModelStatusMutation,
  useUpdateBillingModelPriceMutation,
} from "@api";
import { cellTypes, ListToolbar, NotionTable } from "@components";
import { ButtonVariant } from "@components/types";

import { BILLING } from "../copy";
import { formatCount, formatPerMillion, formatUnitPrice } from "../money";
import { AddModelPanel, ModelDetailPanel } from "./ModelPanels";

const M = BILLING.models;

// wrapText shows the value as given: normalText would sentence-case "$0.400" dates and notes.
const col = (id: string, label: string, minWidth: number) => ({
  id,
  label,
  accessor: id,
  dataType: cellTypes.wrapText,
  minWidth,
});

export const MODEL_COLUMNS = [
  col("provider", M.columns.provider, 120),
  col("model", M.columns.model, 200),
  col("label", M.columns.label, 180),
  col("type", M.columns.type, 130),
  col("input", M.columns.input, 120),
  col("cached", M.columns.cached, 150),
  col("output", M.columns.output, 120),
  col("unit", M.columns.unit, 170),
  col("status", M.columns.status, 100),
  col("effectiveFrom", M.columns.effectiveFrom, 160),
  col("notes", M.columns.notes, 220),
  col("usage", M.columns.usage, 110),
];

/** One table row per model: every price as dollars, from micros. */
export const toModelRow = (model: BillingModel) => {
  const c = model.current;
  return {
    id: model.id,
    provider: model.provider,
    model: model.model,
    label: model.label,
    type: M.types[model.type] ?? model.type,
    input: c ? formatPerMillion(c.inputPer1MMicros) : M.noPrice,
    cached: c ? formatPerMillion(c.cachedInputPer1MMicros) : "—",
    output: c ? formatPerMillion(c.outputPer1MMicros) : "—",
    unit:
      c && c.unitPriceMicros !== null
        ? `${formatUnitPrice(c.unitPriceMicros)} / ${M.units[c.unit ?? ""] ?? c.unit}`
        : "—",
    status: M.status[model.status] ?? model.status,
    effectiveFrom: c?.effectiveFrom ?? "—",
    notes: model.notes ?? "",
    usage: model.unpricedCount
      ? `${formatCount(model.usageCount)} (+${formatCount(model.unpricedCount)} unpriced)`
      : formatCount(model.usageCount),
  };
};

const errorMessage = (error: unknown): string => {
  const data = (error as { data?: { message?: string | string[] } })?.data;
  const message = Array.isArray(data?.message) ? data?.message.join(" ") : data?.message;
  return message || M.toast.failed;
};

export const ModelsTab: React.FC = () => {
  const { data: models = [], isFetching } = useGetBillingModelsQuery();
  const { data: unknown = [] } = useGetUnknownBillingModelsQuery();
  const [addModel] = useAddBillingModelMutation();
  const [updatePrice] = useUpdateBillingModelPriceMutation();
  const [editModel] = useEditBillingModelMutation();
  const [setStatus] = useSetBillingModelStatusMutation();
  const [deleteModel] = useDeleteBillingModelMutation();

  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<{ provider: string | null; model: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return models;
    return models.filter(m =>
      [m.label, m.model, m.provider, m.notes]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(needle)),
    );
  }, [models, search]);

  const rows = useMemo(() => filtered.map(toModelRow), [filtered]);
  const selected = models.find(m => m.id === selectedId) ?? null;

  /** Runs a change; shows the server's own words when it refuses (a 409 says "Retire it instead"). */
  const run = useCallback(async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }, []);

  const handleAdd = async (input: AddBillingModelInput) => {
    await run(() => addModel(input).unwrap(), M.toast.added);
    setAdding(null);
  };

  return (
    <div className="font-primary min-w-0">
      {unknown.length > 0 && (
        <div
          role="status"
          data-testid="billing-unknown-models"
          className="mb-4 rounded-md border border-warning-300 bg-warning-50 px-4 py-3"
        >
          <p className="font-medium text-typography-900">{M.unknown.title}</p>
          <p className="text-sm text-typography-700">{M.unknown.body}</p>
          <ul className="mt-2 space-y-1">
            {unknown.map(item => (
              <li
                key={`${item.provider}/${item.model}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
              >
                <span className="break-all text-typography-900">
                  {M.unknown.line(item.provider, item.model, item.events)}
                </span>
                <button
                  type="button"
                  className="underline text-primary-600 min-h-[32px]"
                  onClick={() => setAdding({ provider: item.provider, model: item.model })}
                >
                  {M.unknown.add}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        placeholder={M.search}
        action={{
          label: M.add,
          variant: ButtonVariant.PRIMARY,
          onClick: () => setAdding({ provider: "", model: "" }),
        }}
      />

      <div className="mt-4 md:mt-5 min-w-0" data-testid="billing-models-table">
        <NotionTable
          tableData={{ data: rows, columns: MODEL_COLUMNS }}
          autoHeight
          hideSelectionColumn
          rowClickTrigger="row"
          // NotionTable passes the row index into `rows`, which came from `filtered`.
          onRowClick={(rowIndex: number) => setSelectedId(filtered[rowIndex]?.id ?? null)}
          onRowChange={() => {}}
          onSelectionChange={() => {}}
          tableFooter={
            <div className="py-4 text-typography-500 text-base">
              {isFetching ? M.loading : rows.length ? M.count(rows.length) : M.empty}
            </div>
          }
        />
      </div>

      {adding && (
        <AddModelPanel prefill={adding} onClose={() => setAdding(null)} onSave={handleAdd} />
      )}

      {selected && (
        <ModelDetailPanel
          model={selected}
          onClose={() => setSelectedId(null)}
          onUpdatePrice={input =>
            run(() => updatePrice({ id: selected.id, ...input }).unwrap(), M.toast.priced)
          }
          onEdit={input =>
            run(() => editModel({ id: selected.id, ...input }).unwrap(), M.toast.edited)
          }
          onSetStatus={(status, note) =>
            run(
              () => setStatus({ id: selected.id, status, note }).unwrap(),
              status === "retired" ? M.toast.retired : M.toast.reactivated,
            )
          }
          onDelete={async note => {
            await run(() => deleteModel({ id: selected.id, note }).unwrap(), M.toast.deleted);
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
};
