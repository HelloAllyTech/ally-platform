import React, { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import {
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  Slider,
  TextArea,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import { useGetLlmModelsQuery, useUpdateChatbotMutation } from "@api";
import { Button, EntityField } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { Chatbot, ChatbotAnswerMode, ChatbotModelChoice, ChatbotPersona } from "@types";

import { Card, errorMessage, fill } from "./shared";

const t = en.whatsappBot.bots.persona;
const MAX_PROMPT = 4000;
/** The runtime that answers chatbot questions; only its models are offered. */
const ANSWER_RUNTIME = "ally-ai";

export interface PersonaDraft {
  name: string;
  description: string;
  persona: ChatbotPersona;
  answerMode: ChatbotAnswerMode;
  model: ChatbotModelChoice | null;
}

const draftOf = (bot: Chatbot): PersonaDraft => ({
  name: bot.name,
  description: bot.description ?? "",
  persona: { ...bot.persona },
  answerMode: bot.answerMode,
  model: bot.model,
});

/**
 * Who the bot is and how it answers: name, instructions, tone, greeting, answer mode and model.
 * Unsaved changes can be tried in the test console before saving (they travel as a draft).
 */
export const PersonaTab: React.FC<{ bot: Chatbot; canEdit: boolean; onTest: () => void }> = ({
  bot,
  canEdit,
  onTest,
}) => {
  const [draft, setDraft] = useState<PersonaDraft>(() => draftOf(bot));
  useEffect(() => {
    setDraft(draftOf(bot));
  }, [bot]);
  const [save, { isLoading: isSaving }] = useUpdateChatbotMutation();
  const { data: models = [] } = useGetLlmModelsQuery(ANSWER_RUNTIME);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(draftOf(bot)), [draft, bot]);
  const setPersona = (patch: Partial<ChatbotPersona>) =>
    setDraft(current => ({ ...current, persona: { ...current.persona, ...patch } }));
  const selectedModel = models.find(
    m => m.provider === draft.model?.provider && m.model === draft.model?.model,
  );

  const handleSave = async () => {
    try {
      await save({
        id: bot.id,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        persona: draft.persona,
        answerMode: draft.answerMode,
        model: draft.model,
      }).unwrap();
      toast.success(t.saved);
    } catch (err) {
      toast.error(errorMessage(err, t.saveFailed));
    }
  };

  const tryIt = () => {
    // The test tab picks the draft up from session storage, so unsaved changes can be tried there.
    try {
      sessionStorage.setItem(`chatbot-draft:${bot.id}`, JSON.stringify(draft));
    } catch {
      // Storage refused: the test runs against the saved bot instead.
    }
    onTest();
  };

  const promptLength = draft.persona.systemPrompt?.length ?? 0;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <Card title={t.title} subtitle={t.intro}>
        <EntityField label={t.nameLabel} help={t.nameHelp} required>
          <TextInput
            id="persona-name"
            labelText=""
            hideLabel
            value={draft.name}
            maxLength={120}
            disabled={!canEdit}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          />
        </EntityField>
        <EntityField label={t.descriptionLabel}>
          <TextInput
            id="persona-description"
            labelText=""
            hideLabel
            value={draft.description}
            maxLength={1000}
            disabled={!canEdit}
            onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
          />
        </EntityField>
        <EntityField label={t.displayNameLabel} help={t.displayNameHelp}>
          <TextInput
            id="persona-display-name"
            labelText=""
            hideLabel
            value={draft.persona.displayName ?? ""}
            maxLength={80}
            disabled={!canEdit}
            onChange={e => setPersona({ displayName: e.target.value })}
          />
        </EntityField>
        <EntityField label={t.toneLabel}>
          <TextInput
            id="persona-tone"
            labelText=""
            hideLabel
            placeholder={t.tonePlaceholder}
            value={draft.persona.tone ?? ""}
            maxLength={120}
            disabled={!canEdit}
            onChange={e => setPersona({ tone: e.target.value })}
          />
        </EntityField>
        <EntityField
          label={t.promptLabel}
          help={`${t.promptHelp} ${fill(t.promptCount, { count: promptLength, max: MAX_PROMPT })}`}
        >
          <TextArea
            id="persona-prompt"
            labelText=""
            hideLabel
            rows={8}
            value={draft.persona.systemPrompt ?? ""}
            maxLength={MAX_PROMPT}
            disabled={!canEdit}
            onChange={e => setPersona({ systemPrompt: e.target.value })}
          />
        </EntityField>
        <EntityField label={t.greetingLabel} help={t.greetingHelp}>
          <TextArea
            id="persona-greeting"
            labelText=""
            hideLabel
            rows={2}
            value={draft.persona.greeting ?? ""}
            maxLength={1000}
            disabled={!canEdit}
            onChange={e => setPersona({ greeting: e.target.value })}
          />
        </EntityField>
      </Card>

      <Card>
        <EntityField label={t.answerModeLabel}>
          <RadioButtonGroup
            name="persona-answer-mode"
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
            id="persona-model"
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
              id="persona-temperature"
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
      </Card>

      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button
            variant={ButtonVariant.PRIMARY}
            onClick={() => void handleSave()}
            disabled={!dirty || !draft.name.trim() || isSaving}
          >
            {t.save}
          </Button>
        )}
        <Button variant={ButtonVariant.SECONDARY} onClick={tryIt}>
          {t.tryIt}
        </Button>
      </div>
    </div>
  );
};
