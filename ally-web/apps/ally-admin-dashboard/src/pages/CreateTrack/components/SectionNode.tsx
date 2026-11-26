import { FC, useState } from "react";

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

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { ArrowDown, DragIndicator, Plus, Trash, WarningAlt } from "@assets";
import { CompletionCriteria, TrackItemContent, TrackItemType, TrackSectionFormValue } from "@types";

import { ComponentTypePicker } from "./ComponentTypePicker";
import { ItemNode } from "./ItemNode";
import { TrackSelection, isSameItemSelection } from "./types";

interface SectionNodeProps {
  section: TrackSectionFormValue;
  sectionIndex: number;
  selection: TrackSelection;
  /** Node keys (item:{s}:{i} / section:{s}) that currently carry publish errors. */
  errorKeys: Set<string>;
  onSelectItem: (sectionIndex: number, itemIndex: number) => void;
  onAddItem: (sectionIndex: number, type: TrackItemType) => void;
  onAddItemFromTemplate: (
    sectionIndex: number,
    type: TrackItemType,
    content: TrackItemContent,
    completionCriteria: CompletionCriteria | null,
    title: string,
  ) => void;
  onDeleteSection: (sectionIndex: number) => void;
  onDuplicateSection: (sectionIndex: number) => void;
  /** The trainer retyped the section's title, which learners see in place of "Section N". */
  onRenameSection: (sectionIndex: number, title: string) => void;
  onReorderItems: (sectionIndex: number, from: number, to: number) => void;
}

export const SectionNode: FC<SectionNodeProps> = ({
  section,
  sectionIndex,
  selection,
  errorKeys,
  onSelectItem,
  onAddItem,
  onAddItemFromTemplate,
  onDeleteSection,
  onDuplicateSection,
  onRenameSection,
  onReorderItems,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.localId,
  });

  // Same press-and-hold on touch as the outline rail's section sensors.
  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleItemDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = section.items.findIndex(item => item.localId === active.id);
    const to = section.items.findIndex(item => item.localId === over.id);
    if (from !== -1 && to !== -1) onReorderItems(sectionIndex, from, to);
  };

  const sectionHasError = errorKeys.has(`section:${sectionIndex}`);

  return (
    <div ref={setNodeRef} style={style} className="mb-1">
      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-secondary-50 group">
        <Tooltip label="Drag to reorder this section" align="top">
          <button
            {...attributes}
            {...listeners}
            type="button"
            className="cursor-grab active:cursor-grabbing text-typography-400 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 max-lg:p-2 max-lg:-m-1"
            aria-label="Reorder section"
          >
            <DragIndicator className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={() => setCollapsed(prev => !prev)}
          className="text-typography-500 max-lg:p-2 max-lg:-m-1"
          aria-label={collapsed ? "Expand section" : "Collapse section"}
        >
          <ArrowDown className={`w-4 h-4 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        </button>
        <Tooltip
          label="Learners see this name for the section, not a number. It stays with the section when you reorder."
          align="top"
        >
          <input
            type="text"
            value={section.title ?? ""}
            onChange={event => onRenameSection(sectionIndex, event.target.value)}
            placeholder={`Section ${sectionIndex + 1}`}
            aria-label={`Section ${sectionIndex + 1} title`}
            className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-typography-900 placeholder:text-typography-500 hover:border-border-light focus:border-primary-500 focus:bg-white focus:outline-none"
          />
        </Tooltip>
        {sectionHasError && <WarningAlt className="w-3.5 h-3.5 text-destructive-500" />}
        <button
          type="button"
          onClick={() => onDuplicateSection(sectionIndex)}
          className="text-xs text-typography-600 hover:text-typography-900 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 max-lg:p-2 max-lg:-m-1"
          aria-label="Duplicate section"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => onDeleteSection(sectionIndex)}
          className="text-destructive-500 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 hover:text-destructive-600 max-lg:p-2 max-lg:-m-1"
          aria-label="Delete section"
        >
          <Trash className="w-3.5 h-3.5" />
        </button>
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-0.5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleItemDragEnd}
          >
            <SortableContext
              items={section.items.map(item => item.localId)}
              strategy={verticalListSortingStrategy}
            >
              {section.items.map((item, itemIndex) => (
                <ItemNode
                  key={item.localId}
                  item={item}
                  sectionIndex={sectionIndex}
                  itemIndex={itemIndex}
                  isSelected={isSameItemSelection(selection, sectionIndex, itemIndex)}
                  hasError={errorKeys.has(`item:${sectionIndex}:${itemIndex}`)}
                  onSelect={() => onSelectItem(sectionIndex, itemIndex)}
                />
              ))}
            </SortableContext>
          </DndContext>

          <div className="relative pl-6">
            <button
              type="button"
              onClick={() => setShowPicker(prev => !prev)}
              className="inline-flex items-center gap-1 text-sm lg:text-xs text-primary-600 hover:text-primary-700 py-2.5 lg:py-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add component
            </button>
            {showPicker && (
              <ComponentTypePicker
                onClose={() => setShowPicker(false)}
                onSelect={type => {
                  onAddItem(sectionIndex, type);
                  setShowPicker(false);
                }}
                onSelectTemplate={(type, content, completionCriteria, title) => {
                  onAddItemFromTemplate(sectionIndex, type, content, completionCriteria, title);
                  setShowPicker(false);
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
