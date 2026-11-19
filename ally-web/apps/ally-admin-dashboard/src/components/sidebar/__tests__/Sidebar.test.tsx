import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

const navigateMock = vi.fn();
const logoutMock = vi.fn();
const trackMock = vi.fn();

// Lets a test sign in someone who can open no page at all.
const navState: { empty: boolean; permissions: string[]; pathname: string; search: string } =
  vi.hoisted(() => ({
    empty: false,
    permissions: ["system:access"],
    pathname: "/simulation-studio",
    search: "",
  }));

let mockUser = {
  name: "Alice",
  email: "alice@example.com",
  features: [] as string[],
};

// Mock API first to prevent store initialization errors
vi.mock("@api", () => ({
  // evaluatorAPI is wired into the store alongside baseAPI; stub it too so
  // store init (reducerPath/reducer/middleware) does not throw.
  evaluatorAPI: {
    reducerPath: "evaluatorAPI",
    reducer: (state = {}) => state,
    middleware: () => (next: any) => (action: any) => next(action),
    util: { resetApiState: () => ({ type: "reset" }) },
  },
  baseAPI: {
    injectEndpoints: vi.fn(() => ({})),
    reducerPath: "baseAPI",
    reducer: (state = {}) => state,
    middleware: () => (next: any) => (action: any) => next(action),
  },
  // The Bug Hunter tab carries a waiting-on-you badge that queries this. It is
  // not in this test's nav items, so nothing renders it today — stubbed anyway
  // so adding that tab to the list here doesn't fail on a missing mock export.
  useGetBugHunterNotificationsQuery: () => ({ data: undefined }),
  // CR1: the account menu's Plan and usage item asks whether there is a plan to show.
  useGetMyPlanQuery: () => ({ data: undefined }),
}));

import { CustomImage } from "@ally-ui-mono/ui-shared";

vi.mock("@ally-ui-mono/ui-shared", () => ({
  CustomImage: ({ alt }: any) => <img alt={alt} />,
  useAnalytics: () => ({ track: trackMock }),
  ANALYTICS_EVENTS: { SIDEBAR_INTERACTION: "sidebar_interaction" },
  ANALYTICS_PROPS: { ACTION: "action" },
}));

import { store } from "../../../store";
import { Sidebar } from "../Sidebar";

// Links are real (they are what the sidebar renders); only the location and logout navigation are stubbed.
vi.mock("react-router-dom", async importOriginal => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useLocation: vi.fn(() => ({ pathname: navState.pathname, search: navState.search })),
  useNavigate: vi.fn(() => navigateMock),
}));

vi.mock("@assets", () => ({
  ArrowDown: () => <svg data-testid="arrow-down" />,
  Book: () => <svg data-testid="icon-book" />,
  User: () => <svg data-testid="icon-user" />,
  Users: () => <svg data-testid="icon-users" />,
  Ally: () => <svg data-testid="logo-ally" />,
  DockToRight: () => <svg data-testid="dock" />,
  Logout: () => <svg data-testid="logout" />,
  HappyEmoji: () => <svg data-testid="happy" />,
  ManageAccounts: () => <svg data-testid="manage-accounts" />,
  Globe: () => <svg data-testid="globe" />,
  Mic: () => <svg data-testid="mic" />,
  UserSpeaker: () => <svg data-testid="user-speaker" />,
  CharacterLibrary: () => <svg data-testid="character-library" />,
  FrameSource: () => <svg data-testid="frame-source" />,
  Guardrails: () => <svg data-testid="guardrails" />,
  Badge: () => <svg data-testid="badge" />,
}));

vi.mock("@hooks", () => ({
  useClickOutside: (_ref: any, _handler: any) => {},
  useUser: () => ({
    user: mockUser,
    logout: logoutMock,
    features: mockUser.features,
    permissions: navState.permissions,
    filteredNavigationItems: navState.empty
      ? []
      : [
          {
            id: "SIMULATION_STUDIO",
            label: "Simulation Studio",
            path: "/simulation-studio",
            section: "create",
          },
          { id: "EVENT_MANAGEMENT", label: "Events", path: "/events", section: "create" },
          { id: "USERS", label: "Users", path: "/users", section: "people" },
          { id: "ANALYTICS", label: "Analytics", path: "/analytics", section: "insights" },
          {
            id: "CONVERSATION_DRIFT",
            label: "Conversation Drift",
            path: "/analytics?tab=drift",
            section: "insights",
          },
          {
            id: "SCENARIO_LANGUAGES",
            label: "Scenario Languages",
            path: "/manage-scenario-languages",
            section: "ai-languages",
          },
          {
            id: "SCENARIO_VOICES",
            label: "Scenario Voices",
            path: "/manage-scenario-voices",
            section: "ai-languages",
          },
          { id: "PROMPTS", label: "Prompts", path: "/manage-prompts", section: "ai-languages" },
          {
            id: "TRANSLATIONS",
            label: "Translations",
            path: "/manage-translations",
            section: "ai-languages",
          },
          { id: "SETTINGS", label: "Settings", path: "/settings", section: "settings-logs" },
        ],
  }),
}));

vi.mock("@components", () => ({
  UserModal: () => null,
}));

// The quick actions have their own suites (speech, drafts API, colour mode); here we only need to
// know the primary nav carries them.
vi.mock("@components/notification-bell/NotificationBell", () => ({
  NotificationBell: () => <button data-testid="notification-bell" />,
}));
vi.mock("@components/idea-capture/IdeaCapture", () => ({
  IdeaCaptureLauncher: () => <button data-testid="idea-capture-button" />,
}));
vi.mock("@components/color-mode-toggle/ColorModeToggle", () => ({
  ColorModeToggle: () => <button data-testid="color-mode-toggle" />,
}));

vi.mock("@constants", () => ({
  ReportGenerationStatus: {
    STARTED: "STARTED",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
    FAILED: "FAILED",
  },
  SIDEBAR_ITEMS: {
    SIMULATION_STUDIO: "SIMULATION_STUDIO",
    USERS: "USERS",
    EVENT_MANAGEMENT: "EVENT_MANAGEMENT",
    SCENARIO_VOICES: "SCENARIO_VOICES",
    SCENARIO_LANGUAGES: "SCENARIO_LANGUAGES",
    PROMPTS: "PROMPTS",
    TRANSLATIONS: "TRANSLATIONS",
    ANALYTICS: "ANALYTICS",
    CONVERSATION_DRIFT: "CONVERSATION_DRIFT",
  },
  ROUTES: {
    ANALYTICS: "/analytics",
    SIMULATION_STUDIO: "/simulation-studio",
    CREATE_SIMULATION: "/simulation-studio/create",
    CREATE_PATH: "/create-path",
    USER_MANAGEMENT: "/users",
    MANAGE_EVENTS: "/events",
    MANAGE_SCENARIO_VOICES: "/manage-scenario-voices",
    MANAGE_SCENARIO_LANGUAGES: "/manage-scenario-languages",
    MANAGE_PROMPTS: "/manage-prompts",
    MANAGE_TRANSLATIONS: "/manage-translations",
    LOGIN: "/login",
  },
  en: {
    nav: {
      mainNavLabel: "Main navigation",
      expandSection: (label: string) => `Expand ${label}`,
      collapseSection: (label: string) => `Collapse ${label}`,
      sections: {
        create: "Create",
        people: "People",
        insights: "Insights",
        aiLanguages: "AI & Languages",
        product: "Product",
        settingsLogs: "Settings & Logs",
      },
      palette: { open: "Search pages (Ctrl+K)" },
    },
    common: {
      searchMenu: "Search menu...",
      noMenuResults: "No matching tabs",
      noMenuAccess: "Your account can't open any page here yet.",
      clearSearch: "Clear search",
    },
    roadmapV2: {
      reduceMotion: { label: "Reduce motion", help: "Replaces movement with quick fades." },
    },
    auth: {
      logout: "Logout",
      profileSettings: "Profile Settings",
      uploadImage: "Upload Image",
      profileImage: "Profile Image",
    },
    simulation: {
      triggerEvent: "Trigger Event",
      triggerMessage: "Trigger Message",
      terminationMessagePlaceholder: "Enter termination message",
    },
  },
  TAG_TYPES: {
    USERS: "users",
    TENANTS: "tenants",
    SESSION_EVENTS: "sessionEvents",
    SIMULATION: "simulation",
    SIMULATION_EVENTS: "simulationEvents",
  },
  profileSettings: [
    { name: "name", label: "Name", type: "text" },
    { name: "email", label: "Email", type: "email" },
  ],
  USER_MODAL_FIELDS_IDS: {
    PROFILE: "profile",
  },
  KeyboardKeys: {
    KEYDOWN: "keydown",
    ESCAPE: "Escape",
  },
}));

const renderWithProvider = (component: React.ReactElement) => {
  return render(
    <Provider store={store}>
      <MemoryRouter>{component}</MemoryRouter>
    </Provider>,
  );
};

describe("Sidebar", () => {
  beforeEach(() => {
    navState.empty = false;
    navigateMock.mockReset();
    logoutMock.mockReset();
    localStorage.clear();
    navState.pathname = "/simulation-studio";
    navState.search = "";
    // Mock window.innerWidth to be large enough to keep sidebar expanded
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1400,
    });
  });

  it("says so when a signed-in user can open no page, instead of an empty sidebar", () => {
    navState.empty = true;
    renderWithProvider(<Sidebar />);
    expect(screen.getByTestId("sidebar-no-access")).toHaveTextContent(
      "Your account can't open any page here yet.",
    );
  });

  it("shows no such note while there are pages to open", () => {
    renderWithProvider(<Sidebar />);
    expect(screen.queryByTestId("sidebar-no-access")).toBeNull();
  });

  it("renders navigation items by title when collapsed", () => {
    // Mock narrow window to force collapsed state
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 800 });
    renderWithProvider(<Sidebar />);

    const simItem = screen.getByTitle("Simulation Studio");
    expect(simItem).toBeInTheDocument();
    expect(simItem).toHaveAttribute("href", "/simulation-studio");
    // The collapsed rail has no text, so the link keeps its name for screen readers.
    expect(simItem).toHaveAttribute("aria-label", "Simulation Studio");
  });

  it("toggles expand/collapse via the toggle button", () => {
    renderWithProvider(<Sidebar />);

    // Sidebar starts expanded when window is wide
    const simItem = screen.getByText("Simulation Studio");
    expect(simItem).toBeInTheDocument();

    const collapseBtn = screen.getByTitle("Collapse sidebar");
    fireEvent.click(collapseBtn);

    // After collapse, text should be hidden and only title remains
    expect(screen.queryByText("Simulation Studio")).not.toBeInTheDocument();
    expect(screen.getByTitle("Simulation Studio")).toBeInTheDocument();
  });

  it("carries the idea mic and light/dark switch in the primary nav, expanded or collapsed", () => {
    renderWithProvider(<Sidebar />);
    const sidebar = screen.getByTestId("admin-sidebar");
    const actions = screen.getByTestId("sidebar-quick-actions");
    expect(sidebar).toContainElement(actions);
    expect(actions).toContainElement(screen.getByTestId("idea-capture-button"));
    expect(actions).toContainElement(screen.getByTestId("color-mode-toggle"));
    expect(actions).toHaveClass("flex-row");

    fireEvent.click(screen.getByTitle("Collapse sidebar"));
    expect(screen.getByTestId("sidebar-quick-actions")).toHaveClass("flex-col");
    expect(screen.getByTestId("color-mode-toggle")).toBeInTheDocument();
  });

  it("opens user menu and logs out when expanded", () => {
    renderWithProvider(<Sidebar />);

    // Click profile section (name/email present when expanded)
    fireEvent.click(screen.getByText("Alice"));

    expect(screen.getByText("Logout")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Logout"));

    expect(logoutMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith("/login");
  });

  it("keeps the account menu open while tabbing inside it, and closes on Escape", () => {
    renderWithProvider(<Sidebar />);
    const trigger = screen.getByTestId("sidebar-profile-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const items = screen.getAllByRole("menuitem");
    items[0].focus();
    // Focus moving to the next item is not leaving the menu.
    fireEvent.blur(items[0], { relatedTarget: items[1] });
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(items[0], { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("sits above page content in every mode, so its popovers are never painted under it", () => {
    renderWithProvider(<Sidebar />);
    expect(screen.getByTestId("admin-sidebar").className).toContain("z-[70]");
    expect(screen.getByTestId("admin-sidebar").className).not.toContain("md:z-auto");
  });

  it("marks the active tab with aria-current, and only that one", () => {
    renderWithProvider(<Sidebar />);
    const current = screen
      .getAllByRole("link")
      .filter(a => a.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Simulation Studio");
  });

  it("splits /analytics between Analytics and Conversation Drift by tab", () => {
    navState.pathname = "/analytics";
    navState.search = "?tab=drift";
    renderWithProvider(<Sidebar />);
    expect(screen.getByRole("link", { name: "Conversation Drift" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Analytics" })).not.toHaveAttribute("aria-current");
  });

  it("is a labelled navigation landmark of real links, with no section headings", () => {
    renderWithProvider(<Sidebar />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav).toContainElement(screen.getByRole("link", { name: "Users" }));
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("href", "/users");
    // One flat list: no group headings.
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("lets a modified click through to the browser (new tab) without treating it as navigation", () => {
    const onMobileClose = vi.fn();
    renderWithProvider(<Sidebar isMobileOpen onMobileClose={onMobileClose} />);
    const link = screen.getByRole("link", { name: "Events" });
    // fireEvent returns false when a handler called preventDefault; the browser must keep the click.
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(onMobileClose).not.toHaveBeenCalled();
  });

  it("narrows the flat list to the matches while searching", () => {
    renderWithProvider(<Sidebar />);
    fireEvent.change(screen.getByLabelText("Search menu..."), { target: { value: "voices" } });
    expect(screen.getByText("Scenario Voices")).toBeInTheDocument();
    expect(screen.queryByText("Events")).not.toBeInTheDocument();
  });

  it("renders Scenario Voices navigation item", () => {
    renderWithProvider(<Sidebar />);

    const voicesItem = screen.getByText("Scenario Voices");
    expect(voicesItem).toBeInTheDocument();
  });

  it("links Scenario Voices and Translations to their pages", () => {
    renderWithProvider(<Sidebar />);

    expect(screen.getByRole("link", { name: "Scenario Voices" })).toHaveAttribute(
      "href",
      "/manage-scenario-voices",
    );
    expect(screen.getByRole("link", { name: "Translations" })).toHaveAttribute(
      "href",
      "/manage-translations",
    );
  });

  it("displays Scenario Voices with correct title when collapsed", () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 800 });
    renderWithProvider(<Sidebar />);

    const voicesItem = screen.getByTitle("Scenario Voices");
    expect(voicesItem).toBeInTheDocument();
  });

  it("includes all navigation items in order", () => {
    renderWithProvider(<Sidebar />);

    expect(screen.getByText("Simulation Studio")).toBeInTheDocument();
    expect(screen.getByText("Events")).toBeInTheDocument();
    expect(screen.getByText("Scenario Voices")).toBeInTheDocument();
    expect(screen.getByText("Scenario Languages")).toBeInTheDocument();
    expect(screen.getByText("Translations")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
  });

  describe("phone drawer", () => {
    it("shows tab labels at phone width instead of the icon rail", () => {
      Object.defineProperty(window, "innerWidth", {
        writable: true,
        configurable: true,
        value: 375,
      });
      renderWithProvider(<Sidebar isMobileOpen onMobileClose={vi.fn()} />);

      expect(screen.getByText("Simulation Studio")).toBeInTheDocument();
    });

    it("is slid out and hidden from assistive tech while closed", () => {
      renderWithProvider(<Sidebar />);

      expect(screen.getByTestId("admin-sidebar")).toHaveClass("-translate-x-full", "invisible");
      expect(screen.queryByTestId("admin-sidebar-overlay")).not.toBeInTheDocument();
    });

    it("closes from its close button, its overlay, and navigation", () => {
      const onMobileClose = vi.fn();
      renderWithProvider(<Sidebar isMobileOpen onMobileClose={onMobileClose} />);

      expect(screen.getByTestId("admin-sidebar")).toHaveClass("translate-x-0");
      fireEvent.click(screen.getByTestId("admin-sidebar-close"));
      fireEvent.click(screen.getByTestId("admin-sidebar-overlay"));
      fireEvent.click(screen.getByText("Events"));

      expect(onMobileClose).toHaveBeenCalledTimes(3);
      expect(screen.getByRole("link", { name: "Events" })).toHaveAttribute("href", "/events");
    });
  });

  describe("R1-R6: Hover and Pin behavior", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      localStorage.clear();
      mockUser = {
        name: "Alice",
        email: "alice@example.com",
        features: ["sidebar_hover_expand"],
      };
    });

    it("R1: should render in collapsed state by default when feature is enabled", () => {
      renderWithProvider(<Sidebar />);
      expect(screen.queryByText("Simulation Studio")).not.toBeInTheDocument();
      expect(screen.getByTitle("Simulation Studio")).toBeInTheDocument();
    });

    it("R2: should expand on hover as an overlay and collapse on mouse leave", () => {
      renderWithProvider(<Sidebar />);
      const sidebar = screen.getByTestId("admin-sidebar");

      fireEvent.mouseEnter(sidebar);
      expect(screen.getByText("Simulation Studio")).toBeInTheDocument();
      expect(sidebar).toHaveClass("md:absolute");

      fireEvent.mouseLeave(sidebar);
      expect(screen.queryByText("Simulation Studio")).not.toBeInTheDocument();
      expect(sidebar).not.toHaveClass("md:absolute");
    });

    it("R4: should have 200ms animation duration", () => {
      renderWithProvider(<Sidebar />);
      const sidebar = screen.getByTestId("admin-sidebar");
      expect(sidebar).toHaveClass("duration-200");
    });

    it("R3/R5: should stay expanded when pinned and persist to localStorage", () => {
      renderWithProvider(<Sidebar />);
      const sidebar = screen.getByTestId("admin-sidebar");

      fireEvent.mouseEnter(sidebar);
      const pinBtn = screen.getByTitle("Pin sidebar");
      fireEvent.click(pinBtn);

      expect(localStorage.getItem("sidebar_pinned")).toBe("true");
      expect(trackMock).toHaveBeenCalledWith("sidebar_interaction", { action: "pinned" });

      fireEvent.mouseLeave(sidebar);
      expect(screen.getByText("Simulation Studio")).toBeInTheDocument();

      fireEvent.click(screen.getByTitle("Unpin sidebar"));
      expect(localStorage.getItem("sidebar_pinned")).toBe(null);
      expect(trackMock).toHaveBeenCalledWith("sidebar_interaction", { action: "unpinned" });
    });

    it("R5: should load in pinned state if localStorage is set", () => {
      localStorage.setItem("sidebar_pinned", "true");
      renderWithProvider(<Sidebar />);
      expect(screen.getByText("Simulation Studio")).toBeInTheDocument();
    });
  });
});
