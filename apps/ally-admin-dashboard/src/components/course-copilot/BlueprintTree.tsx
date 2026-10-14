import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, TooltipIcon } from "@icons";

import { Button, Tooltip } from "@ally-ui-mono/ui-shared";
import { ActionConfirmationPopup } from "@components/action-confirmation-popup";
import { en } from "@constants";
import type {
  CourseBlueprint,
  CourseBrief,
  CourseCopilotBlueprintResponse,
  CourseCopilotBudget,
  CourseItemType,
} from "@types";
import { asAgentText, asAgentTextList } from "@utils";

import {
  BLUEPRINT_LIMITS,
  addItem,
  addSection,
  changeItemType,
  computeTotals,
  createItem,
  createSection,
  findBlueprintProblems,
  getSections,
  moveItem,
  removeItem,
  removeSection,
  renameCourse,
  renameItem,
  renameSection,
  reorderItems,
  reorderSections,
  setVideoUrl,
} from "./blueprintEdit";
import { BlueprintFooter, isOverBudget } from "./BlueprintFooter";
import { BlueprintSection } from "./BlueprintSection";
import { RaiseCeilingDialog } from "./RaiseCeilingDialog";

/**
 * How long the tree waits after the last edit before saving. Long enough that typing a
 * title is one save rather than one per keystroke, short enough that "Saved" follows
 * the edit while the trainer is still looking at it. Each save is a whole-blueprint
 * PUT guarded by `version`, so fewer is also kinder to the 409 a chat edit can cause.
 */
export const BLUEPRINT_SAVE_DEBOUNCE_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error";

const EMPTY_ESTIMATE = { usd: 0, minutes: 0, items: 0, newRoleplays: 0, images: 0 };

export interface BlueprintTreeProps {
  /** The server-confirmed blueprint at `version`. A new version replaces the local draft. */
  blueprint: CourseBlueprint;
  version: number;
  /**
   * Problems the server found at this version. Undefined when only a bare session
   * detail is available (a reload) — the tree then falls back to its own cheaper checks.
   */
  problems?: string[];
  budget: CourseCopilotBudget;
  brief?: CourseBrief | null;
  /** Status allows editing and approving (AWAITING_BLUEPRINT). False shows the tree read-only, no Approve. */
  editable: boolean;
  /** A turn is running and may be patching this same blueprint — edits pause until it ends. */
  isBusy?: boolean;
  /** Why the tree cannot be edited right now, when `editable` is false. */
  readOnlyReason?: string | null;
  onSave: (
    blueprint: CourseBlueprint,
    version: number,
  ) => Promise<CourseCopilotBlueprintResponse | null>;
  onApprove: (version: number) => Promise<boolean>;
  onRaiseBudget: (budgetUsd: number) => Promise<boolean>;
}

/**
 * The editable blueprint — sections and items the trainer can reorder, retype,
 * rename, add and remove — with its footer.
 *
 * Edits are applied to a local draft at once and saved after a pause; the server's
 * reply (which carries the recomputed estimate and `problems`) replaces the draft. The
 * draft never loses a keystroke to a reply: if the trainer edited again while a save was
 * in flight, the newer draft is kept, only the estimate is taken from the reply, and
 * another save follows. A reply for a version the tree did not save (the copilot patched
 * it) does replace the draft — the server's blueprint is the one Approve will use.
 */
export const BlueprintTree: React.FC<BlueprintTreeProps> = ({
  blueprint,
  version,
  problems: serverProblemsProp,
  budget,
  brief,
  editable,
  isBusy = false,
  readOnlyReason,
  onSave,
  onApprove,
  onRaiseBudget,
}) => {
  const strings = en.courseCopilotPane.blueprint;
  const readOnly = !editable || isBusy;

  const [draft, setDraft] = useState<CourseBlueprint>(blueprint);
  const [serverProblems, setServerProblems] = useState<string[] | undefined>(serverProblemsProp);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [dirty, setDirty] = useState(false);
  const [replacedByServer, setReplacedByServer] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pendingSectionRemoval, setPendingSectionRemoval] = useState<string | null>(null);
  const [showRaise, setShowRaise] = useState(false);

  // Refs mirror what the async save needs to read at the moment it runs, not at the
  // render that scheduled it.
  const draftRef = useRef(draft);
  const baseVersionRef = useRef(version);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const resaveRef = useRef(false);
  const deferredRef = useRef<{
    blueprint: CourseBlueprint;
    version: number;
    problems?: string[];
  } | null>(null);
  const timerRef = useRef<number | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Take the parent's blueprint as the new base, dropping the draft. `notify` says an
  // unsaved edit was thrown away in the process, so the trainer is told rather than left
  // wondering where it went.
  const adopt = useCallback(
    (
      next: { blueprint: CourseBlueprint; version: number; problems?: string[] },
      notify: boolean,
    ) => {
      const isNewVersion = next.version !== baseVersionRef.current;
      clearTimer();
      draftRef.current = next.blueprint;
      baseVersionRef.current = next.version;
      dirtyRef.current = false;
      setDraft(next.blueprint);
      setServerProblems(next.problems);
      setDirty(false);
      setReplacedByServer(notify);
      // A refetch of the same version must not wipe the "Saved" the trainer just saw.
      if (isNewVersion || notify) setSaveState("idle");
    },
    [clearTimer],
  );

  // Follow the parent: a version we did not save always wins; the same version only
  // refreshes a draft with no unsaved edits (a refetch must not eat a half-typed title).
  // While our own save is in flight the parent is about to hand us that save's own reply,
  // which is indistinguishable from a foreign version until the reply lands — so it is
  // parked and judged afterwards (see `flush`).
  useEffect(() => {
    const next = { blueprint, version, problems: serverProblemsProp };
    if (savingRef.current) {
      deferredRef.current = next;
      return;
    }
    const isNewVersion = version !== baseVersionRef.current;
    if (!isNewVersion && dirtyRef.current) return;
    if (!isNewVersion && draftRef.current === blueprint) return;
    adopt(next, isNewVersion && dirtyRef.current);
  }, [blueprint, version, serverProblemsProp, adopt]);

  const flush = useCallback(async (): Promise<void> => {
    clearTimer();
    if (savingRef.current) {
      resaveRef.current = true;
      return;
    }
    if (!dirtyRef.current) return;

    const snapshot = draftRef.current;
    savingRef.current = true;
    setSaveState("saving");

    let response: CourseCopilotBlueprintResponse | null = null;
    try {
      response = await onSaveRef.current(snapshot, baseVersionRef.current);
    } catch {
      response = null;
    }
    savingRef.current = false;

    // A parent update that arrived mid-save: our own reply (same version as the one we
    // are about to record — ignored) or a version the copilot wrote (adopted).
    const deferred = deferredRef.current;
    deferredRef.current = null;

    if (!response) {
      // The edit is still in the draft — nothing is lost, the trainer can retry.
      resaveRef.current = false;
      if (deferred && deferred.version !== baseVersionRef.current) {
        adopt(deferred, dirtyRef.current);
      } else {
        setSaveState("error");
      }
      return;
    }

    baseVersionRef.current = response.version;
    setServerProblems(response.problems);

    if (deferred && deferred.version > response.version) {
      adopt(deferred, draftRef.current !== snapshot);
      return;
    }

    if (draftRef.current === snapshot) {
      draftRef.current = response.blueprint;
      dirtyRef.current = false;
      setDraft(response.blueprint);
      setDirty(false);
      setSaveState("saved");
    } else {
      // Edited again while this save was in flight: keep the newer draft, take only the
      // recomputed estimate, and save once more.
      const merged = {
        ...draftRef.current,
        estimate: response.estimate ?? response.blueprint.estimate,
      };
      draftRef.current = merged;
      setDraft(merged);
      setSaveState("idle");
      resaveRef.current = true;
    }

    if (resaveRef.current) {
      resaveRef.current = false;
      if (dirtyRef.current) void flush();
    }
  }, [adopt, clearTimer]);

  // A save pending when the pane unmounts (the trainer switched tab inside the debounce
  // window) is sent now rather than dropped.
  useEffect(
    () => () => {
      clearTimer();
      if (dirtyRef.current && !savingRef.current) {
        void onSaveRef.current(draftRef.current, baseVersionRef.current);
      }
    },
    [clearTimer],
  );

  const applyEdit = useCallback(
    (update: (current: CourseBlueprint) => CourseBlueprint) => {
      const current = draftRef.current;
      const next = update(current);
      if (next === current) return;

      draftRef.current = next;
      dirtyRef.current = true;
      setDraft(next);
      setDirty(true);
      setReplacedByServer(false);
      setSaveState(state => (state === "error" ? "idle" : state));

      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, BLUEPRINT_SAVE_DEBOUNCE_MS);
    },
    [flush, clearTimer],
  );

  const sections = useMemo(() => getSections(draft), [draft]);
  const itemIds = useMemo(
    () => sections.flatMap(section => section.items.map(item => item.id)),
    [sections],
  );
  const totals = useMemo(() => computeTotals(draft), [draft]);
  const enablingOutcomes = useMemo(() => asAgentTextList(brief?.outcomes?.enabling), [brief]);
  const targetMinutes =
    typeof brief?.shape?.durationMinutes === "number" ? brief.shape.durationMinutes : null;

  // The server is the authority once it has seen the current draft; until then the tree's
  // own checks stand in so the footer is never silent about an obvious gap.
  const problems = useMemo(
    () => (dirty || serverProblems === undefined ? findBlueprintProblems(draft) : serverProblems),
    [dirty, serverProblems, draft],
  );
  const isSaving = saveState === "saving" || dirty;
  const estimate = draft.estimate ?? EMPTY_ESTIMATE;
  const overBudget = isOverBudget(estimate.usd, budget);

  const approveDisabledReason = isBusy
    ? strings.footer.busy
    : saveState === "error"
      ? strings.footer.saveFailed
      : isSaving
        ? strings.footer.saving
        : null;

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleSectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = sections.findIndex(section => section.id === active.id);
    const to = sections.findIndex(section => section.id === over.id);
    if (from !== -1 && to !== -1) applyEdit(current => reorderSections(current, from, to));
  };

  const handleAddSection = () => {
    const section = createSection();
    setFocusId(section.id);
    applyEdit(current => addSection(current, section));
  };

  const handleAddItem = (sectionId: string, type: CourseItemType) => {
    const item = createItem(type);
    setFocusId(item.id);
    applyEdit(current => addItem(current, sectionId, item));
  };

  const handleRemoveSection = (sectionId: string) => {
    const section = sections.find(candidate => candidate.id === sectionId);
    // An empty section goes at once; one with items asks first, because the items go with it.
    if (section && section.items.length > 0) {
      setPendingSectionRemoval(sectionId);
      return;
    }
    applyEdit(current => removeSection(current, sectionId));
  };

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      await onApprove(baseVersionRef.current);
    } finally {
      setIsApproving(false);
    }
  };

  const pendingSection = sections.find(section => section.id === pendingSectionRemoval) ?? null;

  const indicator =
    saveState === "error" ? (
      <span className="flex items-center gap-2 text-xs text-destructive-600" role="status">
        {strings.saveFailed}
        <button
          type="button"
          onClick={() => void flush()}
          className="font-medium underline hover:no-underline"
        >
          {strings.retrySave}
        </button>
      </span>
    ) : isSaving ? (
      <span className="text-xs text-typography-700" role="status">
        {strings.saving}
      </span>
    ) : saveState === "saved" ? (
      <span className="text-xs text-success-600" role="status">
        {strings.saved}
      </span>
    ) : null;

  const notice = editable ? (isBusy ? strings.busyNotice : null) : (readOnlyReason ?? null);
  const title = asAgentText(draft.title);
  const description = asAgentText(draft.description).trim();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            {readOnly ? (
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-typography-900">
                {title || strings.untitledCourse}
              </h2>
            ) : (
              <input
                type="text"
                value={title}
                placeholder={strings.untitledCourse}
                aria-label={strings.courseTitleLabel}
                onChange={event => applyEdit(current => renameCourse(current, event.target.value))}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold text-typography-900 hover:border-neutral-300 focus:border-primary-500 focus:outline-none"
              />
            )}
            <div className="shrink-0">{indicator}</div>
            {!readOnly && (
              <Tooltip label={strings.editHint} align="bottom">
                <button type="button" className="inline-flex shrink-0 cursor-pointer items-center">
                  <TooltipIcon />
                </button>
              </Tooltip>
            )}
          </div>
          {description && <p className="text-xs text-typography-700">{description}</p>}
          {notice && (
            <p
              className="rounded bg-neutral-50 px-2 py-1 text-xs text-typography-800"
              role="status"
            >
              {notice}
            </p>
          )}
          {replacedByServer && (
            <p className="rounded bg-warning-50 px-2 py-1 text-xs text-warning-text" role="status">
              {strings.replacedNotice}
            </p>
          )}
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleSectionDragEnd}
        >
          <SortableContext
            items={sections.map(section => section.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3">
              {sections.map((section, index) => (
                <BlueprintSection
                  key={section.id}
                  section={section}
                  index={index}
                  readOnly={readOnly}
                  firstItemId={itemIds[0] ?? null}
                  lastItemId={itemIds[itemIds.length - 1] ?? null}
                  totalItems={totals.items}
                  enablingOutcomes={enablingOutcomes}
                  focusId={focusId}
                  onSectionTitleChange={(id, value) =>
                    applyEdit(current => renameSection(current, id, value))
                  }
                  onRemoveSection={handleRemoveSection}
                  onReorderItems={(id, from, to) =>
                    applyEdit(current => reorderItems(current, id, from, to))
                  }
                  onAddItem={handleAddItem}
                  onItemTitleChange={(id, value) =>
                    applyEdit(current => renameItem(current, id, value))
                  }
                  onItemTypeChange={(id, type) =>
                    applyEdit(current => changeItemType(current, id, type))
                  }
                  onItemVideoUrlChange={(id, raw) => {
                    // Validate against the live draft; only an accepted link edits it.
                    const result = setVideoUrl(draftRef.current, id, raw);
                    if (result.valid && result.blueprint !== draftRef.current) {
                      applyEdit(() => result.blueprint);
                    }
                    return result.valid;
                  }}
                  onMoveItem={(id, direction) =>
                    applyEdit(current => moveItem(current, id, direction))
                  }
                  onRemoveItem={id => applyEdit(current => removeItem(current, id))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {sections.length === 0 && (
          <p className="text-sm text-typography-700">{strings.noSectionsHint}</p>
        )}

        {!readOnly && (
          <div>
            <Button
              kind="tertiary"
              size="sm"
              renderIcon={Plus}
              disabled={sections.length >= BLUEPRINT_LIMITS.sections}
              onClick={handleAddSection}
            >
              {strings.addSection}
            </Button>
            {sections.length >= BLUEPRINT_LIMITS.sections && (
              <p className="mt-1 text-xs text-typography-700">
                {strings.sectionLimitReached(BLUEPRINT_LIMITS.sections)}
              </p>
            )}
          </div>
        )}
      </div>

      <BlueprintFooter
        totals={totals}
        targetMinutes={targetMinutes}
        estimate={estimate}
        estimateUpdating={isSaving}
        budget={budget}
        problems={editable ? problems : []}
        approveDisabledReason={approveDisabledReason}
        isApproving={isApproving}
        showApprove={editable}
        onApprove={() => void handleApprove()}
        onRaiseBudget={() => setShowRaise(true)}
      />

      <RaiseCeilingDialog
        isOpen={showRaise}
        onClose={() => setShowRaise(false)}
        spentUsd={budget.spentUsd}
        ceilingUsd={budget.ceilingUsd}
        held={false}
        neededUsd={overBudget ? estimate.usd : null}
        onRaise={onRaiseBudget}
      />

      <ActionConfirmationPopup
        isOpen={pendingSection !== null}
        onClose={() => setPendingSectionRemoval(null)}
        title={strings.removeSectionConfirmTitle}
        description={
          pendingSection
            ? strings.removeSectionConfirmBody(
                asAgentText(pendingSection.title) || strings.untitledSection(1),
                pendingSection.items.length,
              )
            : ""
        }
        primaryButton={{
          label: strings.removeSectionConfirm,
          onClick: () => {
            if (pendingSectionRemoval) {
              const id = pendingSectionRemoval;
              applyEdit(current => removeSection(current, id));
            }
            setPendingSectionRemoval(null);
          },
        }}
        secondaryButton={{
          label: strings.removeSectionKeep,
          onClick: () => setPendingSectionRemoval(null),
        }}
      />
    </div>
  );
};
