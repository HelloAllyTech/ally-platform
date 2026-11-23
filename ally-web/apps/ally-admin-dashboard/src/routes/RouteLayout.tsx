import React, { lazy, Suspense } from "react";

import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

import { Permissions, ROUTES, FeatureToggleKey, OrgToggle } from "@constants";
import {
  CreateSimulation,
  Login,
  MagicLinkVerify,
  LiveSimulationPreview,
  SimulationStudio,
  UserManagement,
  OrganizationDetail,
  EventManagement,
  CharacterLibrary,
  CharacterInterview,
  ComponentLibrary,
  CreatePath,
  CreateTrack,
  CreateCase,
  ScenarioVoices,
  SttConfigs,
  AiTasks,
  AllyConsole,
  LlmModelCatalog,
  ScenarioLanguages,
  LanguageGlossary,
  GuardrailsManagement,
  SystemSkillsPage,
  UserBadges,
  TranslationManagement,
  TooltipManagement,
  BlogManagement,
  LandingPageEditor,
  LandingPages,
  AILab,
  RoadmapDraftsPage,
  RoadmapAgentPage,
  RoadmapBugsPage,
  RoadmapFrame,
  RoadmapGate,
  RoadmapNewIdeaPage,
  RoadmapIdeaPage,
  RoadmapLegacyRedirect,
  RoadmapQueuePage,
  RoadmapProductUpdatesPage,
  RoadmapSettingsPage,
  RoadmapMeasuresPage,
  UserInterviewsPage,
  Settings,
  Logs,
  MobileReleases,
  BugHunter,
  BugHunterV2ReportDetail,
  Builder,
  BuilderEval,
  BuilderKnowledge,
  BuilderPipeline,
  BuilderRoom,
  BuilderScoreboard,
  BuilderSession,
  BuilderSettings,
  CourseCopilotNew,
  CourseCopilotSession,
  RoleplayAgentPage,
  CourseCopilotSessions,
  AgentTestCases,
  Competencies,
  DebriefConsole,
  DebriefSessionPage,
  AgentLogsPage,
  PmAgentPage,
  PmAgentFeed,
  DebriefSettingsPage,
  RoleplaySessionLogs,
  RoleplaySessionLogDetail,
  Terms,
  Privacy,
  EvaluateLogin,
  EvaluateRecords,
  EvaluateRecordDetail,
  BuilderHome,
  AssistantDefaults,
} from "@pages";

// By path, not through `@pages`: onboarding (chunk 20a) needs nothing the barrel provides.

import { AdminShell } from "./AdminShell";
import { DebriefsPmAgentRedirect } from "./DebriefsPmAgentRedirect";
import { DefaultRedirect } from "./DefaultRedirect";
import { NotFound } from "./NotFound";
import { PrivateLayout } from "./PrivateLayout";
import { PublicRoute } from "./PublicRoute";
import { AssistantHome } from "../pages/AssistantHome";
import { AssistantInvite } from "../pages/AssistantInvite";
import { CreateGate } from "../pages/BuilderHome/CreateGate";
import { CHATBOT_SUPPORT_ROUTE, ChatbotSupport } from "../pages/ChatbotSupport/ChatbotSupport";
import { OnboardingSession, OnboardingStart } from "../pages/Onboarding";

/**
 * The Debrief console opens with the Analytics toggle or the clinical
 * advisor's own toggle, as ally-be's DebriefRead allows (CONSOLE_API "Roles").
 */
const DEBRIEF_CONSOLE_FEATURES = [
  FeatureToggleKey.ANALYTICS,
  FeatureToggleKey.DEBRIEF_CLINICAL_SIGN_OFF,
];

/**
 * `/inbox` (an owner's email from before the inbox moved): the assistants home. The Inbox tab is
 * gone (stage 2): each chatbot's Conversations section holds its chats.
 */
const InboxRedirect: React.FC = () => <Navigate to={ROUTES.WHATSAPP_BOT} replace />;

/**
 * Links from before A1 (`/chatbots`, `/chatbots/:id?section=tools`, `/chatbots/new/…`, emails and
 * bookmarks): the same place under `/assistants`, with its query and hash.
 */
export const ChatbotsLegacyRedirect: React.FC = () => {
  const { pathname, search, hash } = useLocation();
  const rest = pathname.replace(/^\/chatbots/, "");
  return <Navigate to={`${ROUTES.WHATSAPP_BOT}${rest}${search}${hash}`} replace />;
};

/**
 * One assistant: the assistant home (chunk 20d), edge to edge. The classic tabbed page went in CL1;
 * an old `?view=classic` link opens the home, and its `tab=` still lands on the right section.
 */
// No Chatbots switch needed (chunk 6b): being on the assistant's team is enough, and ally-be answers
// 404 to anyone who isn't, which the home shows as "You don't have access".
const ChatbotDetailRoute: React.FC = () => (
  <PrivateLayout fullBleed>
    <AssistantHome />
  </PrivateLayout>
);

// Lazy-loaded (the shell's Suspense shows the loading state) so IBM Carbon + Carbon Charts (+ d3) and the scoped Carbon
// stylesheet ship as their own chunk, loaded only when the Analytics tab opens.
const Analytics = lazy(() =>
  import("../pages/Analytics/Analytics").then(module => ({ default: module.Analytics })),
);

// Lazy-loaded (kept out of the eager @pages barrel): the Context Library is a large page that
// only admins with its toggle ever open.
const ContextLibrary = lazy(() =>
  import("../pages/ContextLibrary/ContextLibrary").then(module => ({
    default: module.ContextLibrary,
  })),
);

// Ally admin → Models and → Costs (CR1). Lazy-loaded (kept out of the eager @pages barrel): only
// super admins with `manage_costs` open them, and Costs draws a Carbon chart.
const BillingModels = lazy(() =>
  import("../pages/Billing/Models").then(module => ({ default: module.BillingModels })),
);
const BillingCosts = lazy(() =>
  import("../pages/Billing/Costs").then(module => ({ default: module.BillingCosts })),
);
const BillingPlans = lazy(() =>
  import("../pages/Billing/Plans").then(module => ({ default: module.BillingPlans })),
);
// The owner's Plan and usage (CR1 Part C): any signed-in user, for themselves. Never dollars.
const MyCredits = lazy(() =>
  import("../pages/Credits/MyCredits").then(module => ({ default: module.MyCredits })),
);
const StaffCredits = lazy(() =>
  import("../pages/Credits/StaffCredits").then(module => ({ default: module.StaffCredits })),
);
const SafetyPacks = lazy(() =>
  import("../pages/SafetyPacks/SafetyPacks").then(module => ({ default: module.SafetyPacks })),
);
const MyPlan = lazy(() =>
  import("../pages/Plan/MyPlan").then(module => ({ default: module.MyPlan })),
);

// Public design-system gallery. Lazy-loaded (kept out of the eager @pages
// barrel) so this browse-only showcase never weighs on the main admin bundle.
const DesignSystem = lazy(() =>
  import("../pages/DesignSystem/DesignSystem").then(module => ({ default: module.DesignSystem })),
);

// Agents v2 component gallery (chunk 20d): development builds only, so it never ships.
const DevV2Components = import.meta.env.DEV ? lazy(() => import("../pages/DevV2Components")) : null;
// Onboarding's screens from fixtures, for review and the Playwright tests (chunk 20d).
const DevOnboarding = import.meta.env.DEV ? lazy(() => import("../pages/DevOnboarding")) : null;
const DevInbox = import.meta.env.DEV ? lazy(() => import("../pages/DevInbox")) : null;
// The resources directory (its own area, like Assistants). Lazy: only its users open it.
const Directory = lazy(() =>
  import("../pages/Directory/Directory").then(module => ({ default: module.Directory })),
);
const CollectionDetail = lazy(() =>
  import("../pages/Directory/CollectionDetail").then(module => ({
    default: module.CollectionDetail,
  })),
);
const PublicDirectory = lazy(() =>
  import("../pages/Directory/PublicDirectory").then(module => ({
    default: module.PublicDirectory,
  })),
);

const DevAssistantHome = import.meta.env.DEV
  ? lazy(() => import("../pages/DevAssistantHome"))
  : null;

/** `/bug-hunter?…` → `/bug-hunter-v2?…`, keeping the query (`?bug=`, `?bucket=`). */
const BugHunterAddressRedirect: React.FC = () => {
  const { search } = useLocation();
  return <Navigate to={`${ROUTES.BUG_HUNTER_V2}${search}`} replace />;
};

export const RouteLayout: React.FC = () => {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Routes>
        {/* Public Routes */}
        <Route
          path={ROUTES.LOGIN}
          element={
            <PublicRoute>
              <Login />
            </PublicRoute>
          }
        />

        <Route
          path={ROUTES.MAGIC_VERIFY}
          element={
            <PublicRoute>
              <MagicLinkVerify />
            </PublicRoute>
          }
        />

        {/* The emailed team invite: public, whether or not they are signed in (not a PublicRoute). */}
        <Route path={ROUTES.ASSISTANT_INVITE} element={<AssistantInvite />} />

        {/* A directory collection's public page: no sign-in, outside the admin shell. */}
        <Route
          path={ROUTES.DIRECTORY_PUBLIC}
          element={
            <Suspense fallback={null}>
              <PublicDirectory />
            </Suspense>
          }
        />

        {/* Legal pages — fully public, accessible whether or not signed in */}
        <Route path={ROUTES.TERMS} element={<Terms />} />
        <Route path={ROUTES.PRIVACY} element={<Privacy />} />

        {/* Design-system gallery — fully public, no login required */}
        <Route
          path={ROUTES.DESIGN_SYSTEM}
          element={
            <Suspense fallback={null}>
              <DesignSystem />
            </Suspense>
          }
        />

        {DevOnboarding && (
          <Route
            path="/dev/onboarding"
            element={
              <Suspense fallback={null}>
                <DevOnboarding />
              </Suspense>
            }
          />
        )}
        {DevInbox && (
          <Route
            path="/dev/inbox"
            element={
              <Suspense fallback={null}>
                <DevInbox />
              </Suspense>
            }
          />
        )}
        {DevAssistantHome && (
          <Route
            path="/dev/assistant-home/*"
            element={
              <Suspense fallback={null}>
                <DevAssistantHome />
              </Suspense>
            }
          />
        )}
        {DevV2Components && (
          <Route
            path="/dev/v2-components"
            element={
              <Suspense fallback={null}>
                <DevV2Components />
              </Suspense>
            }
          />
        )}

        {/* Evaluator micro-app — its own email+password session (NOT admin
            auth); the pages gate themselves on the evaluator token. */}
        <Route path={ROUTES.EVALUATE} element={<EvaluateLogin />} />
        <Route path={ROUTES.EVALUATE_RECORDS} element={<EvaluateRecords />} />
        <Route path={ROUTES.EVALUATE_RECORD(":assignmentId")} element={<EvaluateRecordDetail />} />

        {/* Bare preview: no shell to preserve. */}
        <Route
          path={ROUTES.SIMULATION_PREVIEW(":id")}
          element={
            <PrivateLayout isPreview={true} requiredPermissions={[Permissions.VIEW_ADMIN_SCENARIO]}>
              <LiveSimulationPreview />
            </PrivateLayout>
          }
        />
        {/* Private Routes: one shared layout route, so the sidebar, palette and scroll area stay
            mounted across navigation. Each page's PrivateLayout only gates access. */}
        <Route element={<AdminShell />}>
          <Route
            path={ROUTES.SIMULATION_STUDIO}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_ADMIN_SCENARIO]}
                requiredFeature={FeatureToggleKey.CONTENT_MANAGEMENT}
              >
                <SimulationStudio />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.USER_MANAGEMENT}
            element={
              // Any-of: Admin User Management keeps the page, since its Ally admins
              // list is where every toggle — the Users one included — is edited.
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_USER, Permissions.VIEW_USERS]}
                requiredFeature={[FeatureToggleKey.USERS, FeatureToggleKey.ADMIN_USER_MANAGEMENT]}
              >
                <UserManagement />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.ORGANIZATION_DETAIL(":id")}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_USER, Permissions.VIEW_USERS]}
                requiredFeature={FeatureToggleKey.USERS}
              >
                <OrganizationDetail />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.CREATE_SIMULATION}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_SCENARIO]}
                requiredFeature={FeatureToggleKey.CONTENT_MANAGEMENT}
                alsoRequiredFeatures={[FeatureToggleKey.CREATE_ROLEPLAYS]}
              >
                <CreateSimulation />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.EDIT_SIMULATION(":id")}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_SCENARIO]}
                requiredFeature={FeatureToggleKey.CONTENT_MANAGEMENT}
                // Read-only admins open roleplays through VIEW_SIMULATION instead.
                alsoRequiredFeatures={[FeatureToggleKey.CREATE_ROLEPLAYS]}
              >
                <CreateSimulation />
              </PrivateLayout>
            }
          />
          {/* Read-only View Details: same editor surface, but nothing is ever
            saved, so a published simulation stays published. View permission
            only — no edit:scenario required. */}
          <Route
            path={ROUTES.VIEW_SIMULATION(":id")}
            element={
              <PrivateLayout requiredPermissions={[Permissions.VIEW_ADMIN_SCENARIO]}>
                <CreateSimulation viewMode />
              </PrivateLayout>
            }
          />

          <Route
            path={ROUTES.MANAGE_EVENTS}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_EVENT]}
                requiredFeature={FeatureToggleKey.EVENTS}
              >
                <EventManagement />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.USER_BADGES}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.USER_BADGES}>
                <UserBadges />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.CHARACTER_LIBRARY}
            element={
              /* Platform admins get here on the feature-toggle path. A
               tenant's own ADMINs get here on the org-toggle path, and see
               only the characters their org created. */
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_CHARACTER_LIBRARY]}
                requiredFeature={FeatureToggleKey.CHARACTER_LIBRARY}
                requiredOrgToggle={OrgToggle.CHARACTER_LIBRARY}
              >
                <CharacterLibrary />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.CHARACTER_LIBRARY_INTERVIEW}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.CREATE_CHARACTER_LIBRARY]}
                requiredFeature={FeatureToggleKey.CHARACTER_LIBRARY}
                requiredOrgToggle={OrgToggle.CHARACTER_LIBRARY}
              >
                <CharacterInterview />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.MANAGE_SCENARIO_VOICES}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_SCENARIO]}
                requiredFeature={FeatureToggleKey.SCENARIO_VOICES}
              >
                <ScenarioVoices />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.MANAGE_STT_CONFIGS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.MANAGE_STT_CONFIGS}>
                <SttConfigs />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.MANAGE_LLM_MODEL_CATALOG}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.MANAGE_LLM_MODEL_CATALOG}>
                <LlmModelCatalog />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.BILLING_MODELS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.MANAGE_COSTS}>
                <BillingModels />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.BILLING_COSTS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.MANAGE_COSTS}>
                <BillingCosts />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.BILLING_PLANS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.MANAGE_COSTS}>
                <BillingPlans />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.BILLING_CREDITS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.MANAGE_COSTS}>
                <StaffCredits />
              </PrivateLayout>
            }
          />
          {/* Assistants stage 9: safety pack releases (the curator grant). */}
          <Route
            path={ROUTES.SAFETY_PACKS}
            element={
              <PrivateLayout requiredPermissions={[Permissions.MANAGE_SAFETY_PACKS]}>
                <SafetyPacks />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.MY_CREDITS}
            element={
              <PrivateLayout fullBleed>
                <MyCredits />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.MY_PLAN}
            element={
              <PrivateLayout fullBleed>
                <MyPlan />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.AI_TASKS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.AI_TASKS}>
                <AiTasks />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.MANAGE_SCENARIO_LANGUAGES}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.MANAGE_SCENARIO_LANGUAGES}>
                <ScenarioLanguages />
              </PrivateLayout>
            }
          />
          <Route
            // Reached from the Languages list, so it matches that tab's gate —
            // narrowing it here would dead-end a plain super-admin.
            path={ROUTES.MANAGE_LANGUAGE_GLOSSARY(":id")}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.MANAGE_SCENARIO_LANGUAGES}>
                <LanguageGlossary />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.MANAGE_PROMPTS}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_PROMPT]}
                requiredFeature={FeatureToggleKey.PROMPTS}
              >
                <SystemSkillsPage />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.CREATE_PATH}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_EVENT]}
                requiredFeature={FeatureToggleKey.CONTENT_MANAGEMENT}
              >
                <CreatePath />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.EDIT_PATH(":id")}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_EVENT]}
                requiredFeature={FeatureToggleKey.CONTENT_MANAGEMENT}
              >
                <CreatePath />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.CREATE_TRACK}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_EVENT]}
                requiredFeature={FeatureToggleKey.CONTENT_MANAGEMENT}
                alsoRequiredFeatures={[FeatureToggleKey.CREATE_COURSES]}
              >
                <CreateTrack />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.EDIT_TRACK(":id")}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_EVENT]}
                requiredFeature={FeatureToggleKey.CONTENT_MANAGEMENT}
              >
                <CreateTrack />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.COMPONENT_LIBRARY}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_ADMIN_TRACK]}
                requiredFeature={FeatureToggleKey.COMPONENT_LIBRARY}
              >
                <ComponentLibrary />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.CREATE_CASE}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_EVENT]}
                requiredFeature={FeatureToggleKey.CONTENT_MANAGEMENT}
                alsoRequiredFeatures={[FeatureToggleKey.CREATE_CASES]}
              >
                <CreateCase />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.EDIT_CASE(":id")}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_EVENT]}
                requiredFeature={FeatureToggleKey.CONTENT_MANAGEMENT}
              >
                <CreateCase />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.MANAGE_GUARDRAILS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.MANAGE_GUARDRAILS}>
                <GuardrailsManagement />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.MANAGE_TRANSLATIONS}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_I18N_TRANSLATIONS]}
                requiredFeature={FeatureToggleKey.TRANSLATIONS}
              >
                <TranslationManagement />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.MANAGE_TOOLTIPS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.MANAGE_TOOLTIPS}>
                <TooltipManagement />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.BLOG}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_BLOGS]}
                requiredFeature={FeatureToggleKey.BLOG}
              >
                <BlogManagement />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.LANDING_PAGES}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_LANDING_PAGES]}
                requiredFeature={FeatureToggleKey.LANDING_PAGES}
              >
                <LandingPages />
              </PrivateLayout>
            }
          />
          {/* The editor is the page itself, so it takes the whole width. */}
          <Route
            path={ROUTES.LANDING_PAGE}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_LANDING_PAGES]}
                requiredFeature={FeatureToggleKey.LANDING_PAGES}
                fullBleed
              >
                <LandingPageEditor />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.PRODUCT_UPDATES}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.EDIT_BLOG]}
                requiredFeature={FeatureToggleKey.PRODUCT_UPDATES}
                fullBleed
              >
                {/* A page of the Roadmap's top menu; without a Roadmap role it is the page alone. */}
                <RoadmapGate fallback={<RoadmapProductUpdatesPage />}>
                  <RoadmapFrame>
                    <RoadmapProductUpdatesPage />
                  </RoadmapFrame>
                </RoadmapGate>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.PRODUCT_ROADMAP}
            element={
              // Permission-gated, not role-gated: SUPER_ADMIN can view and vote, while the
              // manage surface inside the page is gated on EDIT_PRODUCT_ROADMAP.
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_PRODUCT_ROADMAP]}
                requiredFeature={FeatureToggleKey.PRODUCT_ROADMAP}
              >
                {/* Old Product Roadmap links land on the Roadmap (§5.7). Someone with no Roadmap
                    role is sent there too: the Roadmap's own gate answers them with not-found. */}
                <RoadmapLegacyRedirect from="productRoadmap">
                  <Navigate to={ROUTES.ROADMAP} replace />
                </RoadmapLegacyRedirect>
              </PrivateLayout>
            }
          />
          {/* Roadmap v2 (plans/roadmap-builder-merge), dark behind roadmap_v2. The gate asks
            /v1/roadmap/me/role, which answers 404 while the flag is off: then these URLs are the
            ordinary not-found page and nothing else changes. Product Roadmap and Builder above
            are untouched. */}
          <Route
            path={ROUTES.ROADMAP}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_PRODUCT_ROADMAP]}
                requiredFeature={FeatureToggleKey.PRODUCT_ROADMAP}
                fullBleed
              >
                <RoadmapGate fallback={<NotFound />}>
                  <RoadmapFrame>
                    <RoadmapQueuePage />
                  </RoadmapFrame>
                </RoadmapGate>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.ROADMAP_DRAFTS}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_PRODUCT_ROADMAP]}
                requiredFeature={FeatureToggleKey.PRODUCT_ROADMAP}
                fullBleed
              >
                <RoadmapGate fallback={<NotFound />}>
                  <RoadmapFrame>
                    <RoadmapDraftsPage />
                  </RoadmapFrame>
                </RoadmapGate>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.ROADMAP_NEW_IDEA}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_PRODUCT_ROADMAP]}
                requiredFeature={FeatureToggleKey.PRODUCT_ROADMAP}
                fullBleed
              >
                <RoadmapGate fallback={<NotFound />}>
                  <RoadmapFrame>
                    <RoadmapNewIdeaPage />
                  </RoadmapFrame>
                </RoadmapGate>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.ROADMAP_IDEA(":code")}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_PRODUCT_ROADMAP]}
                requiredFeature={FeatureToggleKey.PRODUCT_ROADMAP}
                fullBleed
              >
                <RoadmapGate fallback={<NotFound />}>
                  <RoadmapFrame>
                    <RoadmapIdeaPage />
                  </RoadmapFrame>
                </RoadmapGate>
              </PrivateLayout>
            }
          />
          {/* Agent (Builders read, Owners edit), Settings (Owners) and Bugs: each page checks the
            role itself and sends anyone else to the Queue. */}
          {[ROUTES.ROADMAP_AGENT, ROUTES.ROADMAP_AGENT_SECTION(":section")].map(path => (
            <Route
              key={path}
              path={path}
              element={
                <PrivateLayout
                  requiredPermissions={[Permissions.VIEW_PRODUCT_ROADMAP]}
                  requiredFeature={FeatureToggleKey.PRODUCT_ROADMAP}
                  fullBleed
                >
                  <RoadmapGate fallback={<NotFound />}>
                    <RoadmapFrame>
                      <RoadmapAgentPage />
                    </RoadmapFrame>
                  </RoadmapGate>
                </PrivateLayout>
              }
            />
          ))}
          <Route
            path={ROUTES.ROADMAP_SETTINGS}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_PRODUCT_ROADMAP]}
                requiredFeature={FeatureToggleKey.PRODUCT_ROADMAP}
                fullBleed
              >
                <RoadmapGate fallback={<NotFound />}>
                  <RoadmapFrame>
                    <RoadmapSettingsPage />
                  </RoadmapFrame>
                </RoadmapGate>
              </PrivateLayout>
            }
          />
          {/* Measures (P8): Owners only; the page sends anyone else to the Queue. */}
          <Route
            path={ROUTES.ROADMAP_MEASURES}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_PRODUCT_ROADMAP]}
                requiredFeature={FeatureToggleKey.PRODUCT_ROADMAP}
                fullBleed
              >
                <RoadmapGate fallback={<NotFound />}>
                  <RoadmapFrame>
                    <RoadmapMeasuresPage />
                  </RoadmapFrame>
                </RoadmapGate>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.ROADMAP_BUGS}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_PRODUCT_ROADMAP]}
                requiredFeature={FeatureToggleKey.PRODUCT_ROADMAP}
                fullBleed
              >
                <RoadmapGate fallback={<NotFound />}>
                  <RoadmapFrame>
                    <RoadmapBugsPage />
                  </RoadmapFrame>
                </RoadmapGate>
              </PrivateLayout>
            }
          />
          {/* User Interviews, out of the Roadmap into its own entry (D14), once roadmap_v2 is on. */}
          <Route
            path={ROUTES.USER_INTERVIEWS}
            element={
              <PrivateLayout
                requiredPermissions={[Permissions.VIEW_PRODUCT_ROADMAP]}
                requiredFeature={FeatureToggleKey.PRODUCT_ROADMAP}
              >
                <RoadmapGate fallback={<NotFound />}>
                  <RoadmapFrame>
                    <UserInterviewsPage />
                  </RoadmapFrame>
                </RoadmapGate>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.AI_LAB}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.AI_LAB}>
                <AILab />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.ANALYTICS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.ANALYTICS}>
                <Analytics />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.SETTINGS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.SETTINGS}>
                <Settings />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.CONTEXT_LIBRARY}
            element={
              // Platform admins, or an organisation's admins (the Ally organisation-settings
              // toggle), who see only their organisation's entries.
              <PrivateLayout
                requiredFeature={[
                  FeatureToggleKey.CONTEXT_LIBRARY,
                  FeatureToggleKey.ALLY_GUIDE_ORG,
                ]}
              >
                <ContextLibrary />
              </PrivateLayout>
            }
          />
          {/* The old Bug Hunter's address (and its ?bug= links in old PRs and chats) now
              opens Bug Hunter v2, its page since the old engine was removed (2026-11-23). */}
          <Route path={ROUTES.BUG_HUNTER} element={<BugHunterAddressRedirect />} />
          {/* Bug Hunter: the old page's components on v2's data, and v2's reports. */}
          <Route
            path={ROUTES.BUG_HUNTER_V2}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.BUG_HUNTER_V2_VERDICTS}>
                <BugHunter />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.BUG_HUNTER_V2_REPORT(":id")}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.BUG_HUNTER_V2_VERDICTS}>
                <BugHunterV2ReportDetail />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.PM_AGENT}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.PM_AGENT}>
                <PmAgentFeed />
              </PrivateLayout>
            }
          />
          {/* The Builder tab: Now · Rules · History. Mission control's full list moved to
            /builder/sessions, and /builder/decisions (linked from Slack) lands here. */}
          <Route
            path={ROUTES.BUILDER}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
                <RoadmapLegacyRedirect from="builder">
                  <BuilderRoom />
                </RoadmapLegacyRedirect>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.BUILDER_ALL_SESSIONS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
                <RoadmapLegacyRedirect from="builder">
                  <Builder />
                </RoadmapLegacyRedirect>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.BUILDER_SESSION(":sessionId")}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
                <RoadmapLegacyRedirect from="builder">
                  <BuilderSession />
                </RoadmapLegacyRedirect>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.BUILDER_DECISIONS}
            element={<Navigate to={ROUTES.BUILDER} replace />}
          />
          <Route
            path={ROUTES.BUILDER_SETTINGS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
                <RoadmapLegacyRedirect from="builder">
                  <BuilderSettings />
                </RoadmapLegacyRedirect>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.BUILDER_PIPELINE}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
                <RoadmapLegacyRedirect from="builder">
                  <BuilderPipeline />
                </RoadmapLegacyRedirect>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.BUILDER_SCOREBOARD}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
                <RoadmapLegacyRedirect from="builder">
                  <BuilderScoreboard />
                </RoadmapLegacyRedirect>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.BUILDER_KNOWLEDGE}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
                <RoadmapLegacyRedirect from="builder">
                  <BuilderKnowledge />
                </RoadmapLegacyRedirect>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.BUILDER_EVAL}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
                <RoadmapLegacyRedirect from="builder">
                  <BuilderEval />
                </RoadmapLegacyRedirect>
              </PrivateLayout>
            }
          />
          {/* Gated on the toggle AND the edit grant (one gate — a view-only session list is
            pointless without the chat). `new` is registered before `:sessionId`: React Router
            ranks static segments above params, but the order keeps that obvious to a reader. */}
          <Route
            path={ROUTES.COURSE_COPILOT}
            element={
              <PrivateLayout
                requiredFeature={FeatureToggleKey.COURSE_COPILOT}
                requiredPermissions={[Permissions.EDIT_COURSE_COPILOT]}
                alsoRequiredFeatures={[FeatureToggleKey.CREATE_COURSES]}
              >
                <CourseCopilotSessions />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.COURSE_COPILOT_NEW}
            element={
              <PrivateLayout
                requiredFeature={FeatureToggleKey.COURSE_COPILOT}
                requiredPermissions={[Permissions.EDIT_COURSE_COPILOT]}
                alsoRequiredFeatures={[FeatureToggleKey.CREATE_COURSES]}
              >
                <CourseCopilotNew />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.ROLEPLAY_AGENT}
            element={
              <PrivateLayout
                requiredFeature={FeatureToggleKey.COURSE_COPILOT}
                requiredPermissions={[Permissions.EDIT_COURSE_COPILOT]}
              >
                <RoleplayAgentPage />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.COURSE_COPILOT_SESSION(":sessionId")}
            element={
              <PrivateLayout
                requiredFeature={FeatureToggleKey.COURSE_COPILOT}
                requiredPermissions={[Permissions.EDIT_COURSE_COPILOT]}
                alsoRequiredFeatures={[FeatureToggleKey.CREATE_COURSES]}
              >
                <CourseCopilotSession />
              </PrivateLayout>
            }
          />
          {/* The toggle AND the view grant, as ally-be checks them; every edit control inside the page
            narrows further on EDIT_ALLY_GUIDE. */}
          <Route
            path={ROUTES.ALLY_CONSOLE}
            element={
              <PrivateLayout
                requiredFeature={FeatureToggleKey.ALLY_GUIDE}
                requiredPermissions={[Permissions.VIEW_ALLY_GUIDE]}
              >
                <AllyConsole />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.LOGS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.LOGS}>
                <Logs />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.MOBILE_RELEASES}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.MOBILE_RELEASES}>
                <MobileReleases />
              </PrivateLayout>
            }
          />
          <Route path={ROUTES.INBOX} element={<InboxRedirect />} />
          <Route
            path={ROUTES.WHATSAPP_BOT}
            element={
              // Full bleed, as the assistant home: the page draws its own background to the edges.
              // Open to anyone signed in (chunk 6b): it lists only the assistants they're on.
              <PrivateLayout fullBleed>
                <BuilderHome />
              </PrivateLayout>
            }
          />
          {/* Staff only (stage 2): defaults, shared quick replies, library and numbers. The grant
              is `system:access`, held by Ally staff and never by a tenant's own admins. */}
          <Route
            path={ROUTES.ASSISTANT_DEFAULTS}
            element={
              <PrivateLayout requiredPermissions={[Permissions.SYSTEM_ACCESS]}>
                <AssistantDefaults />
              </PrivateLayout>
            }
          />
          {/* Staff only (stage 8): find any chatbot and open it read-only; every read is logged. */}
          {[CHATBOT_SUPPORT_ROUTE, `${CHATBOT_SUPPORT_ROUTE}/:botId`].map(path => (
            <Route
              key={path}
              path={path}
              element={
                <PrivateLayout fullBleed requiredPermissions={[Permissions.SYSTEM_ACCESS]}>
                  <ChatbotSupport />
                </PrivateLayout>
              }
            />
          ))}
          {/* Onboarding (chunk 20a), before `:botId` so `new` is never read as a bot id. */}
          <Route
            path={ROUTES.CHATBOT_NEW}
            element={
              <PrivateLayout
                requiredFeature={FeatureToggleKey.WHATSAPP_BOT}
                requiredPermissions={[Permissions.EDIT_WHATSAPP_BOT]}
                fullBleed
              >
                <CreateGate>
                  <OnboardingStart />
                </CreateGate>
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.CHATBOT_NEW_SESSION(":draftId")}
            element={
              <PrivateLayout
                requiredFeature={FeatureToggleKey.WHATSAPP_BOT}
                requiredPermissions={[Permissions.EDIT_WHATSAPP_BOT]}
                fullBleed
              >
                <OnboardingSession />
              </PrivateLayout>
            }
          />
          <Route path={ROUTES.CHATBOT_DETAIL} element={<ChatbotDetailRoute />} />
          {/* Open to anyone signed in: ownership, not a permission, decides what they can change. */}
          <Route
            path={ROUTES.DIRECTORY}
            element={
              <PrivateLayout fullBleed>
                <Directory />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.DIRECTORY_COLLECTION}
            element={
              <PrivateLayout fullBleed>
                <CollectionDetail />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.WHATSAPP_BOT_LEGACY}
            element={<Navigate to={ROUTES.WHATSAPP_BOT} replace />}
          />
          <Route path={ROUTES.CHATBOTS_LEGACY} element={<ChatbotsLegacyRedirect />} />
          <Route path={`${ROUTES.CHATBOTS_LEGACY}/*`} element={<ChatbotsLegacyRedirect />} />
          <Route
            path={ROUTES.DEBRIEFS}
            element={
              <PrivateLayout requiredFeature={DEBRIEF_CONSOLE_FEATURES}>
                <DebriefConsole />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.DEBRIEF_SESSION(":runId")}
            element={
              <PrivateLayout requiredFeature={DEBRIEF_CONSOLE_FEATURES}>
                <DebriefSessionPage />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.DEBRIEF_SESSION_LOGS(":runId")}
            element={
              <PrivateLayout requiredFeature={DEBRIEF_CONSOLE_FEATURES}>
                <AgentLogsPage />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.DEBRIEFS_CHANGES}
            element={
              <PrivateLayout requiredFeature={DEBRIEF_CONSOLE_FEATURES}>
                <PmAgentPage />
              </PrivateLayout>
            }
          />
          <Route path={ROUTES.DEBRIEFS_PM_AGENT} element={<DebriefsPmAgentRedirect />} />
          <Route
            path={ROUTES.DEBRIEFS_SETTINGS}
            element={
              <PrivateLayout requiredFeature={DEBRIEF_CONSOLE_FEATURES}>
                <DebriefSettingsPage />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.AGENT_TEST_CASES}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.AGENT_TEST_CASES}>
                <AgentTestCases />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.COMPETENCIES}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.COMPETENCIES}>
                <Competencies />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.ROLEPLAY_SESSION_LOGS}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.ROLEPLAY_SESSION_LOGS}>
                <RoleplaySessionLogs />
              </PrivateLayout>
            }
          />
          <Route
            path={ROUTES.ROLEPLAY_SESSION_LOG_DETAIL(":id")}
            element={
              <PrivateLayout requiredFeature={FeatureToggleKey.ROLEPLAY_SESSION_LOGS}>
                <RoleplaySessionLogDetail />
              </PrivateLayout>
            }
          />
          {/* Anything else under the shell is a real 404 with a way home, not a silent redirect. */}
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="/" element={<DefaultRedirect />} />
        {/* No sign-up (A1): accounts are made by Ally admin or an owner's invite. */}
        <Route path={ROUTES.SIGN_UP} element={<Navigate to={ROUTES.LOGIN} replace />} />
        <Route path={ROUTES.SIGN_UP_ALT} element={<Navigate to={ROUTES.LOGIN} replace />} />
      </Routes>
    </BrowserRouter>
  );
};
