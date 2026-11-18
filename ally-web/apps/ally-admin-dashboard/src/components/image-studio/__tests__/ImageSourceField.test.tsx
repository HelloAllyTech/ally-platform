import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { imageJobStore } from "@hooks/imageStudioJobStore";
import { GeneratedImage } from "@types";

const { enabled, modalProps } = vi.hoisted(() => ({
  enabled: { current: true },
  modalProps: { current: null as any },
}));

vi.mock("../useImageStudioEnabled", () => ({
  useImageStudioEnabled: () => enabled.current,
  markImageStudioDisabled: vi.fn(),
}));

// The modal has its own tests; here it only reports what it was opened with.
vi.mock("../GenerateImageModal", () => ({
  GenerateImageModal: (props: any) => {
    modalProps.current = props;
    return (
      <div role="dialog">
        <button
          type="button"
          onClick={() =>
            props.onAccept({ url: "https://b/gen.webp", altText: "Alt", imageId: "g-1" })
          }
        >
          Use this
        </button>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </div>
    );
  },
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock("../../button", () => ({
  Button: ({ children, variant: _variant, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

// The chip reads the store only; the hook module's API imports are not exercised.
vi.mock("@api", () => ({}));

import { CourseImageContext } from "../CourseImageContext";
import { ImageSourceField } from "../ImageSourceField";

const SLOT = "track:t-1:item:i-1:cover";

const image = (id: string, status: GeneratedImage["status"]): GeneratedImage => ({
  id,
  batchId: "b",
  slotKind: "article_cover",
  styleId: "watercolour",
  description: "d",
  altText: "",
  status,
  ...(status === "succeeded" ? { imageUrl: `https://b/${id}.webp` } : {}),
  referenceIds: [],
  createdAt: "2026-11-09T00:00:00Z",
});

const renderField = (onAccept = vi.fn()) => {
  render(
    <CourseImageContext.Provider
      value={{
        trackId: "t-1",
        courseStyleId: "watercolour",
        courseStyleAnchorId: "a-1",
        courseTitle: "Listening Well",
      }}
    >
      <ImageSourceField
        slotKind="article_cover"
        slotKey={SLOT}
        context={{ title: "Grief at work" }}
        onAccept={onAccept}
      >
        <button type="button">Upload cover photo</button>
      </ImageSourceField>
    </CourseImageContext.Provider>,
  );
  return onAccept;
};

describe("ImageSourceField", () => {
  beforeEach(() => {
    enabled.current = true;
    modalProps.current = null;
    imageJobStore.resetForTests();
  });

  afterEach(() => imageJobStore.resetForTests());

  it("keeps the slot's own upload UI and adds Generate beside it", async () => {
    renderField();

    expect(screen.getByRole("button", { name: "Upload cover photo" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Generate an image with AI" }),
    ).toBeInTheDocument();
  });

  it("leaves Generate out entirely when Image Studio is off", () => {
    enabled.current = false;
    renderField();

    expect(screen.getByRole("button", { name: "Upload cover photo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate an image with AI" })).toBeNull();
  });

  it("opens the modal with the course's style, example, id and title by default", async () => {
    renderField();

    fireEvent.click(await screen.findByRole("button", { name: "Generate an image with AI" }));

    expect(modalProps.current).toMatchObject({
      slotKind: "article_cover",
      slotKey: SLOT,
      courseStyleId: "watercolour",
      courseStyleAnchorId: "a-1",
      trackId: "t-1",
      context: { courseTitle: "Listening Well", title: "Grief at work" },
    });
  });

  it("hands an accepted image to the slot and closes", async () => {
    const onAccept = renderField();
    fireEvent.click(await screen.findByRole("button", { name: "Generate an image with AI" }));

    fireEvent.click(screen.getByRole("button", { name: "Use this" }));

    expect(onAccept).toHaveBeenCalledWith({
      url: "https://b/gen.webp",
      altText: "Alt",
      imageId: "g-1",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows Generating… while this slot's images are in flight, then how many are ready", async () => {
    renderField();
    await screen.findByRole("button", { name: "Generate an image with AI" });

    act(() => imageJobStore.add(SLOT, [image("a", "running"), image("b", "queued")]));
    expect(screen.getByRole("button", { name: "Generating…" })).toBeInTheDocument();

    act(() => imageJobStore.add(SLOT, [image("a", "succeeded"), image("b", "succeeded")]));
    const chip = screen.getByRole("button", { name: "2 images ready — review" });

    fireEvent.click(chip);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
