import {
  BranchingChoice,
  BranchingExperience,
  BranchingNode,
  StartBranchingScenarioItemPayload,
} from "@types";

/** Missing or unknown (an older server) reads as the classic card layout. */
export const branchingExperience = (
  payload: Pick<StartBranchingScenarioItemPayload, "experience">,
): BranchingExperience => (payload.experience === "STORY" ? "STORY" : "CLASSIC");

/**
 * Whether the scenario plays in the full-screen story layout. A story with no
 * photo anywhere has nothing to stage, so it plays classic.
 */
export const isStoryScenario = (
  payload: Pick<StartBranchingScenarioItemPayload, "experience" | "nodes">,
): boolean => branchingExperience(payload) === "STORY" && payload.nodes.some(n => !!n.image?.url);

export interface StoryPhoto {
  url: string;
  alt: string;
  /** True when the photo belongs to another scene and is only standing in. */
  reused: boolean;
}

/**
 * The photo a story scene shows: its own; else the most recent one on the
 * path walked to it; else the first scene in the scenario that has one. Null
 * only when the scenario has no photos at all. A borrowed photo is decorative
 * here, so its alt text is dropped.
 */
export const storyPhotoFor = (
  current: BranchingNode,
  nodes: BranchingNode[],
  startNodeId: string,
  path: BranchingChoice[],
): StoryPhoto | null => {
  if (current.image?.url) {
    return { url: current.image.url, alt: current.image.alt ?? "", reused: false };
  }
  const byId = new Map(nodes.map(n => [n.id, n]));
  const walked = [startNodeId, ...path.map(c => c.nextNodeId)];
  if (walked[walked.length - 1] === current.id) walked.pop();
  for (let i = walked.length - 1; i >= 0; i -= 1) {
    const url = byId.get(walked[i])?.image?.url;
    if (url) return { url, alt: "", reused: true };
  }
  const first = nodes.find(n => !!n.image?.url);
  return first?.image ? { url: first.image.url, alt: "", reused: true } : null;
};
