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
 * M3 learner UI against the fixture backend: side quests, the Shelf's
 * notebook, memory and preferences, and "Ask about this".
 */
describe("GuidedCourse M3: side quests, the Shelf utilities and Ask about this", () => {
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

  const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /^Guidance:/ }));

  describe("side quests", () => {
    it("marks a quick check against the course's answer, with Ally's line, and never as a score", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      send("quickcheck-demo");

      const quest = await screen.findByTestId("side-quest");
      const card = quest.closest("[data-testid^='card-']") as HTMLElement;
      expect(card).toHaveTextContent("Optional practice");
      expect(card).toHaveTextContent("Quick check · No XP");
      expect(card).toHaveTextContent("Doesn't count toward the course.");
      const check = within(card).getByRole("button", { name: "Check my answer" });
      expect(check).toBeDisabled();

      fireEvent.click(within(card).getByRole("radio", { name: /Ask if they're still there/ }));
      fireEvent.click(within(card).getByRole("radio", { name: /Shows you heard them/ }));
      expect(check).toBeEnabled();
      fireEvent.click(check);

      await waitFor(() => expect(within(card).getAllByTestId("option-mark")).toHaveLength(3));
      const q1 = within(card).getByTestId("question-q1");
      expect(within(q1).getByText(/Ask if they're still there/)).toHaveTextContent("Your answer");
      expect(within(q1).getByText(/Wait a little longer/)).toHaveTextContent(
        "✓ The course's answer",
      );
      expect(within(card).getByTestId("question-q2")).toHaveTextContent(
        "Your answer · the course's answer",
      );
      expect(within(card).getAllByTestId("question-feedback")).toHaveLength(2);
      expect(card).not.toHaveTextContent(/1 of 2|50%|score/i);
      expect(within(card).queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
      // Answered once: the radios are locked.
      expect(within(q1).getAllByRole("radio")[0]).toBeDisabled();

      const answer = requests(/micro-activities\/.+\/responses$/)[0];
      expect(answer.body).toEqual({
        answers: [
          { questionId: "q1", optionId: "b" },
          { questionId: "q2", optionId: "a" },
        ],
      });
      // The practice leaves a mark on the map under the item it was beside.
      expect(await screen.findAllByTestId("practice-mark")).toHaveLength(1);
      expect(
        screen.getByRole("button", { name: /Opening a call · .* · 1 optional practice/ }),
      ).toBeInTheDocument();
      expect(track).toHaveBeenCalledWith(
        "guided_practice_answered",
        expect.objectContaining({ practice_kind: "quick_check" }),
      );
      expect(JSON.stringify(track.mock.calls)).not.toMatch(/still there|correct/);
    });

    it("a written practice gets one note from Ally", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      send("reflection-demo");

      const box = await screen.findByPlaceholderText("A sentence or two is plenty.");
      const card = box.closest("[data-testid^='card-']") as HTMLElement;
      expect(card).toHaveTextContent("Reflection · No XP");
      fireEvent.change(box, { target: { value: "The long pause after they said 'fine'." } });
      fireEvent.click(within(card).getByRole("button", { name: "Get a note from Ally" }));

      expect(await within(card).findByTestId("coach-note")).toHaveTextContent(
        /count three breaths/,
      );
      expect(requests(/responses$/)[0].body).toEqual({
        text: "The long pause after they said 'fine'.",
      });
    });

    it("Skip folds it away without fuss", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      send("quickcheck-demo");
      const quest = await screen.findByTestId("side-quest");
      const card = quest.closest("[data-testid^='card-']") as HTMLElement;
      fireEvent.click(within(card).getByRole("button", { name: "Skip" }));
      expect(await screen.findByText("Skipped")).toBeInTheDocument();
      await waitFor(() =>
        expect(requests(/\/cards\/.+\/events$/).map(r => r.body)).toContainEqual({
          type: "dismissed",
        }),
      );
    });
  });

  describe("the Shelf: notebook, memory and preferences", () => {
    it("the notebook lists the learner's entries, deletes on a second tap, and downloads", async () => {
      const createObjectURL = vi.fn(() => "blob:notebook");
      const revokeObjectURL = vi.fn();
      Object.assign(URL, { createObjectURL, revokeObjectURL });
      // jsdom can't follow a download link; the click itself is what matters.
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "Notebook" }));

      const panel = await screen.findByTestId("notebook-panel");
      expect(await within(panel).findAllByTestId("notebook-entry")).toHaveLength(2);
      expect(panel).toHaveTextContent("First move");
      expect(panel).toHaveTextContent("Ally noticed");
      expect(requests(/\/v1\/guide\/notebook$/)[0]).toBeTruthy();

      const first = within(panel).getAllByTestId("notebook-entry")[0];
      fireEvent.click(within(first).getByRole("button", { name: "Delete" }));
      expect(within(first).getByText("Delete this entry?")).toBeInTheDocument();
      fireEvent.click(within(first).getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(within(panel).getAllByTestId("notebook-entry")).toHaveLength(1));

      fireEvent.click(within(panel).getByRole("button", { name: "Download" }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
      expect(click).toHaveBeenCalled();
      click.mockRestore();
      expect(track).toHaveBeenCalledWith(
        "guided_notebook_exported",
        expect.objectContaining({ scope: "course" }),
      );
      expect(track).toHaveBeenCalledWith(
        "guided_shelf_opened",
        expect.objectContaining({ shelf: "notebook" }),
      );
    });

    it("memory: what Ally remembers, forget one, turn it off, forget everything", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "What Ally remembers" }));

      const panel = await screen.findByTestId("memory-panel");
      expect(await within(panel).findAllByTestId("memory-item")).toHaveLength(2);
      expect(panel).toHaveTextContent("Wants to feel steadier on night shifts.");

      const first = within(panel).getAllByTestId("memory-item")[0];
      fireEvent.click(within(first).getByRole("button", { name: "Forget" }));
      fireEvent.click(within(first).getByRole("button", { name: "Forget" }));
      await waitFor(() => expect(within(panel).getAllByTestId("memory-item")).toHaveLength(1));

      const toggle = await within(panel).findByRole("switch", { name: "Let Ally remember things" });
      await waitFor(() => expect(toggle).toBeEnabled());
      expect(toggle).toHaveAttribute("aria-checked", "true");
      fireEvent.click(toggle);
      await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
      expect(panel).toHaveTextContent("Ally won't use what's here or remember anything new.");

      fireEvent.click(within(panel).getByRole("button", { name: "Forget everything" }));
      fireEvent.click(within(panel).getByRole("button", { name: "Forget everything" }));
      expect(await within(panel).findByTestId("memory-empty")).toBeInTheDocument();
      // Never what was remembered.
      expect(JSON.stringify(track.mock.calls)).not.toContain("night shifts");
    });

    it("preferences: optional practice, outreach, and challenge only once the server keeps it", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "Preferences" }));

      const panel = await screen.findByTestId("preferences-panel");
      const practice = await within(panel).findByRole("switch", { name: "Optional practice" });
      expect(practice).toHaveAttribute("aria-checked", "true");
      expect(within(panel).queryByTestId("challenge-switch")).not.toBeInTheDocument();
      fireEvent.click(practice);
      await waitFor(() => expect(practice).toHaveAttribute("aria-checked", "false"));

      fireEvent.click(within(panel).getByRole("radio", { name: "Off" }));
      await waitFor(() =>
        expect(requests(/\/v1\/guide\/prefs$/).map(r => r.body)).toContainEqual({
          outreach: "off",
        }),
      );
      expect(requests(/\/v1\/guide\/prefs$/).map(r => r.body)).toContainEqual({
        sideQuests: false,
      });
    });

    it("shows the challenge switch when the server returns it", async () => {
      (server as unknown as { prefs: Record<string, unknown> }).prefs.challenge = "normal";
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      openMenu();
      fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
      const panel = await screen.findByTestId("preferences-panel");
      const challenge = await within(panel).findByRole("switch", { name: "More challenge" });
      fireEvent.click(challenge);
      await waitFor(() =>
        expect(requests(/\/v1\/guide\/prefs$/).map(r => r.body)).toContainEqual({
          challenge: "more",
        }),
      );
    });
  });

  describe("Ask about this", () => {
    it("an open quiz offers 'Where is this covered?', sent with the item attached", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      fireEvent.click(await screen.findByTestId("next-step-dock"));
      const quiz = await screen.findByRole("article", { name: "Opening moves" });
      fireEvent.click(within(quiz).getAllByRole("button")[0]);

      fireEvent.click(await screen.findByTestId("ask-quiz"));

      expect(await screen.findByText("Where is this covered in the course?")).toBeInTheDocument();
      expect(await screen.findAllByText(/That's covered in/)).not.toHaveLength(0);
      const turn = requests(/\/turns$/).at(-1);
      expect(turn?.body).toMatchObject({
        text: "Where is this covered in the course?",
        anchor: { itemId: expect.any(String) },
      });
      expect(track).toHaveBeenCalledWith(
        "guided_message_sent",
        expect.objectContaining({ source: "ask", verb: "quiz" }),
      );
    });

    it("selecting article text offers 'Ask Ally', with the quote attached", async () => {
      renderJourney();
      await screen.findByTestId("journey-shell", {}, { timeout: 3000 });
      const article = await screen.findByRole("article", { name: "Opening a call" });
      fireEvent.click(within(article).getAllByRole("button")[0]);

      const passage = await screen.findByText(/let the silence be theirs/);
      const range = document.createRange();
      range.selectNodeContents(passage);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));

      fireEvent.click(await screen.findByTestId("ask-article"));

      expect(await screen.findByText("Can you help me with this part?")).toBeInTheDocument();
      expect(screen.getByText(/About: “Say your name/)).toBeInTheDocument();
      const turn = requests(/\/turns$/).at(-1);
      expect(turn?.body).toMatchObject({
        anchor: { quote: expect.stringContaining("let the silence be theirs") },
      });
    });
  });
});
