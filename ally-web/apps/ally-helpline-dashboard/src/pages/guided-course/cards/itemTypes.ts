import type { GuideCardPresentation, GuideItemType } from "../contract/wire";

/** How intense an item is; sets the pacing defaults and the celebration ceiling. */
export type ItemTension = "low" | "medium" | "high";

/** Which glyph the type row draws (see `CardGlyph`). */
export type ItemGlyph =
  | "page"
  | "play"
  | "check"
  | "pen"
  | "fork"
  | "trays"
  | "speech"
  | "folder"
  | "highlighter"
  | "spark";

/**
 * Facts about each course item type that never change at runtime (card
 * grammar §3). Kept free of React so the bootstrap adapter, the Spine model
 * and the registry can all read it without import cycles.
 *
 * `typeWordKey` reuses the classic course's `tracks2.meta.*` words so classic
 * and guided name things the same way.
 */
export interface ItemTypeFacts {
  /** Fixed per type (decision 13): inline, Shelf or Theatre. */
  presentation: GuideCardPresentation;
  /** Shelf width when `presentation` is `shelf`. */
  shelfWidth?: "reading" | "utility";
  tension: ItemTension;
  /** A chapter's high-stakes practice (roleplay or case). */
  boss: boolean;
  glyph: ItemGlyph;
  typeWordKey: string;
  /** The one verb on the card's primary action. */
  verbKey: string;
}

export const ITEM_TYPE_FACTS: Record<GuideItemType, ItemTypeFacts> = {
  ARTICLE: {
    presentation: "shelf",
    shelfWidth: "reading",
    tension: "low",
    boss: false,
    glyph: "page",
    typeWordKey: "tracks2.meta.article",
    verbKey: "guide.card.verb.read",
  },
  VIDEO: {
    presentation: "shelf",
    shelfWidth: "reading",
    tension: "low",
    boss: false,
    glyph: "play",
    typeWordKey: "tracks2.meta.video",
    verbKey: "guide.card.verb.watch",
  },
  QUIZ: {
    presentation: "inline",
    tension: "medium",
    boss: false,
    glyph: "check",
    typeWordKey: "tracks2.meta.quiz",
    verbKey: "guide.card.verb.start",
  },
  JOURNAL: {
    presentation: "inline",
    tension: "low",
    boss: false,
    glyph: "pen",
    typeWordKey: "tracks2.meta.journal",
    verbKey: "guide.card.verb.write",
  },
  BRANCHING_SCENARIO: {
    presentation: "inline",
    tension: "medium",
    boss: false,
    glyph: "fork",
    typeWordKey: "tracks2.meta.branching",
    verbKey: "guide.card.verb.start",
  },
  BUCKET_SORT: {
    presentation: "shelf",
    shelfWidth: "utility",
    tension: "medium",
    boss: false,
    glyph: "trays",
    typeWordKey: "tracks2.meta.bucketSort",
    verbKey: "guide.card.verb.sort",
  },
  ROLEPLAY: {
    presentation: "theatre",
    tension: "high",
    boss: true,
    glyph: "speech",
    typeWordKey: "tracks2.meta.roleplay",
    verbKey: "guide.card.verb.openCall",
  },
  CASE: {
    presentation: "theatre",
    tension: "high",
    boss: true,
    glyph: "folder",
    typeWordKey: "tracks2.meta.case",
    verbKey: "guide.card.verb.openCase",
  },
  ANNOTATED_ARTIFACT: {
    presentation: "theatre",
    tension: "medium",
    boss: false,
    glyph: "highlighter",
    typeWordKey: "tracks2.meta.annotationTranscript",
    verbKey: "guide.card.verb.openTranscript",
  },
  GAME: {
    presentation: "theatre",
    tension: "low",
    boss: false,
    glyph: "spark",
    typeWordKey: "tracks2.meta.game",
    verbKey: "guide.card.verb.play",
  },
};

export const factsFor = (type: GuideItemType): ItemTypeFacts => ITEM_TYPE_FACTS[type];
