import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DescriptionNarrationButton } from "../DescriptionNarrationButton";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

let instance: {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  onended?: () => void;
  onerror?: () => void;
};
let playImpl: () => Promise<void>;

beforeEach(() => {
  playImpl = () => Promise.resolve();
  vi.stubGlobal(
    "Audio",
    vi.fn(function (this: unknown) {
      instance = { play: vi.fn(() => playImpl()), pause: vi.fn() };
      return instance;
    }),
  );
});

const button = () => screen.getByTestId("description-narration-button");

describe("DescriptionNarrationButton", () => {
  it("renders nothing without a URL", () => {
    render(<DescriptionNarrationButton audioUrl={null} />);
    expect(screen.queryByTestId("description-narration-button")).toBeNull();
  });

  it("shows the button when a URL exists", () => {
    render(<DescriptionNarrationButton audioUrl="https://x/a.mp3" />);
    expect(button()).toHaveAttribute("data-state", "idle");
  });

  it("goes loading → playing → paused → playing", async () => {
    let resolve!: () => void;
    playImpl = () => new Promise<void>(r => (resolve = r));
    render(<DescriptionNarrationButton audioUrl="https://x/a.mp3" />);
    fireEvent.click(button());
    expect(button()).toHaveAttribute("data-state", "loading");
    await act(async () => resolve());
    expect(button()).toHaveAttribute("data-state", "playing");
    playImpl = () => Promise.resolve();
    fireEvent.click(button());
    expect(button()).toHaveAttribute("data-state", "paused");
    expect(instance.pause).toHaveBeenCalled();
    await act(async () => fireEvent.click(button()));
    expect(button()).toHaveAttribute("data-state", "playing");
  });

  it("shows an error and keeps the page usable when playback fails", async () => {
    playImpl = () => Promise.reject(new Error("blocked"));
    render(<DescriptionNarrationButton audioUrl="https://x/a.mp3" />);
    await act(async () => fireEvent.click(button()));
    expect(button()).toHaveAttribute("data-state", "error");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("returns to idle when the audio ends", async () => {
    render(<DescriptionNarrationButton audioUrl="https://x/a.mp3" />);
    await act(async () => fireEvent.click(button()));
    act(() => instance.onended?.());
    expect(button()).toHaveAttribute("data-state", "idle");
  });
});
