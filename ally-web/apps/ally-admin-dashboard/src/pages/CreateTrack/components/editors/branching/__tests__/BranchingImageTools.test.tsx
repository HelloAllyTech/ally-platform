import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { imageJobStore } from "@hooks/imageStudioJobStore";
import { BranchingScenarioContent, GeneratedImage } from "@types";

const api = vi.hoisted(() => ({
  estimate: vi.fn(),
  createBatch: vi.fn(),
  pollJobs: vi.fn(),
  accept: vi.fn(),
}));

const call =
  (fn: (...args: unknown[]) => unknown) =>
  (...args: unknown[]) => ({ unwrap: () => fn(...args) });

const STYLES = [
  {
    id: "watercolour",
    name: "Watercolour",
    description: "",
    kind: "illustration",
    thumbnailUrl: "",
    swatch: ["#000", "#fff"],
    recommendedSlots: [],
  },
];

vi.mock("@api", () => ({
  useGetImageStudioConfigQuery: () => ({
    data: { enabled: true, maxVariants: 4, maxReferences: 5, maxBatch: 20 },
  }),
  useGetImageStylesQuery: () => ({ data: STYLES }),
  useGetImageSlotsQuery: () => ({ data: [] }),
  useEstimateImagesMutation: () => [call(api.estimate), { isLoading: false }],
  useCreateImageBatchMutation: () => [call(api.createBatch)],
  useCreateImageJobsMutation: () => [call(vi.fn())],
  useLazyGetImageJobsQuery: () => [call(api.pollJobs)],
  useAcceptImageMutation: () => [call(api.accept)],
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));
vi.mock("@assets", () => ({ Close: () => <span />, TooltipIcon: () => <span /> }));
vi.mock("@components/button", () => ({
  Button: ({ children, variant: _variant, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("../../../landing/CharacterPicker", () => ({
  CharacterPicker: ({ onPick, openLabel }: any) => (
    <button type="button" onClick={() => onPick({ id: "c-meera", name: "Meera" })}>
      {openLabel}
    </button>
  ),
}));

import BranchingImageTools from "../BranchingImageTools";

const content: BranchingScenarioContent = {
  startNodeId: "n1",
  imageCast: [{ characterId: "c-ravi", name: "Ravi" }],
  nodes: [
    {
      id: "n1",
      title: "The call starts",
      text: "A caller rings late.",
      image: { url: "https://b/n1.webp" },
      choices: [{ id: "c1", text: "Listen", nextNodeId: "n2" }],
    },
    { id: "n2", title: "She goes quiet", text: "Silence on the line." },
    { id: "n3", text: "She thanks you." },
  ],
};

const queued = (id: string): GeneratedImage => ({
  id,
  batchId: "batch-1",
  slotKind: "scene",
  styleId: "watercolour",
  description: "",
  altText: "",
  status: "queued",
  referenceIds: [],
  createdAt: "2026-11-09T00:00:00Z",
});

const renderTools = () => {
  const props = {
    content,
    trackId: "t-1",
    itemId: "i-1",
    courseStyleId: "watercolour",
    courseTitle: "Listening Well",
    onCastChange: vi.fn(),
    onApplyImage: vi.fn(),
  };
  render(<BranchingImageTools {...props} />);
  return props;
};

describe("BranchingImageTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageJobStore.resetForTests({ intervalMs: 5 });
    api.estimate.mockResolvedValue({ images: 2, perImageUsd: 0.04, totalUsd: 0.08 });
    api.createBatch.mockResolvedValue({
      batchId: "batch-1",
      images: [queued("img-n2"), queued("img-n3")],
    });
    api.pollJobs.mockResolvedValue([
      {
        ...queued("img-n2"),
        status: "succeeded",
        imageUrl: "https://b/img-n2.webp",
        altText: "A quiet phone",
      },
      { ...queued("img-n3"), status: "running" },
    ]);
    api.accept.mockResolvedValue({});
  });

  afterEach(() => imageJobStore.resetForTests());

  it("Fill empty scenes shows the cost first, then generates one image per empty scene", async () => {
    const props = renderTools();
    expect(screen.getByText("2 scenes without a picture.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "✨ Fill empty scenes" }));

    const dialog = screen.getByRole("dialog", { name: "Fill empty scenes" });
    expect(dialog).toHaveTextContent("She goes quiet");
    expect(dialog).toHaveTextContent("Scene 3");
    expect(await screen.findByText("2 images · about $0.08")).toBeInTheDocument();
    const expectedItems = [
      {
        slotKind: "scene",
        slotKey: "track:t-1:item:i-1:node:n2",
        styleId: "watercolour",
        description: "She goes quiet. Silence on the line.",
        variants: 1,
        castCharacterIds: ["c-ravi"],
        context: {
          title: "She goes quiet",
          text: "Silence on the line.",
          courseTitle: "Listening Well",
        },
      },
      {
        slotKind: "scene",
        slotKey: "track:t-1:item:i-1:node:n3",
        styleId: "watercolour",
        description: "She thanks you.",
        variants: 1,
        castCharacterIds: ["c-ravi"],
        context: { text: "She thanks you.", courseTitle: "Listening Well" },
      },
    ];
    expect(api.estimate).toHaveBeenCalledWith({ items: expectedItems });
    // Nothing is spent until the author confirms.
    expect(api.createBatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Generate 2 images" }));
    await waitFor(() => expect(api.createBatch).toHaveBeenCalledWith({ items: expectedItems }));

    // Each image lands on its own scene's slot, and is offered — never applied — per scene.
    expect(imageJobStore.get("track:t-1:item:i-1:node:n3").images[0].id).toBe("img-n3");
    const accept = await screen.findByRole("button", { name: "Accept" });
    expect(props.onApplyImage).not.toHaveBeenCalled();

    fireEvent.click(accept);

    await waitFor(() =>
      expect(props.onApplyImage).toHaveBeenCalledWith("n2", {
        url: "https://b/img-n2.webp",
        alt: "A quiet phone",
      }),
    );
    expect(api.accept).toHaveBeenCalledWith({ id: "img-n2", trackId: "t-1" });
    expect(screen.getByText("Added to the scene.")).toBeInTheDocument();
  });

  it("Cast: adds a character from the library and removes one", () => {
    const props = renderTools();

    fireEvent.click(screen.getByRole("button", { name: "Add to cast" }));
    expect(props.onCastChange).toHaveBeenLastCalledWith([
      { characterId: "c-ravi", name: "Ravi" },
      { characterId: "c-meera", name: "Meera" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Ravi from the cast" }));
    expect(props.onCastChange).toHaveBeenLastCalledWith([]);
  });
});
