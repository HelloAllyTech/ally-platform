import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderDesignReadiness, BuilderTechnicalDesign } from "@types";

// @constants reads off the @components barrel at module-eval time (see the
// BugHunter tests), so the barrel is stubbed rather than loaded for real.
vi.mock("@components", () => ({ cellTypes: {} }));

vi.mock("@assets", () => ({ TooltipIcon: () => <svg /> }));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => undefined }));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Tag: ({ children }: any) => <span>{children}</span>,
  Tooltip: ({ children }: any) => <>{children}</>,
  InlineLoading: ({ description }: any) => <p>{description}</p>,
  InlineNotification: ({ title, subtitle, children }: any) => (
    <div role="status">
      <p>{title}</p>
      {subtitle && <p>{subtitle}</p>}
      {children}
    </div>
  ),
}));

// The real agent-text guards (they are what keep a malformed design renderable);
// the rest of @utils drags the store in.
vi.mock("@utils", async () => ({
  ...(await vi.importActual<any>("../../../utils/agentAuthored")),
  formatRelativeTime: () => "30 minutes ago",
}));

const startDesign = vi.fn();
const approveDesign = vi.fn();
vi.mock("@api", () => ({
  useStartBuilderDesignMutation: () => [startDesign, { isLoading: false }],
  useApproveBuilderDesignMutation: () => [approveDesign, { isLoading: false }],
  useGetBuilderRunsQuery: () => ({
    data: [{ id: "run-1", githubRunUrl: "https://github.example/run/1" }],
  }),
}));

// eslint-disable-next-line import/first
import { TechnicalDesignPanel } from "../TechnicalDesignPanel";

const design = (overrides: Partial<BuilderTechnicalDesign> = {}): BuilderTechnicalDesign => ({
  status: "review",
  runId: "run-1",
  designMd: "Add a column to builder_sessions.",
  scope: [{ repo: "ally-be", files: ["src/builder/builder.service.ts"] }],
  contracts: [
    {
      name: "GET builder/sessions/:id",
      change: "Adds designReadiness",
      readers: ["ally-web:apps/ally-admin-dashboard/src/api/builder.ts:120"],
    },
  ],
  compatibilityMd: "Old clients ignore the new field.",
  testMap: [
    {
      requirementId: "R1",
      repo: "ally-be",
      file: "src/builder/design.spec.ts",
      asserts: "approve refuses a stale design",
    },
  ],
  openDecisions: [],
  review: { verdict: "pass", notesMd: "Scope looks complete.", at: "2026-10-12T10:00:00Z" },
  productHash: "abc",
  draftedAt: "2026-10-12T09:00:00Z",
  approvedBy: null,
  approvedAt: null,
  error: null,
  ...overrides,
});

const ready: BuilderDesignReadiness = { ready: true, stale: false, blockers: [] };

const renderPanel = (props: Partial<React.ComponentProps<typeof TechnicalDesignPanel>> = {}) =>
  render(
    <TechnicalDesignPanel
      sessionId="session-1"
      design={design()}
      designReadiness={ready}
      prdReady
      {...props}
    />,
  );

describe("TechnicalDesignPanel", () => {
  beforeEach(() => {
    startDesign.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({}) });
    approveDesign.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("offers a first draft when there is no design, and starts it", async () => {
    renderPanel({ design: null, designReadiness: { ready: false, stale: false, blockers: [] } });

    expect(screen.getByText("Not drafted")).toBeInTheDocument();
    expect(screen.queryByText("Approve design")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Draft technical design" }));

    await vi.waitFor(() => expect(startDesign).toHaveBeenCalledWith("session-1"));
  });

  it("asks for the PRD to be finished first instead of offering actions", () => {
    renderPanel({ design: null, prdReady: false });

    expect(screen.getByText(/Finish the PRD first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Draft technical design" })).toBeNull();
  });

  it("shows the drafting state with the run link and disables the actions", () => {
    renderPanel({ design: design({ status: "drafting", designMd: "" }) });

    expect(screen.getAllByText("Drafting").length).toBeGreaterThan(0);
    expect(screen.getByText(/reading the code/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Watch on GitHub" })).toHaveAttribute(
      "href",
      "https://github.example/run/1",
    );
    expect(screen.getByRole("button", { name: "Redraft" })).toBeDisabled();
  });

  it("renders the design for review and lets a ready, fresh design be approved", async () => {
    renderPanel();

    expect(screen.getByText("Ready for review")).toBeInTheDocument();
    expect(screen.getByText("Add a column to builder_sessions.")).toBeInTheDocument();
    expect(screen.getByText("GET builder/sessions/:id")).toBeInTheDocument();
    expect(
      screen.getByText("ally-web:apps/ally-admin-dashboard/src/api/builder.ts:120"),
    ).toBeInTheDocument();
    expect(screen.getByText("src/builder/builder.service.ts")).toBeInTheDocument();
    expect(screen.getByText("approve refuses a stale design")).toBeInTheDocument();
    expect(screen.getByText("No concerns")).toBeInTheDocument();

    const approve = screen.getByRole("button", { name: "Approve design" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await vi.waitFor(() => expect(approveDesign).toHaveBeenCalledWith("session-1"));
  });

  it("keeps Approve disabled while the design is not ready, and lists why", () => {
    renderPanel({
      design: design({ openDecisions: ["Soft-delete or hard-delete?"] }),
      designReadiness: { ready: false, stale: false, blockers: ["1 open decision"] },
    });

    expect(screen.getByRole("button", { name: "Approve design" })).toBeDisabled();
    expect(screen.getByText("Soft-delete or hard-delete?")).toBeInTheDocument();
    expect(screen.getByText("1 open decision")).toBeInTheDocument();
  });

  it("marks a stale design and refuses to approve it", () => {
    renderPanel({ designReadiness: { ready: true, stale: true, blockers: [] } });

    expect(screen.getByText("Out of date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve design" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redraft" })).toBeEnabled();
  });

  it("shows who approved it and offers only a redraft once approved", () => {
    renderPanel({ design: design({ status: "approved", approvedAt: "2026-10-12T09:30:00Z" }) });

    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText(/^Approved /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve design" })).toBeNull();
    expect(screen.getByRole("button", { name: "Redraft" })).toBeEnabled();
  });

  it("shows a failed run's error and offers a fresh draft", () => {
    renderPanel({ design: design({ status: "failed", error: "Runner timed out" }) });

    expect(screen.getByText("Runner timed out")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draft technical design" })).toBeEnabled();
  });

  it("surfaces the server's own refusal message", async () => {
    approveDesign.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: "Settle the open decisions first." } }),
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Approve design" }));

    expect(await screen.findByText("Settle the open decisions first.")).toBeInTheDocument();
  });

  /**
   * A reviewer's scope ideas are not faults. Shown apart from defects, so a
   * sound design with suggestions does not read as a failing one.
   */
  it("shows defects and suggestions as separate lists", () => {
    renderPanel({
      design: design({
        review: {
          verdict: "pass",
          notesMd: "rendered copy for older readers",
          defects: [],
          suggestions: ["Article questions could take rich text too."],
          at: "2026-10-12T10:00:00Z",
        },
      }),
    });

    expect(screen.getByText("No concerns")).toBeInTheDocument();
    expect(screen.getByText(/Suggestions — could widen the scope/)).toBeInTheDocument();
    expect(screen.getByText("Article questions could take rich text too.")).toBeInTheDocument();
    expect(screen.queryByText("Defects")).not.toBeInTheDocument();
    expect(screen.queryByText("rendered copy for older readers")).not.toBeInTheDocument();
  });

  it("disables both actions while a build is running", () => {
    renderPanel({ locked: true });

    expect(screen.getByRole("button", { name: "Approve design" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redraft" })).toBeDisabled();
  });
});
