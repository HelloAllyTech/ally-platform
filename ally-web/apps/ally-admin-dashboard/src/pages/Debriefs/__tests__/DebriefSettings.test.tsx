import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  providers: vi.fn(() => ({ unwrap: () => Promise.resolve({}) })),
  settings: vi.fn(),
  update: vi.fn(),
  accept: vi.fn(),
  baseline: vi.fn(),
  overview: vi.fn(),
  tenants: vi.fn(),
  setLive: vi.fn(),
  stop: vi.fn(),
  budgets: vi.fn(),
  autonomy: vi.fn(),
  setMatrix: vi.fn(),
  setOrg: vi.fn(),
  permissions: [] as string[],
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefSettingsQuery: () => h.settings(),
  useUpdateDebriefSettingsMutation: () => [h.update, { isLoading: false }],
  useAcceptDebriefBaselineMutation: () => [h.accept, { isLoading: false }],
  useRunDebriefBaselineMutation: () => [h.baseline, { isLoading: false }],
  useGetDebriefOverviewQuery: () => h.overview(),
  useGetDebriefTenantsQuery: () => h.tenants(),
  useSetDebriefTenantLiveMutation: () => [h.setLive, { isLoading: false }],
  useSetDebriefTenantRegionMutation: () => [vi.fn(), { isLoading: false }],
  useSetDebriefTenantProvidersMutation: () => [h.providers, { isLoading: false }],
  useEmergencyStopDebriefTenantMutation: () => [h.stop, { isLoading: false }],
  useSetDebriefBudgetsMutation: () => [h.budgets, { isLoading: false }],
  useGetDebriefMeQuery: () => ({ data: undefined }),
  useGetDebriefAutonomyQuery: () => h.autonomy(),
  useSetDebriefAutonomyMatrixMutation: () => [h.setMatrix, { isLoading: false }],
  useSetDebriefOrgAutonomyMutation: () => [h.setOrg, { isLoading: false }],
  useGetDebriefPinnedRulesQuery: () => ({ data: { rules: [] } }),
}));
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSelector: (pick: (state: unknown) => unknown) =>
    pick({ user: { permissions: h.permissions } }),
}));
vi.mock("@components/context-collection-link", () => ({
  ContextCollectionLink: ({ collection }: { collection: string }) => (
    <div data-testid="collection-link" data-collection={collection} />
  ),
}));

// eslint-disable-next-line import/first
import { en } from "@constants";
// eslint-disable-next-line import/first
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// eslint-disable-next-line import/first
import { DebriefSettingsPage } from "../settings/DebriefSettingsPage";
// eslint-disable-next-line import/first
import { SettingsGroups } from "../settings/SettingsGroups";

const SettingsTab = () => (
  <SettingsGroups
    groups={["quick", "gate", "trials", "canary", "sealed", "budget", "metrics", "agent"]}
    canEdit
    withBaseline
  />
);

/** ally-be's owner settings spec, read from the monorepo checkout beside this app. */
const SPEC_FILE = resolve(
  __dirname,
  "../../../../../../../ally-be/src/debrief/constants/debrief-owner-settings.constants.ts",
);

const resolves = (v: unknown = {}) => ({ unwrap: () => Promise.resolve(v) });

const VIEW = {
  values: { gateCases: 100, canaryShare: 0.1, gateNoNewHardFails: true, learningBudgetUsd: 150 },
  defaults: { gateCases: 100, canaryShare: 0.1, gateNoNewHardFails: true, learningBudgetUsd: 150 },
  spec: {
    gateCases: { default: 100, kind: "int", min: 10, max: 1000, group: "gate" },
    gateNoNewHardFails: { default: true, kind: "bool", group: "gate" },
    canaryShare: { default: 0.1, kind: "share", min: 0.01, max: 0.3, group: "canary" },
    learningBudgetUsd: { default: 150, kind: "number", min: 0, budget: true, group: "budget" },
  },
  changed: [],
  baseline: {
    ranAt: "2026-11-01T00:00:00Z",
    facts: {
      runsPerDay: 20,
      judge: { scored: 400, median: 8.8, sd: 1 },
      rejudge: { pairs: 8, sdOfDifference: 0.6 },
      costPerRunUsd: { p50: 0.12, p90: 0.2 },
    },
    proposals: {
      gateCases: { value: 40, reason: "Only 600 eligible sessions a month.", misfit: true },
      learningBudgetUsd: { value: 60, reason: "3 ideas a month.", misfit: false },
    },
  },
  updatedAt: "2026-11-01T00:00:00Z",
  updatedBy: null,
};

describe("Debrief owner settings (v9 FR-60)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.settings.mockReturnValue({ data: VIEW, isError: false, refetch: vi.fn() });
    h.update.mockReturnValue(resolves());
    h.accept.mockReturnValue(resolves());
    h.baseline.mockReturnValue(resolves());
  });

  it("shows each setting with its proposed value, the reason, and a misfit flag", () => {
    render(<SettingsTab />);
    const row = screen.getByTestId("setting-gateCases");
    expect(row).toHaveTextContent("40");
    expect(row).toHaveTextContent("Only 600 eligible sessions a month.");
    expect(row).toHaveTextContent("No longer fits");
    expect(screen.getByTestId("setting-canaryShare")).toHaveTextContent("Default 10%");
    expect(screen.getByTestId("baseline-facts")).toHaveTextContent("20.0 debriefs a day");
  });

  it("accepting all takes every proposed value except the budget", async () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByRole("button", { name: /Accept every proposed value/ }));
    await waitFor(() => expect(h.accept).toHaveBeenCalledWith({ keys: ["gateCases"] }));
  });

  it("accepting a budget value asks first", async () => {
    render(<SettingsTab />);
    const row = screen.getByTestId("setting-learningBudgetUsd");
    fireEvent.click(within(row).getByRole("button", { name: "Accept" }));
    expect(h.accept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Change the budget" }));
    await waitFor(() => expect(h.accept).toHaveBeenCalledWith({ keys: ["learningBudgetUsd"] }));
  });

  it("saves only what changed, with shares sent as fractions", async () => {
    render(<SettingsTab />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Try-out share of new debriefs"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ changes: { canaryShare: 0.2 } }));
  });

  it("a budget edit asks before saving", async () => {
    render(<SettingsTab />);
    fireEvent.change(screen.getByLabelText("Fixed learning budget a month ($)"), {
      target: { value: "200" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(h.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Change the budget" }));
    await waitFor(() =>
      expect(h.update).toHaveBeenCalledWith({ changes: { learningBudgetUsd: 200 } }),
    );
  });

  it("toggles a yes/no setting with a Carbon toggle and saves it", async () => {
    render(<SettingsTab />);
    const toggle = screen.getByLabelText("No new hard fails");
    expect(toggle).toHaveAttribute("role", "switch");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(h.update).toHaveBeenCalledWith({ changes: { gateNoNewHardFails: false } }),
    );
  });

  it("offers Back to default on a changed setting, as a button", async () => {
    h.settings.mockReturnValue({
      data: { ...VIEW, values: { ...VIEW.values, gateCases: 80 }, changed: ["gateCases"] },
      isError: false,
      refetch: vi.fn(),
    });
    render(<SettingsTab />);
    fireEvent.click(
      within(screen.getByTestId("setting-gateCases")).getByRole("button", {
        name: "Back to default",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ changes: { gateCases: null } }));
  });
});

const OVERVIEW = {
  budget: {
    monthSpentUsd: 3.18,
    monthlyCapUsd: 50,
    runCeilingUsd: 0.5,
    learningSpentUsd: 4,
    learningBudgetUsd: 150,
  },
};
const TENANTS = [
  {
    id: "t1",
    name: "Ally Demo",
    live: true,
    isTest: true,
    region: "india",
    hasSupportContact: false,
  },
  {
    id: "t2",
    name: "Northside",
    live: false,
    stopped: true,
    isTest: false,
    region: "india",
    hasSupportContact: false,
  },
  {
    id: "t3",
    name: "Harbour",
    live: false,
    isTest: false,
    region: "outside_india",
    hasSupportContact: false,
  },
];

const cells = (v: string) => ({ quick_test: v, gate_test: v, paired_trial: v, canary: "ask" });
const ALWAYS = "Always on its own: learners never see it; paid from the learning budget.";
const AUTONOMY = {
  enabled: true,
  steps: ["quick_test", "gate_test", "paired_trial", "canary"],
  promote: "person",
  kinds: [
    {
      kind: "settings",
      configurable: true,
      cells: cells("auto"),
      eligible: true,
      reason: "κ 0.71",
      relockedAt: null,
      relockReason: null,
    },
    {
      kind: "prompts",
      configurable: true,
      cells: cells("ask"),
      eligible: false,
      overridable: true,
      reason: "Accuracy 0.52",
      eligibility: {
        quick_test: { eligible: true, reason: ALWAYS },
        gate_test: { eligible: true, reason: ALWAYS },
        paired_trial: { eligible: true, reason: ALWAYS },
        canary: { eligible: false, reason: "Not yet: agreement below 0.6 (accuracy 0.52)." },
      },
      relockedAt: null,
      relockReason: null,
    },
    {
      kind: "pinned_rules",
      configurable: false,
      cells: cells("off"),
      eligible: false,
      reason: "",
      relockedAt: null,
      relockReason: null,
    },
  ],
  orgs: [
    {
      tenantId: "t1",
      tenantName: "Ally Demo",
      live: true,
      overrides: { paired_trial: "default", canary: "ask" },
    },
  ],
  facts: {
    gate: { met: false, failing: [] },
    reverts: {},
    failedBaseline: { failed: false, detail: null },
    judgeDrift: null,
  },
  relocks: [],
  can: { change: true },
};

describe("Debrief settings page: who can change what", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.settings.mockReturnValue({ data: VIEW, isError: false, refetch: vi.fn() });
    h.overview.mockReturnValue({ data: OVERVIEW, isError: false, refetch: vi.fn() });
    h.tenants.mockReturnValue({ data: TENANTS, isError: false, refetch: vi.fn() });
    h.setLive.mockReturnValue(resolves());
    h.stop.mockReturnValue(resolves());
    h.budgets.mockReturnValue(
      resolves({ releaseId: "r9", version: 9, changed: ["runCeilingUsd"] }),
    );
    h.setMatrix.mockReturnValue(resolves());
    h.autonomy.mockReturnValue({ data: AUTONOMY });
  });
  let where = "";
  const Where = () => {
    const l = useLocation();
    where = `${l.pathname}${l.hash}`;
    return null;
  };
  const renderPage = (hash = "") =>
    render(
      <MemoryRouter initialEntries={[`/debriefs/settings${hash}`]}>
        <Routes>
          <Route
            path="/debriefs/settings"
            element={
              <>
                <DebriefSettingsPage />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  const tab = (id: string) => screen.getByTestId(`settings-tab-${id}`);
  const shown = () =>
    screen.getAllByTestId(/^settings-section-/).map(el => el.getAttribute("data-testid"));

  it("shows one row of tabs with short labels, Organisations first", () => {
    h.permissions = [];
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Settings" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map(l => l.textContent),
    ).toEqual([
      "Organisations",
      "Budgets",
      "Tests",
      "Autonomy",
      "Steering",
      "Pinned rules",
      "Progress",
    ]);
    expect(nav.className).toContain("sticky");
    expect(tab("orgs")).toHaveAttribute("aria-current", "page");
    expect(shown()).toEqual(["settings-section-orgs"]);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Organisations");
  });

  it("clicking a tab shows only its section, with the short heading, and keeps it in the hash", () => {
    h.permissions = [];
    renderPage();
    expect(tab("budget")).toHaveAttribute("href", "/debriefs/settings#budget");
    fireEvent.click(tab("autonomy"));
    expect(where).toBe("/debriefs/settings#autonomy");
    expect(shown()).toEqual(["settings-section-autonomy"]);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Autonomy");
    expect(tab("autonomy")).toHaveAttribute("aria-current", "page");
    expect(tab("orgs")).not.toHaveAttribute("aria-current");
    expect(screen.queryByTestId("organisations-table")).toBeNull();
    fireEvent.click(tab("weights"));
    expect(shown()).toEqual(["settings-section-weights"]);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Steering");
    fireEvent.click(tab("tests"));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Tests");
  });

  it.each([
    ["#budget", "budget"],
    ["#tests", "tests"],
    ["#autonomy", "autonomy"],
    ["#weights", "weights"],
    ["#pinned", "pinned"],
    ["#progress", "progress"],
    ["#orgs", "orgs"],
  ])("a %s link opens that tab", (hash, id) => {
    h.permissions = [];
    renderPage(hash);
    expect(tab(id)).toHaveAttribute("aria-current", "page");
    expect(shown()).toEqual([`settings-section-${id}`]);
  });

  it("an unknown hash, or Schedules without the toggle, opens Organisations", () => {
    h.permissions = [];
    renderPage("#nope");
    expect(shown()).toEqual(["settings-section-orgs"]);
  });

  it("an old #guidance link shows the guidance card", () => {
    h.permissions = [];
    renderPage("#guidance");
    expect(shown()).toEqual(["settings-section-guidance"]);
    expect(screen.getByTestId("collection-link")).toHaveAttribute(
      "data-collection",
      "debrief_guidance",
    );
  });

  it("the Autonomy intro's pinned-rules link opens the Pinned rules tab", () => {
    h.permissions = [];
    renderPage("#autonomy");
    fireEvent.click(
      within(screen.getByTestId("autonomy-intro")).getByRole("link", { name: "Pinned rules" }),
    );
    expect(where).toBe("/debriefs/settings#pinned");
    expect(shown()).toEqual(["settings-section-pinned"]);
  });

  it("never wraps: the owner note truncates with its full text on hover, the last tabs overflow into More below lg", () => {
    h.permissions = [];
    renderPage();
    const note = screen.getByTestId("settings-owner-note");
    expect(note).toHaveAttribute("title", "Only the owner can change these.");
    expect(note).toHaveClass("truncate");
    expect(screen.getByTestId("settings-tabs")).toHaveClass("flex-nowrap");
    // Steering, Pinned rules and Progress are tabs at lg and up, More items below it.
    for (const id of ["weights", "pinned", "progress"])
      expect(tab(id)).toHaveClass("hidden", "min-[1056px]:inline");
    expect(tab("orgs")).not.toHaveClass("hidden");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Steering" }));
    expect(where).toBe("/debriefs/settings#weights");
  });

  it("is read-only for someone who isn't the owner, and says who can change it", () => {
    h.permissions = [];
    renderPage();
    expect(screen.getByTestId("settings-owner-note")).toHaveTextContent(
      "Only the owner can change these.",
    );
    expect(screen.getByText("Read only")).toBeInTheDocument();
    const noEdits = () => {
      expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Switch on" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Emergency stop" })).not.toBeInTheDocument();
    };
    noEdits();
    fireEvent.click(tab("budget"));
    expect(screen.getByTestId("budgets")).toBeInTheDocument();
    noEdits();
    fireEvent.click(tab("tests"));
    expect(screen.getByTestId("setting-value-gateCases")).toHaveTextContent("100");
    noEdits();
    fireEvent.click(tab("autonomy"));
    expect(screen.getByLabelText(/^Settings \(not budgets\), Try on learners/)).toBeDisabled();
    fireEvent.click(tab("weights"));
    noEdits();
  });

  it("lets the Ally team stop a live organisation, after saying what learners will see", async () => {
    h.permissions = ["system:access"];
    renderPage();
    expect(screen.queryByRole("button", { name: "Switch on" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Emergency stop" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("“not available”");
    const stop = within(screen.getByRole("dialog")).getByRole("button", { name: "Emergency stop" });
    expect(stop).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Why/), { target: { value: "Bad advice" } });
    fireEvent.click(stop);
    await waitFor(() =>
      expect(h.stop).toHaveBeenCalledWith({ tenantId: "t1", reason: "Bad advice" }),
    );
  });

  it("names an organisation stopped after launch, apart from one never switched on (FR-46)", () => {
    h.permissions = ["system:access"];
    renderPage();
    const table = screen.getByTestId("organisations-table");
    expect(table).toHaveTextContent('NorthsideStopped · learners see "not available"');
    expect(table).not.toHaveTextContent("Today's debrief");
  });

  it("gives the owner Switch on, blocked outside India without a support line, and budget changes", () => {
    h.permissions = ["manage:admin:debrief-settings"];
    renderPage();
    const rows = screen.getAllByTestId("organisation-row");
    expect(within(rows[1]).getByRole("button", { name: "Switch on" })).not.toBeDisabled();
    expect(within(rows[2]).getByRole("button", { name: "Switch on" })).toBeDisabled();
    expect(rows[2]).toHaveTextContent("Add a support line to switch on");
    fireEvent.click(tab("budget"));
    expect(
      within(screen.getByTestId("budget-learningBudgetUsd")).getByRole("button", {
        name: "Change",
      }),
    ).toBeInTheDocument();
    // The run ceiling lives in the release: changing it makes a new release.
    fireEvent.click(
      within(screen.getByTestId("budget-runCeilingUsd")).getByRole("button", { name: "Change" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("it is proposed as a change");
    fireEvent.click(tab("tests"));
    expect(screen.getAllByRole("button", { name: "Save changes" }).length).toBeGreaterThan(0);
  });
});

describe("Settings › Progress", () => {
  const PROGRESS_VIEW = {
    ...VIEW,
    values: {
      ...VIEW.values,
      progressOn: true,
      progressCardEvery: 5,
      progressWindow: 6,
      progressUseFhs: true,
      progressShowWorseToLearners: false,
    },
    defaults: {
      ...VIEW.defaults,
      progressOn: true,
      progressCardEvery: 5,
      progressWindow: 6,
      progressUseFhs: true,
      progressShowWorseToLearners: false,
    },
    spec: {
      ...VIEW.spec,
      progressOn: { default: true, kind: "bool", group: "progress" },
      progressCardEvery: { default: 5, kind: "int", min: 1, max: 20, group: "progress" },
      progressWindow: { default: 6, kind: "int", min: 3, max: 12, group: "progress" },
      progressUseFhs: { default: true, kind: "bool", group: "progress" },
      progressShowWorseToLearners: { default: false, kind: "bool", group: "progress" },
    },
    baseline: null,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    h.settings.mockReturnValue({ data: PROGRESS_VIEW, isError: false, refetch: vi.fn() });
    h.overview.mockReturnValue({ data: OVERVIEW, isError: false, refetch: vi.fn() });
    h.tenants.mockReturnValue({ data: TENANTS, isError: false, refetch: vi.fn() });
    h.update.mockReturnValue(resolves());
  });
  const renderAt = () =>
    render(
      <MemoryRouter initialEntries={["/debriefs/settings#progress"]}>
        <Routes>
          <Route path="/debriefs/settings" element={<DebriefSettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it("lists the five progress settings in plain words, and only those", () => {
    h.permissions = [];
    renderAt();
    const section = screen.getByTestId("settings-section-progress");
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Progress");
    const table = within(section).getByTestId("settings-table-progress");
    for (const label of [
      "Learner progress",
      "Show the progress card every … sessions",
      "Sessions to look back over",
      "Use Foundational Skills levels as a cross-check",
      "Tell learners when a skill needs another look",
    ])
      expect(table).toHaveTextContent(label);
    expect(within(table).queryByText(/progressOn|FHS/)).toBeNull();
    expect(table).not.toHaveTextContent("Sessions in the pass test");
    // Read only for anyone but the owner.
    expect(within(section).queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.getByTestId("setting-value-progressShowWorseToLearners")).toHaveTextContent("No");
  });

  it("lets the owner change one and saves only that change", async () => {
    h.permissions = ["manage:admin:debrief-settings"];
    renderAt();
    const row = screen.getByTestId("setting-progressShowWorseToLearners");
    fireEvent.click(within(row).getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(h.update).toHaveBeenCalledWith({ changes: { progressShowWorseToLearners: true } }),
    );
  });

  it("says so when ally-be doesn't send the progress settings yet", () => {
    h.permissions = ["manage:admin:debrief-settings"];
    h.settings.mockReturnValue({ data: VIEW, isError: false, refetch: vi.fn() });
    renderAt();
    expect(screen.getByTestId("progress-settings")).toHaveTextContent(
      "These settings aren't available yet.",
    );
  });
});

describe("Settings › Organisations › model providers (plan §8.9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.settings.mockReturnValue({ data: VIEW, isError: false, refetch: vi.fn() });
    h.overview.mockReturnValue({ data: OVERVIEW, isError: false, refetch: vi.fn() });
    h.tenants.mockReturnValue({
      data: [{ ...TENANTS[1], providers: ["gemini", "openai"] }],
      isError: false,
      refetch: vi.fn(),
    });
    h.autonomy.mockReturnValue({ data: AUTONOMY });
  });
  const renderPage = () =>
    render(
      <MemoryRouter>
        <DebriefSettingsPage />
      </MemoryRouter>,
    );

  it("shows each organisation's providers and lets the owner narrow them, never to none", async () => {
    h.permissions = ["manage:admin:debrief-settings"];
    renderPage();
    const row = screen.getByTestId("organisation-row");
    expect(within(row).getByTestId("organisation-providers")).toHaveTextContent(
      "Models from: Google, OpenAI",
    );
    fireEvent.click(within(within(row).getByTestId("organisation-providers")).getByRole("button"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Google"));
    fireEvent.click(within(dialog).getByLabelText("OpenAI"));
    const save = within(dialog).getByRole("button", { name: "Save providers" });
    expect(save).toBeDisabled();
    expect(dialog).toHaveTextContent("Allow at least one provider");
    fireEvent.click(within(dialog).getByLabelText("Anthropic"));
    fireEvent.click(save);
    await waitFor(() =>
      expect(h.providers).toHaveBeenCalledWith({ tenantId: "t2", providers: ["anthropic"] }),
    );
  });

  it("shows no change link to someone who can't switch organisations on", () => {
    h.permissions = [];
    renderPage();
    expect(
      within(screen.getByTestId("organisation-providers")).queryByRole("button"),
    ).not.toBeInTheDocument();
  });
});

describe("Debrief owner settings names", () => {
  it.skipIf(!existsSync(SPEC_FILE))("names every setting ally-be defines", () => {
    const source = readFileSync(SPEC_FILE, "utf8");
    const body = source.slice(source.indexOf("OWNER_SETTINGS_SPEC = {"));
    const keys = [...body.slice(0, body.indexOf("} as const")).matchAll(/^ {2}(\w+): \{/gm)].map(
      m => m[1],
    );
    expect(keys.length).toBeGreaterThan(10);
    const names = en.debriefs.settings.names;
    expect(keys.filter(k => !names[k])).toEqual([]);
  });
});

describe("What the PM agent may do alone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.settings.mockReturnValue({ data: VIEW, isError: false, refetch: vi.fn() });
    h.overview.mockReturnValue({ data: OVERVIEW, isError: false, refetch: vi.fn() });
    h.tenants.mockReturnValue({ data: TENANTS, isError: false, refetch: vi.fn() });
    h.autonomy.mockReturnValue({ data: AUTONOMY });
    h.setMatrix.mockReturnValue(resolves());
  });
  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/debriefs/settings#autonomy"]}>
        <DebriefSettingsPage />
      </MemoryRouter>,
    );

  it("shows agreement with the clinical advisor per measure: agreement, reviews, problems caught", () => {
    h.permissions = [];
    const m = (measure: string, over: Record<string, unknown>) => ({
      measure,
      n: 0,
      minReviews: 50,
      kappa: null,
      agreementPct: null,
      recallOnNo: { caught: 0, of: 0, pct: null },
      state: "not_enough",
      passes: false,
      ...over,
    });
    h.autonomy.mockReturnValue({
      data: {
        ...AUTONOMY,
        agreement: {
          measures: [
            m("accuracy", { n: 37, recallOnNo: { caught: 3, of: 4, pct: 75 } }),
            m("evidence_specificity", {
              n: 52,
              kappa: 0.71,
              state: "met",
              passes: true,
              recallOnNo: { caught: 6, of: 7, pct: 85.7 },
            }),
            m("missed_risk_cue", { n: 60, state: "undefined" }),
          ],
          gate: { met: false },
          minReviews: 50,
          kappa: 0.6,
          sample: { size: 5, thisWeek: 3, waiting: 2 },
        },
      },
    });
    renderPage();
    const panel = screen.getByTestId("agreement-panel");
    expect(panel).toHaveTextContent("Judge agreement with the clinical advisor");
    expect(panel).toHaveTextContent("random sample: 3 this week");
    expect(screen.getByTestId("agreement-row-accuracy")).toHaveTextContent(
      "AccuracyNot measured yet37 of 50 reviews · Independent check caught 3 of 4 problems you found",
    );
    expect(screen.getByTestId("agreement-row-evidence_specificity")).toHaveTextContent(
      "EvidenceMetAgreement 0.71 · 52 reviews · Independent check caught 6 of 7 problems you found",
    );
    expect(screen.getByTestId("agreement-row-missed_risk_cue")).toHaveTextContent(
      "Missed risk cueNot measurable yet: every answer is the sameAgreement — · 60 reviews · No problems found yet",
    );
    expect(panel).toHaveTextContent(
      "Each measure needs 50 reviews and agreement of at least 0.6. If any drops below, learner try-outs go back to asking a person.",
    );
    expect(panel.textContent).not.toMatch(/κ|[a-z]+_[a-z]+/);
  });

  it("shows two rows and two columns: Try on learners and Live for everyone (always a person)", () => {
    h.permissions = [];
    renderPage();
    const rows = screen.getAllByTestId("autonomy-row");
    expect(rows.map(r => r.firstElementChild?.textContent)).toEqual([
      "Settings (not budgets)",
      "Prompts, agents and default plans",
    ]);
    const matrix = screen.getByTestId("autonomy-matrix");
    expect(matrix).toHaveTextContent("Try on learners");
    expect(matrix).toHaveTextContent("Live for everyone");
    for (const gone of ["Quick check", "Pass test", "Side-by-side trial", "Pinned rules"]) {
      expect(matrix).not.toHaveTextContent(gone);
    }
    expect(screen.queryByTestId("autonomy-settings-quick_test")).toBeNull();
    const promote = screen.getByTestId("autonomy-settings-promote");
    expect(within(promote).getByRole("combobox")).toBeDisabled();
    expect(within(promote).getByRole("combobox")).toHaveDisplayValue("Always a person");
    expect(promote).toHaveAttribute("title", "The plan requires a person to put every change live");
    // The five-point intro from the design.
    const intro = screen.getByTestId("autonomy-intro");
    expect(intro.querySelectorAll("li")).toHaveLength(5);
    expect(intro).toHaveTextContent(
      "Quick check, pass test, side-by-side trial: learners never see these, so the PM agent always runs them on its own, paid from the learning budget.",
    );
    expect(intro).toHaveTextContent("Taken back automatically:");
    expect(intro).toHaveTextContent("The system only tightens, never loosens.");
    expect(intro).toHaveTextContent("Live for everyone: always a person approves");
    expect(within(intro).getByRole("link", { name: "Pinned rules" })).toBeInTheDocument();
    expect(screen.getByTestId("autonomy-facts")).toHaveTextContent("measured from Release 2");
    // Someone who isn't the owner sees the same dropdown, disabled.
    expect(
      within(screen.getByTestId("autonomy-settings-canary")).getByRole("combobox"),
    ).toBeDisabled();
    expect(screen.getByTestId("autonomy-settings-canary")).toHaveAttribute(
      "title",
      "Only the owner changes this.",
    );
  });

  it("per organisation: side-by-side trials Allowed / Not on its sessions; try-outs three choices", () => {
    h.permissions = ["manage:admin:debrief-settings"];
    h.autonomy.mockReturnValue({
      data: {
        ...AUTONOMY,
        orgs: [
          {
            tenantId: "t1",
            tenantName: "Ally Demo",
            live: true,
            // An older "ask" on side-by-side trials reads as Allowed.
            overrides: { paired_trial: "ask", canary: "ask" },
          },
        ],
      },
    });
    h.setOrg.mockReturnValue(resolves());
    renderPage();
    const org = screen.getByTestId("org-autonomy");
    expect(org).toHaveTextContent("Side-by-side trials on its learners");
    expect(org).toHaveTextContent("Try-outs on its learners");
    expect(org).not.toHaveTextContent("guidance");
    const trials = screen.getByLabelText("Ally Demo, Side-by-side trials on its learners");
    expect(Array.from((trials as HTMLSelectElement).options).map(o => o.textContent)).toEqual([
      "Allowed",
      "Not on its sessions",
    ]);
    expect(trials).toHaveDisplayValue("Allowed");
    const tries = screen.getByLabelText("Ally Demo, Try-outs on its learners");
    expect(Array.from((tries as HTMLSelectElement).options).map(o => o.textContent)).toEqual([
      "Same as the table above",
      "Always ask first",
      "Never",
    ]);
    expect(tries).toHaveDisplayValue("Always ask first");
    fireEvent.change(trials, { target: { value: "Not on its sessions" } });
    expect(h.setOrg).toHaveBeenCalledWith({ tenantId: "t1", changes: { paired_trial: "never" } });
  });

  it("per organisation: a stopped organisation reads Stopped, not 'Not switched on yet'", () => {
    h.permissions = ["manage:admin:debrief-settings"];
    const row = (tenantId: string, tenantName: string, live: boolean, stopped: boolean) => ({
      tenantId,
      tenantName,
      live,
      stopped,
      overrides: { paired_trial: "default", canary: "default" },
    });
    h.autonomy.mockReturnValue({
      data: {
        ...AUTONOMY,
        orgs: [row("t1", "Northwind", false, true), row("t2", "Bright Path", false, false)],
      },
    });
    renderPage();
    const org = screen.getByTestId("org-autonomy");
    expect(org).toHaveTextContent("Northwind" + "Stopped · no trials or try-outs");
    expect(org).toHaveTextContent("Bright Path" + "Not switched on yet · no trials or try-outs");
  });

  describe("try-out override before agreement is reached", () => {
    it("asks to confirm, says what learners will get, then saves it as an override", async () => {
      h.permissions = ["manage:admin:debrief-settings"];
      renderPage();
      fireEvent.change(
        screen.getByLabelText("Prompts, agents and default plans, Try on learners"),
        {
          target: { value: "On its own (override: asks to confirm)" },
        },
      );
      expect(h.setMatrix).not.toHaveBeenCalled();
      expect(screen.getByTestId("autonomy-override-body")).toHaveTextContent(
        "The independent check hasn't been shown to agree with the clinical advisor yet. Learner try-outs for prompts, agents and default plans will reach learners without approval.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Let them run" }));
      await waitFor(() =>
        expect(h.setMatrix).toHaveBeenCalledWith({
          changes: [{ kind: "prompts", step: "canary", value: "auto" }],
          override: true,
        }),
      );
    });

    it("cancelling saves nothing", () => {
      h.permissions = ["manage:admin:debrief-settings"];
      renderPage();
      fireEvent.change(
        screen.getByLabelText("Prompts, agents and default plans, Try on learners"),
        {
          target: { value: "On its own (override: asks to confirm)" },
        },
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(h.setMatrix).not.toHaveBeenCalled();
    });

    it("an override in force is shown in the row; with agreement reached there is no override wording", () => {
      h.permissions = ["manage:admin:debrief-settings"];
      h.autonomy.mockReturnValue({
        data: {
          ...AUTONOMY,
          kinds: AUTONOMY.kinds.map(k =>
            k.kind === "prompts"
              ? {
                  ...k,
                  cells: { ...k.cells, canary: "auto" },
                  override: { at: "2026-11-12T10:00:00Z", by: 7, name: "Gopi" },
                }
              : k,
          ),
        },
      });
      renderPage();
      const rows = screen.getAllByTestId("autonomy-row");
      expect(within(rows[1]).getByTestId("autonomy-override")).toHaveTextContent(
        "Try on learners: On its own · owner override, Gopi, 12 Nov 2026",
      );
      const settingsCanary = screen.getByLabelText("Settings (not budgets), Try on learners");
      expect(Array.from((settingsCanary as HTMLSelectElement).options)[0]).toHaveTextContent(
        /^On its own$/,
      );
      expect(within(rows[0]).queryByTestId("autonomy-override")).toBeNull();
    });

    it("a re-locked kind can't be overridden", () => {
      h.permissions = ["manage:admin:debrief-settings"];
      const no = {
        eligible: false,
        reason: "Not now: 2 learner try-outs were taken back in the last 4 weeks.",
      };
      h.autonomy.mockReturnValue({
        data: {
          ...AUTONOMY,
          kinds: AUTONOMY.kinds.map(k =>
            k.kind === "prompts"
              ? { ...k, overridable: false, eligibility: { ...k.eligibility, canary: no } }
              : k,
          ),
        },
      });
      renderPage();
      const canary = screen.getByLabelText("Prompts, agents and default plans, Try on learners");
      const first = Array.from((canary as HTMLSelectElement).options)[0];
      expect(first).toHaveTextContent("On its own (not now)");
      expect(first).toBeDisabled();
    });
  });

  it("a cell the system set back to asks first says so, when and why, in its row", () => {
    h.permissions = [];
    h.autonomy.mockReturnValue({
      data: {
        ...AUTONOMY,
        kinds: AUTONOMY.kinds.map(k =>
          k.kind === "settings"
            ? {
                ...k,
                relock: {
                  at: "2026-11-12T05:35:00Z",
                  reason: "agreement fell below 0.6",
                  steps: ["canary"],
                  by: "system",
                },
              }
            : k,
        ),
      },
    });
    renderPage();
    const row = screen.getAllByTestId("autonomy-row")[0];
    expect(within(row).getByTestId("autonomy-relock")).toHaveTextContent(
      "Try on learners: Asks first · set by the system on 12 Nov 2026: agreement fell below 0.6. Turning it back on is up to the owner.",
    );
    expect(
      screen.getAllByTestId("autonomy-row")[1].querySelector("[data-testid=autonomy-relock]"),
    ).toBeNull();
  });

  it("never shows a code: an older server's reasons read in words", () => {
    h.permissions = [];
    h.autonomy.mockReturnValue({
      data: {
        ...AUTONOMY,
        kinds: AUTONOMY.kinds.map(k =>
          k.kind === "prompts"
            ? {
                ...k,
                eligibility: {
                  ...k.eligibility,
                  canary: {
                    eligible: false,
                    reason:
                      "Not yet: agreement below 0.6 (accuracy not measured, evidence_specificity 0.41, missed_risk_cue not measured).",
                  },
                },
              }
            : k,
        ),
      },
    });
    renderPage();
    const matrix = screen.getByTestId("autonomy-matrix");
    expect(matrix.textContent).not.toMatch(/[a-z]+_[a-z]+/);
    expect(matrix).toHaveTextContent("Evidence 0.41");
    expect(matrix).toHaveTextContent("Missed risk cue not measured");
  });

  it("lets the owner change learner try-outs; on its own needs agreement or a confirmed override", async () => {
    h.permissions = ["manage:admin:debrief-settings"];
    renderPage();
    const canary = screen.getByLabelText("Prompts, agents and default plans, Try on learners");
    const options = Array.from((canary as HTMLSelectElement).options);
    expect(options.map(o => o.textContent)).toEqual([
      "On its own (override: asks to confirm)",
      "Asks first",
      "Off",
    ]);
    expect(options[0]).not.toBeDisabled();
    expect(canary).toHaveDisplayValue("Asks first");
    const prompts = screen.getAllByTestId("autonomy-row")[1];
    expect(within(prompts).getByTestId("autonomy-eligible-canary")).toHaveTextContent(
      "Try on learners: not yet · Not yet: agreement below 0.6",
    );
    fireEvent.change(screen.getByLabelText("Settings (not budgets), Try on learners"), {
      target: { value: "Asks first" },
    });
    await waitFor(() =>
      expect(h.setMatrix).toHaveBeenCalledWith({
        changes: [{ kind: "settings", step: "canary", value: "ask" }],
      }),
    );
  });
});
