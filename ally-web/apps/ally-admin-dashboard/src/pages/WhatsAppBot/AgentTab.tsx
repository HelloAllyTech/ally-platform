import React from "react";

import { toast } from "sonner";

import {
  InlineNotification,
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  Slider,
} from "@ally-ui-mono/ui-shared";
import { useGetChatbotsQuery, useGetLlmModelsQuery, useUpdateChatbotMutation } from "@api";
import { Button, EntityField } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { Chatbot, ChatbotAnswerMode } from "@types";

import { handOverPart, PreviewDraft, settlePreviewDraft, useTabDraft } from "./previewDraft";
import { Card, errorMessage } from "./shared";
import { useReportUnsaved } from "./unsavedChanges";

const t = en.whatsappBot.bots.agent;
/** The runtime that answers chatbot questions; only its models are offered. */
const ANSWER_RUNTIME = "ally-ai";

type AnswersDraft = Pick<PreviewDraft, "answerMode" | "model">;

/** The part of the bot this tab edits. */
const answersPart = (draft: PreviewDraft): AnswersDraft => ({
  answerMode: draft.answerMode,
  model: draft.model,
});

/**
 * Everything about how the chatbot answers, in one place: what it can answer from and the model
 * that writes the answers. Every chatbot answers with the agent; platform admins are told when the
 * emergency switch in Defaults has it on the backup engine. Who it is and what it says stay on
 * Instructions.
 */
export const AgentTab: React.FC<{ bot: Chatbot; canEdit: boolean; onTest: () => void }> = ({
  bot,
  canEdit,
  onTest,
}) => {
  // Platform admins only: the same signal the chatbot pages use for every platform-wide control.
  const { data: list } = useGetChatbotsQuery();
  const { draft, setDraft, dirty } = useTabDraft(bot, answersPart);
  useReportUnsaved("agent", dirty);
  const [save, { isLoading: isSaving }] = useUpdateChatbotMutation();
  const { data: models = [] } = useGetLlmModelsQuery(ANSWER_RUNTIME);
  const selectedModel = models.find(
    m => m.provider === draft.model?.provider && m.model === draft.model?.model,
  );

  const handleSave = async () => {
    try {
      await save({ id: bot.id, answerMode: draft.answerMode, model: draft.model }).unwrap();
      settlePreviewDraft(bot, draft);
      toast.success(t.saved);
    } catch (err) {
      toast.error(errorMessage(err, t.saveFailed));
    }
  };

  const tryIt = () => {
    handOverPart(bot, draft);
    onTest();
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {list?.canCreate && bot.effectiveRuntime === "v1" && (
        <InlineNotification kind="info" title={t.agentOff} lowContrast hideCloseButton />
      )}

      <Card title={t.answersTitle} subtitle={t.answersIntro}>
        <EntityField label={t.answerModeLabel}>
          <RadioButtonGroup
            name="agent-answer-mode"
            orientation="vertical"
            valueSelected={draft.answerMode}
            disabled={!canEdit}
            onChange={value => setDraft(d => ({ ...d, answerMode: value as ChatbotAnswerMode }))}
          >
            <RadioButton
              id="answer-mode-docs"
              value={ChatbotAnswerMode.DOCUMENTS_ONLY}
              labelText={`${t.answerModeDocs} — ${t.answerModeDocsHint}`}
            />
            <RadioButton
              id="answer-mode-general"
              value={ChatbotAnswerMode.DOCUMENTS_AND_GENERAL}
              labelText={`${t.answerModeGeneral} — ${t.answerModeGeneralHint}`}
            />
          </RadioButtonGroup>
        </EntityField>
        <EntityField label={t.modelLabel} help={t.modelHelp}>
          <Select
            id="agent-model"
            labelText=""
            hideLabel
            disabled={!canEdit}
            value={draft.model ? `${draft.model.provider}::${draft.model.model}` : ""}
            onChange={e => {
              const [provider, model] = e.target.value.split("::");
              setDraft(d => ({
                ...d,
                model:
                  provider && model
                    ? { provider, model, temperature: d.model?.temperature ?? null }
                    : null,
              }));
            }}
          >
            <SelectItem value="" text={t.modelDefault} />
            {models.map(m => (
              <SelectItem
                key={`${m.provider}::${m.model}`}
                value={`${m.provider}::${m.model}`}
                text={`${m.label} (${m.provider})`}
              />
            ))}
          </Select>
        </EntityField>
        {draft.model && selectedModel?.supportsTemperature && (
          <EntityField label={t.temperatureLabel}>
            <Slider
              id="agent-temperature"
              labelText=""
              hideLabel
              min={0}
              max={1}
              step={0.1}
              value={draft.model.temperature ?? 0}
              disabled={!canEdit}
              onChange={({ value }: { value: number }) =>
                setDraft(d => (d.model ? { ...d, model: { ...d.model, temperature: value } } : d))
              }
            />
          </EntityField>
        )}
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button
              variant={ButtonVariant.PRIMARY}
              onClick={() => void handleSave()}
              disabled={!dirty || isSaving}
            >
              {t.save}
            </Button>
          )}
          <Button variant={ButtonVariant.SECONDARY} onClick={tryIt}>
            {t.tryIt}
          </Button>
        </div>
      </Card>
    </div>
  );
};
