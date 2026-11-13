import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ logs: vi.fn() }));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@api", async importOriginal => {
  const { ok, MODELS } = await import("./consoleFixtures");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useGetDebriefRunLogsQuery: () => h.logs(),
    useGetDebriefModelsQuery: () => ok(MODELS),
  };
});

/* eslint-disable import/first */
import { AgentLogsPage } from "../session/AgentLogsPage";
import { ok } from "./consoleFixtures";
/* eslint-enable import/first */

const WRITER_PROMPT = "You are the Writer. Write kindly.";

const LOGS = {
  runId: "7f3a2c11-0000-0000-0000-000000000000",
  loggedFrom: "2026-11-14",
  run: {
    sessionId: "sess-1",
    scenarioTitle: "Exam stress, first call",
    status: "published",
    recipeKey: "standard",
    releaseVersion: 5,
    language: "en",
    costUsd: 0.09,
    seconds: 134,
  },
  entries: [
    {
      seq: 1,
      kind: "code",
      step: "plan",
      round: null,
      startedAt: "2026-11-14T08:32:05Z",
      model: null,
      fallbackModel: null,
      prompt: null,
      input: { learnerTurns: 8, ceilingUsd: 0.5, orchestratorEnabled: false },
      output: { recipe: "standard", why: "A practice session.", next: ["safety_reader"] },
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      ms: 1,
      retries: 0,
      error: null,
      attention: false,
    },
    {
      seq: 2,
      kind: "model",
      step: "writer",
      round: 0,
      startedAt: "2026-11-14T08:32:53Z",
      model: "gemini-3-flash-preview",
      fallbackModel: null,
      prompt: {
        code: "debrief_writer_system",
        version: 3,
        href: "/manage-prompts?prompt=debrief_writer_system&version=3",
        inlined: true,
      },
      input: "{{system_prompt}}\n\nSESSION LANGUAGE: en\n[turn 5] CLIENT: what's even the point",
      output: { cards: { opening: "You built warmth quickly." }, reasoning: "Led with risk." },
      tokensIn: 5320,
      tokensOut: 690,
      costUsd: 0.018,
      ms: 15000,
      retries: 0,
      error: null,
      attention: false,
    },
    {
      seq: 3,
      kind: "code",
      step: "checks",
      round: 0,
      startedAt: "2026-11-14T08:33:08Z",
      model: null,
      fallbackModel: null,
      prompt: null,
      input: { language: "en" },
      output: {
        failures: [{ code: "quote_not_in_turn", section: "work_on_this[0]", detail: "x" }],
      },
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      ms: 10,
      retries: 0,
      error: null,
      attention: true,
    },
  ],
  prompts: { "debrief_writer_system@3": WRITER_PROMPT },
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/debriefs/sessions/run-1/logs?cat=needs"]}>
      <Routes>
        <Route path="/debriefs/sessions/:runId/logs" element={<AgentLogsPage />} />
      </Routes>
    </MemoryRouter>,
  );

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  h.logs.mockReturnValue(ok(LOGS));
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

describe("Agent logs page", () => {
  it("renders one card per entry in order, with plain names and the run summary", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Agent logs");
    expect(screen.getByRole("link", { name: /Back to the session/ })).toHaveAttribute(
      "href",
      "/debriefs/sessions/run-1?cat=needs",
    );
    const summary = screen.getByTestId("agent-logs-summary");
    expect(summary).toHaveTextContent(
      "Exam stress, first call · run 7f3a2c11 · version v5 · 3 entries · $0.09 · 2 min 14 s",
    );
    expect(summary).toHaveAttribute("title", summary.textContent);
    const cards = screen.getAllByTestId("log-entry");
    expect(cards.map(c => within(c).getByText(/^(Plan|Writer|Rule checks)$/).textContent)).toEqual([
      "Plan",
      "Writer",
      "Rule checks",
    ]);
    // The model card: model, prompt link, Sent and Reply side by side.
    const writer = cards[1];
    expect(writer).toHaveTextContent("5,320 in / 690 out tokens");
    expect(within(writer).getByRole("link", { name: "Writer's prompt v3" })).toHaveAttribute(
      "href",
      "/manage-prompts?prompt=debrief_writer_system&version=3",
    );
    expect(within(writer).getByTestId("log-input")).toHaveTextContent(
      "[System prompt: Writer's prompt v3]",
    );
    expect(within(writer).getByTestId("log-input")).toHaveTextContent("[turn 5] CLIENT");
    expect(within(writer).getByTestId("log-output")).toHaveTextContent(
      '"opening": "You built warmth quickly."',
    );
    expect(screen.getByText(/Full agent logs are kept for runs from 14 Nov 2026/)).toBeTruthy();
  });

  it("marks entries that need attention with the left edge", () => {
    renderPage();
    const cards = screen.getAllByTestId("log-entry");
    expect(cards.map(c => c.dataset.attention)).toEqual(["false", "false", "true"]);
    expect(cards[2]).toHaveTextContent("Needs attention");
    expect(cards[2].style.borderLeft).toContain("3px solid");
  });

  it("shows no raw codes in the readable view; Raw JSON does", () => {
    renderPage();
    const checks = screen.getAllByTestId("log-entry")[2];
    expect(within(checks).getByTestId("log-output")).toHaveTextContent("Quote not in turn");
    expect(within(checks).getByTestId("log-output")).not.toHaveTextContent("quote_not_in_turn");
    const plan = screen.getAllByTestId("log-entry")[0];
    expect(within(plan).getByTestId("log-input")).toHaveTextContent("Learner turns: 8");
    expect(within(plan).getByTestId("log-output")).toHaveTextContent("Next: Safety reader");

    fireEvent.click(screen.getByRole("button", { name: "Raw JSON" }));
    expect(screen.getByRole("button", { name: "Raw JSON" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      within(screen.getAllByTestId("log-entry")[2]).getByTestId("log-output"),
    ).toHaveTextContent('"code": "quote_not_in_turn"');
    expect(
      within(screen.getAllByTestId("log-entry")[0]).getByTestId("log-input"),
    ).toHaveTextContent('"learnerTurns": 8');
  });

  it("System prompt · Show expands the version's text from the Skills Store", () => {
    renderPage();
    const writer = screen.getAllByTestId("log-entry")[1];
    const line = within(writer).getByTestId("system-prompt");
    expect(line).toHaveTextContent("System prompt: Writer's prompt v3 · Show");
    expect(within(writer).queryByTestId("system-prompt-text")).toBeNull();
    fireEvent.click(within(line).getByRole("button", { name: "Show" }));
    expect(within(writer).getByTestId("system-prompt-text")).toHaveTextContent(WRITER_PROMPT);
  });

  it("search filters the entries and highlights the matches", () => {
    renderPage();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the log" }), {
      target: { value: "point" },
    });
    const cards = screen.getAllByTestId("log-entry");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("Writer");
    expect(within(cards[0]).getAllByTestId("log-match")[0]).toHaveTextContent("point");
    expect(screen.getByTestId("agent-logs-toolbar")).toHaveTextContent("1 entry matches");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search the log" }), {
      target: { value: "nothing like this" },
    });
    expect(screen.queryAllByTestId("log-entry")).toHaveLength(0);
    expect(screen.getByText('No entry mentions "nothing like this".')).toBeTruthy();
  });

  it("Copy puts the exact message on the clipboard, the system prompt's text put back", async () => {
    renderPage();
    const writer = screen.getAllByTestId("log-entry")[1];
    await act(async () => {
      fireEvent.click(within(writer).getByRole("button", { name: "Copy: Sent" }));
    });
    expect(writeText).toHaveBeenCalledWith(
      `${WRITER_PROMPT}\n\nSESSION LANGUAGE: en\n[turn 5] CLIENT: what's even the point`,
    );
    expect(within(writer).getByRole("button", { name: "Copy: Sent" })).toHaveTextContent("Copied");
    await act(async () => {
      fireEvent.click(within(writer).getByRole("button", { name: "Copy: Reply" }));
    });
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining('"reasoning": "Led with risk."'),
    );
  });

  it("keeps the toolbar on one row: search shrinks, the view switch stays, the note truncates", () => {
    renderPage();
    const bar = screen.getByTestId("agent-logs-toolbar");
    expect(bar.className).toMatch(/\bsticky\b/);
    expect(bar.className).toMatch(/\bflex-nowrap\b/);
    expect(within(bar).getByText(/Ally team only/).className).toMatch(/\btruncate\b/);
  });

  it("a run from before logs were kept says from when they are", () => {
    h.logs.mockReturnValue(ok({ ...LOGS, entries: [], prompts: {} }));
    renderPage();
    expect(screen.getByText("No agent logs for this run")).toBeTruthy();
    expect(screen.getByText("Full agent logs are kept for runs from 14 Nov 2026.")).toBeTruthy();
  });

  it("loading and error states", () => {
    h.logs.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { unmount } = renderPage();
    expect(screen.getByTestId("ally-loading")).toBeTruthy();
    unmount();
    h.logs.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 403 },
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Agent logs are for the Ally team only.")).toBeTruthy();
  });
});
