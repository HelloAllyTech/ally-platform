import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import {
  useGetWhatsAppRatesQuery,
  useRetireWhatsAppRateMutation,
  useSetWhatsAppRateMutation,
  WhatsAppRate,
  WhatsAppRateCategory,
} from "@api";
import { Button, cellTypes, ListToolbar, NotionTable } from "@components";
import { ButtonVariant } from "@components/types";

import { BILLING, fill, labelOf } from "../copy";
import { formatPerMessage, formatUsd, parseUsdField, todayIso } from "../money";
import { NoteConfirm, NoteConfirmRequest } from "../NoteConfirm";
import { Field, inputClass, SidePanel } from "../SidePanel";

const W = BILLING.whatsapp;
const CATEGORIES: WhatsAppRateCategory[] = [
  "service",
  "utility",
  "marketing",
  "authentication",
  "authentication_international",
];

const col = (id: string, label: string, minWidth: number) => ({
  id,
  label,
  accessor: id,
  dataType: cellTypes.wrapText,
  minWidth,
});

const COLUMNS = [
  col("country", W.columns.country, 100),
  col("category", W.columns.category, 220),
  col("price", W.columns.price, 140),
  col("effectiveFrom", W.columns.effectiveFrom, 140),
  col("status", W.columns.status, 110),
  col("versions", W.columns.versions, 100),
];

const keyOf = (rate: Pick<WhatsAppRate, "country" | "category">) =>
  `${rate.country} · ${labelOf(W.categories, rate.category)}`;

const errorMessage = (error: unknown): string =>
  (error as { data?: { message?: string } })?.data?.message || BILLING.models.toast.failed;

const RatePanel: React.FC<{
  rate: WhatsAppRate | null;
  onClose: () => void;
}> = ({ rate, onClose }) => {
  const [setRate] = useSetWhatsAppRateMutation();
  const [retireRate] = useRetireWhatsAppRateMutation();
  const [country, setCountry] = useState(rate?.country ?? "");
  const [category, setCategory] = useState<WhatsAppRateCategory>(rate?.category ?? "service");
  const [price, setPrice] = useState(
    rate?.current ? String(Number((rate.current.priceMicros / 1e6).toFixed(6))) : "",
  );
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<NoteConfirmRequest | null>(null);

  const save = () => {
    const code = country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return setError(W.panel.badCountry);
    const usd = parseUsdField(price);
    if (usd === null || !Number.isFinite(usd) || usd < 0) return setError(W.panel.badPrice);
    setError(null);
    setConfirm({
      title: W.confirm.save.title,
      description: fill(W.confirm.save.body, {
        rate: formatUsd(usd, 4),
        key: keyOf({ country: code, category }),
        date: effectiveFrom,
      }),
      confirmLabel: W.panel.save,
      onConfirm: async note => {
        try {
          await setRate({ country: code, category, priceUsd: usd, effectiveFrom, note }).unwrap();
          toast.success(W.toast.saved);
          onClose();
        } catch (e) {
          toast.error(errorMessage(e));
          throw e;
        }
      },
    });
  };

  const retire = () =>
    rate &&
    setConfirm({
      title: W.confirm.retire.title,
      description: fill(W.confirm.retire.body, { key: keyOf(rate) }),
      confirmLabel: W.panel.retire,
      destructive: true,
      onConfirm: async note => {
        try {
          await retireRate({ country: rate.country, category: rate.category, note }).unwrap();
          toast.success(W.toast.retired);
          onClose();
        } catch (e) {
          toast.error(errorMessage(e));
          throw e;
        }
      },
    });

  return (
    <SidePanel
      onClose={onClose}
      testId="billing-whatsapp-panel"
      actions={
        rate &&
        rate.status === "active" && (
          <Button variant={ButtonVariant.SECONDARY} onClick={retire}>
            {W.panel.retire}
          </Button>
        )
      }
    >
      <h2 className="text-2xl font-light">
        {rate ? `${W.panel.updateTitle}: ${keyOf(rate)}` : W.panel.addTitle}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field id="wa-country" label={W.panel.country} help={W.panel.countryHelp}>
          <input
            id="wa-country"
            className={inputClass}
            value={country}
            maxLength={2}
            disabled={Boolean(rate)}
            onChange={event => setCountry(event.target.value)}
            placeholder="IN"
          />
        </Field>
        <Field id="wa-category" label={W.panel.category}>
          <select
            id="wa-category"
            className={inputClass}
            value={category}
            disabled={Boolean(rate)}
            onChange={event => setCategory(event.target.value as WhatsAppRateCategory)}
          >
            {CATEGORIES.map(c => (
              <option key={c} value={c}>
                {W.categories[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="wa-price" label={W.panel.price}>
          <input
            id="wa-price"
            className={inputClass}
            inputMode="decimal"
            value={price}
            onChange={event => setPrice(event.target.value)}
            placeholder="0.0118"
          />
        </Field>
        <Field
          id="wa-effective"
          label={W.panel.effectiveFrom}
          help={BILLING.models.price.effectiveHelp}
        >
          <input
            id="wa-effective"
            type="date"
            className={inputClass}
            value={effectiveFrom}
            onChange={event => setEffectiveFrom(event.target.value)}
          />
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-500">
          {error}
        </p>
      )}
      <Button variant={ButtonVariant.PRIMARY} onClick={save} className="w-full sm:w-auto">
        {W.panel.save}
      </Button>

      {rate && rate.versions.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-lg font-medium">{W.panel.versions}</h3>
          <ul className="space-y-2">
            {rate.versions.map(v => (
              <li key={v.id} className="text-sm border-b border-border-light pb-2">
                <div className="flex flex-wrap gap-x-3 text-typography-600">
                  <span className="font-medium text-typography-900">#{v.version}</span>
                  <span className="tabular-nums">{formatPerMessage(v.priceMicros)}</span>
                  <span>
                    {W.columns.effectiveFrom} {v.effectiveFrom}
                  </span>
                  <span>{new Date(v.createdAt).toLocaleString("en-GB")}</span>
                  <span>· {BILLING.models.panel.by({ actorUserId: v.createdBy })}</span>
                </div>
                <p className="text-typography-800 break-words">{v.note}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <NoteConfirm request={confirm} onClose={() => setConfirm(null)} />
    </SidePanel>
  );
};

/** WhatsApp rates (chunk-cr1 §A3): Meta's fee per message, priced like the models. */
export const WhatsAppRatesTab: React.FC = () => {
  const { data: rates = [], isFetching } = useGetWhatsAppRatesQuery();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<{ rate: WhatsAppRate | null } | null>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rates;
    return rates.filter(r =>
      [r.country, r.category, W.categories[r.category]].some(v =>
        String(v ?? "")
          .toLowerCase()
          .includes(needle),
      ),
    );
  }, [rates, search]);

  const rows = useMemo(
    () =>
      filtered.map(r => ({
        id: `${r.country}/${r.category}`,
        country: r.country,
        category: labelOf(W.categories, r.category),
        price: r.current ? formatPerMessage(r.current.priceMicros) : BILLING.models.noPrice,
        effectiveFrom: r.current?.effectiveFrom ?? "—",
        status: BILLING.models.status[r.status] ?? r.status,
        versions: String(r.versions.length),
      })),
    [filtered],
  );

  return (
    <div className="font-primary min-w-0">
      <p className="max-w-3xl pb-3 text-sm text-typography-700">{W.intro}</p>
      <ListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        placeholder={W.search}
        action={{
          label: W.add,
          variant: ButtonVariant.PRIMARY,
          onClick: () => setOpen({ rate: null }),
        }}
      />
      <div className="mt-4 md:mt-5 min-w-0" data-testid="billing-whatsapp-table">
        <NotionTable
          tableData={{ data: rows, columns: COLUMNS }}
          autoHeight
          hideSelectionColumn
          rowClickTrigger="row"
          onRowClick={(rowIndex: number) => {
            const rate = filtered[rowIndex];
            if (rate) setOpen({ rate });
          }}
          onRowChange={() => {}}
          onSelectionChange={() => {}}
          tableFooter={
            <div className="py-4 text-typography-500 text-base">
              {isFetching ? BILLING.models.loading : rows.length ? W.count(rows.length) : W.empty}
            </div>
          }
        />
      </div>
      {open && (
        <RatePanel
          key={open.rate ? `${open.rate.country}/${open.rate.category}` : "new"}
          rate={open.rate}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
};
