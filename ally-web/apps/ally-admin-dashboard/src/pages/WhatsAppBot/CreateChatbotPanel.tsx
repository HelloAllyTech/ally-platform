import React, { useState } from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { RadioButton, RadioButtonGroup, TextInput } from "@ally-ui-mono/ui-shared";
import { useCreateChatbotMutation } from "@api";
import { EntityField, EntitySidePanel } from "@components";
import { en, ROUTES } from "@constants";

import { errorMessage, fill } from "./shared";

const t = en.whatsappBot.bots.createPanel;
const presets = en.whatsappBot.bots.presets;
type PresetKey = keyof typeof presets;

/**
 * Create a bot from a preset. Only the name is required: the bot is saved as a draft straight
 * away and opened on its Overview, whose checklist walks through the rest — so leaving half-way
 * loses nothing.
 */
export const CreateChatbotPanel: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const navigate = useNavigate();
  const [create, { isLoading }] = useCreateChatbotMutation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [preset, setPreset] = useState<PresetKey>("faq");

  const handleSave = async () => {
    const chosen = presets[preset];
    try {
      const bot = await create({
        name: name.trim(),
        description: description.trim() || undefined,
        persona: {
          displayName: name.trim(),
          ...(chosen.tone ? { tone: chosen.tone } : {}),
          ...(chosen.prompt ? { systemPrompt: chosen.prompt } : {}),
        },
      }).unwrap();
      toast.success(fill(t.created, { name: bot.name }));
      setName("");
      setDescription("");
      onClose();
      navigate(ROUTES.CHATBOT_DETAIL.replace(":botId", bot.id));
    } catch (err) {
      toast.error(errorMessage(err, t.failed));
    }
  };

  return (
    <EntitySidePanel
      isOpen={isOpen}
      title={t.title}
      dirty={Boolean(name.trim())}
      saveDisabled={!name.trim() || isLoading}
      onClose={onClose}
      onSave={() => void handleSave()}
    >
      <p className="text-sm text-typography-600">{t.intro}</p>
      <EntityField label={t.nameLabel} required>
        <TextInput
          id="chatbot-name"
          labelText=""
          hideLabel
          placeholder={t.namePlaceholder}
          value={name}
          maxLength={120}
          onChange={event => setName(event.target.value)}
        />
      </EntityField>
      <EntityField label={t.descriptionLabel}>
        <TextInput
          id="chatbot-description"
          labelText=""
          hideLabel
          value={description}
          maxLength={1000}
          onChange={event => setDescription(event.target.value)}
        />
      </EntityField>
      <EntityField label={t.presetLabel}>
        <RadioButtonGroup
          name="chatbot-preset"
          orientation="vertical"
          valueSelected={preset}
          onChange={value => setPreset(value as PresetKey)}
        >
          {(Object.keys(presets) as PresetKey[]).map(key => (
            <RadioButton
              key={key}
              id={`chatbot-preset-${key}`}
              value={key}
              labelText={`${presets[key].label} — ${presets[key].hint}`}
            />
          ))}
        </RadioButtonGroup>
      </EntityField>
    </EntitySidePanel>
  );
};
