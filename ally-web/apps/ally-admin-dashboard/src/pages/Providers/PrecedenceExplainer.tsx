import React from "react";

import { providersCopy } from "@constants/providers";

/**
 * "Which setting wins?" — one answer for every screen that can pick a model.
 *
 * A model id resolves at request time through four layers, later winning
 * (ally-be/docs/ai-task-registry.md). The same rule was previously only
 * implied in a paragraph of AI Tasks, so an admin editing a Language or a
 * Prompt had no way to know their edit might be overridden further down.
 */
export const PrecedenceExplainer: React.FC<{ className?: string }> = ({ className = "" }) => {
  const copy = providersCopy.precedence;
  return (
    <details
      className={`max-w-[80ch] rounded-md border border-border-200 bg-background-50 px-3 py-2 text-sm text-typography-700 ${className}`}
      data-testid="precedence-explainer"
    >
      <summary className="cursor-pointer select-none font-medium text-typography-900">
        {copy.summary}
      </summary>
      <p className="pt-2">{copy.intro}</p>
      <ol className="list-decimal pl-5 pt-1">
        {copy.layers.map(layer => (
          <li key={layer.label}>
            <span className="font-medium">{layer.label}</span> — {layer.detail}
          </li>
        ))}
      </ol>
    </details>
  );
};
