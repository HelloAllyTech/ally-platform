import { segmentStore } from "./segmentStore";

/** What the uploader needs from the API (bound by the hook to RTK mutations). */
export interface SegmentApi {
  getUploadUrl: (chatId: number, index: number, contentType: string) => Promise<{ url: string }>;
  finalize: (args: {
    chatId: number;
    segmentCount: number;
    durationSeconds?: number;
    allowPartial?: boolean;
  }) => Promise<{ status: string; missing: number[] }>;
}

const MAX_ATTEMPTS = 8;
const backoffMs = (attempt: number) => Math.min(30_000, 1_000 * 2 ** attempt);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Uploads recording segments straight to S3, in the background, with retries.
 * Each segment is kept in IndexedDB until S3 confirms it, so nothing recorded
 * is lost to a network drop, a reload or a deploy. finish() waits for the
 * queue, finalizes, and re-sends anything the server reports missing.
 */
export class SegmentUploader {
  private inFlight = new Map<number, Promise<boolean>>();
  private uploaded = new Set<number>();

  constructor(
    private readonly chatId: number,
    private readonly api: SegmentApi,
    private readonly onProblem?: (message: string) => void,
  ) {}

  enqueue(index: number, blob: Blob, contentType: string): void {
    void segmentStore.put({
      id: `${this.chatId}:${index}`,
      chatId: this.chatId,
      index,
      blob,
      contentType,
    });
    this.inFlight.set(index, this.upload(index, blob, contentType));
  }

  get pendingCount(): number {
    return this.inFlight.size;
  }

  private async upload(index: number, blob: Blob, contentType: string): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const { url } = await this.api.getUploadUrl(this.chatId, index, contentType);
        const res = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: blob,
        });
        if (!res.ok) throw new Error(`S3 PUT ${res.status}`);
        this.uploaded.add(index);
        this.inFlight.delete(index);
        void segmentStore.remove(this.chatId, index);
        return true;
      } catch {
        if (attempt === 2) this.onProblem?.("Recording is still saving: the connection is slow");
        await sleep(backoffMs(attempt));
      }
    }
    this.inFlight.delete(index);
    return false; // still in IndexedDB; finish() retries it
  }

  /**
   * Wait for the queue, then finalize. Segments the server says are missing
   * are re-sent from IndexedDB; after `rounds` tries it finalizes with what
   * arrived (flagged incomplete) rather than leave the session open.
   */
  async finish(
    segmentCount: number,
    durationSeconds: number,
    rounds = 3,
  ): Promise<{ missing: number[] }> {
    await Promise.allSettled([...this.inFlight.values()]);
    for (let round = 0; round < rounds; round++) {
      let result: { status: string; missing: number[] };
      try {
        result = await this.api.finalize({ chatId: this.chatId, segmentCount, durationSeconds });
      } catch {
        await sleep(backoffMs(round));
        continue;
      }
      // "missing": the server lists segments it doesn't have; re-send them
      // from IndexedDB and ask again.
      if (result.status !== "missing") return { missing: result.missing ?? [] };
      for (const index of result.missing) {
        const stored = await segmentStore.get(this.chatId, index);
        if (stored) this.inFlight.set(index, this.upload(index, stored.blob, stored.contentType));
      }
      await Promise.allSettled([...this.inFlight.values()]);
    }
    const r = await this.api.finalize({
      chatId: this.chatId,
      segmentCount,
      durationSeconds,
      allowPartial: true,
    });
    return { missing: r.missing ?? [] };
  }
}
