import { configureStore } from "@reduxjs/toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `baseAPI` reads VITE_API_BASE_URL once, at module load (see tracks.articleQuestion.test.ts).
vi.hoisted(() => {
  import.meta.env.VITE_API_BASE_URL ||= "http://test.local";
});

import { baseAPI } from "../baseAPI";
import { tracksAPI } from "../tracks";

const makeStore = () =>
  configureStore({
    reducer: { [baseAPI.reducerPath]: baseAPI.reducer },
    middleware: getDefaultMiddleware => getDefaultMiddleware().concat(baseAPI.middleware),
  });

const sentBody = async (): Promise<string> => {
  const [request] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  return (request as Request).text();
};

describe("tracksAPI.enrollTrack", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ trackEnrollmentId: "e1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends the entry source from the public landing alongside the language", async () => {
    await makeStore().dispatch(
      tracksAPI.endpoints.enrollTrack.initiate({
        trackId: "c1",
        languageCode: "hi",
        entrySource: "public_link",
      }),
    );
    const [request] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((request as Request).url).toContain("/v1/learn/tracks/c1/enroll");
    expect(JSON.parse(await sentBody())).toEqual({
      languageCode: "hi",
      entrySource: "public_link",
    });
  });

  it("sends no entry source otherwise (the server reads that as in_app)", async () => {
    await makeStore().dispatch(
      tracksAPI.endpoints.enrollTrack.initiate({ trackId: "c1", languageCode: "en" }),
    );
    expect(JSON.parse(await sentBody())).toEqual({ languageCode: "en" });
  });
});
