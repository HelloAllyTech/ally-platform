import { configureStore } from "@reduxjs/toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same cycle-breaking mocks as the sibling api tests.
vi.mock("@store", () => ({
  store: { dispatch: vi.fn(), getState: vi.fn(), subscribe: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@components", () => ({
  cellTypes: new Proxy({}, { get: (_target, prop) => prop }),
}));

import { allyGuidePipelineAPI } from "../allyGuidePipeline";
import allyGuidePipelineSource from "../allyGuidePipeline.ts?raw";
import baseApiSource from "../baseApi.ts?raw";
import { baseAPI } from "../baseApi";

interface SentRequest {
  url: string;
  method: string;
  body: unknown;
}

const BASE = "/api/v1/guide/admin";

describe("allyGuidePipelineAPI", () => {
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
  const endpoints = allyGuidePipelineAPI.endpoints;

  it("registers every tag it uses in baseApi's tagTypes", () => {
    const used = [...allyGuidePipelineSource.matchAll(/TAG_TYPES\.(ALLY_GUIDE_[A-Z_]+)/g)].map(
      match => match[1],
    );
    expect(used.length).toBeGreaterThan(0);
    for (const tag of new Set(used)) {
      expect(baseApiSource, `${tag} missing from baseApi tagTypes`).toContain(`TAG_TYPES.${tag}`);
    }
  });

  describe("delegation", () => {
    it("reads the stage, and sets it with a trimmed reason, dropping a blank one", async () => {
      await dispatch(endpoints.getAllyGuideDelegation.initiate());
      await dispatch(
        endpoints.setAllyGuideDelegation.initiate({ stage: 2, reason: "  looks ready " }),
      );
      await dispatch(endpoints.setAllyGuideDelegation.initiate({ stage: 1, reason: "   " }));

      expect(sent[0]).toMatchObject({ method: "GET", url: `${BASE}/delegation` });
      const puts = sent.filter(request => request.method === "PUT");
      expect(puts[0]).toMatchObject({
        url: `${BASE}/delegation`,
        body: { stage: 2, reason: "looks ready" },
      });
      expect(puts[1].body).toEqual({ stage: 1 });
    });

    it("re-reads the stage and the canary's decision after it changes", async () => {
      await dispatch(endpoints.getAllyGuideDelegation.initiate());
      await dispatch(endpoints.getAllyGuideCanaryDecision.initiate());
      sent.length = 0;

      await dispatch(endpoints.setAllyGuideDelegation.initiate({ stage: 1 }));

      await vi.waitFor(() => {
        expect(gets()).toContain(`${BASE}/delegation`);
        expect(gets()).toContain(`${BASE}/canary/decision`);
      });
    });
  });

  describe("curator and lessons", () => {
    it("starts the curator with a POST and no body, and reads the playbook", async () => {
      await dispatch(endpoints.runAllyGuideCurator.initiate());
      await dispatch(endpoints.getAllyGuidePlaybook.initiate());

      expect(sent[0]).toMatchObject({ method: "POST", url: `${BASE}/curator/run` });
      expect(sent[1]).toMatchObject({ method: "GET", url: `${BASE}/playbook` });
    });

    it("lists lessons by status, scope and limit, leaving absent ones off", async () => {
      await dispatch(
        endpoints.getAllyGuideLessons.initiate({
          status: "quarantined",
          scope: "course",
          limit: 200,
        }),
      );
      await dispatch(endpoints.getAllyGuideLessons.initiate());

      expect(sent[0].url).toBe(`${BASE}/lessons?status=quarantined&scope=course&limit=200`);
      expect(sent[1].url).toBe(`${BASE}/lessons`);
    });

    it("approves, rejects and retires on each lesson's own route, with the note only when written", async () => {
      await dispatch(endpoints.approveAllyGuideLesson.initiate({ id: "l-1", notes: " ok " }));
      await dispatch(endpoints.rejectAllyGuideLesson.initiate({ id: "l-1", notes: "" }));
      await dispatch(endpoints.retireAllyGuideLesson.initiate({ id: "l-2" }));

      const posts = sent.filter(request => request.method === "POST");
      expect(posts[0]).toMatchObject({ url: `${BASE}/lessons/l-1/approve`, body: { notes: "ok" } });
      expect(posts[1]).toMatchObject({ url: `${BASE}/lessons/l-1/reject`, body: {} });
      expect(posts[2]).toMatchObject({ url: `${BASE}/lessons/l-2/retire`, body: {} });
    });

    it("re-reads the lessons, the playbook and the audit after a decision", async () => {
      await dispatch(endpoints.getAllyGuideLessons.initiate({ status: "quarantined" }));
      await dispatch(endpoints.getAllyGuidePlaybook.initiate());
      await dispatch(endpoints.getAllyGuideLearningAudit.initiate({ limit: 100 }));
      sent.length = 0;

      await dispatch(endpoints.approveAllyGuideLesson.initiate({ id: "l-1" }));

      await vi.waitFor(() => {
        expect(gets()).toContain(`${BASE}/lessons?status=quarantined`);
        expect(gets()).toContain(`${BASE}/playbook`);
        expect(gets()).toContain(`${BASE}/learning/audit?limit=100`);
      });
    });
  });

  describe("a release's trail, shadow and the canary", () => {
    it("reads a release's trail by id, and the shadow reports optionally of one release", async () => {
      await dispatch(endpoints.getAllyGuideReleaseTrail.initiate("rel-4"));
      await dispatch(endpoints.getAllyGuideShadowReports.initiate({ releaseId: "rel-4" }));
      await dispatch(endpoints.getAllyGuideShadowReports.initiate());
      await dispatch(endpoints.getAllyGuideShadowReport.initiate("sh-1"));

      expect(sent.map(request => request.url)).toEqual([
        `${BASE}/releases/rel-4/trail`,
        `${BASE}/shadow-reports?releaseId=rel-4`,
        `${BASE}/shadow-reports`,
        `${BASE}/shadow-reports/sh-1`,
      ]);
    });

    it("starts a shadow on the release's own route, then re-reads the reports and the trail", async () => {
      await dispatch(endpoints.getAllyGuideShadowReports.initiate({ releaseId: "rel-4" }));
      await dispatch(endpoints.getAllyGuideReleaseTrail.initiate("rel-4"));
      sent.length = 0;

      await dispatch(endpoints.startAllyGuideShadow.initiate("rel-4"));

      expect(sent[0]).toMatchObject({ method: "POST", url: `${BASE}/releases/rel-4/shadow` });
      await vi.waitFor(() => {
        expect(gets()).toContain(`${BASE}/shadow-reports?releaseId=rel-4`);
        expect(gets()).toContain(`${BASE}/releases/rel-4/trail`);
      });
    });

    it("reads the canary's decision, and re-reads it after a canary or promotion changes the release tag", async () => {
      answers["GET /v1/guide/admin/canary/decision"] = { canary: null };
      await dispatch(endpoints.getAllyGuideCanaryDecision.initiate());
      sent.length = 0;

      await dispatch(baseAPI.util.invalidateTags(["allyGuideReleases" as never]));

      await vi.waitFor(() => expect(gets()).toContain(`${BASE}/canary/decision`));
    });
  });

  describe("synthetic monitoring", () => {
    it("lists the nights with a limit, reads one, and starts one with a POST", async () => {
      await dispatch(endpoints.getAllyGuideSyntheticRuns.initiate({ limit: 30 }));
      await dispatch(endpoints.getAllyGuideSyntheticRun.initiate("sr-1"));
      await dispatch(endpoints.runAllyGuideSynthetic.initiate());

      expect(sent.map(request => `${request.method} ${request.url}`)).toEqual([
        `GET ${BASE}/synthetic-runs?limit=30`,
        `GET ${BASE}/synthetic-runs/sr-1`,
        `POST ${BASE}/synthetic-runs`,
      ]);
    });
  });

  describe("the Ally analytics", () => {
    it("reads each of the four with the window, and only what is set", async () => {
      await dispatch(endpoints.getAllyGuideAnalyticsSummary.initiate({ range: "90d" }));
      await dispatch(
        endpoints.getAllyGuideAnalyticsWeekly.initiate({ range: "30d", tenantId: "t-1" }),
      );
      await dispatch(endpoints.getAllyGuideEngagementVsLearning.initiate({ range: "12m" }));
      await dispatch(endpoints.getAllyGuideAnalyticsCourses.initiate({}));

      expect(sent.map(request => request.url)).toEqual([
        "/api/v1/analytics/ally-guide/summary?range=90d",
        "/api/v1/analytics/ally-guide/weekly?range=30d&tenantId=t-1",
        "/api/v1/analytics/ally-guide/engagement-vs-learning?range=12m",
        "/api/v1/analytics/ally-guide/courses",
      ]);
    });

    it("sends a from and to only as a pair", async () => {
      await dispatch(endpoints.getAllyGuideAnalyticsSummary.initiate({ from: "2026-09-01" }));
      await dispatch(
        endpoints.getAllyGuideAnalyticsWeekly.initiate({ from: "2026-09-01", to: "2026-09-30" }),
      );

      expect(sent[0].url).toBe("/api/v1/analytics/ally-guide/summary");
      expect(sent[1].url).toBe("/api/v1/analytics/ally-guide/weekly?from=2026-09-01&to=2026-09-30");
    });
  });
});
