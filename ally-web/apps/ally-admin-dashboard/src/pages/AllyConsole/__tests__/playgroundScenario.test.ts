import { describe, expect, it } from "vitest";

import {
  buildBody,
  historyFor,
  PaneTurn,
  parseProgress,
  Scenario,
  sumUsage,
} from "../playgroundScenario";

const result = (reply: string) =>
  ({ reply, usage: [], toolCalls: [], situation: "", costUsd: 0, latencyMs: 1 }) as never;

const done = (id: number, learner: string, reply: string): PaneTurn => ({
  id,
  learner,
  status: "done",
  result: result(reply),
});

const scenario: Scenario = {
  trackId: "t-1",
  tenantId: "org-1",
  progress: 3,
  mode: "CARE",
  guidance: "drive",
  channel: "voice",
  visitor: false,
};

describe("parseProgress", () => {
  it("reads whole numbers up to 500, and empty as 0 (just starting)", () => {
    expect(parseProgress("0")).toBe(0);
    expect(parseProgress("")).toBe(0);
    expect(parseProgress(" 12 ")).toBe(12);
    expect(parseProgress("500")).toBe(500);
  });

  it("refuses anything else", () => {
    for (const text of ["501", "-1", "1.5", "abc", "1e2"]) {
      expect(parseProgress(text)).toBeNull();
    }
  });
});

describe("historyFor", () => {
  it("interleaves the learner's lines with this release's own replies", () => {
    expect(historyFor([done(1, "hello", "Hi!"), done(2, "stuck", "Let's look")])).toEqual([
      { role: "learner", text: "hello" },
      { role: "ally", text: "Hi!" },
      { role: "learner", text: "stuck" },
      { role: "ally", text: "Let's look" },
    ]);
  });

  it("leaves out a turn that is running or failed, so no hole of its own making", () => {
    const turns: PaneTurn[] = [
      done(1, "hello", "Hi!"),
      { id: 2, learner: "lost", status: "error", error: "x" },
      { id: 3, learner: "waiting", status: "running" },
    ];

    expect(historyFor(turns)).toEqual([
      { role: "learner", text: "hello" },
      { role: "ally", text: "Hi!" },
    ]);
  });

  it("adds only Ally's reply for an action sent alone", () => {
    expect(historyFor([done(1, "", "Welcome")])).toEqual([{ role: "ally", text: "Welcome" }]);
  });

  it("keeps only the last 20, the most the server reads", () => {
    const turns = Array.from({ length: 15 }, (_, index) => done(index, `l${index}`, `a${index}`));

    const history = historyFor(turns);

    expect(history).toHaveLength(20);
    expect(history[history.length - 1]).toEqual({ role: "ally", text: "a14" });
  });
});

describe("buildBody", () => {
  it("sends the whole scenario for a signed-in learner", () => {
    expect(buildBody(scenario, "rel-1", "hello", undefined, [])).toEqual({
      releaseId: "rel-1",
      trackId: "t-1",
      message: "hello",
      mode: "CARE",
      guidance: "drive",
      channel: "voice",
      history: [],
      progress: 3,
      tenantId: "org-1",
    });
  });

  it("leaves progress and the organisation out for a visitor, who has neither", () => {
    const body = buildBody({ ...scenario, visitor: true }, "rel-1", "hi", undefined, []);

    expect(body.visitor).toBe(true);
    expect(body).not.toHaveProperty("progress");
    expect(body).not.toHaveProperty("tenantId");
  });

  it("leaves the organisation out when none is chosen, and adds a card action when there is one", () => {
    const body = buildBody({ ...scenario, tenantId: "" }, "rel-1", "", "start", []);

    expect(body).not.toHaveProperty("tenantId");
    expect(body.intent).toBe("start");
  });
});

describe("sumUsage", () => {
  it("totals tokens across the passes of a turn, tolerating missing figures", () => {
    expect(
      sumUsage([{ inputTokens: 100, outputTokens: 20, cachedTokens: 50 }, { inputTokens: 10 }]),
    ).toEqual({ input: 110, output: 20, cached: 50 });
    expect(sumUsage(undefined)).toEqual({ input: 0, output: 0, cached: 0 });
  });
});
