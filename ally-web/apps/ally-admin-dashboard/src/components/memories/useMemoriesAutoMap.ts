import { useCallback, useEffect, useRef } from "react";

import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { useGetPromptsByTypeQuery, useMapScenarioMemoriesMutation } from "@api";
import { en, FORM_FIELD_IDS, MEMORIES_PLACEHOLDER } from "@constants";
import type { MapScenarioMemoriesRequest } from "@types";

import { setMemoriesMapping, useIsMappingMemories } from "./memoriesMappingStatus";
import { normaliseMemories } from "./memoryUtils";
import { getAvailableVariableName } from "../../utils/availableVariables";
import { ladderOrder } from "../knowledge-source/memoryLocks";

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
/**
 * Maps the form's Knowledge Sources into Memories through the server's agent.
 *
 * `replace: false` (the automatic first switch) never touches memories that
 * already exist, including ones the author typed while the call ran.
 * `replace: true` (the editor's "Re-map" action, which the author confirms)
 * overwrites them with the new mapping.
 */
export const useMapMemories = (
  formMethods: UseFormReturn<any>,
): {
  runMapping: (options?: { replace?: boolean }) => Promise<void>;
  isMapping: boolean;
} => {
  const [mapMemories] = useMapScenarioMemoriesMutation();
  const formKey = formMethods.control as unknown as object;
  const isMapping = useIsMappingMemories(formKey);
  const inFlightRef = useRef(false);

  const runMapping = useCallback(
    async ({ replace = false }: { replace?: boolean } = {}) => {
      const { getValues, setValue } = formMethods;
      const hasMemories = () => {
        const current = getValues(FORM_FIELD_IDS.MEMORIES);
        return Array.isArray(current) && current.length > 0;
      };
      const mayWrite = () => replace || !hasMemories();
      if ((!replace && hasMemories()) || inFlightRef.current) return;

      // Unnamed state cards are dropped on save (and any lock on them cleared),
      // so they are not offered as targets. Sent in ladder order: the server
      // reads "from this state on" against it.
      const states = ladderOrder(
        ((getValues(FORM_FIELD_IDS.STATES) as any[] | undefined) ?? []).filter(
          state => state?.id && typeof state.name === "string" && state.name.trim(),
        ),
      ).map(state => ({
        id: String(state.id),
        name: String(state.name),
        guidelines: typeof state.guidelines === "string" ? state.guidelines : undefined,
      }));
      const ladderIds = states.map(state => state.id);
      const knowledgeSources = normaliseMemories(
        getValues(FORM_FIELD_IDS.KNOWLEDGE_SOURCE),
        ladderIds,
      );
      if (knowledgeSources.length === 0) return;
      const asText = (value: unknown) =>
        typeof value === "string" && value.trim() ? value : undefined;

      const body: MapScenarioMemoriesRequest = {
        // A Knowledge Source lock is one state, "from here on": the first of
        // the states it was read as.
        knowledgeSources: knowledgeSources.map(source => ({
          id: source.id,
          title: source.title,
          content: source.content ?? "",
          unlocksFromStateId: source.unlocksInStateIds?.[0] ?? null,
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
        const mapped = normaliseMemories(response?.memories, ladderIds);
        if (mapped.length === 0) throw new Error("Mapping returned no memories");
        if (mayWrite()) {
          setValue(FORM_FIELD_IDS.MEMORIES, mapped, { shouldDirty: true });
        }
        // The server copies the sources as they are when its agent fails; the
        // memories are usable, but the author should know none were assigned.
        if (response?.mapped === false) toast.warning(en.memories.mapFailed);
        else toast.success(en.memories.mapped);
      } catch {
        // A failed re-map keeps what the author had; a failed first switch
        // starts them from their Knowledge Sources.
        if (!replace && mayWrite()) {
          setValue(FORM_FIELD_IDS.MEMORIES, knowledgeSources, { shouldDirty: true });
        }
        toast.warning(replace ? en.memories.remapFailed : en.memories.mapFailed);
      } finally {
        inFlightRef.current = false;
        setMemoriesMapping(formKey, false);
      }
    },
    [formMethods, formKey, mapMemories],
  );

  return { runMapping, isMapping };
};

export const useMemoriesAutoMap = (formMethods: UseFormReturn<any>): { isMapping: boolean } => {
  const { data: prompts } = useGetPromptsByTypeQuery("main_agent");
  const { runMapping, isMapping } = useMapMemories(formMethods);
  const promptsRef = useRef(prompts);
  promptsRef.current = prompts;

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
