import React from "react";

import { Locked, TooltipIcon } from "@icons";

import { Button, RichTextRenderer, Tooltip } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import type {
  CourseChangeLogEntry,
  CourseOutline,
  CourseOutlineSection,
  CoursePublishReadiness,
} from "@types";
import { asAgentText } from "@utils";

import { ChangeLog } from "./ChangeLog";
import { asArray, asNumber, formatMinutes, humanizeToken } from "./courseCopilotFormat";
import { ItemPreviewCard } from "./ItemPreviewCard";
import { PublishCheck, PublishReadiness } from "./PublishReadiness";

export interface CourseOutlinePanelProps {
  outline: CourseOutline | null | undefined;
  readiness?: CoursePublishReadiness | null;
  changeLog?: CourseChangeLogEntry[] | null;
  /**
   * Item ids the copilot just changed — their cards highlight briefly. Pass a new array for
   * each change: an id that stays in the same array does not highlight again.
   */
  flashItemIds?: string[];
  /**
   * Compact: one line per item and no checklist or change log. Used under the build's job
   * list, where the outline is a progress view and the full course view is one tab away.
   */
  compact?: boolean;
  onOpenEditor: () => void;
  /** Why "Open in editor" is off (during a build the copilot overwrites editor changes). */
  openEditorDisabledReason?: string | null;
  /** Hand an unmet publish check to the copilot; omit when it cannot act (mid-build, mid-turn, archived). */
  onAskCopilot?: (check: PublishCheck) => void;
}

const OpenEditorButton: React.FC<{
  onClick: () => void;
  disabledReason?: string | null;
}> = ({ onClick, disabledReason }) => {
  const label = en.courseCopilotPane.course.openEditor;
  if (disabledReason) {
    // A disabled button swallows hover and focus, so the reason rides on a focusable wrapper.
    return (
      <Tooltip label={disabledReason} align="bottom">
        <span className="inline-flex" tabIndex={0}>
          <Button kind="tertiary" size="sm" disabled>
            {label}
          </Button>
        </span>
      </Tooltip>
    );
  }
  return (
    <Button kind="tertiary" size="sm" onClick={onClick}>
      {label}
    </Button>
  );
};

/**
 * The built course — meta, per-item preview cards, publish checklist and change log —
 * or, compact, just its shape as it is written.
 *
 * Everything here is read from a server-built outline, so each list is normalised first
 * and every optional block renders nothing when it has nothing to say.
 */
export const CourseOutlinePanel: React.FC<CourseOutlinePanelProps> = ({
  outline,
  readiness,
  changeLog,
  flashItemIds,
  compact = false,
  onOpenEditor,
  openEditorDisabledReason,
  onAskCopilot,
}) => {
  const strings = en.courseCopilotPane.course;

  if (!outline || typeof outline !== "object") {
    return (
      <p className={`text-sm text-typography-700 ${compact ? "" : "px-4 py-6"}`}>
        {compact ? strings.emptyCompact : strings.empty}
      </p>
    );
  }

  const sections = asArray<CourseOutlineSection>(outline.sections);
  const flashed = new Set(asArray<string>(flashItemIds));
  const title = asAgentText(outline.title).trim();
  const minutes = asNumber(outline.estimatedDurationMinutes);
  const statusToken = asAgentText(outline.status).trim();
  const statusLabel = statusToken
    ? (strings.status[statusToken] ?? humanizeToken(statusToken))
    : "";

  const sectionList = sections.length > 0 && (
    <div className="space-y-4">
      {sections.map((section, index) => {
        const items = asArray<CourseOutlineSection["items"][number]>(section?.items);
        const description = asAgentText(section?.description).trim();
        return (
          <section
            key={section?.id ?? index}
            aria-label={asAgentText(section?.title) || strings.untitledSection(index + 1)}
            className="space-y-2"
          >
            <div>
              <h3 className="text-sm font-semibold text-typography-900">
                {asAgentText(section?.title) || strings.untitledSection(index + 1)}
              </h3>
              {description && !compact && (
                <p className="text-xs text-typography-700">{description}</p>
              )}
            </div>
            {items.length > 0 ? (
              <ul className="space-y-2">
                {items.map(item => (
                  <ItemPreviewCard
                    key={item.id}
                    item={item}
                    compact={compact}
                    flash={flashed.has(item.id)}
                    flashToken={flashItemIds}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-typography-700">{strings.sectionEmpty}</p>
            )}
          </section>
        );
      })}
    </div>
  );

  if (compact) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {title && (
              <span className="min-w-0 truncate text-sm font-medium text-typography-900">
                {title}
              </span>
            )}
            {statusLabel && (
              <span className="shrink-0 rounded-full bg-neutral-50 px-2 py-0.5 text-xs text-typography-800">
                {statusLabel}
              </span>
            )}
          </div>
          <OpenEditorButton onClick={onOpenEditor} disabledReason={openEditorDisabledReason} />
        </div>
        {sectionList || <p className="text-sm text-typography-700">{strings.emptyCompact}</p>}
      </div>
    );
  }

  const coverUrl = asAgentText(outline.coverImageUrl).trim();
  const description = asAgentText(outline.description).trim();

  return (
    <div className="space-y-5 px-4 py-4">
      <header className="space-y-3">
        <div className="flex gap-3">
          <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-neutral-200 bg-neutral-50">
            {coverUrl ? (
              <img src={coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="px-2 text-center text-xs text-typography-700">
                {strings.noCover}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-base font-semibold text-typography-900">
                {title || strings.untitledCourse}
              </h2>
              {statusLabel && (
                <span className="shrink-0 rounded-full bg-neutral-50 px-2 py-0.5 text-xs text-typography-800">
                  {statusLabel}
                </span>
              )}
            </div>
            {minutes !== null && minutes > 0 && (
              <p className="text-xs text-typography-700">
                {strings.duration(formatMinutes(minutes))}
              </p>
            )}
            {description && (
              <div className="max-h-28 overflow-y-auto text-sm">
                {/* The description can carry <p>/<br> from the editor: the shared renderer
                    sanitises it with DOMPurify (and wraps plain text), so no markup reaches the DOM unchecked. */}
                <RichTextRenderer content={description} />
              </div>
            )}
          </div>
        </div>

        {outline.structureLocked && (
          <p className="inline-flex items-center gap-1.5 rounded bg-neutral-50 px-2 py-1 text-xs text-typography-800">
            <Locked className="h-3.5 w-3.5 shrink-0" />
            {strings.structureLocked}
            <Tooltip label={strings.structureLockedHint} align="bottom">
              <button type="button" className="inline-flex cursor-pointer items-center">
                <TooltipIcon />
              </button>
            </Tooltip>
          </p>
        )}

        <OpenEditorButton onClick={onOpenEditor} disabledReason={openEditorDisabledReason} />
      </header>

      <PublishReadiness readiness={readiness} onAskCopilot={onAskCopilot} />

      {sectionList || <p className="text-sm text-typography-700">{strings.noSections}</p>}

      <ChangeLog entries={changeLog} />
    </div>
  );
};
