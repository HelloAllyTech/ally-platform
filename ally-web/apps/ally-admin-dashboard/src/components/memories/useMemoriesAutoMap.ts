import { useCallback, useEffect, useRef } from "react";

import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { useGetPromptsByTypeQuery, useMapScenarioMemoriesMutation } from "@api";
import { en, FORM_FIELD_IDS, MEMORIES_PLACEHOLDER } from "@constants";
import type { MapScenarioMemoriesRequest } from "@types";

import { setMemoriesMapping, useIsMappingMemories } from "./memoriesMappingStatus";
import { normaliseMemories } from "./memoryUtils";
import { getAvailableVariableName } from "../../utils/availableVariables";

interface PromptLike {
  promptCode: string;
  availableVariables?: Parameters<typeof getAvailableVariableName>[0][];
}

/** Whether the prompt with this code declares `{memories}` in its body. */
export const promptUsesMemories = (
  prompts: PromptLike[] | undefined,
  promptCode: string | undefined,
): boolean => {
  if (!prompts || !promptCode) return false;
  const match = prompts.find(prompt => prompt.promptCode === promptCode);
  return (match?.availableVariables ?? [])
    .map(getAvailableVariableName)
    .includes(MEMORIES_PLACEHOLDER);
};

/**
 * First switch to a `{memories}` prompt fills Memories automatically.
 *
 * Fires only on an author's own pick in the Skill Version dropdown (RHF reports
 * those as `type: "change"`), never on a form reset or a programmatic
 * setValue — loading a scenario must not call an LLM or dirty the form.
 *
 * Rules (product decisions, see the Stage Director design):
 *  - Memories already present → nothing happens; switching back to the new
 *    prompt shows the last ones as they were.
 *  - No Knowledge Sources → nothing to map, nothing happens.
 *  - Otherwise POST the CURRENT form values to the mapping endpoint and fill
 *    Memories with the result. On failure, copy Knowledge Sources over as they
 *    are (locks included) so the author starts from something.
 *  - Knowledge Sources themselves are only read, never written.
 */
export const useMemoriesAutoMap = (formMethods: UseFormReturn<any>): { isMapping: boolean } => {
  const { data: prompts } = useGetPromptsByTypeQuery("main_agent");
  const [mapMemories] = useMapScenarioMemoriesMutation();
  const formKey = formMethods.control as unknown as object;
  const isMapping = useIsMappingMemories(formKey);

  const promptsRef = useRef(prompts);
  promptsRef.current = prompts;
  const inFlightRef = useRef(false);

  const runMapping = useCallback(async () => {
    const { getValues, setValue } = formMethods;
    const hasMemories = () => {
      const current = getValues(FORM_FIELD_IDS.MEMORIES);
      return Array.isArray(current) && current.length > 0;
    };
    if (hasMemories() || inFlightRef.current) return;

    const knowledgeSources = normaliseMemories(getValues(FORM_FIELD_IDS.KNOWLEDGE_SOURCE));
    if (knowledgeSources.length === 0) return;

    // Unnamed state cards are dropped on save (and any lock on them cleared),
    // so they are not offered as targets.
    const states = ((getValues(FORM_FIELD_IDS.STATES) as any[] | undefined) ?? [])
      .filter(state => state?.id && typeof state.name === "string" && state.name.trim())
      .map(state => ({
        id: String(state.id),
        name: String(state.name),
        guidelines: typeof state.guidelines === "string" ? state.guidelines : undefined,
      }));
    const asText = (value: unknown) =>
      typeof value === "string" && value.trim() ? value : undefined;

    const body: MapScenarioMemoriesRequest = {
      knowledgeSources: knowledgeSources.map(source => ({
        id: source.id,
        title: source.title,
        content: source.content ?? "",
        unlocksFromStateId: source.unlocksFromStateId ?? null,
      })),
      states,
      characterProfileText: asText(getValues(FORM_FIELD_IDS.CHARACTER_PROFILE_TEXT)),
      roleInstructions: asText(getValues(FORM_FIELD_IDS.PROMPT)),
      title: asText(getValues(FORM_FIELD_IDS.TITLE)),
    };

    inFlightRef.current = true;
    setMemoriesMapping(formKey, true);
    try {
      const response = await mapMemories(body).unwrap();
      const mapped = normaliseMemories(response?.memories, new Set(states.map(state => state.id)));
      if (mapped.length === 0) throw new Error("Mapping returned no memories");
      // The author may have started typing memories while this ran — theirs win.
      if (!hasMemories()) {
        setValue(FORM_FIELD_IDS.MEMORIES, mapped, { shouldDirty: true });
      }
      toast.success(en.memories.mapped);
    } catch {
      if (!hasMemories()) {
        setValue(FORM_FIELD_IDS.MEMORIES, knowledgeSources, { shouldDirty: true });
      }
      toast.warning(en.memories.mapFailed);
    } finally {
      inFlightRef.current = false;
      setMemoriesMapping(formKey, false);
    }
  }, [formMethods, formKey, mapMemories]);

  useEffect(() => {
    const subscription = formMethods.watch((values, { name, type }) => {
      if (name !== FORM_FIELD_IDS.SELECTED_MAIN_PROMPT_CODE || type !== "change") return;
      const code = values?.[FORM_FIELD_IDS.SELECTED_MAIN_PROMPT_CODE] as string | undefined;
      if (!promptUsesMemories(promptsRef.current as PromptLike[] | undefined, code)) return;
      void runMapping();
    });
    return () => subscription.unsubscribe();
  }, [formMethods, runMapping]);

  return { isMapping };
};
