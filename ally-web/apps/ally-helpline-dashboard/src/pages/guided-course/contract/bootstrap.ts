/**
 * The one file that knows what the server's bootstrap looks like.
 *
 * Everything else in the journey reads `JourneyBootstrap`, a view shaped for
 * the UI. Two sources produce it:
 *
 * 1. `fromBootstrapWire`: `GET /v1/guide/tracks/:trackId/bootstrap`, the
 *    contract's `GuideBootstrap` (plan §9.1). `GuideBootstrapWire` below is a
 *    local, deliberately permissive copy of that shape; when the generated
 *    type lands in `types/generated/guide-contract.ts`, replace the interface
 *    with an import and nothing outside this file changes.
 * 2. `composeBootstrap`: the endpoints that existed before bootstrap (public
 *    availability, the thread, the classic course detail and access check).
 *    Used when the bootstrap route 404s, so the journey also runs against an
 *    older backend. It carries no cards or scenes: the caller replays the
 *    thread's event log from seq 0 to rebuild them.
 */
import { TrackAccessDenialReason, TrackDetail, TrackItemStatus, TrackItemType } from "@types";

import { ITEM_TYPE_FACTS, ItemTension } from "../cards/itemTypes";

import type { GuideAtmosphere, GuideCard, GuideItemType, GuideMode } from "./wire";

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

/** A card as bootstrap returns it: the contract card plus where it sits. */
export type JourneyCard = GuideCard & { seq?: number | null };

export interface JourneyBootstrap {
  availability: JourneyAvailability;
  access: JourneyAccess;
  thread: JourneyThread | null;
  course: JourneyCourse;
  spine: JourneySpineSection[];
  /** Oldest first. */
  messages: JourneyHistoryMessage[];
  /** Oldest first. */
  cards: JourneyCard[];
  prefs: { guidance: GuidanceLevel };
  nextStep: JourneyNextStep | null;
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

/** Local copy of the contract's `GuideBootstrap`; see the file header. */
export interface GuideBootstrapWire {
  availability?: Partial<JourneyAvailability> | null;
  access?: Partial<JourneyAccess> | null;
  thread?: Partial<JourneyThread> | null;
  course?: Partial<JourneyCourse> & { estimatedDurationMinutes?: number | null };
  spine?: {
    sections?: Array<{
      id: string;
      title: string;
      items?: Array<Partial<JourneySpineItem> & { id: string; type: GuideItemType }>;
    }>;
  } | null;
  messages?: Array<Partial<JourneyHistoryMessage> & { id: string }> | null;
  cards?: JourneyCard[] | null;
  prefs?: { guidance?: GuidanceLevel | null } | null;
  nextStep?: JourneyNextStep | null;
}

const SPINE_STATES: readonly SpineItemState[] = ["locked", "available", "done"];

const asSpineState = (value: unknown): SpineItemState => {
  const lower = typeof value === "string" ? value.toLowerCase() : "";
  if (SPINE_STATES.includes(lower as SpineItemState)) return lower as SpineItemState;
  // Server spellings for "can be opened now".
  if (lower === "unlocked" || lower === "current" || lower === "in_progress") return "available";
  if (lower === "completed") return "done";
  return "locked";
};

const asGuidance = (value: unknown): GuidanceLevel =>
  GUIDANCE_LEVELS.includes(value as GuidanceLevel) ? (value as GuidanceLevel) : DEFAULT_GUIDANCE;

export const fromBootstrapWire = (trackId: string, wire: GuideBootstrapWire): JourneyBootstrap => {
  const availability = wire.availability ?? {};
  const access = wire.access ?? {};
  const course = wire.course ?? {};
  const thread =
    wire.thread && wire.thread.id
      ? {
          id: wire.thread.id,
          mode: wire.thread.mode ?? "NORMAL",
          atmosphere: wire.thread.atmosphere ?? "bright",
          lastEventSeq: wire.thread.lastEventSeq ?? 0,
        }
      : null;

  return {
    availability: {
      guided: availability.guided ?? false,
      anonymousChat: availability.anonymousChat ?? false,
      voice: availability.voice ?? false,
      languages: availability.languages ?? [],
      reason: availability.reason ?? null,
    },
    access: {
      hasAccess: access.hasAccess ?? false,
      enrolled: access.enrolled ?? false,
      reason: access.reason ?? null,
    },
    thread,
    course: {
      id: course.id ?? trackId,
      title: course.title ?? "",
      description: course.description ?? null,
      coverImageUrl: course.coverImageUrl ?? null,
      estimatedMinutes: course.estimatedMinutes ?? course.estimatedDurationMinutes ?? null,
      languageCode: course.languageCode ?? null,
    },
    spine: (wire.spine?.sections ?? []).map(section => ({
      id: section.id,
      title: section.title,
      items: (section.items ?? []).map(item => {
        const facts = ITEM_TYPE_FACTS[item.type];
        return {
          id: item.id,
          type: item.type,
          title: item.title ?? "",
          state: asSpineState(item.state),
          minutes: item.minutes ?? null,
          boss: item.boss ?? facts?.boss ?? false,
          tension: item.tension ?? facts?.tension ?? "low",
          hasWarnings: item.hasWarnings ?? false,
        };
      }),
    })),
    messages: (wire.messages ?? []).map((message, index) => ({
      id: message.id,
      seq: message.seq ?? index,
      role: message.role ?? "ally",
      kind: message.kind ?? "chat",
      text: message.text ?? "",
      turnId: message.turnId ?? null,
      createdAt: message.createdAt ?? null,
    })),
    cards: wire.cards ?? [],
    prefs: { guidance: asGuidance(wire.prefs?.guidance) },
    nextStep: wire.nextStep ?? null,
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
    messages: [],
    cards: [],
    prefs: { guidance: asGuidance(guidance) },
    nextStep: next
      ? { hidden: false, itemId: next.id, title: next.title, minutes: minutesFor(next) }
      : null,
    complete: false,
  };
};
