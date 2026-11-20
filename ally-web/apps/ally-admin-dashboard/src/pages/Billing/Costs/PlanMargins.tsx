import React from "react";

import { useGetPlanCostsQuery } from "@api";
import type { CostPeriod, PlanCosts } from "@api";

import { formatCost, formatCount, formatUsd } from "../money";
import { PLANS } from "../plansCopy";
import { Column, DataTable } from "../Table";

const C = PLANS.costs;

type PlanRow = PlanCosts["plans"][number];
type SeatRow = PlanCosts["seatTypes"][number];

const price = (usd: number | null) => (usd === null ? C.noPrice : formatUsd(usd));

const PLAN_COLUMNS: Column<PlanRow>[] = [
  { key: "plan", label: C.plansColumns.plan, cell: r => r.name },
  { key: "price", label: C.plansColumns.price, numeric: true, cell: r => price(r.price) },
  {
    key: "subs",
    label: C.plansColumns.subscribers,
    numeric: true,
    cell: r => formatCount(r.subscribers),
  },
  { key: "cost", label: C.plansColumns.cost, numeric: true, cell: r => formatCost(r.cost) },
  { key: "earns", label: C.plansColumns.earns, numeric: true, cell: r => formatUsd(r.earns) },
  {
    key: "margin",
    label: C.plansColumns.margin,
    numeric: true,
    cell: r => (
      <span className={r.margin < 0 ? "text-destructive-500" : undefined}>
        {formatUsd(r.margin)}
      </span>
    ),
  },
  {
    key: "per",
    label: C.plansColumns.perSubscriber,
    numeric: true,
    cell: r => (r.costPerSubscriber === null ? "—" : formatCost(r.costPerSubscriber)),
  },
];

const SEAT_COLUMNS: Column<SeatRow>[] = [
  { key: "seat", label: C.seatsColumns.seat, cell: r => r.name },
  { key: "price", label: C.seatsColumns.price, numeric: true, cell: r => price(r.price) },
  {
    key: "extra",
    label: C.seatsColumns.extra,
    numeric: true,
    cell: r => formatCount(r.extraSeats),
  },
  {
    key: "included",
    label: C.seatsColumns.included,
    numeric: true,
    cell: r => formatCount(r.includedSeats),
  },
  { key: "earns", label: C.seatsColumns.earns, numeric: true, cell: r => formatUsd(r.earns) },
];

/**
 * Costs → Plans (CR1 §A4 "Against plans"): each plan's cost against what it earns at the prices
 * entered on Ally admin → Plans, and what each seat type's extra seats earn. Same period as the
 * breakdown above it.
 */
export const PlanMargins: React.FC<{ period: CostPeriod }> = ({ period }) => {
  const { data, isLoading } = useGetPlanCostsQuery(period);
  return (
    <section className="space-y-3" data-testid="billing-plan-margins">
      <div>
        <h2 className="text-lg font-medium">{C.title}</h2>
        {data && <p className="text-sm text-typography-600">{C.intro(data.months)}</p>}
      </div>
      {isLoading && <p className="text-sm text-typography-500">{C.loading}</p>}
      {data && (
        <>
          <DataTable columns={PLAN_COLUMNS} rows={data.plans} rowKey={r => r.key} empty={C.empty} />
          <h3 className="text-base font-medium pt-2">{C.seatsTitle}</h3>
          <DataTable
            columns={SEAT_COLUMNS}
            rows={data.seatTypes}
            rowKey={r => r.key}
            empty={C.empty}
          />
        </>
      )}
    </section>
  );
};
