import React, { useState } from "react";

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
import { Pin, Search } from "@icons";
import { motion } from "framer-motion";

import {
  Button,
  ContentSwitcher,
  Modal,
  OverflowMenu,
  OverflowMenuItem,
  Select,
  SelectItem,
  Switch,
  TextInput,
  Tooltip,
} from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import type { RoadmapQueueSort, RoadmapQueueView, RoadmapSavedView } from "@types";

import { motionTransition, useReducedMotionPreference } from "../../../motion";
import { QUEUE_SORTS, QueueLayout, defaultSortFor, isSectionedView } from "../utils/queueState";

interface ViewChipsProps {
  views: RoadmapQueueView[];
  active: RoadmapQueueView;
  activeSavedViewId?: string;
  savedChips: RoadmapSavedView[];
  savedOverflow: RoadmapSavedView[];
  /** The For you badge: Needs you's count. */
  forYouCount?: number;
  /** To triage's count. */
  triageCount?: number;
  onSelectView: (view: RoadmapQueueView) => void;
  onSelectSaved: (view: RoadmapSavedView) => void;
  /** Present when the person may reorder the built-in tabs: drag one, or Alt+← / Alt+→ on it. */
  onReorder?: (views: RoadmapQueueView[]) => void;
  /** Phone: chips scroll sideways with faded edges instead of wrapping. */
  scroll: boolean;
}

/** A built-in tab that can be dragged to a new place; a click below the drag distance still selects. */
const SortableChip: React.FC<{
  id: string;
  disabled: boolean;
  children: React.ReactNode;
}> = ({ id, disabled, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
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
      {...(disabled ? {} : { ...dragAttributes, ...listeners })}
    >
      {children}
    </li>
  );
};

/**
 * Built-in views for the role, then saved views (at most 5 as chips, the rest under More). The
 * selected pill slides to the new chip (§4.18 "Tabs and view chips").
 */
export const ViewChips: React.FC<ViewChipsProps> = ({
  views,
  active,
  activeSavedViewId,
  savedChips,
  savedOverflow,
  forYouCount,
  triageCount,
  onSelectView,
  onSelectSaved,
  onReorder,
  scroll,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2;
  // A press-and-move past 8px drags; a plain click still selects. Touch needs a press-and-hold, so
  // a finger swiping the scrolling chips scrolls them instead.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );
  const moveView = (from: number, to: number) => {
    if (!onReorder || to < 0 || to >= views.length) return;
    onReorder(arrayMove(views, from, to));
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    moveView(
      views.indexOf(active.id as RoadmapQueueView),
      views.indexOf(over.id as RoadmapQueueView),
    );
  };
  const chip = (
    key: string,
    label: string,
    selected: boolean,
    onClick: () => void,
    badge?: number,
    pinned?: boolean,
    builtIn = false,
  ) => {
    const index = builtIn ? views.indexOf(key as RoadmapQueueView) : -1;
    const body = (
      <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        onKeyDown={
          builtIn && onReorder
            ? event => {
                if (!event.altKey) return;
                if (event.key === "ArrowLeft") moveView(index, index - 1);
                else if (event.key === "ArrowRight") moveView(index, index + 1);
                else return;
                event.preventDefault();
              }
            : undefined
        }
        className={`relative inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-sm ${
          selected ? "text-white" : "text-typography-primary hover:bg-neutral-100"
        }`}
      >
        {selected && (
          <motion.span
            layoutId={reduced ? undefined : "roadmap-view-pill"}
            className="absolute inset-0 rounded-full bg-primary-600"
            transition={motionTransition("moderate", "productive", reduced)}
            aria-hidden
          />
        )}
        <span className="relative inline-flex items-center gap-1">
          {pinned && <Pin size={12} aria-hidden />}
          {label}
          {badge ? (
            <span
              className={`ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold ${
                selected ? "bg-white text-primary-700" : "bg-primary-600 text-white"
              }`}
            >
              {badge}
            </span>
          ) : null}
        </span>
      </button>
    );
    if (builtIn && onReorder) {
      return (
        <SortableChip key={key} id={key} disabled={false}>
          {body}
        </SortableChip>
      );
    }
    return (
      <li key={key} className="relative shrink-0">
        {body}
      </li>
    );
  };

  const builtInChips = views.map(view =>
    chip(
      view,
      copy.views[view],
      !activeSavedViewId && active === view,
      () => onSelectView(view),
      view === "for-you" ? forYouCount : view === "to-triage" ? triageCount : undefined,
      undefined,
      true,
    ),
  );

  return (
    <div className={scroll ? "roadmap-chip-scroll relative min-w-0 flex-1" : "min-w-0"}>
      <ul
        aria-label={copy.viewsLabel}
        className={`m-0 flex list-none items-center gap-1 p-0 ${
          scroll
            ? "overflow-x-auto [-webkit-mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-24px),transparent)] [scrollbar-width:none]"
            : "flex-wrap"
        }`}
      >
        {onReorder ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={views} strategy={horizontalListSortingStrategy}>
              {builtInChips}
            </SortableContext>
          </DndContext>
        ) : (
          builtInChips
        )}
        {savedChips.map(saved =>
          chip(
            saved.id,
            saved.name,
            activeSavedViewId === saved.id,
            () => onSelectSaved(saved),
            undefined,
            saved.pinned,
          ),
        )}
        {savedOverflow.length > 0 && (
          <li className="shrink-0">
            <OverflowMenu
              aria-label={copy.moreViews}
              iconDescription={copy.moreViews}
              renderIcon={() => <span className="px-2 text-sm">{copy.moreViews} ▾</span>}
              className="!w-auto"
            >
              {savedOverflow.map(saved => (
                <OverflowMenuItem
                  key={saved.id}
                  itemText={saved.name}
                  onClick={() => onSelectSaved(saved)}
                />
              ))}
            </OverflowMenu>
          </li>
        )}
      </ul>
    </div>
  );
};

/** Sort: the six orders (§4.3). Sectioned views keep their own order, so they show no sort. */
export const SortSelect: React.FC<{
  view: RoadmapQueueView;
  sort?: RoadmapQueueSort;
  onChange: (sort: RoadmapQueueSort) => void;
  id: string;
}> = ({ view, sort, onChange, id }) => {
  const copy = en.roadmapV2.sort;
  if (isSectionedView(view)) return null;
  return (
    <Select
      id={id}
      labelText={copy.label}
      hideLabel
      size="sm"
      value={sort ?? defaultSortFor(view)}
      onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
        onChange(event.target.value as RoadmapQueueSort)
      }
      className="min-w-[10rem]"
    >
      {QUEUE_SORTS.map(option => (
        <SelectItem key={option} value={option} text={copy.by(copy.options[option])} />
      ))}
    </Select>
  );
};

/** List | Board, for Builders and Owners. */
export const LayoutSwitch: React.FC<{
  layout: QueueLayout;
  onChange: (layout: QueueLayout) => void;
}> = ({ layout, onChange }) => {
  const copy = en.roadmapV2.layout;
  return (
    <div className="flex items-center gap-1">
      <ContentSwitcher
        size="sm"
        selectedIndex={layout === "board" ? 1 : 0}
        onChange={({ name }: { name?: string | number }) =>
          onChange(name === "board" ? "board" : "list")
        }
        aria-label={copy.label}
        className="w-40"
      >
        <Switch name="list" text={copy.list} />
        <Switch name="board" text={copy.board} />
      </ContentSwitcher>
      <Tooltip label={copy.boardHelp} align="bottom">
        <button
          type="button"
          className="inline-flex cursor-pointer items-center"
          aria-label={copy.boardHelp}
        >
          <TooltipIcon />
        </button>
      </Tooltip>
    </div>
  );
};

/** The search button that opens quick open (⌘K on desktop, full screen on a phone). */
export const SearchButton: React.FC<{ onClick: () => void; compact?: boolean }> = ({
  onClick,
  compact,
}) => {
  const copy = en.roadmapV2.quickOpen;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copy.open}
      className={`inline-flex items-center gap-2 rounded border border-border-light text-sm text-typography-secondary hover:bg-neutral-50 ${
        compact ? "h-11 w-11 justify-center" : "min-h-8 px-3"
      }`}
    >
      <Search size={16} aria-hidden />
      {!compact && (
        <>
          <span>{copy.open}</span>
          <kbd className="rounded border border-border-light px-1 text-[11px]">⌘K</kbd>
        </>
      )}
    </button>
  );
};

/**
 * "Save view" once filters or sort move off the built-in default; "Update "Hindi work"" too when you
 * started from a saved view you own. Owners can pin a view for everyone (§4.3, D15).
 */
export const SaveViewControls: React.FC<{
  visible: boolean;
  activeName?: string;
  canUpdate: boolean;
  canPin: boolean;
  activePinned?: boolean;
  isSaving: boolean;
  onSave: (name: string) => void;
  onUpdate: () => void;
  onTogglePin: () => void;
}> = ({
  visible,
  activeName,
  canUpdate,
  canPin,
  activePinned,
  isSaving,
  onSave,
  onUpdate,
  onTogglePin,
}) => {
  const copy = en.roadmapV2.savedViews;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  return (
    <div className="flex items-center gap-1">
      {visible && (
        <>
          {canUpdate && activeName && (
            <Button kind="ghost" size="sm" onClick={onUpdate} disabled={isSaving}>
              {copy.update(activeName)}
            </Button>
          )}
          <Button kind="ghost" size="sm" onClick={() => setOpen(true)} disabled={isSaving}>
            {copy.save}
          </Button>
        </>
      )}
      {canPin && activeName && (
        <Button
          kind="ghost"
          size="sm"
          onClick={onTogglePin}
          renderIcon={() => <Pin size={14} aria-hidden />}
        >
          {activePinned ? copy.unpin : copy.pin}
        </Button>
      )}
      <Modal
        open={open}
        size="xs"
        modalHeading={copy.saveTitle}
        primaryButtonText={copy.saveConfirm}
        secondaryButtonText={copy.cancel}
        primaryButtonDisabled={!name.trim() || isSaving}
        onRequestClose={() => setOpen(false)}
        onRequestSubmit={() => {
          if (!name.trim()) return;
          onSave(name.trim());
          setName("");
          setOpen(false);
        }}
      >
        <TextInput
          id="roadmap-save-view-name"
          labelText={copy.nameLabel}
          placeholder={copy.namePlaceholder}
          value={name}
          maxLength={60}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
        />
        <p className="mt-2 text-xs text-typography-secondary">{canPin ? copy.pinHelp : null}</p>
      </Modal>
    </div>
  );
};
