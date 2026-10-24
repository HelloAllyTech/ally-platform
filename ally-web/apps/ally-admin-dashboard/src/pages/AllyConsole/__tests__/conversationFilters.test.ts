import { describe, expect, it } from "vitest";

import { AllyGuideThreadRow } from "@types";

import {
  EMPTY_THREAD_FILTERS,
  hasActiveThreadFilters,
  matchesThreadFilters,
  organisationOptions,
  serverQueryFor,
  serverQueryKey,
} from "../conversationFilters";

const row = (overrides: Partial<AllyGuideThreadRow> = {}): AllyGuideThreadRow => ({
  id: "11111111-aaaa-bbbb-cccc-000000000001",
  trackId: "track-1",
  trackTitle: "New Counselor Foundations",
  tenantId: "tenant-a",
  tenantName: "Acme Counselling",
  visitor: false,
  mode: "NORMAL",
  status: "active",
  epoch: 1,
  arm: null,
  updatedAt: "2026-10-23T10:00:00.000Z",
  cursor: "2026-10-23T10:00:00.000000|11111111-aaaa-bbbb-cccc-000000000001",
  turns: 4,
  costUsd: 0.12,
  crises: 0,
  ...overrides,
});

describe("serverQueryFor", () => {
  it("sends nothing when no filter is chosen", () => {
    expect(serverQueryFor(EMPTY_THREAD_FILTERS)).toEqual({
      tenantId: undefined,
      mode: undefined,
      status: undefined,
    });
  });

  it("sends a facet to the server only when exactly one value is chosen", () => {
    expect(
      serverQueryFor({ tenantIds: ["tenant-a"], modes: ["CRISIS"], statuses: ["archived"] }),
    ).toEqual({ tenantId: "tenant-a", mode: "CRISIS", status: "archived" });
    // The server takes ONE tenantId, ONE mode and ONE status, so several are left for the client to apply.
    expect(
      serverQueryFor({
        tenantIds: ["tenant-a", "tenant-b"],
        modes: ["CARE", "CRISIS"],
        statuses: ["active", "merged"],
      }),
    ).toEqual({ tenantId: undefined, mode: undefined, status: undefined });
  });

  it("keys a reload on the server-side query alone", () => {
    const one = { ...EMPTY_THREAD_FILTERS, tenantIds: ["tenant-a"] };
    const two = { ...EMPTY_THREAD_FILTERS, tenantIds: ["tenant-a", "tenant-b"] };
    expect(serverQueryKey(one)).not.toBe(serverQueryKey(EMPTY_THREAD_FILTERS));
    // Going from two chosen to none changes nothing the server sees, so it must not refetch.
    expect(serverQueryKey(two)).toBe(serverQueryKey(EMPTY_THREAD_FILTERS));
  });

  it("reloads when only the status changes", () => {
    const archived = { ...EMPTY_THREAD_FILTERS, statuses: ["archived" as const] };

    expect(serverQueryKey(archived)).not.toBe(serverQueryKey(EMPTY_THREAD_FILTERS));
  });
});

describe("matchesThreadFilters", () => {
  it("passes everything when nothing is filtered or searched", () => {
    expect(matchesThreadFilters(row(), EMPTY_THREAD_FILTERS, "")).toBe(true);
  });

  it("filters by organisation, with several allowed", () => {
    const filters = { ...EMPTY_THREAD_FILTERS, tenantIds: ["tenant-a", "tenant-b"] };

    expect(matchesThreadFilters(row({ tenantId: "tenant-b" }), filters, "")).toBe(true);
    expect(matchesThreadFilters(row({ tenantId: "tenant-c" }), filters, "")).toBe(false);
    // A conversation with no organisation is not in any chosen organisation.
    expect(matchesThreadFilters(row({ tenantId: null }), filters, "")).toBe(false);
  });

  it("filters by mode, with several allowed", () => {
    const filters = {
      ...EMPTY_THREAD_FILTERS,
      modes: ["CARE", "CRISIS"] as AllyGuideThreadRow["mode"][],
    };

    expect(matchesThreadFilters(row({ mode: "CARE" }), filters, "")).toBe(true);
    expect(matchesThreadFilters(row({ mode: "NORMAL" }), filters, "")).toBe(false);
  });

  it("filters by status, with several allowed", () => {
    const filters = {
      ...EMPTY_THREAD_FILTERS,
      statuses: ["active", "completed"] as AllyGuideThreadRow["status"][],
    };

    expect(matchesThreadFilters(row({ status: "completed" }), filters, "")).toBe(true);
    expect(matchesThreadFilters(row({ status: "archived" }), filters, "")).toBe(false);
  });

  it("requires every filter to hold at once", () => {
    const filters = { tenantIds: ["tenant-a"], modes: ["CRISIS" as const], statuses: [] };

    expect(matchesThreadFilters(row({ tenantId: "tenant-a", mode: "CRISIS" }), filters, "")).toBe(
      true,
    );
    expect(matchesThreadFilters(row({ tenantId: "tenant-a", mode: "NORMAL" }), filters, "")).toBe(
      false,
    );
    expect(matchesThreadFilters(row({ tenantId: "tenant-b", mode: "CRISIS" }), filters, "")).toBe(
      false,
    );
  });

  it("searches the course title, the organisation's name from the row, and the id, ignoring case", () => {
    expect(matchesThreadFilters(row(), EMPTY_THREAD_FILTERS, "FOUNDATIONS")).toBe(true);
    expect(matchesThreadFilters(row(), EMPTY_THREAD_FILTERS, "acme")).toBe(true);
    expect(matchesThreadFilters(row(), EMPTY_THREAD_FILTERS, "aaaa-bbbb")).toBe(true);
    expect(matchesThreadFilters(row(), EMPTY_THREAD_FILTERS, "nothing like it")).toBe(false);
  });

  it("survives a conversation whose course or organisation has no name", () => {
    expect(
      matchesThreadFilters(row({ trackTitle: null }), EMPTY_THREAD_FILTERS, "foundations"),
    ).toBe(false);
    expect(matchesThreadFilters(row({ trackTitle: null }), EMPTY_THREAD_FILTERS, "")).toBe(true);
    expect(matchesThreadFilters(row({ tenantName: null }), EMPTY_THREAD_FILTERS, "acme")).toBe(
      false,
    );
  });
});

describe("hasActiveThreadFilters", () => {
  it("is true for a facet or for a search, false otherwise", () => {
    expect(hasActiveThreadFilters(EMPTY_THREAD_FILTERS, "")).toBe(false);
    expect(hasActiveThreadFilters(EMPTY_THREAD_FILTERS, "   ")).toBe(false);
    expect(hasActiveThreadFilters(EMPTY_THREAD_FILTERS, "x")).toBe(true);
    expect(hasActiveThreadFilters({ ...EMPTY_THREAD_FILTERS, tenantIds: ["a"] }, "")).toBe(true);
    expect(hasActiveThreadFilters({ ...EMPTY_THREAD_FILTERS, modes: ["CARE"] }, "")).toBe(true);
    expect(hasActiveThreadFilters({ ...EMPTY_THREAD_FILTERS, statuses: ["merged"] }, "")).toBe(
      true,
    );
  });
});

describe("organisationOptions", () => {
  it("offers the listed organisations, sorted by name", () => {
    expect(
      organisationOptions(
        [
          { id: "b", name: "Brightside" },
          { id: "a", name: "Acme" },
        ],
        [],
      ),
    ).toEqual([
      { value: "a", label: "Acme" },
      { value: "b", label: "Brightside" },
    ]);
  });

  it("adds an organisation seen on a loaded row that the list did not hold, with its server name", () => {
    const options = organisationOptions(
      [{ id: "a", name: "Acme" }],
      [row({ tenantId: "z", tenantName: "Zenith Trust" })],
    );

    expect(options).toContainEqual({ value: "z", label: "Zenith Trust" });
  });

  it("works from the rows alone when the organisation list could not be read", () => {
    const options = organisationOptions(
      [],
      [row({ tenantId: "a", tenantName: "Acme" }), row({ tenantId: "a", tenantName: "Acme" })],
    );

    expect(options).toEqual([{ value: "a", label: "Acme" }]);
  });

  it("keeps the list's name when a row names the same organisation, and skips rows with none", () => {
    const options = organisationOptions(
      [{ id: "a", name: "Acme (list)" }],
      [row({ tenantId: "a", tenantName: "Acme (row)" }), row({ tenantId: null, tenantName: null })],
    );

    expect(options).toEqual([{ value: "a", label: "Acme (list)" }]);
  });

  it("falls back to a short id for an organisation with no name anywhere", () => {
    const options = organisationOptions(
      [],
      [row({ tenantId: "9f8e7d6c-1111-2222-3333-444455556666", tenantName: null })],
    );

    expect(options[0].label).toBe("9f8e7d6c");
  });
});
