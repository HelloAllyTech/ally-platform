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
  useSetDebriefOrgAutonomyMutation: () => [vi.fn(), { isLoading: false }],
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
    fireEvent.change(screen.getByLabelText("Share of live debriefs on the canary"), {
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
      reason: "Accuracy 0.52",
      eligibility: {
        quick_test: { eligible: true, reason: "Yes: learners never see it; budget-capped." },
        gate_test: { eligible: true, reason: "Yes: learners never see it; budget-capped." },
        paired_trial: { eligible: true, reason: "Yes: learners never see it; budget-capped." },
        canary: { eligible: false, reason: "Not yet: judge agreement below 0.6 (accuracy 0.52)." },
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
  const renderPage = () =>
    render(
      <MemoryRouter>
        <DebriefSettingsPage />
      </MemoryRouter>,
    );

  it("the section menu stays on /debriefs/settings, scrolls to the section and marks it", () => {
    h.permissions = [];
    let where = "";
    const Where = () => {
      const l = useLocation();
      where = `${l.pathname}${l.hash}`;
      return null;
    };
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    render(
      <MemoryRouter initialEntries={["/debriefs/settings"]}>
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
    const budget = screen.getByTestId("settings-nav-budget");
    expect(budget).toHaveAttribute("href", "/debriefs/settings#budget");
    fireEvent.click(budget);
    expect(where).toBe("/debriefs/settings#budget");
    expect(scrollIntoView).toHaveBeenCalled();
    expect(budget).toHaveAttribute("aria-current", "location");
    expect(screen.getByTestId("settings-nav-orgs")).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByTestId("settings-nav-guidance"));
    expect(where).toBe("/debriefs/settings#guidance");
  });

  it("is read-only for someone who isn't the owner, and says who can change it", () => {
    h.permissions = [];
    renderPage();
    expect(screen.getByTestId("settings-owner-note")).toHaveTextContent(
      "Only the owner can change these.",
    );
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch on" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Emergency stop" })).not.toBeInTheDocument();
    expect(screen.getByTestId("setting-value-gateCases")).toHaveTextContent("100");
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
    expect(screen.getAllByRole("button", { name: "Save changes" }).length).toBeGreaterThan(0);
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
      <MemoryRouter>
        <DebriefSettingsPage />
      </MemoryRouter>,
    );

  it("shows three rows, pinned rules never, and only the two per-organisation columns", () => {
    h.permissions = [];
    renderPage();
    const rows = screen.getAllByTestId("autonomy-row");
    expect(rows.map(r => r.textContent?.split(/On its own|Asks first|Off|Never/)[0])).toEqual([
      "Settings (not budgets)",
      "Prompts, agents and default plans",
      "Pinned rules",
    ]);
    expect(rows[2]).toHaveTextContent("Never");
    expect(screen.getByTestId("org-autonomy")).toHaveTextContent("Canaries on its learners");
    expect(screen.getByTestId("org-autonomy")).not.toHaveTextContent("guidance");
    expect(screen.getByTestId("autonomy-facts")).toHaveTextContent("measured from Release 2");
    expect(screen.queryByTestId("autonomy-settings-quick_test")).toBeNull();
  });

  it("lets the owner change a cell; only the canary needs judge agreement for on its own", async () => {
    h.permissions = ["manage:admin:debrief-settings"];
    renderPage();
    // Plan §4: learners never see a quick test, so no κ gate there.
    const quick = screen.getByLabelText("Prompts, agents and default plans, Quick test");
    expect(Array.from((quick as HTMLSelectElement).options).map(o => o.textContent)).toEqual([
      "On its own",
      "Asks first",
      "Off",
    ]);
    const canary = screen.getByLabelText("Prompts, agents and default plans, Canary");
    expect(Array.from((canary as HTMLSelectElement).options).map(o => o.textContent)).toEqual([
      "Asks first",
      "Off",
    ]);
    const prompts = screen.getAllByTestId("autonomy-row")[1];
    expect(within(prompts).getByTestId("autonomy-eligible-tests")).toHaveTextContent("Tests: Yes");
    expect(within(prompts).getByTestId("autonomy-eligible-canary")).toHaveTextContent(
      "Canary: Not yet · Not yet: judge agreement below 0.6",
    );
    expect(within(prompts).getByTestId("autonomy-eligible-tests")).not.toHaveTextContent("0.6");
    fireEvent.change(screen.getByLabelText("Settings (not budgets), Canary"), {
      target: { value: "On its own" },
    });
    await waitFor(() =>
      expect(h.setMatrix).toHaveBeenCalledWith({
        changes: [{ kind: "settings", step: "canary", value: "auto" }],
      }),
    );
  });
});
