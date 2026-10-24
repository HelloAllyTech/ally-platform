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
    // `in`, not `??`: an answer of `null` is an answer, and must not be swapped for `{}`.
    return new Response(JSON.stringify(key in answers ? answers[key] : {}), {
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

    it("re-reads the overview after the live release or the canary changes", async () => {
      await dispatch(allyGuideAPI.endpoints.getAllyGuideOverview.initiate({ days: 7 }));
      sent.length = 0;

      await dispatch(allyGuideAPI.endpoints.stopAllyGuideCanary.initiate({ emergency: false }));

      await vi.waitFor(() => {
        const gets = sent.filter(request => request.method === "GET").map(request => request.url);
        expect(gets).toContain("/api/v1/guide/admin/overview?days=7");
      });
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

  describe("conversations, by cursor", () => {
    it("pages with a row's cursor and filters by status as well as mode and organisation", async () => {
      await dispatch(
        allyGuideAPI.endpoints.getAllyGuideThreads.initiate({
          limit: 25,
          before: "2026-10-23T10:00:00.123456|11111111-aaaa-4bbb-8ccc-000000000001",
          status: "archived",
          mode: "CARE",
          tenantId: "tenant-a",
        }),
      );

      const url = new URL(`http://x${sent[0].url}`);
      // The cursor carries its own `|`; it must reach the server whole, once decoded.
      expect(url.searchParams.get("before")).toBe(
        "2026-10-23T10:00:00.123456|11111111-aaaa-4bbb-8ccc-000000000001",
      );
      expect(url.searchParams.get("status")).toBe("archived");
      expect(url.searchParams.get("mode")).toBe("CARE");
      expect(url.searchParams.get("tenantId")).toBe("tenant-a");
    });

    it("reads one conversation by id, for a link to a thread the list has not loaded", async () => {
      answers["GET /v1/guide/admin/threads/thread-1"] = { id: "thread-1", tenantName: "Acme" };
      const result = await dispatch(allyGuideAPI.endpoints.getAllyGuideThread.initiate("thread-1"));

      expect(sent[0]).toMatchObject({ method: "GET", url: "/api/v1/guide/admin/threads/thread-1" });
      expect(result.data).toEqual({ id: "thread-1", tenantName: "Acme" });
    });
  });

  describe("rollback target, audit and canary", () => {
    it("reads where a rollback would land", async () => {
      answers["GET /v1/guide/admin/releases/rollback-target"] = { releaseId: "rel-2", version: 2 };
      const result = await dispatch(allyGuideAPI.endpoints.getAllyGuideRollbackTarget.initiate());

      expect(sent[0].url).toBe("/api/v1/guide/admin/releases/rollback-target");
      expect(result.data).toEqual({ releaseId: "rel-2", version: 2 });
    });

    it("reads 'no earlier release' as null, not as a failure", async () => {
      answers["GET /v1/guide/admin/releases/rollback-target"] = null;
      const result = await dispatch(allyGuideAPI.endpoints.getAllyGuideRollbackTarget.initiate());

      expect(result.isSuccess).toBe(true);
      expect(result.data).toBeNull();
    });

    it("reads an empty 200 body, which is how Nest answers a null return, as null too", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("", { status: 200 })),
      );
      const result = await dispatch(allyGuideAPI.endpoints.getAllyGuideRollbackTarget.initiate());

      expect(result.isSuccess).toBe(true);
      expect(result.data).toBeNull();
    });

    it("reads the audit trail with a limit, or without one", async () => {
      await dispatch(allyGuideAPI.endpoints.getAllyGuideReleaseAudit.initiate({ limit: 50 }));
      await dispatch(allyGuideAPI.endpoints.getAllyGuideReleaseAudit.initiate());

      expect(sent[0].url).toBe("/api/v1/guide/admin/releases/audit?limit=50");
      expect(sent[1].url).toBe("/api/v1/guide/admin/releases/audit");
    });

    it("starts a canary with the share in the body and the release in the path", async () => {
      await dispatch(
        allyGuideAPI.endpoints.startAllyGuideCanary.initiate({
          id: "rel-4",
          percent: 20,
          reason: "  Try the warmer opening  ",
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/guide/admin/releases/rel-4/canary",
        body: { percent: 20, reason: "Try the warmer opening" },
      });
      expect(sent[0].body).not.toHaveProperty("id");
    });

    it("drops a blank canary reason", async () => {
      await dispatch(
        allyGuideAPI.endpoints.startAllyGuideCanary.initiate({
          id: "rel-4",
          percent: 5,
          reason: "  ",
        }),
      );

      expect(sent[0].body).toEqual({ percent: 5 });
    });

    it("stops the canary, always saying whether it is an emergency", async () => {
      await dispatch(
        allyGuideAPI.endpoints.stopAllyGuideCanary.initiate({
          emergency: true,
          reason: "Crisis replies doubled",
        }),
      );
      await dispatch(allyGuideAPI.endpoints.stopAllyGuideCanary.initiate({ emergency: false }));

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/guide/admin/releases/canary/stop",
        body: { emergency: true, reason: "Crisis replies doubled" },
      });
      expect(sent[1].body).toEqual({ emergency: false });
    });

    it("re-reads the release list and the rollback target after a canary starts or stops", async () => {
      answers["GET /v1/guide/admin/releases"] = [];
      answers["GET /v1/guide/admin/releases/rollback-target"] = null;
      await dispatch(allyGuideAPI.endpoints.getAllyGuideReleases.initiate());
      await dispatch(allyGuideAPI.endpoints.getAllyGuideRollbackTarget.initiate());
      sent.length = 0;

      await dispatch(
        allyGuideAPI.endpoints.startAllyGuideCanary.initiate({ id: "rel-4", percent: 20 }),
      );

      await vi.waitFor(() => {
        const gets = sent.filter(request => request.method === "GET").map(request => request.url);
        expect(gets).toContain("/api/v1/guide/admin/releases");
        expect(gets).toContain("/api/v1/guide/admin/releases/rollback-target");
      });
    });
  });

  describe("playground", () => {
    it("posts the scenario as it is and answers with the run, never caching it", async () => {
      answers["POST /v1/guide/admin/playground"] = {
        reply: "Hello",
        replyKind: "model",
        toolCalls: [],
      };
      const body = {
        releaseId: "rel-4",
        trackId: "track-1",
        message: "Hi",
        progress: 2,
        mode: "CARE" as const,
        history: [{ role: "learner" as const, text: "Earlier" }],
      };
      const result = await dispatch(allyGuideAPI.endpoints.runAllyGuidePlayground.initiate(body));

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/guide/admin/playground",
        body,
      });
      expect(result.data).toMatchObject({ reply: "Hello" });
    });

    it("hands the server's message through on a refusal, for the pane to show", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ message: "A message or an intent is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }),
        ),
      );
      const result = await dispatch(
        allyGuideAPI.endpoints.runAllyGuidePlayground.initiate({
          releaseId: "r",
          trackId: "t",
          message: "",
        }),
      );

      expect(result.error).toMatchObject({
        status: 400,
        data: { message: "A message or an intent is required" },
      });
    });
  });

  describe("alerts", () => {
    it("reads the alerts with a limit", async () => {
      await dispatch(allyGuideAPI.endpoints.getAllyGuideAlerts.initiate({ limit: 100 }));

      expect(sent[0]).toMatchObject({ method: "GET", url: "/api/v1/guide/admin/alerts?limit=100" });
    });

    it("asks for unacknowledged alerts only with open=true, and leaves it off otherwise", async () => {
      await dispatch(
        allyGuideAPI.endpoints.getAllyGuideAlerts.initiate({ limit: 200, open: true }),
      );
      await dispatch(
        allyGuideAPI.endpoints.getAllyGuideAlerts.initiate({ limit: 200, open: false }),
      );

      expect(sent[0].url).toBe("/api/v1/guide/admin/alerts?limit=200&open=true");
      expect(sent[1].url).toBe("/api/v1/guide/admin/alerts?limit=200");
    });

    it("reads how many alerts are open and in all, and re-reads them after an acknowledgement", async () => {
      answers["GET /v1/guide/admin/alerts/counts"] = { open: 2, total: 9 };
      const result = await dispatch(allyGuideAPI.endpoints.getAllyGuideAlertCounts.initiate());
      expect(result.data).toEqual({ open: 2, total: 9 });
      sent.length = 0;

      await dispatch(allyGuideAPI.endpoints.acknowledgeAllyGuideAlert.initiate("alert-1"));

      await vi.waitFor(() =>
        expect(sent.map(request => request.url)).toContain("/api/v1/guide/admin/alerts/counts"),
      );
    });

    it("runs the rules now and answers with what newly fired", async () => {
      answers["POST /v1/guide/admin/alerts/check"] = [{ id: "a1", rule: "turn_failures" }];
      const result = await dispatch(allyGuideAPI.endpoints.checkAllyGuideAlerts.initiate());

      expect(sent[0]).toMatchObject({ method: "POST", url: "/api/v1/guide/admin/alerts/check" });
      expect(result.data).toEqual([{ id: "a1", rule: "turn_failures" }]);
    });

    it("acknowledges one alert by id, and refreshes the list", async () => {
      answers["GET /v1/guide/admin/alerts"] = [];
      await dispatch(allyGuideAPI.endpoints.getAllyGuideAlerts.initiate());
      sent.length = 0;

      await dispatch(allyGuideAPI.endpoints.acknowledgeAllyGuideAlert.initiate("alert-1"));

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/guide/admin/alerts/alert-1/ack",
      });
      await vi.waitFor(() =>
        expect(
          sent.some(request => request.method === "GET" && request.url.includes("/alerts")),
        ).toBe(true),
      );
    });
  });

  describe("baseline", () => {
    it("reads the snapshots with a limit", async () => {
      await dispatch(allyGuideAPI.endpoints.getAllyGuideBaselines.initiate({ limit: 100 }));

      expect(sent[0]).toMatchObject({
        method: "GET",
        url: "/api/v1/guide/admin/baseline?limit=100",
      });
    });

    it("captures a snapshot with the window and a trimmed note, dropping a blank one", async () => {
      await dispatch(
        allyGuideAPI.endpoints.captureAllyGuideBaseline.initiate({
          windowDays: 90,
          note: "  before launch ",
        }),
      );
      await dispatch(
        allyGuideAPI.endpoints.captureAllyGuideBaseline.initiate({ windowDays: 30, note: "   " }),
      );

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/guide/admin/baseline",
        body: { windowDays: 90, note: "before launch" },
      });
      expect(sent[1].body).toEqual({ windowDays: 30 });
    });

    it("refreshes the snapshot list after a capture", async () => {
      answers["GET /v1/guide/admin/baseline"] = [];
      await dispatch(allyGuideAPI.endpoints.getAllyGuideBaselines.initiate());
      sent.length = 0;

      await dispatch(allyGuideAPI.endpoints.captureAllyGuideBaseline.initiate({ windowDays: 90 }));

      await vi.waitFor(() =>
        expect(
          sent.some(request => request.method === "GET" && request.url.includes("/baseline")),
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

    it("withdraws an organisation's own copy by id, with the organisation in the query", async () => {
      await dispatch(
        allyGuideAPI.endpoints.deleteAllyGuideOrgCrisisResponse.initiate({
          tenantId: "tenant-a",
          id: "copy-1",
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "DELETE",
        url: "/api/v1/guide/admin/org-crisis-responses/copy-1?tenantId=tenant-a",
      });
    });
  });
});
