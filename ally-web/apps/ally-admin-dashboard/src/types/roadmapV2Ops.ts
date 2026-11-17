/**
 * Roadmap v2, P4 and P5 shapes: the build brief (D18, §4.5b), the Roadmap role radio (§3.2), the
 * weekly digest preference (§5.7b), the release plan behind the release dialog (P5, §5.5), and the
 * roadmap fields on Builder's settings (P0). Source of truth: ally-be's P4 controllers and DTOs
 * (`product-roadmap/item/roadmap-build.dto.ts`, `roadmap-people.controller.ts`,
 * `roadmap-item-build.service.ts`) and P5's `roadmap-release.controller.ts`.
 */
import type { RoadmapRole } from "./roadmapV2";

/** `GET /v1/roadmap/items/:code/brief`. Built from an allowlist; never strategy, spend or the transcript. */
export interface RoadmapBuildBrief {
  /** "OPP-0388". */
  code: string;
  /** The whole brief: what Preview brief shows and Copy brief copies. */
  markdown: string;
  /** `markdown.length`, in characters. */
  length: number;
  /** length <= 14000: it fits a claude:// deep link whole; otherwise download it and send a short prompt. */
  fitsDeepLink: boolean;
  /** "OPP-0388-brief.md". */
  filename: string;
  /** "opp-0388-short-title-slug". */
  branch: string;
  /** "OPP-0388: Title". */
  prTitle: string;
}

/** The radio's values; Viewer is never granted, it is what an org-restricted admin gets. */
export type RoadmapGrantableRole = "none" | "idea" | "builder" | "owner";

export interface RoadmapRoleEntry {
  userId: number;
  name: string;
  /** Effective now: 'viewer' for an org-restricted admin whatever the radio says. */
  role: RoadmapRole;
  /** Org-restricted: a Viewer at most. */
  restricted: boolean;
  /** What the three toggles say: the radio's value. */
  setting: RoadmapGrantableRole;
}

export interface RoadmapPreferences {
  /** "Your ideas this week" by email on Mondays. Off until turned on. */
  weeklyDigest: boolean;
}

/** The services the release policy plans and releases (mobile ships through the stores). */
export type RoadmapReleaseService = "be" | "ai" | "learn" | "frontend";

export const ROADMAP_RELEASE_SERVICES: RoadmapReleaseService[] = ["be", "ai", "learn", "frontend"];

/** One commit a release would ship. */
export interface RoadmapReleaseCommit {
  sha: string;
  title: string;
  authorLogin: string | null;
  committedAt: string;
  prNumber: number | null;
  /** A pull request's merge commit; its changes are the branch commits beside it. */
  merge: boolean;
  /** One of its files matched a held path. */
  held: boolean;
}

/** Why a release is held: which file of which commit matched which rule. */
export interface RoadmapHeldReason {
  sha: string;
  file: string;
  rule: string;
}

export type RoadmapReleaseDecision =
  | "release"
  | "held"
  | "paused"
  | "debouncing"
  | "outside_window"
  | "waiting_backend"
  | "nothing"
  | "unknown";

/** `GET /v1/roadmap/release/plan?service=` (P5's ReleasePlanView). */
export interface RoadmapReleasePlan {
  service: RoadmapReleaseService;
  /** Which dashboards a frontend release ships in; null for a backend. */
  apps: string | null;
  baseTag: string | null;
  baseRef: string | null;
  headSha: string | null;
  /** Echo it back on Release: refused (409) if more landed since. */
  serviceHeadSha: string | null;
  /** The tag a release would take now. */
  nextTag: string | null;
  commits: RoadmapReleaseCommit[];
  heldReasons: RoadmapHeldReason[];
  held: boolean;
  opportunityIds: string[];
  /** Set when GitHub would not list the whole range: then nothing can be released. */
  unknown: string | null;
  decision: { decision: RoadmapReleaseDecision; reason: string | null; readyAt: string | null };
  mode: string;
  breaker: { pausedAt: string | null; reason: string | null };
  canRelease: boolean;
}

/** `POST /v1/roadmap/release` → 202. */
export interface RoadmapReleaseResult {
  service: string;
  tag: string;
  dispatchedAt: string;
  apps: string | null;
}

/** `POST /v1/roadmap/release/resume`. */
export interface RoadmapResumeResult {
  pausedAt: null;
  wasPausedAt: string | null;
}

/**
 * When auto-release may start (P0's `releaseWindow`). Null means any time.
 *
 * Two shapes meet here. P0's PATCH DTO validates whole hours (`startHour`, `endHour` 1–24 exclusive,
 * `timezone`); P5's policy reads `start`/`end` as "HH:MM", `timeZone` and `days`. The settings row
 * stores the body as sent, so the Settings tab writes both in one object and reads either.
 */
export interface RoadmapReleaseWindow {
  startHour?: number;
  endHour?: number;
  timezone?: string;
  /** 0 (Sunday) to 6; null = every day. */
  days?: number[] | null;
  start?: string;
  end?: string;
  timeZone?: string;
}

/**
 * The roadmap fields on Builder's settings row (P0, P5). Read from `GET /v1/builder/settings`,
 * written with `PATCH` on the same route. Optional: a server that predates them leaves them out.
 */
export interface RoadmapV2SettingsFields {
  roadmapV2Enabled?: boolean;
  /** numeric(10,4), so a string on the wire. */
  maxLeadCeilingUsd?: string | number;
  awaitingReviewAmberDays?: number;
  releaseWindow?: RoadmapReleaseWindow | null;
  /** Null = the defaults in code. */
  autoReleaseHeldPaths?: string[] | null;
  /** A lead's open ideas (default 3). */
  inProgressLimit?: number;
  /** Set by the circuit breaker after two failed releases; cleared by Resume. */
  autoReleasePausedAt?: string | null;
  autoReleasePausedReason?: string | null;
}

export interface RoadmapV2SettingsPatch {
  roadmapV2Enabled?: boolean;
  maxLeadCeilingUsd?: number;
  awaitingReviewAmberDays?: number;
  releaseWindow?: RoadmapReleaseWindow | null;
  autoReleaseHeldPaths?: string[] | null;
  inProgressLimit?: number;
}
