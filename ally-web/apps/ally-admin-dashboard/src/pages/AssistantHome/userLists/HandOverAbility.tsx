import React from "react";

import { useGetChatbotSettingsQuery, useUpdateChatbotSettingsMutation } from "@api";
import { Switch } from "@components/v2";

import { HOME } from "../copy";

const t = () => HOME.userLists.tools;

/**
 * Whether the assistant may hand a chat to a person (`hand_over` in the bot's abilities). Only
 * Ally's platform admins could set it before A1; now the assistant's owners do, here in Tools.
 * Unset reads as off (Never), as the agent treats it. Editors and viewers see it, switched off.
 */
export const HandOverAbility: React.FC<{ botId: string; canManage: boolean }> = ({
  botId,
  canManage,
}) => {
  const { data } = useGetChatbotSettingsQuery(botId);
  const [update, { isLoading, isError }] = useUpdateChatbotSettingsMutation();
  if (!data) return null;
  const overrides = data.overrides ?? {};
  const abilities = overrides.abilities ?? {};
  const on = abilities.hand_over === "do_it";

  return (
    <div data-testid="handover-ability">
      <Switch
        label={t().handoverAbility}
        hint={t().handoverAbilityHint}
        checked={on}
        disabled={!canManage || isLoading}
        onChange={checked =>
          void update({
            id: botId,
            settings: {
              ...overrides,
              abilities: { ...abilities, hand_over: checked ? "do_it" : "never" },
            },
          })
        }
      />
      {!canManage && <p className="ally-small">{t().handoverAbilityOwners}</p>}
      {isError && (
        <p className="ally-small" role="alert">
          {t().handoverAbilityFailed}
        </p>
      )}
    </div>
  );
};
