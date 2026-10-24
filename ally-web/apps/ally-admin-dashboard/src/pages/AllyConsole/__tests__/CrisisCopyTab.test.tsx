import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work, and a mock registered after
// another import that pulls it in arrives too late.
import "@constants";

const h = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  access: { current: { canEdit: true } as Record<string, boolean> },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideCrisisResponsesQuery: () => h.list(),
  useSaveAllyGuideCrisisResponseMutation: () => [h.save],
  useDeleteAllyGuideCrisisResponseMutation: () => [h.remove],
}));

// eslint-disable-next-line import/first
import { CrisisCopyTab } from "../CrisisCopyTab";

const MESSAGE =
  "I'm really glad you told me. You deserve to talk to a person right now. Please call.";
const ROWS = [
  {
    id: "copy-en",
    scope: "platform",
    tenantId: null,
    languageCode: "en",
    body: MESSAGE,
    version: 2,
    active: true,
    approvedBy: 9,
    approvedAt: "2026-10-20T09:30:00.000Z",
  },
];

const loaded = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
  ...extra,
});

const renderTab = () =>
  render(
    <Provider store={configureStore({ reducer: { user: () => ({ user: { id: 1 } }) } })}>
      <CrisisCopyTab />
    </Provider>,
  );

describe("CrisisCopyTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canEdit: true };
    h.list.mockReturnValue(loaded(ROWS));
    h.save.mockReturnValue({ unwrap: () => Promise.resolve({ version: 3 }) });
    h.remove.mockReturnValue({ unwrap: () => Promise.resolve({ id: "copy-en", active: false }) });
  });

  it("explains what the copy is, who writes it and how it falls back", () => {
    renderTab();

    const intro = screen.getByText(/No model writes it/);
    expect(intro).toHaveTextContent("Each save is a new version, the previous one is kept");
    expect(intro).toHaveTextContent("falls back to English, then to the built-in default");
  });

  it("saves a language through the platform route as { languageCode, body }, after sign-off", async () => {
    renderTab();
    const english = screen.getByTestId("crisis-copy-en");

    fireEvent.change(within(english).getByRole("textbox"), {
      target: { value: `${MESSAGE} Take your time.` },
    });
    fireEvent.click(within(english).getByRole("button", { name: "Save new version…" }));
    fireEvent.click(screen.getByLabelText("A clinician has approved this exact text"));
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));

    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        languageCode: "en",
        body: `${MESSAGE} Take your time.`,
      }),
    );
  });

  it("withdraws a version by its id", async () => {
    renderTab();

    fireEvent.click(
      within(screen.getByTestId("crisis-copy-en")).getByRole("button", { name: "Withdraw…" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));

    await waitFor(() => expect(h.remove).toHaveBeenCalledWith("copy-en"));
  });

  it("is read-only without the edit grant, with a note saying why", () => {
    h.access.current = { canEdit: false };
    renderTab();

    expect(screen.getByText(/View only/)).toBeInTheDocument();
    expect(screen.getAllByRole("textbox").every(box => (box as HTMLTextAreaElement).disabled)).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Save new version…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw…" })).not.toBeInTheDocument();
  });

  describe("states", () => {
    it("shows a skeleton while loading", () => {
      h.list.mockReturnValue(loaded(undefined, { isLoading: true }));
      renderTab();

      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
    });

    it("tells a failed load from 'no copy', and retries", () => {
      const refetch = vi.fn();
      h.list.mockReturnValue(loaded(undefined, { isError: true, error: { status: 500 }, refetch }));
      renderTab();

      expect(screen.getByTestId("ally-load-failed")).toBeInTheDocument();
      expect(screen.queryByTestId("crisis-copy-en")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalled();
    });

    it("tells a missing permission from a failure", () => {
      h.list.mockReturnValue(loaded(undefined, { isError: true, error: { status: 403 } }));
      renderTab();

      expect(screen.getByTestId("ally-forbidden")).toBeInTheDocument();
    });

    it("shows every language as empty, writable, when nothing has been saved yet", () => {
      h.list.mockReturnValue(loaded([]));
      renderTab();

      expect(screen.getAllByTestId(/^crisis-copy-[a-z]{2}$/)).toHaveLength(5);
      expect(screen.getByTestId("crisis-copy-en-meta")).toHaveTextContent("No copy saved");
    });
  });
});
