import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work, and a mock registered after
// another import that pulls it in arrives too late.
import "@constants";

const h = vi.hoisted(() => ({
  fetchPage: vi.fn(),
  tenants: vi.fn(),
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useLazyGetAllyGuideThreadsQuery: () => [h.fetchPage],
  useGetTenantsQuery: () => h.tenants(),
}));
// The inspector has its own suite; here it only needs to show what it was opened with.
vi.mock("../TurnInspector", () => ({
  TurnInspector: ({ threadId, thread, onClose }: any) =>
    threadId ? (
      <div data-testid="inspector">
        <span data-testid="inspector-id">{threadId}</span>
        <span data-testid="inspector-title">{thread?.trackTitle ?? ""}</span>
        <button type="button" onClick={onClose}>
          close inspector
        </button>
      </div>
    ) : null,
}));

// eslint-disable-next-line import/first
import { ConversationsTab } from "../ConversationsTab";

const row = (index: number, overrides: Record<string, unknown> = {}) => ({
  id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
  trackId: `track-${index}`,
  trackTitle: `Course ${index}`,
  tenantId: "tenant-a",
  mode: "NORMAL",
  status: "active",
  epoch: 1,
  updatedAt: new Date(Date.UTC(2026, 9, 23, 10, 0, 0) - index * 60_000).toISOString(),
  turns: index + 1,
  costUsd: 0.5,
  crises: 0,
  ...overrides,
});

const page = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => row(from + i));

/** What a lazy RTK trigger returns: a thenable with `.unwrap()`. */
const reply = (rows: unknown[]) => ({ unwrap: () => Promise.resolve(rows) });
const fail = (error: unknown) => ({ unwrap: () => Promise.reject(error) });

const Where = () => <span data-testid="where">{useLocation().search}</span>;

const renderTab = (initial = "/ally?tab=conversations") =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <ConversationsTab />
      <Where />
    </MemoryRouter>,
  );

describe("ConversationsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.tenants.mockReturnValue({
      data: {
        data: [
          { id: "tenant-a", name: "Acme Counselling" },
          { id: "tenant-b", name: "Brightside" },
        ],
      },
    });
    h.fetchPage.mockImplementation(() =>
      reply([row(1), row(2, { mode: "CRISIS", crises: 2, tenantId: "tenant-b" })]),
    );
  });

  describe("the list", () => {
    it("loads the first page without filters and shows what a conversation row should", async () => {
      renderTab();

      const rows = await screen.findAllByTestId("thread-row");
      expect(h.fetchPage).toHaveBeenCalledWith({ limit: 25 }, false);
      expect(rows).toHaveLength(2);
      expect(within(rows[0]).getByText("Course 1")).toBeInTheDocument();
      expect(within(rows[0]).getByText("Acme Counselling")).toBeInTheDocument();
      expect(within(rows[0]).getByText("Normal")).toBeInTheDocument();
      expect(within(rows[0]).getByText("Active")).toBeInTheDocument();
      expect(within(rows[1]).getByText("Brightside")).toBeInTheDocument();
      // Mode and crisis count read as words/numbers, not only colour.
      expect(within(rows[1]).getByText("Crisis")).toBeInTheDocument();
      expect(within(rows[1]).getByText("2")).toBeInTheDocument();
    });

    it("never shows conversation content: the list is metadata only", async () => {
      renderTab();

      const table = await screen.findByTestId("ally-threads-table");
      expect(table).not.toHaveTextContent(/transcript|message text/i);
    });

    it("shows a skeleton until the first page arrives", async () => {
      h.fetchPage.mockReturnValue({ unwrap: () => new Promise(() => undefined) });
      renderTab();

      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
      expect(screen.queryByTestId("thread-row")).not.toBeInTheDocument();
    });

    it("says there are no conversations yet, and means it", async () => {
      h.fetchPage.mockReturnValue(reply([]));
      renderTab();

      expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
    });

    it("tells a failed load from an empty list and retries from the top", async () => {
      h.fetchPage.mockReturnValueOnce(fail({ status: 500 })).mockReturnValue(reply([row(1)]));
      renderTab();

      expect(await screen.findByTestId("ally-load-failed")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(await screen.findAllByTestId("thread-row")).toHaveLength(1);
    });

    it("tells a missing permission from a failure", async () => {
      h.fetchPage.mockReturnValue(fail({ status: 403 }));
      renderTab();

      expect(await screen.findByTestId("ally-forbidden")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    });

    it("falls back to a short id for an organisation it has no name for, and says when there is none", async () => {
      h.tenants.mockReturnValue({ data: { data: [] } });
      h.fetchPage.mockReturnValue(
        reply([
          row(1, { tenantId: "9f8e7d6c-1111-2222-3333-444455556666" }),
          row(2, { tenantId: null }),
        ]),
      );
      renderTab();

      const rows = await screen.findAllByTestId("thread-row");
      expect(within(rows[0]).getByText("9f8e7d6c")).toBeInTheDocument();
      expect(within(rows[1]).getByText("No organisation")).toBeInTheDocument();
    });
  });

  describe("paging", () => {
    it("loads more with the last row's updatedAt as the cursor and appends", async () => {
      const first = page(1, 25);
      h.fetchPage.mockReturnValueOnce(reply(first)).mockReturnValueOnce(reply(page(26, 3)));
      renderTab();
      expect(await screen.findAllByTestId("thread-row")).toHaveLength(25);

      fireEvent.click(screen.getByRole("button", { name: "Load more" }));

      await waitFor(() => expect(screen.getAllByTestId("thread-row")).toHaveLength(28));
      expect(h.fetchPage).toHaveBeenLastCalledWith(
        { limit: 25, before: first[24].updatedAt },
        false,
      );
    });

    it("says that is every conversation once a page comes back short", async () => {
      renderTab();

      await screen.findAllByTestId("thread-row");

      expect(screen.getByText("That is every conversation.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    it("does not list a conversation twice when pages overlap on a shared timestamp", async () => {
      const first = page(1, 25);
      h.fetchPage
        .mockReturnValueOnce(reply(first))
        .mockReturnValueOnce(reply([first[24], row(30)]));
      renderTab();
      await screen.findAllByTestId("thread-row");

      fireEvent.click(screen.getByRole("button", { name: "Load more" }));

      await waitFor(() => expect(screen.getAllByTestId("thread-row")).toHaveLength(26));
    });

    it("reports the count it is showing", async () => {
      renderTab();

      expect(await screen.findByTestId("threads-footer")).toHaveTextContent(
        "Showing 2 conversations",
      );
    });
  });

  describe("search and filters", () => {
    it("searches what the rows show, without another request", async () => {
      renderTab();
      await screen.findAllByTestId("thread-row");
      const calls = h.fetchPage.mock.calls.length;

      fireEvent.change(screen.getByPlaceholderText("Search by course or conversation id…"), {
        target: { value: "course 2" },
      });

      expect(screen.getAllByTestId("thread-row")).toHaveLength(1);
      expect(screen.getByText("Course 2")).toBeInTheDocument();
      expect(h.fetchPage.mock.calls.length).toBe(calls);
    });

    it("says nothing matches, and that clearing the filters would help, instead of a bare table", async () => {
      renderTab();
      await screen.findAllByTestId("thread-row");

      fireEvent.change(screen.getByPlaceholderText("Search by course or conversation id…"), {
        target: { value: "no such course" },
      });

      expect(screen.getByText("No conversations match")).toBeInTheDocument();
      expect(screen.queryByText("No conversations yet")).not.toBeInTheDocument();
    });

    it("sends a single chosen mode to the server and reloads from the top", async () => {
      renderTab();
      await screen.findAllByTestId("thread-row");

      fireEvent.click(screen.getByRole("button", { name: /^Filter$/ }));
      fireEvent.click(screen.getByRole("button", { name: /^Mode/ }));
      fireEvent.click(screen.getByLabelText("Crisis"));
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      await waitFor(() =>
        expect(h.fetchPage).toHaveBeenLastCalledWith({ limit: 25, mode: "CRISIS" }, false),
      );
      // The chosen filter is visible as a chip, named in words.
      expect(await screen.findByText("Mode:")).toBeInTheDocument();
    });

    it("keeps an organisation's name exactly as written on its chip", async () => {
      h.tenants.mockReturnValue({
        data: {
          data: [
            { id: "tenant-a", name: "NIMHANS Bengaluru" },
            { id: "tenant-b", name: "Brightside" },
          ],
        },
      });
      renderTab();
      await screen.findAllByTestId("thread-row");

      fireEvent.click(screen.getByRole("button", { name: /^Filter$/ }));
      fireEvent.click(screen.getByRole("button", { name: /^Organisation/ }));
      fireEvent.click(screen.getByLabelText("NIMHANS Bengaluru"));
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      await waitFor(() =>
        expect(h.fetchPage).toHaveBeenLastCalledWith({ limit: 25, tenantId: "tenant-a" }, false),
      );
      // The toolbar's own chips would lower-case this to "Nimhans bengaluru".
      expect((await screen.findAllByText("NIMHANS Bengaluru")).length).toBeGreaterThan(0);
      expect(screen.queryByText("Nimhans bengaluru")).not.toBeInTheDocument();
    });
  });

  describe("the Turn Inspector", () => {
    it("opens from a row, in the address, and closes back out of it", async () => {
      renderTab();
      const rows = await screen.findAllByTestId("thread-row");

      fireEvent.click(within(rows[0]).getByRole("button", { name: "Open conversation: Course 1" }));

      expect(screen.getByTestId("inspector-id")).toHaveTextContent(row(1).id);
      expect(screen.getByTestId("inspector-title")).toHaveTextContent("Course 1");
      expect(screen.getByTestId("where")).toHaveTextContent(
        `tab=conversations&thread=${row(1).id}`,
      );

      fireEvent.click(screen.getByRole("button", { name: "close inspector" }));

      expect(screen.queryByTestId("inspector")).not.toBeInTheDocument();
      expect(screen.getByTestId("where")).toHaveTextContent("?tab=conversations");
      expect(screen.getByTestId("where")).not.toHaveTextContent("thread=");
    });

    it("opens from anywhere on the row too, but the title is a real button so the keyboard can", async () => {
      renderTab();
      const rows = await screen.findAllByTestId("thread-row");

      fireEvent.click(rows[1]);

      expect(screen.getByTestId("inspector-id")).toHaveTextContent(row(2).id);
    });

    it("opens a linked conversation by id before the list has loaded its row", async () => {
      renderTab(`/ally?tab=conversations&thread=${row(9).id}`);

      expect(screen.getByTestId("inspector-id")).toHaveTextContent(row(9).id);
      expect(screen.getByTestId("inspector-title")).toHaveTextContent("");
      await screen.findAllByTestId("thread-row");
    });
  });
});
