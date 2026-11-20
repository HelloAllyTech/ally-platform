import React from "react";

import { useGetTemplateOriginQuery } from "@api";

import { TEMPLATE_COPY as C, fillIn } from "./copy";

/**
 * Overview and How it works (T1): "Set up from: {template}", and while a template's examples are
 * still in a list, how many and a way to replace them. Nothing when it came from no template.
 */
export const TemplateOriginLine: React.FC<{
  botId: string;
  /** Opens the list holding the examples (Tools). Without it, no link. */
  onReplace?: (listKey: string) => void;
  showExamples?: boolean;
}> = ({ botId, onReplace, showExamples = true }) => {
  const { data } = useGetTemplateOriginQuery(botId);
  if (!data?.template && !data?.examples_left.total) return null;
  return (
    <div className="ally-small" data-testid="template-origin">
      {data.template && (
        <p style={{ margin: 0 }}>{fillIn(C.origin, { template: data.template.name })}</p>
      )}
      {showExamples &&
        data.examples_left.lists.map(list => (
          <p key={list.key} style={{ margin: "4px 0 0" }}>
            {fillIn(C.examplesLeft, { n: list.count, list: list.name })}{" "}
            {onReplace && (
              <button
                type="button"
                className="ally-link"
                onClick={() => onReplace(list.key)}
                data-testid={`replace-examples-${list.key}`}
              >
                {C.replaceExamples}
              </button>
            )}
          </p>
        ))}
    </div>
  );
};
