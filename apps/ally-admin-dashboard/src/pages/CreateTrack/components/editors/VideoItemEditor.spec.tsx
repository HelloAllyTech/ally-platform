import { act, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, UseFormReturn, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrackItemType } from "@types";

import { VideoItemEditor } from "./VideoItemEditor";

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
  TRACK_ITEM_TYPE_LABELS: { VIDEO: "Video" },
  QUIZ_QUESTION_TYPE_LABELS: { mcq_single: "Single Choice" },
  MAX_MCQ_OPTIONS: 10,
  MIN_MCQ_OPTIONS: 2,
  MAX_JOURNAL_PROMPTS: 10,
  MIN_JOURNAL_PROMPTS: 1,
  MIN_VIDEO_WATCH_PCT: 1,
  MAX_VIDEO_WATCH_PCT: 100,
  DEFAULT_VIDEO_WATCH_PCT: 90,
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

vi.mock("@components", () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  ButtonVariant: { PRIMARY: "primary", SECONDARY: "secondary", DESTRUCTIVE: "destructive" },
  ToggleSwitch: () => null,
  ActionConfirmationPopup: () => null,
  SegmentedToggle: () => <div data-testid="segmented-toggle" />,
}));

// We don't mock RichTextEditor anymore to test against the real component (R1)

const TestHarness = ({
  defaultValues,
  onForm,
}: {
  defaultValues: any;
  onForm?: (methods: UseFormReturn<any>) => void;
}) => {
  const methods = useForm({ defaultValues });
  // Reading isDirty subscribes the form to it, as the page does.
  void methods.formState.isDirty;
  onForm?.(methods);
  return (
    <FormProvider {...methods}>
      <VideoItemEditor sectionIndex={0} itemIndex={0} onDelete={vi.fn()} />
    </FormProvider>
  );
};

describe("VideoItemEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders RichTextEditor for questions in a video interjection (R1)", () => {
    const defaultValues = {
      sections: [
        {
          items: [
            {
              type: TrackItemType.VIDEO,
              video: {
                source: "s3",
                url: "video.mp4",
                interjections: [
                  {
                    id: "int1",
                    timestampSeconds: 10,
                    question: {
                      id: "q1",
                      type: "mcq_single",
                      prompt: "Interjection question",
                      options: [],
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    render(<TestHarness defaultValues={defaultValues} />);

    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    expect(screen.getByTestId("rich-text-editor")).toHaveTextContent("Interjection question");
  });

  describe("video metadata loading", () => {
    // A legacy video whose first interjection was authored before promptHtml
    // existed: that question has no promptHtml key at all.
    const legacyVideo = (durationSeconds?: number) => ({
      sections: [
        {
          items: [
            {
              type: TrackItemType.VIDEO,
              video: {
                source: "s3",
                url: "video.mp4",
                ...(durationSeconds != null ? { durationSeconds } : {}),
                interjections: [
                  {
                    id: "int1",
                    timestampSeconds: 10,
                    question: {
                      id: "q1",
                      type: "mcq_single",
                      prompt: "Which two ideas are gender-affirming?",
                      options: [],
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const loadMetadata = (duration: number) => {
      let form!: UseFormReturn<any>;
      const { container } = render(
        <TestHarness
          defaultValues={legacyVideo(395.649733)}
          onForm={methods => {
            form = methods;
          }}
        />,
      );
      return { container, form: () => form, duration };
    };

    const fireLoadedMetadata = (video: HTMLVideoElement, duration: number) => {
      Object.defineProperty(video, "duration", { configurable: true, value: duration });
      act(() => {
        fireEvent.loadedMetadata(video);
      });
    };

    // Opening a video item loads its metadata. Re-saving the duration it
    // already has used to run the whole-form dirty check, which flagged the
    // course as unsaved for a video nobody touched.
    it("does not mark the form dirty when the loaded duration matches the stored one", () => {
      const { container, form } = loadMetadata(395.649733);
      const video = container.querySelector("video") as HTMLVideoElement;

      fireLoadedMetadata(video, 395.649733);

      expect(form().formState.isDirty).toBe(false);
    });

    it("treats a sub-frame difference in the reported duration as unchanged", () => {
      const { container, form } = loadMetadata(395.649733);
      const video = container.querySelector("video") as HTMLVideoElement;

      fireLoadedMetadata(video, 395.649734);

      expect(form().formState.isDirty).toBe(false);
    });

    it("marks the form dirty when the video's real duration has changed", () => {
      const { container, form } = loadMetadata(395.649733);
      const video = container.querySelector("video") as HTMLVideoElement;

      fireLoadedMetadata(video, 410);

      expect(form().formState.isDirty).toBe(true);
      expect(form().getValues("sections.0.items.0.video.durationSeconds")).toBe(410);
    });

    it("records the duration of a video that has none stored yet", () => {
      let form!: UseFormReturn<any>;
      const { container } = render(
        <TestHarness
          defaultValues={legacyVideo()}
          onForm={methods => {
            form = methods;
          }}
        />,
      );
      const video = container.querySelector("video") as HTMLVideoElement;

      fireLoadedMetadata(video, 120);

      expect(form.formState.isDirty).toBe(true);
      expect(form.getValues("sections.0.items.0.video.durationSeconds")).toBe(120);
    });
  });
});
