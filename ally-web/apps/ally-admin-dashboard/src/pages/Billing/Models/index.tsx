import React from "react";

import { useSearchParams } from "react-router-dom";

import { Tabs } from "@ally-ui-mono/ui-shared";

import { BILLING } from "../copy";
import { ModelsTab } from "./ModelsTab";
import { WhatsAppRatesTab } from "./WhatsAppRatesTab";

const TABS = [
  { id: "models", label: BILLING.models.tabs.models },
  { id: "whatsapp", label: BILLING.models.tabs.whatsapp },
];

/**
 * Ally admin → Models (CR1 §A1): every model Ally can use with its price per million tokens, and
 * Meta's WhatsApp rates. Super admins with `manage_costs` only (checked by ally-be too).
 */
export const BillingModels: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "whatsapp" ? "whatsapp" : "models";
  return (
    <div className="relative py-[2px] font-primary min-w-0" data-testid="billing-models-page">
      <h1 className="font-secondary text-2xl text-typography-900">{BILLING.models.title}</h1>
      <p className="max-w-3xl pb-3 pt-1 text-sm text-typography-700">{BILLING.models.intro}</p>
      <Tabs
        items={TABS}
        activeId={tab}
        onChange={id => setParams(id === "models" ? {} : { tab: id }, { replace: true })}
        showCount={false}
      />
      <div className="pt-6 min-w-0">{tab === "models" ? <ModelsTab /> : <WhatsAppRatesTab />}</div>
    </div>
  );
};

export default BillingModels;
