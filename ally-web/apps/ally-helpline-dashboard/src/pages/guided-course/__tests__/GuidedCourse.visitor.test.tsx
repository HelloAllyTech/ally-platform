import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `baseAPI` reads the API base once, at module load (see tracks.articleQuestion.test.ts).
vi.hoisted(() => {
  (import.meta.env as Record<string, string | undefined>).VITE_API_BASE_URL ||= "http://test.local";
});

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@hooks/useAnalytics", () => ({ useAnalytics: () => ({ track }) }));
// Signing in: the dialog stores a session and reports success, as the real one does.
vi.mock("@components", () => ({
  LoginDialog: ({ isOpen, onSuccess }: { isOpen: boolean; onSuccess: () => void }) =>
    isOpen ? (
      <button
        type="button"
        onClick={() => {
          localStorage.setItem("accessToken", "fx-session");
          onSuccess();
        }}
      >
        fake sign-in
      </button>
    ) : null,
}));

import { baseAPI } from "../../../api/baseAPI";
import { guideVisitorAPI } from "../../../api/guideVisitor";
import userSlice from "../../../reducer/userReducer";
import { FixtureOptions, GuideFixtureServer, installGuideFixture } from "../fixture/fixtureServer";
import { GuidedCourse } from "../GuidedCourse";

/**
 * A signed-out visitor against the fixture backend (M2): the landing, the
 * public routes, the allowance, the sign-in card, and the claim on sign-in.
 */
describe("GuidedCourse for a signed-out visitor", () => {
  let uninstall: (() => void) | null = null;
  let server: GuideFixtureServer;

  const install = (options: FixtureOptions = {}) => {
    uninstall?.();
    const installed = installGuideFixture("fx-course", {
      delayScale: 0,
      visitor: true,
      ...options,
    });
    server = installed.server;
    uninstall = installed.uninstall;
  };

  beforeEach(() => {
    localStorage.clear();
    track.mockReset();
    install();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  const renderJourney = () => {
    const store = configureStore({
      reducer: {
        [baseAPI.reducerPath]: baseAPI.reducer,
        [guideVisitorAPI.reducerPath]: guideVisitorAPI.reducer,
        user: userSlice.reducer,
      },
      middleware: getDefaultMiddleware =>
        getDefaultMiddleware().concat(baseAPI.middleware, guideVisitorAPI.middleware),
    });
    return render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/journey/fx-course"]}>
          <Routes>
            <Route
              path="/journey/:trackId"
              element={<GuidedCourse trackId="fx-course" fixture fixtureVisitor />}
            />
            <Route path="/course/:trackId" element={<div data-testid="classic-landing" />} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    );
  };

  const send = (text: string) => {
    const box = screen.getByLabelText("Message to Ally");
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  };

  const paths = () => server.requests.map(r => `${r.method} ${r.path}`);

  it("lands on the first ten seconds: the story line, first-move replies, course card and disclosure", async () => {
    renderJourney();
    const landing = await screen.findByTestId("visitor-landing", {}, { timeout: 3000 });

    expect(await within(landing).findByRole("heading", { level: 1 })).toHaveTextContent(
      /Meera has rung off twice/,
    );
    const chips = within(screen.getByTestId("landing-chips")).getAllByRole("button");
    expect(chips.map(c => c.textContent)).toEqual([
      "I'm glad you called. Take your time.",
      "What's been happening today?",
      "Can I take your name first?",
    ]);
    const card = screen.getByTestId("landing-course-card");
    expect(card).toHaveTextContent("About 33 min");
    expect(card).toHaveTextContent("Reflect what you hear before you advise");
    expect(
      within(screen.getByTestId("landing-disclosure")).getByRole("link", {
        name: "How Ally works and your data",
      }),
    ).toHaveAttribute("href", "/privacy");

    // A visit, not a conversation yet: no thread until the first message.
    expect(localStorage.getItem("allyGuideVisitor")).toBe("fx-visitor-token");
    expect(paths()).toContain("POST /v1/guide/public/visitors");
    expect(paths()).not.toContain("POST /v1/guide/public/tracks/fx-course/threads");
    // Voice needs sign-in (D1); the composer is there.
    expect(screen.queryByRole("button", { name: /voice/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Message to Ally")).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith(
      "guided_journey_opened",
      expect.objectContaining({ identity: "visitor" }),
    );
  });

  it("a first move opens the visitor's thread and Ally replies; the counter shows at two left", async () => {
    renderJourney();
    await screen.findByTestId("visitor-landing", {}, { timeout: 3000 });

    fireEvent.click(await screen.findByRole("button", { name: "What's been happening today?" }));

    expect(await screen.findByText(/Good question\. The short answer/)).toBeInTheDocument();
    expect(paths()).toContain("POST /v1/guide/public/tracks/fx-course/threads");
    expect(paths()).toContain("POST /v1/guide/public/threads/fx-thread/turns");
    expect(paths().some(p => p.startsWith("POST /v1/guide/threads/"))).toBe(false);
    // Three left: still quiet.
    expect(screen.queryByTestId("allowance-note")).not.toBeInTheDocument();

    send("And then?");
    expect(await screen.findByTestId("allowance-note")).toHaveTextContent(
      "2 messages left before sign-in",
    );
    expect(track).toHaveBeenCalledWith(
      "guided_message_sent",
      expect.objectContaining({ source: "landing" }),
    );
  });

  it("opening a course item asks a visitor to sign in", async () => {
    renderJourney();
    await screen.findByTestId("visitor-landing", {}, { timeout: 3000 });

    // With a story the chips are the first move; "Let's start" is typed here.
    send("Let's start");

    const article = await screen.findByRole("article", { name: "Opening a call" });
    fireEvent.click(within(article).getAllByRole("button")[0]);

    expect(screen.getByText("fake sign-in")).toBeInTheDocument();
    expect(screen.queryByTestId("shelf")).not.toBeInTheDocument();
    expect(track).toHaveBeenCalledWith(
      "guided_sign_in_started",
      expect.objectContaining({ source: "item" }),
    );
    // A visitor's cards never post card events (those are a learner's).
    expect(paths().some(p => p.includes("/cards/"))).toBe(false);
  });

  it("out of messages: the sign-in card takes the composer's place", async () => {
    install({ allowance: 1 });
    renderJourney();
    await screen.findByTestId("visitor-landing", {}, { timeout: 3000 });

    send("Hello");

    const card = await screen.findByTestId("sign-in-card");
    expect(card).toHaveAttribute("data-reason", "allowance");
    expect(card).toHaveTextContent("Sign in to keep going");
    expect(screen.queryByLabelText("Message to Ally")).not.toBeInTheDocument();
    expect(screen.queryByTestId("failure-notice")).not.toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("fake sign-in")).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith(
      "guided_sign_in_started",
      expect.objectContaining({ source: "allowance" }),
    );
  });

  it("paused: nothing is stored, and signing in claims the conversation and gives the words back", async () => {
    renderJourney();
    await screen.findByTestId("visitor-landing", {}, { timeout: 3000 });
    send("Hello Ally");
    await screen.findByText(/Good question\. The short answer/);

    send("paused-demo, what next?");

    const card = await screen.findByTestId("sign-in-card");
    expect(card).toHaveAttribute("data-reason", "paused");
    expect(card).toHaveTextContent("I'm taking a short break");
    // The refused words left the feed (the server stored nothing).
    expect(screen.queryByText("paused-demo, what next?")).not.toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Sign in" }));
    fireEvent.click(screen.getByText("fake sign-in"));

    // The claim: the signed-in thread call, once, with the visitor token.
    await waitFor(() => expect(paths()).toContain("POST /v1/guide/tracks/fx-course/threads"));
    expect(
      await screen.findByText(/You're signed in, so this conversation is yours now/),
    ).toBeInTheDocument();
    // The conversation so far is still there, and the words are back in the composer.
    expect(screen.getByText("Hello Ally")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Message to Ally")).toHaveValue("paused-demo, what next?"),
    );
    expect(screen.queryByTestId("sign-in-card")).not.toBeInTheDocument();
    expect(localStorage.getItem("allyGuideVisitor")).toBeNull();
    expect(track).toHaveBeenCalledWith(
      "guided_visitor_claimed",
      expect.objectContaining({ claim_outcome: "claimed" }),
    );
    // From here it's the learner's routes.
    send("Thanks");
    await waitFor(() => expect(paths()).toContain("POST /v1/guide/threads/fx-thread/turns"));
  });

  it("signed in to an account without the course: the conversation stays, with the access card", async () => {
    install({ claimDenied: true, allowance: 1 });
    renderJourney();
    await screen.findByTestId("visitor-landing", {}, { timeout: 3000 });
    send("Hello Ally");
    await screen.findByText(/Good question\. The short answer/);

    const card = await screen.findByTestId("sign-in-card");
    fireEvent.click(within(card).getByRole("button", { name: "Sign in" }));
    fireEvent.click(screen.getByText("fake sign-in"));

    expect(await screen.findByTestId("access-denied-card")).toBeInTheDocument();
    expect(screen.getByText("Hello Ally")).toBeInTheDocument();
    expect(screen.getAllByText(/Good question\. The short answer/).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Message to Ally")).not.toBeInTheDocument();
    expect(screen.queryByTestId("journey-denied")).not.toBeInTheDocument();
    // Not claimed: the visitor token is kept.
    expect(localStorage.getItem("allyGuideVisitor")).toBe("fx-visitor-token");
  });
});
