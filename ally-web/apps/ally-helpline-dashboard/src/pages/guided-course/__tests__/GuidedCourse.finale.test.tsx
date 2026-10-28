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
vi.mock("@components", () => ({ LoginDialog: () => null }));

import { baseAPI } from "../../../api/baseAPI";
import userSlice from "../../../reducer/userReducer";
import { GuideFixtureServer, installGuideFixture } from "../fixture/fixtureServer";
import { GuidedCourse } from "../GuidedCourse";

/**
 * The finale and the rest of M3's second half against the fixture: the
 * reveal and its doors, advice lines, thumbs on Ally's messages, memory
 * provenance and chapter scenes on reload.
 */
describe("GuidedCourse: finale, advice, thumbs, memory provenance, scenes on reload", () => {
  let uninstall: () => void;
  let server: GuideFixtureServer;

  beforeEach(() => {
    localStorage.clear();
    track.mockReset();
    const installed = installGuideFixture("fx-course", { delayScale: 0 });
    server = installed.server;
    uninstall = installed.uninstall;
  });

  afterEach(() => {
    uninstall();
  });

  const renderJourney = () => {
    const store = configureStore({
      reducer: { [baseAPI.reducerPath]: baseAPI.reducer, user: userSlice.reducer },
      middleware: getDefaultMiddleware => getDefaultMiddleware().concat(baseAPI.middleware),
    });
    return render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/journey/fx-course"]}>
          <Routes>
            <Route
              path="/journey/:trackId"
              element={<GuidedCourse trackId="fx-course" fixture />}
            />
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

  const requests = (pattern: RegExp) => server.requests.filter(r => pattern.test(r.path));

  describe("the finale", () => {
    it("opens by itself when it arrives: the map, the first move, the possible self, the noticings, three doors", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      send("finale-demo");

      const reveal = await screen.findByTestId("finale-reveal");
      expect(reveal).toHaveAttribute("data-hushed", "false");
      await waitFor(() => {
        expect(
          within(reveal).getByRole("heading", { name: "Looking back on Answering the first call" }),
        ).toHaveFocus();
      });
      expect(within(reveal).getByTestId("finale-map").children.length).toBeGreaterThan(0);
      const firstMove = within(reveal).getByTestId("finale-first-move");
      expect(firstMove).toHaveTextContent("I'd ask for their name and what's wrong.");
      expect(firstMove).toHaveTextContent("Ally asked: Meera goes quiet. What do you say first?");
      expect(reveal).toHaveTextContent("Someone callers trust in the first minute.");
      expect(within(reveal).getByTestId("finale-noticings").children).toHaveLength(2);
      expect(within(reveal).getByTestId("door-field_assignment")).toBeInTheDocument();
      expect(within(reveal).getByTestId("door-spaced_recall")).toBeInTheDocument();
      expect(within(reveal).getByTestId("door-mentor")).toBeInTheDocument();
      // Advice from finishers, quoted as text.
      expect(await within(reveal).findByTestId("advice-lines")).toHaveTextContent(
        "Let the silence sit longer than feels comfortable.",
      );
      expect(reveal).not.toHaveTextContent(/score|points|%/i);
      expect(track).toHaveBeenCalledWith(
        "guided_finale_opened",
        expect.objectContaining({ hushed: false }),
      );
    });

    it("answering the first move again goes to Ally in the learner's words", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      send("finale-demo");
      const firstMove = within(await screen.findByTestId("finale-reveal")).getByTestId(
        "finale-first-move",
      );
      fireEvent.change(within(firstMove).getByRole("textbox"), {
        target: { value: "I'd say I'm glad they called, and wait." },
      });
      fireEvent.click(within(firstMove).getByRole("button", { name: "Send to Ally" }));
      expect(within(firstMove).getByText("Sent to Ally.")).toBeInTheDocument();
      await waitFor(() =>
        expect(requests(/\/turns$/).at(-1)?.body).toMatchObject({
          text: "I'd say I'm glad they called, and wait.",
        }),
      );
      expect(track).toHaveBeenCalledWith(
        "guided_message_sent",
        expect.objectContaining({ source: "finale" }),
      );
    });

    it("the look-back door books a spaced-recall reminder a week out", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      send("finale-demo");
      const door = within(await screen.findByTestId("finale-reveal")).getByTestId(
        "door-spaced_recall",
      );
      fireEvent.click(within(door).getByRole("button", { name: /^Remind me/ }));
      expect(await within(door).findByTestId("recall-saved")).toBeInTheDocument();
      const put = requests(/\/appointment$/).at(-1);
      expect(put?.method).toBe("PUT");
      expect(put?.body).toMatchObject({ purpose: "spaced_recall", timezone: expect.any(String) });
      const at = new Date((put?.body as { at: string }).at).getTime();
      expect(at - Date.now()).toBeGreaterThan(6 * 86_400_000);
    });

    it("the mentor door takes one line, shows it's waiting for review, and lets it be rewritten", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      send("finale-demo");
      const door = within(await screen.findByTestId("finale-reveal")).getByTestId("door-mentor");
      const box = await within(door).findByRole("textbox");
      fireEvent.change(box, { target: { value: "Breathe before you answer." } });
      expect(door).toHaveTextContent("26/200");
      fireEvent.click(within(door).getByRole("button", { name: "Leave it" }));

      expect(await within(door).findByTestId("advice-status")).toHaveTextContent(
        "Waiting for review. You can still change it.",
      );
      expect(requests(/\/advice$/).find(r => r.method === "POST")?.body).toEqual({
        text: "Breathe before you answer.",
      });
      expect(within(door).getByRole("button", { name: "Update it" })).toBeInTheDocument();
      expect(within(door).getByRole("textbox")).toHaveValue("Breathe before you answer.");
    });

    it("hides the mentor door while the server says advice isn't available", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      send("finale-demo nomentor");
      const reveal = await screen.findByTestId("finale-reveal");
      expect(within(reveal).queryByTestId("door-mentor")).not.toBeInTheDocument();
      expect(within(reveal).getAllByRole("article")).toHaveLength(2);
    });

    it("a hushed finale is quiet, and its card in the conversation reopens it", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      send("finale-demo hushed");
      const reveal = await screen.findByTestId("finale-reveal");
      expect(reveal).toHaveAttribute("data-hushed", "true");
      expect(reveal).toHaveAttribute("data-atmosphere", "hushed");
      fireEvent.click(within(reveal).getByRole("button", { name: "Back to Ally" }));
      expect(screen.queryByTestId("finale-reveal")).not.toBeInTheDocument();

      const card = screen.getByRole("article", {
        name: "Looking back on Answering the first call",
      });
      fireEvent.click(within(card).getByRole("button", { name: /Open/ }));
      expect(await screen.findByTestId("finale-reveal")).toBeInTheDocument();
    });
  });

  describe("thumbs on Ally's messages", () => {
    it("a thumbs-down asks what missed, and both go to the server; analytics gets only the direction", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      send("How do I start a call?");
      await screen.findAllByText(/Good question\. The short answer/);

      const rows = await screen.findAllByTestId("message-feedback");
      const latest = rows.at(-1) as HTMLElement;
      fireEvent.click(within(latest).getByRole("button", { name: "Not helpful" }));
      await waitFor(() => expect(server.ratings.size).toBe(1));
      expect([...server.ratings.values()][0]).toMatchObject({ rating: -1 });
      expect(within(latest).getByRole("button", { name: "Not helpful" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      fireEvent.change(within(latest).getByPlaceholderText("What missed? (optional)"), {
        target: { value: "Too general for night shifts" },
      });
      fireEvent.click(within(latest).getByRole("button", { name: "Send" }));
      await waitFor(() =>
        expect([...server.ratings.values()][0]).toMatchObject({
          rating: -1,
          comment: "Too general for night shifts",
        }),
      );
      expect(track).toHaveBeenCalledWith(
        "guided_message_rated",
        expect.objectContaining({ rating: "down" }),
      );
      expect(JSON.stringify(track.mock.calls)).not.toContain("night shifts");
    });

    it("thumbs given earlier come back on reload, without a fresh thank-you", async () => {
      const first = renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      const row = (await screen.findAllByTestId("message-feedback")).at(-1) as HTMLElement;
      fireEvent.click(within(row).getByRole("button", { name: "Helpful" }));
      await waitFor(() => expect(server.ratings.size).toBe(1));
      first.unmount();

      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      const again = (await screen.findAllByTestId("message-feedback")).at(-1) as HTMLElement;
      expect(within(again).getByRole("button", { name: "Helpful" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(within(again).queryByText("Thanks.")).not.toBeInTheDocument();
      const bootstraps = requests(/\/bootstrap$/);
      expect(bootstraps.length).toBeGreaterThanOrEqual(2);
    });

    it("no thumbs in a CARE moment", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      send("care-demo");
      await screen.findByText(/touching something close to home/);
      expect(screen.queryAllByTestId("message-feedback")).toHaveLength(0);
    });
  });

  it("memory says why Ally remembers each thing, in the learner's own words", async () => {
    renderJourney();
    await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: /^Guidance:/ }));
    fireEvent.click(screen.getByRole("button", { name: "What Ally remembers" }));
    const panel = await screen.findByTestId("memory-panel");
    const [withSources, without] = await within(panel).findAllByTestId("memory-item");
    const why = within(withSources).getByTestId("memory-sources");
    expect(why).toHaveTextContent("Why Ally remembers this");
    expect(why).toHaveTextContent("Night shifts are when I feel least sure of myself.");
    expect(why).toHaveTextContent(/You said this on/);
    expect(within(without).queryByTestId("memory-sources")).not.toBeInTheDocument();
  });

  it("chapter scenes come back on reload, with the open chapter's title card", async () => {
    renderJourney();
    await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
    // Bootstrap carried the scene opened before the page loaded.
    const scenes = requests(/\/bootstrap$/);
    expect(scenes.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Opening a call").length).toBeGreaterThan(0);
    expect(screen.getByTestId("stage")).toHaveTextContent(/Chapter 1/);
  });
});
