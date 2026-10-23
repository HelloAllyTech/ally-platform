/**
 * Scenes, not a log (plan §5.5): a finished chapter folds to its receipt,
 * and the learner can open it again. Pure so the folding rule is tested
 * apart from the page.
 */
import type { FeedEntry, SceneState } from "./guideFeedReducer";

/**
 * The entries to draw. Entries of a closed scene are hidden unless the
 * learner expanded it; its receipt always shows (it is the collapsed scene),
 * and its title card shows only when expanded, so title and receipt read as
 * one row when folded. The crisis card is pinned, never in the flow.
 */
export const visibleEntries = (
  entries: FeedEntry[],
  scenes: Record<string, SceneState>,
  expanded: ReadonlySet<string>,
): FeedEntry[] =>
  entries.filter(entry => {
    if (entry.kind === "crisis") return false;
    // A Continue or Start is stored as an empty learner message: nothing to show.
    if (entry.kind === "message" && entry.role === "learner" && !entry.text.trim()) return false;
    const sceneId = entry.sceneId;
    if (!sceneId) return true;
    const scene = scenes[sceneId];
    if (!scene?.closed || expanded.has(sceneId)) return true;
    return entry.kind === "receipt";
  });

/** The first card in a scene, for "Skip intro". */
export const firstCardInScene = (entries: FeedEntry[], sceneId: string): string | null =>
  entries.find(entry => entry.kind === "card" && entry.sceneId === sceneId)?.id ?? null;
