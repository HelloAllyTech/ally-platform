import React, { useState } from "react";

import { useGetAssistantTemplatesQuery, useInstallTemplateMutation } from "@api";
import type { Chatbot, TemplateInstallResult } from "@types";

import { errorText } from "../../Onboarding/useOnboardingStart";
import { TEMPLATE_COPY } from "../../Templates/copy";
import { TemplateResult, TemplateSetup } from "../../Templates/TemplateSetup";

/**
 * Tools → Add from a template (T1): the template's lists, what the assistant may do with each,
 * their lines and its checkup questions, added without touching what the owner already has.
 * Owners only (the template can raise the safety pack and turn hand-over on).
 */
export const TemplateAdd: React.FC<{
  bot: Pick<Chatbot, "id">;
  onClose: () => void;
  onRunCheckup?: () => void;
}> = ({ bot, onClose, onRunCheckup }) => {
  const catalogue = useGetAssistantTemplatesQuery(bot.id);
  const [install, { isLoading }] = useInstallTemplateMutation();
  const [result, setResult] = useState<TemplateInstallResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (result) {
    return <TemplateResult result={result} onRunCheckup={onRunCheckup} onDone={onClose} />;
  }
  return (
    <div className="ally-card" data-testid="template-add">
      <TemplateSetup
        catalogue={catalogue.data}
        loading={catalogue.isLoading}
        failed={catalogue.isError}
        onRetry={() => void catalogue.refetch()}
        busy={isLoading}
        error={error}
        note={TEMPLATE_COPY.tools.before}
        onBack={onClose}
        onSubmit={async (template, answers) => {
          setError(null);
          try {
            setResult(await install({ id: bot.id, template: template.id, answers }).unwrap());
          } catch (err) {
            setError(errorText(err));
          }
        }}
      />
    </div>
  );
};
