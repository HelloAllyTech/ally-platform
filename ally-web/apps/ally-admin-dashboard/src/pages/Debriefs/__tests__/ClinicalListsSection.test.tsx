import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  save: vi.fn(),
  lists: {
    jargon: { en: ["transference", "psychoeducation"], hi: [] as string[] },
    diagnosis: { en: ["you are anxious"], hi: [] as string[] },
    score: { en: ["your score"], hi: [] as string[] },
  },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefClinicalListsQuery: () => ({
    isLoading: false,
    data: {
      kinds: [
        { kind: "jargon", label: "Terms a lay helper was not taught" },
        { kind: "diagnosis", label: "Labels or diagnoses of the learner" },
        { kind: "score", label: "Scores, ratings and grades" },
      ],
      languages: ["en", "hi"],
      lists: h.lists,
      defaults: h.lists,
    },
  }),
  useUpdateDebriefClinicalListMutation: () => [h.save, { isLoading: false }],
}));

/* eslint-disable import/first */
import { ClinicalListsSection } from "../settings/ClinicalListsSection";
/* eslint-enable import/first */

describe("Settings › Clinical lists", () => {
  beforeEach(() => {
    h.save.mockReset();
    h.save.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("shows the lists and one list's words for one language, rows never wrapping", () => {
    render(<ClinicalListsSection canEdit />);
    expect(screen.getByTestId("clinical-kind-jargon")).toHaveClass("flex-nowrap");
    const words = screen.getByTestId("clinical-words");
    expect(within(words).getByText("transference")).toHaveClass("truncate");
    expect(within(words).getByText("psychoeducation")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("clinical-kind-diagnosis"));
    expect(screen.getByText("you are anxious")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("clinical-lang-hi"));
    expect(screen.getByText("No words for this language yet.")).toBeInTheDocument();
  });

  it("adds and removes words, then saves the list for that language", async () => {
    render(<ClinicalListsSection canEdit />);
    fireEvent.change(screen.getByLabelText("Word or phrase"), {
      target: { value: "  ego   state " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove transference" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.save).toHaveBeenCalledWith({
      kind: "jargon",
      language: "en",
      entries: ["psychoeducation", "ego state"],
    });
  });

  it("restores a list's defaults", () => {
    render(<ClinicalListsSection canEdit />);
    fireEvent.click(screen.getByTestId("clinical-lang-hi"));
    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));
    expect(h.save).toHaveBeenCalledWith({ kind: "jargon", language: "hi", entries: null });
  });

  it("is read-only for a viewer who is not the clinical advisor or the owner", () => {
    render(<ClinicalListsSection canEdit={false} />);
    expect(
      screen.getByText("Only the clinical advisor or the owner can change these."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Word or phrase")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText("transference")).toBeInTheDocument();
  });
});
