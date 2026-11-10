import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { imageJobStore } from "@hooks/imageStudioJobStore";
import { GeneratedImage, ImageSlotProfile, ImageStyle } from "@types";

const api = vi.hoisted(() => ({
  config: { enabled: true, maxVariants: 4, maxReferences: 5, maxBatch: 20 },
  styles: [] as ImageStyle[],
  slots: [] as ImageSlotProfile[],
  history: [] as GeneratedImage[],
  describe: vi.fn(),
  createJobs: vi.fn(),
  pollJobs: vi.fn(),
  accept: vi.fn(),
}));

const call =
  (fn: (...args: unknown[]) => unknown) =>
  (...args: unknown[]) => ({ unwrap: () => fn(...args) });

vi.mock("@api", () => ({
  useGetImageStudioConfigQuery: () => ({ data: api.config }),
  useGetImageStylesQuery: () => ({ data: api.styles, isLoading: false }),
  useGetImageSlotsQuery: () => ({ data: api.slots }),
  useGetImageHistoryQuery: () => ({ data: api.history }),
  useDescribeImageMutation: () => [call(api.describe), { isLoading: false }],
  useAcceptImageMutation: () => [call(api.accept)],
  useCreateImageJobsMutation: () => [call(api.createJobs)],
  useCreateImageBatchMutation: () => [call(vi.fn())],
  useLazyGetImageJobsQuery: () => [call(api.pollJobs)],
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));

// The real Button reaches the app store through @utils.
vi.mock("@components/button", () => ({
  Button: ({ children, variant: _variant, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@assets", () => ({
  Close: () => <span />,
  TooltipIcon: () => <span />,
}));

import { GenerateImageModal, GenerateImageModalProps } from "../GenerateImageModal";

const style = (id: string, name: string): ImageStyle => ({
  id,
  name,
  description: `${name} style`,
  kind: "photo",
  thumbnailUrl: `https://cdn/thumbs/${id}.webp`,
  swatch: ["#111111", "#eeeeee"],
  recommendedSlots: [],
});

const slot = (overrides: Partial<ImageSlotProfile> = {}): ImageSlotProfile => ({
  kind: "scene",
  label: "Scene",
  width: 1536,
  height: 1024,
  aspectRatio: "3:2",
  allowsReferences: true,
  defaultStyleId: "watercolour",
  defaultVariants: 2,
  ...overrides,
});

const image = (overrides: Partial<GeneratedImage> = {}): GeneratedImage => ({
  id: "img-1",
  batchId: "b-1",
  slotKind: "scene",
  styleId: "documentary_photo",
  description: "A man waiting by a window",
  altText: "",
  status: "queued",
  referenceIds: [],
  createdAt: "2026-11-09T00:00:00Z",
  ...overrides,
});

const URL_1 = "https://bucket.s3.amazonaws.com/image-studio/img-1.webp";

const renderModal = (overrides: Partial<GenerateImageModalProps> = {}) => {
  const props: GenerateImageModalProps = {
    slotKind: "scene",
    slotKey: "track:t-1:item:i-1:node:n-2",
    context: { title: "The caller goes quiet", text: "  He stops talking. ", persona: {} },
    trackId: "t-1",
    onAccept: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<GenerateImageModal {...props} />);
  return { props, ...view };
};

const descriptionBox = () => screen.getByLabelText("Description") as HTMLTextAreaElement;
const styleRadio = (name: string) => screen.getByRole("radio", { name: new RegExp(name) });

const generateOnce = async () => {
  fireEvent.change(descriptionBox(), { target: { value: "A man waiting by a window" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  await waitFor(() => expect(api.createJobs).toHaveBeenCalled());
};

describe("GenerateImageModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageJobStore.resetForTests({ intervalMs: 5 });
    window.localStorage.clear();
    api.styles = [
      style("documentary_photo", "Documentary photo"),
      style("watercolour", "Watercolour"),
    ];
    api.slots = [slot()];
    api.history = [];
    api.createJobs.mockResolvedValue({ batchId: "b-1", images: [image()] });
    api.pollJobs.mockResolvedValue([
      image({ status: "succeeded", imageUrl: URL_1, altText: "A man by a window" }),
    ]);
    api.accept.mockResolvedValue(image({ status: "succeeded", imageUrl: URL_1 }));
  });

  afterEach(() => {
    imageJobStore.resetForTests();
  });

  describe("style", () => {
    it("opens on the course's style, and notes when another style is picked", () => {
      renderModal({ courseStyleId: "documentary_photo" });

      expect(screen.getByRole("dialog", { name: "Generate an image" })).toHaveAttribute(
        "aria-modal",
        "true",
      );
      expect(styleRadio("Documentary photo")).toBeChecked();
      expect(screen.queryByText("Doesn't match this course's style")).not.toBeInTheDocument();

      fireEvent.click(styleRadio("Watercolour"));

      expect(styleRadio("Watercolour")).toBeChecked();
      expect(screen.getByText("Doesn't match this course's style")).toBeInTheDocument();
    });

    it("without a course style, opens on the slot's default style", () => {
      window.localStorage.setItem("imageStudio.lastStyleId", "documentary_photo");
      renderModal();

      expect(styleRadio("Watercolour")).toBeChecked();
    });

    it("falls back to the last style used when the slot has no profile", () => {
      api.slots = [];
      window.localStorage.setItem("imageStudio.lastStyleId", "watercolour");
      renderModal();

      expect(styleRadio("Watercolour")).toBeChecked();
    });

    it("shows the style's swatch when its thumbnail fails to load", () => {
      renderModal();
      const thumb = screen.getByTestId("style-thumb-watercolour");

      fireEvent.error(thumb.querySelector("img")!);

      // The span behind it carries the swatch gradient (see utils.test for the CSS).
      expect(thumb.querySelector("img")).toBeNull();
      expect(thumb).toBeInTheDocument();
    });
  });

  it("Suggest from content fills the description from the slot's context", async () => {
    api.describe.mockResolvedValue({
      description: "A man sitting by a window at dusk, looking down",
      altText: "A man sitting alone by a window",
      safety: { ok: true },
    });
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "✨ Suggest from content" }));

    await waitFor(() =>
      expect(descriptionBox().value).toBe("A man sitting by a window at dusk, looking down"),
    );
    expect(api.describe).toHaveBeenCalledWith({
      slotKind: "scene",
      styleId: "watercolour",
      // Blank fields are left out; text is trimmed.
      context: { title: "The caller goes quiet", text: "He stops talking." },
    });
    expect(
      screen.getByText("Describe the picture. Don't include real client details."),
    ).toBeVisible();
  });

  it("generates, polls until the image is ready, and Use this accepts it and hands it back", async () => {
    const { props } = renderModal({ castOptions: [{ characterId: "c-ravi", name: "Ravi" }] });

    await generateOnce();

    expect(api.createJobs).toHaveBeenCalledWith({
      slotKind: "scene",
      slotKey: "track:t-1:item:i-1:node:n-2",
      styleId: "watercolour",
      description: "A man waiting by a window",
      variants: 2,
      castCharacterIds: ["c-ravi"],
      context: { title: "The caller goes quiet", text: "He stops talking." },
    });
    expect(
      screen.getByText("Generating — usually under a minute. You can close this and keep working."),
    ).toBeInTheDocument();

    const result = await screen.findByAltText("A man by a window");
    expect(result).toHaveAttribute("src", URL_1);
    expect(api.pollJobs).toHaveBeenCalledWith(["img-1"]);

    fireEvent.click(screen.getByRole("button", { name: "Use this" }));

    await waitFor(() =>
      expect(props.onAccept).toHaveBeenCalledWith({
        url: URL_1,
        altText: "A man by a window",
        imageId: "img-1",
      }),
    );
    expect(api.accept).toHaveBeenCalledWith({ id: "img-1", trackId: "t-1" });
    // Used: the slot's in-flight results are cleared.
    expect(imageJobStore.get("track:t-1:item:i-1:node:n-2").images).toHaveLength(0);
  });

  it("keeps results when closed: reopening shows them", async () => {
    const { unmount } = renderModal();
    await generateOnce();
    unmount();

    await waitFor(() =>
      expect(imageJobStore.get("track:t-1:item:i-1:node:n-2").images[0]?.status).toBe("succeeded"),
    );
    renderModal();

    expect(screen.getByAltText("A man by a window")).toBeInTheDocument();
  });

  it("flags a result the check thinks may not match", async () => {
    api.pollJobs.mockResolvedValue([
      image({
        status: "succeeded",
        imageUrl: URL_1,
        altText: "A man by a window",
        check: {
          passed: false,
          issues: ["The man has a beard; the description says clean-shaven."],
        },
      }),
    ]);
    renderModal();
    await generateOnce();

    expect(await screen.findByText(/May not match — check closely/)).toBeInTheDocument();
    expect(
      screen.getByText("The man has a beard; the description says clean-shaven."),
    ).toBeInTheDocument();
  });

  it("shows why a description was blocked, and how to reword it", async () => {
    api.createJobs.mockRejectedValue({
      status: 422,
      data: {
        message: "Blocked",
        safety: {
          ok: false,
          reason: "Images can't show self-harm.",
          suggestion: "Show the emotion and body language, not the act.",
        },
      },
    });
    renderModal();

    await generateOnce();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Images can't show self-harm.");
    expect(alert).toHaveTextContent("Try: Show the emotion and body language, not the act.");
  });

  it("says to wait when too many images are already generating (429)", async () => {
    api.createJobs.mockRejectedValue({ status: 429, data: { message: "Too many" } });
    renderModal();

    await generateOnce();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You have several images generating — wait for one to finish.",
    );
  });

  it("hides Generate when Image Studio is off", () => {
    api.config = { ...api.config, enabled: false };
    renderModal();
    api.config = { ...api.config, enabled: true };

    expect(screen.queryByRole("button", { name: "Generate" })).not.toBeInTheDocument();
  });

  it("Refine sends the image, the instruction and the image itself as a reference", async () => {
    renderModal();
    await generateOnce();
    await screen.findByAltText("A man by a window");
    api.createJobs.mockResolvedValueOnce({
      batchId: "b-2",
      images: [image({ id: "img-2", refinedFromId: "img-1" })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Refine" }));
    fireEvent.change(screen.getByLabelText("What should change?"), {
      target: { value: "Make him look more worried" },
    });
    const refineForm = screen.getByLabelText("What should change?").closest("div")!;
    fireEvent.click(within(refineForm).getByRole("button", { name: "Refine" }));

    await waitFor(() => expect(api.createJobs).toHaveBeenCalledTimes(2));
    expect(api.createJobs).toHaveBeenLastCalledWith({
      slotKind: "scene",
      slotKey: "track:t-1:item:i-1:node:n-2",
      styleId: "documentary_photo",
      description: "A man waiting by a window",
      variants: 1,
      refine: { imageId: "img-1", instruction: "Make him look more worried" },
      references: [{ role: "previous", imageId: "img-1", label: "The image to change" }],
      context: { title: "The caller goes quiet", text: "He stops talking." },
    });
  });

  it("sends the references the author turned on, plus the course's style example", async () => {
    renderModal({
      courseStyleId: "watercolour",
      courseStyleAnchorId: "anchor-1",
      referenceOptions: {
        suggested: [
          {
            key: "previous:n-1",
            role: "previous",
            label: "Scene: The call starts",
            thumbnailUrl: "https://bucket/n1.webp",
            url: "https://bucket/n1.webp",
          },
        ],
      },
    });

    const chip = screen.getByRole("button", { name: /Scene: The call starts/ });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    await generateOnce();

    expect(api.createJobs.mock.calls[0][0].references).toEqual([
      { role: "previous", label: "Scene: The call starts", url: "https://bucket/n1.webp" },
      { role: "style", imageId: "anchor-1" },
    ]);
  });

  it("an earlier try can be picked and used", async () => {
    api.history = [image({ id: "old-1", status: "succeeded", imageUrl: "https://b/old.webp" })];
    const { props } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: /Earlier try 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));

    await waitFor(() =>
      expect(props.onAccept).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://b/old.webp", imageId: "old-1" }),
      ),
    );
  });

  it("closes on Escape", () => {
    const { props } = renderModal();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(props.onClose).toHaveBeenCalled();
  });
});
