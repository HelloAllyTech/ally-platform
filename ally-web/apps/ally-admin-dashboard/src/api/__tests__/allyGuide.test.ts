import { configureStore } from "@reduxjs/toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same cycle-breaking mocks as the sibling api tests: baseApi pulls in the real store for its
// 401/403 toasts, and "@constants" reaches "@components" (and through it the "@api" barrel).
vi.mock("@store", () => ({
  store: { dispatch: vi.fn(), getState: vi.fn(), subscribe: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@components", () => ({
  cellTypes: new Proxy({}, { get: (_target, prop) => prop }),
}));

// Raw source, via Vite's ?raw import: RTK Query exposes no way to read the registered `tagTypes`
// back (same check as helplineAdmin.test.ts).
import baseApiSource from "../baseApi.ts?raw";
// Imported from the files, not the "@api" barrel, for the same reason as the sibling tests.
import { allyGuideAPI } from "../allyGuide";
import allyGuideSource from "../allyGuide.ts?raw";
import { baseAPI } from "../baseApi";

interface SentRequest {
  url: string;
  method: string;
  body: unknown;
}

describe("allyGuideAPI", () => {
  let store: ReturnType<typeof configureStore>;
  let sent: SentRequest[];
  /** What the stubbed server answers, by "METHOD path". Anything else is `{}`. */
  let answers: Record<string, unknown>;

  const respond = async (request: Request) => {
    const text = await request.clone().text();
    const url = new URL(request.url);
    sent.push({
      url: `${url.pathname}${url.search}`,
      method: request.method,
      body: text ? JSON.parse(text) : undefined,
    });
    const key = `${request.method} ${url.pathname.replace("/api", "")}`;
    return new Response(JSON.stringify(answers[key] ?? {}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  beforeEach(() => {
    sent = [];
    answers = {};
    store = configureStore({
      reducer: { [baseAPI.reducerPath]: baseAPI.reducer },
      middleware: getDefault => getDefault().concat(baseAPI.middleware),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => respond(request)),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const dispatch = (action: unknown) => (store.dispatch as (a: unknown) => Promise<any>)(action);

  describe("tag registration", () => {
    // A tag a slice uses must ALSO be declared in baseAPI's `tagTypes`: an unregistered tag is
    // silently ignored, so a save would look like it worked while the screen kept the old data.
    const usedTags = [...new Set(allyGuideSource.match(/TAG_TYPES\.[A-Z0-9_]+/g) ?? [])];

    it("uses at least one tag (guards against the regex silently matching nothing)", () => {
      expect(usedTags.length).toBeGreaterThan(0);
    });

    it.each(usedTags)("registers %s in baseApi tagTypes", tag => {
      expect(
        baseApiSource.includes(tag),
        `${tag} is used by api/allyGuide.ts but not registered in api/baseApi.ts tagTypes`,
      ).toBe(true);
    });
  });

  describe("kill switches", () => {
    it("reads the switches", async () => {
      answers["GET /v1/guide/admin/settings"] = { enabled: true, anonymousChat: false };
      const result = await dispatch(allyGuideAPI.endpoints.getAllyGuideSettings.initiate());

      expect(result.data).toEqual({ enabled: true, anonymousChat: false });
      expect(sent[0]).toMatchObject({ method: "GET", url: "/api/v1/guide/admin/settings" });
    });

    it("sends only the switch that changed, and the server merges it", async () => {
      answers["PUT /v1/guide/admin/settings"] = { enabled: false, voice: true };
      await dispatch(allyGuideAPI.endpoints.updateAllyGuideSettings.initiate({ enabled: false }));

      expect(sent[0]).toMatchObject({
        method: "PUT",
        url: "/api/v1/guide/admin/settings",
        body: { enabled: false },
      });
    });

    it("writes the PUT's own answer into the settings cache and does not refetch over it", async () => {
      // Subscribe first, so there is a cache entry to land in.
      answers["GET /v1/guide/admin/settings"] = { enabled: true, disabledCourses: [] };
      await dispatch(allyGuideAPI.endpoints.getAllyGuideSettings.initiate());
      sent.length = 0;

      answers["PUT /v1/guide/admin/settings"] = { enabled: true, disabledCourses: ["course-1"] };
      // What an ally-be instance on a stale 30 s snapshot would answer if asked right now.
      answers["GET /v1/guide/admin/settings"] = { enabled: true, disabledCourses: [] };
      await dispatch(
        allyGuideAPI.endpoints.updateAllyGuideSettings.initiate({ disabledCourses: ["course-1"] }),
      );
      // Give any (unwanted) invalidation refetch the chance to land.
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(sent.map(request => request.method)).toEqual(["PUT"]);
      const cached = allyGuideAPI.endpoints.getAllyGuideSettings.select()(
        store.getState() as never,
      );
      expect(cached.data).toEqual({ enabled: true, disabledCourses: ["course-1"] });
    });
  });

  describe("overview and conversations", () => {
    it("asks for the chosen window", async () => {
      await dispatch(allyGuideAPI.endpoints.getAllyGuideOverview.initiate({ days: 30 }));

      expect(sent[0]).toMatchObject({ method: "GET", url: "/api/v1/guide/admin/overview?days=30" });
    });

    it("leaves absent filters off the URL entirely", async () => {
      await dispatch(allyGuideAPI.endpoints.getAllyGuideThreads.initiate({ limit: 25 }));
      await dispatch(allyGuideAPI.endpoints.getAllyGuideThreads.initiate(undefined));

      expect(sent[0].url).toBe("/api/v1/guide/admin/threads?limit=25");
      expect(sent[1].url).toBe("/api/v1/guide/admin/threads");
    });

    it("drops a blank filter rather than sending `tenantId=` as a filter on the empty string", async () => {
      await dispatch(
        allyGuideAPI.endpoints.getAllyGuideThreads.initiate({
          limit: 25,
          tenantId: "",
          mode: undefined,
        }),
      );

      expect(sent[0].url).toBe("/api/v1/guide/admin/threads?limit=25");
    });

    it("sends the cursor, the organisation and the mode when they are chosen", async () => {
      await dispatch(
        allyGuideAPI.endpoints.getAllyGuideThreads.initiate({
          limit: 25,
          before: "2026-10-23T10:00:00.000Z",
          tenantId: "tenant-a",
          mode: "CRISIS",
        }),
      );

      const url = new URL(`http://x${sent[0].url}`);
      expect(url.pathname).toBe("/api/v1/guide/admin/threads");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        limit: "25",
        before: "2026-10-23T10:00:00.000Z",
        tenantId: "tenant-a",
        mode: "CRISIS",
      });
    });

    it("reads a conversation's traces, a single turn, and its transcript by id in the path", async () => {
      await dispatch(allyGuideAPI.endpoints.getAllyGuideThreadTraces.initiate("thread-1"));
      await dispatch(allyGuideAPI.endpoints.getAllyGuideTurnTrace.initiate("turn-1"));
      await dispatch(allyGuideAPI.endpoints.getAllyGuideTranscript.initiate("thread-1"));
      await dispatch(allyGuideAPI.endpoints.getAllyGuideTurnPayload.initiate("turn-1"));

      expect(sent.map(request => request.url)).toEqual([
        "/api/v1/guide/admin/threads/thread-1/traces",
        "/api/v1/guide/admin/turns/turn-1/trace",
        "/api/v1/guide/admin/threads/thread-1/transcript",
        "/api/v1/guide/admin/turns/turn-1/payload",
      ]);
      expect(sent.every(request => request.method === "GET")).toBe(true);
    });
  });

  describe("releases", () => {
    it("reads the list and one release", async () => {
      await dispatch(allyGuideAPI.endpoints.getAllyGuideReleases.initiate());
      await dispatch(allyGuideAPI.endpoints.getAllyGuideRelease.initiate("rel-3"));

      expect(sent.map(request => request.url)).toEqual([
        "/api/v1/guide/admin/releases",
        "/api/v1/guide/admin/releases/rel-3",
      ]);
    });

    it("promotes with a POST to the release's own path and no body", async () => {
      await dispatch(allyGuideAPI.endpoints.promoteAllyGuideRelease.initiate("rel-4"));

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/guide/admin/releases/rel-4/promote",
      });
      expect(sent[0].body).toBeUndefined();
    });

    it("sends emergency: true with the reason for an emergency rollback", async () => {
      answers["POST /v1/guide/admin/releases/rollback"] = { id: "rel-2", version: 2, status: "ga" };
      const result = await dispatch(
        allyGuideAPI.endpoints.rollbackAllyGuideRelease.initiate({
          emergency: true,
          reason: "Replies in Hindi repeat themselves",
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/guide/admin/releases/rollback",
        body: { emergency: true, reason: "Replies in Hindi repeat themselves" },
      });
      expect(result.data).toMatchObject({ version: 2 });
    });

    it("always sends emergency, as false for an ordinary rollback", async () => {
      await dispatch(
        allyGuideAPI.endpoints.rollbackAllyGuideRelease.initiate({ emergency: false }),
      );

      expect(sent[0].body).toEqual({ emergency: false });
    });

    it("leaves a blank reason off the wire and trims one with padding", async () => {
      await dispatch(
        allyGuideAPI.endpoints.rollbackAllyGuideRelease.initiate({
          emergency: false,
          reason: "   ",
        }),
      );
      await dispatch(
        allyGuideAPI.endpoints.rollbackAllyGuideRelease.initiate({
          emergency: false,
          reason: "  too slow  ",
        }),
      );

      expect(sent[0].body).toEqual({ emergency: false });
      expect(sent[1].body).toEqual({ emergency: false, reason: "too slow" });
    });

    it("refetches the release list after a rollback, since the live release changed", async () => {
      answers["GET /v1/guide/admin/releases"] = [{ id: "rel-3", status: "ga" }];
      await dispatch(allyGuideAPI.endpoints.getAllyGuideReleases.initiate());
      sent.length = 0;

      answers["GET /v1/guide/admin/releases"] = [{ id: "rel-2", status: "ga" }];
      await dispatch(
        allyGuideAPI.endpoints.rollbackAllyGuideRelease.initiate({ emergency: false }),
      );
      await vi.waitFor(() =>
        expect(
          sent.some(request => request.method === "GET" && request.url.endsWith("/releases")),
        ).toBe(true),
      );
    });
  });

  describe("platform crisis copy", () => {
    it("reads the active copy", async () => {
      await dispatch(allyGuideAPI.endpoints.getAllyGuideCrisisResponses.initiate());

      expect(sent[0]).toMatchObject({ method: "GET", url: "/api/v1/guide/admin/crisis-responses" });
    });

    it("saves a language's text as { languageCode, body }", async () => {
      await dispatch(
        allyGuideAPI.endpoints.saveAllyGuideCrisisResponse.initiate({
          languageCode: "hi",
          body: "x".repeat(60),
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "PUT",
        url: "/api/v1/guide/admin/crisis-responses",
        body: { languageCode: "hi", body: "x".repeat(60) },
      });
    });

    it("withdraws a version by id", async () => {
      await dispatch(allyGuideAPI.endpoints.deleteAllyGuideCrisisResponse.initiate("copy-1"));

      expect(sent[0]).toMatchObject({
        method: "DELETE",
        url: "/api/v1/guide/admin/crisis-responses/copy-1",
      });
    });
  });

  describe("organisation layer", () => {
    it("names the organisation in the query on every read", async () => {
      await dispatch(allyGuideAPI.endpoints.getAllyGuideOrgProfile.initiate("tenant-a"));
      await dispatch(allyGuideAPI.endpoints.getAllyGuideOrgCrisisResponses.initiate("tenant-a"));

      expect(sent.map(request => request.url)).toEqual([
        "/api/v1/guide/admin/org-profile?tenantId=tenant-a",
        "/api/v1/guide/admin/org-crisis-responses?tenantId=tenant-a",
      ]);
    });

    it("saves the profile as the body itself, with the organisation in the query", async () => {
      const profile = {
        supervisorContact: "Dr Rao",
        avoidTopics: ["politics"],
        outreachEnabled: true,
      };
      await dispatch(
        allyGuideAPI.endpoints.saveAllyGuideOrgProfile.initiate({ tenantId: "tenant-a", profile }),
      );

      expect(sent[0]).toMatchObject({
        method: "PUT",
        url: "/api/v1/guide/admin/org-profile?tenantId=tenant-a",
        body: profile,
      });
      // The server reads the body as the profile, so wrapping it in { profile } would save nothing.
      expect(sent[0].body).not.toHaveProperty("profile");
    });

    it("leaves the cache holding the saved profile, not the one it replaced", async () => {
      answers["GET /v1/guide/admin/org-profile"] = {
        tenantId: "tenant-a",
        version: 1,
        profile: {},
      };
      await dispatch(allyGuideAPI.endpoints.getAllyGuideOrgProfile.initiate("tenant-a"));

      const saved = { tenantId: "tenant-a", version: 2, profile: { toneNotes: "Warm" } };
      answers["PUT /v1/guide/admin/org-profile"] = saved;
      // The org profile is read from the database on every request, so the backstop refetch the
      // invalidation triggers sees the same saved document.
      answers["GET /v1/guide/admin/org-profile"] = saved;
      await dispatch(
        allyGuideAPI.endpoints.saveAllyGuideOrgProfile.initiate({
          tenantId: "tenant-a",
          profile: { toneNotes: "Warm" },
        }),
      );

      await vi.waitFor(() => {
        const cached = allyGuideAPI.endpoints.getAllyGuideOrgProfile.select("tenant-a")(
          store.getState() as never,
        );
        expect(cached.data).toMatchObject({ version: 2, profile: { toneNotes: "Warm" } });
      });
    });

    it("saves an organisation's crisis copy with the organisation in the query, not the body", async () => {
      await dispatch(
        allyGuideAPI.endpoints.saveAllyGuideOrgCrisisResponse.initiate({
          tenantId: "tenant-a",
          languageCode: "en",
          body: "y".repeat(60),
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "PUT",
        url: "/api/v1/guide/admin/org-crisis-responses?tenantId=tenant-a",
        body: { languageCode: "en", body: "y".repeat(60) },
      });
      expect(sent[0].body).not.toHaveProperty("tenantId");
    });
  });
});
