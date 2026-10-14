import { render, screen, fireEvent } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuizItemEditor } from "./QuizItemEditor";
import { TrackItemType } from "@types";

vi.mock("@hooks", () => ({
  useCanViewComponentLibrary: vi.fn(() => true),
  useUser: vi.fn(() => ({ permissions: [], features: [] })),
}));

vi.mock("@api", () => ({
  useCreateComponentTemplateMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  useGetTrackMediaUploadUrlMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  baseAPI: { reducerPath: "baseAPI", reducer: (state: any = null) => state, middleware: () => (next: any) => (action: any) => next(action) },
  evaluatorAPI: { reducerPath: "evaluatorAPI", reducer: (state: any = null) => state, middleware: () => (next: any) => (action: any) => next(action) },
}));

vi.mock("@constants", () => ({
  en: {
    common: { save: "Save", cancel: "Cancel" },
    componentLibrary: {
      templateNameLabel: "Template name",
      saveAsTemplateDescription: "Give this template a name.",
    },
  },
  QUIZ_QUESTION_TYPE_LABELS: {
    mcq_single: "Single Choice",
    mcq_multi: "Multiple Choice",
    true_false: "True/False",
    ordering: "Ordering",
    matching: "Matching",
    fill_blank: "Fill in the blank",
    open_ended: "Open Ended",
    likert_scale: "Likert Scale",
  },
  TRACK_ITEM_TYPE_LABELS: {
    QUIZ: "Quiz",
  },
  MAX_MCQ_OPTIONS: 10,
  MIN_MCQ_OPTIONS: 2,
  MAX_JOURNAL_PROMPTS: 10,
  MIN_JOURNAL_PROMPTS: 1,
  MIN_VIDEO_WATCH_PCT: 1,
  isComponentLibrarySupportedType: () => true,
  SAVE_AS_TEMPLATE_LABEL: "Save as template",
  Permissions: { EDIT_ADMIN_TRACK: "edit:admin:track" },
  TAG_TYPES: { USERS: "USERS", TENANTS: "TENANTS", SESSION_EVENTS: "SESSION_EVENTS" },
}));

vi.mock("@assets", () => ({
  Plus: () => <span data-testid="plus-icon" />,
  TooltipIcon: () => <span data-testid="tooltip-icon" />,
  Trash: () => <span data-testid="trash-icon" />,
  Save: () => <span data-testid="save-icon" />,
  ArrowSolid: () => <span data-testid="arrow-solid" />,
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  TextArea: (props: any) => <textarea {...props} />,
  TextInput: (props: any) => <input {...props} />,
  Tooltip: ({ children }: any) => <div>{children}</div>,
  htmlToPlainText: (html: string) => html.replace(/<[^>]*>/g, ""),
}));

// Mock components used by QuizItemEditor
vi.mock("@components", () => ({
  RichTextEditor: ({ value, onChange, placeholder }: any) => (
    <div data-testid="rich-text-editor">
      <textarea
        data-testid="mock-tiptap"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  ),
  ToggleSwitch: () => <div data-testid="toggle-switch" />,
  ActionConfirmationPopup: () => null,
}));

// Mock sub-editors to avoid more dependencies
vi.mock("./McqEditor", () => ({ McqEditor: () => null }));
vi.mock("./TrueFalseEditor", () => ({ TrueFalseEditor: () => null }));
vi.mock("./OrderingEditor", () => ({ OrderingEditor: () => null }));
vi.mock("./MatchingEditor", () => ({ MatchingEditor: () => null }));
vi.mock("./FillBlankEditor", () => ({ FillBlankEditor: () => null }));
vi.mock("./OpenEndedEditor", () => ({ OpenEndedEditor: () => null }));
vi.mock("./LikertScaleEditor", () => ({ LikertScaleEditor: () => null }));
vi.mock("./QuestionMediaField", () => ({ QuestionMediaField: () => null }));
vi.mock("./QuizSettingsFields", () => ({ QuizSettingsFields: () => null }));

const TestHarness = ({ defaultValues, onValues }: { defaultValues: any, onValues?: (values: any) => void }) => {
  const methods = useForm({ defaultValues });
  
  return (
    <FormProvider {...methods}>
      <QuizItemEditor sectionIndex={0} itemIndex={0} onDelete={vi.fn()} />
      <ValuesUpdater methods={methods} onValues={onValues} />
    </FormProvider>
  );
};

const ValuesUpdater = ({ methods, onValues }: { methods: any, onValues?: (values: any) => void }) => {
  const values = methods.watch();
  if (onValues) {
    onValues(values);
  }
  return null;
};

describe("QuizItemEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders RichTextEditor for quiz question prompt (R1)", () => {
    const defaultValues = {
      sections: [
        {
          items: [
            {
              type: TrackItemType.QUIZ,
              quiz: {
                questions: [
                  { id: "q1", type: "mcq_single", prompt: "Initial prompt", points: 1, options: [] },
                ],
              },
            },
          ],
        },
      ],
    };

    render(<TestHarness defaultValues={defaultValues} />);

    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    expect(screen.getByTestId("mock-tiptap")).toHaveValue("Initial prompt");
  });

  it("loads existing plain-text prompt into RichTextEditor (R2)", () => {
    const defaultValues = {
      sections: [
        {
          items: [
            {
              type: TrackItemType.QUIZ,
              quiz: {
                questions: [
                  { id: "q1", type: "mcq_single", prompt: "Legacy plain text", points: 1, options: [] },
                ],
              },
            },
          ],
        },
      ],
    };

    render(<TestHarness defaultValues={defaultValues} />);

    expect(screen.getByTestId("mock-tiptap")).toHaveValue("Legacy plain text");
  });

  it("updates both promptHtml and prompt when RichTextEditor changes", async () => {
    let capturedValues: any;
    const defaultValues = {
      sections: [
        {
          items: [
            {
              type: TrackItemType.QUIZ,
              quiz: {
                questions: [
                  { id: "q1", type: "mcq_single", prompt: "Initial", points: 1, options: [] },
                ],
              },
            },
          ],
        },
      ],
    };

    render(<TestHarness defaultValues={defaultValues} onValues={(v) => capturedValues = v} />);

    const textarea = screen.getByTestId("mock-tiptap");
    fireEvent.change(textarea, { target: { value: "New rich text" } });

    expect(capturedValues.sections[0].items[0].quiz.questions[0].promptHtml).toBe("New rich text");
    expect(capturedValues.sections[0].items[0].quiz.questions[0].prompt).toBe("New rich text");
  });
});
