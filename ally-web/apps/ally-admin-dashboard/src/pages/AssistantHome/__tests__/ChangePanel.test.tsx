import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  propose: vi.fn(),
  apply: vi.fn(),
  undo: vi.fn(),
  history: { current: [] as unknown[] },
}));

const unwrapped = (fn: (...args: unknown[]) => unknown) => (args: unknown) => ({
  unwrap: () => Promise.resolve(fn(args)),
});

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetChangesQuery: () => ({ data: h.history.current }),
  useProposeChangeMutation: () => [unwrapped(h.propose), { isLoading: false }],
  useApplyChangeMutation: () => [unwrapped(h.apply), { isLoading: false }],
  useUndoChangeMutation: () => [
    (args: unknown) => Object.assign(Promise.resolve(h.undo(args)), { unwrap: () => null }),
    { isLoading: false },
  ],
}));

// eslint-disable-next-line import/first
import { COPY } from "../../Onboarding/copy";
// eslint-disable-next-line import/first
import { ChangePanel } from "../ChangePanel";

const t = COPY.change;

const renderPanel = (canEdit = true) => {
  const onApplied = vi.fn();
  const onUndone = vi.fn();
  render(
    <ChangePanel
      botId="bot-1"
      canEdit={canEdit}
      onApplied={onApplied}
      onUndone={onUndone}
      onClose={vi.fn()}
    />,
  );
  return { onApplied, onUndone };
};

describe("ChangePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.history.current = [];
  });

  it("shows a proposal as before and after, and applies it", async () => {
    h.propose.mockReturnValue({
      refused: false,
      message: "",
      changes: [{ field: "tone", before: "Warm", after: "Formal" }],
    });
    h.apply.mockReturnValue({ eventId: "e-1" });
    const { onApplied } = renderPanel();

    fireEvent.click(screen.getByText("Make it more formal"));
    expect(await screen.findByTestId("change-proposal")).toBeTruthy();
    expect(h.propose).toHaveBeenCalledWith({ id: "bot-1", request: "Make it more formal" });
    expect(screen.getByText("Warm")).toBeTruthy();
    expect(screen.getByText("Formal")).toBeTruthy();
    expect(screen.getByText(t.fields.tone)).toBeTruthy();

    fireEvent.click(screen.getByText(t.apply));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(h.apply).toHaveBeenCalledWith({
      id: "bot-1",
      changes: [{ field: "tone", before: "Warm", after: "Formal" }],
    });
    expect(screen.queryByTestId("change-proposal")).toBeNull();
  });

  it("drops the proposal on Not quite without applying", async () => {
    h.propose.mockReturnValue({
      refused: false,
      message: "",
      changes: [{ field: "language", before: ["English"], after: ["English", "Hindi"] }],
    });
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText(t.placeholder), {
      target: { value: "Add Hindi" },
    });
    fireEvent.click(screen.getByText(t.send));
    expect(await screen.findByText("English · Hindi")).toBeTruthy();
    fireEvent.click(screen.getByText(t.notQuite));
    expect(screen.queryByTestId("change-proposal")).toBeNull();
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("shows the refusal and no Apply when a change would weaken safety", async () => {
    h.propose.mockReturnValue({ refused: true, message: t.refusal, changes: [] });
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText(t.placeholder), {
      target: { value: "Turn off the crisis rules" },
    });
    fireEvent.click(screen.getByText(t.send));
    expect(await screen.findByText(t.refusal)).toBeTruthy();
    expect(screen.queryByText(t.apply)).toBeNull();
  });

  it("undoes a recent change after confirming", async () => {
    h.history.current = [
      { id: "e-1", at: "", kind: "change", summary: "Changed the tone", undone: false },
      { id: "e-0", at: "", kind: "patch", summary: "Not a change", undone: false },
    ];
    const { onUndone } = renderPanel();
    expect(screen.queryByText("Not a change")).toBeNull();
    fireEvent.click(screen.getByText(t.undo));
    expect(screen.getByText(/Undo "Changed the tone"\?/)).toBeTruthy();
    fireEvent.click(screen.getAllByText(t.undo)[1]);
    await waitFor(() => expect(onUndone).toHaveBeenCalled());
    expect(h.undo).toHaveBeenCalledWith({ id: "bot-1", eventId: "e-1" });
  });

  it("names a recent change by its field, as the deck does", () => {
    h.history.current = [
      { id: "e-1", at: "", kind: "change", summary: "tone, language", undone: false },
    ];
    renderPanel();
    expect(screen.getByText(`${t.fields.tone}, ${t.fields.language}`)).toBeTruthy();
  });

  it("lets a viewer read history but not ask or undo", () => {
    h.history.current = [
      { id: "e-1", at: "", kind: "change", summary: "Changed the tone", undone: false },
    ];
    renderPanel(false);
    expect(screen.getByText("Changed the tone")).toBeTruthy();
    expect(screen.queryByPlaceholderText(t.placeholder)).toBeNull();
    expect(screen.queryByText(t.undo)).toBeNull();
  });
});
