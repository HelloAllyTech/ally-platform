import React from "react";

import {
  DndContext,
  DragEndEvent,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";

import { Tag } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import { motionTransition, useReducedMotionPreference } from "../../../motion";

export interface QueueTab {
  id: string;
  label: string;
  /** One line on what the view is, shown as the tab's tooltip. */
  help?: string;
  /** A count worth showing (the To do total). */
  badge?: number;
}

interface QueueTabsProps {
  tabs: QueueTab[];
  active: string;
  onSelect: (id: string) => void;
  /** Present when the person may reorder tabs: drag one, or Alt+← / Alt+→ on it. */
  onReorder?: (ids: string[]) => void;
  /** Phone: tabs scroll sideways with faded edges instead of wrapping. */
  scroll: boolean;
}

/** A tab that can be dragged to a new place; a click below the drag distance still selects. */
const SortableTab: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  // dnd-kit's role/tabIndex would turn the <li> into a second button around the real one.
  const dragAttributes: Partial<typeof attributes> = { ...attributes };
  delete dragAttributes.role;
  delete dragAttributes.tabIndex;
  return (
    <li
      ref={setNodeRef}
      className="relative shrink-0"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 1 : undefined,
      }}
      {...dragAttributes}
      {...listeners}
    >
      {children}
    </li>
  );
};

/**
 * The Queue's tabs: the five default views and the person's own saved views, in their order. The
 * selected pill slides to the new tab (§4.18 "Tabs and view chips"). Every tab drags (or moves with
 * Alt+arrows) to a new place; the order is saved for the person, on every device.
 */
export const QueueTabs: React.FC<QueueTabsProps> = ({
  tabs,
  active,
  onSelect,
  onReorder,
  scroll,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2;
  const ids = tabs.map(tab => tab.id);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );
  const move = (from: number, to: number) => {
    if (!onReorder || to < 0 || to >= ids.length) return;
    onReorder(arrayMove(ids, from, to));
  };
  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!over || dragged.id === over.id) return;
    move(ids.indexOf(String(dragged.id)), ids.indexOf(String(over.id)));
  };

  const tabButton = (tab: QueueTab, index: number) => {
    const selected = tab.id === active;
    return (
      <button
        type="button"
        aria-pressed={selected}
        title={tab.help}
        onClick={() => onSelect(tab.id)}
        onKeyDown={
          onReorder
            ? event => {
                if (!event.altKey) return;
                if (event.key === "ArrowLeft") move(index, index - 1);
                else if (event.key === "ArrowRight") move(index, index + 1);
                else return;
                event.preventDefault();
              }
            : undefined
        }
        className={`relative inline-flex min-h-10 items-center gap-1.5 px-4 text-sm ${
          selected
            ? "font-semibold text-typography-primary"
            : "text-typography-secondary hover:bg-neutral-100 hover:text-typography-primary"
        }`}
      >
        {selected && (
          <motion.span
            layoutId={reduced ? undefined : "roadmap-view-underline"}
            className="absolute inset-x-0 bottom-0 h-0.5 bg-primary-500"
            transition={motionTransition("moderate", "productive", reduced)}
            aria-hidden
          />
        )}
        <span className="relative inline-flex items-center gap-1.5">
          {tab.label}
          {tab.badge ? (
            <Tag type={selected ? "blue" : "gray"} size="sm" className="!m-0">
              {tab.badge}
            </Tag>
          ) : null}
        </span>
      </button>
    );
  };

  const items = tabs.map((tab, index) =>
    onReorder ? (
      <SortableTab key={tab.id} id={tab.id}>
        {tabButton(tab, index)}
      </SortableTab>
    ) : (
      <li key={tab.id} className="relative shrink-0">
        {tabButton(tab, index)}
      </li>
    ),
  );

  return (
    <div className={scroll ? "roadmap-chip-scroll relative min-w-0 flex-1" : "min-w-0"}>
      <ul
        aria-label={copy.viewsLabel}
        className={`m-0 flex list-none items-center gap-0 border-b border-border-light p-0 ${
          scroll
            ? "overflow-x-auto [-webkit-mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-24px),transparent)] [scrollbar-width:none]"
            : "flex-wrap"
        }`}
      >
        {onReorder ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
              {items}
            </SortableContext>
          </DndContext>
        ) : (
          items
        )}
      </ul>
    </div>
  );
};
