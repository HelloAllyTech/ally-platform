/** Waits between reconnects, then 30 s, each with up to 1 s of jitter (chunk 11a). */
export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export const backoff = (attempt: number): number =>
  BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] + Math.floor(Math.random() * 1_000);
