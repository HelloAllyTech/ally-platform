import React, { useMemo } from "react";

import { useSelector } from "react-redux";
import { useLocation, useSearchParams } from "react-router-dom";

import { Tabs } from "@ally-ui-mono/ui-shared";
import { FeatureToggleKey } from "@constants";
import { providersCopy } from "@constants/providers";
import { RootState } from "@store";
import { hasFeature } from "@utils";

import { PrecedenceExplainer } from "./PrecedenceExplainer";
import { LlmModelCatalog } from "../LlmModelCatalog/LlmModelCatalog";
import { ScenarioVoices } from "../ScenarioVoices/ScenarioVoices";
import { SttConfigs } from "../SttConfigs/SttConfigs";

export enum ProvidersTab {
  SPEECH = "speech",
  MODELS = "models",
  VOICES = "voices",
}

const TABS = [
  {
    id: ProvidersTab.SPEECH,
    label: providersCopy.tabs.speech,
    feature: FeatureToggleKey.MANAGE_STT_CONFIGS,
    legacyPath: "stt-configs",
  },
  {
    id: ProvidersTab.MODELS,
    label: providersCopy.tabs.models,
    feature: FeatureToggleKey.MANAGE_LLM_MODEL_CATALOG,
    legacyPath: "llm-model-catalog",
  },
  {
    id: ProvidersTab.VOICES,
    label: providersCopy.tabs.voices,
    feature: FeatureToggleKey.SCENARIO_VOICES,
    legacyPath: "scenario-voices",
  },
];

/**
 * Speech Recognition, Language Models and Voices in one place.
 *
 * They were three sidebar entries over the same ProviderConfigRegistry idea:
 * a language or simulation points at a row here and a vendor change is one edit.
 * The tab lives in the address (`?tab=`); the three old routes keep working
 * because, with no `?tab=`, the tab is inferred from the path they mount at.
 */
export const Providers: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();
  const features = useSelector((state: RootState) => state.user?.features);

  const visible = useMemo(() => TABS.filter(tab => hasFeature(features, tab.feature)), [features]);

  const activeTab = useMemo(() => {
    const requested = searchParams.get("tab");
    if (requested && visible.some(tab => tab.id === requested)) return requested;
    const fromPath = TABS.find(tab => pathname.includes(tab.legacyPath));
    if (fromPath && visible.some(tab => tab.id === fromPath.id)) return fromPath.id;
    return visible[0]?.id ?? ProvidersTab.SPEECH;
  }, [searchParams, pathname, visible]);

  return (
    <div className="relative py-[2px] font-primary" data-testid="providers-page">
      <h1 className="font-secondary text-2xl text-typography-900">{providersCopy.title}</h1>
      <p className="max-w-3xl pb-3 pt-1 text-sm text-typography-700">{providersCopy.intro}</p>
      <PrecedenceExplainer className="mb-4" />
      <Tabs
        items={visible.map(({ id, label }) => ({ id, label }))}
        activeId={activeTab}
        onChange={id => setSearchParams({ tab: id }, { replace: true })}
        showCount={false}
      />
      <div className="pt-6">
        {activeTab === ProvidersTab.SPEECH && <SttConfigs hideTitle />}
        {activeTab === ProvidersTab.MODELS && <LlmModelCatalog hideTitle />}
        {activeTab === ProvidersTab.VOICES && <ScenarioVoices hideTitle />}
      </div>
    </div>
  );
};

export default Providers;
