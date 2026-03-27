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
 * `json()` and `clone().text()` in parallel.
 */
export function mockOkJsonResponse(jsonBody: unknown = {}): Response {
  const r: MockableResponse = {
    ok: true,
    status: 200,
    json: async () => jsonBody,
    text: async () => '',
    headers: {get: () => null},
    clone(): Response {
      return r as unknown as Response;
    },
  };
  return r as unknown as Response;
}
