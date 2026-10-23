import { describe, expect, it } from "vitest";

import { AllyGuideThreadRow } from "@types";

import {
  EMPTY_THREAD_FILTERS,
  hasActiveThreadFilters,
  matchesThreadFilters,
  serverQueryFor,
  serverQueryKey,
} from "../conversationFilters";

const row = (overrides: Partial<AllyGuideThreadRow> = {}): AllyGuideThreadRow => ({
  id: "11111111-aaaa-bbbb-cccc-000000000001",
  trackId: "track-1",
  trackTitle: "New Counselor Foundations",
  tenantId: "tenant-a",
  mode: "NORMAL",
  status: "active",
  epoch: 1,
  updatedAt: "2026-10-23T10:00:00.000Z",
  turns: 4,
  costUsd: 0.12,
  crises: 0,
  ...overrides,
});

const NAMES = { "tenant-a": "Acme Counselling", "tenant-b": "Brightside" };

describe("serverQueryFor", () => {
  it("sends nothing when no filter is chosen", () => {
    expect(serverQueryFor(EMPTY_THREAD_FILTERS)).toEqual({ tenantId: undefined, mode: undefined });
  });

  it("sends a facet to the server only when exactly one value is chosen", () => {
    expect(serverQueryFor({ tenantIds: ["tenant-a"], modes: ["CRISIS"] })).toEqual({
      tenantId: "tenant-a",
      mode: "CRISIS",
    });
    // The server takes ONE tenantId and ONE mode, so several are left for the client to apply.
    expect(
      serverQueryFor({ tenantIds: ["tenant-a", "tenant-b"], modes: ["CARE", "CRISIS"] }),
    ).toEqual({
      tenantId: undefined,
      mode: undefined,
    });
  });

  it("keys a reload on the server-side query alone", () => {
    const one = { tenantIds: ["tenant-a"], modes: [] };
    const two = { tenantIds: ["tenant-a", "tenant-b"], modes: [] };
    expect(serverQueryKey(one)).not.toBe(serverQueryKey(EMPTY_THREAD_FILTERS));
    // Going from two chosen to none changes nothing the server sees, so it must not refetch.
    expect(serverQueryKey(two)).toBe(serverQueryKey(EMPTY_THREAD_FILTERS));
  });
});

describe("matchesThreadFilters", () => {
  it("passes everything when nothing is filtered or searched", () => {
    expect(matchesThreadFilters(row(), EMPTY_THREAD_FILTERS, "", NAMES)).toBe(true);
  });

  it("filters by organisation, with several allowed", () => {
    const filters = { tenantIds: ["tenant-a", "tenant-b"], modes: [] };

    expect(matchesThreadFilters(row({ tenantId: "tenant-b" }), filters, "", NAMES)).toBe(true);
    expect(matchesThreadFilters(row({ tenantId: "tenant-c" }), filters, "", NAMES)).toBe(false);
    // A conversation with no organisation is not in any chosen organisation.
    expect(matchesThreadFilters(row({ tenantId: null }), filters, "", NAMES)).toBe(false);
  });

  it("filters by mode, with several allowed", () => {
    const filters = { tenantIds: [], modes: ["CARE", "CRISIS"] as AllyGuideThreadRow["mode"][] };

    expect(matchesThreadFilters(row({ mode: "CARE" }), filters, "", NAMES)).toBe(true);
    expect(matchesThreadFilters(row({ mode: "NORMAL" }), filters, "", NAMES)).toBe(false);
  });

  it("requires every filter to hold at once", () => {
    const filters = { tenantIds: ["tenant-a"], modes: ["CRISIS" as const] };

    expect(
      matchesThreadFilters(row({ tenantId: "tenant-a", mode: "CRISIS" }), filters, "", NAMES),
    ).toBe(true);
    expect(
      matchesThreadFilters(row({ tenantId: "tenant-a", mode: "NORMAL" }), filters, "", NAMES),
    ).toBe(false);
    expect(
      matchesThreadFilters(row({ tenantId: "tenant-b", mode: "CRISIS" }), filters, "", NAMES),
    ).toBe(false);
  });

  it("searches the course title, the organisation's name and the id, ignoring case", () => {
    expect(matchesThreadFilters(row(), EMPTY_THREAD_FILTERS, "FOUNDATIONS", NAMES)).toBe(true);
    expect(matchesThreadFilters(row(), EMPTY_THREAD_FILTERS, "acme", NAMES)).toBe(true);
    expect(matchesThreadFilters(row(), EMPTY_THREAD_FILTERS, "aaaa-bbbb", NAMES)).toBe(true);
    expect(matchesThreadFilters(row(), EMPTY_THREAD_FILTERS, "nothing like it", NAMES)).toBe(false);
  });

  it("survives a conversation whose course has no title", () => {
    expect(
      matchesThreadFilters(row({ trackTitle: null }), EMPTY_THREAD_FILTERS, "foundations", NAMES),
    ).toBe(false);
    expect(matchesThreadFilters(row({ trackTitle: null }), EMPTY_THREAD_FILTERS, "", NAMES)).toBe(
      true,
    );
  });
});

describe("hasActiveThreadFilters", () => {
  it("is true for a facet or for a search, false otherwise", () => {
    expect(hasActiveThreadFilters(EMPTY_THREAD_FILTERS, "")).toBe(false);
    expect(hasActiveThreadFilters(EMPTY_THREAD_FILTERS, "   ")).toBe(false);
    expect(hasActiveThreadFilters(EMPTY_THREAD_FILTERS, "x")).toBe(true);
    expect(hasActiveThreadFilters({ tenantIds: ["a"], modes: [] }, "")).toBe(true);
    expect(hasActiveThreadFilters({ tenantIds: [], modes: ["CARE"] }, "")).toBe(true);
  });
});
