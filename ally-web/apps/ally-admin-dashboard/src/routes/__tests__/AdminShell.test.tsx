import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Link, Route, Routes, useLocation } from "react-router-dom";
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
const access = vi.hoisted(() => ({ assistantOnly: false }));
vi.mock("@hooks/useAssistantOnly", () => ({
  useAssistantOnly: () => ({ ready: true, assistantOnly: access.assistantOnly }),
}));
vi.mock("@components/assistant-only/AssistantOnlyHeader", () => ({
  AssistantOnlyHeader: () => <header data-testid="assistant-only-header">Log out</header>,
}));
const pageViewSpy = vi.fn();
vi.mock("@hooks/useAdminAnalytics", () => ({ useAdminPageView: (p: string) => pageViewSpy(p) }));

import { AdminShell } from "../AdminShell";
import { NotFound } from "../NotFound";

/** The login page, showing where it was sent from, so the deep link can be checked. */
const LoginPage: React.FC = () => {
  const { search } = useLocation();
  return <div data-search={search}>login page</div>;
};

const renderShell = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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

  it("sends a signed-out visitor to login", () => {
    localStorage.removeItem("adminIsAuthenticated");
    renderShell("/manage-prompts");
    expect(screen.getByText("login page")).toBeInTheDocument();
  });

  it("keeps the page a signed-out visitor asked for, to return to after login (A1)", () => {
    localStorage.removeItem("adminIsAuthenticated");
    renderShell("/assistants?section=tools#lists");
    const login = screen.getByText("login page");
    expect(new URLSearchParams(login.getAttribute("data-search") ?? "").get("next")).toBe(
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
      expect(screen.getByTestId("assistant-only-header")).toBeInTheDocument();
    });

    it("is sent back to their assistants from any other page", () => {
      renderShell("/manage-prompts");
      expect(screen.getByText("assistants")).toBeInTheDocument();
      expect(screen.queryByText("prompts")).not.toBeInTheDocument();
    });
  });

  it("anyone with other pages keeps the Sidebar", () => {
    renderShell("/assistants");
    expect(screen.getByTestId("stub-sidebar")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-only-header")).not.toBeInTheDocument();
  });
});
