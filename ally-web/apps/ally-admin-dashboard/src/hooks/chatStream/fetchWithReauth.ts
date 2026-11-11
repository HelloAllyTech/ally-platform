import { ApiEndpoints, HttpMethod, LOCAL_STORAGE_KEYS } from "@constants";
import { RefreshResponse } from "@types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

/**
 * A streaming request with the admin's bearer and one refresh-and-retry on a 401: RTK Query can't
 * read an SSE body, so the admin streams (Preview, onboarding) fetch directly. A GET has no body.
 */
export const fetchWithReauth = async (
  url: string,
  body: unknown,
  signal: AbortSignal,
  method: string = HttpMethod.POST,
): Promise<Response> => {
  const request = (token: string | null) =>
    fetch(url, {
      method,
      headers: {
        ...(method === HttpMethod.GET ? {} : { "Content-Type": "application/json" }),
        Accept: "text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(method === HttpMethod.GET ? {} : { body: JSON.stringify(body) }),
      signal,
    });

  const response = await request(localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_ACCESS_TOKEN));
  if (response.status !== 401) return response;
  const refreshToken = localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_REFRESH_TOKEN);
  if (!refreshToken) return response;
  const refreshed = await fetch(`${API_BASE_URL}/api${ApiEndpoints.AUTH.REFRESH}`, {
    method: HttpMethod.POST,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    signal,
  });
  if (!refreshed.ok) return response;
  const tokens = (await refreshed.json()) as RefreshResponse;
  localStorage.setItem(LOCAL_STORAGE_KEYS.ADMIN_ACCESS_TOKEN, tokens.accessToken);
  localStorage.setItem(LOCAL_STORAGE_KEYS.ADMIN_REFRESH_TOKEN, tokens.refreshToken);
  return request(tokens.accessToken);
};
