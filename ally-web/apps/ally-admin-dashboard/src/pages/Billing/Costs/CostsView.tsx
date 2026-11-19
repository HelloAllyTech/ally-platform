import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import { useGetCostOverviewQuery, useGetCostTrendQuery, useLazyExportCostsQuery } from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";

import { BILLING } from "../copy";
import { CostBreakdown } from "./CostBreakdown";
import { CostSettingsForm } from "./CostSettingsForm";
import { AlertsBanner, CostTotals, PerCustomer } from "./CostTotals";
import { CostTrendChart } from "./CostTrendChart";
import { FixedCosts } from "./FixedCosts";
import { periodFor, PeriodPreset } from "./period";
import { PlanMargins } from "./PlanMargins";

const C = BILLING.costs;

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div
    className={`rounded-md border border-border-light bg-white p-4 md:p-5 min-w-0 ${className ?? ""}`}
  >
    {children}
  </div>
);

/**
 * Ally admin → Costs (CR1 §A4): totals, the daily trend, breakdowns with an assistant drill-down,
 * cost per customer, alerts, fixed costs, the alert settings and an export. Dollars only here.
 */
export const CostsView: React.FC = () => {
  const { data: overview, isLoading, isError } = useGetCostOverviewQuery();
  const { data: trend = [] } = useGetCostTrendQuery(30);
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const period = useMemo(() => periodFor(preset), [preset]);
  const [exportCsv, exportState] = useLazyExportCostsQuery();

  const download = async () => {
    try {
      const csv = await exportCsv(period).unwrap();
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `ally-usage-${period.from ?? "month"}${period.to ? `-to-${period.to}` : ""}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(C.exportFailed);
    }
  };

  return (
    <div
      className="relative py-[2px] font-primary min-w-0 space-y-5"
      data-testid="billing-costs-page"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-secondary text-2xl text-typography-900">{C.title}</h1>
          <p className="max-w-3xl pt-1 text-sm text-typography-700">{C.intro}</p>
        </div>
        <Button
          variant={ButtonVariant.TERTIARY}
          onClick={download}
          disabled={exportState.isFetching}
          className="self-start shrink-0"
        >
          {exportState.isFetching ? C.exporting : C.export}
        </Button>
      </div>

      {isError && (
        <p role="alert" className="text-sm text-destructive-500">
          {C.loadFailed}
        </p>
      )}
      {isLoading && <p className="text-sm text-typography-500">{BILLING.models.loading}</p>}

      {overview && (
        <>
          <AlertsBanner alerts={overview.alerts ?? []} />
          <CostTotals overview={overview} />
        </>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2">
          <h2 className="text-lg font-medium">{C.trend.title}</h2>
          <p className="text-xs text-typography-500 pb-2">{C.trend.caption}</p>
          <CostTrendChart points={trend} />
        </Card>
        {overview && (
          <Card>
            <PerCustomer overview={overview} />
          </Card>
        )}
      </div>

      <Card>
        <CostBreakdown preset={preset} period={period} onPresetChange={setPreset} />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card>
          <FixedCosts />
        </Card>
        <Card>
          <CostSettingsForm settings={overview?.settings ?? null} />
        </Card>
      </div>

      {/* Against plans (§A4): each plan's and seat type's price against what it costs. */}
      <Card>
        <PlanMargins period={period} />
      </Card>
    </div>
  );
};
