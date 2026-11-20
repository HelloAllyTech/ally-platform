import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LandingPages } from "../LandingPages";

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), remove: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("../../../api/landingPages", () => ({
  useGetLandingPagesQuery: (...args: unknown[]) => api.list(...args),
  useCreateLandingPageMutation: () => [api.create, { isLoading: false }],
  useDeleteLandingPageMutation: () => [api.remove, { isLoading: false }],
}));
vi.mock("../../../api/userManagement", () => ({
  useGetTenantsQuery: () => ({ data: { data: [] } }),
}));
vi.mock("sonner", () => ({ toast }));

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "p1",
  tenantId: "t1",
  tenantName: "Agatsu Foundation",
  tenantCode: "agatsu",
  name: "Baat Se Baat Banegi",
  slug: "baat-se-baat-banegi",
  status: "DRAFT",
  path: "/agatsu/baat-se-baat-banegi",
  hasUnpublishedChanges: false,
  publishedAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-20T00:00:00Z",
  ...overrides,
});

const loaded = (items: unknown[], total = items.length) => ({
  data: { items, total, page: 1, limit: 20 },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});

const renderList = () =>
  render(
    <MemoryRouter initialEntries={["/landing-pages"]}>
      <Routes>
        <Route path="/landing-pages" element={<LandingPages />} />
        <Route path="/landing-pages/:id" element={<div>the editor</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("LandingPages", () => {
  beforeEach(() => {
    Object.values(api).forEach(mock => mock.mockReset());
    toast.success.mockReset();
    toast.error.mockReset();
  });

  it("invites you to make the first page when there are none", () => {
    api.list.mockReturnValue(loaded([]));
    renderList();
    expect(screen.getByText("No landing pages yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New landing page" })).toBeTruthy();
  });

  it("says nothing matches when a search finds nothing", () => {
    api.list.mockReturnValue(loaded([]));
    renderList();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("No landing pages match.")).toBeTruthy();
  });

  it("lists each page with its organization, address and status", () => {
    api.list.mockReturnValue(
      loaded([
        row(),
        row({ id: "p2", name: "Live one", status: "PUBLISHED", path: "/agatsu/live-one" }),
        row({ id: "p3", name: "Edited", status: "PUBLISHED", hasUnpublishedChanges: true }),
      ]),
    );
    renderList();
    const table = screen.getByRole("table", { name: "Landing pages" });
    expect(within(table).getByText("/agatsu/live-one")).toBeTruthy();
    expect(within(table).getAllByText("Agatsu Foundation")).toHaveLength(3);
    expect(within(table).getByText("Draft")).toBeTruthy();
    expect(within(table).getByText("Live")).toBeTruthy();
    expect(within(table).getByText("Live, unpublished changes")).toBeTruthy();
  });

  it("offers Open only for a page that is live", () => {
    api.list.mockReturnValue(loaded([row(), row({ id: "p2", status: "PUBLISHED" })]));
    renderList();
    // Scoped to the table: the create form's organization picker has an "Open" button of its own.
    const table = screen.getByRole("table", { name: "Landing pages" });
    expect(within(table).getAllByRole("button", { name: "Open" })).toHaveLength(1);
  });

  it("opens a page in the editor", () => {
    api.list.mockReturnValue(loaded([row()]));
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Baat Se Baat Banegi" }));
    expect(screen.getByText("the editor")).toBeTruthy();
  });

  it("asks for the next page of results", () => {
    api.list.mockReturnValue(loaded([row()], 45));
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /Load more \(44 more\)/ }));
    expect(api.list).toHaveBeenLastCalledWith({
      search: undefined,
      status: undefined,
      page: 1,
      limit: 40,
    });
  });

  it("filters by status", () => {
    api.list.mockReturnValue(loaded([row()]));
    renderList();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "PUBLISHED" } });
    expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "PUBLISHED" }));
  });

  it("says when the list cannot be loaded, and offers to try again", () => {
    const refetch = vi.fn();
    api.list.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderList();
    expect(screen.getByText(/Couldn't load the landing pages\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  describe("deleting", () => {
    it("asks first, naming the page and its address, and deletes only when confirmed", async () => {
      api.list.mockReturnValue(loaded([row({ status: "PUBLISHED" })]));
      api.remove.mockReturnValue({ unwrap: () => Promise.resolve() });
      renderList();
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      const dialog = document.querySelector(".cds--modal.is-visible") as HTMLElement;
      expect(within(dialog).getByText("Baat Se Baat Banegi")).toBeTruthy();
      expect(within(dialog).getByText(/anyone with the link will see an error/)).toBeTruthy();
      expect(api.remove).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete page" }));
      await waitFor(() => expect(api.remove).toHaveBeenCalledWith("p1"));
      expect(toast.success).toHaveBeenCalledWith("Deleted");
    });

    it("leaves the page alone when cancelled", () => {
      api.list.mockReturnValue(loaded([row()]));
      renderList();
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      const dialog = document.querySelector(".cds--modal.is-visible") as HTMLElement;
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(api.remove).not.toHaveBeenCalled();
    });

    it("tells you when the delete fails", async () => {
      api.list.mockReturnValue(loaded([row()]));
      api.remove.mockReturnValue({
        unwrap: () => Promise.reject({ data: { message: "Not allowed" } }),
      });
      renderList();
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      const dialog = document.querySelector(".cds--modal.is-visible") as HTMLElement;
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete page" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Not allowed"));
    });
  });

  it("opens the create form from the New landing page button", () => {
    api.list.mockReturnValue(loaded([]));
    renderList();
    expect(document.querySelector(".cds--modal.is-visible")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New landing page" }));
    expect(document.querySelector(".cds--modal.is-visible")).not.toBeNull();
  });
});
