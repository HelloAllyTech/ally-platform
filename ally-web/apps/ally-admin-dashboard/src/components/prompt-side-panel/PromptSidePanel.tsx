import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";

import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { AutoExpandableTextarea, Tooltip } from "@ally-ui-mono/ui-shared";
import {
  useGetPromptUsageQuery,
  useGetLlmModelsQuery,
  useGetBuilderEvalGatedPromptsQuery,
  useSubmitBuilderEvalPromptCandidateMutation,
  useGetPromptVersionsQuery,
  useLazyGetPromptVersionsQuery,
  useCreatePromptVersionMutation,
  usePromotePromptVersionMutation,
  useRevertPromptMutation,
} from "@api";
import {
  Refresh,
  DoubleArrowRight,
  Copy,
  Delete,
  CheckCircle,
  ArrowDown,
  TooltipIcon,
} from "@assets";
import { ActionConfirmationPopup, Button } from "@components";
import { ButtonVariant } from "@components/types";
import {
  en,
  MAIN_AGENT_PROMPT_VARIABLE_CATALOG,
  PROMPT_LLM_MODEL_OPTIONS,
  PROMPT_TEMPERATURE_DEFAULT,
  providerForModel,
  ROUTES,
} from "@constants";
import { useCreatePortal } from "@hooks";
import {
  Prompt,
  LlmProviderName,
  PinnedPromptReason,
  PromptVersionSummary,
  SubmitBuilderEvalPromptCandidateRequest,
} from "@types";
import { getErrorMessage } from "@utils/errorMessage";

import PromptTranslationsSection from "./PromptTranslationsSection";
import PromptVersionsSection, {
  pinnedReason,
  skillsStoreErrorCode,
  skillsStoreErrorDetails,
} from "./PromptVersionsSection";
import { SkillExperimentNotice } from "./SkillExperimentNotice";
import {
  getAvailableVariableName,
  normalizeAvailableVariables,
} from "../../utils/availableVariables";

/** Prompt types whose templates are auto-translated (mirrors ally-be). */
const TRANSLATABLE_PROMPT_TYPES = new Set(["main_agent", "branching"]);

/**
 * Placeholders that the runtime substitutes but the studio shouldn't
 * advertise in the available-variables chip list. Mirrors
 * `HIDDEN_PLACEHOLDERS` in ally-ai-learn/scripts/sync_prompts.py — that
 * one filters server-side, this one filters the FE's live-parsed list
 * (the chip list re-parses prompt body text on every render and would
 * otherwise re-add anything found, including these). Keep both in sync.
 *
 * - `language_characteristics`: per-scenario language-style override.
 *   The merged-in resolved value reaches the prompt via `{language_label}`;
 *   the raw override placeholder only differs in the empty-when-absent
 *   pattern, which doesn't justify a chip alongside `{name}` / `{age}`.
 */
const HIDDEN_PLACEHOLDERS = new Set<string>(["language_characteristics"]);

/**
 * Idle time after the last METADATA edit (name, description, visibility, the
 * translation opt-in) before it is persisted. Text and model settings are never
 * autosaved: they are saved as a new version on purpose, then published.
 */
const AUTO_SAVE_DEBOUNCE_MS = 700;

/** Poll cadence for the versions list while a draft is still translating. */
const VERSIONS_POLL_MS = 4000;

/**
 * One id for the "this prompt goes through the eval" refusal, so however many
 * saves the server turns down the admin sees a single toast, not one per
 * keystroke (sonner replaces a toast that shares an id).
 */
const GATE_REFUSAL_TOAST_ID = "prompt-eval-gate-refusal";

interface PromptSidePanelProps {
  selectedPrompt: Prompt | null;
  allPrompts: Prompt[];
  isOpen: boolean;
  onClose: () => void;
  /**
   * Kept for callers that still pass it; the panel no longer writes through it.
   * Text, blocks and Restore default all go through the version endpoints.
   */
  onUpdate?: (prompt: Prompt) => void;
  /**
   * Silent persistence path used by the panel's metadata auto-save. It MUST NOT
   * toast or close: the panel drives a debounced save on every metadata edit
   * and reflects the result in its own inline status indicator. The payload
   * never carries text or model settings (those change through versions).
   * Implementations should let errors propagate (throw / reject) so the panel
   * can surface a "couldn't save" state.
   */
  onAutoSave?: (prompt: Prompt) => Promise<void>;
  /**
   * Optional duplicate action. When provided, a "Duplicate as variant"
   * icon button appears in the panel header for prompts that have a promptType
   * set. The parent owns the mutation and is expected to refresh the list
   * and open the new variant in the panel.
   */
  onDuplicate?: (sourceId: string) => Promise<void> | void;
  /**
   * Optional delete action — exposed only for prompts that originated from
   * a "Duplicate as variant" copy (their promptCode contains `_copy_`).
   * File-backed prompts are not deletable through this path; they must
   * first be obsoleted by removing the .txt file in the codebase.
   */
  onDelete?: (id: string) => Promise<void> | void;
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

/**
 * Carbon "productive" text-input shape reused across every editable control
 * in the panel: gray-10 field fill (`$field-01`), a single bottom border that
 * thickens to the brand blue on focus (`$focus`), square corners, no rounding.
 * Applied to native <input>/<select> and the auto-expanding textarea so they
 * all read as one Carbon form. `w-full` because the panel is single-column now
 * — the label sits above the control, both spanning the full drawer width.
 */
const CARBON_FIELD =
  "w-full h-10 rounded-none border-0 border-b border-border-dark bg-secondary-50 px-3 text-base text-neutral-800 placeholder:text-typography-placeholder focus:outline-none focus:border-b-2 focus:border-primary-500 transition-colors";

// AutoExpandableTextarea bakes in `px-0 py-0` and a negative `mt-[-8px]`
// (leftovers from the old borderless inline layout); `!` overrides are needed
// for the Carbon padding/margin to win — the component already uses `!text-md`,
// so this matches its own precedence strategy.
const CARBON_FIELD_TEXTAREA =
  "w-full rounded-none border-0 border-b border-border-dark bg-secondary-50 !px-3 !py-2 !mt-0 text-neutral-800 placeholder:text-typography-placeholder focus:outline-none focus:border-b-2 focus:border-primary-500 resize-none overflow-y-auto custom-scrollbar transition-colors";

/**
 * Single-column field: Carbon-style label (12px, secondary text) stacked
 * directly above its control, both full width. Replaces the former 40/60
 * two-column row that wasted horizontal space and truncated long values.
 */
const Field: React.FC<FieldProps> = ({ label, children }) => (
  <div className="flex flex-col gap-2">
    <label className="text-xs tracking-[0.32px] text-neutral-600">{label}</label>
    <div className="text-base text-neutral-800">{children}</div>
  </div>
);

/** Auto-save lifecycle surfaced inline in the panel header. */
type SaveState = "saved" | "unsaved" | "saving" | "error";

/**
 * Compact, self-explanatory save-status pill shown next to the panel title.
 * Everything the user types is persisted automatically, so this is the only
 * feedback that a change landed — hence it distinguishes the debounce window
 * ("Unsaved changes"), the in-flight request ("Saving…"), success ("Saved"),
 * failure (with a retry affordance), and the blocked-by-validation case.
 */
const SaveStatusIndicator: React.FC<{
  state: SaveState;
  isDirty: boolean;
  isValid: boolean;
  /** A gated prompt with text or model edits that have not been through the eval. */
  staged?: boolean;
  onRetry: () => void;
}> = ({ state, isDirty, isValid, staged = false, onRetry }) => {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-typography-700">
        <span className="w-3 h-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
        Saving…
      </span>
    );
  }
  if (state === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 text-sm text-destructive-500 hover:text-destructive-600 transition-colors"
        title="Retry saving"
      >
        <Refresh width={14} height={14} />
        Couldn’t save — retry
      </button>
    );
  }
  if (isDirty && !isValid) {
    return (
      <span className="text-sm text-warning-text">Name, description &amp; prompt required</span>
    );
  }
  if (isDirty) {
    return <span className="text-sm text-typography-600">Unsaved changes…</span>;
  }
  if (staged) {
    return (
      <span className="text-sm text-warning-text" title={en.builder.eval.promptGate.stagedHint}>
        {en.builder.eval.promptGate.stagedBadge}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-sm text-typography-600">
      <CheckCircle width={14} height={14} className="text-success-500" />
      Saved
    </span>
  );
};

/** Carbon ghost icon button (square, no radius) for the header actions. */
const IconButton: React.FC<{
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ title, onClick, disabled = false, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
    className="flex items-center justify-center w-9 h-9 rounded-none text-typography-700 hover:bg-secondary-50 hover:text-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
  >
    {children}
  </button>
);

interface LlmModelGroup {
  provider: string;
  label: string;
  models: { value: string; label: string }[];
}

/** One selectable row in the LLM-model menu. */
const LlmModelOption: React.FC<{
  label: string;
  selected: boolean;
  onSelect: () => void;
}> = ({ label, selected, onSelect }) => (
  <button
    type="button"
    role="option"
    aria-selected={selected}
    onClick={onSelect}
    className={
      "w-full text-left px-3 py-2 text-base transition-colors " +
      (selected
        ? "bg-primary-50 text-primary-600 font-medium"
        : "text-neutral-800 hover:bg-secondary-50")
    }
  >
    {label}
  </button>
);

/**
 * Custom LLM-model picker matching the panel's Carbon fields (gray-10 fill,
 * bottom border, brand-blue focus underline) instead of a native <select>.
 * The menu is portalled to <body> and positioned by useCreatePortal so the
 * drawer's `overflow-y-auto` can't clip it (see the drawer-tooltip-clip
 * gotcha); it flips/clamps to the viewport. Options are grouped by provider
 * with a leading "Default (inherit)" row.
 */
const LlmModelDropdown: React.FC<{
  value: string; // "" → inherit
  groups: LlmModelGroup[];
  onSelect: (value: string) => void;
}> = ({ value, groups, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const position = useCreatePortal(triggerRef, isOpen, {
    matchTriggerWidth: true,
    dropdownRef: menuRef,
    dropdownHeight: 288,
  });

  const selectedLabel = useMemo(() => {
    if (!value) return "Default (inherit)";
    for (const group of groups) {
      const match = group.models.find(model => model.value === value);
      if (match) return match.label;
    }
    return value; // unknown/legacy model — show the raw id rather than blank
  }, [value, groups]);

  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, close]);

  const handleSelect = useCallback(
    (next: string) => {
      onSelect(next);
      close();
    },
    [onSelect, close],
  );

  return (
    <div className="relative w-full" ref={triggerRef}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(open => !open)}
        className={
          CARBON_FIELD +
          " flex items-center justify-between gap-2 text-left cursor-pointer" +
          (isOpen ? " !border-b-2 !border-primary-500" : "")
        }
      >
        <span className="truncate">{selectedLabel}</span>
        <ArrowDown
          width={16}
          height={16}
          className={
            "shrink-0 text-typography-700 transition-transform duration-200" +
            (isOpen ? " rotate-180" : "")
          }
        />
      </button>

      {isOpen &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            className="fixed z-[9999] bg-white border border-border-light shadow-lg animate-fadeIn overflow-auto custom-scrollbar py-1"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: 288,
            }}
          >
            <LlmModelOption
              label="Default (inherit)"
              selected={!value}
              onSelect={() => handleSelect("")}
            />
            {groups.map(group => (
              <div key={group.provider}>
                <div className="px-3 pt-2 pb-1 text-xs tracking-[0.32px] text-neutral-500">
                  {group.label}
                </div>
                {group.models.map(model => (
                  <LlmModelOption
                    key={model.value}
                    label={model.label}
                    selected={model.value === value}
                    onSelect={() => handleSelect(model.value)}
                  />
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
};

const BlockEditorPopup: React.FC<{
  block: Prompt | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (block: Prompt) => void;
}> = ({ block, isOpen, onClose, onSave }) => {
  const [text, setText] = useState("");

  useEffect(() => {
    if (block) setText(block.prompt);
  }, [block]);

  if (!isOpen || !block) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl flex flex-col max-h-[90dvh]">
        <div className="p-4 md:p-6 border-b border-border-light flex justify-between items-center gap-3">
          <h3 className="text-xl font-secondary text-typography-900 min-w-0 break-words">
            Edit Block: {block.name}
          </h3>
          <button
            onClick={onClose}
            aria-label={en.common.close}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center md:h-auto md:w-auto text-typography-500 hover:text-typography-900"
          >
            ✕
          </button>
        </div>
        <div className="p-4 md:p-6 overflow-y-auto flex-1">
          <div className="space-y-4">
            <div>
              <span className="text-sm font-medium text-typography-600 block mb-1">
                Prompt Code
              </span>
              <span className="font-mono text-sm bg-neutral-50 px-2 py-1 rounded">
                {block.promptCode}
              </span>
            </div>
            <div>
              <span className="text-sm font-medium text-typography-600 block mb-2">
                Block Content
              </span>
              <AutoExpandableTextarea
                maxLines={20}
                minHeight={150}
                value={text}
                onChange={setText}
                placeholder="Enter block content..."
                className="w-full p-3 border rounded-md focus:ring-2 focus:ring-primary-500 focus:outline-none font-mono text-sm"
              />
            </div>
          </div>
        </div>
        <div className="p-4 md:p-6 border-t border-border-light flex justify-end gap-3">
          <Button variant={ButtonVariant.SECONDARY} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={ButtonVariant.PRIMARY}
            onClick={() => onSave({ ...block, prompt: text })}
          >
            Save Block
          </Button>
        </div>
      </div>
    </div>
  );
};

export const PromptSidePanel: React.FC<PromptSidePanelProps> = ({
  selectedPrompt,
  allPrompts,
  isOpen,
  onClose,
  onAutoSave,
  onDuplicate,
  onDelete,
}) => {
  const [formData, setFormData] = useState<Partial<Prompt>>({
    name: "",
    description: "",
    promptCode: "",
    prompt: "",
  });
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [showRevertConfirmModal, setShowRevertConfirmModal] = useState(false);
  // Set when a revert of a pinned prompt needs confirming, with the reason it is pinned.
  const [revertPinnedReason, setRevertPinnedReason] = useState<PinnedPromptReason | null>(null);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [editingBlock, setEditingBlock] = useState<Prompt | null>(null);

  // ── Builder's eval gate ──────────────────────────────────────────────────
  // A few Builder prompts go live only after the replay eval passes, so for
  // those the text and model fields are staged here rather than autosaved, and
  // "Run eval and publish" submits them as a candidate. Which prompts is the
  // server's list; a 409 on a save also puts the panel in this mode, so a prompt
  // the list missed (not loaded yet, or a request that failed) still behaves.
  const navigate = useNavigate();
  const { data: gatedPromptCodes } = useGetBuilderEvalGatedPromptsQuery(undefined, {
    skip: !isOpen || !selectedPrompt,
  });
  const [submitCandidate, { isLoading: isSubmittingCandidate }] =
    useSubmitBuilderEvalPromptCandidateMutation();
  const [refusedPromptId, setRefusedPromptId] = useState<string | null>(null);

  // ── Versions ─────────────────────────────────────────────────────────────
  // The editor edits from the NEWEST version (a draft if there is one, else
  // the live one) and saves on top of it: `editorBase` is that version, and
  // its number is the base the server checks the save against, so a version
  // someone else saved meanwhile is never overwritten unseen.
  const [versionsPollMs, setVersionsPollMs] = useState(0);
  const {
    data: versions,
    refetch: refetchVersions,
    isFetching: isFetchingVersions,
  } = useGetPromptVersionsQuery(selectedPrompt?.id ?? "", {
    skip: !isOpen || !selectedPrompt?.id,
    pollingInterval: versionsPollMs,
  });
  const [fetchVersions] = useLazyGetPromptVersionsQuery();
  const [createVersion, { isLoading: isSavingVersion }] = useCreatePromptVersionMutation();
  const [promoteVersion] = usePromotePromptVersionMutation();
  const [revertPrompt] = useRevertPromptMutation();
  const [editorBase, setEditorBase] = useState<PromptVersionSummary | null>(null);
  const [versionNote, setVersionNote] = useState("");
  const [versionError, setVersionError] = useState<
    { kind: "stale"; latest: number | null } | { kind: "contract"; missing: string[] } | null
  >(null);
  useEffect(() => {
    const translating = (versions ?? []).some(
      v => v.status !== "history" && (v.translations?.pending.length ?? 0) > 0,
    );
    setVersionsPollMs(translating ? VERSIONS_POLL_MS : 0);
  }, [versions]);
  const isGated =
    Boolean(selectedPrompt?.promptCode) &&
    ((Array.isArray(gatedPromptCodes) &&
      gatedPromptCodes.includes(selectedPrompt?.promptCode as string)) ||
      (Boolean(selectedPrompt?.id) && refusedPromptId === selectedPrompt?.id));

  // ── Auto-save ────────────────────────────────────────────────────────────
  // Every field edit is debounced and persisted silently via `onAutoSave`;
  // `saveState` drives the inline header indicator. `lastSavedRef` holds the
  // serialized editable fields of the last-persisted state so we can tell a
  // real edit from a no-op (and from the initial load, which must not save).
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const lastSavedRef = useRef<{ full: string; gated: string }>({ full: "", gated: "" });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doSaveRef = useRef<() => void>(() => {});
  const formDataRef = useRef(formData);
  formDataRef.current = formData;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // The metadata fields this panel autosaves — used both for change detection
  // and as the shape the parent persists. Text and model settings are not part
  // of it: they are saved as a version (or, for a gated prompt, staged for the
  // eval), so an edit to them is never an unsaved metadata change.
  const serializeEditable = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (d: Partial<Prompt>, _gated: boolean) =>
      JSON.stringify({
        name: d.name ?? "",
        description: d.description ?? "",
        translationEnabled: !!d.translationEnabled,
        // Normalized to a boolean so undefined (pre-flag rows) and true — both
        // meaning "visible" — don't read as a change and trigger a no-op save.
        visibleInStudio: d.visibleInStudio !== false,
      }),
    [],
  );

  // Both serializations of a persisted state, so the baseline is right whichever
  // mode the panel is in when it is compared (the gate list can arrive after the
  // form has been seeded).
  const snapshotOf = useCallback(
    (d: Partial<Prompt>) => ({
      full: serializeEditable(d, false),
      gated: serializeEditable(d, true),
    }),
    [serializeEditable],
  );
  const baselineOf = (gated: boolean) =>
    gated ? lastSavedRef.current.gated : lastSavedRef.current.full;

  const getBlockByCode = useCallback(
    (code: string) => {
      return allPrompts.find(p => p.promptCode === code);
    },
    [allPrompts],
  );

  const handleBlockClick = useCallback(
    (code: string) => {
      const block = getBlockByCode(code);
      if (block) {
        setEditingBlock(block);
      } else {
        toast.error(`Block with code "${code}" not found.`);
      }
    },
    [getBlockByCode],
  );

  // A block's text changes like any prompt's: a new version on top of its
  // newest one, then published (blocks are not translated, so it goes live at
  // once). A conflict or a contract break is reported, and nothing is lost —
  // the editor stays open.
  const handleBlockUpdate = useCallback(
    async (blockData: Prompt) => {
      if (!blockData.id) return;
      try {
        const blockVersions = await fetchVersions(blockData.id).unwrap();
        const live = blockVersions.find(v => v.status === "live");
        const created = await createVersion({
          id: blockData.id,
          body: {
            prompt: blockData.prompt,
            baseVersion: blockVersions[0]?.version ?? null,
            provider: live?.provider ?? null,
            model: live?.model ?? null,
            temperature: live?.temperature ?? null,
          },
        }).unwrap();
        await promoteVersion({
          id: blockData.id,
          version: created.version,
          body: { expectedCurrentVersion: live?.version ?? null },
        }).unwrap();
        toast.success(en.skillsStore.versions.published(created.version));
        setEditingBlock(null);
      } catch (error) {
        const code = skillsStoreErrorCode(error);
        toast.error(
          code === "SKILLS_STORE_STALE_BASE"
            ? en.skillsStore.versions.staleBase(null)
            : getErrorMessage(error, en.skillsStore.versions.saveFailed),
        );
      }
    },
    [fetchVersions, createVersion, promoteVersion],
  );

  const handleFieldChange = useCallback((field: keyof Prompt, value: any) => {
    setFormData(previousData => ({
      ...previousData,
      [field]: value,
    }));
  }, []);

  // The LLM model picker is driven by the backend registry (single source of
  // truth) so adding a model server-side surfaces here without an FE change.
  // Falls back to the static constant while the request is in flight / on error.
  const { data: llmModels } = useGetLlmModelsQuery();

  // Providers offered, in display order. Which of them actually appear is
  // decided by eligibility below — Anthropic shows up only for a prompt whose
  // declared runtimes can all execute it.
  const modelGroups = useMemo(() => {
    const PROVIDER_ORDER: { provider: LlmProviderName; label: string }[] = [
      { provider: "openai", label: "OpenAI" },
      { provider: "gemini", label: "Gemini" },
      { provider: "anthropic", label: "Anthropic" },
    ];
    if (!llmModels?.length) {
      return PROMPT_LLM_MODEL_OPTIONS.map(group => ({
        provider: group.provider,
        label: group.label,
        models: group.models.map(m => ({ ...m, supportsTemperature: true })),
      }));
    }
    // Which models this prompt can actually run.
    //
    // When the prompt DECLARES its runtimes (`runtimes` on the row, from its
    // contract in code), offer every model all of those runtimes can
    // execute. Builder's interviewer prompt is read by ally-be alone, which
    // runs Anthropic perfectly well.
    //
    // When it does not, fall back to the old rule: models EVERY runtime can
    // execute. That is the only safe answer without a declaration, because a
    // prompt might be read anywhere — ai-learn's factory raises
    // `Unsupported LLM provider` for Anthropic, so offering Claude for a
    // main-agent prompt would fail the session outright, and Ollama/vLLM are
    // the mirror case.
    //
    // The undeclared branch is what every existing prompt gets, so this
    // widens only where someone has said it is safe to.
    const declared = selectedPrompt?.runtimes?.length ? selectedPrompt.runtimes : null;
    const eligible = declared
      ? llmModels.filter(m => declared.every(r => m.runtimes.includes(r as never)))
      : (() => {
          const runtimeCount = new Set(llmModels.flatMap(m => m.runtimes)).size;
          return llmModels.filter(m => new Set(m.runtimes).size === runtimeCount);
        })();

    return PROVIDER_ORDER.map(({ provider, label }) => ({
      provider,
      label,
      models: eligible
        .filter(m => m.provider === provider)
        .map(m => ({
          value: m.model,
          label: m.label,
          supportsTemperature: m.supportsTemperature,
        })),
    })).filter(group => group.models.length > 0);
  }, [llmModels, selectedPrompt?.runtimes]);

  // Flat lookups for the selected model: its provider and whether it accepts a
  // custom temperature (reasoning models like gpt-5 don't).
  const { providerByModel, tempSupportByModel } = useMemo(() => {
    const providerMap = new Map<string, LlmProviderName>();
    const tempMap = new Map<string, boolean>();
    for (const group of modelGroups) {
      for (const m of group.models) {
        providerMap.set(m.value, group.provider);
        tempMap.set(m.value, m.supportsTemperature);
      }
    }
    return { providerByModel: providerMap, tempSupportByModel: tempMap };
  }, [modelGroups]);

  const resolveProvider = useCallback(
    (model?: string): string | undefined =>
      model ? (providerByModel.get(model) ?? providerForModel(model)) : undefined,
    [providerByModel],
  );

  // No model selected (inherit) leaves the temperature override available.
  const selectedModelSupportsTemperature =
    !formData.model || (tempSupportByModel.get(formData.model) ?? true);

  useEffect(() => {
    // A new prompt loaded (or the panel reopened): reset the form and treat the
    // loaded values as the saved baseline so auto-save doesn't fire on open.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (selectedPrompt) {
      setFormData(selectedPrompt);
      lastSavedRef.current = snapshotOf(selectedPrompt);
    } else {
      const empty = {
        name: "",
        description: "",
        promptCode: "",
        prompt: "",
      };
      setFormData(empty);
      lastSavedRef.current = snapshotOf(empty);
    }
    setSaveState("saved");
    setEditorBase(null);
    setVersionNote("");
    setVersionError(null);
  }, [selectedPrompt, snapshotOf]);

  // Once the versions load, edit from the newest one. If it is a draft, its
  // text and model replace the live values in the editor — unless the admin
  // has already started typing, which is never overwritten.
  useEffect(() => {
    if (editorBase || !versions?.length || !selectedPrompt?.id) return;
    const newest = versions[0];
    setEditorBase(newest);
    if (newest.status === "candidate") {
      setFormData(previous => {
        const untouched =
          (previous.prompt ?? "") === (selectedPrompt.prompt ?? "") &&
          (previous.model ?? "") === (selectedPrompt.model ?? "");
        if (!untouched) return previous;
        return {
          ...previous,
          prompt: newest.prompt,
          model: newest.model ?? undefined,
          provider: newest.provider ?? undefined,
          temperature: newest.temperature ?? undefined,
        };
      });
    }
  }, [versions, editorBase, selectedPrompt]);

  // Live parse the current textarea content for `{name}` placeholders.
  // Mirrors the regex used server-side in parseVariablesFromPrompt; the
  // server still owns reconcile on save, but having a live view here lets
  // the chip list reflect what's in the editor right now instead of what
  // was last saved. Skips block placeholders for cleanliness (same as the
  // post-save view did via the .endsWith filter below).
  const liveUsedNames = useMemo(() => {
    const text = formData.prompt ?? "";
    const names = new Set<string>();
    const matches = text.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
    for (const match of matches) {
      names.add(match[1]);
    }
    return names;
  }, [formData.prompt]);

  const availableVariables = useMemo(() => {
    // For each name actually present in the text right now, prefer the
    // server-side metadata's label/required when available, else render as
    // a bare `{ name }` chip. This way newly-typed placeholders show up
    // immediately and stale ones (still in the persisted availableVariables
    // but no longer in the text) disappear immediately.
    const metaByName = new Map<string, ReturnType<typeof normalizeAvailableVariables>[number]>();
    for (const entry of normalizeAvailableVariables(selectedPrompt?.availableVariables)) {
      metaByName.set(entry.name, entry);
    }

    // Only surface variables that are recognised (in server-side metadata or
    // the catalog). Unknown placeholders typed into the body are silently
    // ignored — they reach the runtime via SafeFormatter but shouldn't
    // pollute the chip list with unvalidated names.
    const catalogNames = new Set(MAIN_AGENT_PROMPT_VARIABLE_CATALOG.map(e => e.name));
    const items = Array.from(liveUsedNames)
      .filter(name => metaByName.has(name) || catalogNames.has(name))
      .map(name => metaByName.get(name) ?? { name });

    // Drop block placeholders to keep the UI focused on author-facing vars.
    // Also drop the HIDDEN_PLACEHOLDERS set — runtime substitutes them but
    // they don't fit the "one chip = one author input" mental model (see
    // sync_prompts.py for the BE-side equivalent + rationale). Without
    // this client-side mirror, the chip list re-parses the prompt body
    // and silently re-adds them even though the BE excludes them from
    // availableVariables.
    const filtered = items.filter(
      v =>
        !v.name.endsWith("_block") &&
        !v.name.endsWith("_prompt") &&
        !v.name.includes("prompt_") &&
        !HIDDEN_PLACEHOLDERS.has(v.name),
    );

    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [liveUsedNames, selectedPrompt?.availableVariables]);

  // Names currently referenced by the prompt text (the "used" set), for
  // catalog filtering below. Same source as the chip list — live from text.
  const usedNames = liveUsedNames;

  // Catalog entries the platform can substitute but this prompt isn't
  // referencing. Returned as a flat list — categories used to surface as
  // group headers (Scenario / Persona / Character / Behavior /
  // System-computed) but that added visual noise without aiding picker
  // use, so we now render every available placeholder as a single
  // unordered chip cluster. The `group` field is still in the catalog
  // for future grouping needs but is no longer rendered. Only shown for
  // main_agent prompts since the catalog is main-agent-specific; for
  // branching / multilingual we'd need separate catalogs.
  const unusedVariables = useMemo(() => {
    const promptType = selectedPrompt?.promptType ?? formData.promptType;
    if (promptType !== "main_agent") return [];

    const hasStatesEnabled = Boolean(selectedPrompt?.hasStates ?? formData.hasStates);

    const flat: typeof MAIN_AGENT_PROMPT_VARIABLE_CATALOG = [];
    for (const entry of MAIN_AGENT_PROMPT_VARIABLE_CATALOG) {
      if (entry.statesOnly && !hasStatesEnabled) continue;
      if (usedNames.has(entry.name)) continue;
      // Same denylist as the "used" chips above — keeps the unused
      // section consistent with the sync_prompts.py HIDDEN_PLACEHOLDERS
      // semantics. Entries flagged here are still resolvable at runtime
      // for variants that explicitly reference them.
      if (HIDDEN_PLACEHOLDERS.has(entry.name)) continue;
      flat.push(entry);
    }
    return flat;
  }, [
    selectedPrompt?.promptType,
    selectedPrompt?.hasStates,
    formData.promptType,
    formData.hasStates,
    usedNames,
  ]);

  const hasAnyBlocks = useMemo(() => {
    return (
      (selectedPrompt?.usesBlocks?.length ?? 0) > 0 ||
      selectedPrompt?.availableVariables?.some(v => getAvailableVariableName(v).endsWith("_block"))
    );
  }, [selectedPrompt?.usesBlocks, selectedPrompt?.availableVariables]);

  // Assemble the persisted METADATA payload from the current form. Returns null
  // when a required field is missing (auto-save then simply waits). Text, model
  // settings and the retired override flag are never sent: the server refuses a
  // metadata save that would change them, because they change through versions.
  const buildPayload = useCallback((): Prompt | null => {
    const promptCode = selectedPrompt?.promptCode ?? formData.promptCode ?? "";
    if (!formData.name || !formData.description || !promptCode) return null;
    return {
      name: formData.name || "",
      description: formData.description || "",
      // Preserve promptType (role tag, immutable after creation in this UI).
      // hasStates is intentionally NOT in the payload — it's set at create
      // time by either the file-sync (meta JSON) or the duplicate endpoint,
      // and prompt management edits should not flip it.
      promptType: formData.promptType ?? selectedPrompt?.promptType,
      // Opt-in translation flag. Toggling it triggers the same auto-save as any
      // metadata edit; enabling it kicks off an initial translation server-side.
      translationEnabled:
        formData.translationEnabled ?? selectedPrompt?.translationEnabled ?? false,
      // Studio-picker visibility. Never sent as undefined — a prompt whose row
      // predates the flag must round-trip as visible rather than as "unset",
      // which the DTO would drop and leave the switch looking un-persisted.
      visibleInStudio: (formData.visibleInStudio ?? selectedPrompt?.visibleInStudio) !== false,
      ...(selectedPrompt?.id && {
        id: selectedPrompt.id,
        createdAt: selectedPrompt.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    } as unknown as Prompt;
  }, [formData, selectedPrompt]);

  // Required-field gate — the same rule the old Save button enforced.
  const isFormValid = useMemo(() => {
    const promptCode = selectedPrompt?.promptCode ?? formData.promptCode;
    // Text is saved as a version, not autosaved, so an emptied editor does not
    // block saving a name.
    return !!(formData.name && formData.description && promptCode);
  }, [formData.name, formData.description, formData.promptCode, selectedPrompt?.promptCode]);

  // Serialized editable state vs the last-persisted baseline → is there an
  // unsaved edit right now?
  const currentSerialized = useMemo(
    () => serializeEditable(formData, isGated),
    [formData, serializeEditable, isGated],
  );
  const isDirty = currentSerialized !== baselineOf(isGated);

  // Latest-ref save closure: reassigned every render so the debounce timer and
  // the flush-on-close path always persist the newest values (no stale reads).
  doSaveRef.current = () => {
    if (!onAutoSave) return;
    const payload = buildPayload();
    if (!payload) return;
    const savedData = formData;
    const savedPromptId = selectedPrompt?.id ?? null;
    setSaveState("saving");
    onAutoSave(payload)
      .then(() => {
        if (!mountedRef.current) return;
        lastSavedRef.current = snapshotOf(savedData);
        // If the user kept typing during the request, stay "unsaved" so the
        // follow-up debounce persists the newer content.
        setSaveState(
          serializeEditable(formDataRef.current, isGated) === baselineOf(isGated)
            ? "saved"
            : "unsaved",
        );
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        if ((error as { status?: unknown } | null)?.status === 409) {
          // The server refuses a change to this prompt's text or model outside
          // the eval. Say so once, and move the panel into gated mode: from here
          // on it saves only metadata, so nothing more is sent that could be
          // refused, and the staged edits are still in the editor for the eval.
          if (savedPromptId) setRefusedPromptId(savedPromptId);
          toast.error(getErrorMessage(error, en.builder.eval.promptGate.blocked), {
            id: GATE_REFUSAL_TOAST_ID,
          });
          setSaveState("saved");
          return;
        }
        setSaveState("error");
      });
  };

  // Debounce: persist ~700ms after the last edit. Re-runs only when the
  // serialized content, its validity, or the target prompt changes. A single
  // return (cleanup | undefined) keeps every code path returning the same
  // shape — avoids TS7030 "not all code paths return a value".
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    if (selectedPrompt?.id && onAutoSave && isDirty) {
      if (isFormValid) {
        setSaveState("unsaved");
        const timer = setTimeout(() => doSaveRef.current(), AUTO_SAVE_DEBOUNCE_MS);
        saveTimerRef.current = timer;
        cleanup = () => clearTimeout(timer);
      } else {
        setSaveState("unsaved"); // blocked on required fields — don't persist
      }
    }
    return cleanup;
    // doSaveRef is a stable ref; isDirty derives from currentSerialized.
  }, [currentSerialized, isDirty, isFormValid, selectedPrompt?.id, onAutoSave]);

  // Persist any pending edit immediately (used on close and Cmd/Ctrl+Enter).
  const flushSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (
      selectedPrompt?.id &&
      onAutoSave &&
      isFormValid &&
      serializeEditable(formDataRef.current, isGated) !== baselineOf(isGated)
    ) {
      doSaveRef.current();
    }
  }, [selectedPrompt?.id, onAutoSave, isFormValid, serializeEditable, isGated]);

  // Unsaved text or model edits: what differs from the version the editor works
  // from (the newest one; the live row until the versions load). For a gated
  // prompt these are staged for the eval; for every other prompt they are saved
  // with "Save as new version". Editing back to the base clears them.
  const baseText = editorBase?.prompt ?? selectedPrompt?.prompt ?? "";
  const baseModel = editorBase ? (editorBase.model ?? "") : (selectedPrompt?.model ?? "");
  const baseTemperature = editorBase
    ? editorBase.temperature
    : typeof selectedPrompt?.temperature === "number"
      ? selectedPrompt.temperature
      : null;
  const stagedText = (formData.prompt ?? "") !== baseText;
  const stagedModel = (formData.model ?? "") !== baseModel;
  const nextTemperature =
    selectedModelSupportsTemperature && typeof formData.temperature === "number"
      ? formData.temperature
      : null;
  const stagedTemperature = nextTemperature !== (baseTemperature ?? null);
  const hasStagedChange = stagedText || stagedModel || stagedTemperature;
  // A candidate with emptied text would publish a blank prompt; the server trims
  // it away and reads the rest as a model-only change, which is not what was typed.
  const candidateTextBlank = stagedText && !(formData.prompt ?? "").trim();

  // Save the editor's text and model settings as a new draft version, on top
  // of the version the editor works from. Never goes live by itself.
  const handleSaveVersion = useCallback(async () => {
    if (!selectedPrompt?.id || isGated || !hasStagedChange) return;
    if (!(formData.prompt ?? "").trim()) return;
    const strings = en.skillsStore.versions;
    setVersionError(null);
    try {
      const created = await createVersion({
        id: selectedPrompt.id,
        body: {
          prompt: formData.prompt ?? "",
          baseVersion: editorBase?.version ?? versions?.[0]?.version ?? null,
          provider: formData.model ? (resolveProvider(formData.model) ?? null) : null,
          model: formData.model || null,
          temperature: nextTemperature,
          note: versionNote.trim() || null,
        },
      }).unwrap();
      toast.success(strings.saved(created.version));
      setVersionNote("");
      // The new draft is now the base, so the editor reads as saved.
      setEditorBase({
        version: created.version,
        status: "candidate",
        prompt: formData.prompt ?? "",
        provider: formData.model ? (resolveProvider(formData.model) ?? null) : null,
        model: formData.model || null,
        temperature: nextTemperature,
        contentHash: created.contentHash,
        source: "dashboard",
        note: versionNote.trim() || null,
        createdBy: null,
        createdAt: new Date().toISOString(),
        publishedAt: null,
      });
      void refetchVersions();
    } catch (error) {
      const code = skillsStoreErrorCode(error);
      const data = skillsStoreErrorDetails(error);
      if (code === "SKILLS_STORE_STALE_BASE") {
        setVersionError({
          kind: "stale",
          latest: typeof data.latestVersion === "number" ? data.latestVersion : null,
        });
      } else if (code === "SKILLS_STORE_CONTRACT_VIOLATION") {
        setVersionError({
          kind: "contract",
          missing: (data.missing as string[]) ?? [],
        });
      } else if ((error as { status?: unknown } | null)?.status === 409) {
        // Builder's eval gate: this prompt goes live only through the eval.
        if (selectedPrompt.id) setRefusedPromptId(selectedPrompt.id);
        toast.error(getErrorMessage(error, en.builder.eval.promptGate.blocked), {
          id: GATE_REFUSAL_TOAST_ID,
        });
      } else if ((error as { status?: unknown } | null)?.status !== 403) {
        toast.error(getErrorMessage(error, strings.saveFailed));
      }
    }
  }, [
    selectedPrompt?.id,
    isGated,
    hasStagedChange,
    formData.prompt,
    formData.model,
    editorBase,
    versions,
    resolveProvider,
    nextTemperature,
    versionNote,
    createVersion,
    refetchVersions,
  ]);

  // After a conflict: take the newest version as the base again. The admin's
  // unsaved text stays in the editor, so they can copy it across.
  const handleReloadVersions = useCallback(async () => {
    setVersionError(null);
    const result = await refetchVersions();
    const newest = result.data?.[0];
    if (newest) setEditorBase(newest);
  }, [refetchVersions]);

  const handleSubmitCandidate = useCallback(async () => {
    if (!selectedPrompt?.promptCode || !isGated || !hasStagedChange || candidateTextBlank) return;
    const strings = en.builder.eval.promptGate;
    // Only what changed: the text when the text changed, the model settings when
    // those did. The endpoint takes either alone, and sending unchanged text would
    // pin a copy of it as the candidate.
    const request: SubmitBuilderEvalPromptCandidateRequest = {
      promptCode: selectedPrompt.promptCode,
      ...(stagedText ? { content: formData.prompt ?? "" } : {}),
      ...(stagedModel
        ? {
            provider: formData.model ? (resolveProvider(formData.model) ?? "") : "",
            model: formData.model ?? "",
          }
        : {}),
      ...(stagedTemperature ? { temperature: nextTemperature } : {}),
    };
    try {
      await submitCandidate(request).unwrap();
      toast.success(strings.submitted, {
        action: { label: strings.openEval, onClick: () => navigate(ROUTES.BUILDER_EVAL) },
      });
    } catch (error) {
      // A 403 was already toasted by the base query; a 400 or 409 says what to do
      // (nothing to try, a change to this prompt already being evaluated).
      if ((error as { status?: unknown } | null)?.status === 403) return;
      toast.error(getErrorMessage(error, strings.failed));
    }
  }, [
    selectedPrompt?.promptCode,
    isGated,
    hasStagedChange,
    candidateTextBlank,
    stagedText,
    stagedModel,
    stagedTemperature,
    nextTemperature,
    formData.prompt,
    formData.model,
    resolveProvider,
    submitCandidate,
    navigate,
  ]);

  const handleDuplicate = useCallback(async () => {
    if (!selectedPrompt?.id || !onDuplicate || isDuplicating) return;
    try {
      setIsDuplicating(true);
      await onDuplicate(selectedPrompt.id);
    } finally {
      setIsDuplicating(false);
    }
  }, [selectedPrompt?.id, onDuplicate, isDuplicating]);

  // Only "Duplicate as variant" copies are deletable from this panel.
  // The promptCode suffix is the only durable marker — name and description
  // are author-editable and can't be trusted.
  const isDuplicate = useMemo(
    () => Boolean(selectedPrompt?.promptCode?.includes("_copy_")),
    [selectedPrompt?.promptCode],
  );

  // Only prompts with a promptType are offered in a studio picker, so they're
  // the only ones for which "show in studio" means anything. Blocks and
  // untyped prompts don't get the switch.
  const isPickerVariant = Boolean(selectedPrompt?.promptType);

  // Fetch in-use count for duplicates (the only deletable rows, where it gates
  // the Delete button) and for anything carrying the visibility switch (where
  // it tells the admin how many simulations are already committed to this
  // version before they hide it). `skip` avoids firing for everything else —
  // file-backed prompts with no promptType can neither be deleted nor hidden.
  const { data: usageData, isFetching: isUsageLoading } = useGetPromptUsageQuery(
    selectedPrompt?.id ?? "",
    { skip: !selectedPrompt?.id || (!isDuplicate && !isPickerVariant) },
  );
  const inUseCount = usageData?.count ?? 0;
  const isInUse = inUseCount > 0;

  // Undefined (row predates the flag) reads as visible.
  const isVisibleInStudio = (formData.visibleInStudio ?? selectedPrompt?.visibleInStudio) !== false;

  const handleDeleteClick = useCallback(() => {
    if (!selectedPrompt?.id || !onDelete || isDeleting || isInUse) return;
    setShowDeleteConfirmModal(true);
  }, [selectedPrompt?.id, onDelete, isDeleting, isInUse]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!selectedPrompt?.id || !onDelete) return;
    try {
      setIsDeleting(true);
      await onDelete(selectedPrompt.id);
      setShowDeleteConfirmModal(false);
    } finally {
      setIsDeleting(false);
    }
  }, [selectedPrompt?.id, onDelete]);

  const handleDeleteCancel = useCallback(() => {
    setShowDeleteConfirmModal(false);
  }, []);

  const handleClose = useCallback(() => {
    // Everything is auto-saved, so there's no "discard?" prompt anymore — just
    // flush any edit still inside the debounce window before the panel closes.
    flushSave();
    onClose();
  }, [flushSave, onClose]);

  const handleRevertClick = useCallback(() => {
    setShowRevertConfirmModal(true);
  }, []);

  const runRevert = useCallback(
    async (confirmPinnedChange: boolean) => {
      if (!selectedPrompt?.id) return;
      try {
        // The server puts the default text live as a new version (translations
        // included); the current version stays in the history.
        await revertPrompt({
          id: selectedPrompt.id,
          ...(confirmPinnedChange ? { confirmPinnedChange: true } : {}),
        }).unwrap();
        toast.success(en.simulation.revertPromptSuccess);
        setShowRevertConfirmModal(false);
        onClose();
      } catch (error) {
        setShowRevertConfirmModal(false);
        // A pinned prompt goes live only once its change is confirmed.
        if (skillsStoreErrorCode(error) === "SKILLS_STORE_PROMPT_PINNED") {
          setRevertPinnedReason(pinnedReason(error));
          return;
        }
        toast.error(getErrorMessage(error, en.simulation.revertPromptFailed));
      }
    },
    [selectedPrompt, revertPrompt, onClose],
  );

  const handleRevertConfirm = useCallback(() => runRevert(false), [runRevert]);

  const handleRevertCancel = useCallback(() => {
    setShowRevertConfirmModal(false);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+Enter (Windows/Linux) or Cmd+Enter (Mac) in the prompt text saves
      // it as a new draft version — the explicit save, from the keyboard.
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void handleSaveVersion();
      }
    },
    [handleSaveVersion],
  );

  if (!isOpen || !selectedPrompt) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black bg-opacity-50" onClick={handleClose} />
      <div className="w-full md:w-[50%] md:min-w-[700px] bg-white shadow-xl border-l-[1px] border-border-light overflow-y-auto custom-scrollbar">
        <div className="flex flex-wrap md:flex-nowrap items-center justify-between gap-y-2 p-4 md:p-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={handleClose}
              className="flex flex-row items-center justify-center gap-2 text-typography-600 hover:text-neutral-800 shrink-0 max-md:min-h-10"
            >
              <DoubleArrowRight width={14} height={14} />
              <span className="text-base font-tertiary font-[500] text-typography-900">
                {en.simulation.editPrompt}
              </span>
            </button>
            <span className="h-4 w-px bg-border-light shrink-0" aria-hidden />
            <SaveStatusIndicator
              state={saveState}
              isDirty={isDirty}
              isValid={isFormValid}
              staged={isGated && hasStagedChange}
              onRetry={flushSave}
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onDuplicate && selectedPrompt?.id && selectedPrompt?.promptType && (
              <IconButton
                title={isDuplicating ? "Duplicating…" : "Duplicate as variant"}
                onClick={handleDuplicate}
                disabled={isDuplicating}
              >
                <Copy width={18} height={18} />
              </IconButton>
            )}
            {onDelete && selectedPrompt?.id && isDuplicate && (
              <IconButton
                title={
                  isUsageLoading
                    ? "Checking usage…"
                    : isInUse
                      ? `Used by ${inUseCount} simulation${inUseCount === 1 ? "" : "s"} — switch ${inUseCount === 1 ? "it" : "them"} to another prompt before deleting`
                      : "Delete variant"
                }
                onClick={handleDeleteClick}
                disabled={isDeleting || isUsageLoading || isInUse}
              >
                <span className="relative flex">
                  <Delete width={18} height={18} />
                  {isInUse && (
                    <span className="absolute -top-2 -right-2 min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full bg-neutral-500 text-white text-xs leading-none tabular-nums">
                      {inUseCount}
                    </span>
                  )}
                </span>
              </IconButton>
            )}
            {/* A revert is a behaviour change like any other, and the server refuses it for a
                gated prompt, so the button is not offered. */}
            {Boolean(selectedPrompt?.defaultPrompt) && !isGated && (
              <button
                onClick={handleRevertClick}
                className="flex items-center gap-1.5 pl-2 pr-1 h-9 text-typography-600 hover:text-neutral-800 transition-colors"
                title={en.simulation.restoreDefault}
              >
                <Refresh width={16} height={16} />
                <span className="text-sm font-medium">{en.simulation.restoreDefault}</span>
              </button>
            )}
          </div>
        </div>

        <div className="h-[calc(100dvh-72px)] md:h-[calc(100vh-100px)] px-4 md:px-8 pt-2 overflow-y-auto custom-scrollbar">
          <div className="space-y-6">
            <SkillExperimentNotice promptId={selectedPrompt?.id} />
            {isGated && (
              // A plain div, not an InlineNotification: the notice carries a button,
              // and Carbon throws on an interactive child in a notification.
              <div
                role="note"
                data-testid="prompt-gate-notice"
                className="border-l-4 border-primary-500 bg-primary-50 p-4"
              >
                <p className="text-base font-medium text-typography-900">
                  {en.builder.eval.promptGate.noticeTitle}
                </p>
                <p className="mt-1 text-sm text-typography-700">
                  {en.builder.eval.promptGate.noticeBody}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button
                    variant={ButtonVariant.PRIMARY}
                    onClick={() => void handleSubmitCandidate()}
                    disabled={!hasStagedChange || candidateTextBlank || isSubmittingCandidate}
                  >
                    {isSubmittingCandidate
                      ? en.builder.eval.promptGate.submitting
                      : en.builder.eval.promptGate.submit}
                  </Button>
                  <span className="text-xs text-typography-600">
                    {hasStagedChange
                      ? en.builder.eval.promptGate.costHint
                      : en.builder.eval.promptGate.nothingChanged}
                  </span>
                </div>
              </div>
            )}
            <Field label="UUID">
              <div className="w-full select-all border-b border-border-light bg-secondary-50 px-3 py-2 font-mono text-base text-neutral-700 break-all">
                {selectedPrompt?.id ?? "—"}
              </div>
            </Field>

            <Field label="Prompt Code">
              <div className="w-full select-all border-b border-border-light bg-secondary-50 px-3 py-2 font-mono text-base text-neutral-700 break-all">
                {selectedPrompt?.promptCode ?? formData.promptCode ?? "—"}
              </div>
            </Field>

            {/*
              Studio-picker visibility. Deliberately worded around *new*
              simulations: this is a future-visibility switch, not an
              enable/disable of the prompt itself. Nothing in the runtime reads
              the flag, so switching it off cannot affect a simulation already
              pointing at this version — the usage line below states that
              outright rather than leaving the admin to guess, and the count is
              shown instead of blocking the switch.
            */}
            {isPickerVariant && (
              <Field label="Studio availability">
                <div className="w-full flex flex-col gap-2 py-1">
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-base text-typography-900 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isVisibleInStudio}
                        onChange={event =>
                          handleFieldChange("visibleInStudio", event.target.checked)
                        }
                      />
                      Offer this version in the studio picker
                    </label>
                    <Tooltip
                      label="Controls whether authors can choose this version for new simulations. Switching it off changes nothing for simulations that already use it — they keep running on this exact prompt."
                      align="top"
                    >
                      <button type="button" className="cursor-pointer inline-flex items-center">
                        <TooltipIcon />
                      </button>
                    </Tooltip>
                  </div>
                  <span className="text-typography-500 text-sm">
                    {isUsageLoading
                      ? "Checking usage…"
                      : isVisibleInStudio
                        ? isInUse
                          ? `Authors can pick this version. Used by ${inUseCount} simulation${inUseCount === 1 ? "" : "s"}.`
                          : "Authors can pick this version."
                        : isInUse
                          ? `Hidden from the picker — no new simulation can be pointed at it. The ${inUseCount} simulation${inUseCount === 1 ? "" : "s"} already using it ${inUseCount === 1 ? "keeps" : "keep"} running on it, unchanged.`
                          : "Hidden from the picker — no new simulation can be pointed at it."}
                  </span>
                </div>
              </Field>
            )}

            <Field label={en.simulation.promptName}>
              <input
                type="text"
                value={formData.name || ""}
                onChange={event => handleFieldChange("name", event.target.value)}
                placeholder={en.simulation.enterPromptName}
                className={CARBON_FIELD}
              />
            </Field>

            <Field label={en.simulation.promptDescription}>
              <input
                type="text"
                value={formData.description || ""}
                onChange={event => handleFieldChange("description", event.target.value)}
                placeholder={en.simulation.enterPromptDescription}
                className={CARBON_FIELD}
              />
            </Field>

            <Field label={en.simulation.promptText}>
              <AutoExpandableTextarea
                maxLines={15}
                minHeight={120}
                value={formData.prompt || ""}
                onChange={value => handleFieldChange("prompt", value)}
                onKeyDown={handleKeyDown}
                placeholder={en.simulation.enterPrompt}
                className={CARBON_FIELD_TEXTAREA}
              />
            </Field>

            <Field label="LLM Model">
              <LlmModelDropdown
                value={formData.model ?? ""}
                groups={modelGroups}
                onSelect={selected => {
                  const value = selected || undefined;
                  handleFieldChange("model", value);
                  // Send the explicit provider alongside the model so runtimes
                  // don't infer it from the model name.
                  handleFieldChange("provider", resolveProvider(value));
                  // A model that rejects a custom temperature (e.g. gpt-5)
                  // clears any existing override so we don't send an invalid value.
                  const supportsTemp = !value || (tempSupportByModel.get(value) ?? true);
                  if (!supportsTemp && typeof formData.temperature === "number") {
                    handleFieldChange("temperature", undefined);
                  }
                }}
              />
            </Field>

            <Field label="LLM Temperature">
              <div className="w-full flex flex-col gap-3 py-1">
                <label
                  className={
                    "flex items-center gap-2 text-base " +
                    (selectedModelSupportsTemperature
                      ? "text-typography-900 cursor-pointer"
                      : "text-typography-400 cursor-not-allowed")
                  }
                >
                  <input
                    type="checkbox"
                    disabled={!selectedModelSupportsTemperature}
                    checked={typeof formData.temperature === "number"}
                    onChange={event =>
                      handleFieldChange(
                        "temperature",
                        event.target.checked ? PROMPT_TEMPERATURE_DEFAULT : undefined,
                      )
                    }
                  />
                  Override temperature for this prompt
                </label>
                {!selectedModelSupportsTemperature && (
                  <span className="text-typography-500 text-sm">
                    {formData.model} doesn’t support a custom temperature.
                  </span>
                )}
                {selectedModelSupportsTemperature && typeof formData.temperature === "number" && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-typography-500 text-sm">0 – 2</span>
                      <span className="text-primary-600 text-base font-medium tabular-nums">
                        {formData.temperature.toFixed(1)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.1}
                      value={formData.temperature}
                      onChange={event =>
                        handleFieldChange("temperature", parseFloat(event.target.value))
                      }
                      aria-label="LLM Temperature"
                      className="w-full accent-primary-500 cursor-pointer"
                    />
                  </div>
                )}
              </div>
            </Field>

            {!isGated && (
              <div
                className="border-l-4 border-border-dark bg-secondary-50 p-4 flex flex-col gap-3"
                data-testid="prompt-save-version"
              >
                <p className="text-sm text-typography-700">
                  {hasStagedChange
                    ? en.skillsStore.versions.unsavedChanges
                    : en.skillsStore.versions.noChanges}
                </p>
                {versionError?.kind === "stale" && (
                  <div role="alert" className="flex flex-col gap-2 text-sm text-destructive-500">
                    <span>{en.skillsStore.versions.staleBase(versionError.latest)}</span>
                    <button
                      type="button"
                      onClick={() => void handleReloadVersions()}
                      className="self-start underline text-primary-600"
                    >
                      {en.skillsStore.versions.reload}
                    </button>
                  </div>
                )}
                {versionError?.kind === "contract" && (
                  <div role="alert" className="flex flex-col gap-1 text-sm text-destructive-500">
                    <span>{en.skillsStore.versions.contractViolation}</span>
                    {versionError.missing.length > 0 && (
                      <span>{en.skillsStore.versions.contractMissing(versionError.missing)}</span>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="text"
                    value={versionNote}
                    onChange={event => setVersionNote(event.target.value)}
                    placeholder={en.skillsStore.versions.notePlaceholder}
                    aria-label={en.skillsStore.versions.notePlaceholder}
                    className={CARBON_FIELD + " flex-1 min-w-[200px]"}
                    disabled={!hasStagedChange}
                  />
                  <Button
                    variant={ButtonVariant.PRIMARY}
                    onClick={() => void handleSaveVersion()}
                    disabled={
                      !hasStagedChange || !(formData.prompt ?? "").trim() || isSavingVersion
                    }
                  >
                    {isSavingVersion
                      ? en.skillsStore.versions.saving
                      : en.skillsStore.versions.saveAsVersion}
                  </Button>
                </div>
              </div>
            )}

            {selectedPrompt?.id && (
              <Field label={en.skillsStore.versions.title}>
                {versions ? (
                  <PromptVersionsSection
                    promptId={selectedPrompt.id}
                    versions={versions}
                    onReload={() => void refetchVersions()}
                  />
                ) : (
                  <span className="text-sm text-typography-500">
                    {isFetchingVersions ? en.common.loading : en.skillsStore.versions.empty}
                  </span>
                )}
              </Field>
            )}

            {(availableVariables.length > 0 || unusedVariables.length > 0) && (
              <Field label="Available variables">
                {/*
                  Single chip cluster covering BOTH "used in this prompt"
                  and "available but not used" variables. Used chips
                  render with a solid neutral background; unused chips
                  are muted with a dashed border so the author can see
                  at a glance which placeholders are already in their
                  template vs which they could still add. The chip text
                  is always the exact `{name}` an author types into the
                  prompt body — labels would invite typos like `{Name}`.

                  Sorted alphabetically across the merged set so the
                  list stays stable as the author types new placeholders
                  (used) or removes them (back to unused).
                */}
                <div className="flex flex-wrap gap-2">
                  {[
                    ...availableVariables.map(v => ({
                      name: v.name,
                      isUsed: true,
                    })),
                    ...unusedVariables.map(entry => ({
                      name: entry.name,
                      isUsed: false,
                    })),
                  ]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(chip => (
                      <span
                        key={chip.name}
                        className={
                          chip.isUsed
                            ? "inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm bg-neutral-100 text-typography-700 font-mono"
                            : "inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm bg-neutral-50 border border-dashed border-border-light text-typography-500 font-mono"
                        }
                      >
                        <span>{`{${chip.name}}`}</span>
                      </span>
                    ))}
                </div>
              </Field>
            )}

            {hasAnyBlocks && (
              <Field label={en.simulation.usedBlocks}>
                <div className="w-full space-y-3 pt-2">
                  <div className="rounded-md border border-border-light bg-neutral-50 px-3 py-3">
                    <div className="text-sm font-medium text-typography-900">
                      {en.simulation.blocksHelpTitle}
                    </div>
                    <p className="mt-1 text-sm leading-5 text-typography-700">
                      {en.simulation.blocksHelpText}
                    </p>
                  </div>

                  {selectedPrompt.usesBlocks && selectedPrompt.usesBlocks.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedPrompt.usesBlocks.map(code => (
                        <button
                          key={code}
                          onClick={() => handleBlockClick(code)}
                          className="inline-flex px-2 py-0.5 rounded text-sm bg-neutral-100 text-typography-800 hover:bg-neutral-200 transition-colors font-mono border border-border-light"
                          title="Click to edit block"
                        >
                          {code.replace("ally_ai_learn_system_", "")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
            )}

            {selectedPrompt?.id &&
              TRANSLATABLE_PROMPT_TYPES.has(
                selectedPrompt?.promptType ?? formData.promptType ?? "",
              ) && (
                <Field label="Translations">
                  <PromptTranslationsSection
                    promptId={selectedPrompt.id}
                    translationEnabled={
                      formData.translationEnabled ?? selectedPrompt.translationEnabled ?? false
                    }
                    onToggleEnabled={value => handleFieldChange("translationEnabled", value)}
                    version={editorBase?.version}
                  />
                </Field>
              )}
          </div>

          <div className="pb-6" />
        </div>
      </div>

      <ActionConfirmationPopup
        isOpen={showRevertConfirmModal}
        onClose={handleRevertCancel}
        title={en.simulation.restoreDefault}
        description={en.simulation.revertToDefaultConfirm}
        primaryButton={{
          label: "Revert",
          onClick: handleRevertConfirm,
        }}
        secondaryButton={{
          label: "Cancel",
          onClick: handleRevertCancel,
        }}
      />
      <ActionConfirmationPopup
        isOpen={revertPinnedReason != null}
        onClose={() => setRevertPinnedReason(null)}
        title={revertPinnedReason ? en.skillsStore.versions.pinned[revertPinnedReason].title : ""}
        description={
          revertPinnedReason ? en.skillsStore.versions.pinned[revertPinnedReason].body : ""
        }
        primaryButton={{
          label: revertPinnedReason
            ? en.skillsStore.versions.pinned[revertPinnedReason].confirm
            : "",
          onClick: () => {
            setRevertPinnedReason(null);
            void runRevert(true);
          },
        }}
        secondaryButton={{
          label: "Cancel",
          onClick: () => setRevertPinnedReason(null),
        }}
      />
      <ActionConfirmationPopup
        isOpen={showDeleteConfirmModal}
        onClose={handleDeleteCancel}
        title="Delete variant"
        description={
          "This will permanently remove the duplicated variant. Simulations " +
          "still pointing to it will fall back to the default. This cannot " +
          "be undone."
        }
        primaryButton={{
          label: isDeleting ? "Deleting…" : "Delete",
          onClick: handleDeleteConfirm,
        }}
        secondaryButton={{
          label: "Cancel",
          onClick: handleDeleteCancel,
        }}
      />

      <BlockEditorPopup
        isOpen={!!editingBlock}
        block={editingBlock}
        onClose={() => setEditingBlock(null)}
        onSave={handleBlockUpdate}
      />
    </div>
  );
};
