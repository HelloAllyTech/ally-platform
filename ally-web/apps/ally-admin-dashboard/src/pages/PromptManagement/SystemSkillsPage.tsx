import React from "react";

import { useSearchParams } from "react-router-dom";

import { Tabs } from "@ally-ui-mono/ui-shared";
import { en, Permissions } from "@constants";
import { useUser } from "@hooks";
import { hasPermissions } from "@utils";

import { SkillExperimentsTab } from "./experiments/SkillExperimentsTab";
import { PromptManagement } from "./PromptManagement";
import { SkillsStoreKeysTab } from "./SkillsStoreKeysTab";

export const SYSTEM_SKILLS_EXPERIMENTS_TAB = "experiments";
export const SKILLS_STORE_KEYS_TAB = "keys";

/**
 * Skills Store: the skill list, plus the Auto-improve tab for admins who may
 * see experiments and the Keys tab (keys for the prompts CLI) for admins who
 * can edit prompts. A tab that would only 403 is hidden, not disabled; with
 * neither permission the page is exactly the skill list, with no tab bar.
 */
export const SystemSkillsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { permissions } = useUser();
  const canViewExperiments = hasPermissions(permissions, [Permissions.VIEW_SKILL_EXPERIMENT]);
  const canManageKeys = hasPermissions(permissions, [Permissions.EDIT_PROMPT]);
  const requested = searchParams.get("tab");
  const activeTab =
    canViewExperiments && requested === SYSTEM_SKILLS_EXPERIMENTS_TAB
      ? SYSTEM_SKILLS_EXPERIMENTS_TAB
      : canManageKeys && requested === SKILLS_STORE_KEYS_TAB
        ? SKILLS_STORE_KEYS_TAB
        : "skills";
  const tabItems = [
    { id: "skills", label: en.skillExperiments.tabs.skills },
    ...(canViewExperiments
      ? [{ id: SYSTEM_SKILLS_EXPERIMENTS_TAB, label: en.skillExperiments.tabs.experiments }]
      : []),
    ...(canManageKeys ? [{ id: SKILLS_STORE_KEYS_TAB, label: en.skillsStore.keys.tab }] : []),
  ];

  const header = (
    <>
      <h1 className="text-2xl text-typography-900 pb-4 md:pb-6 font-secondary">
        {en.simulation.scenarioPrompts}
      </h1>
      {tabItems.length > 1 && (
        <Tabs
          className="mb-6"
          items={tabItems}
          activeId={activeTab}
          onChange={id => setSearchParams(id === "skills" ? {} : { tab: id })}
          showCount={false}
        />
      )}
    </>
  );

  if (activeTab === SKILLS_STORE_KEYS_TAB) {
    return (
      <div className="py-[2px] font-primary relative">
        {header}
        <SkillsStoreKeysTab />
      </div>
    );
  }
  if (activeTab === SYSTEM_SKILLS_EXPERIMENTS_TAB) {
    return (
      <div className="py-[2px] font-primary relative">
        {header}
        <SkillExperimentsTab />
      </div>
    );
  }
  return <PromptManagement header={header} />;
};
