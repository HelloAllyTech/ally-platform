import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOCAL_STORAGE_KEYS } from "@constants";

import { baseQueryWithReauth } from "../baseApi";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

/**
 * ally-be restarts on every deploy. An access token that expires inside that gap gets a 401,
 * and the refresh that follows hits a server that isn't there. That used to log the admin out —
 * a good session thrown away because the API was briefly down.
 */
describe("baseQueryWithReauth — refresh during an API restart", () => {
  const api = {
    signal: new AbortController().signal,
    abort: vi.fn(),
    dispatch: vi.fn(),
    getState: vi.fn(),
    extra: undefined,
    endpoint: "getPermissions",
    type: "query" as const,
  };

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  beforeEach(() => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.ADMIN_ACCESS_TOKEN, "expired-access");
    localStorage.setItem(LOCAL_STORAGE_KEYS.ADMIN_REFRESH_TOKEN, "good-refresh");
    localStorage.setItem(LOCAL_STORAGE_KEYS.ADMIN_IS_AUTHENTICATED, "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("keeps the session when the refresh cannot reach the API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { message: "jwt expired" }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await baseQueryWithReauth("/v1/authorization/permissions", api, {});

    expect(result.error?.status).toBe("FETCH_ERROR");
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_REFRESH_TOKEN)).toBe("good-refresh");
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_IS_AUTHENTICATED)).toBe("true");
  });

  it("keeps the session when the refresh gets a 502 from the proxy", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { message: "jwt expired" }))
      .mockResolvedValueOnce(json(502, { message: "Bad Gateway" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await baseQueryWithReauth("/v1/authorization/permissions", api, {});

    expect(result.error?.status).toBe(502);
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_IS_AUTHENTICATED)).toBe("true");
  });

  it("still logs out when the refresh token itself is refused", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { message: "jwt expired" }))
      .mockResolvedValueOnce(json(401, { message: "Invalid refresh token" }));
    vi.stubGlobal("fetch", fetchMock);

    await baseQueryWithReauth("/v1/authorization/permissions", api, {});

    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_REFRESH_TOKEN)).toBeNull();
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_IS_AUTHENTICATED)).toBeNull();
  });
});
