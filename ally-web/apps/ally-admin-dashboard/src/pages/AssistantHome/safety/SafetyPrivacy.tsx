import React from "react";

import { SafetyPrivacyFields } from "./SafetyFields";
import { useSafetySettings } from "./useSafetySettings";
import { SAFETY_PRIVACY_COPY as C } from "../copy/safetyPrivacy";
import { Group } from "../fields";

/** Settings → Safety and privacy: reads and writes the chatbot's stored settings. */
export const SafetyPrivacy: React.FC<{ botId: string; canEdit: boolean }> = ({
  botId,
  canEdit,
}) => {
  const settings = useSafetySettings(botId);
  return (
    <Group title={C.title} hint={C.hint} testId="settings-safety-privacy">
      {settings.failed ? (
        <p className="ally-error" role="alert">
          {C.saveFailed}
        </p>
      ) : (
        <SafetyPrivacyFields values={settings.values} disabled={!canEdit} save={settings.save} />
      )}
    </Group>
  );
};
