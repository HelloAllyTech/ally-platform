import React, { useEffect, useRef, useState } from "react";

import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DragIndicator, Plus, Trash } from "@icons";

import { TRACK_ITEM_TYPE_DESCRIPTIONS, en } from "@constants";
import type {
  CourseBlueprintItem,
  CourseBlueprintSection,
  CourseItemType,
  TrackItemType,
} from "@types";
import { asAgentText } from "@utils";

import { BLUEPRINT_LIMITS } from "./blueprintEdit";
import { BlueprintItemRow } from "./BlueprintItemRow";
import { asArray, formatMinutes } from "./courseCopilotFormat";
import { ADDABLE_ITEM_TYPES, getItemTypeLabel } from "./courseItemMeta";

export interface BlueprintSectionProps {
  section: CourseBlueprintSection;
  index: number;
  readOnly: boolean;
  firstItemId: string | null;
  lastItemId: string | null;
  /** Whole-course item count, to stop offering "Add item" at the server's ceiling. */
  totalItems: number;
  enablingOutcomes: string[];
  /** The row (section or item) just added — its title takes focus. */
  focusId: string | null;
  onSectionTitleChange: (sectionId: string, title: string) => void;
  onRemoveSection: (sectionId: string) => void;
  onReorderItems: (sectionId: string, from: number, to: number) => void;
  onAddItem: (sectionId: string, type: CourseItemType) => void;
  onItemTitleChange: (itemId: string, title: string) => void;
  onItemTypeChange: (itemId: string, type: CourseItemType) => void;
  onItemVideoUrlChange: (itemId: string, raw: string) => boolean;
  onMoveItem: (itemId: string, direction: -1 | 1) => void;
  onRemoveItem: (itemId: string) => void;
}

/**
 * A sortable section with its own sortable list of items.
 *
 * Section and item drags use separate drag contexts on purpose (the course editor's
 * outline rail does the same): a nested list inside one shared context makes every
 * drag a candidate for every drop target. The cost is that dragging cannot carry an
 * item into another section — the up/down buttons on each row do that instead.
 */
export const BlueprintSection: React.FC<BlueprintSectionProps> = ({
  section,
  index,
  readOnly,
  firstItemId,
  lastItemId,
  totalItems,
  enablingOutcomes,
  focusId,
  onSectionTitleChange,
  onRemoveSection,
  onReorderItems,
  onAddItem,
  onItemTitleChange,
  onItemTypeChange,
  onItemVideoUrlChange,
  onMoveItem,
  onRemoveItem,
}) => {
  const strings = en.courseCopilotPane.blueprint;
  const [showPicker, setShowPicker] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    disabled: readOnly,
  });

  // Touch gets a press-and-hold so a finger scrolling the pane does not start a reorder;
  // the keyboard sensor is what makes reordering possible without a pointer.
  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const items = asArray<CourseBlueprintItem>(section.items);
  const title = asAgentText(section.title);
  const purpose = asAgentText(section.purpose).trim();
  const minutes = items.reduce(
    (total, item) => total + (Number.isFinite(item.estimatedMinutes) ? item.estimatedMinutes : 0),
    0,
  );
  const atItemLimit = totalItems >= BLUEPRINT_LIMITS.items;

  const titleRef = useRef<HTMLInputElement>(null);
  const focusThisTitle = focusId === section.id;
  useEffect(() => {
    if (!focusThisTitle) return;
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [focusThisTitle]);

  const handleItemDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex(item => item.id === active.id);
    const to = items.findIndex(item => item.id === over.id);
    if (from !== -1 && to !== -1) onReorderItems(section.id, from, to);
  };

  return (
    <section
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      data-section-id={section.id}
      aria-label={title || strings.untitledSection(index + 1)}
      className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3"
    >
      <div className="flex items-center gap-2">
        {!readOnly && (
          <button
            {...attributes}
            {...listeners}
            type="button"
            title={strings.dragSection}
            aria-label={strings.dragSection}
            className="shrink-0 cursor-grab text-typography-500 hover:text-typography-900 active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            <DragIndicator className="h-4 w-4" />
          </button>
        )}
        <span className="shrink-0 text-xs font-semibold tracking-wide text-typography-700">
          {strings.sectionNumber(index + 1)}
        </span>
        {readOnly ? (
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-typography-900">
            {title || strings.untitledSection(index + 1)}
          </h3>
        ) : (
          <input
            ref={titleRef}
            type="text"
            value={title}
            placeholder={strings.untitledSection(index + 1)}
            aria-label={strings.sectionTitleLabel}
            onChange={event => onSectionTitleChange(section.id, event.target.value)}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-typography-900 hover:border-neutral-300 focus:border-primary-500 focus:outline-none"
          />
        )}
        <span className="shrink-0 text-xs text-typography-700">
          {strings.sectionSummary(items.length, formatMinutes(minutes))}
        </span>
        {!readOnly && (
          <button
            type="button"
            title={strings.removeSection}
            aria-label={strings.removeSectionNamed(title || strings.untitledSection(index + 1))}
            onClick={() => onRemoveSection(section.id)}
            className="shrink-0 rounded p-0.5 text-destructive-500 hover:bg-destructive-50 hover:text-destructive-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            <Trash className="h-4 w-4" />
          </button>
        )}
      </div>

      {purpose && <p className="mt-1 text-xs text-typography-700">{purpose}</p>}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleItemDragEnd}
      >
        <SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
          <ul className="mt-2 space-y-2">
            {items.map((item, itemIndex) => (
              <BlueprintItemRow
                key={item.id}
                item={item}
                readOnly={readOnly}
                isFirstOverall={item.id === firstItemId}
                isLastOverall={item.id === lastItemId}
                isFirstInSection={itemIndex === 0}
                isLastInSection={itemIndex === items.length - 1}
                enablingOutcomes={enablingOutcomes}
                autoFocusTitle={focusId === item.id}
                onTitleChange={onItemTitleChange}
                onTypeChange={onItemTypeChange}
                onVideoUrlChange={onItemVideoUrlChange}
                onMove={onMoveItem}
                onRemove={onRemoveItem}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {items.length === 0 && (
        <p className="mt-2 text-xs text-typography-700">
          {readOnly ? strings.sectionEmptyReadOnly : strings.sectionEmptyHint}
        </p>
      )}

      {!readOnly && (
        <div className="mt-2">
          <button
            type="button"
            disabled={atItemLimit}
            title={atItemLimit ? strings.itemLimitReached(BLUEPRINT_LIMITS.items) : undefined}
            aria-expanded={showPicker}
            onClick={() => setShowPicker(open => !open)}
            className="inline-flex items-center gap-1 rounded py-1 text-xs font-medium text-primary-600 hover:text-primary-700 disabled:cursor-not-allowed disabled:text-typography-disabled focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            <Plus className="h-3.5 w-3.5" />
            {strings.addItem}
          </button>
          {showPicker && !atItemLimit && (
            <div
              role="group"
              aria-label={strings.addItemPickerLabel}
              className="mt-1 rounded-md border border-neutral-200 bg-white p-2"
            >
              <div className="flex flex-wrap gap-1.5">
                {ADDABLE_ITEM_TYPES.map(type => (
                  <button
                    key={type}
                    type="button"
                    title={TRACK_ITEM_TYPE_DESCRIPTIONS[type as TrackItemType]}
                    onClick={() => {
                      onAddItem(section.id, type);
                      setShowPicker(false);
                    }}
                    className="rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs text-typography-900 hover:border-primary-500 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                  >
                    {getItemTypeLabel(type)}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-typography-700">{strings.addItemPickerHint}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
