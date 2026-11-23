import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mounts = vi.hoisted(() => ({ sidebar: 0 }));

vi.mock("@components/error-boundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@components/sidebar", async () => {
  const React = await import("react");
  return {
    Sidebar: () => {
      React.useEffect(() => {
        mounts.sidebar += 1;
      }, []);
      return <nav data-testid="stub-sidebar">sidebar</nav>;
    },
  };
});
vi.mock("@components/command-palette/CommandPaletteProvider", () => ({
  CommandPaletteProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@components/notification-bell/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@components/report-upload-progress-dialog/ReportUploadProgressDialog", () => ({
  default: () => null,
}));
vi.mock("@components/scenario-reports-socket-provider/ScenarioReportsSocketProvider", () => ({
  ScenarioReportsSocketProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@pages/ContextLibrary/upload/UploadDock", () => ({ UploadDockHost: () => null }));
vi.mock("@ally-ui-mono/ui-shared", () => ({ InlineLoading: () => <div>loading…</div> }));
const access = vi.hoisted(() => ({ assistantOnly: false, calls: 0 }));
const ADMIN_HOME = "/manage-prompts";
vi.mock("@hooks/useAssistantOnly", () => ({
  useAssistantOnly: () => {
    access.calls += 1;
    return {
      ready: true,
      assistantOnly: access.assistantOnly,
      adminHome: access.assistantOnly ? null : "/manage-prompts",
    };
  },
}));
vi.mock("@components/assistant-only/AssistantOnlyHeader", () => ({
  AssistantOnlyHeader: ({ adminHome }: { adminHome?: string | null }) => (
    <header data-testid="assistant-only-header" data-admin-home={adminHome ?? ""}>
      Log out
    </header>
  ),
}));
vi.mock("@pages/Login/Login", async () => {
  const { useLocation } = await import("react-router-dom");
  return {
    Login: () => {
      const { pathname, search, hash } = useLocation();
      return <div data-testid="login-screen" data-at={`${pathname}${search}${hash}`} />;
    },
  };
});
const pageViewSpy = vi.fn();
vi.mock("@hooks/useAdminAnalytics", () => ({ useAdminPageView: (p: string) => pageViewSpy(p) }));

import { AdminShell } from "../AdminShell";
import { NotFound } from "../NotFound";

const renderShell = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AdminShell />}>
          <Route
            path="/prompts-page"
            element={
              <>
                <div>prompts page</div>
                <Link to="/manage-tooltips">go tooltips</Link>
              </>
            }
          />
          <Route path="/manage-prompts" element={<div>prompts</div>} />
          <Route path="/manage-tooltips" element={<div>tooltips</div>} />
          <Route path="/create-simulation/edit/:id" element={<div>editor</div>} />
          <Route path="/assistants" element={<div>assistants</div>} />
          <Route path="/assistants/new" element={<div>new assistant</div>} />
          <Route path="/account/plan" element={<div>plan and usage</div>} />
          <Route path="/account/credits" element={<div>plan and credits</div>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe("AdminShell", () => {
  beforeEach(() => {
    access.assistantOnly = false;
    mounts.sidebar = 0;
    pageViewSpy.mockClear();
    localStorage.setItem("adminIsAuthenticated", "true");
    document.title = "";
  });

  it("shows a signed-out visitor the login screen, not the page or the sidebar", () => {
    localStorage.removeItem("adminIsAuthenticated");
    renderShell("/manage-prompts");
    expect(screen.getByTestId("login-screen")).toBeInTheDocument();
    expect(screen.queryByText("prompts")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stub-sidebar")).not.toBeInTheDocument();
  });

  it("swaps the login for the page once they sign in, when the login navigates to the same URL", () => {
    localStorage.removeItem("adminIsAuthenticated");
    // What the login does after a successful sign-in: navigate to the URL it is drawn at.
    const SignedIn: React.FC = () => {
      const navigate = useNavigate();
      return (
        <button onClick={() => navigate("/assistants", { replace: true })}>login finished</button>
      );
    };
    render(
      <MemoryRouter initialEntries={["/assistants"]}>
        <SignedIn />
        <Routes>
          <Route element={<AdminShell />}>
            <Route path="/assistants" element={<div>assistants</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("login-screen")).toBeInTheDocument();
    localStorage.setItem("adminIsAuthenticated", "true");
    fireEvent.click(screen.getByText("login finished"));
    expect(screen.queryByTestId("login-screen")).not.toBeInTheDocument();
    expect(screen.getByText("assistants")).toBeInTheDocument();
  });

  it("fetches nothing for a signed-out visitor (a 401 would redirect the page to /login)", () => {
    localStorage.removeItem("adminIsAuthenticated");
    access.calls = 0;
    renderShell("/assistants");
    expect(access.calls).toBe(0);
  });

  it("draws the login screen at the URL they asked for, so logging in leaves them there (A1)", () => {
    localStorage.removeItem("adminIsAuthenticated");
    renderShell("/assistants?section=tools#lists");
    expect(screen.getByTestId("login-screen")).toHaveAttribute(
      "data-at",
      "/assistants?section=tools#lists",
    );
  });

  it("reports each page view to usage tracking", () => {
    renderShell("/manage-prompts");
    expect(pageViewSpy).toHaveBeenCalledWith("/manage-prompts");
  });

  it("titles each page '<Page> · Ally Admin'", () => {
    renderShell("/manage-prompts");
    expect(document.title).toBe("Prompts · Ally Admin");
  });

  it("draws a breadcrumb trail, last crumb current, with a link back for a detail page", () => {
    renderShell("/create-simulation/edit/7");
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(trail).toHaveTextContent("Create");
    expect(trail).toHaveTextContent("Roleplays");
    expect(screen.getByRole("link", { name: "Roleplays" })).toHaveAttribute(
      "href",
      "/simulation-studio",
    );
    expect(screen.getByText("Edit roleplay")).toHaveAttribute("aria-current", "page");
    expect(document.title).toBe("Edit roleplay · Ally Admin");
  });

  it("keeps the sidebar mounted across navigation and retitles the page", () => {
    renderShell("/prompts-page");
    fireEvent.click(screen.getByText("go tooltips"));
    expect(screen.getByText("tooltips")).toBeInTheDocument();
    expect(document.title).toBe("Tooltips · Ally Admin");
    expect(mounts.sidebar).toBe(1);
  });

  it("gives full-bleed pages no padding and no breadcrumb bar", () => {
    const { container } = renderShell("/assistants");
    expect(screen.queryByTestId("admin-breadcrumbs")).not.toBeInTheDocument();
    expect(container.querySelector(".p-4")).toBeNull();
  });

  it("renders a 404 with a link home, inside the shell, for an unknown URL", () => {
    renderShell("/definitely-not-a-page");
    expect(screen.getByTestId("stub-sidebar")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't find that page");
    expect(screen.getByRole("link", { name: "Go to your home page" })).toHaveAttribute("href", "/");
    expect(document.title).toBe("Page not found · Ally Admin");
    expect(screen.queryByTestId("admin-breadcrumbs")).not.toBeInTheDocument();
  });

  it("offers a skip link to the main content", () => {
    renderShell("/manage-prompts");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute(
      "href",
      "#admin-main-content",
    );
  });

  describe("someone whose only way in is an assistant's team (chunk 6b)", () => {
    beforeEach(() => {
      access.assistantOnly = true;
    });

    it("sees their assistants with no Sidebar, only the slim header", () => {
      renderShell("/assistants");
      expect(screen.getByText("assistants")).toBeInTheDocument();
      expect(screen.queryByTestId("stub-sidebar")).not.toBeInTheDocument();
      expect(screen.getByTestId("assistant-only-header")).toHaveAttribute("data-admin-home", "");
    });

    it("can open New assistant: that page checks the Assistants switch itself", () => {
      renderShell("/assistants/new");
      expect(screen.getByText("new assistant")).toBeInTheDocument();
      expect(screen.queryByTestId("stub-sidebar")).not.toBeInTheDocument();
    });

    it("can open Plan and usage, which has no other way in without the Sidebar", () => {
      renderShell("/account/plan");
      expect(screen.getByText("plan and usage")).toBeInTheDocument();
      expect(screen.getByTestId("assistant-only-header")).toBeInTheDocument();
    });

    it("can open Credits, where the corner menu's Plan and credits leads", () => {
      renderShell("/account/credits");
      expect(screen.getByText("plan and credits")).toBeInTheDocument();
      expect(screen.queryByText("assistants")).not.toBeInTheDocument();
      expect(screen.getByTestId("assistant-only-header")).toBeInTheDocument();
    });

    it("is sent back to their assistants from any other page", () => {
      renderShell("/manage-prompts");
      expect(screen.getByText("assistants")).toBeInTheDocument();
      expect(screen.queryByText("prompts")).not.toBeInTheDocument();
    });
  });

  it("shows no side navigation on the assistants list or any page under it, even to someone with other pages", () => {
    for (const path of ["/assistants", "/assistants/", "/assistants/new"]) {
      renderShell(path);
      expect(screen.queryByTestId("stub-sidebar")).not.toBeInTheDocument();
      expect(screen.queryByTestId("admin-mobile-menu-button")).not.toBeInTheDocument();
      // With no Sidebar there is no account menu: the slim header is their Log out, their Plan
      // and usage, and the way back to their other pages.
      expect(screen.getByTestId("assistant-only-header")).toHaveAttribute(
        "data-admin-home",
        ADMIN_HOME,
      );
      cleanup();
    }
    renderShell("/assistants/new");
    expect(screen.getByText("new assistant")).toBeInTheDocument();
  });

  it("anyone with other pages keeps the Sidebar on every other page", () => {
    renderShell("/manage-prompts");
    expect(screen.getByTestId("stub-sidebar")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-only-header")).not.toBeInTheDocument();
    cleanup();
    // A path that merely starts with the same letters is not under /assistants.
    renderShell("/assistants-archive");
    expect(screen.getByTestId("stub-sidebar")).toBeInTheDocument();
  });
});
