import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { installGuideFixture } from "../fixture/fixtureServer";
import { GuidedCourse } from "../GuidedCourse";

/**
 * The whole journey against the fixture backend: real RTK Query calls, the
 * real fetch-based SSE hook, the real reducers. Only the network is faked.
 */
describe("GuidedCourse against the fixture stream", () => {
  let uninstall: () => void;

  beforeEach(() => {
    localStorage.clear();
    track.mockReset();
    uninstall = installGuideFixture("fx-course", { delayScale: 0 }).uninstall;
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
            <Route
              path="/track/:trackId/item/:itemId"
              element={<div data-testid="classic-item" />}
            />
            <Route path="/track/:trackId" element={<div data-testid="classic-course" />} />
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

  it("boots from bootstrap, shows the history, and streams a reply to a message", async () => {
    renderJourney();
    const shell = await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
    expect(shell).toHaveAttribute("data-atmosphere", "bright");
    expect(screen.getByText(/Hi, I'm Ally, an AI guide/)).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Opening a call" })).toBeInTheDocument();
    expect(screen.getAllByText("Ally · AI guide").length).toBeGreaterThan(0);

    send("How do I start a call?");

    expect(await screen.findByText("How do I start a call?")).toBeInTheDocument();
    expect(await screen.findByText(/Good question\. The short answer/)).toBeInTheDocument();
    // The learner's echo was swapped for the stored message, not duplicated.
    expect(screen.getAllByText("How do I start a call?")).toHaveLength(1);
    expect(track).toHaveBeenCalledWith(
      "guided_message_sent",
      expect.objectContaining({ source: "typed" }),
    );
    // Never the learner's words in analytics.
    expect(JSON.stringify(track.mock.calls)).not.toContain("How do I start");
  });

  it("continues with the dock: the next card arrives in the conversation", async () => {
    renderJourney();
    await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
    const dock = await screen.findByTestId("next-step-dock");
    expect(dock).toHaveTextContent("Continue · Opening moves · 3 min");

    fireEvent.click(dock);

    expect(await screen.findByRole("article", { name: "Opening moves" })).toBeInTheDocument();
    expect(screen.getByText(/Next: Opening moves/)).toBeInTheDocument();
  });

  it("in a crisis: the still room, the pinned crisis card with call buttons, nothing competing", async () => {
    renderJourney();
    await screen.findByTestId("journey-shell", {}, { timeout: 3000 });

    send("crisis-demo");

    const card = await screen.findByTestId("crisis-card");
    expect(screen.getByTestId("journey-shell")).toHaveAttribute("data-atmosphere", "still");
    expect(within(card).getByTestId("crisis-message")).toHaveFocus();
    expect(within(card).getByRole("link", { name: /14416/ })).toHaveAttribute("href", "tel:14416");
    expect(within(card).getByRole("link", { name: /112/ })).toHaveAttribute("href", "tel:112");
    expect(screen.queryByTestId("stage")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reply-verbs")).not.toBeInTheDocument();
    expect(screen.queryByTestId("next-step-dock")).not.toBeInTheDocument();
    // The composer stays: the learner can still write.
    expect(screen.getByLabelText("Message to Ally")).toBeInTheDocument();
    // Nothing about the crisis reaches analytics.
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/crisis/);

    fireEvent.click(within(card).getByRole("button", { name: "I need help now" }));
    expect(within(card).getByText(/Please call one of the numbers above/)).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "I'm safe right now" }));
    await waitFor(() =>
      expect(screen.getByTestId("journey-shell")).toHaveAttribute("data-atmosphere", "hushed"),
    );
    expect(await screen.findByTestId("support-chip")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Breathe with me" })).toBeInTheDocument();
  });

  it("a failed turn keeps the message and offers Retry in Ally's voice", async () => {
    renderJourney();
    await screen.findByTestId("journey-shell", {}, { timeout: 3000 });

    send("fail-demo please");

    const notice = await screen.findByTestId("failure-notice");
    expect(notice).toHaveTextContent("Something went wrong on my side.");
    expect(screen.getByText("fail-demo please")).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith(
      "guided_failure_shown",
      expect.objectContaining({ failure_code: "internal_error" }),
    );
    await act(async () => {
      fireEvent.click(within(notice).getByRole("button", { name: "Try again" }));
    });
    await waitFor(() => expect(screen.getAllByText("fail-demo please").length).toBeGreaterThan(0));
  });

  it("an outage points to the classic view at the current item", async () => {
    renderJourney();
    await screen.findByTestId("journey-shell", {}, { timeout: 3000 });

    send("provider-demo");

    const notice = await screen.findByTestId("failure-notice");
    expect(notice).toHaveTextContent("You can keep going in the classic view.");
    fireEvent.click(within(notice).getByRole("button", { name: "Open the classic view" }));
    expect(await screen.findByTestId("classic-item")).toBeInTheDocument();
  });

  it("CARE hushes the room and swaps the chips for the fixed CARE set", async () => {
    renderJourney();
    await screen.findByTestId("journey-shell", {}, { timeout: 3000 });

    send("care-demo");

    await waitFor(() =>
      expect(screen.getByTestId("journey-shell")).toHaveAttribute("data-atmosphere", "hushed"),
    );
    expect(screen.getByTestId("journey-shell")).toHaveAttribute("data-mode", "care");
    const chips = screen.getByTestId("reply-verbs");
    expect(within(chips).getByRole("button", { name: "Show support options" })).toBeInTheDocument();
    expect(screen.queryByTestId("next-step-dock")).not.toBeInTheDocument();
  });

  it("the guidance dial is saved and tracked", async () => {
    renderJourney();
    await screen.findByTestId("journey-shell", {}, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: /Walk with me/ }));
    fireEvent.click(screen.getByRole("radio", { name: /I'll drive/ }));

    expect(localStorage.getItem("allyGuideGuidance")).toBe("drive");
    expect(track).toHaveBeenCalledWith(
      "guided_guidance_changed",
      expect.objectContaining({ level: "drive" }),
    );
    expect(screen.getByRole("button", { name: /I'll drive/ })).toBeInTheDocument();
  });
  it("voice: the microphone shows when voice is on, and a refusal falls back to text in Ally's voice", async () => {
    renderJourney();
    await screen.findByTestId("journey-shell", {}, { timeout: 3000 });

    fireEvent.click(screen.getByTestId("voice-button"));

    // The fixture's voice-session answers 403 GUIDE_DISABLED.
    const failed = await screen.findByTestId("voice-failed");
    expect(failed).toHaveTextContent("Voice isn't available right now. Let's type.");
    expect(track).toHaveBeenCalledWith(
      "guided_voice_fallback",
      expect.objectContaining({ failure_code: "disabled" }),
    );
    fireEvent.click(within(failed).getByRole("button", { name: "Type instead" }));
    expect(screen.queryByTestId("voice-failed")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Message to Ally")).toBeInTheDocument();
  });

  it("refetches the Spine after spine.updated", async () => {
    renderJourney();
    await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
    const before = (
      window as unknown as { __guideFixture: { requests: Array<{ path: string }> } }
    ).__guideFixture.requests.filter(r => r.path.endsWith("/bootstrap")).length;

    fireEvent.click(await screen.findByTestId("next-step-dock"));
    await screen.findByRole("article", { name: "Opening moves" });

    await waitFor(
      () => {
        const after = (
          window as unknown as { __guideFixture: { requests: Array<{ path: string }> } }
        ).__guideFixture.requests.filter(r => r.path.endsWith("/bootstrap")).length;
        expect(after).toBeGreaterThan(before);
      },
      { timeout: 2000 },
    );
  });
});
