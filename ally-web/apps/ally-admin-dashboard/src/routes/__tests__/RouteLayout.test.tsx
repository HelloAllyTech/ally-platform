import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { FeatureToggleKey, Permissions, ROUTES } from "@constants";

import { RouteLayout } from "../RouteLayout";

// Pass-through wrappers for layouts. PrivateLayout also records the gate each route asked for, so a
// route's access rule can be asserted without standing up the entitlement queries behind it.
const privateLayoutCalls = vi.hoisted(() => ({
  props: [] as {
    requiredFeature?: string | string[];
    requiredPermissions?: string[];
    alsoRequiredFeatures?: string[];
  }[],
}));
vi.mock("../PrivateLayout", () => ({
  PrivateLayout: (props: {
    children: React.ReactNode;
    requiredFeature?: string | string[];
    requiredPermissions?: string[];
    alsoRequiredFeatures?: string[];
  }) => {
    privateLayoutCalls.props.push(props);
    return <>{props.children}</>;
  },
}));
// The shell (sidebar, palette) has its own suite; here it is just the layout route's outlet.
vi.mock("../AdminShell", async () => {
  const { Outlet } = await import("react-router-dom");
  return { AdminShell: () => <Outlet /> };
});
vi.mock("../PublicRoute", () => ({
  PublicRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// Stub DefaultRedirect (it depends on RTK Query/store); its own behavior is
// covered by DefaultRedirect.test.tsx.
vi.mock("../DefaultRedirect", () => ({
  DefaultRedirect: () => <div>DefaultRedirectPage</div>,
}));

// Stub out pages referenced by the router
vi.mock("@pages", () => ({
  CreateSimulation: () => <div>CreateSimulationPage</div>,
  LanguageGlossary: () => <div>LanguageGlossaryPage</div>,
  CreatePath: () => <div>CreatePathPage</div>,
  CreateTrack: () => <div>CreateTrackPage</div>,
  CreateCase: () => <div>CreateCasePage</div>,
  BlogManagement: () => <div>BlogManagementPage</div>,
  LandingPages: () => <div>LandingPagesPage</div>,
  LandingPageEditor: () => <div>LandingPageEditorPage</div>,
  ProductUpdates: () => <div>ProductUpdatesPage</div>,
  Login: () => <div>LoginPage</div>,
  MagicLinkVerify: () => <div>MagicLinkVerifyPage</div>,
  LiveSimulationPreview: () => <div>LiveSimulationPreviewPage</div>,
  SimulationStudio: () => <div>RolePlaysPage</div>,
  UserManagement: () => <div>UserManagementPage</div>,
  OrganizationDetail: () => <div>OrganizationDetailPage</div>,
  EventManagement: () => <div>EventManagementPage</div>,
  CharacterLibrary: () => <div>CharacterLibraryPage</div>,
  CharacterInterview: () => <div>CharacterInterviewPage</div>,
  ComponentLibrary: () => <div>ComponentLibraryPage</div>,
  ScenarioVoices: () => <div>ScenarioVoicesPage</div>,
  SttConfigs: () => <div>SttConfigsPage</div>,
  LlmConfigs: () => <div>LlmConfigsPage</div>,
  LlmModelCatalog: () => <div>LlmModelCatalogPage</div>,
  AiTasks: () => <div>AiTasksPage</div>,
  AllyConsole: () => <div>AllyConsolePage</div>,
  ScenarioLanguages: () => <div>ScenarioLanguagesPage</div>,
  SystemSkillsPage: () => <div>SystemSkillsPage</div>,
  UserBadges: () => <div>UserBadgesPage</div>,
  GuardrailsManagement: () => <div>GuardrailsManagementPage</div>,
  TranslationManagement: () => <div>TranslationManagementPage</div>,
  TooltipManagement: () => <div>TooltipManagementPage</div>,
  AgentTestCases: () => <div>AgentTestCasesPage</div>,
  DebriefConsole: () => <div>DebriefConsolePage</div>,
  DebriefSessionPage: () => <div>DebriefSessionPage</div>,
  AgentLogsPage: () => <div>AgentLogsPage</div>,
  PmAgentPage: () => <div>PmAgentPage</div>,
  DebriefSettingsPage: () => <div>DebriefSettingsPage</div>,
  Competencies: () => <div>CompetenciesPage</div>,
  RoleplaySessionLogs: () => <div>RoleplaySessionLogsPage</div>,
  RoleplaySessionLogDetail: () => <div>RoleplaySessionLogDetailPage</div>,
  Settings: () => <div>SettingsPage</div>,
  Logs: () => <div>LogsPage</div>,
  MobileReleases: () => <div>MobileReleasesPage</div>,
  BuilderHome: () => <div>BuilderHomePage</div>,
  AssistantDefaults: () => <div>AssistantDefaultsPage</div>,
  Terms: () => <div>TermsPage</div>,
  Privacy: () => <div>PrivacyPage</div>,
  AILab: () => <div>AILabPage</div>,
  ProductRoadmap: () => <div>ProductRoadmapPage</div>,
  RoadmapGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RoadmapQueuePage: () => <div>RoadmapQueuePage</div>,
  RoadmapProductUpdatesPage: () => <div>ProductUpdatesPage</div>,
  RoadmapIdeaPage: () => <div>RoadmapIdeaPage</div>,
  RoadmapDraftsPage: () => <div>RoadmapDraftsPage</div>,
  RoadmapNewIdeaPage: () => <div>RoadmapNewIdeaPage</div>,
  RoadmapFrame: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  // Pass-through: the redirect's own mapping is covered in pages/Roadmap/__tests__.
  RoadmapLegacyRedirect: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RoadmapAgentPage: () => <div>RoadmapAgentPage</div>,
  RoadmapSettingsPage: () => <div>RoadmapSettingsPage</div>,
  RoadmapMeasuresPage: () => <div>RoadmapMeasuresPage</div>,
  RoadmapBugsPage: () => <div>RoadmapBugsPage</div>,
  UserInterviewsPage: () => <div>UserInterviewsPage</div>,
  EvaluateLogin: () => <div>EvaluateLoginPage</div>,
  EvaluateRecords: () => <div>EvaluateRecordsPage</div>,
  EvaluateRecordDetail: () => <div>EvaluateRecordDetailPage</div>,
  BugHunter: () => <div>BugHunterPage</div>,
  Builder: () => <div>BuilderPage</div>,
  PmAgentFeed: () => <div>PmAgentFeedPage</div>,
  BuilderRoom: () => <div>BuilderRoomPage</div>,
  BuilderSession: () => <div>BuilderSessionPage</div>,
  BuilderSettings: () => <div>BuilderSettingsPage</div>,
  BuilderDecisions: () => <div>BuilderDecisionsPage</div>,
  BuilderPipeline: () => <div>BuilderPipelinePage</div>,
  BuilderScoreboard: () => <div>BuilderScoreboardPage</div>,
  BuilderKnowledge: () => <div>BuilderKnowledgePage</div>,
  BuilderEval: () => <div>BuilderEvalPage</div>,
  CourseCopilotSessions: () => <div>CourseCopilotSessionsPage</div>,
  CourseCopilotNew: () => <div>CourseCopilotNewPage</div>,
  CourseCopilotSession: () => <div>CourseCopilotSessionPage</div>,
}));

// Onboarding pulls in the QR-code library; the router only needs the two entry components.
vi.mock("../../pages/ChatbotSupport/ChatbotSupport", () => ({
  CHATBOT_SUPPORT_ROUTE: "/admin/chatbot-support",
  ChatbotSupport: () => <div>ChatbotSupportPage</div>,
}));
vi.mock("../../pages/Onboarding", () => ({
  OnboardingStart: () => <div>OnboardingStartPage</div>,
  OnboardingSession: () => <div>OnboardingSessionPage</div>,
}));

// The assistant home (chunk 20d) stands in for its real page, which needs the store.
vi.mock("../../pages/AssistantHome", () => ({
  AssistantHome: () => <div>AssistantHomePage</div>,
}));
describe("RouteLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens an assistant on its home, and an old ?view=classic link on the home too", () => {
    for (const path of [
      "/chatbots/bot-1",
      "/chatbots/bot-1?view=classic",
      "/chatbots/bot-1?view=classic&tab=usage",
    ]) {
      window.history.pushState({}, "", path);
      const { unmount } = render(<RouteLayout />);
      expect(screen.getByText("AssistantHomePage")).toBeInTheDocument();
      unmount();
    }
  });

  it("redirects old chatbot links to /assistants, keeping the section and query (A1)", () => {
    for (const [from, to] of [
      ["/chatbots", "/assistants"],
      ["/chatbots/bot-1?section=lists&tool=memory", "/assistants/bot-1?section=lists&tool=memory"],
      ["/chatbots/bot-1?section=share", "/assistants/bot-1?section=share"],
      ["/chatbots/bot-1?section=conversations", "/assistants/bot-1?section=conversations"],
      ["/whatsapp-bot", "/assistants"],
    ]) {
      window.history.pushState({}, "", from);
      const { unmount } = render(<RouteLayout />);
      expect(`${window.location.pathname}${window.location.search}`).toBe(to);
      unmount();
    }
  });

  it("opens an assistant at /assistants/:id edge to edge, inside the admin sidebar", () => {
    privateLayoutCalls.props.length = 0;
    window.history.pushState({}, "", "/assistants/bot-1?section=lists");
    render(<RouteLayout />);
    expect(screen.getByText("AssistantHomePage")).toBeInTheDocument();
    const last = privateLayoutCalls.props.at(-1) as { shell?: string; fullBleed?: boolean };
    expect(last.fullBleed).toBe(true);
    expect(last.shell).toBeUndefined();
  });

  it("has no sign-up: /signup and /sign-up go to the login screen (A1)", () => {
    for (const path of ["/signup", "/sign-up"]) {
      window.history.pushState({}, "", path);
      const { unmount } = render(<RouteLayout />);
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
      expect(window.location.pathname).toBe(ROUTES.LOGIN);
      unmount();
    }
  });

  it("renders Login route", () => {
    window.history.pushState({}, "", ROUTES.LOGIN);
    render(<RouteLayout />);
    expect(screen.getByText("LoginPage")).toBeInTheDocument();
  });

  it("renders MagicLinkVerify route", () => {
    window.history.pushState({}, "", ROUTES.MAGIC_VERIFY);
    render(<RouteLayout />);
    expect(screen.getByText("MagicLinkVerifyPage")).toBeInTheDocument();
  });

  it("renders Simulation Studio route", () => {
    window.history.pushState({}, "", ROUTES.SIMULATION_STUDIO);
    render(<RouteLayout />);
    expect(screen.getByText("RolePlaysPage")).toBeInTheDocument();
  });

  it("renders the landing pages list, gated on its toggle and permission", () => {
    privateLayoutCalls.props.length = 0;
    window.history.pushState({}, "", ROUTES.LANDING_PAGES);
    render(<RouteLayout />);
    expect(screen.getByText("LandingPagesPage")).toBeInTheDocument();
    const gate = privateLayoutCalls.props.at(-1);
    expect(gate?.requiredFeature).toBe(FeatureToggleKey.LANDING_PAGES);
    expect(gate?.requiredPermissions).toEqual([Permissions.VIEW_LANDING_PAGES]);
  });

  it("opens one landing page in the editor, edge to edge, behind the same gate", () => {
    privateLayoutCalls.props.length = 0;
    window.history.pushState({}, "", "/landing-pages/abc-123");
    render(<RouteLayout />);
    expect(screen.getByText("LandingPageEditorPage")).toBeInTheDocument();
    expect(screen.queryByText("LandingPagesPage")).not.toBeInTheDocument();
    const gate = privateLayoutCalls.props.at(-1) as { fullBleed?: boolean };
    expect(gate?.requiredFeature).toBe(FeatureToggleKey.LANDING_PAGES);
    expect(gate?.requiredPermissions).toEqual([Permissions.VIEW_LANDING_PAGES]);
    expect(gate?.fullBleed).toBe(true);
  });

  it("renders PM Agent at /pm-agent, gated on the pm_agent toggle", () => {
    privateLayoutCalls.props.length = 0;
    window.history.pushState({}, "", ROUTES.PM_AGENT);
    render(<RouteLayout />);
    expect(screen.getByText("PmAgentFeedPage")).toBeInTheDocument();
    expect(privateLayoutCalls.props.at(-1)?.requiredFeature).toBe(FeatureToggleKey.PM_AGENT);
  });

  it("renders the Builder tab (Now · Rules · History) at /builder", () => {
    window.history.pushState({}, "", ROUTES.BUILDER);
    render(<RouteLayout />);
    expect(screen.getByText("BuilderRoomPage")).toBeInTheDocument();
  });

  it("renders mission control's full session list at /builder/sessions, not the session route", () => {
    window.history.pushState({}, "", ROUTES.BUILDER_ALL_SESSIONS);
    render(<RouteLayout />);
    expect(screen.getByText("BuilderPage")).toBeInTheDocument();
    expect(screen.queryByText("BuilderSessionPage")).not.toBeInTheDocument();
  });

  // The session route is a separate assertion from the list route because the
  // two differ only by a path param — a mistyped param pattern would leave the
  // list route passing while every session link 404s.
  it("renders Builder session route with id", () => {
    window.history.pushState({}, "", ROUTES.BUILDER_SESSION("abc-123"));
    render(<RouteLayout />);
    expect(screen.getByText("BuilderSessionPage")).toBeInTheDocument();
  });

  it("renders Builder settings route", () => {
    window.history.pushState({}, "", ROUTES.BUILDER_SETTINGS);
    render(<RouteLayout />);
    expect(screen.getByText("BuilderSettingsPage")).toBeInTheDocument();
  });

  // Slack messages still link /builder/decisions; it lands on the Builder tab.
  it("sends the old decisions route to the Builder tab, not the session route", () => {
    window.history.pushState({}, "", ROUTES.BUILDER_DECISIONS);
    render(<RouteLayout />);
    expect(screen.getByText("BuilderRoomPage")).toBeInTheDocument();
    expect(screen.queryByText("BuilderSessionPage")).not.toBeInTheDocument();
  });

  it("renders Builder pipeline route", () => {
    window.history.pushState({}, "", ROUTES.BUILDER_PIPELINE);
    render(<RouteLayout />);
    expect(screen.getByText("BuilderPipelinePage")).toBeInTheDocument();
  });

  it("renders Builder scoreboard route", () => {
    window.history.pushState({}, "", ROUTES.BUILDER_SCOREBOARD);
    render(<RouteLayout />);
    expect(screen.getByText("BuilderScoreboardPage")).toBeInTheDocument();
  });

  it("renders Builder knowledge route", () => {
    window.history.pushState({}, "", ROUTES.BUILDER_KNOWLEDGE);
    render(<RouteLayout />);
    expect(screen.getByText("BuilderKnowledgePage")).toBeInTheDocument();
  });

  it("renders Builder eval route", () => {
    window.history.pushState({}, "", ROUTES.BUILDER_EVAL);
    render(<RouteLayout />);
    expect(screen.getByText("BuilderEvalPage")).toBeInTheDocument();
  });

  it("renders Course Copilot sessions route", () => {
    window.history.pushState({}, "", ROUTES.COURSE_COPILOT);
    render(<RouteLayout />);
    expect(screen.getByText("CourseCopilotSessionsPage")).toBeInTheDocument();
  });

  // `new` is a static segment beside `:sessionId`; this fails if the two are ever mis-ordered or
  // the param pattern swallows it, which would send every "Course with Copilot" click to a
  // session lookup for an id of "new".
  it("renders Course Copilot new route, not the session route", () => {
    window.history.pushState({}, "", `${ROUTES.COURSE_COPILOT_NEW}?trackId=abc`);
    render(<RouteLayout />);
    expect(screen.getByText("CourseCopilotNewPage")).toBeInTheDocument();
    expect(screen.queryByText("CourseCopilotSessionPage")).not.toBeInTheDocument();
  });

  it("renders Course Copilot session route with id", () => {
    window.history.pushState({}, "", ROUTES.COURSE_COPILOT_SESSION("abc-123"));
    render(<RouteLayout />);
    expect(screen.getByText("CourseCopilotSessionPage")).toBeInTheDocument();
  });

  it("renders a run's Agent logs at /debriefs/sessions/:runId/logs, not the session route", () => {
    window.history.pushState({}, "", ROUTES.DEBRIEF_SESSION_LOGS("r1"));
    render(<RouteLayout />);
    expect(screen.getByText("AgentLogsPage")).toBeInTheDocument();
    expect(screen.queryByText("DebriefSessionPage")).not.toBeInTheDocument();
  });

  // CONSOLE_API "Roles": the Analytics toggle or the clinical advisor's toggle opens the console,
  // as ally-be's DebriefRead allows; an advisor has only the second.
  it("opens the Debrief console with the Analytics or the clinical-advisor toggle", () => {
    for (const path of [ROUTES.DEBRIEFS, ROUTES.DEBRIEF_SESSION("r1")]) {
      privateLayoutCalls.props.length = 0;
      window.history.pushState({}, "", path);
      render(<RouteLayout />);
      expect(privateLayoutCalls.props.at(-1)?.requiredFeature).toEqual([
        FeatureToggleKey.ANALYTICS,
        FeatureToggleKey.DEBRIEF_CLINICAL_SIGN_OFF,
      ]);
    }
  });

  describe("Ally Console route", () => {
    it("renders at /ally", () => {
      window.history.pushState({}, "", ROUTES.ALLY_CONSOLE);
      render(<RouteLayout />);
      expect(screen.getByText("AllyConsolePage")).toBeInTheDocument();
    });

    // The pair ally-be checks on the console's routes. The permission alone reaches every
    // platform admin since the role collapse, so the toggle is the gate that matters here.
    it("is gated on the ally_guide toggle AND the view permission", () => {
      privateLayoutCalls.props.length = 0;
      window.history.pushState({}, "", ROUTES.ALLY_CONSOLE);
      render(<RouteLayout />);

      const gate = privateLayoutCalls.props.at(-1);
      expect(gate?.requiredFeature).toBe(FeatureToggleKey.ALLY_GUIDE);
      expect(gate?.requiredPermissions).toEqual([Permissions.VIEW_ALLY_GUIDE]);
    });

    it("is not gated on the edit permission, which narrows controls inside the page instead", () => {
      privateLayoutCalls.props.length = 0;
      window.history.pushState({}, "", ROUTES.ALLY_CONSOLE);
      render(<RouteLayout />);

      expect(privateLayoutCalls.props.at(-1)?.requiredPermissions).not.toContain(
        Permissions.EDIT_ALLY_GUIDE,
      );
    });
  });

  describe("assistants home (stage 2)", () => {
    it("renders the builder home at /assistants", () => {
      window.history.pushState({}, "", ROUTES.WHATSAPP_BOT);
      render(<RouteLayout />);
      expect(screen.getByText("BuilderHomePage")).toBeInTheDocument();
    });

    it("sends the old /inbox link, and any ?tab=, to the home (the Inbox tab is gone)", () => {
      window.history.pushState({}, "", "/inbox?tab=inbox&conversation=c1");
      render(<RouteLayout />);
      expect(window.location.pathname).toBe("/assistants");
      expect(window.location.search).toBe("");
      expect(screen.getByText("BuilderHomePage")).toBeInTheDocument();
    });

    it("puts Defaults, Library and Connectors on a staff route gated on system:access", () => {
      privateLayoutCalls.props.length = 0;
      window.history.pushState({}, "", ROUTES.ASSISTANT_DEFAULTS);
      render(<RouteLayout />);
      expect(screen.getByText("AssistantDefaultsPage")).toBeInTheDocument();
      const gate = privateLayoutCalls.props.at(-1);
      expect(gate?.requiredPermissions).toEqual([Permissions.SYSTEM_ACCESS]);
      // Staff pages never depend on the Chatbots toggle.
      expect(gate?.requiredFeature).toBeUndefined();
    });

    it.each([
      [ROUTES.SAFETY_PACKS, [Permissions.MANAGE_SAFETY_PACKS]],
      ["/admin/chatbot-support", [Permissions.SYSTEM_ACCESS]],
      ["/admin/chatbot-support/b1", [Permissions.SYSTEM_ACCESS]],
    ])(
      "gates the staff page %s on its staff permission, never the Chatbots toggle",
      (path, perms) => {
        privateLayoutCalls.props.length = 0;
        window.history.pushState({}, "", path);
        render(<RouteLayout />);
        const gate = privateLayoutCalls.props.at(-1);
        expect(gate?.requiredPermissions).toEqual(perms);
        expect(gate?.requiredFeature).toBeUndefined();
      },
    );

    it("gates Credits on manage_costs", () => {
      privateLayoutCalls.props.length = 0;
      window.history.pushState({}, "", ROUTES.BILLING_CREDITS);
      render(<RouteLayout />);
      expect(privateLayoutCalls.props.at(-1)?.requiredFeature).toBe(FeatureToggleKey.MANAGE_COSTS);
    });
  });

  it("renders Component Library route", () => {
    window.history.pushState({}, "", ROUTES.COMPONENT_LIBRARY);
    render(<RouteLayout />);
    expect(screen.getByText("ComponentLibraryPage")).toBeInTheDocument();
  });

  it("renders User Management route", () => {
    window.history.pushState({}, "", ROUTES.USER_MANAGEMENT);
    render(<RouteLayout />);
    expect(screen.getByText("UserManagementPage")).toBeInTheDocument();
  });

  it("renders Organization Detail route with id", () => {
    const path = ROUTES.ORGANIZATION_DETAIL("123");
    window.history.pushState({}, "", path);
    render(<RouteLayout />);
    expect(screen.getByText("OrganizationDetailPage")).toBeInTheDocument();
  });

  it("renders Create Simulation route", () => {
    window.history.pushState({}, "", ROUTES.CREATE_SIMULATION);
    render(<RouteLayout />);
    expect(screen.getByText("CreateSimulationPage")).toBeInTheDocument();
  });

  it("renders Simulation Preview route with id", () => {
    const path = ROUTES.SIMULATION_PREVIEW("123");
    window.history.pushState({}, "", path);
    render(<RouteLayout />);
    expect(screen.getByText("LiveSimulationPreviewPage")).toBeInTheDocument();
  });

  it("renders Edit Simulation route with id", () => {
    const path = ROUTES.EDIT_SIMULATION("999");
    window.history.pushState({}, "", path);
    render(<RouteLayout />);
    expect(screen.getByText("CreateSimulationPage")).toBeInTheDocument();
  });

  it("renders Event Management route", () => {
    window.history.pushState({}, "", ROUTES.MANAGE_EVENTS);
    render(<RouteLayout />);
    expect(screen.getByText("EventManagementPage")).toBeInTheDocument();
  });

  it("renders Scenario Voices route", () => {
    window.history.pushState({}, "", ROUTES.MANAGE_SCENARIO_VOICES);
    render(<RouteLayout />);
    expect(screen.getByText("ScenarioVoicesPage")).toBeInTheDocument();
  });

  it("renders Manage Prompts route", () => {
    window.history.pushState({}, "", ROUTES.MANAGE_PROMPTS);
    render(<RouteLayout />);
    expect(screen.getByText("SystemSkillsPage")).toBeInTheDocument();
  });

  it("renders DefaultRedirect at the root route", () => {
    window.history.pushState({}, "", "/");
    render(<RouteLayout />);
    expect(screen.getByText("DefaultRedirectPage")).toBeInTheDocument();
  });

  it("shows a 404 with a link home for an unknown route, instead of redirecting", () => {
    window.history.pushState({}, "", "/unknown-path");
    render(<RouteLayout />);
    expect(screen.queryByText("RolePlaysPage")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-not-found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your home page" })).toHaveAttribute("href", "/");
    expect(window.location.pathname).toBe("/unknown-path");
    expect(document.title).toBe("Page not found · Ally Admin");
  });
});
