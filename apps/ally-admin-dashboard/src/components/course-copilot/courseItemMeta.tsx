import type { ComponentType } from "react";

import { Book, Chat, Document, Edit, Flag, GroupBranch, McqBlock, Play, VideoCamera } from "@icons";

import { TRACK_ITEM_TYPE_LABELS } from "@constants";
import type { CourseItemType, TrackItemType } from "@types";

/**
 * Item-type presentation for the work pane. Labels come from CreateTrack's own
 * `TRACK_ITEM_TYPE_LABELS` (so a "Quiz" here is the same word the editor uses, and
 * ANNOTATED_ARTIFACT reads "Annotation" in both places). CreateTrack has no
 * per-type icon, so the glyphs below are the pane's own — decorative only, the
 * label always travels with them.
 */
export const getItemTypeLabel = (type: CourseItemType): string =>
  TRACK_ITEM_TYPE_LABELS[type as TrackItemType] ?? type;

type IconComponent = ComponentType<{ className?: string }>;

const ITEM_TYPE_ICONS: Record<CourseItemType, IconComponent> = {
  ROLEPLAY: Chat,
  CASE: GroupBranch,
  QUIZ: McqBlock,
  ARTICLE: Document,
  VIDEO: VideoCamera,
  JOURNAL: Book,
  ANNOTATED_ARTIFACT: Edit,
  GAME: Play,
  BRANCHING_SCENARIO: GroupBranch,
  BUCKET_SORT: GroupBranch,
};

export const getItemTypeIcon = (type: CourseItemType): IconComponent =>
  ITEM_TYPE_ICONS[type] ?? Flag;

/** The types the trainer can switch an item to in the tree — content the pane can regenerate from a title alone. */
export const INLINE_ITEM_TYPES: CourseItemType[] = [
  "ARTICLE",
  "QUIZ",
  "JOURNAL",
  "ANNOTATED_ARTIFACT",
  "GAME",
];

/** Types offered by "Add item". VIDEO joins the inline types but needs a link before it can be built. */
export const ADDABLE_ITEM_TYPES: CourseItemType[] = [...INLINE_ITEM_TYPES, "VIDEO"];

/**
 * Whether the tree lets the trainer change this item's type. ROLEPLAY and CASE
 * carry library references or a persona brief that a type switch would silently
 * throw away, so they are changed by asking the copilot (or removed and re-added
 * through chat). VIDEO can become an inline type but is never a switch target.
 */
export const canChangeItemType = (type: CourseItemType): boolean =>
  INLINE_ITEM_TYPES.includes(type) || type === "VIDEO";
