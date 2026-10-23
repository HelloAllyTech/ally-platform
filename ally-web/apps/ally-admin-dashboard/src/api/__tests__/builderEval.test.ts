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

// Imported from the files, not the "@api" barrel, for the same reason as the sibling tests.
import { baseAPI } from "../baseApi";
import { builderEvalAPI } from "../builderEval";

interface SentRequest {
  url: string;
  method: string;
  body: unknown;
}

describe("builderEvalAPI", () => {
  let store: ReturnType<typeof configureStore>;
  let sent: SentRequest[];
  /** What the stubbed server answers, by "METHOD path-suffix". Anything else is `{}`. */
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

  describe("gated prompts", () => {
    it("reads the codes the editor should not autosave", async () => {
      answers["GET /v1/builder/eval/gated-prompts"] = {
        promptCodes: ["builder_interviewer_system", "builder_platform_rules"],
      };
      const result = await dispatch(
        builderEvalAPI.endpoints.getBuilderEvalGatedPrompts.initiate(undefined),
      );

      expect(result.data).toEqual(["builder_interviewer_system", "builder_platform_rules"]);
      expect(sent[0]).toMatchObject({
        method: "GET",
        url: "/api/v1/builder/eval/gated-prompts",
      });
    });

    it("reads a malformed answer as none gated, never as a crash", async () => {
      answers["GET /v1/builder/eval/gated-prompts"] = { promptCodes: "builder_interviewer_system" };
      const result = await dispatch(
        builderEvalAPI.endpoints.getBuilderEvalGatedPrompts.initiate(undefined),
      );
      expect(result.data).toEqual([]);
    });

    it("drops entries that are not strings", async () => {
      answers["GET /v1/builder/eval/gated-prompts"] = { promptCodes: ["a", 3, null, "b"] };
      const result = await dispatch(
        builderEvalAPI.endpoints.getBuilderEvalGatedPrompts.initiate(undefined),
      );
      expect(result.data).toEqual(["a", "b"]);
    });
  });

  describe("fixtures", () => {
    it("exports every fixture, or the ones named", async () => {
      await dispatch(builderEvalAPI.endpoints.exportBuilderEvalFixtures.initiate(undefined));
      await dispatch(
        builderEvalAPI.endpoints.exportBuilderEvalFixtures.initiate({ ids: ["a", "b"] }),
      );

      expect(sent[0].url).toBe("/api/v1/builder/eval/fixtures/export");
      expect(sent[1].url).toBe("/api/v1/builder/eval/fixtures/export?ids=a%2Cb");
    });

    it("imports a pasted export as { fixtures }", async () => {
      answers["POST /v1/builder/eval/fixtures/import"] = { created: 2, updated: 1 };
      const fixtures = [{ name: "One" }, { name: "Two" }];
      const result = await dispatch(
        builderEvalAPI.endpoints.importBuilderEvalFixtures.initiate({ fixtures }),
      );

      expect(result.data).toEqual({ created: 2, updated: 1 });
      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/builder/eval/fixtures/import",
        body: { fixtures },
      });
    });

    it("cuts a session into a fixture, with the session in the path and not the body", async () => {
      await dispatch(
        builderEvalAPI.endpoints.createBuilderEvalFixtureFromSession.initiate({
          sessionId: "11111111-1111-4111-8111-111111111111",
          name: "Asked before reading",
          notes: "Reproduces session 2bc3a5cf",
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/builder/eval/fixtures/from-session/11111111-1111-4111-8111-111111111111",
        body: { name: "Asked before reading", notes: "Reproduces session 2bc3a5cf" },
      });
      expect(sent[0].body).not.toHaveProperty("sessionId");
    });

    it("saves a session from another environment as a fixture", async () => {
      const session = { id: "s1", title: "Digest email", messages: [] };
      await dispatch(
        builderEvalAPI.endpoints.createBuilderEvalFixtureFromExport.initiate({
          name: "Digest email",
          session,
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/builder/eval/fixtures/from-export",
        body: { name: "Digest email", session },
      });
    });

    it("patches a fixture by id, leaving the id out of the body", async () => {
      await dispatch(
        builderEvalAPI.endpoints.updateBuilderEvalFixture.initiate({
          id: "f1",
          active: false,
          checklist: [{ id: "C1", text: "Reuses Auto-improve", kind: "must" }],
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "PATCH",
        url: "/api/v1/builder/eval/fixtures/f1",
        body: {
          active: false,
          checklist: [{ id: "C1", text: "Reuses Auto-improve", kind: "must" }],
        },
      });
      expect(sent[0].body).not.toHaveProperty("id");
    });

    it("refetches the fixture list after an edit", async () => {
      store.dispatch(builderEvalAPI.endpoints.getBuilderEvalFixtures.initiate(undefined) as never);
      await vi.waitFor(() => expect(sent).toHaveLength(1));

      await dispatch(
        builderEvalAPI.endpoints.updateBuilderEvalFixture.initiate({ id: "f1", notes: "x" }),
      );

      await vi.waitFor(() =>
        expect(sent.filter(r => r.method === "GET" && r.url.endsWith("/fixtures"))).toHaveLength(2),
      );
    });

    it("deletes a fixture, and refetches suites too since its runs go with it", async () => {
      store.dispatch(builderEvalAPI.endpoints.getBuilderEvalFixtures.initiate(undefined) as never);
      store.dispatch(builderEvalAPI.endpoints.getBuilderEvalSuites.initiate(undefined) as never);
      await vi.waitFor(() => expect(sent).toHaveLength(2));

      await dispatch(builderEvalAPI.endpoints.deleteBuilderEvalFixture.initiate("f1"));

      expect(sent.find(r => r.method === "DELETE")?.url).toBe("/api/v1/builder/eval/fixtures/f1");
      await vi.waitFor(() => {
        expect(sent.filter(r => r.method === "GET" && r.url.endsWith("/fixtures"))).toHaveLength(2);
        expect(sent.filter(r => r.method === "GET" && r.url.includes("/eval/suites"))).toHaveLength(
          2,
        );
      });
    });
  });

  describe("suites", () => {
    it("starts a suite on the named fixtures", async () => {
      await dispatch(
        builderEvalAPI.endpoints.startBuilderEvalSuite.initiate({
          fixtureIds: ["f1", "f2"],
          repetitions: 3,
        }),
      );

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/builder/eval/suites",
        body: { fixtureIds: ["f1", "f2"], repetitions: 3 },
      });
    });

    it("asks for a bounded list of suites", async () => {
      await dispatch(builderEvalAPI.endpoints.getBuilderEvalSuites.initiate({ limit: 30 }));
      expect(sent[0].url).toBe("/api/v1/builder/eval/suites?limit=30");
    });

    it("reads one suite with its runs, and one run", async () => {
      await dispatch(builderEvalAPI.endpoints.getBuilderEvalSuite.initiate("s1"));
      await dispatch(builderEvalAPI.endpoints.getBuilderEvalRun.initiate("r1"));

      expect(sent[0].url).toBe("/api/v1/builder/eval/suites/s1");
      expect(sent[1].url).toBe("/api/v1/builder/eval/runs/r1");
    });

    it("refetches the list after a suite is started, so it appears running", async () => {
      store.dispatch(builderEvalAPI.endpoints.getBuilderEvalSuites.initiate(undefined) as never);
      await vi.waitFor(() => expect(sent).toHaveLength(1));

      await dispatch(builderEvalAPI.endpoints.startBuilderEvalSuite.initiate({}));

      await vi.waitFor(() =>
        expect(sent.filter(r => r.method === "GET" && r.url.includes("/eval/suites"))).toHaveLength(
          2,
        ),
      );
    });
  });

  describe("prompt candidates", () => {
    it("posts the candidate as it was built, including a cleared temperature", async () => {
      answers["POST /v1/builder/eval/prompt-candidates"] = { id: "s1", trigger: "prompt_gate" };
      const result = await dispatch(
        builderEvalAPI.endpoints.submitBuilderEvalPromptCandidate.initiate({
          promptCode: "builder_interviewer_system",
          content: "New text",
          provider: "anthropic",
          model: "claude-sonnet-5",
          temperature: null,
        }),
      );

      expect(result.data).toMatchObject({ id: "s1" });
      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/builder/eval/prompt-candidates",
        body: {
          promptCode: "builder_interviewer_system",
          content: "New text",
          provider: "anthropic",
          model: "claude-sonnet-5",
          temperature: null,
        },
      });
    });

    it("surfaces the server's readable message on a refusal", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ message: "Wait for its verdict." }), {
              status: 409,
              headers: { "Content-Type": "application/json" },
            }),
        ),
      );
      const result = await dispatch(
        builderEvalAPI.endpoints.submitBuilderEvalPromptCandidate.initiate({
          promptCode: "builder_interviewer_system",
          content: "New text",
        }),
      );

      expect(result.error).toMatchObject({
        status: 409,
        data: { message: "Wait for its verdict." },
      });
    });
  });

  describe("cancelling and publishing", () => {
    it("cancels a suite by id", async () => {
      await dispatch(builderEvalAPI.endpoints.cancelBuilderEvalSuite.initiate("s9"));

      expect(sent[0]).toMatchObject({
        method: "POST",
        url: "/api/v1/builder/eval/suites/s9/cancel",
      });
    });

    it("refreshes the prompts once when a suite turns up published", async () => {
      const invalidate = vi.spyOn(baseAPI.util, "invalidateTags");
      answers["GET /v1/builder/eval/suites"] = [
        { id: "published-1", status: "completed", publishedAt: "2026-10-21T12:00:00Z" },
        { id: "plain-1", status: "completed", publishedAt: null },
      ];

      await dispatch(builderEvalAPI.endpoints.getBuilderEvalSuites.initiate({ limit: 30 }));
      await dispatch(
        builderEvalAPI.endpoints.getBuilderEvalSuites.initiate(
          { limit: 31 },
          { forceRefetch: true },
        ),
      );

      const promptRefreshes = invalidate.mock.calls.filter(([tags]) =>
        JSON.stringify(tags).includes("prompts"),
      );
      expect(promptRefreshes).toHaveLength(1);
      invalidate.mockRestore();
    });
  });
});
