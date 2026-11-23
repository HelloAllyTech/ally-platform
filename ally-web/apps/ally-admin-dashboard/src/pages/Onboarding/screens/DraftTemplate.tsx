import React, { useState } from "react";

import { useGetTemplateCatalogueQuery } from "@api";
import type { TemplateAnswers, TemplateInstallResult } from "@types";

import { TEMPLATE_COPY as C } from "../../Templates/copy";
import { TemplateResult, TemplateSetup } from "../../Templates/TemplateSetup";

/**
 * After the website was read (T1): "Want a head start? Start from a template". Choosing one applies
 * it to this draft (purpose, a stricter pack, lists, checkup questions, the owner's answers), then
 * the owner carries on from What we learned.
 */
export const DraftTemplate: React.FC<{
  busy: boolean;
  onApply: (template: string, answers: TemplateAnswers) => Promise<TemplateInstallResult | null>;
}> = ({ busy, onApply }) => {
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<TemplateInstallResult | null>(null);
  const templates = useGetTemplateCatalogueQuery(undefined, { skip: !open });

  if (result) {
    return <TemplateResult result={result} onDone={() => setResult(null)} />;
  }
  if (!open) {
    return (
      <p className="ally-small" style={{ margin: 0 }} data-testid="draft-template">
        {C.afterReading}{" "}
        <button type="button" className="ally-link" onClick={() => setOpen(true)}>
          {C.start.title}
        </button>
      </p>
    );
  }
  return (
    <div className="ally-card" data-testid="draft-template-setup">
      <TemplateSetup
        catalogue={templates.data}
        loading={templates.isLoading}
        failed={templates.isError}
        onRetry={() => void templates.refetch()}
        busy={busy || applying}
        onBack={() => setOpen(false)}
        onSubmit={async (template, answers) => {
          setApplying(true);
          const done = await onApply(template.id, answers);
          setApplying(false);
          if (done) {
            setOpen(false);
            setResult(done);
          }
        }}
      />
    </div>
  );
};
