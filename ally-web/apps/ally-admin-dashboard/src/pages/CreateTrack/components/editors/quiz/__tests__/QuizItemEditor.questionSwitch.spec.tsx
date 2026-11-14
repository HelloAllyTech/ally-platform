import { fireEvent, render, screen, within } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrackItemType } from "@types";

import { QuizItemEditor } from "../QuizItemEditor";

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
  MAX_LIKERT_SCALE_POINTS: 7,
  MIN_LIKERT_SCALE_POINTS: 2,
  MAX_LIKERT_STATEMENTS: 20,
  MIN_LIKERT_STATEMENTS: 1,
  LIKERT_SCALE_PRESETS: [],
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
  BinaryClassification: () => <span data-testid="binary-classification" />,
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  TextArea: (props: any) => <textarea {...props} />,
  TextInput: (props: any) => <input {...props} />,
  Select: ({ children, labelText: _l, hideLabel: _h, ...props }: any) => (
    <select {...props}>{children}</select>
  ),
  SelectItem: ({ text, ...props }: any) => <option {...props}>{text}</option>,
  Tooltip: ({ children }: any) => <div>{children}</div>,
  htmlToPlainText: (html: string) => html.replace(/<[^>]*>/g, ""),
  escapeHtml: (text: string) => text,
}));

// Mock components used by QuizItemEditor
vi.mock("@components", () => ({
  ToggleSwitch: () => <div data-testid="toggle-switch" />,
  ActionConfirmationPopup: () => null,
}));

// Mock sub-editors to avoid more dependencies
vi.mock("../TrueFalseEditor", () => ({ TrueFalseEditor: () => null }));
vi.mock("../OrderingEditor", () => ({ OrderingEditor: () => null }));
vi.mock("../MatchingEditor", () => ({ MatchingEditor: () => null }));
vi.mock("../FillBlankEditor", () => ({ FillBlankEditor: () => null }));
vi.mock("../OpenEndedEditor", () => ({ OpenEndedEditor: () => null }));
vi.mock("../QuestionMediaField", () => ({ QuestionMediaField: () => null }));
vi.mock("../QuizSettingsFields", () => ({ QuizSettingsFields: () => null }));

/**
 * Regression: the question panel used to be one long-lived component whose
 * field-array paths changed as you switched questions, so react-hook-form's
 * `useFieldArray` carried the previous question's options over — a 4-point
 * scale's 4th point appeared on a 3-point question, and deleting it there
 * deleted it from the first question too.
 */
const scale = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-s${i}`,
    text: `${prefix} point ${i + 1}`,
  }));

const likert = (id: string, points: number) => ({
  id,
  type: "likert_scale",
  prompt: id,
  points: 0,
  scale: scale(id, points),
  statements: [{ id: `${id}-st0`, text: `${id} statement` }],
});

const Harness = ({ onValues }: { onValues: (values: any) => void }) => {
  const methods = useForm({
    defaultValues: {
      sections: [
        {
          items: [
            { type: TrackItemType.QUIZ, quiz: { questions: [likert("a", 4), likert("b", 3)] } },
          ],
        },
      ],
    } as any,
  });
  onValues(methods.watch());
  return (
    <FormProvider {...methods}>
      <QuizItemEditor sectionIndex={0} itemIndex={0} onDelete={vi.fn()} />
    </FormProvider>
  );
};

const scaleInputs = () => screen.getAllByPlaceholderText(/^Scale point \d+$/) as HTMLInputElement[];

describe("QuizItemEditor — switching between Likert questions", () => {
  it("keeps each question's scale points separate", () => {
    let values: any;
    render(<Harness onValues={v => (values = v)} />);
    const questionsOf = () => values.sections[0].items[0].quiz.questions;

    expect(scaleInputs()).toHaveLength(4);

    fireEvent.click(screen.getByText("2. Likert Scale"));
    expect(scaleInputs().map(input => input.value)).toEqual([
      "b point 1",
      "b point 2",
      "b point 3",
    ]);

    // Delete a point on question 2; question 1 must be untouched.
    const row = scaleInputs()[2].parentElement as HTMLElement;
    fireEvent.click(within(row).getByLabelText("Remove"));
    expect(questionsOf()[1].scale.map((p: any) => p.id)).toEqual(["b-s0", "b-s1"]);
    expect(questionsOf()[0].scale.map((p: any) => p.id)).toEqual(["a-s0", "a-s1", "a-s2", "a-s3"]);

    fireEvent.click(screen.getByText("1. Likert Scale"));
    expect(scaleInputs()).toHaveLength(4);
    expect(questionsOf()[1].scale).toHaveLength(2);
  });
});

const mcq = (id: string, n: number) => ({
  id,
  type: "mcq_single",
  prompt: id,
  points: 1,
  options: Array.from({ length: n }, (_, i) => ({
    id: `${id}-o${i}`,
    text: `${id} option ${i + 1}`,
  })),
  correctOptionIds: [`${id}-o0`],
});

const McqHarness = ({ onValues }: { onValues: (values: any) => void }) => {
  const methods = useForm({
    defaultValues: {
      sections: [
        { items: [{ type: TrackItemType.QUIZ, quiz: { questions: [mcq("a", 2), mcq("b", 2)] } }] },
      ],
    } as any,
  });
  onValues(methods.watch());
  return (
    <FormProvider {...methods}>
      <QuizItemEditor sectionIndex={0} itemIndex={0} onDelete={vi.fn()} />
    </FormProvider>
  );
};

const optionInputs = () => screen.getAllByPlaceholderText(/^Option \d+$/) as HTMLInputElement[];

describe("QuizItemEditor — switching between multiple-choice questions", () => {
  it("keeps options added to a question after moving to the next one and back", () => {
    let values: any;
    render(<McqHarness onValues={v => (values = v)} />);
    const questionsOf = () => values.sections[0].items[0].quiz.questions;

    fireEvent.click(screen.getByText(/Add option/i));
    fireEvent.change(optionInputs()[2], { target: { value: "a option 3" } });
    expect(questionsOf()[0].options).toHaveLength(3);

    fireEvent.click(screen.getByText("2. Single Choice"));
    expect(optionInputs().map(input => input.value)).toEqual(["b option 1", "b option 2"]);

    fireEvent.click(screen.getByText("1. Single Choice"));
    expect(optionInputs().map(input => input.value)).toEqual([
      "a option 1",
      "a option 2",
      "a option 3",
    ]);
    expect(questionsOf()[0].options).toHaveLength(3);
    expect(questionsOf()[1].options).toHaveLength(2);
  });
});
