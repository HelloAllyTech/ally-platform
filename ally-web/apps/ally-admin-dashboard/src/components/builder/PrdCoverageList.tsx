import React from "react";

import { Tag, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import type { BuilderPrdCoverageItem, BuilderPrdCoverageKey, BuilderPrdDocument } from "@types";
import { asAgentText } from "@utils";

/** The fixed list, in the order the server keeps it (`BUILDER_PRD_COVERAGE`). */
export const PRD_COVERAGE_KEYS: BuilderPrdCoverageKey[] = [
  "admin_web",
  "helpline_web",
  "mobile_app",
  "failure_empty_states",
  "permission_toggle",
  "success_metric",
  "existing_data_old_clients",
  "translations",
  "model_cost_registry",
  "other_readers",
];

const STATUS_TAG: Record<string, "green" | "cool-gray" | "blue" | "warm-gray"> = {
  answered: "green",
  not_applicable: "cool-gray",
  asked: "blue",
  open: "warm-gray",
};

/** The stored list, read defensively: the agent writes it. */
const coverageOf = (prd: BuilderPrdDocument): Map<string, BuilderPrdCoverageItem> => {
  const raw = Array.isArray(prd.coverage) ? prd.coverage : [];
  return new Map(
    raw
      .filter(item => item && typeof item === "object" && typeof item.key === "string")
      .map(item => [item.key, item]),
  );
};

/**
 * The coverage pass on the PRD: each client platform and each question every plan has to face
 * — answered (and where), not applicable (and why), or asked. The readiness row says which are
 * still open; this says what each answer was, so a reader can check it.
 *
 * Renders nothing for a PRD from before the pass that has no entries yet, except where the
 * server already reports the row — then every item shows as not covered, which is the truth.
 */
export const PrdCoverageList: React.FC<{
  prd: BuilderPrdDocument;
  /** Whether readiness carries the coverage row (servers that predate it don't). */
  assessed?: boolean;
}> = ({ prd, assessed = true }) => {
  const strings = en.builder.prd.coverage;
  const sectionNames = en.builder.prd.sections;
  const stored = coverageOf(prd);
  if (!assessed && stored.size === 0) return null;
  const covered = PRD_COVERAGE_KEYS.filter(key => stored.has(key)).length;

  return (
    <section className="mb-4 rounded p-1" data-testid="prd-coverage">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-typography-900">{strings.heading}</h3>
        <Tooltip label={strings.tooltip} align="bottom">
          <button type="button" className="inline-flex cursor-pointer items-center">
            <TooltipIcon />
          </button>
        </Tooltip>
        <span className="text-xs text-typography-500">
          {strings.count(covered, PRD_COVERAGE_KEYS.length)}
        </span>
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {PRD_COVERAGE_KEYS.map(key => {
          const item = stored.get(key);
          const status = item?.status ?? "open";
          const section = item?.section ? (sectionNames[item.section] ?? item.section) : "";
          return (
            <li key={key} className="flex items-start gap-2" data-testid={`coverage-${key}`}>
              <span className="shrink-0">
                <Tag type={STATUS_TAG[status] ?? "warm-gray"} size="sm">
                  {strings.status[status as keyof typeof strings.status] ?? strings.status.open}
                </Tag>
              </span>
              <span className="min-w-0 flex-1 text-sm text-typography-700">
                <span className="font-medium text-typography-900">{strings.items[key]}</span>
                {item && asAgentText(item.note) && <>: {asAgentText(item.note)}</>}
                {status === "answered" && section && (
                  <span className="text-xs text-typography-500">
                    {" "}
                    · {strings.inSection(section)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
