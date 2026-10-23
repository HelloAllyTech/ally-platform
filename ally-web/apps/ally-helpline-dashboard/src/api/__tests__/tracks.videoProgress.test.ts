import { configureStore } from "@reduxjs/toolkit";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  import.meta.env.VITE_API_BASE_URL ||= "http://test.local";
});

import { baseAPI } from "../baseAPI";
import { tracksAPI } from "../tracks";

const detail = {
  id: "t1",
  title: "Course",
  sections: [{ id: "s1", title: "S", items: [{ id: "v1", type: "VIDEO", maxWatchedPct: 10 }] }],
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("tracksAPI.reportVideoProgress", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("patches the cached detail the player actually reads (keyed with languageCode)", async () => {
    let releaseReport: (value: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((request: Request) =>
        request.url.includes("video-progress")
          ? new Promise<Response>(resolve => {
              releaseReport = resolve;
            })
          : Promise.resolve(jsonResponse(detail)),
      ),
    );
    const store = configureStore({
      reducer: { [baseAPI.reducerPath]: baseAPI.reducer },
      middleware: getDefaultMiddleware => getDefaultMiddleware().concat(baseAPI.middleware),
    });
    const args = { trackId: "t1", languageCode: "hi" };
    await store.dispatch(tracksAPI.endpoints.getLearnTrackDetail.initiate(args));

    const report = store.dispatch(
      tracksAPI.endpoints.reportVideoProgress.initiate({
        itemId: "v1",
        trackId: "t1",
        watchedPct: 55,
      }),
    );
    // Optimistic: before the server answers, the cached item already shows the new position.
    await new Promise(resolve => setTimeout(resolve, 0));
    const cached = tracksAPI.endpoints.getLearnTrackDetail.select(args)(store.getState());
    expect(cached.data?.sections[0].items[0].maxWatchedPct).toBe(55);

    releaseReport(jsonResponse({ completed: false, maxWatchedPct: 55 }));
    await report;
  });
});
