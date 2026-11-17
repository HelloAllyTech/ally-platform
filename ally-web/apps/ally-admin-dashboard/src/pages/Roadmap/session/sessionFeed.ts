import type { BuilderChatMessage, BuilderServerMessage } from "@types";

import type { RoadmapConversationPost } from "../../../types/roadmapV2Flow";

/**
 * Pure helpers that fit P3b's posts into the builder transcript the conversation already renders.
 */

/** An answer, comment or choice row (P3 contract: `metadata.planPost`); drawn as cards, not turns. */
export const isPlanPost = (message: BuilderServerMessage): boolean =>
  !!(message.metadata as { planPost?: unknown } | null | undefined)?.planPost;

/** The server row a feed item came from: `srv_<id>` or `srv_<id>_q_<questionId>` / `_brief_…`. */
export const serverIdOf = (feedId: string): string => {
  const rest = feedId.startsWith("srv_") ? feedId.slice(4) : feedId;
  const cut = rest.search(/_(q|brief)_/);
  return cut === -1 ? rest : rest.slice(0, cut);
};

/**
 * Where each comment goes: before the first feed item written after it (keyed by that item's id),
 * or at the end (key `null`). Comments keep their own order.
 */
export const commentAnchors = (
  feed: BuilderChatMessage[],
  meta: Map<string, { createdAt?: string }>,
  comments: RoadmapConversationPost[],
): Map<string | null, RoadmapConversationPost[]> => {
  const anchors = new Map<string | null, RoadmapConversationPost[]>();
  const times = feed.map(message => {
    const at = meta.get(serverIdOf(message.id))?.createdAt ?? meta.get(message.id)?.createdAt;
    const t = at ? new Date(at).getTime() : NaN;
    return Number.isNaN(t) ? null : t;
  });
  comments.forEach(post => {
    const at = new Date(post.at).getTime();
    let key: string | null = null;
    if (!Number.isNaN(at)) {
      const index = times.findIndex(t => t !== null && t > at);
      if (index !== -1) key = feed[index].id;
    }
    const list = anchors.get(key) ?? [];
    list.push(post);
    anchors.set(key, list);
  });
  return anchors;
};

/**
 * Phase markers (contract: rows with `metadata.planStage === 'idea'` are the idea interview; the
 * first row after Start planning begins the plan interview). The feed index where the plan
 * interview begins, or -1 when the conversation hasn't moved past the idea interview.
 */
export const planStartFeedIndex = (
  feed: BuilderChatMessage[],
  serverMessages: BuilderServerMessage[],
): number => {
  const ideaRows = new Set(
    serverMessages
      .filter(m => (m.metadata as { planStage?: unknown } | null | undefined)?.planStage === "idea")
      .map(m => m.id),
  );
  if (ideaRows.size === 0) return -1;
  let seenIdea = false;
  for (let i = 0; i < feed.length; i += 1) {
    const id = serverIdOf(feed[i].id);
    if (ideaRows.has(id)) seenIdea = true;
    else if (seenIdea) return i;
  }
  return -1;
};
