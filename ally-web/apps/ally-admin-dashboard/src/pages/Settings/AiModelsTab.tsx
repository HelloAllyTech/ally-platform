import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import {
  Button,
  CarbonToggle,
  InlineNotification,
  Select,
  SelectItem,
  SkeletonText,
} from "@ally-ui-mono/ui-shared";
import {
  useGetBuilderSettingsQuery,
  useGetValidatedAgentTurnsQuery,
  useUpdateBuilderSettingsMutation,
  useUpdateValidatedAgentTurnsMutation,
} from "@api";
import { en } from "@constants";
import { ValidatedAgentTurnsSettings } from "@types";

/**
 * The Claude Code models Builder's harness can run. Not the full platform
 * model catalog (that includes OpenAI entries the harness cannot use). Ordered cheap to
 * expensive so the trade-off reads directly from the list.
 */
const CLAUDE_CODE_MODEL_OPTIONS = [
  { value: "claude-haiku-4-5", text: "claude-haiku-4-5 (fastest, cheapest)" },
  { value: "claude-sonnet-5", text: "claude-sonnet-5 (balanced — current default)" },
  { value: "claude-opus-5", text: "claude-opus-5 (strongest, most expensive)" },
];

/**
 * Builder's default engine, proven end to end: a full unattended run on
 * 2026-09-23 planned, coded, caught its own missed requirement, remediated,
 * reviewed and merged ally-web#694.
 */
const GEMINI_MODEL_OPTIONS = [
  { value: "gemini-2.5-flash", text: "gemini-2.5-flash (fastest, cheapest)" },
  { value: "gemini-2.5-pro", text: "gemini-2.5-pro (strongest)" },
];

/** Everything opencode can run: it is a harness over the same vendors, so both lists apply. */
const OPENCODE_MODEL_OPTIONS = [...GEMINI_MODEL_OPTIONS, ...CLAUDE_CODE_MODEL_OPTIONS];

/** Builder's three tiers, trimmed to just the fields this tab edits. */
type BuilderModelDraft = {
  plannerModel: string | null;
  coderModel: string | null;
  verifierModel: string | null;
};

/**
 * Builder's planner/coder/verifier tiers. Its other settings (kill switch,
 * concurrency, budget, repo maps) stay on `/builder/settings` — this section
 * only edits the three model fields, via the same
 * `useUpdateBuilderSettingsMutation` that page already uses (every field on
 * it is optional, so sending just these three is a normal partial update).
 */
const BuilderModelSection: React.FC = () => {
  const strings = en.settings.aiModels;
  const builderStrings = en.builder.settings;
  const { data, isLoading, isError } = useGetBuilderSettingsQuery();
  const [updateSettings, { isLoading: isSaving }] = useUpdateBuilderSettingsMutation();
  const [draft, setDraft] = useState<BuilderModelDraft | null>(null);

  useEffect(() => {
    if (data) {
      setDraft({
        plannerModel: data.plannerModel,
        coderModel: data.coderModel,
        verifierModel: data.verifierModel,
      });
    }
  }, [data]);

  const set = (key: keyof BuilderModelDraft, value: string | null) =>
    setDraft(current => (current ? { ...current, [key]: value } : current));

  const handleSave = async () => {
    if (!draft) return;
    try {
      await updateSettings({
        // "" clears a tier back to the platform default — see api/builder.ts.
        plannerModel: draft.plannerModel ?? "",
        coderModel: draft.coderModel ?? "",
        verifierModel: draft.verifierModel ?? "",
      }).unwrap();
      toast.success(strings.saved);
    } catch {
      toast.error(strings.builderSaveFailed);
    }
  };

  return (
    <section className="mt-4 rounded-md border border-border-light p-4">
      <h3 className="text-base font-secondary text-typography-900">{strings.builderHeading}</h3>

      {isError && (
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={strings.builderLoadFailed}
        />
      )}

      {isLoading || !draft ? (
        <SkeletonText paragraph lineCount={4} className="mt-3" />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              id="settings-ai-models-builder-planner-model"
              labelText={builderStrings.plannerModelLabel}
              value={draft.plannerModel ?? ""}
              onChange={event => set("plannerModel", event.target.value || null)}
            >
              <SelectItem value="" text={builderStrings.modelPlaceholder} />
              {OPENCODE_MODEL_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value} text={option.text} />
              ))}
            </Select>
            <Select
              id="settings-ai-models-builder-coder-model"
              labelText={builderStrings.coderModelLabel}
              value={draft.coderModel ?? ""}
              onChange={event => set("coderModel", event.target.value || null)}
            >
              <SelectItem value="" text={builderStrings.modelPlaceholder} />
              {OPENCODE_MODEL_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value} text={option.text} />
              ))}
            </Select>
            <Select
              id="settings-ai-models-builder-verifier-model"
              labelText={builderStrings.verifierModelLabel}
              value={draft.verifierModel ?? ""}
              onChange={event => set("verifierModel", event.target.value || null)}
            >
              <SelectItem value="" text={builderStrings.modelPlaceholder} />
              {OPENCODE_MODEL_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value} text={option.text} />
              ))}
            </Select>
          </div>
          <div className="mt-4">
            <Button kind="primary" size="sm" disabled={isSaving} onClick={() => void handleSave()}>
              {strings.save}
            </Button>
          </div>
        </>
      )}
    </section>
  );
};

/**
 * The validated-turn kill switches for Course Copilot and the character interview: on, a turn's
 * reply reaches the person only once it has been checked against what the turn did; off, that
 * agent runs its previous loop. Each toggle saves on its own — a kill switch that waits for a
 * Save button is one more step between noticing a problem and stopping it.
 */
const ValidatedTurnsSection: React.FC = () => {
  const strings = en.settings.aiModels;
  const { data, isLoading, isError } = useGetValidatedAgentTurnsQuery();
  const [update, { isLoading: isSaving }] = useUpdateValidatedAgentTurnsMutation();

  const agents: { key: keyof ValidatedAgentTurnsSettings; label: string; id: string }[] = [
    {
      key: "courseCopilot",
      label: strings.validatedTurnsCourseCopilot,
      id: "settings-validated-turns-course-copilot",
    },
    {
      key: "characterInterview",
      label: strings.validatedTurnsCharacterInterview,
      id: "settings-validated-turns-character-interview",
    },
  ];

  const handleToggle = async (
    key: keyof ValidatedAgentTurnsSettings,
    label: string,
    on: boolean,
  ) => {
    try {
      await update({ [key]: on }).unwrap();
      toast.success(strings.validatedTurnsSaved(label, on));
    } catch {
      toast.error(strings.validatedTurnsSaveFailed);
    }
  };

  return (
    <section className="mt-4 rounded-md border border-border-light p-4">
      <h3 className="text-base font-secondary text-typography-900">
        {strings.validatedTurnsHeading}
      </h3>
      <p className="pt-1 text-xs text-typography-500">{strings.validatedTurnsHelp}</p>

      {isError && (
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={strings.validatedTurnsLoadFailed}
        />
      )}

      {isLoading ? (
        <SkeletonText paragraph lineCount={2} className="mt-3" />
      ) : (
        data && (
          <div className="relative mt-3 flex flex-col gap-3">
            {agents.map(agent => (
              <CarbonToggle
                key={agent.key}
                id={agent.id}
                labelText={agent.label}
                size="sm"
                toggled={data[agent.key]}
                disabled={isSaving}
                onToggle={(checked: boolean) => void handleToggle(agent.key, agent.label, checked)}
              />
            ))}
          </div>
        )
      )}
    </section>
  );
};

export const AiModelsTab: React.FC = () => (
  <div>
    <BuilderModelSection />
    <ValidatedTurnsSection />
  </div>
);
