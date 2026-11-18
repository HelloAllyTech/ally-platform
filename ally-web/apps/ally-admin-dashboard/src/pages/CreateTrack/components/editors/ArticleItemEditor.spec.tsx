import { fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm, UseFormReturn } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrackItemType } from "@types";

import { ArticleItemEditor } from "./ArticleItemEditor";

vi.mock("@hooks", () => ({
  useCanViewComponentLibrary: vi.fn(() => true),
  useUser: vi.fn(() => ({ permissions: [], features: [] })),
}));

vi.mock("@api", () => ({
  useCreateComponentTemplateMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  useGetTrackMediaUploadUrlMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  baseAPI: {
    reducerPath: "baseAPI",
    reducer: (state: any = null) => state,
    middleware: () => (next: any) => (action: any) => next(action),
  },
  evaluatorAPI: {
    reducerPath: "evaluatorAPI",
    reducer: (state: any = null) => state,
    middleware: () => (next: any) => (action: any) => next(action),
  },
}));

vi.mock("@constants", () => ({
  en: {
    common: { save: "Save", cancel: "Cancel" },
    componentLibrary: {
      templateNameLabel: "Template name",
      saveAsTemplateDescription: "Give this template a name.",
    },
    simulation: { triggerEvent: "Event" },
  },
  TRACK_ITEM_TYPE_LABELS: { ARTICLE: "Article" },
  MAX_MCQ_OPTIONS: 10,
  MIN_MCQ_OPTIONS: 2,
  MAX_JOURNAL_PROMPTS: 10,
  MIN_JOURNAL_PROMPTS: 1,
  MIN_VIDEO_WATCH_PCT: 1,
  MAX_ARTICLE_QUESTIONS: 5,
  MAX_ARTICLE_RESOURCES: 10,
  MAX_ARTICLE_TAKEAWAYS: 5,
  MAX_ARTICLE_TAKEAWAY_LENGTH: 200,
  MAX_ARTICLE_COVER_ALT_LENGTH: 300,
  ARTICLE_WORDS_PER_MINUTE: 200,
  isComponentLibrarySupportedType: () => true,
  SAVE_AS_TEMPLATE_LABEL: "Save as template",
  Permissions: { EDIT_ADMIN_TRACK: "edit:admin:track" },
  TAG_TYPES: { USERS: "USERS", TENANTS: "TENANTS", SESSION_EVENTS: "SESSION_EVENTS" },
}));

vi.mock("@assets", () => ({
  Plus: () => null,
  TooltipIcon: () => null,
  Trash: () => null,
  Save: () => null,
  ArrowSolid: () => null,
  BinaryClassification: () => null,
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  TextArea: (props: any) => <textarea {...props} />,
  TextInput: (props: any) => <input {...props} />,
  Tooltip: ({ children }: any) => <div>{children}</div>,
  htmlToPlainText: (html: string) => html.replace(/<[^>]*>/g, ""),
  escapeHtml: (text: string) => text,
}));

// We don't mock RichTextEditor anymore to test against the real component (R1)

// Mock components to avoid side effects from @components barrel
vi.mock("@components", () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  ButtonVariant: { PRIMARY: "primary", SECONDARY: "secondary", DESTRUCTIVE: "destructive" },
  ToggleSwitch: () => null,
  ActionConfirmationPopup: () => null,
}));

vi.mock("./quiz/McqEditor", () => ({ McqEditor: () => <div data-testid="mcq-editor" /> }));

const TestHarness = ({
  defaultValues,
  onForm,
}: {
  defaultValues: any;
  onForm?: (methods: UseFormReturn<any>) => void;
}) => {
  const methods = useForm({ defaultValues });
  onForm?.(methods);
  return (
    <FormProvider {...methods}>
      <ArticleItemEditor sectionIndex={0} itemIndex={0} onDelete={vi.fn()} />
    </FormProvider>
  );
};

describe("ArticleItemEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders RichTextEditor for questions in an article (R1)", () => {
    const defaultValues = {
      sections: [
        {
          items: [
            {
              type: TrackItemType.ARTICLE,
              article: {
                html: '<div data-ally-question="q1"></div>',
                questions: [
                  { id: "q1", type: "mcq_single", prompt: "Initial question", options: [] },
                ],
              },
            },
          ],
        },
      ],
    };

    render(<TestHarness defaultValues={defaultValues} />);

    const editors = screen.getAllByTestId("rich-text-editor");
    // One for body, one for question
    expect(editors).toHaveLength(2);
    expect(editors[1]).toHaveTextContent("Initial question");
  });

  describe("reading experience, cover and takeaways", () => {
    const articleForm = (article: Record<string, unknown> = {}) => ({
      sections: [
        { items: [{ type: TrackItemType.ARTICLE, article: { html: "<p>Body</p>", ...article } }] },
      ],
    });

    const renderEditor = (article: Record<string, unknown> = {}) => {
      let form: UseFormReturn<any> | undefined;
      render(<TestHarness defaultValues={articleForm(article)} onForm={m => (form = m)} />);
      return () => form!.getValues("sections.0.items.0.article");
    };

    it("offers the three experiences as radio cards, Classic by default", () => {
      renderEditor();

      const group = screen.getByRole("radiogroup", { name: /reading experience/i });
      const radios = within(group).getAllByRole("radio");
      expect(radios.map(radio => (radio as HTMLInputElement).value)).toEqual([
        "CLASSIC",
        "MAGAZINE",
        "CARDS",
      ]);
      expect(within(group).getByRole("radio", { name: /classic/i })).toBeChecked();
    });

    it("stores Magazine/Cards, and clears the field again for Classic", () => {
      const article = renderEditor();

      fireEvent.click(screen.getByRole("radio", { name: /magazine/i }));
      expect(article().experience).toBe("MAGAZINE");

      fireEvent.click(screen.getByRole("radio", { name: /cards/i }));
      expect(article().experience).toBe("CARDS");

      fireEvent.click(screen.getByRole("radio", { name: /classic/i }));
      expect(article().experience).toBeUndefined();
    });

    it("warns when Cards has no H2 to split on, and asks for a cover", () => {
      renderEditor({ experience: "CARDS" });

      expect(screen.getByText(/add h2 headings to split this article into cards/i)).toBeVisible();
      expect(screen.getByText(/each h2 heading starts a new card/i)).toBeVisible();
      expect(
        screen.getByText(/add a cover photo — magazine and cards open with it/i),
      ).toBeVisible();
    });

    it("drops the H2 and cover hints once there is something to split on and a cover", () => {
      renderEditor({
        html: "<h2>One</h2><p>a</p>",
        experience: "CARDS",
        cover: { url: "https://cdn/x.png", alt: "A bench" },
      });

      expect(screen.queryByText(/add h2 headings/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/add a cover photo/i)).not.toBeInTheDocument();
      expect(screen.getByDisplayValue("A bench")).toBeInTheDocument();
    });

    it("shows no hints in Classic", () => {
      renderEditor();

      expect(screen.queryByText(/add h2 headings/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/add a cover photo/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/each h2 heading starts a new card/i)).not.toBeInTheDocument();
    });

    it("removes the cover", () => {
      const article = renderEditor({ cover: { url: "https://cdn/x.png" } });

      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
      expect(article().cover).toBeUndefined();
    });

    it("adds, edits and removes takeaways, up to five", () => {
      const article = renderEditor();

      const add = () => fireEvent.click(screen.getByRole("button", { name: /add takeaway/i }));
      add();
      fireEvent.change(screen.getByLabelText("Takeaway 1"), { target: { value: "Listen first" } });
      expect(article().takeaways).toEqual(["Listen first"]);

      add();
      add();
      add();
      add();
      expect(screen.queryByRole("button", { name: /add takeaway/i })).not.toBeInTheDocument();
      expect(screen.getByLabelText("Takeaway 1")).toHaveAttribute("maxLength", "200");

      fireEvent.click(screen.getByRole("button", { name: "Remove takeaway 1" }));
      expect(article().takeaways).toEqual(["", "", "", ""]);
    });

    it("estimates the reading time from the text", () => {
      renderEditor({ html: `<p>${Array.from({ length: 450 }, () => "word").join(" ")}</p>` });

      expect(screen.getByTestId("article-reading-time")).toHaveTextContent(
        "Reading time: about 3 min (worked out from the text)",
      );
    });

    it("offers the highlight box in the article body only, not in question prompts", () => {
      renderEditor({
        html: '<p>Body</p><div data-ally-question="q1"></div>',
        questions: [{ id: "q1", type: "mcq_single", prompt: "Q", options: [] }],
      });

      const [body, prompt] = screen.getAllByTestId("rich-text-editor");
      expect(within(body).getByRole("button", { name: /highlight box/i })).toBeInTheDocument();
      expect(within(prompt).queryByRole("button", { name: /highlight box/i })).toBeNull();
    });
  });
});
