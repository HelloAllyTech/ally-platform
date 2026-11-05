import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import { InlineNotification, RadioButton, RadioButtonGroup } from "@ally-ui-mono/ui-shared";
import { useGetChatbotQuery, useUpdateChatbotMutation } from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { ChatbotRuntime } from "@types";

import { Card, errorMessage } from "./shared";

const t = en.whatsappBot.orgSettings;

const OPTIONS: { value: ChatbotRuntime; label: string; help: string }[] = [
  { value: "v1", label: t.engineV1, help: t.engineV1Help },
  { value: "shadow", label: t.engineShadow, help: t.engineShadowHelp },
  { value: "v2", label: t.engineV2, help: t.engineV2Help },
];

/**
 * Which engine answers this chatbot: v1, Shadow (v1 answers, the new engine runs alongside for
 * comparison) or v2. Platform admins only — the caller renders it for them alone, and the API
 * refuses anyone else. Saved on its own, apart from the settings below, because it changes who
 * answers real people.
 */
export const ChatbotEngineCard: React.FC<{ chatbotId: string }> = ({ chatbotId }) => {
  const { data: bot } = useGetChatbotQuery(chatbotId);
  const [update, { isLoading: isSaving }] = useUpdateChatbotMutation();
  const [runtime, setRuntime] = useState<ChatbotRuntime>("v1");

  useEffect(() => {
    if (bot) setRuntime(bot.runtime ?? "v1");
  }, [bot]);

  if (!bot) return null;

  const save = async () => {
    try {
      await update({ id: chatbotId, runtime }).unwrap();
      toast.success(t.engineSaved);
    } catch (error) {
      toast.error(errorMessage(error, t.engineSaveFailed));
    }
  };

  return (
    <Card title={t.engineTitle} subtitle={t.engineIntro}>
      <RadioButtonGroup
        name="chatbot-engine"
        orientation="vertical"
        valueSelected={runtime}
        onChange={value => setRuntime(value as ChatbotRuntime)}
      >
        {OPTIONS.map(option => (
          <RadioButton
            key={option.value}
            id={`chatbot-engine-${option.value}`}
            value={option.value}
            labelText={`${option.label} — ${option.help}`}
          />
        ))}
      </RadioButtonGroup>
      {bot.runtime !== "v1" && bot.effectiveRuntime !== bot.runtime && (
        <InlineNotification kind="info" title={t.engineDisabled} lowContrast hideCloseButton />
      )}
      <div>
        <Button
          variant={ButtonVariant.SECONDARY}
          onClick={() => void save()}
          disabled={runtime === bot.runtime || isSaving}
        >
          {t.engineSave}
        </Button>
      </div>
    </Card>
  );
};
