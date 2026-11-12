import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  settings: vi.fn(),
  update: vi.fn(),
  accept: vi.fn(),
  baseline: vi.fn(),
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
}));

// eslint-disable-next-line import/first
import { en } from "@constants";
// eslint-disable-next-line import/first
import { SettingsTab } from "../SettingsTab";

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
