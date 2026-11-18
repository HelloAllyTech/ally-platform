import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const a = en.debriefs.v2.autonomy;

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
    const toggle = screen.getByLabelText("No new serious problems");
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
      "Score",
      "Locked prompts",
      "Clinical lists",
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
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Score");
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

  it("the old risk-cue options tab and banner links open Organisations", () => {
    h.permissions = ["review:admin:debriefs"];
    renderPage("#risk-cues");
    expect(shown()).toEqual(["settings-section-orgs"]);
    cleanup();
    renderPage("?category=risk_cue_options");
    expect(shown()).toEqual(["settings-section-orgs"]);
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

  it("never wraps: the owner note truncates with its full text on hover, the last tabs overflow into More below lg", () => {
    h.permissions = [];
    renderPage();
    const note = screen.getByTestId("settings-owner-note");
    expect(note).toHaveAttribute("title", "Only the owner can change these.");
    expect(note).toHaveClass("truncate");
    expect(screen.getByTestId("settings-tabs")).toHaveClass("flex-nowrap");
    // Score, Locked prompts and Progress are tabs at lg and up, More items below it.
    for (const id of ["weights", "pinned", "clinical", "progress"])
      expect(tab(id)).toHaveClass("hidden", "min-[1056px]:inline");
    expect(tab("orgs")).not.toHaveClass("hidden");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Score" }));
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
    expect(screen.getByTestId("test-setting-gateCases")).toHaveTextContent("100");
    noEdits();
    fireEvent.click(tab("autonomy"));
    expect(screen.getByLabelText(a.askLowConfidence.name)).toBeDisabled();
    expect(screen.getByTestId("v2-setting-value-canaryShare")).toHaveTextContent("10%");
    noEdits();
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
    expect(screen.getByRole("dialog")).toHaveTextContent("goes live as soon as you confirm");
    // Tests: the values in force; the PM agent tunes them, nobody accepts proposals.
    fireEvent.click(tab("tests"));
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    fireEvent.click(tab("autonomy"));
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

describe("Settings › Autonomy, Score and Tests (v2, U4)", () => {
  const V2_VIEW = {
    ...VIEW,
    values: {
      ...VIEW.values,
      askLowConfidence: true,
      askModels: false,
      canaryMinRuns: 40,
      canaryMinDays: 3,
      undoMargin: 0.3,
      watchDays: 14,
      scoreWeightQuality: 0.4,
      scoreWeightPass: 0.25,
      scoreWeightHelpful: 0.2,
      scoreWeightFlags: 0.15,
      slackChannel: "#debrief-alerts",
      safetyContact: "",
    },
    lastChanges: {
      gateCases: {
        lastChangedBy: "Debrief PM agent",
        lastChangedAt: "2026-11-12T00:00:00Z",
        why: "Was 30: 4 changes passed here and then failed the next test",
        changeId: "c-tests",
      },
    },
  };
  beforeEach(() => {
    vi.clearAllMocks();
    h.settings.mockReturnValue({ data: V2_VIEW, isError: false, refetch: vi.fn() });
    h.overview.mockReturnValue({ data: OVERVIEW, isError: false, refetch: vi.fn() });
    h.tenants.mockReturnValue({ data: TENANTS, isError: false, refetch: vi.fn() });
    h.autonomy.mockReturnValue({ data: AUTONOMY });
    h.update.mockReturnValue(resolves());
    h.setOrg.mockReturnValue(resolves());
  });
  const renderPage = (hash: string) =>
    render(
      <MemoryRouter initialEntries={[`/debriefs/settings${hash}`]}>
        <DebriefSettingsPage />
      </MemoryRouter>,
    );

  it("Always asks a person: two locked kinds, then low confidence (on) and new models (off)", () => {
    h.permissions = ["manage:admin:debrief-settings"];
    renderPage("#autonomy");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Autonomy: the Debrief PM agent ships changes on its own, except these",
    );
    expect(screen.getByTestId("autonomy-v2")).toHaveTextContent("watched for 14 days");
    const rows = within(screen.getByTestId("always-asks")).getAllByTestId("always-asks-row");
    expect(rows.map(r => r.querySelector("span span")?.textContent)).toEqual([
      "Crisis lines and support copy",
      "Budget increases",
      "Anything the Debrief PM agent is not confident about",
      "New models or providers",
    ]);
    for (const r of rows.slice(0, 2)) {
      expect(r).toHaveAttribute("data-locked", "true");
      expect(within(r).getByRole("checkbox")).toBeChecked();
      expect(within(r).getByRole("checkbox")).toBeDisabled();
    }
    const low = screen.getByLabelText(a.askLowConfidence.name);
    expect(low).toBeChecked();
    expect(low).not.toBeDisabled();
    const models = screen.getByLabelText(a.askModels.name);
    expect(models).not.toBeChecked();
    expect(rows[3]).toHaveTextContent("Off: model changes go through the same tests as prompts");
    // The old matrix and the judge-agreement block are gone.
    expect(screen.queryByTestId("autonomy-matrix")).toBeNull();
    expect(screen.queryByTestId("autonomy-agreement")).toBeNull();
  });

  it("switching an always-ask kind saves it at once", async () => {
    h.permissions = ["manage:admin:debrief-settings"];
    renderPage("#autonomy");
    fireEvent.click(screen.getByLabelText(a.askModels.name));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ changes: { askModels: true } }));
  });

  it("rollout rules: share, debriefs, days, undo margin, watch; shares are sent as fractions", async () => {
    h.permissions = ["manage:admin:debrief-settings"];
    renderPage("#autonomy");
    const rules = screen.getByTestId("rollout-rules");
    expect(rules).toHaveTextContent("How a change goes live and comes back");
    expect(rules).toHaveTextContent(
      "Drops are compared within the same language and debrief flow.",
    );
    fireEvent.change(within(rules).getByLabelText("Share of learners while it is tried (%)"), {
      target: { value: "20" },
    });
    fireEvent.change(within(rules).getByLabelText("Undo when the score drops by more than"), {
      target: { value: "0.5" },
    });
    fireEvent.click(within(rules).getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(h.update).toHaveBeenCalledWith({ changes: { canaryShare: 0.2, undoMargin: 0.5 } }),
    );
  });

  it("per organisation: try changes on its learners, Yes or only once live for everyone", async () => {
    h.permissions = ["manage:admin:debrief-settings"];
    renderPage("#autonomy");
    const rows = within(screen.getByTestId("org-tryouts")).getAllByTestId("org-tryout-row");
    expect(rows.length).toBeGreaterThan(0);
    const select = within(rows[0]).getByRole("combobox") as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.textContent)).toEqual([
      "Yes",
      "No: only once live for everyone",
    ]);
    fireEvent.change(select, { target: { value: "never" } });
    await waitFor(() =>
      expect(h.setOrg).toHaveBeenCalledWith({ tenantId: "t1", changes: { canary: "never" } }),
    );
  });

  it("Score: four weights, the two gates in words, Slack channel and safety contact", async () => {
    h.permissions = ["manage:admin:debrief-settings"];
    renderPage("#weights");
    const page = screen.getByTestId("score-settings");
    expect(page).toHaveTextContent(
      "Score: what the Debrief PM agent improves, and what undoes a change",
    );
    expect(page).toHaveTextContent("No new missed clear risk cue · undoes a change at once");
    expect(page).toHaveTextContent("Cost within the session budget");
    expect(screen.getByLabelText("Quality score (judge) (%)")).toHaveValue(40);
    expect(screen.queryByTestId("score-weights-off")).toBeNull();
    fireEvent.change(screen.getByLabelText("Pass rate (%)"), { target: { value: "35" } });
    expect(screen.getByTestId("score-weights-off")).toHaveTextContent("add up to 110%");
    const slack = screen.getByTestId("score-slack");
    fireEvent.change(within(slack).getByLabelText("Named safety contact"), {
      target: { value: "Dr Mehta" },
    });
    fireEvent.click(within(slack).getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(h.update).toHaveBeenCalledWith({ changes: { safetyContact: "Dr Mehta" } }),
    );
  });

  it("Tests: the value in force and its last change, with no Proposed or Accept", () => {
    h.permissions = ["manage:admin:debrief-settings"];
    renderPage("#tests");
    const row = screen.getByTestId("test-setting-gateCases");
    expect(row).toHaveTextContent("100");
    expect(row).toHaveTextContent("Debrief PM agent ·");
    expect(row).toHaveTextContent("Was 30: 4 changes passed here and then failed the next test");
    expect(within(row).getByRole("link", { name: "See change" })).toHaveAttribute(
      "href",
      "/debriefs/pm-agent?change=c-tests",
    );
    expect(screen.queryByText("Proposed")).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.getByTestId("test-setting-canaryShare")).toHaveTextContent("—");
  });

  it("Budgets say a higher budget always waits for a person", () => {
    h.permissions = [];
    renderPage("#budget");
    expect(screen.getByTestId("settings-section-budget")).toHaveTextContent(
      "The Debrief PM agent may propose a lower budget; a higher one always waits for you.",
    );
  });
});
