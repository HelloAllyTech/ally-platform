import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import {
  CarbonToggle,
  InlineNotification,
  RadioButton,
  RadioButtonGroup,
  Tooltip,
} from "@ally-ui-mono/ui-shared";
import { useUpdateChatbotMutation } from "@api";
import { TooltipIcon } from "@assets";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { Chatbot, ChatbotRuntime } from "@types";

import { Card, errorMessage } from "./shared";

const t = en.whatsappBot.orgSettings;

const OPTIONS: { value: ChatbotRuntime; label: string; help: string }[] = [
  { value: "v1", label: t.engineV1, help: t.engineV1Help },
  { value: "shadow", label: t.engineShadow, help: t.engineShadowHelp },
  { value: "v2", label: t.engineV2, help: t.engineV2Help },
];

/**
 * Which engine answers this chatbot: v1, Shadow (v1 answers, the new engine runs alongside for
 * comparison) or v2, and, on v2, Agent mode. Platform admins only — the caller renders it for them
 * alone, and the API refuses anyone else. Saved on its own, apart from the settings below, because
 * it changes who answers real people.
 */
export const ChatbotEngineCard: React.FC<{ bot: Chatbot }> = ({ bot }) => {
  const [update, { isLoading: isSaving }] = useUpdateChatbotMutation();
  const [runtime, setRuntime] = useState<ChatbotRuntime>(bot.runtime ?? "v1");
  const [agent, setAgent] = useState(Boolean(bot.features?.agent));

  // The saved bot changed (this card's own save, or a refetch): show what is saved now.
  useEffect(() => {
    setRuntime(bot.runtime ?? "v1");
    setAgent(Boolean(bot.features?.agent));
  }, [bot]);

  const savedAgent = Boolean(bot.features?.agent);
  const changed = runtime !== bot.runtime || agent !== savedAgent;

  const save = async () => {
    try {
      await update({
        id: bot.id,
        ...(runtime !== bot.runtime ? { runtime } : {}),
        ...(agent !== savedAgent ? { features: { agent } } : {}),
      }).unwrap();
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
      {runtime === "v2" && (
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-sm text-typography-900">
              {t.agentModeLabel}
              <Tooltip label={t.agentModeTooltip} align="top">
                <button type="button" className="cursor-pointer inline-flex items-center">
                  <TooltipIcon />
                </button>
              </Tooltip>
            </span>
            <span className="text-xs text-typography-500">{t.agentModeHelp}</span>
          </div>
          <CarbonToggle
            id="chatbot-agent-mode"
            labelText=""
            aria-label={t.agentModeLabel}
            labelA={en.whatsappBot.bots.defaults.off}
            labelB={en.whatsappBot.bots.defaults.on}
            size="sm"
            toggled={agent}
            onToggle={(checked: boolean) => setAgent(checked)}
          />
        </div>
      )}
      {bot.runtime !== "v1" && bot.effectiveRuntime !== bot.runtime && (
        <InlineNotification kind="info" title={t.engineDisabled} lowContrast hideCloseButton />
      )}
      <div>
        <Button
          variant={ButtonVariant.SECONDARY}
          onClick={() => void save()}
          disabled={!changed || isSaving}
        >
          {t.engineSave}
        </Button>
      </div>
    </Card>
  );
};
