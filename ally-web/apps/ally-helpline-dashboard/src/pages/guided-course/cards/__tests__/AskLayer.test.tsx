import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskLayer, formatMoment } from "../AskLayer";

describe("AskLayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("offers 'Ask about this moment' once a playing video stops moving, with the timestamp", () => {
    const onAsk = vi.fn();
    const positionRef: { current: ((seconds: number) => void) | null } = { current: null };
    render(
      <AskLayer type="VIDEO" enabled onAsk={onAsk} positionRef={positionRef}>
        <div>player</div>
      </AskLayer>,
    );
    // Playing: the playhead moves, no chip.
    act(() => {
      positionRef.current?.(10);
      vi.advanceTimersByTime(500);
      positionRef.current?.(11);
      vi.advanceTimersByTime(500);
      positionRef.current?.(83.4);
    });
    expect(screen.queryByTestId("ask-video")).not.toBeInTheDocument();
    // Paused: the same position keeps coming (YouTube polls) or nothing comes (S3).
    act(() => {
      positionRef.current?.(83.4);
      vi.advanceTimersByTime(1600);
    });
    const chip = screen.getByTestId("ask-video");
    expect(chip).toHaveTextContent("1:23");
    fireEvent.click(chip);
    expect(onAsk).toHaveBeenCalledWith({ timestampSec: 83 }, "video");
    // Playing again hides it.
    act(() => {
      positionRef.current?.(90);
    });
    expect(screen.queryByTestId("ask-video")).not.toBeInTheDocument();
  });

  it("stays quiet before the video has played, and while asking is off", () => {
    const positionRef: { current: ((seconds: number) => void) | null } = { current: null };
    const { rerender } = render(
      <AskLayer type="VIDEO" enabled={false} onAsk={vi.fn()} positionRef={positionRef}>
        <div>player</div>
      </AskLayer>,
    );
    act(() => {
      positionRef.current?.(30);
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByTestId("ask-video")).not.toBeInTheDocument();
    rerender(
      <AskLayer type="VIDEO" enabled onAsk={vi.fn()} positionRef={positionRef}>
        <div>player</div>
      </AskLayer>,
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // Paused at 30 s: now it may ask.
    expect(screen.getByTestId("ask-video")).toHaveTextContent("0:30");
  });

  it("a quiz always offers 'Where is this covered?', disabled while asking is off", () => {
    const onAsk = vi.fn();
    const { rerender } = render(
      <AskLayer type="QUIZ" enabled={false} onAsk={onAsk}>
        <div>quiz</div>
      </AskLayer>,
    );
    expect(screen.getByTestId("ask-quiz")).toBeDisabled();
    rerender(
      <AskLayer type="QUIZ" enabled onAsk={onAsk}>
        <div>quiz</div>
      </AskLayer>,
    );
    fireEvent.click(screen.getByTestId("ask-quiz"));
    expect(onAsk).toHaveBeenCalledWith({}, "quiz");
  });

  it("leaves other item types alone", () => {
    render(
      <AskLayer type="ROLEPLAY" enabled onAsk={vi.fn()}>
        <div data-testid="child" />
      </AskLayer>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("formats moments", () => {
    expect(formatMoment(5)).toBe("0:05");
    expect(formatMoment(83.9)).toBe("1:23");
    expect(formatMoment(3723)).toBe("1:02:03");
  });
});
