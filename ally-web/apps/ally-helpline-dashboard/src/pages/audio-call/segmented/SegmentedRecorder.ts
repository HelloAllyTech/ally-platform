/**
 * MediaRecorder that starts a fresh recording every `segmentSeconds` of
 * recorded (unpaused) time, so each segment is a complete, standalone webm
 * file: slices of one long MediaRecorder stream can't be decoded on their own.
 *
 * Exposes the MediaRecorder surface the recording screen already drives
 * (state, pause, resume, stop), so mute/unmute and teardown work unchanged.
 */
export type SegmentHandler = (index: number, blob: Blob, contentType: string) => void;

export class SegmentedRecorder {
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private recordedInSegmentMs = 0;
  private lastTick = 0;
  private stopped = false;
  private paused = false;
  /** Index the next finished segment gets. */
  nextIndex: number;
  /** Total recorded (unpaused) time, for finalize's durationSeconds. */
  recordedMs = 0;
  private readonly mimeType: string;
  private finalSegment: Promise<void> | null = null;

  constructor(
    private readonly stream: MediaStream,
    private readonly segmentSeconds: number,
    private readonly onSegment: SegmentHandler,
    startIndex = 0,
  ) {
    this.nextIndex = startIndex;
    this.mimeType =
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
  }

  get state(): RecordingState {
    if (this.stopped || !this.recorder) return "inactive";
    return this.paused ? "paused" : "recording";
  }

  start(): void {
    this.startSegment();
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), 250);
  }

  pause(): void {
    if (this.stopped || this.paused) return;
    this.tick();
    this.paused = true;
    if (this.recorder?.state === "recording") this.recorder.pause();
  }

  resume(): void {
    if (this.stopped || !this.paused) return;
    this.paused = false;
    this.lastTick = Date.now();
    if (this.recorder?.state === "paused") this.recorder.resume();
  }

  /** Stops recording; resolves once the last segment has been handed over. */
  stop(): Promise<void> {
    if (this.stopped) return this.finalSegment ?? Promise.resolve();
    this.tick();
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.finalSegment = this.endSegment();
    return this.finalSegment;
  }

  private tick(): void {
    const now = Date.now();
    if (!this.paused && !this.stopped) {
      const delta = now - this.lastTick;
      this.recordedInSegmentMs += delta;
      this.recordedMs += delta;
    }
    this.lastTick = now;
    if (!this.paused && !this.stopped && this.recordedInSegmentMs >= this.segmentSeconds * 1000) {
      void this.endSegment().then(() => {
        if (!this.stopped) this.startSegment();
      });
    }
  }

  private startSegment(): void {
    this.recordedInSegmentMs = 0;
    const recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    this.recorder = recorder;
    recorder.start();
    if (this.paused) recorder.pause();
  }

  /** Stop the current MediaRecorder and emit its whole file as one segment. */
  private endSegment(): Promise<void> {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder || recorder.state === "inactive") return Promise.resolve();
    return new Promise(resolve => {
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        // A segment that captured nothing (muted throughout) is not sent.
        if (blob.size > 0) this.onSegment(this.nextIndex++, blob, "audio/webm");
        resolve();
      };
      recorder.stop();
    });
  }
}
