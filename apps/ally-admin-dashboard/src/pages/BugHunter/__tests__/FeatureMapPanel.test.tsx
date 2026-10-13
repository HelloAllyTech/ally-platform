import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FeatureMapPanel } from "../FeatureMapPanel";

const getMaps = vi.fn();
const refresh = vi.fn();
const removeCard = vi.fn();
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

vi.mock("@api", () => ({
  useGetBugHunterFeatureMapsQuery: (...args: unknown[]) => getMaps(...args),
  useRefreshBugHunterFeatureMapsMutation: () => [refresh, { isLoading: false }],
  useRemoveBugHunterFeatureMapMutation: () => [removeCard, { isLoading: false }],
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toast.success(...a),
    error: (...a: unknown[]) => toast.error(...a),
    info: (...a: unknown[]) => toast.info(...a),
  },
}));
vi.mock("@hooks", () => ({}));
vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("@utils", () => ({ formatDate: (d: string) => d }));
vi.mock("@assets", () => ({ TooltipIcon: () => <svg data-testid="tooltip-icon" /> }));
vi.mock("@components/action-confirmation-popup", () => ({
  ActionConfirmationPopup: ({ title, description, primaryButton }: any) => (
    <div data-testid="confirm">
      <p>{title}</p>
      <p>{description}</p>
      <button onClick={primaryButton.onClick}>{primaryButton.label}</button>
    </div>
  ),
}));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
  Select: ({ id, labelText, value, onChange, children }: any) => (
    <label>
      {labelText}
      <select id={id} value={value} onChange={onChange}>
        {children}
      </select>
    </label>
  ),
  SelectItem: ({ value, text }: any) => <option value={value}>{text}</option>,
  SidePanel: ({ open, title, children }: any) =>
    open ? (
      <div data-testid="side-panel">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  TextArea: ({ id, labelText, value, onChange }: any) => (
    <label>
      {labelText}
      <textarea id={id} value={value} onChange={onChange} />
    </label>
  ),
}));

const card = {
  id: "c-1",
  repo: "ally-be",
  slug: "simulation-titles-translated",
  valueSource: "database",
  title: "Simulation titles in the learner's language",
  summary:
    "Stored in scenarios.translations, written by persistTranslationsForScenarios, served by GET /v2/learn/scenarios.",
  entryPoints: ["src/learn/service/scenario.service.ts"],
  endpoints: ["GET /v2/learn/scenarios"],
  dataHomes: ["scenarios.translations"],
  writtenBy: "Simulation Studio save",
  relatedRepos: ["ally-web: renders the list"],
  gotchas: [],
  sourceSha: "abcdef1234567",
  runId: "map-1",
  updatedAt: "2026-10-13",
};

describe("FeatureMapPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMaps.mockReturnValue({ data: { cards: [card] }, isLoading: false, isError: false });
    refresh.mockReturnValue({ unwrap: () => Promise.resolve({ runIds: ["map-1", "map-2"] }) });
  });

  it("shows each card with where its values live and the commit it describes", () => {
    render(<FeatureMapPanel canTriage />);
    expect(screen.getByText("Simulation titles in the learner's language")).toBeTruthy();
    expect(screen.getByText("scenarios.translations")).toBeTruthy();
    expect(screen.getByText("ally-web: renders the list")).toBeTruthy();
    expect(screen.getByText(/Mapped at abcdef12 on 2026-10-13/)).toBeTruthy();
    // Empty lists render no row at all.
    expect(screen.queryByText("Gotchas")).toBeNull();
  });

  it("asks before starting a map run, then says how many started", async () => {
    render(<FeatureMapPanel canTriage />);
    fireEvent.click(screen.getByText("Map now"));
    expect(screen.getByTestId("confirm").textContent).toContain("every repo");
    fireEvent.click(screen.getByText("Start mapping"));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith({}));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("2 run(s)")),
    );
  });

  it("maps one repo when one is picked, and says so when nothing started", async () => {
    refresh.mockReturnValue({ unwrap: () => Promise.resolve({ runIds: [] }) });
    render(<FeatureMapPanel canTriage />);
    fireEvent.change(screen.getByLabelText("Repo"), { target: { value: "ally-web" } });
    expect(getMaps).toHaveBeenLastCalledWith({ repo: "ally-web" });
    fireEvent.click(screen.getByText("Map now"));
    fireEvent.click(screen.getByText("Start mapping"));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith({ repo: "ally-web" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
  });

  it("is read-only without triage access, and explains an empty map", () => {
    getMaps.mockReturnValue({ data: { cards: [] }, isLoading: false, isError: false });
    render(<FeatureMapPanel canTriage={false} />);
    expect(screen.queryByText("Map now")).toBeNull();
    expect(screen.getByText(/No cards yet/)).toBeTruthy();
    expect(screen.getByText(/needs triage access/)).toBeTruthy();
  });

  it("labels where the card's value comes from", () => {
    render(<FeatureMapPanel canTriage />);
    expect(screen.getByTestId("feature-card-source").textContent).toBe("From the database");
  });

  it("removes a wrong card only with a reason, and sends the reason", async () => {
    removeCard.mockReturnValue({ unwrap: () => Promise.resolve({ removed: true }) });
    render(<FeatureMapPanel canTriage />);
    fireEvent.click(screen.getByText("Wrong card"));
    const submit = screen.getByText("Remove card") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What's wrong with it"), {
      target: { value: "Describes labels, not simulation titles" },
    });
    fireEvent.click(screen.getByText("Remove card"));
    await waitFor(() =>
      expect(removeCard).toHaveBeenCalledWith({
        id: "c-1",
        reason: "Describes labels, not simulation titles",
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("offers no Wrong card button without triage access", () => {
    render(<FeatureMapPanel canTriage={false} />);
    expect(screen.queryByText("Wrong card")).toBeNull();
  });
});
