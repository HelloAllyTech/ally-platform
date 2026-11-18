import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentedRecorder } from "../SegmentedRecorder";

/** Minimal MediaRecorder: one blob per start/stop, like the real one with no timeslice. */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;
  state: RecordingState = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

describe("SegmentedRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts a new standalone recording every segment and numbers them", async () => {
    const onSegment = vi.fn();
    const rec = new SegmentedRecorder({} as MediaStream, 30, onSegment);
    rec.start();
    await vi.advanceTimersByTimeAsync(30_250);
    await vi.advanceTimersByTimeAsync(30_250);
    expect(onSegment.mock.calls.map(c => c[0])).toEqual([0, 1]);
    expect(FakeMediaRecorder.instances).toHaveLength(3);
    await rec.stop();
    expect(onSegment.mock.calls.map(c => c[0])).toEqual([0, 1, 2]);
    expect(rec.state).toBe("inactive");
  });

  it("does not count paused time towards a segment or the duration", async () => {
    const onSegment = vi.fn();
    const rec = new SegmentedRecorder({} as MediaStream, 30, onSegment);
    rec.start();
    await vi.advanceTimersByTimeAsync(10_000);
    rec.pause();
    expect(rec.state).toBe("paused");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onSegment).not.toHaveBeenCalled();
    rec.resume();
    await vi.advanceTimersByTimeAsync(20_250);
    expect(onSegment).toHaveBeenCalledTimes(1);
    expect(Math.round(rec.recordedMs / 1000)).toBe(30);
  });

  it("continues numbering from where an earlier page left off", async () => {
    const onSegment = vi.fn();
    const rec = new SegmentedRecorder({} as MediaStream, 30, onSegment, 12);
    rec.start();
    await rec.stop();
    expect(onSegment.mock.calls[0][0]).toBe(12);
    expect(rec.nextIndex).toBe(13);
  });
});
