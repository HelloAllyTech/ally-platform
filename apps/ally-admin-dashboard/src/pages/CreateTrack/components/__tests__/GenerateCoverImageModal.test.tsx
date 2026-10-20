import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerate, mutationState } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mutationState: { isLoading: false },
}));

vi.mock("@api", () => ({
  useGenerateTrackCoverImageMutation: () => [mockGenerate, mutationState],
}));

vi.mock("@assets", () => ({
  Close: () => <span data-testid="close-icon" />,
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  CustomImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

vi.mock("@components", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@constants", () => ({ KeyboardKeys: { ESCAPE: "Escape" } }));

import { GenerateCoverImageModal } from "../GenerateCoverImageModal";

const DEFAULT_PROMPT = "A calm photograph for the course. Rules: no text.";
const IMAGE_URL = "https://bucket.s3.us-east-1.amazonaws.com/track-media/image/1-generated.png";

const resolveWith = (value: unknown) => ({ unwrap: () => Promise.resolve(value) });
const rejectWith = (error: unknown) => ({ unwrap: () => Promise.reject(error) });

const renderModal = (overrides: Partial<Parameters<typeof GenerateCoverImageModal>[0]> = {}) => {
  const props = {
    initialPrompt: DEFAULT_PROMPT,
    defaultPrompt: DEFAULT_PROMPT,
    trackTitle: "Listening Well",
    onPromptChange: vi.fn(),
    onAccept: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<GenerateCoverImageModal {...props} />);
  return props;
};

const promptBox = () => screen.getByLabelText("Prompt") as HTMLTextAreaElement;

describe("GenerateCoverImageModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationState.isLoading = false;
  });

  it("opens on the given prompt and sends it, trimmed, with the course title", async () => {
    mockGenerate.mockReturnValue(resolveWith({ imageUrl: IMAGE_URL }));
    renderModal({ initialPrompt: "  My own prompt for the cover  " });

    expect(promptBox().value).toBe("  My own prompt for the cover  ");
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(mockGenerate).toHaveBeenCalledWith({
      prompt: "My own prompt for the cover",
      trackTitle: "Listening Well",
    });
    expect(await screen.findByAltText("Generated cover image")).toHaveAttribute("src", IMAGE_URL);
  });

  it("accepting hands the image URL to the caller", async () => {
    mockGenerate.mockReturnValue(resolveWith({ imageUrl: IMAGE_URL }));
    const { onAccept } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use as cover" }));

    expect(onAccept).toHaveBeenCalledWith(IMAGE_URL);
  });

  it("rejecting discards the image and returns to the prompt as the trainer left it", async () => {
    mockGenerate.mockReturnValue(resolveWith({ imageUrl: IMAGE_URL }));
    const { onAccept, onClose } = renderModal();

    fireEvent.change(promptBox(), { target: { value: "Watercolour of a park bench at dawn" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));

    expect(screen.queryByAltText("Generated cover image")).not.toBeInTheDocument();
    expect(promptBox().value).toBe("Watercolour of a park bench at dawn");
    expect(onAccept).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(2));
  });

  it("shows the server's message on failure and lets the trainer try again", async () => {
    mockGenerate.mockReturnValueOnce(
      rejectWith({ data: { message: "The image service couldn't use this prompt." } }),
    );
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The image service couldn't use this prompt.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("falls back to a generic message when the error has none", async () => {
    mockGenerate.mockReturnValueOnce(rejectWith(new Error("network")));
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't generate an image/);
  });

  it("won't send a prompt that is too short to describe anything", () => {
    renderModal({ initialPrompt: "  cat  " });
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
  });

  it("reports edits and can reset to the default prompt", () => {
    const { onPromptChange } = renderModal();
    const reset = screen.getByRole("button", { name: "Reset to default" });
    expect(reset).toBeDisabled();

    fireEvent.change(promptBox(), { target: { value: "Something else entirely" } });
    expect(onPromptChange).toHaveBeenLastCalledWith("Something else entirely");
    expect(reset).toBeEnabled();

    fireEvent.click(reset);
    expect(promptBox().value).toBe(DEFAULT_PROMPT);
    expect(onPromptChange).toHaveBeenLastCalledWith(DEFAULT_PROMPT);
  });

  it("locks the prompt and the button while an image is generating", () => {
    mutationState.isLoading = true;
    renderModal();

    expect(promptBox()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Generating…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/20–60 seconds/);
  });

  it("closes on Escape and on Cancel", () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
