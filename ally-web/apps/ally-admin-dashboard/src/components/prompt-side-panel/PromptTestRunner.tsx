import React, { useEffect, useMemo, useState } from "react";

import { useGetLlmModelCatalogQuery, useTestPromptMutation } from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { promptTestCopy as copy } from "@constants/providers";
import { LlmPreviewResult } from "@types";

interface PromptTestRunnerProps {
  /** The text being edited, saved or not. */
  promptText: string;
  /** The prompt's own model id (e.g. "gpt-5-mini"); preselects the matching catalog row. */
  currentModel?: string;
}

/**
 * Try the prompt as written, before saving it: edit, run against a sample,
 * read the reply, edit again — without leaving the editor.
 *
 * Runs through the same preview bench as the Model Catalog's "Test model"
 * (ally-be `llm-preview`), so a provider rejection comes back as the vendor's
 * own words rather than a generic failure.
 */
export const PromptTestRunner: React.FC<PromptTestRunnerProps> = ({ promptText, currentModel }) => {
  const { data: catalog = [] } = useGetLlmModelCatalogQuery({ runtime: "ally-be" });
  const [runTest, { isLoading }] = useTestPromptMutation();
  const [sample, setSample] = useState("");
  const [modelId, setModelId] = useState("");
  const [result, setResult] = useState<LlmPreviewResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const active = useMemo(() => catalog.filter(model => model.active), [catalog]);

  // Preselect the catalog row matching the prompt's own model, else the first.
  useEffect(() => {
    if (modelId && active.some(model => model.id === modelId)) return;
    const match = active.find(model => model.model === currentModel);
    setModelId((match ?? active[0])?.id ?? "");
  }, [active, currentModel, modelId]);

  const canRun = promptText.trim().length > 0 && !!modelId && !isLoading;

  const run = async () => {
    setResult(null);
    setRequestError(null);
    try {
      setResult(await runTest({ modelId, promptText, sampleInput: sample }).unwrap());
    } catch (error: any) {
      const message = error?.data?.message;
      setRequestError(Array.isArray(message) ? message.join(", ") : (message ?? copy.failed));
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="prompt-test-runner">
      <p className="text-sm text-typography-600">{copy.hint}</p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{copy.sampleLabel}</span>
        <textarea
          value={sample}
          onChange={event => setSample(event.target.value)}
          placeholder={copy.samplePlaceholder}
          rows={3}
          className="w-full rounded-md border border-border-200 bg-background-0 p-2"
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{copy.modelLabel}</span>
          <select
            value={modelId}
            onChange={event => setModelId(event.target.value)}
            className="h-9 rounded-md border border-border-200 bg-background-0 px-2"
            disabled={active.length === 0}
          >
            {active.map(model => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <Button variant={ButtonVariant.SECONDARY} onClick={() => void run()} disabled={!canRun}>
          {isLoading ? copy.running : copy.run}
        </Button>
      </div>
      {active.length === 0 && <p className="text-sm text-typography-500">{copy.noModels}</p>}
      {promptText.trim().length === 0 && (
        <p className="text-sm text-typography-500">{copy.emptyPrompt}</p>
      )}
      {requestError && (
        <p role="alert" className="text-sm text-destructive-500">
          {requestError}
        </p>
      )}
      {result && (
        <div
          className="rounded-md border border-border-200 bg-background-50 p-3 text-sm"
          data-testid="prompt-test-result"
        >
          {result.ok ? (
            <pre className="whitespace-pre-wrap font-primary">{result.text || "(empty reply)"}</pre>
          ) : (
            <p role="alert" className="text-destructive-500">
              {copy.failed}: {result.error}
            </p>
          )}
          <p className="pt-2 text-xs text-typography-500">
            {result.configName} · {result.latencyMs} ms
            {result.promptTokens != null
              ? ` · ${result.promptTokens} in / ${result.completionTokens ?? 0} out tokens`
              : ""}
          </p>
        </div>
      )}
    </div>
  );
};
