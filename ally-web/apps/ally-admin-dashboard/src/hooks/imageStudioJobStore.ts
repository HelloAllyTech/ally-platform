import { GeneratedImage } from "@types";

/**
 * In-flight Image Studio results, kept at module level and keyed by slot
 * (`slotKey`), so closing the Generate modal — or leaving the slot and coming
 * back — never loses an image. One poll loop serves every slot: each tick
 * reads all unsettled ids in one `GET /jobs?ids=`.
 *
 * Pure (no API import): the poll function is handed in by whoever starts or
 * resumes polling, so this module can be read anywhere, including tests that
 * mock `@api` wholesale.
 */

/** Every 3 s: medium-quality images take ~25 s, so a handful of cheap reads each. */
export const IMAGE_STUDIO_POLL_INTERVAL_MS = 3_000;
/** Past the backend's 5-minute reconcile, so its verdict normally lands first. */
export const IMAGE_STUDIO_MAX_WAIT_MS = 6 * 60_000;
/** A deploy or a dropped connection costs a poll or two, not the images. */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;
/** Ids per poll request, so the query string stays short. */
const POLL_CHUNK = 20;

export const IMAGE_TIMED_OUT_MESSAGE = "This one took too long. Try again.";
export const IMAGE_POLL_LOST_MESSAGE =
  "Lost touch with image generation. Open Generate again to check on it.";

export interface SlotJobs {
  /** Newest first. */
  images: GeneratedImage[];
  /** Set when polling gave up; cleared by the next successful poll. */
  error?: string;
}

export type PollImages = (ids: string[]) => Promise<GeneratedImage[]>;

const EMPTY: SlotJobs = Object.freeze({ images: [] }) as SlotJobs;

let slots = new Map<string, SlotJobs>();
/** When each image was first seen unsettled — for the time cap. */
let firstSeen = new Map<string, number>();
const listeners = new Set<() => void>();

let pollFn: PollImages | null = null;
let loopRunning = false;
/** Bumped by a reset, so a loop from before it stops quietly. */
let generation = 0;
let timing = { intervalMs: IMAGE_STUDIO_POLL_INTERVAL_MS, maxWaitMs: IMAGE_STUDIO_MAX_WAIT_MS };

export const isImageSettled = (image: Pick<GeneratedImage, "status">) =>
  image.status === "succeeded" || image.status === "failed";

const emit = () => listeners.forEach(listener => listener());

const setSlot = (slotKey: string, next: SlotJobs) => {
  if (next.images.length === 0 && !next.error) slots.delete(slotKey);
  else slots.set(slotKey, next);
};

const unsettledIds = (): string[] => {
  const ids = new Set<string>();
  slots.forEach(slot =>
    slot.images.forEach(image => {
      if (!isImageSettled(image)) ids.add(image.id);
    }),
  );
  return [...ids];
};

/** Replace every copy of these images (by id) with the fresh one. */
const mergeImages = (fresh: GeneratedImage[]) => {
  if (fresh.length === 0) return;
  const byId = new Map(fresh.map(image => [image.id, image]));
  let changed = false;
  slots.forEach((slot, key) => {
    if (!slot.images.some(image => byId.has(image.id)) && !slot.error) return;
    changed = true;
    setSlot(key, {
      images: slot.images.map(image => {
        const update = byId.get(image.id);
        return update ? { ...image, ...update } : image;
      }),
    });
  });
  if (changed) emit();
};

const failImages = (ids: Set<string>, message: string) => {
  slots.forEach((slot, key) => {
    if (!slot.images.some(image => ids.has(image.id))) return;
    setSlot(key, {
      ...slot,
      images: slot.images.map(image =>
        ids.has(image.id) ? { ...image, status: "failed", error: image.error || message } : image,
      ),
    });
  });
  emit();
};

const markLost = () => {
  slots.forEach((slot, key) => {
    if (slot.images.some(image => !isImageSettled(image))) {
      setSlot(key, { ...slot, error: IMAGE_POLL_LOST_MESSAGE });
    }
  });
  emit();
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const runLoop = async () => {
  if (loopRunning) return;
  loopRunning = true;
  const myGeneration = generation;
  let failures = 0;
  try {
    while (pollFn && myGeneration === generation) {
      const now = Date.now();
      const pending = unsettledIds();
      const expired = new Set(
        pending.filter(id => now - (firstSeen.get(id) ?? now) >= timing.maxWaitMs),
      );
      if (expired.size > 0) failImages(expired, IMAGE_TIMED_OUT_MESSAGE);
      const ids = pending.filter(id => !expired.has(id));
      if (ids.length === 0) break;

      await sleep(timing.intervalMs);
      const poll = pollFn;
      if (!poll || myGeneration !== generation) break;
      try {
        for (let start = 0; start < ids.length; start += POLL_CHUNK) {
          mergeImages(await poll(ids.slice(start, start + POLL_CHUNK)));
        }
        failures = 0;
      } catch {
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          markLost();
          break;
        }
      }
    }
  } finally {
    if (myGeneration === generation) loopRunning = false;
  }
};

export const imageJobStore = {
  get(slotKey: string): SlotJobs {
    return slots.get(slotKey) ?? EMPTY;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** New images for a slot (just started), shown first. */
  add(slotKey: string, images: GeneratedImage[]) {
    const now = Date.now();
    images.forEach(image => {
      if (!isImageSettled(image) && !firstSeen.has(image.id)) firstSeen.set(image.id, now);
    });
    const current = slots.get(slotKey) ?? EMPTY;
    const ids = new Set(images.map(image => image.id));
    setSlot(slotKey, {
      images: [...images, ...current.images.filter(image => !ids.has(image.id))],
    });
    emit();
  },

  /** Drop one image from a slot (the author dismissed it). */
  remove(slotKey: string, imageId: string) {
    const current = slots.get(slotKey);
    if (!current) return;
    setSlot(slotKey, { ...current, images: current.images.filter(image => image.id !== imageId) });
    emit();
  },

  /** Forget a slot's results (the author used one). */
  clear(slotKey: string) {
    if (!slots.has(slotKey)) return;
    slots.delete(slotKey);
    emit();
  },

  /**
   * Make sure the poll loop is running while anything is unsettled. The newest
   * poll function wins, so a remounted editor takes over from an unmounted one.
   */
  ensurePolling(poll: PollImages) {
    pollFn = poll;
    slots.forEach((slot, key) => {
      if (slot.error) setSlot(key, { images: slot.images });
    });
    if (unsettledIds().length > 0) void runLoop();
  },

  /** Tests only: shorten the clock and start from empty. */
  resetForTests(overrides: Partial<typeof timing> = {}) {
    generation += 1;
    slots = new Map();
    firstSeen = new Map();
    pollFn = null;
    loopRunning = false;
    timing = {
      intervalMs: IMAGE_STUDIO_POLL_INTERVAL_MS,
      maxWaitMs: IMAGE_STUDIO_MAX_WAIT_MS,
      ...overrides,
    };
    emit();
  },
};
