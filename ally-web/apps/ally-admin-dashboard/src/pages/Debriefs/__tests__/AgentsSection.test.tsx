import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@constants";

const h = vi.hoisted(() => ({ config: undefined as unknown, create: vi.fn() }));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefAgentsConfigQuery: () => ({ isLoading: false, data: h.config }),
  useCreateDebriefAgentsChangesMutation: () => [h.create, { isLoading: false }],
}));

/* eslint-disable import/first */
import { AgentsSection } from "../settings/AgentsSection";
/* eslint-enable import/first */

const ok = (v: unknown) => ({ unwrap: () => Promise.resolve(v) });
const fail = (status: number, data?: unknown) => ({
  unwrap: () => Promise.reject({ status, data }),
});

const base = (over: Record<string, unknown> = {}) => ({
  release: { id: "r1", version: 7, status: "live" },
  canEdit: true,
  recipes: [
    {
      key: "standard",
      shortForm: false,
      maxRevisionRounds: 2,
      usedWhen:
        "Everything else: a full roleplay that is not an assessment and not part of a case.",
      steps: [
        {
          step: "writer",
          label: "Writer",
          model: "m-a",
          backupModel: null,
          promptCode: "debrief_writer_system",
          optional: false,
        },
        {
          step: "checks",
          label: "Checks",
          model: null,
          backupModel: null,
          promptCode: null,
          optional: false,
        },
      ],
    },
    { key: "short", shortForm: true, maxRevisionRounds: 1, steps: [] },
  ],
  settings: {
    guidanceAgentMaxCalls: 4,
    guidanceTools: { guidance_agent: ["guidance_search"], writer: [], reviser: [] },
  },
  limits: {
    guidanceAgentMaxCalls: { min: 1, max: 8 },
    guidanceToolSteps: ["guidance_agent", "writer", "reviser"],
    guidanceToolNames: ["guidance_index", "guidance_search", "guidance_fetch"],
  },
  orchestratorAgents: [{ id: "case_agent", version: 2, enabled: true }],
  models: [
    { id: "m-a", provider: "x", label: "Model A" },
    { id: "m-b", provider: "x", label: "Model B" },
  ],
  pendingDraft: null,
  ...over,
});

describe("Settings › Agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.config = base();
  });

  it("shows recipes, steps and models read-only, with no edit controls without canEdit", () => {
    h.config = base({ canEdit: false });
    render(<AgentsSection />);
    expect(screen.getByTestId("agents-release")).toHaveTextContent("v7");
    expect(screen.getByTestId("agents-recipe-standard")).toBeInTheDocument();
    expect(screen.getByTestId("agents-recipe-short")).toBeInTheDocument();
    const row = screen.getByTestId("agents-step-standard-writer");
    expect(row).toHaveTextContent("Writer");
    expect(row).toHaveTextContent("Model A");
    expect(screen.getByTestId("agents-prompt-standard-writer")).toHaveAttribute(
      "href",
      "/manage-prompts?prompt=debrief_writer_system",
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByTestId("agents-guidance-limit-value")).toHaveTextContent("4");
  });

  it("says under each recipe what it is for and what picks it, and tolerates its absence", () => {
    h.config = base({ canEdit: false });
    render(<AgentsSection />);
    expect(screen.getByTestId("agents-recipe-used-when-standard")).toHaveTextContent(
      /^Everything else/,
    );
    expect(screen.queryByTestId("agents-recipe-used-when-short")).toBeNull();
  });

  it("offers only approved models and does not let a code step be edited", () => {
    render(<AgentsSection />);
    const select = screen.getByLabelText("Model for Writer") as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.value)).toEqual(["m-a", "m-b"]);
    const checks = screen.getByTestId("agents-step-standard-checks");
    expect(within(checks).queryByRole("combobox")).toBeNull();
    expect(checks).toHaveTextContent("—");
  });

  it("collects edits and posts the exact body", async () => {
    h.create.mockReturnValue(
      ok({
        draft: { id: "d", version: 8, status: "draft" },
        waitsForPerson: true,
        reason: "Needs a test",
      }),
    );
    render(<AgentsSection />);
    expect(screen.queryByTestId("agents-changes-bar")).toBeNull();
    fireEvent.change(screen.getByLabelText("Model for Writer"), { target: { value: "m-b" } });
    fireEvent.change(screen.getByLabelText("Backup model for Writer"), {
      target: { value: "m-a" },
    });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "6" } });
    // The real toggle carries an aria-label; the shared fake only renders its id.
    fireEvent.click(document.getElementById("agents-tool-writer-guidance_index")!);
    fireEvent.click(document.getElementById("agents-planner-toggle-case_agent")!);
    expect(screen.getByTestId("agents-changes-count")).toHaveTextContent("4 changes ready");
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "Try B" } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft release" }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create).toHaveBeenCalledWith({
      changes: [
        { kind: "model", recipe: "standard", step: "writer", model: "m-b", backupModel: "m-a" },
        { kind: "setting", key: "guidanceAgentMaxCalls", value: 6 },
        {
          kind: "setting",
          key: "guidanceTools",
          value: { guidance_agent: ["guidance_search"], writer: ["guidance_index"], reviser: [] },
        },
        { kind: "orchestrator_agent", id: "case_agent", enabled: false },
      ],
      note: "Try B",
    });
    const done = await screen.findByTestId("agents-created");
    expect(done).toHaveTextContent("Draft release v8 created");
    expect(done).toHaveTextContent("Needs a test");
    expect(screen.queryByTestId("agents-changes-bar")).toBeNull();
  });

  it("discards pending edits", () => {
    render(<AgentsSection />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByTestId("agents-changes-bar")).toBeNull();
  });

  it("shows each refusal reason next to its change on 400", async () => {
    h.create.mockReturnValue(
      fail(400, { message: "no", refusals: [{ index: 1, reason: "Limit too high" }] }),
    );
    render(<AgentsSection />);
    fireEvent.change(screen.getByLabelText("Model for Writer"), { target: { value: "m-b" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft release" }));
    expect(await screen.findByTestId("agents-refusal-1")).toHaveTextContent("Limit too high");
    expect(screen.queryByTestId("agents-refusal-0")).toBeNull();
  });

  it("shows a plain message on 403", async () => {
    h.create.mockReturnValue(fail(403));
    render(<AgentsSection />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft release" }));
    expect(await screen.findByTestId("agents-error")).toHaveTextContent("permission");
  });

  it("shows the waiting draft with who made it", () => {
    h.config = base({
      pendingDraft: {
        id: "d",
        version: 8,
        status: "trial",
        note: null,
        author: { kind: "pm_agent", name: null },
      },
    });
    render(<AgentsSection />);
    expect(screen.getByTestId("agents-draft-banner")).toHaveTextContent(
      "Draft release v8 by Debrief PM agent",
    );
  });

  it("lists recent changes and the canary, and tolerates their absence", () => {
    h.config = base({
      recentChanges: [
        {
          releaseId: "r6",
          version: 6,
          status: "live",
          author: { kind: "person", name: "Tanuja" },
          at: "2026-11-16T10:00:00Z",
          summary: ["Writer model: A to B", "Call limit 4 to 6"],
          source: "person",
        },
      ],
      canary: { id: "c", version: 8, share: 0.1 },
    });
    const { unmount } = render(<AgentsSection />);
    const row = screen.getByTestId("agents-recent-r6");
    expect(row).toHaveTextContent("v6 · Tanuja");
    expect(row).toHaveTextContent("Writer model: A to B; Call limit 4 to 6");
    expect(screen.getByTestId("agents-canary")).toHaveTextContent("10%");
    unmount();
    h.config = base();
    render(<AgentsSection />);
    expect(screen.queryByTestId("agents-recent")).toBeNull();
    expect(screen.queryByTestId("agents-canary")).toBeNull();
  });
});
