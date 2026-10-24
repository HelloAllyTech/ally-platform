import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  delegation: vi.fn(),
  setStage: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  userId: { current: 7 as number | undefined },
  access: { current: { canEdit: true } as Record<string, boolean> },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSelector: (select: (state: unknown) => unknown) =>
    select({ user: { user: { id: h.userId.current } } }),
}));
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideDelegationQuery: () => h.delegation(),
  useSetAllyGuideDelegationMutation: () => [h.setStage, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { DelegationPanel } from "../DelegationPanel";

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });

const precondition = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  label: `Requirement ${id}`,
  stage: 2,
  need: 30,
  have: 41,
  met: true,
  ...overrides,
});

const STAGES = [
  { stage: 1, label: "People run every step", unlocked: true },
  { stage: 2, label: "The gate, shadow and canary run themselves", unlocked: true },
  { stage: 3, label: "Promotion is automatic", unlocked: false },
];

const delegation = (overrides: Record<string, unknown> = {}) => ({
  stage: 1,
  label: "People run every step",
  unlocked: 2,
  changedAt: "2026-10-20T09:30:00.000Z",
  changedBy: 7,
  changedByName: "Asha Rao",
  reason: "first week",
  autoRevert: true,
  stages: STAGES,
  preconditions: [
    precondition("labelled_reviews"),
    precondition("kappa:warmth", { need: 0.6, have: 0.72 }),
    precondition("promotions", { stage: 3, need: 5, have: 2, met: false }),
    precondition("shadow_runs", { stage: 3, need: 3, have: null, met: false }),
  ],
  ...overrides,
});

describe("DelegationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.userId.current = 7;
    h.access.current = { canEdit: true };
    h.setStage.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    h.delegation.mockReturnValue(ok(delegation()));
  });

  it("says which stage it is at, what is unlocked, and that a bad canary always reverts", () => {
    render(<DelegationPanel />);

    expect(screen.getByTestId("delegation-stage")).toHaveTextContent(
      "Stage 1: People run every step",
    );
    expect(screen.getByTestId("ally-delegation")).toHaveTextContent("Stages up to 2 are unlocked.");
    expect(screen.getByTestId("delegation-auto-revert")).toBeInTheDocument();
  });

  it("names who last changed it, and says you for yourself", () => {
    render(<DelegationPanel />);
    expect(screen.getByTestId("delegation-changed")).toHaveTextContent("Last changed by you");
    expect(screen.getByTestId("delegation-changed")).toHaveTextContent("Reason: first week");
  });

  it("names someone else (their id only when they have no name), and says so when the system lowered it", () => {
    h.userId.current = 99;
    const { unmount } = render(<DelegationPanel />);
    expect(screen.getByTestId("delegation-changed")).toHaveTextContent("Last changed by Asha Rao");
    unmount();

    h.delegation.mockReturnValue(ok(delegation({ changedByName: null })));
    const nameless = render(<DelegationPanel />);
    expect(screen.getByTestId("delegation-changed")).toHaveTextContent("Last changed by user 7");
    nameless.unmount();

    h.delegation.mockReturnValue(ok(delegation({ changedBy: null, reason: null })));
    render(<DelegationPanel />);
    expect(screen.getByTestId("delegation-changed")).toHaveTextContent("Lowered automatically");
    expect(screen.getByTestId("delegation-changed")).not.toHaveTextContent("Reason");
  });

  it("marks each stage current, unlocked or locked", () => {
    render(<DelegationPanel />);

    const items = within(screen.getByTestId("delegation-stages")).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Current");
    expect(items[1]).toHaveTextContent("Unlocked");
    expect(items[2]).toHaveTextContent("Locked");
  });

  it("shows every precondition with the actual beside what it needs, kappa to two places", () => {
    render(<DelegationPanel />);

    const kappa = screen.getByTestId("precondition-kappa:warmth");
    expect(kappa).toHaveTextContent("0.60");
    expect(kappa).toHaveTextContent("0.72");
    expect(kappa).toHaveTextContent("Met");

    const promotions = screen.getByTestId("precondition-promotions");
    expect(promotions).toHaveTextContent("Stage 3");
    expect(promotions).toHaveTextContent("5");
    expect(promotions).toHaveTextContent("2");
    expect(promotions).toHaveTextContent("Not met");
  });

  it("says nothing yet where there is nothing to count, not zero", () => {
    render(<DelegationPanel />);

    expect(screen.getByTestId("precondition-shadow_runs")).toHaveTextContent("Nothing yet");
  });

  it("raises one step at a time, asking for a reason that is sent with the change", async () => {
    render(<DelegationPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Raise to stage 2…" }));
    expect(screen.getByRole("dialog", { name: "Raise to stage 2?" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason (optional)"), {
      target: { value: "ready" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Raise to stage 2" }));

    await waitFor(() => expect(h.setStage).toHaveBeenCalledWith({ stage: 2, reason: "ready" }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Delegation is now stage 2."));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not offer to raise past what is unlocked, and says why", () => {
    h.delegation.mockReturnValue(ok(delegation({ stage: 2, unlocked: 2 })));
    render(<DelegationPanel />);

    expect(screen.getByRole("button", { name: "Raise to stage 3…" })).toBeDisabled();
    expect(screen.getByTestId("delegation-locked")).toHaveTextContent(
      "Stage 3 is locked until every requirement for it is met.",
    );
  });

  it("lowers to any earlier stage, with a danger-framed confirmation", async () => {
    h.delegation.mockReturnValue(ok(delegation({ stage: 3, unlocked: 3 })));
    render(<DelegationPanel />);

    expect(screen.getByRole("button", { name: "Lower to stage 1…" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lower to stage 2…" }));
    expect(screen.getByRole("dialog", { name: "Lower to stage 2?" })).toHaveTextContent(
      "Takes effect at once.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Lower to stage 2" }));

    await waitFor(() => expect(h.setStage).toHaveBeenCalledWith({ stage: 2, reason: "" }));
  });

  it("has nothing to raise at the top stage", () => {
    h.delegation.mockReturnValue(ok(delegation({ stage: 3, unlocked: 3 })));
    render(<DelegationPanel />);

    expect(screen.queryByRole("button", { name: /Raise to stage/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("delegation-locked")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and says so when the change is refused", async () => {
    h.setStage.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: "Stage 3 needs more evidence." } }),
    });
    render(<DelegationPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Raise to stage 2…" }));
    fireEvent.click(screen.getByRole("button", { name: "Raise to stage 2" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("is read-only without the edit grant: the figures stay, the buttons go", () => {
    h.access.current = { canEdit: false };
    render(<DelegationPanel />);

    expect(screen.getByTestId("delegation-preconditions")).toBeInTheDocument();
    expect(screen.queryByTestId("delegation-actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Raise|Lower/ })).not.toBeInTheDocument();
  });

  it("shows a loading state, and an error with a retry", () => {
    h.delegation.mockReturnValue({ isLoading: true });
    const { unmount } = render(<DelegationPanel />);
    expect(screen.queryByTestId("ally-delegation")).not.toBeInTheDocument();
    unmount();

    const refetch = vi.fn();
    h.delegation.mockReturnValue({ isLoading: false, isError: true, error: {}, refetch });
    render(<DelegationPanel />);
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
