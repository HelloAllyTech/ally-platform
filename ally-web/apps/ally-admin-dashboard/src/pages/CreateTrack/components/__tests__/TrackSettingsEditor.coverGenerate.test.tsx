import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrackFormValues } from "@types";

const { mockToastSuccess, sourceProps, pickerProps } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  sourceProps: { current: null as any },
  pickerProps: { current: null as any },
}));

vi.mock("sonner", () => ({ toast: { success: mockToastSuccess, error: vi.fn() } }));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  CustomImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock("@assets", () => ({
  TooltipIcon: () => <span data-testid="tooltip-icon" />,
  Trash: () => <span data-testid="trash" />,
}));

vi.mock("@components", () => ({
  Button: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  ToggleSwitch: () => null,
}));

vi.mock("@components/rich-text-editor", () => ({ RichTextEditor: () => <div /> }));

// Image Studio, stubbed: the Generate modal and style gallery have their own tests.
vi.mock("@components/image-studio", async () => {
  const utils = await vi.importActual<typeof import("@components/image-studio/utils")>(
    "@components/image-studio/utils",
  );
  return {
    toContextText: utils.toContextText,
    courseSlotPrefix: (trackId?: string | null) => `track:${trackId || "new"}`,
    ImageSourceField: (props: any) => {
      sourceProps.current = props;
      return (
        <div>
          {props.children}
          <button
            type="button"
            onClick={() =>
              props.onAccept({
                url: "https://bucket.s3.amazonaws.com/image-studio/gen.webp",
                altText: "People talking",
                imageId: "gen-1",
              })
            }
          >
            Use generated cover
          </button>
        </div>
      );
    },
    LazyCourseStylePicker: (props: any) => {
      pickerProps.current = props;
      return (
        <div>
          <button type="button" onClick={() => props.onChange("watercolour")}>
            Pick watercolour
          </button>
          <button type="button" onClick={props.onClearAnchor}>
            Clear example
          </button>
        </div>
      );
    },
  };
});

vi.mock("../../useTrackMediaUpload", () => ({
  useTrackMediaUpload: () => ({ upload: vi.fn(), isUploading: false }),
}));

vi.mock("../CourseShareLink", () => ({ CourseShareLink: () => null }));
vi.mock("../TrackCompetenciesField", () => ({ TrackCompetenciesField: () => null }));

import { TrackSettingsEditor } from "../TrackSettingsEditor";

let latest: { values: TrackFormValues; dirty: Record<string, unknown> } | null = null;

const Harness = ({ defaults = {} }: { defaults?: Partial<TrackFormValues> }) => {
  const methods = useForm<TrackFormValues>({
    defaultValues: {
      title: "Listening Well",
      description: "<p>Learn to listen.</p><p>Then reflect.</p>",
      coverImageUrl: "",
      isGlobal: false,
      isPublicView: false,
      competencyIds: [],
      sections: [],
      ...defaults,
    },
  });
  latest = {
    values: methods.watch(),
    dirty: methods.formState.dirtyFields as Record<string, unknown>,
  };
  return (
    <FormProvider {...methods}>
      <TrackSettingsEditor trackId="t-1" isPublished={false} />
    </FormProvider>
  );
};

describe("TrackSettingsEditor — Image Studio cover and course style", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sourceProps.current = null;
    pickerProps.current = null;
    latest = null;
  });

  it("offers Generate on the cover as a course cover, with the course's title and plain-text description", () => {
    render(<Harness defaults={{ imageStyleId: "documentary_photo", imageStyleAnchorId: "a-1" }} />);

    expect(sourceProps.current.slotKind).toBe("course_cover");
    expect(sourceProps.current.slotKey).toBe("track:t-1:cover");
    expect(sourceProps.current.trackId).toBe("t-1");
    expect(sourceProps.current.courseStyleId).toBe("documentary_photo");
    expect(sourceProps.current.courseStyleAnchorId).toBe("a-1");
    expect(sourceProps.current.context).toEqual({
      title: "Listening Well",
      text: "Learn to listen. Then reflect.",
    });
    // The upload control is still there, unchanged.
    expect(screen.getByRole("button", { name: "+ Upload cover image" })).toBeInTheDocument();
  });

  it("an accepted image becomes the cover as an unsaved change", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Use generated cover" }));

    expect(screen.getByAltText("Cover")).toHaveAttribute(
      "src",
      "https://bucket.s3.amazonaws.com/image-studio/gen.webp",
    );
    expect(latest?.dirty.coverImageUrl).toBe(true);
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringMatching(/Save the course/));
  });

  it("the Visual style picker sets the course style, and Clear removes the style example", () => {
    render(<Harness defaults={{ imageStyleId: null, imageStyleAnchorId: "a-1" }} />);
    expect(pickerProps.current.value).toBeNull();
    expect(pickerProps.current.anchorId).toBe("a-1");

    fireEvent.click(screen.getByRole("button", { name: "Pick watercolour" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));

    expect(latest?.values.imageStyleId).toBe("watercolour");
    expect(latest?.values.imageStyleAnchorId).toBeNull();
    expect(latest?.dirty.imageStyleId).toBe(true);
  });
});
