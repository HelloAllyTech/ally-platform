import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import { FeatureToggleKey, Permissions } from "@constants";

const h = vi.hoisted(() => ({
  permissions: [] as string[],
  features: [] as string[],
  loading: false,
  accounts: [] as { freeBalanceUsd: number }[],
  unpriced: [] as unknown[],
  alerts: [] as unknown[],
  packs: { enabled: true, packs: [{ currentReleaseId: "r1" }] } as unknown,
}));

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetPermissionsQuery: () => ({ data: h.permissions, isLoading: h.loading }),
  useGetFeatureTogglesQuery: () => ({ data: h.features, isLoading: false }),
  useGetCreditAccountsQuery: (_: unknown, o?: { skip?: boolean }) => ({
    data: o?.skip ? undefined : h.accounts,
    isLoading: false,
  }),
  useGetUnknownBillingModelsQuery: (_: unknown, o?: { skip?: boolean }) => ({
    data: o?.skip ? undefined : h.unpriced,
    isLoading: false,
  }),
  useGetCostOverviewQuery: (_: unknown, o?: { skip?: boolean }) => ({
    data: o?.skip ? undefined : { alerts: h.alerts, monthWithFixed: 12.5, today: 1.25 },
    isLoading: false,
  }),
}));
vi.mock("../../SafetyPacks/safetyPacksApi", () => ({
  useGetSafetyPacksQuery: (_: unknown, o?: { skip?: boolean }) => ({
    data: o?.skip ? undefined : h.packs,
    isLoading: false,
  }),
}));
vi.mock("../panels/embedded", () => {
  const panel = (name: string) => () => <div>{name}</div>;
  return {
    CreditsPanel: panel("credits panel"),
    CostsPanel: panel("costs panel"),
    ModelPricesPanel: panel("models panel"),
    WhatsAppRatesPanel: panel("whatsapp panel"),
    PlansPanel: panel("plans panel"),
    SafetyPacksPanel: panel("packs panel"),
    StartingSettingsView: panel("settings panel"),
    QuickRepliesView: panel("replies panel"),
    KnowledgeLibraryView: panel("library panel"),
    ChannelsView: panel("channels panel"),
    TemplatesView: panel("templates panel"),
    SupportPanel: panel("support panel"),
  };
});

// eslint-disable-next-line import/first
import { AssistantsAdmin } from "../AssistantsAdmin";

const Where: React.FC = () => {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/assistants-admin/:section" element={<AssistantsAdmin />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );

const ALL = {
  permissions: [Permissions.SYSTEM_ACCESS, Permissions.MANAGE_SAFETY_PACKS],
  features: [FeatureToggleKey.MANAGE_COSTS],
};

const tabLabels = () => screen.getAllByTestId(/^tab-/).map(t => t.textContent?.trim());

describe("AssistantsAdmin", () => {
  beforeEach(() => {
    h.permissions = ALL.permissions;
    h.features = ALL.features;
    h.loading = false;
    h.accounts = [];
    h.unpriced = [];
    h.alerts = [];
    h.packs = { enabled: true, packs: [{ currentReleaseId: "r1" }] };
  });

  it("shows all seven sections in the order a job runs, to staff holding every grant", async () => {
    renderAt("/assistants-admin/overview");
    expect(await screen.findByTestId("assistants-admin")).toBeInTheDocument();
    expect(tabLabels()).toEqual([
      "Overview",
      "Builders & credits",
      "Pricing & costs",
      "Safety",
      "Defaults & library",
      "Support",
      "Launch & data",
    ]);
  });

  it("shows only the sections a staff member holds the grant for", async () => {
    h.permissions = [];
    h.features = [FeatureToggleKey.MANAGE_COSTS];
    renderAt("/assistants-admin/overview");
    await screen.findByTestId("assistants-admin");
    expect(tabLabels()).toEqual(["Overview", "Builders & credits", "Pricing & costs"]);
  });

  it("says plainly when the person holds none of the grants", () => {
    h.permissions = [];
    h.features = [];
    renderAt("/assistants-admin/overview");
    expect(screen.getByTestId("assistants-admin-no-access")).toBeInTheDocument();
  });

  it("sends a section the person can't use back to the Overview", async () => {
    h.permissions = [];
    h.features = [FeatureToggleKey.MANAGE_COSTS];
    renderAt("/assistants-admin/safety");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/overview"));
  });

  it("opens a section on its first view and switches views in the address", async () => {
    renderAt("/assistants-admin/pricing");
    expect(await screen.findByText("costs panel")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Plans & seats"));
    expect(await screen.findByText("plans panel")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/assistants-admin/pricing?view=plans");
  });

  it("opens a deep-linked view, and explains the view in a line", async () => {
    renderAt("/assistants-admin/pricing?view=models");
    expect(await screen.findByText("models panel")).toBeInTheDocument();
    expect(screen.getByText(/price per million tokens/)).toBeInTheDocument();
  });

  it("falls back to the first view for an unknown ?view=", async () => {
    renderAt("/assistants-admin/content?view=nope");
    expect(await screen.findByText("settings panel")).toBeInTheDocument();
  });

  it("names the jobs in a section and points the crisis replies to where they are edited", async () => {
    renderAt("/assistants-admin/safety");
    expect(await screen.findByText("packs panel")).toBeInTheDocument();
    expect(screen.getByText("Roll a pack back")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Defaults & library → Quick replies/ });
    expect(link).toHaveAttribute("href", "/assistants-admin/content?view=replies");
  });

  it("has no view switcher where a section has one view", async () => {
    renderAt("/assistants-admin/support");
    expect(await screen.findByText("support panel")).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: /Views in this section/ })).toBeNull();
  });

  it("explains that Launch & data runs outside this screen", async () => {
    renderAt("/assistants-admin/launch");
    expect(await screen.findByTestId("aa-switches")).toBeInTheDocument();
    expect(screen.getByText(/These run outside this screen/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Data clean-up"));
    expect(await screen.findByTestId("aa-data")).toBeInTheDocument();
    expect(screen.getAllByText("Cannot be undone")).toHaveLength(2);
  });
});

describe("AssistantsAdmin overview", () => {
  beforeEach(() => {
    h.permissions = ALL.permissions;
    h.features = ALL.features;
    h.loading = false;
    h.accounts = [
      { freeBalanceUsd: 0 },
      { freeBalanceUsd: 0 },
      { freeBalanceUsd: 3 },
      { freeBalanceUsd: 50 },
    ];
    h.unpriced = [{}];
    h.alerts = [];
    h.packs = { enabled: false, packs: [] };
  });

  it("raises what needs attention, live, with a card per place to fix it", async () => {
    renderAt("/assistants-admin/overview");
    expect(await screen.findByText("2 builders are out of credits")).toBeInTheDocument();
    expect(screen.getByText("1 model has no price")).toBeInTheDocument();
    expect(screen.getByText("No cost alerts")).toBeInTheDocument();
    expect(screen.getByText("Safety pack releases are switched off")).toBeInTheDocument();
    expect(screen.getByTestId("aa-card-credits")).toHaveAttribute(
      "href",
      "/assistants-admin/credits",
    );
    expect(screen.getByTestId("aa-card-models")).toHaveAttribute(
      "href",
      "/assistants-admin/pricing?view=models",
    );
  });

  it("calls out low balances when nobody is empty", async () => {
    h.accounts = [{ freeBalanceUsd: 3 }, { freeBalanceUsd: 50 }];
    renderAt("/assistants-admin/overview");
    expect(await screen.findByText("1 builder is running low")).toBeInTheDocument();
  });

  it("shows the month so far and a shortcut for each job", async () => {
    renderAt("/assistants-admin/overview");
    expect(await screen.findByText("$12.50")).toBeInTheDocument();
    expect(screen.getByTestId("aa-task-grant")).toHaveAttribute(
      "href",
      "/assistants-admin/credits",
    );
    expect(screen.getByTestId("aa-task-switch")).toHaveAttribute(
      "href",
      "/assistants-admin/launch?view=switches",
    );
  });

  it("offers only the shortcuts the person can use", async () => {
    h.permissions = [];
    h.features = [FeatureToggleKey.MANAGE_COSTS];
    renderAt("/assistants-admin/overview");
    expect(await screen.findByTestId("aa-task-grant")).toBeInTheDocument();
    expect(screen.queryByTestId("aa-task-pack")).toBeNull();
    expect(screen.queryByTestId("aa-task-look")).toBeNull();
    expect(screen.queryByTestId("aa-card-safety")).toBeNull();
  });
});
