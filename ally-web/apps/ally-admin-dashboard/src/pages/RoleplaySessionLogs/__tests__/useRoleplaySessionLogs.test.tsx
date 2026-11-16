import React from "react";

import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@api", () => ({
  useGetRoleplaySessionLogsQuery: (params: unknown) => {
    query(params);
    return { data: { data: [], total: 0 }, isLoading: false, isFetching: false, isError: false };
  },
}));

import { useRoleplaySessionLogs } from "../useRoleplaySessionLogs";

const at = (url: string) => ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
);

describe("useRoleplaySessionLogs scenario filter", () => {
  it("reads ?scenarioId= into the query and counts as an active filter", () => {
    const { result } = renderHook(() => useRoleplaySessionLogs(), {
      wrapper: at("/roleplay-session-logs?scenarioId=42"),
    });
    expect(result.current.scenarioId).toBe(42);
    expect(result.current.hasActiveFilters).toBe(true);
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ scenarioId: 42 }));
  });

  it("ignores a junk scenarioId", () => {
    const { result } = renderHook(() => useRoleplaySessionLogs(), {
      wrapper: at("/roleplay-session-logs?scenarioId=abc"),
    });
    expect(result.current.scenarioId).toBeNull();
  });
});
