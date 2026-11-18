import React from "react";

import { toast } from "sonner";

import { Tag, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import type { RoadmapBuildMode, RoadmapItemDetail } from "@types";

import { RoadmapDropdown } from "./RoadmapDropdown";
import { useSetRoadmapBuildModeMutation } from "../../../api/roadmapV2Flow";
import { errorMessage } from "../drafts/draftUtils";

/** The builder's choice, as the status parts carry it; null until they say. */
export const buildModeOf = (
  item: Pick<RoadmapItemDetail, "statusParts">,
): RoadmapBuildMode | null => {
  const parts = (item.statusParts ?? {}) as { buildMode?: unknown };
  return parts.buildMode === "builder_agent" || parts.buildMode === "outside"
    ? parts.buildMode
    : null;
};

/**
 * How it's built (lifecycle 2026-11-18): with the Builder agent here, or outside it. The assigned
 * builder (or an Owner) picks and can switch it at any time; everyone else sees it as a tag. Shown
 * only once a builder is assigned, because before that nobody is building it.
 */
export const BuildModeControl: React.FC<{ item: RoadmapItemDetail }> = ({ item }) => {
  const copy = en.roadmapV2.session;
  const words = en.roadmapV2.status.buildMode;
  const [save, { isLoading }] = useSetRoadmapBuildModeMutation();
  const mode = buildModeOf(item);
  if (!item.lead) return null;

  if (!item.can?.setBuildMode) {
    return mode ? (
      <Tag type="cool-gray" size="sm" className="!m-0" title={copy.buildModeLabel}>
        {words[mode]}
      </Tag>
    ) : null;
  }

  return (
    <span className="inline-flex items-center gap-1">
      <RoadmapDropdown
        id={`build-mode-${item.code}`}
        labelText={copy.buildModeLabel}
        hideLabel
        size="sm"
        disabled={isLoading}
        className="min-w-[10rem]"
        options={[
          ...(mode ? [] : [{ value: "", label: copy.buildModeLabel }]),
          { value: "builder_agent", label: words.builder_agent },
          { value: "outside", label: words.outside },
        ]}
        value={mode ?? ""}
        onChange={async value => {
          if (value !== "builder_agent" && value !== "outside") return;
          try {
            await save({ code: item.code, mode: value }).unwrap();
            toast.success(copy.buildModeSaved);
          } catch (error) {
            toast.error(errorMessage(error) ?? copy.buildModeFailed);
          }
        }}
      />
      <Tooltip label={copy.buildModeHelp} align="bottom">
        <button
          type="button"
          className="inline-flex cursor-pointer items-center"
          aria-label={copy.buildModeHelp}
        >
          <TooltipIcon />
        </button>
      </Tooltip>
    </span>
  );
};
