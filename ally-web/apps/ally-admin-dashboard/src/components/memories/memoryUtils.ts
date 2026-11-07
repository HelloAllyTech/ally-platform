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
  unlocksInStateIds?: string[] | null;
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
  unlocksInStateIds: [],
});

/**
 * The states a memory unlocks at. A memory saved with the older single lock
 * ("from this state on") reads as that state and every later one in
 * `ladderIds`, which is what it meant; the author can then untick any.
 */
export const memoryStateIds = (item: SourceLike, ladderIds?: readonly string[]): string[] => {
  if (Array.isArray(item.unlocksInStateIds)) {
    return item.unlocksInStateIds.filter(id => typeof id === "string" && id);
  }
  const lock = item.unlocksFromStateId || null;
  if (!lock) return [];
  const index = ladderIds ? ladderIds.indexOf(lock) : -1;
  return index === -1 ? [lock] : ladderIds!.slice(index);
};

/**
 * Normalise memories from any source (mapping response, form, fallback copy,
 * stored scenario): every row gets an id, a string title/content, and the list
 * of states it unlocks at. With `dropUnknown`, a state id that isn't one of
 * `ladderIds` is dropped (it would hide the memory all session). A stored
 * scenario keeps it, so the card says the state is gone instead of the memory
 * quietly becoming available from the start.
 */
export const normaliseMemories = (
  items: SourceLike[] | undefined | null,
  ladderIds?: readonly string[],
  { dropUnknown = true }: { dropUnknown?: boolean } = {},
): ScenarioMemory[] =>
  (Array.isArray(items) ? items : []).filter(Boolean).map(item => ({
    id: item.id || newId(),
    title: typeof item.title === "string" ? item.title : "",
    content: typeof item.content === "string" ? item.content : "",
    unlocksInStateIds: memoryStateIds(item, ladderIds).filter(
      id => !dropUnknown || !ladderIds || ladderIds.includes(id),
    ),
  }));

/** Add or remove one state from each memory, so `memoryIds` are exactly the ones picked there. */
export const setMemoriesForState = (
  memories: ScenarioMemory[],
  stateId: string,
  memoryIds: readonly string[],
): ScenarioMemory[] =>
  memories.map(memory => {
    const current = memory.unlocksInStateIds ?? [];
    const picked = memoryIds.includes(memory.id);
    if (picked === current.includes(stateId)) return memory;
    return {
      ...memory,
      unlocksInStateIds: picked ? [...current, stateId] : current.filter(id => id !== stateId),
    };
  });

/**
 * Drop a deleted state from every memory. A memory left with no state would
 * become available from the start, earlier than the author meant, so it moves
 * to the next state up instead (the one below when the top state went).
 */
export const removeStateFromMemories = (
  memories: ScenarioMemory[],
  ladderIdsBeforeRemoval: readonly string[],
  removedStateId: string,
): { memories: ScenarioMemory[]; moved: number; movedTo: string | null } => {
  const index = ladderIdsBeforeRemoval.indexOf(removedStateId);
  const movedTo =
    index === -1
      ? null
      : (ladderIdsBeforeRemoval[index + 1] ?? ladderIdsBeforeRemoval[index - 1] ?? null);
  let moved = 0;
  const next = memories.map(memory => {
    const current = memory.unlocksInStateIds ?? [];
    if (!current.includes(removedStateId)) return memory;
    const rest = current.filter(id => id !== removedStateId);
    if (rest.length > 0) return { ...memory, unlocksInStateIds: rest };
    moved += 1;
    return { ...memory, unlocksInStateIds: movedTo ? [movedTo] : [] };
  });
  return { memories: next, moved, movedTo };
};

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
