/**
 * Opens the thread's SSE stream with the learner's JWT in a header (plan
 * §9.1), refreshing an expired access token and trying once more (plan §11
 * A-7). The refresh is single-flight: refresh tokens rotate, so two
 * concurrent refreshes with the same token would sign the learner out.
 */
import { handleLogout } from "@api/baseAPI";
import { ApiEndpoints, LOCAL_STORAGE_KEYS } from "@constants";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const apiBase = (): string => `${import.meta.env.VITE_API_BASE_URL ?? ""}/api`;

let refreshing: Promise<string | null> | null = null;

/**
 * Returns a usable access token after a 401 on `staleToken`: the one already
 * in storage if something else refreshed meanwhile, otherwise a fresh one.
 * Null when the refresh token itself was refused (the caller signs out); a
 * network failure during refresh throws instead, so the stream just retries.
 */
export const refreshAccessToken = (
  staleToken: string | null,
  fetchImpl: FetchLike,
): Promise<string | null> => {
  const current = localStorage.getItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN);
  if (current && current !== staleToken) return Promise.resolve(current);
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const refreshToken = localStorage.getItem(LOCAL_STORAGE_KEYS.REFRESH_TOKEN);
    if (!refreshToken) return null;
    const response = await fetchImpl(`${apiBase()}${ApiEndpoints.AUTH.REFRESH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (response.status >= 500) throw new Error(`refresh ${response.status}`);
    if (!response.ok) return null;
    const tokens = (await response.json()) as { accessToken: string; refreshToken: string };
    localStorage.setItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
    localStorage.setItem(LOCAL_STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
    return tokens.accessToken;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
};

export interface OpenStreamOptions {
  threadId: string;
  /** Resume after this durable seq (sent as Last-Event-ID). */
  afterSeq: number;
  signal: AbortSignal;
  fetchImpl?: FetchLike;
}

export const openGuideStream = async ({
  threadId,
  afterSeq,
  signal,
  fetchImpl = (input, init) => fetch(input, init),
}: OpenStreamOptions): Promise<Response> => {
  const url = `${apiBase()}${ApiEndpoints.GUIDE.EVENTS(threadId)}`;
  const request = (token: string | null) =>
    fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(afterSeq > 0 ? { "Last-Event-ID": String(afterSeq) } : {}),
      },
      cache: "no-store",
      signal,
    });

  const token = localStorage.getItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN);
  const response = await request(token);
  if (response.status !== 401) return response;

  const fresh = await refreshAccessToken(token, fetchImpl);
  if (!fresh) {
    handleLogout();
    throw new Error("session expired");
  }
  return request(fresh);
};
