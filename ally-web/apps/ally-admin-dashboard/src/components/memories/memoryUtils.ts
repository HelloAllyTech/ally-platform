import type { ScenarioMemory } from "@types";

/**
 * Pure helpers for the Stage Director prompt's Memories. No React / RHF, so
 * the rules are unit-testable on their own (same split as
 * knowledge-source/memoryLocks.ts, whose lock rules memories share).
 */

interface SourceLike {
  id?: string;
  title?: string;
  content?: string;
  unlocksFromStateId?: string | null;
}

const newId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `memory-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** A blank memory row, available from the start. */
export const blankMemory = (): ScenarioMemory => ({
  id: newId(),
  title: "",
  content: "",
  unlocksFromStateId: null,
});

/**
 * Normalise memories from any source (mapping response, form, fallback copy):
 * every row gets an id, a string title/content, and a lock that either names
 * one of `validStateIds` or is null. A lock naming an unknown state would hide
 * the memory all session, so it is dropped rather than kept.
 */
export const normaliseMemories = (
  items: SourceLike[] | undefined | null,
  validStateIds?: ReadonlySet<string>,
): ScenarioMemory[] =>
  (Array.isArray(items) ? items : []).filter(Boolean).map(item => {
    const lock = item.unlocksFromStateId || null;
    return {
      id: item.id || newId(),
      title: typeof item.title === "string" ? item.title : "",
      content: typeof item.content === "string" ? item.content : "",
      unlocksFromStateId: lock && (!validStateIds || validStateIds.has(lock)) ? lock : null,
    };
  });

/** Characters the Memories size warning counts: backstory + every title and text. */
export const memoriesCharacterCount = (
  backstory: string | undefined | null,
  memories: ScenarioMemory[] | undefined | null,
): number =>
  (backstory ?? "").length +
  (memories ?? []).reduce(
    (total, memory) => total + (memory?.title ?? "").length + (memory?.content ?? "").length,
    0,
  );
