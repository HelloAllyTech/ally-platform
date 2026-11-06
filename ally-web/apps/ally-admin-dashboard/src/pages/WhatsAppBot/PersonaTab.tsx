import React, { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import { TextArea, TextInput } from "@ally-ui-mono/ui-shared";
import { useUpdateChatbotMutation } from "@api";
import { Button, EntityField } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { Chatbot, ChatbotPersona } from "@types";

import { handOverToPreview, PreviewDraft } from "./previewDraft";
import { Card, errorMessage, fill, missingPersonaFields } from "./shared";

const t = en.whatsappBot.bots.persona;
const MAX_PROMPT = 4000;

/** The bot as this tab edits it. Answer mode and model are edited on the Agent tab. */
const draftOf = (bot: Chatbot): PreviewDraft => ({
  name: bot.name,
  description: bot.description ?? "",
  persona: { ...bot.persona },
  answerMode: bot.answerMode,
  model: bot.model,
});

/**
 * Who the bot is and what it says: name, instructions, tone and greeting. How it answers (answer
 * mode, model) is on the Agent tab. Unsaved changes can be tried in Preview before saving
 * (they travel as a draft).
 */
export const PersonaTab: React.FC<{ bot: Chatbot; canEdit: boolean; onTest: () => void }> = ({
  bot,
  canEdit,
  onTest,
}) => {
  const [draft, setDraft] = useState<PreviewDraft>(() => draftOf(bot));
  useEffect(() => {
    setDraft(draftOf(bot));
  }, [bot]);
  const [save, { isLoading: isSaving }] = useUpdateChatbotMutation();

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(draftOf(bot)), [draft, bot]);
  const setPersona = (patch: Partial<ChatbotPersona>) =>
    setDraft(current => ({ ...current, persona: { ...current.persona, ...patch } }));

  const handleSave = async () => {
    try {
      await save({
        id: bot.id,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        persona: draft.persona,
      }).unwrap();
      toast.success(t.saved);
    } catch (err) {
      toast.error(errorMessage(err, t.saveFailed));
    }
  };

  const tryIt = () => {
    handOverToPreview(bot.id, draft);
    onTest();
  };

  const promptLength = draft.persona.systemPrompt?.length ?? 0;
  const missing = missingPersonaFields(draft.persona);

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
        <EntityField label={t.displayNameLabel} help={t.displayNameHelp} required>
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
        <EntityField label={t.toneLabel} required>
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
          required
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
        <EntityField label={t.greetingLabel} help={t.greetingHelp} required>
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

      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button
            variant={ButtonVariant.PRIMARY}
            onClick={() => void handleSave()}
            disabled={!dirty || !draft.name.trim() || missing.length > 0 || isSaving}
          >
            {t.save}
          </Button>
        )}
        {canEdit && missing.length > 0 && (
          <span className="self-center text-sm text-typography-500">
            {fill(t.stillToFill, { fields: missing.join(", ") })}
          </span>
        )}
        <Button variant={ButtonVariant.SECONDARY} onClick={tryIt}>
          {t.tryIt}
        </Button>
      </div>
    </div>
  );
};
