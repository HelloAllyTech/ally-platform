/**
 * The one file that knows what the server's bootstrap looks like.
 *
 * Everything else in the journey reads `JourneyBootstrap`, a view shaped for
 * the UI. Two sources produce it:
 *
 * 1. `fromBootstrapWire`: `GET /v1/guide/tracks/:trackId/bootstrap`, the
 *    contract's generated `GuideBootstrap` (plan §9.1).
 * 2. `composeBootstrap`: the endpoints that existed before bootstrap (public
 *    availability, the thread, the classic course detail and access check).
 *    Used when the bootstrap route 404s, so the journey also runs against an
 *    older backend. It carries no cards or scenes: the caller replays the
 *    thread's event log from seq 0 to rebuild them.
 */
import { TrackAccessDenialReason, TrackDetail, TrackItemStatus, TrackItemType } from "@types";

import { ITEM_TYPE_FACTS, ItemTension } from "../cards/itemTypes";

import type {
  GuideAtmosphere,
  GuideBootstrap,
  GuideCard,
  GuideCrisisState,
  GuideItemType,
  GuideMode,
  GuideSceneView,
} from "./wire";

/** The wire shape, generated from ally-be's schema. */
export type GuideBootstrapWire = GuideBootstrap;

/** The guidance dial (plan §5.7): Lead me · Walk with me · I'll drive. */
export type GuidanceLevel = "lead" | "walk" | "drive";
export const GUIDANCE_LEVELS: readonly GuidanceLevel[] = ["lead", "walk", "drive"];
export const DEFAULT_GUIDANCE: GuidanceLevel = "walk";

export type SpineItemState = "locked" | "available" | "done";

export interface JourneySpineItem {
  id: string;
  type: GuideItemType;
  title: string;
  state: SpineItemState;
  minutes: number | null;
  /** A chapter's roleplay or case. */
  boss: boolean;
  tension: ItemTension;
  /** The item carries trigger warnings, so its scene is hushed (plan §5.9). */
  hasWarnings: boolean;
}

export interface JourneySpineSection {
  id: string;
  title: string;
  items: JourneySpineItem[];
}

export interface JourneyHistoryMessage {
  id: string;
  seq: number;
  role: "learner" | "ally" | "system_note";
  kind: string;
  text: string;
  turnId: string | null;
  createdAt: string | null;
  interrupted?: boolean;
}

export interface JourneyNextStep {
  hidden: boolean;
  itemId: string | null;
  title: string | null;
  minutes: number | null;
}

export interface JourneyThread {
  id: string;
  mode: GuideMode;
  atmosphere: GuideAtmosphere;
  lastEventSeq: number;
}

export interface JourneyAvailability {
  guided: boolean;
  anonymousChat: boolean;
  voice: boolean;
  languages: string[];
  reason: string | null;
}

export interface JourneyAccess {
  hasAccess: boolean;
  enrolled: boolean;
  reason: TrackAccessDenialReason | null;
}

export interface JourneyCourse {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  estimatedMinutes: number | null;
  languageCode: string | null;
}

/** Where the learner is, as the server last said (the Spine's starting point). */
export interface JourneyProgress {
  currentItemId: string | null;
  completedItems: number;
  totalItems: number;
}

/** A card as bootstrap returns it: the contract card plus where it sits. */
export type JourneyCard = GuideCard & { seq?: number | null };

export interface JourneyBootstrap {
  availability: JourneyAvailability;
  access: JourneyAccess;
  thread: JourneyThread | null;
  course: JourneyCourse;
  spine: JourneySpineSection[];
  progress: JourneyProgress | null;
  /** Oldest first. */
  messages: JourneyHistoryMessage[];
  /** Oldest first. */
  cards: JourneyCard[];
  prefs: { guidance: GuidanceLevel };
  nextStep: JourneyNextStep | null;
  /** While the thread is in CRISIS: the fixed message and lines, so the card survives a reload. */
  crisis: GuideCrisisState | null;
  /** A visitor's remaining messages before sign-in (absent for learners). */
  allowance: { remaining: number; limit: number } | null;
  /** Chapter scenes, oldest first, so a reload regroups the feed (empty from an older server). */
  scenes: GuideSceneView[];
  /**
   * Whether `messages` and `cards` already describe the thread up to
   * `thread.lastEventSeq`. False for the composed fallback, which has no
   * cards: the stream must then replay from seq 0.
   */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Source 1: GET /v1/guide/tracks/:trackId/bootstrap
// ---------------------------------------------------------------------------

const spineState = (state: string): SpineItemState =>
  state === "completed" ? "done" : state === "available" ? "available" : "locked";

const asGuidance = (value: unknown): GuidanceLevel =>
  GUIDANCE_LEVELS.includes(value as GuidanceLevel) ? (value as GuidanceLevel) : DEFAULT_GUIDANCE;

const asDenial = (reason: string | null | undefined): TrackAccessDenialReason | null =>
  reason && Object.values(TrackAccessDenialReason).includes(reason as TrackAccessDenialReason)
    ? (reason as TrackAccessDenialReason)
    : null;

/**
 * Reads the bootstrap defensively: a missing or malformed part reads as "no"
 * (not guided, no access), so a bad payload fails closed to classic.
 */
export const fromBootstrapWire = (trackId: string, wire: GuideBootstrapWire): JourneyBootstrap => {
  const { availability, access, thread, course, spine } = wire;
  return {
    availability: {
      guided: availability?.guided === true,
      anonymousChat: availability?.anonymousChat === true,
      voice: availability?.voice === true,
      languages: availability?.languages ?? [],
      reason: availability?.reason ?? null,
    },
    access: {
      hasAccess: access?.hasAccess ?? false,
      enrolled: access?.enrolled ?? false,
      reason: asDenial(access?.reason),
    },
    thread: thread
      ? {
          id: thread.id,
          mode: thread.mode,
          atmosphere: thread.atmosphere,
          lastEventSeq: thread.lastEventSeq,
        }
      : null,
    course: {
      id: course?.id ?? trackId,
      title: course?.title ?? "",
      description: course?.description ?? null,
      coverImageUrl: course?.coverImageUrl ?? null,
      estimatedMinutes: course?.estimatedMinutes ?? null,
      languageCode: course?.languageCode ?? null,
    },
    spine: (spine?.sections ?? []).map(section => ({
      id: section.id,
      title: section.title,
      items: (section.items ?? []).map(item => ({
        id: item.id,
        type: item.type,
        title: item.title,
        state: spineState(item.state),
        minutes: item.minutes ?? null,
        boss: item.boss ?? ITEM_TYPE_FACTS[item.type]?.boss ?? false,
        tension: item.tension ?? ITEM_TYPE_FACTS[item.type]?.tension ?? "low",
        hasWarnings: item.hasWarnings ?? false,
      })),
    })),
    progress: spine
      ? {
          currentItemId: spine.currentItemId,
          completedItems: spine.completed,
          totalItems: spine.total,
        }
      : null,
    messages: (wire.messages ?? []).map(message => ({
      id: message.id,
      seq: message.seq,
      role: message.role,
      kind: message.kind,
      text: message.text ?? "",
      turnId: message.turnId ?? null,
      createdAt: message.createdAt,
      interrupted: message.interrupted ?? false,
    })),
    cards: (wire.cards ?? []).map(({ seq, card }) => ({ ...card, seq })),
    prefs: { guidance: asGuidance(wire.prefs?.guidance) },
    nextStep: wire.nextStep
      ? {
          hidden: wire.nextStep.hidden,
          itemId: wire.nextStep.itemId ?? null,
          title: wire.nextStep.title ?? null,
          minutes: wire.nextStep.minutes ?? null,
        }
      : null,
    crisis: wire.crisis ?? null,
    allowance: wire.allowance ?? null,
    scenes: Array.isArray(wire.scenes) ? wire.scenes : [],
    complete: true,
  };
};

// ---------------------------------------------------------------------------
// Source 2: composed from the pre-bootstrap endpoints
// ---------------------------------------------------------------------------

export interface ComposeBootstrapInput {
  trackId: string;
  availability: Partial<JourneyAvailability>;
  access: JourneyAccess;
  thread: JourneyThread | null;
  detail: TrackDetail | null;
  guidance?: GuidanceLevel | null;
}

const minutesFor = (item: TrackDetail["sections"][number]["items"][number]): number | null => {
  const seconds = item.contentMeta?.durationSeconds;
  return item.type === TrackItemType.VIDEO && seconds
    ? Math.max(1, Math.round(seconds / 60))
    : null;
};

const firstOpenItem = (detail: TrackDetail) => {
  for (const section of detail.sections) {
    for (const item of section.items) {
      if (item.status === TrackItemStatus.UNLOCKED) return item;
    }
  }
  return null;
};

export const composeBootstrap = ({
  trackId,
  availability,
  access,
  thread,
  detail,
  guidance,
}: ComposeBootstrapInput): JourneyBootstrap => {
  const next = detail ? firstOpenItem(detail) : null;
  return {
    availability: {
      guided: availability.guided ?? false,
      anonymousChat: availability.anonymousChat ?? false,
      voice: availability.voice ?? false,
      languages: availability.languages ?? [],
      reason: availability.reason ?? null,
    },
    access,
    thread,
    course: {
      id: detail?.id ?? trackId,
      title: detail?.title ?? "",
      description: detail?.description ?? null,
      coverImageUrl: detail?.coverImageUrl ?? null,
      estimatedMinutes: detail?.estimatedDurationMinutes ?? null,
      languageCode: detail?.languageCode ?? null,
    },
    spine: (detail?.sections ?? []).map(section => ({
      id: section.id,
      title: section.title,
      items: section.items.map(item => {
        const type = item.type as GuideItemType;
        const facts = ITEM_TYPE_FACTS[type];
        return {
          id: item.id,
          type,
          title: item.title,
          state:
            item.status === TrackItemStatus.COMPLETED
              ? "done"
              : item.status === TrackItemStatus.UNLOCKED
                ? "available"
                : "locked",
          minutes: minutesFor(item),
          boss: facts?.boss ?? false,
          tension: facts?.tension ?? "low",
          hasWarnings: false,
        };
      }),
    })),
    progress: null,
    crisis: null,
    allowance: null,
    scenes: [],
    messages: [],
    cards: [],
    prefs: { guidance: asGuidance(guidance) },
    nextStep: next
      ? { hidden: false, itemId: next.id, title: next.title, minutes: minutesFor(next) }
      : null,
    complete: false,
  };
};
