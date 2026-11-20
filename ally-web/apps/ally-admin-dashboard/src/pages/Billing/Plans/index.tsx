import React, { useState } from "react";

import { toast } from "sonner";

import { useGetPlansCatalogueQuery, useSavePlanMutation, useSaveSeatTypeMutation } from "@api";
import type { BillingPlan, BillingSeatType, RenewalDue } from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";

import { longDay } from "../../Plan/format";
import { fill } from "../copy";
import { formatCount, formatUsd } from "../money";
import { NoteConfirm, NoteConfirmRequest } from "../NoteConfirm";
import { PLANS } from "../plansCopy";
import { Column, DataTable, serverMessage } from "../Table";
import { PlanPanel, SeatTypePanel } from "./PlanPanels";

const P = PLANS;

const limit = (n: number | null) => (n === null ? P.plans.unlimited : formatCount(n));
const priceCell = (usd: number | null) => (usd === null ? "—" : formatUsd(usd));
const activeCell = (active: boolean) => (active ? P.plans.active : P.plans.inactive);

const Card: React.FC<{ children: React.ReactNode; testId?: string }> = ({ children, testId }) => (
  <section
    className="rounded-md border border-border-light bg-white p-4 md:p-5 min-w-0 space-y-3"
    data-testid={testId}
  >
    {children}
  </section>
);

const Head: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <h2 className="text-lg font-medium">{title}</h2>
    {action}
  </div>
);

const RENEWAL_COLUMNS: Column<RenewalDue>[] = [
  { key: "when", label: P.renewals.columns.when, cell: r => longDay(r.nextRenewal) },
  { key: "assistant", label: P.renewals.columns.assistant, cell: r => r.assistant },
  { key: "seat", label: P.renewals.columns.seat, cell: r => r.seatType },
  {
    key: "holder",
    label: P.renewals.columns.holder,
    cell: r => r.assigneeEmail ?? P.renewals.nobody,
  },
  { key: "creator", label: P.renewals.columns.creator, cell: r => r.creatorEmail ?? "—" },
  { key: "status", label: P.renewals.columns.status, cell: r => r.status },
];

/**
 * Ally admin → Plans (CR1 §C3): extra seats renewing in the next 7 days at the top, then plans and
 * seat types with their limits and prices (prices for Costs only). Every change needs a note.
 */
export const BillingPlans: React.FC = () => {
  const { data, isLoading, isError } = useGetPlansCatalogueQuery();
  const [savePlan] = useSavePlanMutation();
  const [saveSeatType] = useSaveSeatTypeMutation();
  const [planPanel, setPlanPanel] = useState<{ plan: BillingPlan | null } | null>(null);
  const [seatPanel, setSeatPanel] = useState<{ seatType: BillingSeatType | null } | null>(null);
  const [confirm, setConfirm] = useState<NoteConfirmRequest | null>(null);

  const seatTypes = data?.seatTypes ?? [];
  const seatTypeName = (id: string | null) => seatTypes.find(t => t.id === id)?.name ?? "";

  const planColumns: Column<BillingPlan>[] = [
    {
      key: "name",
      label: P.plans.columns.name,
      cell: plan => <span className="font-medium text-typography-900">{plan.name}</span>,
    },
    { key: "key", label: P.plans.columns.key, cell: plan => plan.key },
    {
      key: "published",
      label: P.plans.columns.published,
      numeric: true,
      cell: plan => limit(plan.maxPublished),
    },
    {
      key: "seats",
      label: P.plans.columns.seats,
      numeric: true,
      cell: plan =>
        `${plan.includedSeats}${plan.includedSeats ? ` ${seatTypeName(plan.includedSeatTypeId)}` : ""}`,
    },
    {
      key: "customers",
      label: P.plans.columns.customers,
      numeric: true,
      cell: plan => limit(plan.customerConversations),
    },
    {
      key: "runs",
      label: P.plans.columns.runs,
      numeric: true,
      cell: plan => limit(plan.ownerRuns),
    },
    {
      key: "seatsRequired",
      label: P.plans.columns.seatsRequired,
      cell: plan => (plan.seatsRequired ? P.plans.yes : P.plans.no),
    },
    {
      key: "price",
      label: P.plans.columns.price,
      numeric: true,
      cell: plan => priceCell(plan.price),
    },
    {
      key: "costCap",
      label: P.plans.columns.costCap,
      numeric: true,
      cell: plan => (plan.costCap === null ? P.plans.noCap : formatUsd(plan.costCap)),
    },
    { key: "status", label: P.plans.columns.status, cell: plan => activeCell(plan.active) },
  ];

  const seatColumns: Column<BillingSeatType>[] = [
    {
      key: "name",
      label: P.seatTypes.columns.name,
      cell: type => <span className="font-medium text-typography-900">{type.name}</span>,
    },
    { key: "key", label: P.seatTypes.columns.key, cell: type => type.key },
    {
      key: "messages",
      label: P.seatTypes.columns.messages,
      numeric: true,
      cell: type => limit(type.messagesPerMonth),
    },
    { key: "rank", label: P.seatTypes.columns.rank, numeric: true, cell: type => type.rank },
    {
      key: "price",
      label: P.seatTypes.columns.price,
      numeric: true,
      cell: type => priceCell(type.price),
    },
    { key: "status", label: P.seatTypes.columns.status, cell: type => activeCell(type.active) },
  ];

  return (
    <div
      className="relative py-[2px] font-primary min-w-0 space-y-5"
      data-testid="billing-plans-page"
    >
      <div className="min-w-0">
        <h1 className="font-secondary text-2xl text-typography-900">{P.page.title}</h1>
        <p className="max-w-3xl pt-1 text-sm text-typography-700">{P.page.intro}</p>
      </div>
      {isError && (
        <p role="alert" className="text-sm text-destructive-500">
          {P.page.loadFailed}
        </p>
      )}
      {isLoading && <p className="text-sm text-typography-500">{P.page.loading}</p>}

      {data && (
        <>
          <Card testId="billing-renewals-due">
            <Head title={P.renewals.title} />
            <DataTable
              columns={RENEWAL_COLUMNS}
              rows={data.renewalsDue}
              rowKey={r => r.id}
              empty={P.renewals.empty}
            />
          </Card>

          <Card testId="billing-plans-table">
            <Head
              title={P.plans.title}
              action={
                <Button
                  variant={ButtonVariant.PRIMARY}
                  onClick={() => setPlanPanel({ plan: null })}
                >
                  {P.plans.add}
                </Button>
              }
            />
            <DataTable
              columns={planColumns}
              rows={data.plans}
              rowKey={plan => plan.id}
              empty={P.plans.empty}
              onRowClick={plan => setPlanPanel({ plan })}
            />
          </Card>

          <Card testId="billing-seat-types-table">
            <Head
              title={P.seatTypes.title}
              action={
                <Button
                  variant={ButtonVariant.TERTIARY}
                  onClick={() => setSeatPanel({ seatType: null })}
                >
                  {P.seatTypes.add}
                </Button>
              }
            />
            <DataTable
              columns={seatColumns}
              rows={seatTypes}
              rowKey={type => type.id}
              empty={P.seatTypes.empty}
              onRowClick={seatType => setSeatPanel({ seatType })}
            />
          </Card>
        </>
      )}

      {planPanel && (
        <PlanPanel
          plan={planPanel.plan}
          seatTypes={seatTypes}
          onClose={() => setPlanPanel(null)}
          onSave={input =>
            setConfirm({
              title: P.form.confirm.plan.title,
              description: fill(P.form.confirm.plan.body, { name: input.name }),
              confirmLabel: P.form.save,
              onConfirm: async note => {
                try {
                  await savePlan({ ...input, note }).unwrap();
                  toast.success(P.form.toast.plan);
                  setPlanPanel(null);
                } catch (error) {
                  toast.error(serverMessage(error, P.failed));
                  throw error;
                }
              },
            })
          }
        />
      )}
      {seatPanel && (
        <SeatTypePanel
          seatType={seatPanel.seatType}
          onClose={() => setSeatPanel(null)}
          onSave={input =>
            setConfirm({
              title: P.form.confirm.seatType.title,
              description: fill(P.form.confirm.seatType.body, { name: input.name }),
              confirmLabel: P.form.save,
              onConfirm: async note => {
                try {
                  await saveSeatType({ ...input, note }).unwrap();
                  toast.success(P.form.toast.seatType);
                  setSeatPanel(null);
                } catch (error) {
                  toast.error(serverMessage(error, P.failed));
                  throw error;
                }
              },
            })
          }
        />
      )}
      <NoteConfirm request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
};

export default BillingPlans;
