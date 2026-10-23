/**
 * Which component renders which card. Ally chooses which card appears, never
 * how it is laid out (Stacks: "Generative UI Design Challenges and
 * Constraints"): every item type has one fixed presentation and one adapter
 * around the classic player, and every special card kind has one renderer.
 *
 * Players are lazy so the journey's first load stays inside the performance
 * budget (plan §5.13); a card only pulls its player when it opens.
 */
import { ComponentType, lazy, LazyExoticComponent } from "react";

import { ITEM_TYPE_FACTS, ItemTypeFacts } from "./itemTypes";

import type { GuideCardKind, GuideItemType } from "../contract/wire";
import type { ItemAdapterProps } from "./items/types";

type AnyAdapter = ComponentType<ItemAdapterProps<any>>;

export interface ItemCardEntry extends ItemTypeFacts {
  Adapter: LazyExoticComponent<AnyAdapter>;
}

const RoleplayAdapter = lazy(() => import("./items/RoleplayAdapter"));

export const ITEM_CARD_REGISTRY: Record<GuideItemType, ItemCardEntry> = {
  ARTICLE: { ...ITEM_TYPE_FACTS.ARTICLE, Adapter: lazy(() => import("./items/ArticleAdapter")) },
  VIDEO: { ...ITEM_TYPE_FACTS.VIDEO, Adapter: lazy(() => import("./items/VideoAdapter")) },
  QUIZ: { ...ITEM_TYPE_FACTS.QUIZ, Adapter: lazy(() => import("./items/QuizAdapter")) },
  JOURNAL: { ...ITEM_TYPE_FACTS.JOURNAL, Adapter: lazy(() => import("./items/JournalAdapter")) },
  BRANCHING_SCENARIO: {
    ...ITEM_TYPE_FACTS.BRANCHING_SCENARIO,
    Adapter: lazy(() => import("./items/BranchingAdapter")),
  },
  BUCKET_SORT: {
    ...ITEM_TYPE_FACTS.BUCKET_SORT,
    Adapter: lazy(() => import("./items/BucketSortAdapter")),
  },
  ROLEPLAY: { ...ITEM_TYPE_FACTS.ROLEPLAY, Adapter: RoleplayAdapter },
  CASE: { ...ITEM_TYPE_FACTS.CASE, Adapter: RoleplayAdapter },
  ANNOTATED_ARTIFACT: {
    ...ITEM_TYPE_FACTS.ANNOTATED_ARTIFACT,
    Adapter: lazy(() => import("./items/AnnotationAdapter")),
  },
  GAME: { ...ITEM_TYPE_FACTS.GAME, Adapter: lazy(() => import("./items/GameAdapter")) },
};

export const itemCardFor = (
  type: GuideItemType | string | null | undefined,
): ItemCardEntry | null =>
  type && type in ITEM_CARD_REGISTRY ? ITEM_CARD_REGISTRY[type as GuideItemType] : null;

/**
 * How each card kind is drawn. `course_item` goes through the item registry
 * above; the rest are fixed components in `cards/special/`. `pinned` cards
 * leave the scene flow (the crisis card sits above the conversation).
 */
export type SpecialCardRenderer =
  | "item"
  | "course_info"
  | "micro_activity"
  | "chapter_title"
  | "scene_receipt"
  | "closing_ritual"
  | "finale"
  | "resource"
  | "crisis"
  | "sign_in"
  | "access_denied";

export const CARD_KIND_RENDERER: Record<
  GuideCardKind,
  { renderer: SpecialCardRenderer; pinned?: boolean }
> = {
  course_item: { renderer: "item" },
  course_info: { renderer: "course_info" },
  micro_activity: { renderer: "micro_activity" },
  chapter_title: { renderer: "chapter_title" },
  scene_receipt: { renderer: "scene_receipt" },
  closing_ritual: { renderer: "closing_ritual" },
  finale: { renderer: "finale" },
  resource: { renderer: "resource" },
  crisis_resources: { renderer: "crisis", pinned: true },
  sign_in: { renderer: "sign_in" },
  access_denied: { renderer: "access_denied" },
};
