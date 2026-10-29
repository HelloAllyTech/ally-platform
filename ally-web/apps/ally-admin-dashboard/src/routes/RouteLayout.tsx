import React, { lazy, Suspense } from "react";

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

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
  ProductUpdates,
  AILab,
  ProductRoadmap,
  Settings,
  Logs,
  MobileReleases,
  BugHunter,
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
  CourseCopilotSessions,
  AgentTestCases,
  Competencies,
  DebriefConsole,
  RoleplaySessionLogs,
  RoleplaySessionLogDetail,
  Terms,
  Privacy,
  EvaluateLogin,
  EvaluateRecords,
  EvaluateRecordDetail,
  WhatsAppBot,
} from "@pages";

import { DefaultRedirect } from "./DefaultRedirect";
import { PrivateLayout } from "./PrivateLayout";
import { PublicRoute } from "./PublicRoute";

// Lazy-loaded so IBM Carbon + Carbon Charts (+ d3) and the scoped Carbon
// stylesheet ship as their own chunk, loaded only when the Analytics tab opens.
const Analytics = lazy(() =>
  import("../pages/Analytics/Analytics").then(module => ({ default: module.Analytics })),
);

// Public design-system gallery. Lazy-loaded (kept out of the eager @pages
// barrel) so this browse-only showcase never weighs on the main admin bundle.
const DesignSystem = lazy(() =>
  import("../pages/DesignSystem/DesignSystem").then(module => ({ default: module.DesignSystem })),
);

export const RouteLayout: React.FC = () => {
  return (
    <BrowserRouter>
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

        {/* Evaluator micro-app — its own email+password session (NOT admin
            auth); the pages gate themselves on the evaluator token. */}
        <Route path={ROUTES.EVALUATE} element={<EvaluateLogin />} />
        <Route path={ROUTES.EVALUATE_RECORDS} element={<EvaluateRecords />} />
        <Route path={ROUTES.EVALUATE_RECORD(":assignmentId")} element={<EvaluateRecordDetail />} />

        {/* Private Routes */}
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
          path={ROUTES.SIMULATION_PREVIEW(":id")}
          element={
            <PrivateLayout isPreview={true} requiredPermissions={[Permissions.VIEW_ADMIN_SCENARIO]}>
              <LiveSimulationPreview />
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
          path={ROUTES.PRODUCT_UPDATES}
          element={
            <PrivateLayout
              requiredPermissions={[Permissions.EDIT_BLOG]}
              requiredFeature={FeatureToggleKey.PRODUCT_UPDATES}
            >
              <ProductUpdates />
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
              <ProductRoadmap />
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
              <Suspense fallback={null}>
                <Analytics />
              </Suspense>
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
          path={ROUTES.BUG_HUNTER}
          element={
            <PrivateLayout requiredFeature={FeatureToggleKey.BUG_HUNTER}>
              <BugHunter />
            </PrivateLayout>
          }
        />
        {/* The Builder tab: Now · Rules · History. Mission control's full list moved to
            /builder/sessions, and /builder/decisions (linked from Slack) lands here. */}
        <Route
          path={ROUTES.BUILDER}
          element={
            <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
              <BuilderRoom />
            </PrivateLayout>
          }
        />
        <Route
          path={ROUTES.BUILDER_ALL_SESSIONS}
          element={
            <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
              <Builder />
            </PrivateLayout>
          }
        />
        <Route
          path={ROUTES.BUILDER_SESSION(":sessionId")}
          element={
            <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
              <BuilderSession />
            </PrivateLayout>
          }
        />
        <Route path={ROUTES.BUILDER_DECISIONS} element={<Navigate to={ROUTES.BUILDER} replace />} />
        <Route
          path={ROUTES.BUILDER_SETTINGS}
          element={
            <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
              <BuilderSettings />
            </PrivateLayout>
          }
        />
        <Route
          path={ROUTES.BUILDER_PIPELINE}
          element={
            <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
              <BuilderPipeline />
            </PrivateLayout>
          }
        />
        <Route
          path={ROUTES.BUILDER_SCOREBOARD}
          element={
            <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
              <BuilderScoreboard />
            </PrivateLayout>
          }
        />
        <Route
          path={ROUTES.BUILDER_KNOWLEDGE}
          element={
            <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
              <BuilderKnowledge />
            </PrivateLayout>
          }
        />
        <Route
          path={ROUTES.BUILDER_EVAL}
          element={
            <PrivateLayout requiredFeature={FeatureToggleKey.BUILDER}>
              <BuilderEval />
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
        <Route
          path={ROUTES.WHATSAPP_BOT}
          element={
            <PrivateLayout requiredFeature={FeatureToggleKey.WHATSAPP_BOT}>
              <WhatsAppBot />
            </PrivateLayout>
          }
        />
        <Route
          path={ROUTES.DEBRIEFS}
          element={
            <PrivateLayout requiredFeature={FeatureToggleKey.ANALYTICS}>
              <DebriefConsole />
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
        <Route path="/" element={<DefaultRedirect />} />

        <Route path="*" element={<Navigate to={ROUTES.SIMULATION_STUDIO} replace />} />
      </Routes>
    </BrowserRouter>
  );
};
