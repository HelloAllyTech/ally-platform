import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSpeechCapture } from "../useSpeechCapture";

/** What the fake mic is currently hearing, as a 0..255 frequency-bin value. */
let micLevel = 0;
const SPEAKING = 120;
const SILENT = 0;

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (type: string) => type === "audio/webm;codecs=opus";
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  /** Like the real one: the last data and `stop` arrive on a later task. */
  stop() {
    this.state = "inactive";
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
      this.onstop?.();
    }, 0);
  }
}

class FakeAudioContext {
  createAnalyser() {
    return {
      fftSize: 0,
      frequencyBinCount: 8,
      getByteFrequencyData: (data: Uint8Array) => data.fill(micLevel),
    };
  }
  createMediaStreamSource() {
    return { connect: () => undefined };
  }
  close() {
    return Promise.resolve();
  }
}

const trackStop = vi.fn();
const getUserMedia = vi.fn();

/** A transcriber whose answers the test releases one by one. */
const deferredTranscriber = () => {
  const calls: { resolve: (text: string) => void; reject: (e: Error) => void }[] = [];
  const transcribe = vi.fn(
    () =>
      new Promise<string>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );
  return { transcribe, calls };
};

const settle = () => act(async () => vi.advanceTimersByTimeAsync(0));
const run = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

/** Starts the hook and lets the (fake) permission prompt resolve. */
const startListening = async (options: Parameters<typeof useSpeechCapture>[0]) => {
  const hook = renderHook(() => useSpeechCapture(options));
  act(() => hook.result.current.start());
  await settle();
  return hook;
};

/** Speak for a while, then stay quiet long enough for the clip to be cut. */
const sayAPhrase = async () => {
  micLevel = SPEAKING;
  await run(2000);
  micLevel = SILENT;
  await run(1000);
  await settle();
};

describe("useSpeechCapture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    micLevel = SILENT;
    FakeMediaRecorder.instances = [];
    trackStop.mockReset();
    getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("AudioContext", FakeAudioContext);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reports unsupported when the browser cannot record", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const { result } = renderHook(() =>
      useSpeechCapture({ onFinal: vi.fn(), transcribe: vi.fn() }),
    );
    expect(result.current.status).toBe("unsupported");
  });

  it("transcribes a phrase once the speaker pauses, and keeps listening", async () => {
    const onFinal = vi.fn();
    const transcribe = vi.fn().mockResolvedValue(" call notes that write themselves ");
    const { result } = await startListening({ onFinal, transcribe });
    expect(result.current.status).toBe("listening");

    await sayAPhrase();

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect((transcribe.mock.calls[0][0] as Blob).type).toBe("audio/webm;codecs=opus");
    expect(onFinal).toHaveBeenCalledWith("call notes that write themselves");
    // A fresh clip is already recording for the next phrase.
    expect(FakeMediaRecorder.instances).toHaveLength(2);
    expect(FakeMediaRecorder.instances[1].state).toBe("recording");
    expect(result.current.status).toBe("listening");
  });

  it("never sends a clip with no speech in it", async () => {
    const transcribe = vi.fn().mockResolvedValue("Thank you for watching.");
    const { result } = await startListening({ onFinal: vi.fn(), transcribe });
    await run(5000);
    act(() => result.current.stop());
    await settle();
    await act(() => result.current.finish());
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("hands phrases over in spoken order even when they come back out of order", async () => {
    const onFinal = vi.fn();
    const { transcribe, calls } = deferredTranscriber();
    await startListening({ onFinal, transcribe });

    await sayAPhrase();
    await sayAPhrase();
    expect(calls).toHaveLength(2);

    await act(async () => calls[1].resolve("second"));
    expect(onFinal).not.toHaveBeenCalled();
    await act(async () => calls[0].resolve("first"));
    expect(onFinal.mock.calls.map(c => c[0])).toEqual(["first", "second"]);
  });

  it("finish() waits for the last phrase after Stop", async () => {
    const onFinal = vi.fn();
    const { transcribe, calls } = deferredTranscriber();
    const { result } = await startListening({ onFinal, transcribe });

    micLevel = SPEAKING;
    await run(800);
    act(() => result.current.stop());
    expect(result.current.status).toBe("idle");
    expect(trackStop).toHaveBeenCalled();

    let finished = false;
    const done = result.current.finish().then(() => {
      finished = true;
    });
    await settle();
    expect(calls).toHaveLength(1);
    expect(result.current.transcribing).toBe(true);
    expect(finished).toBe(false);

    await act(async () => calls[0].resolve("the last words"));
    await act(() => done);
    expect(finished).toBe(true);
    expect(onFinal).toHaveBeenCalledWith("the last words");
    expect(result.current.transcribing).toBe(false);
  });

  it("pauses (letting go of the mic) and resumes", async () => {
    const onFinal = vi.fn();
    const transcribe = vi.fn().mockResolvedValue("after resume");
    const { result } = await startListening({ onFinal, transcribe });

    act(() => result.current.pause());
    expect(result.current.status).toBe("paused");
    expect(trackStop).toHaveBeenCalled();

    act(() => result.current.resume());
    await settle();
    expect(result.current.status).toBe("listening");
    expect(getUserMedia).toHaveBeenCalledTimes(2);

    await sayAPhrase();
    expect(onFinal).toHaveBeenCalledWith("after resume");
  });

  it("says the mic is blocked when permission is refused", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    const { result } = await startListening({ onFinal: vi.fn(), transcribe: vi.fn() });
    expect(result.current.status).toBe("denied");
  });

  it("says the mic can't be reached when there is none", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("no"), { name: "NotFoundError" }));
    const { result } = await startListening({ onFinal: vi.fn(), transcribe: vi.fn() });
    expect(result.current.status).toBe("unavailable");
  });

  it("reports a failed phrase and still delivers the next one", async () => {
    const onFinal = vi.fn();
    const onError = vi.fn();
    const { transcribe, calls } = deferredTranscriber();
    await startListening({ onFinal, transcribe, onError });

    await sayAPhrase();
    await sayAPhrase();
    await act(async () => calls[0].reject(new Error("500")));
    await act(async () => calls[1].resolve("still here"));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onFinal.mock.calls.map(c => c[0])).toEqual(["still here"]);
  });

  it("cancel() drops words still being transcribed, then works normally again", async () => {
    const onFinal = vi.fn();
    const { transcribe, calls } = deferredTranscriber();
    const { result } = await startListening({ onFinal, transcribe });

    await sayAPhrase();
    micLevel = SPEAKING;
    await run(500);
    act(() => result.current.cancel());
    await settle();
    // The half-said clip at cancel time is never sent.
    expect(calls).toHaveLength(1);
    await act(async () => calls[0].resolve("discarded"));
    expect(onFinal).not.toHaveBeenCalled();

    act(() => result.current.start());
    await settle();
    await sayAPhrase();
    await act(async () => calls[1].resolve("kept"));
    expect(onFinal.mock.calls.map(c => c[0])).toEqual(["kept"]);
  });
});
