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

// Raw source, via Vite's ?raw import: RTK Query exposes no way to read the registered `tagTypes` back.
import baseApiSource from "../baseApi.ts?raw";
// Imported from the files, not the "@api" barrel, for the same reason as the sibling tests.
import { allyGuideLearningAPI } from "../allyGuideLearning";
import allyGuideLearningSource from "../allyGuideLearning.ts?raw";
import { baseAPI } from "../baseApi";

interface SentRequest {
  url: string;
  method: string;
  body: unknown;
}

const BASE = "/api/v1/guide/admin";

describe("allyGuideLearningAPI", () => {
  let store: ReturnType<typeof configureStore>;
  let sent: SentRequest[];
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
  const gets = () => sent.filter(request => request.method === "GET").map(request => request.url);
  const endpoints = allyGuideLearningAPI.endpoints;

  describe("tag registration", () => {
    it("registers every tag the slice uses in baseApi's tagTypes", () => {
      const used = [...allyGuideLearningSource.matchAll(/TAG_TYPES\.(ALLY_GUIDE_[A-Z_]+)/g)].map(
        match => match[1],
      );
      expect(used.length).toBeGreaterThan(0);
      for (const tag of new Set(used)) {
        expect(baseApiSource, `${tag} missing from baseApi tagTypes`).toContain(`TAG_TYPES.${tag}`);
      }
    });
  });

  describe("configuration plane", () => {
    it("reads the schema, the overrides (with an optional layer) and the audit", async () => {
      await dispatch(endpoints.getAllyGuideConfigSchema.initiate());
      await dispatch(endpoints.getAllyGuideConfigOverrides.initiate({ layer: "course" }));
      await dispatch(endpoints.getAllyGuideConfigOverrides.initiate());
      await dispatch(endpoints.getAllyGuideConfigAudit.initiate({ limit: 30 }));

      expect(sent.map(request => request.url)).toEqual([
        `${BASE}/config/schema`,
        `${BASE}/config/overrides?layer=course`,
        `${BASE}/config/overrides`,
        `${BASE}/config/audit?limit=30`,
      ]);
    });

    it("reads an organisation's layer by tenantId in the query, and a course's by id in the path", async () => {
      await dispatch(endpoints.getAllyGuideConfigLayer.initiate({ layer: "org", scopeId: "t-1" }));
      await dispatch(
        endpoints.getAllyGuideConfigLayer.initiate({ layer: "course", scopeId: "c-1" }),
      );

      expect(sent[0]).toMatchObject({ method: "GET", url: `${BASE}/config/org?tenantId=t-1` });
      expect(sent[1]).toMatchObject({ method: "GET", url: `${BASE}/config/course/c-1` });
    });

    it("saves with set, clear and the version it loaded, leaving out what is empty", async () => {
      await dispatch(
        endpoints.saveAllyGuideConfig.initiate({
          layer: "course",
          scopeId: "c-1",
          set: { releaseWindowMaxTurns: 8 },
          clear: [],
          expectedVersion: 3,
        }),
      );
      await dispatch(
        endpoints.saveAllyGuideConfig.initiate({
          layer: "org",
          scopeId: "t-1",
          clear: ["a"],
          expectedVersion: 0,
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "PUT",
        url: `${BASE}/config/course/c-1`,
        body: { set: { releaseWindowMaxTurns: 8 }, expectedVersion: 3 },
      });
      expect(sent[0].body).not.toHaveProperty("clear");
      expect(sent[1]).toMatchObject({
        method: "PUT",
        url: `${BASE}/config/org?tenantId=t-1`,
        body: { clear: ["a"], expectedVersion: 0 },
      });
    });

    it("re-reads that layer and the platform listing after a save, but not another layer", async () => {
      await dispatch(
        endpoints.getAllyGuideConfigLayer.initiate({ layer: "course", scopeId: "c-1" }),
      );
      await dispatch(
        endpoints.getAllyGuideConfigLayer.initiate({ layer: "course", scopeId: "c-2" }),
      );
      await dispatch(endpoints.getAllyGuideConfigOverrides.initiate());
      sent.length = 0;

      await dispatch(
        endpoints.saveAllyGuideConfig.initiate({ layer: "course", scopeId: "c-1", set: { a: 1 } }),
      );

      await vi.waitFor(() => {
        expect(gets()).toContain(`${BASE}/config/course/c-1`);
        expect(gets()).toContain(`${BASE}/config/overrides`);
      });
      expect(gets()).not.toContain(`${BASE}/config/course/c-2`);
    });

    it("hands a refusal and a stale save back with their status and body, for the form to read", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                message: ["a is above 20"],
                errorCode: "GUIDE_CONFIG_REFUSED",
              }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            ),
        ),
      );

      const result = await dispatch(
        endpoints.saveAllyGuideConfig.initiate({ layer: "course", scopeId: "c-1", set: { a: 99 } }),
      );

      expect(result.error).toMatchObject({
        status: 400,
        data: { errorCode: "GUIDE_CONFIG_REFUSED", message: ["a is above 20"] },
      });
    });

    it("explains a thread's config without caching it under any tag", async () => {
      await dispatch(endpoints.getAllyGuideThreadConfig.initiate("th-1"));

      expect(sent[0]).toMatchObject({ method: "GET", url: `${BASE}/threads/th-1/config` });
    });
  });

  describe("advice", () => {
    it("lists by status with a limit, leaving absent parameters off", async () => {
      await dispatch(endpoints.getAllyGuideAdvice.initiate({ status: "pending", limit: 50 }));
      await dispatch(endpoints.getAllyGuideAdvice.initiate());

      expect(sent[0].url).toBe(`${BASE}/advice?status=pending&limit=50`);
      expect(sent[1].url).toBe(`${BASE}/advice`);
    });

    it("moderates with the decision, trimming the reason and dropping a blank one, then re-reads", async () => {
      await dispatch(endpoints.getAllyGuideAdvice.initiate({ status: "pending" }));
      sent.length = 0;

      await dispatch(
        endpoints.moderateAllyGuideAdvice.initiate({
          id: "a-1",
          decision: "reject",
          reason: "  names a person ",
        }),
      );
      await dispatch(
        endpoints.moderateAllyGuideAdvice.initiate({
          id: "a-2",
          decision: "approve",
          reason: "  ",
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: `${BASE}/advice/a-1/moderate`,
        body: { decision: "reject", reason: "names a person" },
      });
      const posts = sent.filter(request => request.method === "POST");
      expect(posts[1].body).toEqual({ decision: "approve" });
      await vi.waitFor(() => expect(gets()).toContain(`${BASE}/advice?status=pending`));
    });
  });

  describe("library", () => {
    it("lists the platform library and an organisation's, each by its own route", async () => {
      await dispatch(endpoints.getAllyGuideLibrary.initiate({ scope: "platform" }));
      await dispatch(
        endpoints.getAllyGuideLibrary.initiate({ scope: "organisation", tenantId: "t-1" }),
      );

      expect(sent[0].url).toBe(`${BASE}/library/documents`);
      expect(sent[1].url).toBe(`${BASE}/org-library/documents?tenantId=t-1`);
    });

    it("scopes by the route and the query, never the body", async () => {
      await dispatch(
        endpoints.createAllyGuideLibraryDocument.initiate({
          scope: "organisation",
          tenantId: "t-1",
          title: "Protocol",
          sourceType: "paste",
          text: "Hello",
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: `${BASE}/org-library/documents?tenantId=t-1`,
        body: { title: "Protocol", sourceType: "paste", text: "Hello" },
      });
      expect(sent[0].body).not.toHaveProperty("tenantId");
      expect(sent[0].body).not.toHaveProperty("scope");
    });

    it("asks for an upload URL on the right route for each scope", async () => {
      await dispatch(
        endpoints.createAllyGuideLibraryUploadUrl.initiate({
          scope: "platform",
          fileName: "a.pdf",
          fileSize: 10,
          contentType: "application/pdf",
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: `${BASE}/library/documents/upload-url`,
        body: { fileName: "a.pdf", fileSize: 10, contentType: "application/pdf" },
      });
    });

    it("archives with a DELETE, naming the organisation in the query, then re-reads only that library", async () => {
      await dispatch(
        endpoints.getAllyGuideLibrary.initiate({ scope: "organisation", tenantId: "t-1" }),
      );
      await dispatch(endpoints.getAllyGuideLibrary.initiate({ scope: "platform" }));
      sent.length = 0;

      await dispatch(
        endpoints.archiveAllyGuideLibraryDocument.initiate({
          scope: "organisation",
          tenantId: "t-1",
          id: "d-1",
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "DELETE",
        url: `${BASE}/org-library/documents/d-1?tenantId=t-1`,
      });
      await vi.waitFor(() =>
        expect(gets()).toContain(`${BASE}/org-library/documents?tenantId=t-1`),
      );
      expect(gets()).not.toContain(`${BASE}/library/documents`);
    });
  });

  describe("evaluator and reviews", () => {
    it("reads the rubric, the summary with its window, and kappa", async () => {
      await dispatch(endpoints.getAllyGuideRubric.initiate());
      await dispatch(endpoints.getAllyGuideEvaluatorSummary.initiate({ days: 14 }));
      await dispatch(endpoints.getAllyGuideKappa.initiate());

      expect(sent.map(request => request.url)).toEqual([
        `${BASE}/evaluator/rubric`,
        `${BASE}/evaluator/summary?days=14`,
        `${BASE}/evaluator/kappa`,
      ]);
    });

    it("runs the evaluator for a night, or for yesterday with an empty body", async () => {
      await dispatch(endpoints.runAllyGuideEvaluator.initiate({ night: "2026-10-23" }));
      await dispatch(endpoints.runAllyGuideEvaluator.initiate({}));

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: `${BASE}/evaluator/run`,
        body: { night: "2026-10-23" },
      });
      expect(sent[1].body).toEqual({});
    });

    it("lists reviews by status and reads one by id", async () => {
      await dispatch(endpoints.getAllyGuideReviews.initiate({ status: "open" }));
      await dispatch(endpoints.getAllyGuideReview.initiate("r-1"));

      expect(sent[0].url).toBe(`${BASE}/reviews?status=open`);
      expect(sent[1].url).toBe(`${BASE}/reviews/r-1`);
    });

    it("claims, submits labels, and dismisses, each on its own route", async () => {
      await dispatch(endpoints.claimAllyGuideReview.initiate("r-1"));
      await dispatch(
        endpoints.submitAllyGuideReview.initiate({
          id: "r-1",
          labels: { warmth: "pass" },
          verdict: "ok",
          notes: " fine ",
          saveAsCase: true,
        }),
      );
      await dispatch(endpoints.dismissAllyGuideReview.initiate({ id: "r-2", notes: "   " }));

      expect(sent[0]).toMatchObject({ method: "POST", url: `${BASE}/reviews/r-1/claim` });
      expect(sent[1]).toMatchObject({
        method: "POST",
        url: `${BASE}/reviews/r-1/submit`,
        body: { labels: { warmth: "pass" }, verdict: "ok", notes: "fine", saveAsCase: true },
      });
      expect(sent[2]).toMatchObject({ url: `${BASE}/reviews/r-2/dismiss`, body: {} });
    });

    it("leaves out saveAsCase and a blank note when they were not asked for", async () => {
      await dispatch(
        endpoints.submitAllyGuideReview.initiate({
          id: "r-1",
          labels: {},
          verdict: "problem",
          notes: "",
        }),
      );

      expect(sent[0].body).toEqual({ labels: {}, verdict: "problem" });
    });

    it("re-reads the queue and kappa after a label, and the cases after one is saved with it", async () => {
      await dispatch(endpoints.getAllyGuideReviews.initiate({ status: "open" }));
      await dispatch(endpoints.getAllyGuideKappa.initiate());
      await dispatch(endpoints.getAllyGuideEvalCases.initiate({ status: "active" }));
      sent.length = 0;

      await dispatch(
        endpoints.submitAllyGuideReview.initiate({ id: "r-1", labels: {}, verdict: "ok" }),
      );

      await vi.waitFor(() => {
        expect(gets()).toContain(`${BASE}/reviews?status=open`);
        expect(gets()).toContain(`${BASE}/evaluator/kappa`);
        expect(gets()).toContain(`${BASE}/eval-cases?status=active`);
      });
    });
  });

  describe("eval cases and runs", () => {
    it("lists suites and cases, filtering by suite, status and a limit", async () => {
      await dispatch(endpoints.getAllyGuideEvalSuites.initiate());
      await dispatch(
        endpoints.getAllyGuideEvalCases.initiate({
          suite: "smoke",
          status: "proposed",
          limit: 200,
        }),
      );

      expect(sent[0].url).toBe(`${BASE}/eval-suites`);
      expect(sent[1].url).toBe(`${BASE}/eval-cases?suite=smoke&status=proposed&limit=200`);
    });

    it("accepts, retires, makes variants and generates a red-team set", async () => {
      await dispatch(endpoints.acceptAllyGuideEvalCase.initiate("c-1"));
      await dispatch(endpoints.retireAllyGuideEvalCase.initiate("c-1"));
      await dispatch(endpoints.createAllyGuideEvalVariants.initiate("c-1"));
      await dispatch(endpoints.generateAllyGuideRedTeam.initiate());

      expect(sent.map(request => `${request.method} ${request.url}`)).toEqual([
        `POST ${BASE}/eval-cases/c-1/accept`,
        `POST ${BASE}/eval-cases/c-1/retire`,
        `POST ${BASE}/eval-cases/c-1/variants`,
        `POST ${BASE}/red-team/generate`,
      ]);
      expect(sent[3].body).toEqual({});
    });

    it("saves a turn as a case with its kind, trimming the title and dropping blanks", async () => {
      await dispatch(
        endpoints.saveAllyGuideTurnAsEvalCase.initiate({
          turnId: "t-1",
          kind: "golden",
          title: "  Good opening ",
          notes: "",
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: `${BASE}/turns/t-1/eval-case`,
        body: { kind: "golden", title: "Good opening" },
      });
      expect(sent[0].body).not.toHaveProperty("notes");
    });

    it("refreshes the cases and runs after a case changes or a run starts", async () => {
      await dispatch(endpoints.getAllyGuideEvalCases.initiate({ status: "proposed" }));
      await dispatch(endpoints.getAllyGuideEvalRuns.initiate());
      sent.length = 0;

      await dispatch(endpoints.acceptAllyGuideEvalCase.initiate("c-1"));
      await vi.waitFor(() => {
        expect(gets()).toContain(`${BASE}/eval-cases?status=proposed`);
        expect(gets()).toContain(`${BASE}/eval-runs`);
      });

      sent.length = 0;
      await dispatch(
        endpoints.startAllyGuideEvalRun.initiate({ releaseId: "rel-4", kind: "smoke" }),
      );
      await vi.waitFor(() => expect(gets()).toContain(`${BASE}/eval-runs`));
    });

    it("starts a run on the release's own route, with target cases only when there are some", async () => {
      await dispatch(
        endpoints.startAllyGuideEvalRun.initiate({
          releaseId: "rel-4",
          kind: "gate",
          targetCaseIds: ["c-1", "c-2"],
        }),
      );
      await dispatch(
        endpoints.startAllyGuideEvalRun.initiate({
          releaseId: "rel-4",
          kind: "smoke",
          targetCaseIds: [],
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: `${BASE}/releases/rel-4/eval-runs`,
        body: { kind: "gate", targetCaseIds: ["c-1", "c-2"] },
      });
      expect(sent[1].body).toEqual({ kind: "smoke" });
    });

    it("reads runs (optionally of one release), one run, and its outputs", async () => {
      await dispatch(endpoints.getAllyGuideEvalRuns.initiate({ releaseId: "rel-4" }));
      await dispatch(endpoints.getAllyGuideEvalRun.initiate("run-1"));
      await dispatch(endpoints.getAllyGuideEvalRunOutputs.initiate("run-1"));

      expect(sent.map(request => request.url)).toEqual([
        `${BASE}/eval-runs?releaseId=rel-4`,
        `${BASE}/eval-runs/run-1`,
        `${BASE}/eval-runs/run-1/outputs`,
      ]);
    });
  });

  describe("the course builder's notes for Ally", () => {
    it("reads and replaces the notes on the track's own route", async () => {
      await dispatch(endpoints.getAllyGuideNotes.initiate("track-1"));
      await dispatch(
        endpoints.saveAllyGuideNotes.initiate({
          trackId: "track-1",
          notes: "Go gently",
          tension: { "item-1": "high" },
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "GET",
        url: "/api/v1/learn/admin/tracks/track-1/guide-notes",
      });
      expect(sent[1]).toMatchObject({
        method: "PUT",
        url: "/api/v1/learn/admin/tracks/track-1/guide-notes",
        body: { notes: "Go gently", tension: { "item-1": "high" } },
      });
      expect(sent[1].body).not.toHaveProperty("draftedByCopilot");
    });

    it("marks a draft saved unedited, and sends null notes to clear them", async () => {
      await dispatch(
        endpoints.saveAllyGuideNotes.initiate({
          trackId: "track-1",
          notes: null,
          tension: {},
          draftedByCopilot: true,
        }),
      );

      expect(sent[0].body).toEqual({ notes: null, tension: {}, draftedByCopilot: true });
    });

    it("re-reads that course's notes after a save", async () => {
      await dispatch(endpoints.getAllyGuideNotes.initiate("track-1"));
      sent.length = 0;

      await dispatch(
        endpoints.saveAllyGuideNotes.initiate({ trackId: "track-1", notes: "x", tension: {} }),
      );

      await vi.waitFor(() =>
        expect(gets()).toContain("/api/v1/learn/admin/tracks/track-1/guide-notes"),
      );
    });

    it("asks Copilot for a draft with a POST and no body, and saves nothing", async () => {
      answers["POST /v1/course-copilot/tracks/track-1/ally-notes-draft"] = {
        draft: { notes: "n", tension: {}, draftedByCopilot: true },
      };

      const result = await dispatch(endpoints.draftAllyGuideNotes.initiate("track-1"));

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/course-copilot/tracks/track-1/ally-notes-draft",
      });
      expect(result.data.draft.notes).toBe("n");
    });
  });
});
