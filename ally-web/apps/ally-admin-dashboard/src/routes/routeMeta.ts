import { matchPath } from "react-router-dom";

import { ROUTES, en } from "@constants";
import type { NavSectionId } from "@utils/navigation";

/**
 * What the shell knows about each admin page that sits under it: its title (browser tab and
 * breadcrumb), the sidebar section it belongs to, the page it hangs off (for detail pages) and
 * whether it draws its own frame edge to edge. One table, so a title and a breadcrumb can't drift.
 */
interface RouteMetaEntry {
  /** A react-router path pattern, matched exactly. Static paths must come before `:param` ones. */
  path: string;
  title: string;
  section: NavSectionId;
  /** The `path` of the entry this page hangs off (a list page, for a detail page). */
  parent?: string;
  fullBleed?: boolean;
}

export interface Crumb {
  label: string;
  /** Absent on the section crumb (sections have no page) and on the current page. */
  to?: string;
}

export interface ResolvedRouteMeta {
  title: string;
  crumbs: Crumb[];
  fullBleed: boolean;
  /** False for a URL no route knows: the shell shows the 404 page. */
  known: boolean;
}

const buildTable = (): RouteMetaEntry[] => {
  const { items: i, pages: p } = en.nav;
  return [
    // Create
    { path: ROUTES.SIMULATION_STUDIO, title: i.rolePlays, section: "create" },
    {
      path: ROUTES.CREATE_SIMULATION,
      title: p.newRoleplay,
      section: "create",
      parent: ROUTES.SIMULATION_STUDIO,
    },
    {
      path: ROUTES.EDIT_SIMULATION(":id"),
      title: p.editRoleplay,
      section: "create",
      parent: ROUTES.SIMULATION_STUDIO,
    },
    {
      path: ROUTES.VIEW_SIMULATION(":id"),
      title: p.viewRoleplay,
      section: "create",
      parent: ROUTES.SIMULATION_STUDIO,
    },
    {
      path: ROUTES.CREATE_PATH,
      title: p.newPathway,
      section: "create",
      parent: ROUTES.SIMULATION_STUDIO,
    },
    {
      path: ROUTES.EDIT_PATH(":id"),
      title: p.editPathway,
      section: "create",
      parent: ROUTES.SIMULATION_STUDIO,
    },
    {
      path: ROUTES.CREATE_CASE,
      title: p.newCase,
      section: "create",
      parent: ROUTES.SIMULATION_STUDIO,
    },
    {
      path: ROUTES.EDIT_CASE(":id"),
      title: p.editCase,
      section: "create",
      parent: ROUTES.SIMULATION_STUDIO,
    },
    {
      path: ROUTES.CREATE_TRACK,
      title: p.newTrack,
      section: "create",
      parent: ROUTES.SIMULATION_STUDIO,
    },
    {
      path: ROUTES.EDIT_TRACK(":id"),
      title: p.editTrack,
      section: "create",
      parent: ROUTES.SIMULATION_STUDIO,
    },
    { path: ROUTES.MANAGE_EVENTS, title: i.events, section: "create" },
    { path: ROUTES.CHARACTER_LIBRARY, title: i.characters, section: "create" },
    {
      path: ROUTES.CHARACTER_LIBRARY_INTERVIEW,
      title: p.characterInterview,
      section: "create",
      parent: ROUTES.CHARACTER_LIBRARY,
    },
    { path: ROUTES.COMPONENT_LIBRARY, title: i.componentLibrary, section: "create" },
    { path: ROUTES.COMPETENCIES, title: i.competencies, section: "create" },
    { path: ROUTES.COURSE_COPILOT, title: i.courseCopilot, section: "create" },
    {
      path: ROUTES.COURSE_COPILOT_NEW,
      title: p.courseCopilotNew,
      section: "create",
      parent: ROUTES.COURSE_COPILOT,
    },
    {
      path: ROUTES.COURSE_COPILOT_SESSION(":sessionId"),
      title: p.courseCopilotSession,
      section: "create",
      parent: ROUTES.COURSE_COPILOT,
    },
    { path: ROUTES.BLOG, title: i.blog, section: "create" },
    // A page of the Roadmap's top menu, so no breadcrumb above it (the frame names it); the page pads itself.
    { path: ROUTES.PRODUCT_UPDATES, title: i.productUpdates, section: "create", fullBleed: true },
    // People
    { path: ROUTES.USER_MANAGEMENT, title: i.users, section: "people" },
    {
      path: ROUTES.ORGANIZATION_DETAIL(":id"),
      title: p.organization,
      section: "people",
      parent: ROUTES.USER_MANAGEMENT,
    },
    { path: ROUTES.USER_BADGES, title: i.badges, section: "people" },
    { path: ROUTES.DEBRIEFS, title: i.debriefs, section: "people" },
    {
      path: ROUTES.DEBRIEFS_CHANGES,
      title: p.debriefPmAgent,
      section: "people",
      parent: ROUTES.DEBRIEFS,
    },
    {
      path: ROUTES.DEBRIEFS_SETTINGS,
      title: p.debriefSettings,
      section: "people",
      parent: ROUTES.DEBRIEFS,
    },
    {
      path: ROUTES.DEBRIEF_SESSION(":runId"),
      title: p.debriefSession,
      section: "people",
      parent: ROUTES.DEBRIEFS,
    },
    {
      path: ROUTES.DEBRIEF_SESSION_LOGS(":runId"),
      title: p.debriefSessionLogs,
      section: "people",
      parent: ROUTES.DEBRIEFS,
    },
    { path: ROUTES.ROLEPLAY_SESSION_LOGS, title: i.roleplayLogs, section: "people" },
    {
      path: ROUTES.ROLEPLAY_SESSION_LOG_DETAIL(":id"),
      title: p.roleplayLogDetail,
      section: "people",
      parent: ROUTES.ROLEPLAY_SESSION_LOGS,
    },
    // Insights (Conversation Drift is Analytics' `?tab=drift`: see `resolveRouteMeta`)
    { path: ROUTES.ANALYTICS, title: i.analytics, section: "insights" },
    // AI & Languages
    { path: ROUTES.MANAGE_PROMPTS, title: i.prompts, section: "ai-languages" },
    { path: ROUTES.MANAGE_GUARDRAILS, title: i.guardrails, section: "ai-languages" },
    { path: ROUTES.MANAGE_STT_CONFIGS, title: i.speechRecognition, section: "ai-languages" },
    { path: ROUTES.MANAGE_LLM_MODEL_CATALOG, title: i.languageModels, section: "ai-languages" },
    { path: ROUTES.MANAGE_SCENARIO_VOICES, title: i.voices, section: "ai-languages" },
    { path: ROUTES.AI_TASKS, title: i.aiTasks, section: "ai-languages" },
    { path: ROUTES.MANAGE_SCENARIO_LANGUAGES, title: i.languages, section: "ai-languages" },
    {
      path: ROUTES.MANAGE_LANGUAGE_GLOSSARY(":id"),
      title: p.languageGlossary,
      section: "ai-languages",
      parent: ROUTES.MANAGE_SCENARIO_LANGUAGES,
    },
    { path: ROUTES.MANAGE_TRANSLATIONS, title: i.translations, section: "ai-languages" },
    { path: ROUTES.MANAGE_TOOLTIPS, title: i.tooltips, section: "ai-languages" },
    { path: ROUTES.AGENT_TEST_CASES, title: i.agentTestCases, section: "ai-languages" },
    { path: ROUTES.AI_LAB, title: i.aiLab, section: "ai-languages" },
    // Product
    { path: ROUTES.PRODUCT_ROADMAP, title: i.roadmap, section: "product" },
    // Roadmap v2 (dark behind roadmap_v2): its own frame and scrolling, edge to edge.
    { path: ROUTES.ROADMAP, title: i.roadmapV2, section: "product", fullBleed: true },
    {
      path: ROUTES.ROADMAP_IDEA(":code"),
      title: p.roadmapIdea,
      section: "product",
      parent: ROUTES.ROADMAP,
      fullBleed: true,
    },
    ...[
      { path: ROUTES.ROADMAP_AGENT, title: p.roadmapAgent },
      { path: ROUTES.ROADMAP_AGENT_SECTION(":section"), title: p.roadmapAgent },
      { path: ROUTES.ROADMAP_SETTINGS, title: p.roadmapSettings },
      { path: ROUTES.ROADMAP_DRAFTS, title: p.roadmapDrafts },
      { path: ROUTES.ROADMAP_NEW_IDEA, title: p.roadmapNewIdea },
      { path: ROUTES.ROADMAP_BUGS, title: p.roadmapBugs },
      { path: ROUTES.ROADMAP_MEASURES, title: en.roadmapV2Measures.title },
    ].map(entry => ({
      ...entry,
      section: "product" as const,
      parent: ROUTES.ROADMAP,
      fullBleed: true,
    })),
    { path: ROUTES.USER_INTERVIEWS, title: i.userInterviews, section: "product" },
    { path: ROUTES.BUG_HUNTER, title: i.bugHunter, section: "product" },
    { path: ROUTES.BUILDER, title: i.builder, section: "product" },
    {
      path: ROUTES.BUILDER_ALL_SESSIONS,
      title: p.builderSessions,
      section: "product",
      parent: ROUTES.BUILDER,
    },
    {
      path: ROUTES.BUILDER_SETTINGS,
      title: p.builderSettings,
      section: "product",
      parent: ROUTES.BUILDER,
    },
    {
      path: ROUTES.BUILDER_PIPELINE,
      title: p.builderPipeline,
      section: "product",
      parent: ROUTES.BUILDER,
    },
    {
      path: ROUTES.BUILDER_SCOREBOARD,
      title: p.builderScoreboard,
      section: "product",
      parent: ROUTES.BUILDER,
    },
    {
      path: ROUTES.BUILDER_KNOWLEDGE,
      title: p.builderKnowledge,
      section: "product",
      parent: ROUTES.BUILDER,
    },
    { path: ROUTES.BUILDER_EVAL, title: p.builderEval, section: "product", parent: ROUTES.BUILDER },
    {
      path: ROUTES.BUILDER_SESSION(":sessionId"),
      title: p.builderSession,
      section: "product",
      parent: ROUTES.BUILDER,
    },
    { path: ROUTES.MOBILE_RELEASES, title: i.mobileReleases, section: "product" },
    { path: ROUTES.CONTEXT_LIBRARY, title: i.contextLibrary, section: "product" },
    {
      path: ROUTES.WHATSAPP_BOT,
      title: en.whatsappBot.navLabel,
      section: "product",
      fullBleed: true,
    },
    {
      path: ROUTES.CHATBOT_NEW,
      title: p.chatbotNew,
      section: "product",
      parent: ROUTES.WHATSAPP_BOT,
      fullBleed: true,
    },
    {
      path: ROUTES.CHATBOT_NEW_SESSION(":draftId"),
      title: p.chatbotNew,
      section: "product",
      parent: ROUTES.WHATSAPP_BOT,
      fullBleed: true,
    },
    {
      path: ROUTES.CHATBOT_DETAIL,
      title: p.chatbotDetail,
      section: "product",
      parent: ROUTES.WHATSAPP_BOT,
      fullBleed: true,
    },
    { path: ROUTES.ALLY_CONSOLE, title: i.allyConsole, section: "product" },
    // Settings & Logs
    { path: ROUTES.SETTINGS, title: i.settings, section: "settings-logs" },
    { path: ROUTES.LOGS, title: i.logs, section: "settings-logs" },
  ];
};

const sectionLabel = (id: NavSectionId): string => {
  const { sections } = en.nav;
  const byId: Record<NavSectionId, string> = {
    create: sections.create,
    people: sections.people,
    insights: sections.insights,
    "ai-languages": sections.aiLanguages,
    product: sections.product,
    "settings-logs": sections.settingsLogs,
  };
  return byId[id];
};

/** Resolve a URL to its title, breadcrumb trail and frame. Never throws; an unknown URL is `known: false`. */
export const resolveRouteMeta = (pathname: string, search = ""): ResolvedRouteMeta => {
  const table = buildTable();
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const entry = table.find(candidate => matchPath({ path: candidate.path, end: true }, normalized));

  if (!entry) {
    return {
      title: en.nav.pages.notFound,
      crumbs: [{ label: en.nav.pages.notFound }],
      fullBleed: false,
      known: false,
    };
  }

  // Conversation Drift is a tab of Analytics, with its own nav item.
  const isDrift =
    entry.path === ROUTES.ANALYTICS && new URLSearchParams(search).get("tab") === "drift";
  const title = isDrift ? en.nav.items.conversationDrift : entry.title;

  const trail: Crumb[] = [];
  const parent = entry.parent
    ? table.find(candidate => candidate.path === entry.parent)
    : undefined;
  if (parent) trail.push({ label: parent.title, to: parent.path });
  trail.push({ label: title });

  return {
    title,
    crumbs: [{ label: sectionLabel(entry.section) }, ...trail],
    fullBleed: Boolean(entry.fullBleed),
    known: true,
  };
};

/** Every path the table knows, for tests that check it against the router. */
export const getRouteMetaPaths = (): string[] => buildTable().map(entry => entry.path);
