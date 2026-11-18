import React from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

/**
 * Setup's checkup message matches the score (Q3-fast Part 3, B18): "You're ready" only above the
 * publish gate the server works out; below it, "X of Y questions need a fix".
 */
const h = vi.hoisted(() => ({ run: { current: null as unknown } }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRunDraftCheckupMutation: () => [vi.fn(), { isLoading: false }],
  useLazyGetCheckupRunQuery: () => [() => ({ unwrap: () => Promise.resolve(h.run.current) })],
  useAnswerGapMutation: () => [vi.fn(), { isLoading: false }],
  useMarkNotOfferedMutation: () => [vi.fn(), { isLoading: false }],
  useGetChatbotQuery: () => ({ data: undefined }),
  useGetBotPageQuery: () => ({ data: undefined }),
}));

// eslint-disable-next-line import/first
import { CheckupScreen } from "../CheckupScreen";
// eslint-disable-next-line import/first
import { COPY, fill } from "../copy";

const t = COPY.checkup;
const measure = (passed: number, total: number) => ({ passed, total });
const runView = (gate: unknown) => ({
  run: { id: "r1", status: "done", total: 14, done: 14, startedAt: "", finishedAt: "" },
  totals: {
    questions: 14,
    accuracy: measure(6, 14),
    sources: measure(6, 6),
    honesty: measure(0, 0),
    safety: measure(1, 1),
    gaps: 0,
  },
  results: [],
  gate,
});
const VIEW = { id: "d1", chatbotId: "b1" } as never;

beforeEach(() => {
  try {
    window.localStorage.setItem("ally.onboarding.d1.checkupRun", "r1");
  } catch {
    // no storage: the test still renders
  }
});

describe("the setup checkup's message", () => {
  it("says how many need a fix below the gate, never You're ready (38%, B18)", async () => {
    h.run.current = runView({
      ready: false,
      needFix: 8,
      questions: 14,
      otherPct: 38,
      safety: measure(1, 1),
      other: measure(5, 13),
    });
    render(<CheckupScreen view={VIEW} onContinue={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("checkup-need-fix")).toBeTruthy());
    expect(screen.getByTestId("checkup-need-fix").textContent).toBe(
      fill(t.needFix, { n: 8, total: 14 }),
    );
    expect(screen.queryByText(t.allClear)).toBeNull();
  });

  it("says You're ready above the gate", async () => {
    h.run.current = runView({
      ready: true,
      needFix: 0,
      questions: 14,
      otherPct: 100,
      safety: measure(1, 1),
      other: measure(13, 13),
    });
    render(<CheckupScreen view={VIEW} onContinue={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(t.allClear)).toBeTruthy());
    expect(screen.queryByTestId("checkup-need-fix")).toBeNull();
  });
});
