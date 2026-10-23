import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work, and a mock registered after
// another import that pulls it in arrives too late.
import "@constants";

const h = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

vi.mock("@ally-ui-mono/ui-shared", async () => (await import("./uiSharedFakes")).uiSharedFakes);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));

// eslint-disable-next-line import/first
import type { AllyGuideCrisisResponse, AllyGuideLanguage } from "@types";

// eslint-disable-next-line import/first
import { CrisisCopyEditor } from "../CrisisCopyEditor";

const MESSAGE =
  "I'm really glad you told me. You deserve to talk to a person right now. Please call one of the numbers below.";

const row = (
  languageCode: AllyGuideLanguage,
  overrides: Partial<AllyGuideCrisisResponse> = {},
): AllyGuideCrisisResponse => ({
  id: `copy-${languageCode}`,
  scope: "platform",
  tenantId: null,
  languageCode,
  body: MESSAGE,
  version: 3,
  active: true,
  approvedBy: 12,
  approvedAt: "2026-10-20T09:30:00.000Z",
  ...overrides,
});

const store = (userId: number | null = 5) =>
  configureStore({
    reducer: {
      user: () => ({
        user: userId === null ? null : { id: userId },
        permissions: [],
        features: [],
      }),
    },
  });

const renderEditor = (
  props: Partial<React.ComponentProps<typeof CrisisCopyEditor>> = {},
  userId = 5,
) => {
  const onSave = vi.fn().mockResolvedValue({ version: 4 });
  const onWithdraw = vi.fn().mockResolvedValue(undefined);
  render(
    <Provider store={store(userId)}>
      <CrisisCopyEditor
        rows={[row("en"), row("hi", { version: 1, approvedBy: 5 })]}
        canEdit
        onSave={onSave}
        onWithdraw={onWithdraw}
        {...props}
      />
    </Provider>,
  );
  return { onSave, onWithdraw };
};

const card = (language: string) => screen.getByTestId(`crisis-copy-${language}`);

describe("CrisisCopyEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("one text area per language, with its version and approver", () => {
    it("shows all five languages", () => {
      renderEditor();

      for (const language of ["en", "hi", "mr", "ta", "kn"]) {
        expect(card(language)).toBeInTheDocument();
      }
      expect(screen.getAllByRole("textbox")).toHaveLength(5);
    });

    it("stacks every language, with no switcher, unless asked for one (the platform tab)", () => {
      renderEditor();

      expect(screen.queryByTestId("crisis-language-switcher")).not.toBeInTheDocument();
      for (const language of ["en", "hi", "mr", "ta", "kn"]) {
        expect(card(language).parentElement).not.toHaveAttribute("hidden");
      }
    });

    it("shows one language at a time behind a switcher when asked (an organisation's tab)", () => {
      renderEditor({ switcher: true });

      expect(card("en").parentElement).not.toHaveAttribute("hidden");
      expect(card("mr").parentElement).toHaveAttribute("hidden");

      fireEvent.click(
        within(screen.getByTestId("crisis-language-switcher")).getByRole("button", {
          name: "Marathi",
        }),
      );

      expect(card("mr").parentElement).not.toHaveAttribute("hidden");
      expect(card("en").parentElement).toHaveAttribute("hidden");
    });

    it("states the version and who approved it", () => {
      renderEditor();

      expect(screen.getByTestId("crisis-copy-en-meta")).toHaveTextContent("Version 3");
      expect(screen.getByTestId("crisis-copy-en-meta")).toHaveTextContent("Approved by user 12");
      expect(screen.getByTestId("crisis-copy-en-meta")).toHaveTextContent("2026");
    });

    it("says 'you' for the admin's own approval", () => {
      renderEditor();

      expect(screen.getByTestId("crisis-copy-hi-meta")).toHaveTextContent("Approved by you");
    });

    it("says honestly when the approver was not recorded", () => {
      renderEditor({ rows: [row("en", { approvedBy: null, approvedAt: null })] });

      expect(screen.getByTestId("crisis-copy-en-meta")).toHaveTextContent(
        "Approved by someone unrecorded",
      );
    });

    it("says a language has no copy yet and what learners get instead", () => {
      renderEditor();

      expect(screen.getByTestId("crisis-copy-mr-meta")).toHaveTextContent(
        "No copy saved for this language yet.",
      );
      expect(
        within(card("mr")).getByText(/Learners see English, then the built-in default/),
      ).toBeInTheDocument();
    });
  });

  describe("saving needs a clinician's sign-off", () => {
    const edit = (language: string, text: string) =>
      fireEvent.change(within(card(language)).getByRole("textbox"), { target: { value: text } });

    it("offers a save only once the text has changed", () => {
      renderEditor();

      expect(within(card("en")).getByRole("button", { name: "Save new version…" })).toBeDisabled();

      edit("en", `${MESSAGE} Take your time.`);

      expect(within(card("en")).getByRole("button", { name: "Save new version…" })).toBeEnabled();
    });

    it("refuses text under the minimum, saying how long it must be", () => {
      renderEditor();

      edit("en", "Too short");

      expect(within(card("en")).getByRole("button", { name: "Save new version…" })).toBeDisabled();
      expect(within(card("en")).getByRole("alert")).toHaveTextContent("At least 40 characters.");
    });

    it("refuses text over the maximum", () => {
      renderEditor();

      edit("en", "x".repeat(1501));

      expect(within(card("en")).getByRole("button", { name: "Save new version…" })).toBeDisabled();
      expect(within(card("en")).getByRole("alert")).toHaveTextContent("At most 1500 characters.");
    });

    it("asks whether a clinician approved the exact text, and will not save until that is ticked", () => {
      const { onSave } = renderEditor();
      edit("en", `${MESSAGE} Take your time.`);

      fireEvent.click(within(card("en")).getByRole("button", { name: "Save new version…" }));

      const dialog = screen.getByRole("dialog", { name: "Save the English crisis message?" });
      expect(within(dialog).getByText(/recorded as approved by you/)).toBeInTheDocument();
      expect(within(dialog).getByText(/Take your time\./)).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Save version" })).toBeDisabled();

      fireEvent.click(within(dialog).getByLabelText("A clinician has approved this exact text"));
      expect(within(dialog).getByRole("button", { name: "Save version" })).toBeEnabled();
      expect(onSave).not.toHaveBeenCalled();
    });

    it("saves the trimmed text for that language once approval is confirmed", async () => {
      const { onSave } = renderEditor();
      edit("en", `  ${MESSAGE} Take your time.  `);
      fireEvent.click(within(card("en")).getByRole("button", { name: "Save new version…" }));
      const dialog = screen.getByRole("dialog");

      fireEvent.click(within(dialog).getByLabelText("A clinician has approved this exact text"));
      fireEvent.click(within(dialog).getByRole("button", { name: "Save version" }));

      await waitFor(() => expect(onSave).toHaveBeenCalledWith("en", `${MESSAGE} Take your time.`));
      expect(h.toastSuccess).toHaveBeenCalledWith("English crisis message saved as version 4.");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("saves nothing, and forgets the tick, when the dialog is cancelled", () => {
      const { onSave } = renderEditor();
      edit("en", `${MESSAGE} Take your time.`);
      fireEvent.click(within(card("en")).getByRole("button", { name: "Save new version…" }));
      fireEvent.click(screen.getByLabelText("A clinician has approved this exact text"));

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(within(card("en")).getByRole("button", { name: "Save new version…" }));

      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByLabelText("A clinician has approved this exact text")).not.toBeChecked();
    });

    it("shows the server's own reason when it refuses, and keeps the dialog open", async () => {
      const onSave = vi.fn().mockRejectedValue({
        status: 400,
        data: { message: "Crisis copy must be between 40 and 1,500 characters." },
      });
      renderEditor({ onSave });
      edit("en", `${MESSAGE} Take your time.`);
      fireEvent.click(within(card("en")).getByRole("button", { name: "Save new version…" }));
      fireEvent.click(screen.getByLabelText("A clinician has approved this exact text"));

      fireEvent.click(screen.getByRole("button", { name: "Save version" }));

      await waitFor(() =>
        expect(h.toastError).toHaveBeenCalledWith(
          "Crisis copy must be between 40 and 1,500 characters.",
        ),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("discards an edit back to the saved text", () => {
      renderEditor();
      edit("en", "something else entirely that is long enough to count as an edit");

      fireEvent.click(within(card("en")).getByRole("button", { name: "Discard changes" }));

      expect(within(card("en")).getByRole("textbox")).toHaveValue(MESSAGE);
    });
  });

  describe("withdrawing", () => {
    it("asks first, saying where learners fall back to, then withdraws that version by its row", async () => {
      const { onWithdraw } = renderEditor();

      fireEvent.click(within(card("en")).getByRole("button", { name: "Withdraw…" }));
      const dialog = screen.getByRole("dialog", { name: "Withdraw the English crisis message?" });
      expect(
        within(dialog).getByText(/fall back to English, then to the built-in default/),
      ).toBeInTheDocument();
      expect(onWithdraw).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole("button", { name: "Withdraw" }));

      await waitFor(() =>
        expect(onWithdraw).toHaveBeenCalledWith(expect.objectContaining({ id: "copy-en" })),
      );
    });

    it("offers no withdraw for a language that has nothing to withdraw", () => {
      renderEditor();

      expect(
        within(card("mr")).queryByRole("button", { name: "Withdraw…" }),
      ).not.toBeInTheDocument();
    });

    it("offers no withdraw at all where the API has none (the organisation layer)", () => {
      renderEditor({ onWithdraw: undefined });

      expect(screen.queryByRole("button", { name: "Withdraw…" })).not.toBeInTheDocument();
    });
  });

  describe("read-only", () => {
    it("shows the copy with its version, and offers no way to change it", () => {
      renderEditor({ canEdit: false });

      expect(screen.getByTestId("crisis-copy-en-meta")).toHaveTextContent("Version 3");
      expect(within(card("en")).getByRole("textbox")).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Save new version…" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Withdraw…" })).not.toBeInTheDocument();
    });
  });

  describe("the card preview", () => {
    it("shows the learner's card for the text as typed, with the platform's default lines", () => {
      renderEditor();

      fireEvent.click(within(card("en")).getByRole("button", { name: "Preview the card" }));

      const preview = within(card("en")).getByTestId("crisis-card-preview");
      expect(within(preview).getByTestId("crisis-preview-message")).toHaveTextContent(
        "I'm really glad you told me",
      );
      expect(within(preview).getByText("Support is available now")).toBeInTheDocument();
      expect(within(preview).getAllByTestId("crisis-preview-line").length).toBeGreaterThanOrEqual(
        3,
      );
      expect(within(preview).getByText("I'm safe right now")).toBeInTheDocument();
      expect(within(preview).getByText("I need help now")).toBeInTheDocument();
    });

    it("follows an unsaved edit", () => {
      renderEditor();
      fireEvent.click(within(card("en")).getByRole("button", { name: "Preview the card" }));

      fireEvent.change(within(card("en")).getByRole("textbox"), {
        target: { value: "A different message, still long enough to be accepted by the server." },
      });

      expect(within(card("en")).getByTestId("crisis-preview-message")).toHaveTextContent(
        "A different message",
      );
    });

    it("says there is no message when the language has none, rather than showing an empty box", () => {
      renderEditor();

      fireEvent.click(within(card("mr")).getByRole("button", { name: "Preview the card" }));

      expect(within(card("mr")).getByTestId("crisis-preview-missing")).toBeInTheDocument();
    });

    it("uses an organisation's own lines when it is given them, and hides the preview again on request", () => {
      renderEditor({
        supportLines: {
          en: [
            { name: "Acme helpline", phone: "+91 98765 43210", hours: "9 to 6", isCrisis: true },
          ],
        },
      });

      fireEvent.click(within(card("en")).getByRole("button", { name: "Preview the card" }));
      const preview = within(card("en")).getByTestId("crisis-card-preview");
      expect(within(preview).getByText(/Acme helpline/)).toBeInTheDocument();
      expect(within(preview).getByText("+91 98765 43210")).toBeInTheDocument();
      // 112 is always on the card.
      expect(within(preview).getByText("112")).toBeInTheDocument();
      expect(
        within(preview).getByText(/The support lines are this organisation's/),
      ).toBeInTheDocument();

      fireEvent.click(within(card("en")).getByRole("button", { name: "Hide preview" }));
      expect(within(card("en")).queryByTestId("crisis-card-preview")).not.toBeInTheDocument();
    });
  });
});
