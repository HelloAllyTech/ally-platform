import { NavigationItem } from "@components/types";
import {
  ROUTES,
  en,
  SIDEBAR_ITEMS,
  Permissions,
  buildSidebarItemFeatureKeyMap,
  buildSidebarItemOrgToggleMap,
  FeatureToggleKey,
  OrgToggle,
} from "@constants";

import { hasFeature } from "./permissions";

/** The sidebar's sections, in display order. Item membership is `NavigationItem.section`. */
export const NAV_SECTION_IDS = [
  "create",
  "people",
  "insights",
  "ai-languages",
  "product",
  "settings-logs",
] as const;
export type NavSectionId = (typeof NAV_SECTION_IDS)[number];

const getNavSectionLabels = (): Record<NavSectionId, string> => ({
  create: en.nav.sections.create,
  people: en.nav.sections.people,
  insights: en.nav.sections.insights,
  "ai-languages": en.nav.sections.aiLanguages,
  product: en.nav.sections.product,
  "settings-logs": en.nav.sections.settingsLogs,
});

/** Where the Analytics page opens its Conversation Drift tab (see ANALYTICS_TAB_PARAM). */
// A function, not a constant: `ROUTES` must not be read while this module loads (circular imports,
// suites that mock `@constants`).
export const getConversationDriftPath = (): string => `${ROUTES.ANALYTICS}?tab=drift`;

/**
 * Builds the full set of admin navigation tabs in their default order: the sections in order,
 * each section's tabs in order. Built lazily (not at module-eval time) to avoid reading
 * `@constants` exports before they are initialized under circular imports. Permission/role
 * gating is applied by `deriveNavigationItems`; the user's personalized order by
 * `applySavedOrder`.
 */
const buildNavigationItems = (): NavigationItem[] => {
  const { items: l } = en.nav;
  const S = SIDEBAR_ITEMS;
  return [
    // Create
    {
      id: S.SIMULATION_STUDIO,
      label: l.rolePlays,
      path: ROUTES.SIMULATION_STUDIO,
      section: "create",
    },
    { id: S.EVENTS, label: l.events, path: ROUTES.MANAGE_EVENTS, section: "create" },
    {
      id: S.CHARACTER_LIBRARY,
      label: l.characters,
      path: ROUTES.CHARACTER_LIBRARY,
      section: "create",
    },
    {
      id: S.COMPONENT_LIBRARY,
      label: l.componentLibrary,
      path: ROUTES.COMPONENT_LIBRARY,
      section: "create",
    },
    { id: S.COMPETENCIES, label: l.competencies, path: ROUTES.COMPETENCIES, section: "create" },
    {
      id: S.COURSE_COPILOT,
      label: l.courseCopilot,
      path: ROUTES.COURSE_COPILOT,
      section: "create",
    },
    { id: S.BLOG, label: l.blog, path: ROUTES.BLOG, section: "create" },
    // Product updates is no longer a primary item: it is a tab of the Roadmap's own top menu.
    // People
    { id: S.USERS, label: l.users, path: ROUTES.USER_MANAGEMENT, section: "people" },
    { id: S.USER_BADGES, label: l.badges, path: ROUTES.USER_BADGES, section: "people" },
    { id: S.DEBRIEFS, label: l.debriefs, path: ROUTES.DEBRIEFS, section: "people" },
    {
      id: S.ROLEPLAY_SESSION_LOGS,
      label: l.roleplayLogs,
      path: ROUTES.ROLEPLAY_SESSION_LOGS,
      section: "people",
    },
    // Insights
    { id: S.ANALYTICS, label: l.analytics, path: ROUTES.ANALYTICS, section: "insights" },
    {
      id: S.CONVERSATION_DRIFT,
      label: l.conversationDrift,
      path: getConversationDriftPath(),
      section: "insights",
    },
    // AI & Languages
    { id: S.PROMPTS, label: l.prompts, path: ROUTES.MANAGE_PROMPTS, section: "ai-languages" },
    {
      id: S.MANAGE_GUARDRAILS,
      label: l.guardrails,
      path: ROUTES.MANAGE_GUARDRAILS,
      section: "ai-languages",
    },
    // TODO(admin-ux/providers): these three collapse into one "Providers" item once that page lands.
    {
      id: S.STT_CONFIGS,
      label: l.speechRecognition,
      path: ROUTES.MANAGE_STT_CONFIGS,
      section: "ai-languages",
    },
    {
      id: S.LLM_MODEL_CATALOG,
      label: l.languageModels,
      path: ROUTES.MANAGE_LLM_MODEL_CATALOG,
      section: "ai-languages",
    },
    // Ally admin → Models and → Costs (CR1): the only screens with dollars, `manage_costs` only.
    {
      id: S.BILLING_MODELS,
      label: l.billingModels,
      path: ROUTES.BILLING_MODELS,
      section: "ai-languages",
    },
    {
      id: S.BILLING_COSTS,
      label: l.billingCosts,
      path: ROUTES.BILLING_COSTS,
      section: "ai-languages",
    },
    {
      id: S.SCENARIO_VOICES,
      label: l.voices,
      path: ROUTES.MANAGE_SCENARIO_VOICES,
      section: "ai-languages",
    },
    { id: S.AI_TASKS, label: l.aiTasks, path: ROUTES.AI_TASKS, section: "ai-languages" },
    {
      id: S.SCENARIO_LANGUAGES,
      label: l.languages,
      path: ROUTES.MANAGE_SCENARIO_LANGUAGES,
      section: "ai-languages",
    },
    {
      id: S.TRANSLATIONS,
      label: l.translations,
      path: ROUTES.MANAGE_TRANSLATIONS,
      section: "ai-languages",
    },
    { id: S.TOOLTIPS, label: l.tooltips, path: ROUTES.MANAGE_TOOLTIPS, section: "ai-languages" },
    {
      id: S.AGENT_TEST_CASES,
      label: l.agentTestCases,
      path: ROUTES.AGENT_TEST_CASES,
      section: "ai-languages",
    },
    { id: S.AI_LAB, label: l.aiLab, path: ROUTES.AI_LAB, section: "ai-languages" },
    // Product
    { id: S.PRODUCT_ROADMAP, label: l.roadmap, path: ROUTES.PRODUCT_ROADMAP, section: "product" },
    { id: S.ROADMAP_V2, label: l.roadmapV2, path: ROUTES.ROADMAP, section: "product" },
    {
      id: S.USER_INTERVIEWS,
      label: l.userInterviews,
      path: ROUTES.USER_INTERVIEWS,
      section: "product",
    },
    { id: S.BUG_HUNTER, label: l.bugHunter, path: ROUTES.BUG_HUNTER, section: "product" },
    { id: S.PM_AGENT, label: en.pmAgent.tabLabel, path: ROUTES.PM_AGENT, section: "product" },
    { id: S.BUILDER, label: l.builder, path: ROUTES.BUILDER, section: "product" },
    {
      id: S.MOBILE_RELEASES,
      label: l.mobileReleases,
      path: ROUTES.MOBILE_RELEASES,
      section: "product",
    },
    {
      id: S.CONTEXT_LIBRARY,
      label: l.contextLibrary,
      path: ROUTES.CONTEXT_LIBRARY,
      section: "product",
    },
    // The inbox lives inside this page (its Inbox tab); its unread count badges this item.
    // "Assistants" since A1, as the area is named.
    {
      id: S.WHATSAPP_BOT,
      label: en.whatsappBot.navLabel,
      path: ROUTES.WHATSAPP_BOT,
      section: "product",
    },
    { id: S.ALLY_GUIDE, label: l.allyConsole, path: ROUTES.ALLY_CONSOLE, section: "product" },
    // Settings & Logs
    { id: S.SETTINGS, label: l.settings, path: ROUTES.SETTINGS, section: "settings-logs" },
    { id: S.LOGS, label: l.logs, path: ROUTES.LOGS, section: "settings-logs" },
  ];
};

export interface NavSection {
  id: NavSectionId;
  label: string;
  items: NavigationItem[];
}

/**
 * Splits a flat, already-ordered list of visible tabs into the sidebar's sections. Sections come
 * out in their fixed order, each keeping the relative order its tabs had in `items` (so the user's
 * saved order still decides the order inside a section), and empty sections are dropped. Never
 * hides a tab: one with an unknown or missing section lands in the last section.
 */
export const groupNavigationItems = (items: NavigationItem[]): NavSection[] => {
  const labels = getNavSectionLabels();
  const last = NAV_SECTION_IDS[NAV_SECTION_IDS.length - 1];
  const buckets = new Map<NavSectionId, NavigationItem[]>(NAV_SECTION_IDS.map(id => [id, []]));
  items.forEach(item => {
    const id = (NAV_SECTION_IDS as readonly string[]).includes(item.section ?? "")
      ? (item.section as NavSectionId)
      : last;
    buckets.get(id)!.push(item);
  });
  return NAV_SECTION_IDS.filter(id => buckets.get(id)!.length > 0).map(id => ({
    id,
    label: labels[id],
    items: buckets.get(id)!,
  }));
};

/** The inverse of `groupNavigationItems`: the order the sidebar displays, top to bottom. */
export const flattenNavSections = (sections: NavSection[]): NavigationItem[] =>
  sections.flatMap(section => section.items);

/**
 * Whether `pathname` (+ `search`) is on `item`. Conversation Drift is a tab of the Analytics page
 * (`?tab=drift`), so the two items split that one path between them.
 */
export const isNavItemActive = (item: NavigationItem, pathname: string, search = ""): boolean => {
  const base = item.path.split("?")[0];
  if (item.id === SIDEBAR_ITEMS.CONVERSATION_DRIFT) {
    return pathname === base && new URLSearchParams(search).get("tab") === "drift";
  }
  if (item.id === SIDEBAR_ITEMS.ANALYTICS) {
    return pathname === base && new URLSearchParams(search).get("tab") !== "drift";
  }
  if (item.id === SIDEBAR_ITEMS.SIMULATION_STUDIO) {
    return pathname.startsWith(base) || pathname.startsWith(ROUTES.CREATE_SIMULATION);
  }
  // Segment-aware: "/ally" must not light up for "/allyfoo", "/builder" does for "/builder/:id".
  return pathname === base || pathname.startsWith(`${base}/`);
};

/**
 * A login whose only feature is Chatbots, as a custom login with just Chatbots ticked is. It holds
 * the platform-admin role's permissions, so the permission-gated tabs would otherwise show; its
 * sidebar is the one Assistants item, and it lands there after login.
 */
export const isChatbotsOnly = (features: string[] | undefined): boolean =>
  Boolean(features?.length) && features!.every(key => key === FeatureToggleKey.WHATSAPP_BOT);

/**
 * Returns `items` reordered to follow `savedOrder` (a list of item ids).
 * Ids in `savedOrder` that aren't currently visible are skipped, and visible
 * items missing from `savedOrder` (e.g. newly added tabs) are appended in their
 * original relative order. Tolerant of stale/unknown ids — never hides a tab.
 */
export const applySavedOrder = (
  items: NavigationItem[],
  savedOrder?: string[],
): NavigationItem[] => {
  if (!savedOrder?.length) return items;
  const byId = new Map(items.map(item => [item.id, item]));
  const ordered = savedOrder
    .map(id => byId.get(id))
    .filter((item): item is NavigationItem => Boolean(item));
  const orderedIds = new Set(savedOrder);
  const rest = items.filter(item => !orderedIds.has(item.id));
  return [...ordered, ...rest];
};

/**
 * Resolves the navigation tabs visible to a user, in their effective order,
 * then reordered by the user's saved sidebar order. The first element is the
 * user's "first tab" — used both to render the sidebar and to pick the default
 * landing route after login. Tabs fall into two gating tiers:
 *  - Feature-toggle-gated (Characters, Component Library, Speech Recognition,
 *    Language Model, Guardrails, Tooltips, Badges, Agent Test Cases, Settings, Logs,
 *    Mobile Releases, WhatsApp Bot, Bug Hunter, Analytics, Competencies,
 *    AI Lab, Roleplay Session Logs, Languages): shown once the user's feature-toggle list is
 *    loaded and holds the matching key (see `buildSidebarItemFeatureKeyMap`),
 *    independent of permissions. This one map replaces the former
 *    buildSuperDuperAdminOnlyItems() set and the SUPER_ADMIN_ROLES switch
 *    branch — both were role-tier gates for exactly these tabs.
 *  - Permission-gated (everything else): shown once permissions are loaded and
 *    the user holds the required permission.
 * The single-pass filter preserves each tab's natural order from
 * buildNavigationItems (Settings stays last).
 */
export const deriveNavigationItems = ({
  permissions,
  features,
  savedOrder,
  orgToggles,
  roadmapV2 = false,
}: {
  // Accepts `string[]` to match how permissions/features are stored in Redux;
  // enum members compare cleanly against the string entries.
  permissions: string[] | undefined;
  features: string[] | undefined;
  savedOrder: string[] | undefined;
  /**
   * Org-level (per-tenant) toggles the caller's organisation has switched on.
   * A tab whose per-user feature toggle is absent can still appear via this
   * route — that is how a tenant's own ADMINs see Characters. Optional: an
   * omitted or empty map behaves exactly as before.
   */
  orgToggles?: Partial<Record<OrgToggle, boolean>>;
  /**
   * Roadmap v2 is on for this caller: `GET /v1/roadmap/me/role` answered. Absent or false hides
   * the entry, so with the flag off the sidebar is exactly what it was.
   */
  roadmapV2?: boolean;
}): NavigationItem[] => {
  const navigationItems = buildNavigationItems();
  if (isChatbotsOnly(features)) {
    return navigationItems.filter(item => item.id === SIDEBAR_ITEMS.WHATSAPP_BOT);
  }
  const featureGatedItems = buildSidebarItemFeatureKeyMap(SIDEBAR_ITEMS);
  const orgGatedItems = buildSidebarItemOrgToggleMap(SIDEBAR_ITEMS);
  const hasPermissions = Boolean(permissions && permissions.length > 0);

  const visible = navigationItems.filter(item => {
    // Feature-toggle-gated tabs. Independent of permissions — a tab here is
    // either the user's toggle grants it or it does not exist for them.
    const featureKey = featureGatedItems.get(item.id);
    if (featureKey) {
      if (hasFeature(features, featureKey)) return true;
      // Second grant path for a tenant's own admins: the ORG has the feature
      // on and this user holds the permission to use it. Both halves are
      // required — the org switch alone must not surface the tab for, say, a
      // counsellor who happens to log into admin.
      const orgGate = orgGatedItems.get(item.id);
      return Boolean(
        orgGate &&
        orgToggles?.[orgGate.toggle] &&
        hasPermissions &&
        permissions!.includes(orgGate.permission),
      );
    }

    // Conversation Drift is a tab of Analytics: it follows that toggle.
    if (item.id === SIDEBAR_ITEMS.CONVERSATION_DRIFT)
      return hasFeature(features, FeatureToggleKey.ANALYTICS);

    switch (item.id) {
      // Permission-gated tabs require permissions to be loaded; until then
      // show nothing for them.
      default:
        if (!hasPermissions) return false;
        switch (item.id) {
          // Deliberately NOT in buildSidebarItemFeatureKeyMap: an entry there
          // becomes feature-ONLY (the map branch returns before this switch),
          // which would drop the EDIT_SCENARIO requirement. Content management
          // needs both — the permission to author, and the toggle to see the
          // studio at all.
          case SIDEBAR_ITEMS.SIMULATION_STUDIO:
            return (
              permissions!.includes(Permissions.EDIT_SCENARIO) &&
              hasFeature(features, FeatureToggleKey.CONTENT_MANAGEMENT)
            );
          // Toggle AND edit grant, like Simulation Studio, so deliberately NOT in
          // buildSidebarItemFeatureKeyMap (which would make it feature-only and drop the grant).
          // Copilot builds courses, so it also follows Create Courses.
          case SIDEBAR_ITEMS.COURSE_COPILOT:
            return (
              permissions!.includes(Permissions.EDIT_COURSE_COPILOT) &&
              hasFeature(features, FeatureToggleKey.COURSE_COPILOT) &&
              hasFeature(features, FeatureToggleKey.CREATE_COURSES)
            );
          // The Context Library: its own toggle for platform admins (platform-only, so never an
          // admin restricted to some organisations), OR an organisation's admin — the Ally
          // organisation-settings toggle with the Ally guide's view grant, who sees only their
          // organisation's entries there (docs/context-library/PLAN.md §10.2). Not in
          // buildSidebarItemFeatureKeyMap, which allows one key and no grant.
          case SIDEBAR_ITEMS.CONTEXT_LIBRARY:
            return (
              hasFeature(features, FeatureToggleKey.CONTEXT_LIBRARY) ||
              (hasFeature(features, FeatureToggleKey.ALLY_GUIDE_ORG) &&
                permissions!.includes(Permissions.VIEW_ALLY_GUIDE))
            );
          // The Ally Console: the ally_guide toggle AND the view grant, like Course Copilot, so
          // deliberately NOT in buildSidebarItemFeatureKeyMap (which would make it toggle-only and
          // drop the permission). The permission alone shows it to every platform admin.
          case SIDEBAR_ITEMS.ALLY_GUIDE:
            return (
              permissions!.includes(Permissions.VIEW_ALLY_GUIDE) &&
              hasFeature(features, FeatureToggleKey.ALLY_GUIDE)
            );
          // The tabs below each have a per-admin toggle (ON by default) AND keep
          // their permission, so they stay out of buildSidebarItemFeatureKeyMap,
          // which would make them toggle-only.
          case SIDEBAR_ITEMS.EVENTS:
            return (
              permissions!.includes(Permissions.EDIT_EVENT) &&
              hasFeature(features, FeatureToggleKey.EVENTS)
            );
          case SIDEBAR_ITEMS.SCENARIO_VOICES:
            return (
              permissions!.includes(Permissions.EDIT_SCENARIO_VOICE) &&
              hasFeature(features, FeatureToggleKey.SCENARIO_VOICES)
            );
          case SIDEBAR_ITEMS.PROMPTS:
            return (
              permissions!.includes(Permissions.EDIT_PROMPT) &&
              hasFeature(features, FeatureToggleKey.PROMPTS)
            );
          // Admin User Management also keeps the tab: its Ally admins list —
          // where every toggle, this one included, is edited — lives inside it.
          case SIDEBAR_ITEMS.USERS:
            return (
              (permissions!.includes(Permissions.EDIT_USER) ||
                permissions!.includes(Permissions.VIEW_USERS)) &&
              (hasFeature(features, FeatureToggleKey.USERS) ||
                hasFeature(features, FeatureToggleKey.ADMIN_USER_MANAGEMENT))
            );
          case SIDEBAR_ITEMS.TRANSLATIONS:
            return (
              permissions!.includes(Permissions.VIEW_I18N_TRANSLATIONS) &&
              hasFeature(features, FeatureToggleKey.TRANSLATIONS)
            );
          case SIDEBAR_ITEMS.BLOG:
            return (
              permissions!.includes(Permissions.VIEW_BLOGS) &&
              hasFeature(features, FeatureToggleKey.BLOG)
            );
          // On the edit grant, unlike Blog: this page corrects and hides what
          // the automation published.
          case SIDEBAR_ITEMS.PRODUCT_UPDATES:
            return (
              permissions!.includes(Permissions.EDIT_BLOG) &&
              hasFeature(features, FeatureToggleKey.PRODUCT_UPDATES)
            );
          // Viewing and voting reach a wider group than the manage surface
          // (PRODUCT_ROADMAP_MANAGE); this key switches the tab itself.
          // The Debriefs console: the Analytics toggle or the clinical advisor's toggle (the
          // routes' DEBRIEF_CONSOLE_FEATURES), and one of the console's permissions — the Ally
          // team (system:access), the clinical advisor (review:admin:debriefs, held without any
          // platform group) or the owner. Not in buildSidebarItemFeatureKeyMap (one key, no grant).
          case SIDEBAR_ITEMS.DEBRIEFS:
            return (
              (hasFeature(features, FeatureToggleKey.ANALYTICS) ||
                hasFeature(features, FeatureToggleKey.DEBRIEF_CLINICAL_SIGN_OFF)) &&
              (permissions!.includes(Permissions.SYSTEM_ACCESS) ||
                permissions!.includes(Permissions.REVIEW_DEBRIEFS) ||
                permissions!.includes(Permissions.MANAGE_DEBRIEF_SETTINGS))
            );
          case SIDEBAR_ITEMS.PRODUCT_ROADMAP:
            return (
              permissions!.includes(Permissions.VIEW_PRODUCT_ROADMAP) &&
              hasFeature(features, FeatureToggleKey.PRODUCT_ROADMAP)
            );
          // Same grant as the board, and only while the flag is on (the role read succeeded).
          case SIDEBAR_ITEMS.ROADMAP_V2:
          // User Interviews leaves the board for its own entry only with the flag on (D14).
          // falls through
          case SIDEBAR_ITEMS.USER_INTERVIEWS:
            return (
              roadmapV2 &&
              permissions!.includes(Permissions.VIEW_PRODUCT_ROADMAP) &&
              hasFeature(features, FeatureToggleKey.PRODUCT_ROADMAP)
            );
          default:
            return true;
        }
    }
  });

  return applySavedOrder(visible, savedOrder);
};
