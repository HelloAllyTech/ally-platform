type MockableResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  headers: {get: (name: string) => string | null};
  clone: () => Response;
};

/**
 * Minimal fetch Response for tests; RTK Query calls `response.clone()` and reads both
 * `json()` and `clone().text()` in parallel. RTK's default JSON handler parses via
 * `response.text()` (not `json()`), so `text()` must return serialized JSON.
 */
export function mockOkJsonResponse(jsonBody: unknown = {}): Response {
  const serialized = JSON.stringify(jsonBody);
  const r: MockableResponse = {
    ok: true,
    status: 200,
    json: async () => JSON.parse(serialized),
    text: async () => serialized,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    clone(): Response {
      return r as unknown as Response;
    },
  };
  return r as unknown as Response;
}
