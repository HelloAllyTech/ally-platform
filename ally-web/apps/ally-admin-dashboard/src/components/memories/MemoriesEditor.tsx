import { FC, useCallback, useMemo } from "react";

import { UseFormReturn, useWatch } from "react-hook-form";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { Close, TooltipIcon } from "@assets";
import { en, FORM_FIELD_IDS, MEMORIES_SIZE_WARNING_CHARS } from "@constants";
import type { ScenarioMemory } from "@types";

import { FormLabel } from "../form-label";
import { blankMemory, memoriesCharacterCount } from "./memoryUtils";
import { useMapMemories } from "./useMemoriesAutoMap";
import { ladderOrder, stateLabel } from "../knowledge-source/memoryLocks";

import type { SimulationStateFormValue } from "../states-editor/types";

const MAX_TITLE_LENGTH = 100;
const MAX_CONTENT_LENGTH = 2500;

interface MemoriesEditorProps {
  /** RHF field id — `memories`. */
  id: string;
  label?: string;
  formMethods: UseFormReturn<any>;
  isMandatory?: boolean;
  readOnly?: boolean;
}

/**
 * The Stage Director prompt's Memories: one row per event or thing the client
 * can reveal, like Opening Dialogues. Which states unlock each one is picked
 * under each state in the States editor; a row only shows the result.
 *
 * Rendered only when the selected prompt uses `{memories}` (FormField gate);
 * Knowledge Sources is hidden in the same case and its data left untouched.
 */
export const MemoriesEditor: FC<MemoriesEditorProps> = ({
  id,
  label = en.memories.label,
  formMethods,
  isMandatory = false,
  readOnly = false,
}) => {
  const t = en.memories;
  const { control, setValue } = formMethods;
  const memories = (useWatch({ control, name: id }) as ScenarioMemory[] | undefined) ?? [];
  const states =
    (useWatch({ control, name: FORM_FIELD_IDS.STATES }) as
      | SimulationStateFormValue[]
      | undefined) ?? [];
  const backstory = useWatch({ control, name: FORM_FIELD_IDS.CHARACTER_PROFILE_TEXT }) as
    | string
    | undefined;
  const { runMapping, isMapping } = useMapMemories(formMethods);
  const knowledgeSources =
    (useWatch({ control, name: FORM_FIELD_IDS.KNOWLEDGE_SOURCE }) as unknown[] | undefined) ?? [];
  const canRemap = !readOnly && !isMapping && knowledgeSources.length > 0;
  const remap = () => {
    // Replaces every memory, including edits made since the last mapping.
    if (window.confirm(t.remapConfirm)) void runMapping({ replace: true });
  };

  const ladder = useMemo(() => ladderOrder(states.filter(state => !!state?.id)), [states]);
  const stateNames = useMemo(
    () => new Map(ladder.map((state, index) => [state.id, stateLabel(state, index)])),
    [ladder],
  );
  /** Where a memory unlocks, in ladder order; set under each state below. */
  const unlocksAt = (memory: ScenarioMemory): string => {
    const picked = new Set(memory.unlocksInStateIds ?? []);
    if (picked.size === 0) return t.fromTheStart;
    const names = ladder
      .filter(state => picked.has(state.id))
      .map(state => stateNames.get(state.id));
    return t.unlocksAt(names.length ? names.join(", ") : t.missingState);
  };

  const write = useCallback(
    (next: ScenarioMemory[]) => setValue(id, next, { shouldDirty: true, shouldTouch: true }),
    [id, setValue],
  );

  const update = (memoryId: string, patch: Partial<ScenarioMemory>) =>
    write(memories.map(memory => (memory.id === memoryId ? { ...memory, ...patch } : memory)));

  const totalChars = memoriesCharacterCount(backstory, memories);

  return (
    <div className="flex w-full flex-col gap-3" data-testid="memories-editor">
      <FormLabel isMandatory={isMandatory}>{label}</FormLabel>
      <div className="flex flex-col gap-1 text-sm text-typography-600">
        <p>{t.help}</p>
        <p>{t.helpLocked}</p>
      </div>

      {canRemap && (
        <div>
          <button
            type="button"
            onClick={remap}
            className="text-sm text-primary-600 underline-offset-2 hover:underline"
            data-testid="memories-remap"
          >
            {t.remap}
          </button>
        </div>
      )}

      {isMapping && (
        <p className="text-sm text-typography-600" role="status" data-testid="memories-mapping">
          {t.mapping}
        </p>
      )}

      {memories.length === 0 && !isMapping && (
        <p className="text-sm text-typography-600">{t.empty}</p>
      )}

      {memories.map((memory, index) => {
        return (
          <div
            key={memory.id}
            className="flex flex-col gap-2 rounded border border-border-light bg-white p-3"
            data-testid="memory-row"
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                aria-label={t.titleLabel(index)}
                value={memory.title ?? ""}
                maxLength={MAX_TITLE_LENGTH}
                readOnly={readOnly}
                placeholder={readOnly ? "" : t.titlePlaceholder}
                onChange={event => update(memory.id, { title: event.target.value })}
                className="min-w-0 flex-1 border-b border-border-light bg-transparent px-1 py-1 text-base text-typography-900 focus:border-primary-500 focus:outline-none"
              />
              {!readOnly && (
                <Tooltip label={t.remove} align="top">
                  <button
                    type="button"
                    aria-label={t.remove}
                    onClick={() => write(memories.filter(item => item.id !== memory.id))}
                    className="flex shrink-0 items-center text-typography-500 transition-colors hover:text-destructive-500 max-md:-m-2 max-md:p-2"
                  >
                    <Close className="h-4 w-4" />
                  </button>
                </Tooltip>
              )}
            </div>

            <textarea
              aria-label={t.contentLabel(index)}
              value={memory.content ?? ""}
              maxLength={MAX_CONTENT_LENGTH}
              readOnly={readOnly}
              placeholder={readOnly ? "" : t.contentPlaceholder}
              rows={3}
              onChange={event => update(memory.id, { content: event.target.value })}
              className="w-full resize-y rounded border border-border-light bg-white px-2 py-1.5 text-sm text-typography-800 focus:border-primary-500 focus:outline-none"
            />

            <div className="flex flex-wrap items-center gap-2 text-sm text-typography-700">
              <span data-testid="memory-unlocks-at">{unlocksAt(memory)}</span>
              <Tooltip label={t.availableFromTooltip} align="top">
                <button type="button" className="inline-flex cursor-pointer items-center">
                  <TooltipIcon />
                </button>
              </Tooltip>
              <span className="ml-auto text-xs text-typography-500">
                {(memory.content ?? "").length}/{MAX_CONTENT_LENGTH}
              </span>
            </div>
          </div>
        );
      })}

      {!readOnly && (
        <button
          type="button"
          onClick={() => write([...memories, blankMemory()])}
          className="self-start text-sm text-primary hover:text-primary-700"
        >
          {t.add}
        </button>
      )}

      {totalChars > MEMORIES_SIZE_WARNING_CHARS && (
        <p
          className="rounded border border-warning-300 bg-warning-50 px-3 py-2 text-sm text-typography-800"
          role="status"
          data-testid="memories-size-warning"
        >
          {t.tooLong(totalChars, MEMORIES_SIZE_WARNING_CHARS)}
        </p>
      )}
    </div>
  );
};
