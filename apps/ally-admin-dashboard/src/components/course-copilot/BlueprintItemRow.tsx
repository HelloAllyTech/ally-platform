import React, { useEffect, useRef, useState } from "react";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, DragIndicator, Trash } from "@icons";

import { en } from "@constants";
import type { CourseBlueprintItem, CourseItemType } from "@types";
import { asAgentText } from "@utils";

import { asArray, summarizeCompletion } from "./courseCopilotFormat";
import {
  INLINE_ITEM_TYPES,
  canChangeItemType,
  getItemTypeIcon,
  getItemTypeLabel,
} from "./courseItemMeta";

export interface BlueprintItemRowProps {
  item: CourseBlueprintItem;
  /** No handle, no inputs, no buttons — the approved blueprint, or the copilot is mid-edit. */
  readOnly: boolean;
  /** First item of the whole course: nothing above it to move into. */
  isFirstOverall: boolean;
  isLastOverall: boolean;
  /** First/last in its own section — moving there crosses into the neighbouring section. */
  isFirstInSection: boolean;
  isLastInSection: boolean;
  /** `brief.outcomes.enabling`, so an `O2` tag can say what O2 is on hover. */
  enablingOutcomes: string[];
  /** Focus (and select) the title on mount — set for the row the trainer just added. */
  autoFocusTitle?: boolean;
  onTitleChange: (itemId: string, title: string) => void;
  onTypeChange: (itemId: string, type: CourseItemType) => void;
  /** Returns whether the link was accepted; an empty link is accepted (it clears). */
  onVideoUrlChange: (itemId: string, raw: string) => boolean;
  onMove: (itemId: string, direction: -1 | 1) => void;
  onRemove: (itemId: string) => void;
}

/**
 * One planned item in the blueprint tree.
 *
 * Tags are plain spans, never Carbon `Tag`: Carbon renders a Tag as a button, and
 * the row's controls already include real buttons — a button inside a button is
 * invalid markup and breaks keyboard focus.
 */
export const BlueprintItemRow: React.FC<BlueprintItemRowProps> = ({
  item,
  readOnly,
  isFirstOverall,
  isLastOverall,
  isFirstInSection,
  isLastInSection,
  enablingOutcomes,
  autoFocusTitle = false,
  onTitleChange,
  onTypeChange,
  onVideoUrlChange,
  onMove,
  onRemove,
}) => {
  const strings = en.courseCopilotPane.blueprint;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: readOnly,
  });

  const title = asAgentText(item.title);
  const purpose = asAgentText(item.purpose).trim();
  const refs = asArray<number>(item.objectiveRefs).filter(ref => Number.isInteger(ref) && ref >= 0);
  const completion = summarizeCompletion(item.completionCriteria);
  const minutes = Number.isFinite(item.estimatedMinutes) ? item.estimatedMinutes : 0;
  const Icon = getItemTypeIcon(item.type);
  const typeLabel = getItemTypeLabel(item.type);
  const isVideo = item.type === "VIDEO";
  const needsLink = item.source?.kind === "needs-input";

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocusTitle) return;
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [autoFocusTitle]);

  const specUrl = typeof item.spec?.url === "string" ? item.spec.url : "";
  const [urlText, setUrlText] = useState(specUrl);
  const [urlRejected, setUrlRejected] = useState(false);
  // The draft is the source of truth for an accepted link; this only re-seeds the field
  // when the link changes from outside (a server reply, a chat edit) — an unaccepted
  // half-typed link has no draft value to compare against, so it is left alone.
  useEffect(() => {
    setUrlText(specUrl);
    setUrlRejected(false);
  }, [specUrl]);

  const moveUpLabel = isFirstInSection ? strings.moveToPreviousSection : strings.moveUp;
  const moveDownLabel = isLastInSection ? strings.moveToNextSection : strings.moveDown;

  const sourceBadge =
    item.source?.kind === "library" ? (
      <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
        {strings.source.library}
      </span>
    ) : needsLink ? (
      <span className="shrink-0 rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-text">
        {strings.source.needsInput}
      </span>
    ) : (
      <span className="shrink-0 rounded-full bg-neutral-50 px-2 py-0.5 text-xs text-typography-700">
        {strings.source.new}
      </span>
    );

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      data-item-id={item.id}
      className="rounded-md border border-neutral-200 bg-white p-2.5"
    >
      <div className="flex items-start gap-2">
        {!readOnly && (
          <button
            {...attributes}
            {...listeners}
            type="button"
            title={strings.dragItem}
            aria-label={strings.dragItem}
            className="mt-1 shrink-0 cursor-grab text-typography-500 hover:text-typography-900 active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            <DragIndicator className="h-4 w-4" />
          </button>
        )}

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && canChangeItemType(item.type) ? (
              <label className="relative inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary-50 py-0.5 pl-2 pr-1 text-xs text-typography-900">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <select
                  aria-label={strings.changeType(title || typeLabel)}
                  title={strings.changeTypeHint}
                  value={item.type}
                  onChange={event => onTypeChange(item.id, event.target.value as CourseItemType)}
                  className="cursor-pointer rounded bg-transparent py-0.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                >
                  {/* A VIDEO item can become an inline type but is never a switch target,
                      so its own type is listed only while it is the current one. */}
                  {item.type === "VIDEO" && (
                    <option value="VIDEO">{getItemTypeLabel("VIDEO")}</option>
                  )}
                  {INLINE_ITEM_TYPES.map(type => (
                    <option key={type} value={type}>
                      {getItemTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary-50 px-2 py-0.5 text-xs text-typography-900"
                title={!readOnly ? strings.typeLocked : undefined}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {typeLabel}
              </span>
            )}

            {readOnly ? (
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-typography-900">
                {title || strings.untitledItem}
              </span>
            ) : (
              <input
                ref={titleRef}
                type="text"
                value={title}
                placeholder={strings.untitledItem}
                aria-label={strings.itemTitleLabel}
                onChange={event => onTitleChange(item.id, event.target.value)}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-typography-900 hover:border-neutral-300 focus:border-primary-500 focus:outline-none"
              />
            )}

            <span className="shrink-0 text-xs text-typography-700">{strings.minutes(minutes)}</span>
          </div>

          {purpose && (
            <p className="truncate text-xs text-typography-700" title={purpose}>
              {purpose}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {refs.map(ref => (
              <span
                key={ref}
                title={asAgentText(enablingOutcomes[ref]) || undefined}
                className="shrink-0 rounded bg-primary-50 px-1.5 py-0.5 text-xs font-medium text-primary-700"
              >
                {`O${ref + 1}`}
              </span>
            ))}
            {sourceBadge}
            {completion.map(phrase => (
              <span key={phrase} className="shrink-0 text-xs text-typography-700">
                {phrase}
              </span>
            ))}
          </div>

          {isVideo &&
            (readOnly ? (
              specUrl && (
                <p className="truncate text-xs text-typography-700" title={specUrl}>
                  {specUrl}
                </p>
              )
            ) : (
              <div>
                <input
                  type="url"
                  inputMode="url"
                  value={urlText}
                  placeholder={strings.videoLinkPlaceholder}
                  aria-label={strings.videoLinkLabel}
                  aria-invalid={urlRejected && urlText.trim() !== ""}
                  onChange={event => {
                    const raw = event.target.value;
                    setUrlText(raw);
                    setUrlRejected(!onVideoUrlChange(item.id, raw));
                  }}
                  className={`w-full rounded border bg-white px-2 py-1 text-xs text-typography-900 focus:outline-none ${
                    urlRejected && urlText.trim()
                      ? "border-destructive-500"
                      : needsLink
                        ? "border-warning-300 focus:border-primary-500"
                        : "border-neutral-300 focus:border-primary-500"
                  }`}
                />
                {urlRejected && urlText.trim() && (
                  <p className="mt-1 text-xs text-destructive-600">{strings.videoLinkInvalid}</p>
                )}
              </div>
            ))}
        </div>

        {!readOnly && (
          <div className="flex shrink-0 flex-col items-center gap-0.5">
            <button
              type="button"
              title={moveUpLabel}
              aria-label={moveUpLabel}
              disabled={isFirstOverall}
              onClick={() => onMove(item.id, -1)}
              className="rounded p-0.5 text-typography-700 hover:bg-neutral-50 hover:text-typography-900 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={moveDownLabel}
              aria-label={moveDownLabel}
              disabled={isLastOverall}
              onClick={() => onMove(item.id, 1)}
              className="rounded p-0.5 text-typography-700 hover:bg-neutral-50 hover:text-typography-900 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={strings.removeItem}
              aria-label={strings.removeItemNamed(title || typeLabel)}
              onClick={() => onRemove(item.id)}
              className="rounded p-0.5 text-destructive-500 hover:bg-destructive-50 hover:text-destructive-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
            >
              <Trash className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </li>
  );
};
