import { ROUTES } from "@constants";
import type { RoadmapRole } from "@types";

/**
 * Old links to Product Roadmap and Builder, and where each lands on the Roadmap (§5.7). Active only
 * while `roadmap_v2` is on; with it off the old pages render exactly as before. Every landing carries
 * `{ roadmapMoved }` in the router state so the page says where the link went (§4.15).
 */

export type MovedFrom = "productRoadmap" | "builder";

/** The landing's name, as the banner says it: "Builder is now Roadmap → For you". */
export type MovedLanding =
  | "forYou"
  | "allIdeas"
  | "idea"
  | "bugs"
  | "interviews"
  | "settings"
  | AgentSection;

export interface MovedState {
  from: MovedFrom;
  landed: MovedLanding;
}

export interface LegacyTarget extends MovedState {
  to: string;
}

/** The Agent tab's pages, in tab order (§4.1). Builders read; Owners edit. */
export const AGENT_SECTIONS = [
  "pipeline",
  "scoreboard",
  "history",
  "rules",
  "knowledge",
  "evals",
] as const;
export type AgentSection = (typeof AGENT_SECTIONS)[number];

export const isAgentSection = (value: unknown): value is AgentSection =>
  typeof value === "string" && (AGENT_SECTIONS as readonly string[]).includes(value);

export const canSeeAgent = (role: RoadmapRole): boolean => role === "builder" || role === "owner";
export const canSeeSettings = (role: RoadmapRole): boolean => role === "owner";
/** Measures (P8): the funnel, stage times, review wait and spend. Owner only, like the route. */
export const canSeeMeasures = (role: RoadmapRole): boolean => role === "owner";

/**
 * `/product-roadmap?…`. `opportunity` and `plan` carry the opportunity's uuid, which the idea page
 * accepts as well as its code. My drafts stays on the old page until it has a Roadmap tab of its
 * own (P3), so `?tab=drafts` returns null.
 */
export const productRoadmapTarget = (search: string): LegacyTarget | null => {
  const params = new URLSearchParams(search);
  const id = params.get("opportunity") || params.get("plan");
  if (id) return { to: ROUTES.ROADMAP_IDEA(id), from: "productRoadmap", landed: "idea" };
  const tab = params.get("tab");
  if (tab === "drafts") return null;
  if (tab === "bugs") return { to: ROUTES.ROADMAP_BUGS, from: "productRoadmap", landed: "bugs" };
  if (tab === "interviews") {
    return { to: ROUTES.USER_INTERVIEWS, from: "productRoadmap", landed: "interviews" };
  }
  return { to: `${ROUTES.ROADMAP}?view=all`, from: "productRoadmap", landed: "allIdeas" };
};

const BUILDER_PAGE_TO_SECTION: Record<string, AgentSection> = {
  pipeline: "pipeline",
  scoreboard: "scoreboard",
  knowledge: "knowledge",
  eval: "evals",
  sessions: "history",
};

/**
 * `/builder/…`. A session (`/builder/:id`) lands on its idea when it has one (`ideaCode`); a session
 * with no idea keeps its old read-only page, so the function returns null. Settings is the Owner's:
 * anyone else lands on the Agent tab, which is as far as their role goes.
 */
export const builderTarget = (
  pathname: string,
  role: RoadmapRole,
  ideaCode?: string | null,
): LegacyTarget | null => {
  const rest = pathname.replace(/\/+$/, "").split("/builder")[1] ?? "";
  const segment = rest.replace(/^\//, "").split("/")[0] ?? "";
  if (!segment || segment === "decisions") {
    return { to: `${ROUTES.ROADMAP}?view=for-you`, from: "builder", landed: "forYou" };
  }
  if (segment === "settings") {
    return canSeeSettings(role)
      ? { to: ROUTES.ROADMAP_SETTINGS, from: "builder", landed: "settings" }
      : { to: ROUTES.ROADMAP_AGENT_SECTION("pipeline"), from: "builder", landed: "pipeline" };
  }
  const section = BUILDER_PAGE_TO_SECTION[segment];
  if (section) {
    return { to: ROUTES.ROADMAP_AGENT_SECTION(section), from: "builder", landed: section };
  }
  return ideaCode ? { to: ROUTES.ROADMAP_IDEA(ideaCode), from: "builder", landed: "idea" } : null;
};

/** Read `{ roadmapMoved }` off router state defensively: anything else is no banner. */
export const movedStateOf = (state: unknown): MovedState | null => {
  const moved = (state as { roadmapMoved?: unknown } | null)?.roadmapMoved as
    | Partial<MovedState>
    | undefined;
  if (!moved || (moved.from !== "builder" && moved.from !== "productRoadmap")) return null;
  if (typeof moved.landed !== "string") return null;
  return { from: moved.from, landed: moved.landed as MovedLanding };
};
