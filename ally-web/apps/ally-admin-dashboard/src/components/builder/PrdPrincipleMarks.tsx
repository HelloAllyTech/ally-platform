import React from "react";

import { Tag, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import type { BuilderPrdDocument, BuilderPrdPrincipleMark, BuilderPrdReadiness } from "@types";
import { asAgentText } from "@utils";

import { CitationChip } from "../context-citation";

/**
 * The Context Library's mark on the PRD: every principle the session's guiding brief surfaced,
 * with what became of it — applied (and the section that cites it) or not relevant (and why).
 * Warns when the session retrieved no principles at all, since then none could have guided it.
 *
 * Renders nothing when readiness carries no principles summary and the PRD has no marks: an
 * older server, or a session from before principles.
 */
export const PrdPrincipleMarks: React.FC<{
  prd: BuilderPrdDocument;
  readiness: BuilderPrdReadiness;
}> = ({ prd, readiness }) => {
  const strings = en.builder.prd.principles;
  const sectionNames = en.builder.prd.sections;
  const summary = readiness.principles;
  const marks = (Array.isArray(prd.principleMarks) ? prd.principleMarks : []).filter(
    (mark): mark is BuilderPrdPrincipleMark =>
      !!mark && typeof mark === "object" && typeof mark.code === "string",
  );
  if (!summary && !marks.length) return null;

  const markOf = new Map(marks.map(mark => [mark.code, mark]));
  const codes = [...new Set([...(summary?.inBrief ?? []), ...marks.map(mark => mark.code)])];
  const unmarked = new Set(summary?.unmarked ?? []);

  return (
    <section className="mb-4 rounded p-1" data-testid="prd-principles">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-typography-900">{strings.heading}</h3>
        <Tooltip label={strings.tooltip} align="bottom">
          <button type="button" className="inline-flex cursor-pointer items-center">
            <TooltipIcon />
          </button>
        </Tooltip>
      </div>
      {summary && !summary.enabled ? (
        <p className="mt-1 text-sm text-typography-600">{strings.off}</p>
      ) : summary && summary.retrieved === 0 ? (
        <p className="mt-1 text-sm text-typography-700" role="status">
          {strings.noneRetrieved}
        </p>
      ) : null}
      {codes.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {codes.map(code => {
            const mark = markOf.get(code);
            // A mark the server no longer counts (its citation was edited out) reads as unmarked.
            const counted = mark && !unmarked.has(code);
            const section = mark?.section ? (sectionNames[mark.section] ?? mark.section) : "";
            return (
              <li key={code} className="flex items-start gap-2" data-testid={`principle-${code}`}>
                <span className="shrink-0">
                  <CitationChip code={code} />
                </span>
                <span className="shrink-0">
                  <Tag
                    type={counted ? (mark.mark === "applied" ? "green" : "cool-gray") : "warm-gray"}
                    size="sm"
                  >
                    {counted
                      ? mark.mark === "applied"
                        ? strings.applied
                        : strings.notRelevant
                      : strings.unmarked}
                  </Tag>
                </span>
                {counted && (
                  <span className="min-w-0 flex-1 text-sm text-typography-700">
                    {mark.mark === "applied"
                      ? section && strings.inSection(section)
                      : asAgentText(mark.reason)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
