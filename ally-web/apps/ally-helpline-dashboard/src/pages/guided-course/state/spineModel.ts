/**
 * The Course map (internally the Spine): chapters and their items, which one
 * is current, what's done. Built from bootstrap's spine and kept honest by
 * the stream: `spine.updated` moves the current item and the counts, and a
 * course card turning `done` fills its node at once.
 *
 * The client never unlocks anything on its own. An item is `current` only
 * when the server says so (`spine.updated.currentItemId`) or, before any
 * update, when bootstrap marked it available.
 */
import type { GuideCard, GuideItemType } from "@types/generated/guide-contract";

import type { JourneySpineSection, SpineItemState } from "../contract/bootstrap";

export type SpineNodeState = SpineItemState | "current";

export interface SpineNode {
  id: string;
  sectionId: string;
  type: GuideItemType;
  title: string;
  state: SpineNodeState;
  boss: boolean;
  minutes: number | null;
  hasWarnings: boolean;
  /** Optional practice finished beside this item (a pip on the map). */
  practicePips: number;
}

export interface SpineChapter {
  id: string;
  index: number;
  title: string;
  nodes: SpineNode[];
  completed: number;
  total: number;
  current: boolean;
  done: boolean;
  hasWarnings: boolean;
}

export interface SpineModel {
  chapters: SpineChapter[];
  currentItemId: string | null;
  currentChapterId: string | null;
  completed: number;
  total: number;
  /** 0–100, for the progress line. */
  percent: number;
}

export interface SpineProgress {
  currentItemId: string | null;
  completedItems: number;
  totalItems: number;
}

export interface BuildSpineInput {
  sections: JourneySpineSection[];
  progress?: SpineProgress | null;
  cards?: Record<string, GuideCard>;
}

/** Item ids whose course card the server has marked done, plus practice pips per item. */
const cardSignals = (cards: Record<string, GuideCard> = {}) => {
  const done = new Set<string>();
  const pips = new Map<string, number>();
  for (const card of Object.values(cards)) {
    const itemId = card.trackItem?.id;
    if (!itemId) continue;
    if (card.kind === "course_item" && card.state === "done") done.add(itemId);
    if (card.kind === "micro_activity" && card.state === "done") {
      pips.set(itemId, (pips.get(itemId) ?? 0) + 1);
    }
  }
  return { done, pips };
};

export const buildSpineModel = ({ sections, progress, cards }: BuildSpineInput): SpineModel => {
  const { done, pips } = cardSignals(cards);

  // Before the server names a current item, it is the first open one.
  let currentItemId = progress?.currentItemId ?? null;
  if (!progress) {
    outer: for (const section of sections) {
      for (const item of section.items) {
        if (item.state === "available" && !done.has(item.id)) {
          currentItemId = item.id;
          break outer;
        }
      }
    }
  }

  let currentChapterId: string | null = null;
  const chapters = sections.map((section, index) => {
    const nodes = section.items.map<SpineNode>(item => {
      let state: SpineNodeState = item.state;
      if (done.has(item.id)) state = "done";
      else if (item.id === currentItemId) state = "current";
      if (item.id === currentItemId) currentChapterId = section.id;
      return {
        id: item.id,
        sectionId: section.id,
        type: item.type,
        title: item.title,
        state,
        boss: item.boss,
        minutes: item.minutes,
        hasWarnings: item.hasWarnings,
        practicePips: pips.get(item.id) ?? 0,
      };
    });
    const completed = nodes.filter(node => node.state === "done").length;
    return {
      id: section.id,
      index,
      title: section.title,
      nodes,
      completed,
      total: nodes.length,
      current: false,
      done: nodes.length > 0 && completed === nodes.length,
      hasWarnings: nodes.some(node => node.hasWarnings),
    };
  });
  for (const chapter of chapters) chapter.current = chapter.id === currentChapterId;

  const counted = chapters.reduce((sum, chapter) => sum + chapter.completed, 0);
  const totalNodes = chapters.reduce((sum, chapter) => sum + chapter.total, 0);
  const total = progress?.totalItems || totalNodes;
  // The server's count wins, but a node the learner just finished counts at once.
  const completed = Math.min(total, Math.max(progress?.completedItems ?? 0, counted));

  return {
    chapters,
    currentItemId,
    currentChapterId,
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
};

/** The node an item id points at, for "Ask about this", the dock and scroll-to. */
export const findNode = (
  model: SpineModel,
  itemId: string | null | undefined,
): SpineNode | null => {
  if (!itemId) return null;
  for (const chapter of model.chapters) {
    const node = chapter.nodes.find(n => n.id === itemId);
    if (node) return node;
  }
  return null;
};

/** Whether the chapter holding `sectionId` carries trigger warnings. */
export const chapterHasWarnings = (model: SpineModel, sectionId: string | null): boolean =>
  Boolean(sectionId && model.chapters.find(chapter => chapter.id === sectionId)?.hasWarnings);
