import {
  BranchingNode,
  BranchingScenarioContent,
  GenerateImageRequest,
  ImageContext,
  ImageReferenceOption,
  ImageReferenceOptions,
} from "@types";

/**
 * Image continuity for branching scenarios: which scenes lead into a scene
 * (so its picture can follow on from theirs), which scenes still need a
 * picture, and the requests "Fill empty scenes" sends. Pure — no React.
 */

/** Scene text sent with a generation; the describe step needs no more. */
const SCENE_TEXT_MAX_CHARS = 600;
const DESCRIPTION_MAX_CHARS = 2000;

export const sceneSlotKey = (trackId: string | null | undefined, itemId: string, nodeId: string) =>
  `track:${trackId || "new"}:item:${itemId}:node:${nodeId}`;

/** What the author sees for a scene: its title, or "Scene N". */
export const sceneDisplayName = (content: BranchingScenarioContent, node: BranchingNode) =>
  node.title?.trim() || `Scene ${content.nodes.indexOf(node) + 1}`;

/**
 * The scenes one step back: every node with a choice that leads to `nodeId`.
 * Branches can loop back on themselves, so this never walks further than one
 * step, and a scene is never its own parent.
 */
export const parentSceneIds = (content: BranchingScenarioContent, nodeId: string): string[] =>
  content.nodes
    .filter(
      node =>
        node.id !== nodeId && (node.choices ?? []).some(choice => choice.nextNodeId === nodeId),
    )
    .map(node => node.id);

const hasImage = (node: BranchingNode) => !!node.image?.url;

/**
 * Reference options for one scene's Generate: its parent scenes' pictures as
 * `previous` (offered, off by default), and every other scene picture in the
 * scenario as an optional `setting`.
 */
export const sceneReferenceOptions = (
  content: BranchingScenarioContent,
  nodeId: string,
): ImageReferenceOptions => {
  const parents = new Set(parentSceneIds(content, nodeId));
  const option = (node: BranchingNode, role: "previous" | "setting"): ImageReferenceOption => ({
    key: `${role}:${node.id}`,
    role,
    label: `Scene: ${sceneDisplayName(content, node)}`,
    thumbnailUrl: node.image!.url,
    url: node.image!.url,
    selected: false,
  });
  return {
    suggested: content.nodes
      .filter(node => parents.has(node.id) && hasImage(node))
      .map(node => option(node, "previous")),
    available: content.nodes
      .filter(node => node.id !== nodeId && !parents.has(node.id) && hasImage(node))
      .map(node => option(node, "setting")),
  };
};

/** Scenes with no picture yet, in the order the author wrote them. */
export const emptyScenes = (content: BranchingScenarioContent): BranchingNode[] =>
  content.nodes.filter(node => !hasImage(node));

export const sceneContext = (node: BranchingNode, courseTitle?: string): ImageContext => ({
  ...(node.title?.trim() ? { title: node.title.trim() } : {}),
  ...(node.text?.trim() ? { text: node.text.trim().slice(0, SCENE_TEXT_MAX_CHARS) } : {}),
  ...(courseTitle?.trim() ? { courseTitle: courseTitle.trim() } : {}),
});

/** "Fill empty scenes" describes each scene by its own title and text. */
export const sceneDescription = (node: BranchingNode): string => {
  const title = node.title?.trim();
  const text = node.text?.trim() ?? "";
  const joined = title ? (text ? `${title}. ${text}` : title) : text;
  return joined.slice(0, DESCRIPTION_MAX_CHARS);
};

/** One request per empty scene, for `POST /estimate` and `POST /jobs/batch`. */
export const buildFillSceneRequests = ({
  content,
  nodes,
  trackId,
  itemId,
  styleId,
  courseTitle,
}: {
  content: BranchingScenarioContent;
  nodes: BranchingNode[];
  trackId?: string | null;
  itemId: string;
  styleId: string;
  courseTitle?: string;
}): GenerateImageRequest[] => {
  const castIds = (content.imageCast ?? []).map(member => member.characterId);
  return nodes
    .filter(node => sceneDescription(node).length >= 3)
    .map(node => ({
      slotKind: "scene",
      slotKey: sceneSlotKey(trackId, itemId, node.id),
      styleId,
      description: sceneDescription(node),
      variants: 1,
      ...(castIds.length > 0 ? { castCharacterIds: castIds } : {}),
      context: sceneContext(node, courseTitle),
    }));
};
