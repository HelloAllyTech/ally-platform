import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  notes: vi.fn(),
  save: vi.fn(),
  draft: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideNotesQuery: (id: string) => h.notes(id),
  useSaveAllyGuideNotesMutation: () => [h.save, { isLoading: false }],
  useDraftAllyGuideNotesMutation: () => [h.draft, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { AllyNotesEditor, clearUnsavedAllyNotes } from "../AllyNotesEditor";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "item-1",
  title: "Welcome article",
  type: "ARTICLE",
  sectionId: "sec-1",
  sectionTitle: "Getting started",
  defaultTension: "low",
  tension: null,
  triggerWarnings: [],
  ...overrides,
});

const NOTES = {
  trackId: "track-1",
  notes: null,
  draftedByCopilot: false,
  notesMaxChars: 1500,
  items: [
    item(),
    item({
      id: "item-2",
      title: "The difficult call",
      type: "ROLEPLAY",
      defaultTension: "high",
      triggerWarnings: ["suicide", "abuse"],
    }),
    item({
      id: "item-3",
      title: "Reflection",
      type: "QUIZ",
      sectionId: "sec-2",
      sectionTitle: "Wrapping up",
      defaultTension: "medium",
      tension: "low",
    }),
  ],
};

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });

const notesBox = () => screen.getByLabelText("What Ally should know about this course");

describe("AllyNotesEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUnsavedAllyNotes();
    h.notes.mockReturnValue(ok(NOTES));
    h.save.mockReturnValue({ unwrap: () => Promise.resolve(NOTES) });
    h.draft.mockReturnValue({
      unwrap: () =>
        Promise.resolve({
          draft: {
            notes: "Learners are new supervisors. Go gently on the call.",
            tension: { "item-2": "high" },
            draftedByCopilot: true,
          },
        }),
    });
  });

  describe("what it shows", () => {
    it("asks the server for nothing, and says to save first, for a course that is not saved yet", () => {
      render(<AllyNotesEditor trackId={null} canDraft />);

      expect(screen.getByTestId("ally-notes-unsaved")).toHaveTextContent("Save the course first");
      expect(h.notes).toHaveBeenCalledWith("");
    });

    it("shows the notes with a counter, and warns that no quiz answer belongs here", () => {
      h.notes.mockReturnValue(ok({ ...NOTES, notes: "Go gently." }));
      render(<AllyNotesEditor trackId="track-1" canDraft />);

      expect(notesBox()).toHaveValue("Go gently.");
      expect(screen.getByText("10 of 1500 characters")).toBeInTheDocument();
      expect(screen.getByTestId("ally-notes-editor")).toHaveTextContent(
        "Never put a quiz answer here",
      );
    });

    it("lists every item by section with what Ally assumes, and the trigger warnings behind it", () => {
      render(<AllyNotesEditor trackId="track-1" canDraft />);

      const editor = screen.getByTestId("ally-notes-editor");
      expect(within(editor).getByText("Getting started")).toBeInTheDocument();
      expect(within(editor).getByText("Wrapping up")).toBeInTheDocument();
      const call = screen.getByTestId("ally-notes-item-item-2");
      expect(call).toHaveTextContent("roleplay");
      expect(call).toHaveTextContent("High");
      expect(call).toHaveTextContent("Trigger warnings: suicide, abuse");
    });

    it("shows a trainer's override as chosen, and the default for the rest", () => {
      render(<AllyNotesEditor trackId="track-1" canDraft />);

      expect(screen.getByLabelText("Reflection: Yours")).toHaveValue("low");
      expect(screen.getByLabelText("Welcome article: Yours")).toHaveValue("");
    });

    it("says a course with no items has none to pace", () => {
      h.notes.mockReturnValue(ok({ ...NOTES, items: [] }));
      render(<AllyNotesEditor trackId="track-1" canDraft />);

      expect(screen.getByText("This course has no items yet.")).toBeInTheDocument();
    });

    it("shows a skeleton while loading, and a failure with a retry", () => {
      h.notes.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      const { unmount } = render(<AllyNotesEditor trackId="track-1" canDraft />);
      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
      unmount();

      const refetch = vi.fn();
      h.notes.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { status: 500 },
        refetch,
      });
      render(<AllyNotesEditor trackId="track-1" canDraft />);
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalled();
    });
  });

  describe("saving", () => {
    it("starts with nothing to save", () => {
      render(<AllyNotesEditor trackId="track-1" canDraft />);

      expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled();
      expect(screen.getByText("No unsaved changes.")).toBeInTheDocument();
    });

    it("saves the notes and only the tension overrides, and says Ally uses them from the next epoch", async () => {
      render(<AllyNotesEditor trackId="track-1" canDraft />);

      fireEvent.change(notesBox(), { target: { value: "  Go gently.  " } });
      fireEvent.change(screen.getByLabelText("Welcome article: Yours"), {
        target: { value: "medium" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

      await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
      expect(h.save).toHaveBeenCalledWith({
        trackId: "track-1",
        notes: "Go gently.",
        tension: { "item-3": "low", "item-1": "medium" },
        draftedByCopilot: false,
      });
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "Notes saved. Ally uses them from each conversation's next epoch.",
      );
    });

    it("clears an override with 'Use the default', which sends the rest and not that item", async () => {
      render(<AllyNotesEditor trackId="track-1" canDraft />);

      fireEvent.change(screen.getByLabelText("Reflection: Yours"), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

      await waitFor(() => expect(h.save).toHaveBeenCalled());
      expect(h.save.mock.calls[0][0].tension).toEqual({});
    });

    it("sends null notes when the text is emptied", async () => {
      h.notes.mockReturnValue(ok({ ...NOTES, notes: "Something" }));
      render(<AllyNotesEditor trackId="track-1" canDraft />);

      fireEvent.change(notesBox(), { target: { value: "   " } });
      fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

      await waitFor(() => expect(h.save).toHaveBeenCalled());
      expect(h.save.mock.calls[0][0].notes).toBeNull();
    });

    it("refuses notes over the limit and does not send them", () => {
      render(<AllyNotesEditor trackId="track-1" canDraft />);

      fireEvent.change(notesBox(), { target: { value: "x".repeat(1501) } });

      expect(screen.getByRole("alert")).toHaveTextContent("more than 1500 characters");
      expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled();
    });

    it("discards the edits back to what is saved", () => {
      render(<AllyNotesEditor trackId="track-1" canDraft />);
      fireEvent.change(notesBox(), { target: { value: "Something" } });

      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

      expect(notesBox()).toHaveValue("");
      expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled();
    });

    it("keeps unsaved edits when the editor is swapped out and back, as clicking another node does", () => {
      const { unmount } = render(<AllyNotesEditor trackId="track-1" canDraft />);
      fireEvent.change(notesBox(), { target: { value: "Written a minute ago" } });
      unmount();

      render(<AllyNotesEditor trackId="track-1" canDraft />);

      expect(notesBox()).toHaveValue("Written a minute ago");
      expect(screen.getByText("Unsaved changes.")).toBeInTheDocument();
    });
  });

  describe("a quiz answer in the notes", () => {
    it("shows the server's message naming the answer, keeps the text and saves nothing", async () => {
      h.save.mockReturnValue({
        unwrap: () =>
          Promise.reject({
            status: 422,
            data: {
              errorCode: "GUIDE_NOTES_ANSWER_LEAK",
              message:
                'These notes include a quiz answer Ally could pass on to learners: "Reflective listening" (Reflection). Describe the idea without the answer, or remove it, then save.',
            },
          }),
      });
      render(<AllyNotesEditor trackId="track-1" canDraft />);
      fireEvent.change(notesBox(), { target: { value: "The answer is Reflective listening." } });

      fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

      const leak = await screen.findByTestId("ally-notes-leak");
      expect(leak).toHaveTextContent("These notes include a quiz answer");
      expect(leak).toHaveTextContent('"Reflective listening" (Reflection)');
      expect(notesBox()).toHaveValue("The answer is Reflective listening.");
      expect(h.toastSuccess).not.toHaveBeenCalled();
      expect(h.toastError).not.toHaveBeenCalled();
    });

    it("clears the warning as soon as the text is edited", async () => {
      h.save.mockReturnValue({
        unwrap: () => Promise.reject({ status: 422, data: { message: "A quiz answer" } }),
      });
      render(<AllyNotesEditor trackId="track-1" canDraft />);
      fireEvent.change(notesBox(), { target: { value: "leaky" } });
      fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
      await screen.findByTestId("ally-notes-leak");

      fireEvent.change(notesBox(), { target: { value: "fixed" } });

      expect(screen.queryByTestId("ally-notes-leak")).not.toBeInTheDocument();
    });

    it("shows another failure as a message, not as a leak", async () => {
      h.save.mockReturnValue({
        unwrap: () => Promise.reject({ status: 500, data: { message: "Server error" } }),
      });
      render(<AllyNotesEditor trackId="track-1" canDraft />);
      fireEvent.change(notesBox(), { target: { value: "x" } });

      fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Server error"));
      expect(screen.queryByTestId("ally-notes-leak")).not.toBeInTheDocument();
    });
  });

  describe("drafting with Copilot", () => {
    it("is offered only to an admin who can use Course Copilot", () => {
      const { unmount } = render(<AllyNotesEditor trackId="track-1" canDraft={false} />);
      expect(screen.queryByRole("button", { name: "Draft with Copilot" })).not.toBeInTheDocument();
      unmount();

      render(<AllyNotesEditor trackId="track-1" canDraft />);
      expect(screen.getByRole("button", { name: "Draft with Copilot" })).toBeInTheDocument();
    });

    it("fills an empty editor with the draft, marks it as a draft, and saves nothing by itself", async () => {
      render(<AllyNotesEditor trackId="track-1" canDraft />);

      fireEvent.click(screen.getByRole("button", { name: "Draft with Copilot" }));

      await waitFor(() =>
        expect(notesBox()).toHaveValue("Learners are new supervisors. Go gently on the call."),
      );
      expect(screen.getByTestId("ally-notes-drafted")).toHaveTextContent(
        "Drafted by Course Copilot",
      );
      expect(h.draft).toHaveBeenCalledWith("track-1");
      expect(h.save).not.toHaveBeenCalled();
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "Drafted. Read it, change what you like, then save.",
      );
    });

    it("saves an untouched draft as one, so the team can see how much guidance was drafted", async () => {
      render(<AllyNotesEditor trackId="track-1" canDraft />);
      fireEvent.click(screen.getByRole("button", { name: "Draft with Copilot" }));
      await waitFor(() => expect(notesBox()).not.toHaveValue(""));

      fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

      await waitFor(() => expect(h.save).toHaveBeenCalled());
      expect(h.save.mock.calls[0][0]).toMatchObject({
        notes: "Learners are new supervisors. Go gently on the call.",
        tension: { "item-2": "high" },
        draftedByCopilot: true,
      });
    });

    it("does not mark a draft that was edited", async () => {
      render(<AllyNotesEditor trackId="track-1" canDraft />);
      fireEvent.click(screen.getByRole("button", { name: "Draft with Copilot" }));
      await waitFor(() => expect(notesBox()).not.toHaveValue(""));

      fireEvent.change(notesBox(), { target: { value: "My own words now." } });

      expect(screen.queryByTestId("ally-notes-drafted")).not.toBeInTheDocument();
    });

    it("asks before replacing notes the trainer already has, and keeps them if declined", async () => {
      h.notes.mockReturnValue(ok({ ...NOTES, notes: "My own notes." }));
      render(<AllyNotesEditor trackId="track-1" canDraft />);

      fireEvent.click(screen.getByRole("button", { name: "Draft with Copilot" }));

      const dialog = await screen.findByRole("dialog", {
        name: "Replace what is there with the draft?",
      });
      expect(notesBox()).toHaveValue("My own notes.");
      fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
      expect(notesBox()).toHaveValue("My own notes.");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("replaces them once the trainer confirms", async () => {
      h.notes.mockReturnValue(ok({ ...NOTES, notes: "My own notes." }));
      render(<AllyNotesEditor trackId="track-1" canDraft />);
      fireEvent.click(screen.getByRole("button", { name: "Draft with Copilot" }));

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Draft with Copilot" }));

      expect(notesBox()).toHaveValue("Learners are new supervisors. Go gently on the call.");
    });

    it("shows the server's readable message when no usable draft comes back", async () => {
      h.draft.mockReturnValue({
        unwrap: () =>
          Promise.reject({
            status: 502,
            data: { message: "Copilot could not write a usable draft" },
          }),
      });
      render(<AllyNotesEditor trackId="track-1" canDraft />);

      fireEvent.click(screen.getByRole("button", { name: "Draft with Copilot" }));

      await waitFor(() =>
        expect(h.toastError).toHaveBeenCalledWith("Copilot could not write a usable draft"),
      );
      expect(notesBox()).toHaveValue("");
    });
  });
});
