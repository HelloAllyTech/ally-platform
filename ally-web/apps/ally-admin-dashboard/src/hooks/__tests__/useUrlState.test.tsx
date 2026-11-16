import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useUrlState } from "../useUrlState";

const wrapper = ({ children }: any) => (
  <MemoryRouter initialEntries={["/x?q=hi"]}>{children}</MemoryRouter>
);

describe("useUrlState", () => {
  it("reads, writes and removes empty values", () => {
    const { result } = renderHook(() => ({ s: useUrlState("q"), loc: useLocation() }), { wrapper });
    expect(result.current.s[0]).toBe("hi");
    act(() => result.current.s[1]("bye"));
    expect(result.current.loc.search).toBe("?q=bye");
    act(() => result.current.s[1](""));
    expect(result.current.loc.search).toBe("");
  });
});
