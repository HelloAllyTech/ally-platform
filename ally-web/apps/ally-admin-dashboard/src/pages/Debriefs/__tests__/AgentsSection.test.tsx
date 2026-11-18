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
    {
      key: "short",
      shortForm: true,
      maxRevisionRounds: 1,
      steps: [
        {
          step: "writer",
          label: "Writer",
          model: "m-a",
          backupModel: null,
          promptCode: "debrief_writer_system",
          optional: false,
        },
      ],
    },
  ],
  agents: [
    {
      id: "writer",
      name: "Writer",
      kind: "step",
      what: "Writes the learner's debrief cards.",
      when: "Every debrief run",
      runs: "always",
      promptCode: "debrief_writer_system",
      recipes: ["standard", "short"],
      plannerChoice: null,
      model: null,
      backupModel: null,
    },
    {
      id: "checks",
      name: "Checks",
      kind: "step",
      what: null,
      when: null,
      runs: "some_recipes",
      promptCode: null,
      recipes: ["standard"],
      plannerChoice: null,
      model: null,
      backupModel: null,
    },
    {
      id: "planner",
      name: "Planner",
      kind: "planner",
      what: "Chooses which agents run for a session.",
      when: null,
      runs: "always",
      promptCode: "debrief_planner_system",
      recipes: [],
      plannerChoice: null,
      model: "m-b",
      backupModel: null,
    },
    {
      id: "case_agent",
      name: "Case agent",
      kind: "data",
      what: null,
      when: null,
      runs: "planner",
      promptCode: null,
      recipes: [],
      plannerChoice: { enabled: true },
      model: null,
      backupModel: null,
    },
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

  it("shows every agent with its model read-only, and no edit controls without canEdit", () => {
    h.config = base({ canEdit: false });
    render(<AgentsSection />);
    expect(screen.getByTestId("agents-release")).toHaveTextContent("v7");
    const row = screen.getByTestId("agents-agent-writer");
    expect(row).toHaveTextContent("Writer");
    expect(row).toHaveTextContent("Writes the learner's debrief cards.");
    expect(row).toHaveTextContent("Model A");
    expect(screen.getByTestId("agents-runs-writer")).toHaveTextContent("Every debrief");
    expect(screen.getByTestId("agents-prompt-writer")).toHaveAttribute(
      "href",
      "/manage-prompts?prompt=debrief_writer_system",
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByTestId("agents-guidance-limit-value")).toHaveTextContent("4");
  });

  it("lists the steps, the planner with its own model, and the planner's agents with their switch", () => {
    h.config = base({ canEdit: false });
    render(<AgentsSection />);
    for (const id of ["writer", "checks", "planner", "case_agent"]) {
      expect(screen.getByTestId(`agents-agent-${id}`)).toBeInTheDocument();
    }
    // The planner has a model of its own; nothing is edited here.
    expect(screen.getByTestId("agents-agent-planner")).toHaveTextContent("Model B");
    expect(screen.getByTestId("agents-runs-case_agent")).toHaveTextContent(
      "When the planner picks it",
    );
    expect(screen.getByTestId("agents-planner-case_agent")).toHaveTextContent("On");
    expect(screen.getByTestId("agents-runs-checks")).toHaveTextContent("Some debrief flows");
    // No invented description where nothing describes the agent.
    expect(screen.getByTestId("agents-what-checks")).toHaveTextContent("Nothing describes it yet.");
  });

  it("shows, per agent, which recipes use it, and each recipe's revision rounds", () => {
    h.config = base({ canEdit: false });
    render(<AgentsSection />);
    const table = screen.getByTestId("agents-by-recipe");
    expect(within(table).getByTestId("agents-recipe-standard")).toHaveTextContent("Standard");
    expect(within(table).getByTestId("agents-recipe-short")).toHaveTextContent("Short");
    expect(screen.getByTestId("agents-cell-standard-writer")).toHaveTextContent("✓");
    expect(screen.getByTestId("agents-cell-short-writer")).toHaveTextContent("✓");
    expect(screen.getByTestId("agents-cell-standard-checks")).toHaveTextContent("✓");
    expect(screen.getByTestId("agents-cell-short-checks")).toHaveTextContent("—");
    expect(screen.getByTestId("agents-rounds-standard")).toHaveTextContent("2");
    expect(screen.getByTestId("agents-rounds-short")).toHaveTextContent("1");
    // Only steps are per recipe; the planner and its agents are not rows here.
    expect(screen.queryByTestId("agents-cell-standard-planner")).toBeNull();
    expect(screen.queryByTestId("agents-cell-standard-case_agent")).toBeNull();
  });

  it("says in the recipe's heading what it is for, and tolerates its absence", () => {
    h.config = base({ canEdit: false });
    render(<AgentsSection />);
    expect(screen.getByTestId("agents-recipe-standard")).toHaveAttribute(
      "title",
      expect.stringMatching(/^Everything else/),
    );
    expect(screen.getByTestId("agents-recipe-short")).not.toHaveAttribute("title");
  });

  it("offers only approved models and does not let a code step be edited", () => {
    render(<AgentsSection />);
    const select = screen.getByLabelText("Model for Writer") as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.value)).toEqual(["m-a", "m-b"]);
    const checks = screen.getByTestId("agents-agent-checks");
    expect(within(checks).queryByRole("combobox")).toBeNull();
    expect(checks).toHaveTextContent("No model (code)");
  });

  it("shows each recipe's own model when an agent's models differ between recipes", () => {
    const cfg = base() as { recipes: Array<{ steps: Array<{ model: string | null }> }> };
    cfg.recipes[1].steps[0].model = "m-b";
    h.config = cfg;
    render(<AgentsSection />);
    const row = screen.getByTestId("agents-agent-writer");
    expect(within(row).getAllByRole("combobox", { name: /Model for Writer/ })).toHaveLength(2);
    expect(row).toHaveTextContent("Standard");
    expect(row).toHaveTextContent("Short");
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
    // One model change per recipe that runs the Writer, then the setting, tools and planner switch.
    expect(screen.getByTestId("agents-changes-count")).toHaveTextContent("5 changes ready");
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "Try B" } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft release" }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create).toHaveBeenCalledWith({
      changes: [
        { kind: "model", recipe: "standard", step: "writer", model: "m-b", backupModel: "m-a" },
        { kind: "model", recipe: "short", step: "writer", model: "m-b", backupModel: "m-a" },
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

  describe("What each agent can read", () => {
    const access = {
      data: [
        {
          key: "transcript",
          label: "The conversation",
          description: "What was said.",
          group: "this session",
          control: "fixed",
          personal: true,
        },
        {
          key: "roleplay_brief",
          label: "Roleplay brief",
          description: "Title, description and optional fields.",
          group: "the roleplay",
          control: "setting",
        },
        {
          key: "learner_history",
          label: "Learner history",
          description: "Earlier debriefs.",
          group: "the learner",
          control: "owner",
          personal: true,
        },
      ],
      agents: [
        {
          key: "safety_reader",
          label: "Safety reader",
          reads: [
            { data: "transcript", when: null },
            { data: "roleplay_brief", when: "only when handling risk is the skill practised" },
          ],
        },
        { key: "writer", label: "Writer", reads: [{ data: "transcript", when: null }] },
        {
          key: "analyst",
          label: "Analyst",
          reads: [
            { data: "transcript", when: null },
            { data: "roleplay_brief", when: null },
            { data: "learner_history", when: null },
          ],
        },
      ],
      pmAgent: [
        { tool: "comments_read", kind: "read", reads: "Expert review comments" },
        { tool: "prompt_read", kind: "read", reads: "The live text of a debrief prompt" },
        { tool: "release_draft", kind: "act", reads: "Drafts a prompt, setting or agent change" },
      ],
      roleplayFields: [
        {
          key: "title",
          label: "Title",
          description: "The roleplay's title.",
          alwaysOn: true,
          defaultOn: false,
          enabled: true,
        },
        {
          key: "difficulty",
          label: "Difficulty level",
          description: "How hard the author set it.",
          alwaysOn: false,
          defaultOn: true,
          enabled: true,
        },
        {
          key: "characterProfile",
          label: "Character profile",
          description: "Who the client is.",
          alwaysOn: false,
          defaultOn: false,
          enabled: false,
        },
        {
          key: "stages",
          label: "Stages of the roleplay",
          description: "The stage names.",
          alwaysOn: false,
          defaultOn: false,
          enabled: false,
        },
      ],
    };
    const withAccess = (over: Record<string, unknown> = {}) => {
      const cfg = base(over) as { settings: Record<string, unknown> };
      cfg.settings.roleplayFields = ["difficulty"];
      return { ...cfg, dataAccess: access };
    };

    it("ticks what each agent reads, marks conditional reads and personal data, and says who can change each row", () => {
      h.config = withAccess({ canEdit: false });
      render(<AgentsSection />);
      expect(screen.getByTestId("access-agent-analyst")).toHaveTextContent("Analyst");
      expect(screen.getByTestId("access-group-the learner")).toHaveTextContent("The learner");
      expect(screen.getByTestId("access-cell-analyst-transcript")).toHaveTextContent("✓");
      expect(screen.getByTestId("access-cell-analyst-learner_history")).toHaveTextContent("✓");
      expect(screen.getByTestId("access-cell-safety_reader-learner_history")).toHaveTextContent(
        "—",
      );
      expect(screen.getByTestId("access-cell-safety_reader-roleplay_brief")).toHaveTextContent("✓");
      expect(screen.getByTestId("access-when-safety_reader-roleplay_brief")).toHaveAttribute(
        "title",
        "Only when handling risk is the skill practised",
      );
      expect(screen.queryByTestId("access-when-analyst-roleplay_brief")).toBeNull();
      expect(screen.getByTestId("access-personal-learner_history")).toHaveTextContent("personal");
      expect(screen.queryByTestId("access-personal-roleplay_brief")).toBeNull();
      expect(screen.getByTestId("access-control-roleplay_brief")).toHaveTextContent(
        "Can be switched",
      );
      expect(screen.getByTestId("access-control-learner_history")).toHaveTextContent("Owner only");
      expect(screen.getByTestId("access-control-transcript")).toHaveTextContent("Always on");
    });

    it("names the agents whose inputs are not declared yet, from the all-agents list", () => {
      h.config = withAccess({ canEdit: false });
      render(<AgentsSection />);
      const note = screen.getByTestId("access-undeclared");
      expect(note).toHaveTextContent("Checks");
      expect(note).toHaveTextContent("Planner");
      expect(note).toHaveTextContent("Case agent");
      expect(note).not.toHaveTextContent("Writer");
    });

    it("lists the Debrief PM agent's reads and actions in plain words, with no tool names", () => {
      h.config = withAccess({ canEdit: false });
      render(<AgentsSection />);
      expect(screen.getByTestId("pm-reads")).toHaveTextContent("Expert review comments");
      expect(screen.getByTestId("pm-reads")).toHaveTextContent("The live text of a debrief prompt");
      expect(screen.getByTestId("pm-acts")).toHaveTextContent("Drafts a prompt, setting");
      const block = screen.getByTestId("access-pm-agent");
      expect(block).not.toHaveTextContent("comments_read");
      expect(block).toHaveTextContent("cannot edit locked prompts");
    });

    it("shows title and description as always on, and the live optional fields ticked", () => {
      h.config = withAccess();
      render(<AgentsSection />);
      const title = document.getElementById("access-field-input-title") as HTMLInputElement;
      expect(title.checked).toBe(true);
      expect(title.disabled).toBe(true);
      const diff = document.getElementById("access-field-input-difficulty") as HTMLInputElement;
      expect(diff.checked).toBe(true);
      expect(
        (document.getElementById("access-field-input-characterProfile") as HTMLInputElement)
          .checked,
      ).toBe(false);
    });

    it("saves the full list of optional fields as one setting change, in the page's draft release", async () => {
      h.config = withAccess();
      h.create.mockReturnValue(
        ok({
          draft: { id: "d", version: 8, status: "draft" },
          waitsForPerson: false,
          reason: null,
        }),
      );
      render(<AgentsSection />);
      expect(screen.queryByTestId("agents-changes-bar")).toBeNull();
      fireEvent.click(document.getElementById("access-field-input-characterProfile")!);
      fireEvent.click(document.getElementById("access-field-input-stages")!);
      expect(screen.getByTestId("agents-changes-count")).toHaveTextContent("1 change ready");
      expect(screen.getByTestId("agents-change-0")).toHaveTextContent("3 optional fields");
      fireEvent.click(screen.getByRole("button", { name: "Create draft release" }));
      await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
      expect(h.create).toHaveBeenCalledWith({
        changes: [
          {
            kind: "setting",
            key: "roleplayFields",
            value: ["difficulty", "characterProfile", "stages"],
          },
        ],
      });
      await screen.findByTestId("agents-created");
    });

    it("can switch every optional field off, and sends an empty list", async () => {
      h.config = withAccess();
      h.create.mockReturnValue(
        ok({
          draft: { id: "d", version: 8, status: "draft" },
          waitsForPerson: false,
          reason: null,
        }),
      );
      render(<AgentsSection />);
      fireEvent.click(document.getElementById("access-field-input-difficulty")!);
      fireEvent.click(screen.getByRole("button", { name: "Create draft release" }));
      await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
      expect(h.create).toHaveBeenCalledWith({
        changes: [{ kind: "setting", key: "roleplayFields", value: [] }],
      });
    });

    it("offers nothing to save while the list is unchanged, even after ticking and unticking", () => {
      h.config = withAccess();
      render(<AgentsSection />);
      const box = document.getElementById("access-field-input-characterProfile")!;
      fireEvent.click(box);
      expect(screen.getByTestId("agents-changes-bar")).toBeInTheDocument();
      fireEvent.click(box);
      expect(screen.queryByTestId("agents-changes-bar")).toBeNull();
      expect(screen.queryByRole("button", { name: "Create draft release" })).toBeNull();
    });

    it("lets nobody tick a field without permission", () => {
      h.config = withAccess({ canEdit: false });
      render(<AgentsSection />);
      expect(
        (document.getElementById("access-field-input-characterProfile") as HTMLInputElement)
          .disabled,
      ).toBe(true);
    });

    it("shows no section on a backend without the data-access view", () => {
      h.config = base();
      render(<AgentsSection />);
      expect(screen.queryByTestId("agents-data-access")).toBeNull();
    });
  });
});
