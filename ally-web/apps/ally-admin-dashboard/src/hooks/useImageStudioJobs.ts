import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  useCreateImageBatchMutation,
  useCreateImageJobsMutation,
  useLazyGetImageJobsQuery,
} from "@api";
import {
  GenerateImageBatchRequest,
  GenerateImageRequest,
  GenerateImageResponse,
  ImageStudioError,
} from "@types";

import { imageJobStore, isImageSettled } from "./imageStudioJobStore";

export const IMAGE_STUDIO_BUSY_MESSAGE =
  "You have several images generating — wait for one to finish.";
export const IMAGE_STUDIO_OFF_MESSAGE = "Image generation is turned off right now.";
export const IMAGE_STUDIO_START_FAILED_MESSAGE = "Couldn't start the image. Try again in a moment.";

/** A rejected start, as a sentence (and on 422 the safety verdict) the modal can show as-is. */
export const toImageStudioError = (caught: unknown): ImageStudioError => {
  const error = caught as {
    status?: number | string;
    data?: { message?: unknown; safety?: unknown };
  };
  const status = error?.status;
  if (status === 429) return { status, message: IMAGE_STUDIO_BUSY_MESSAGE };
  if (status === 503) return { status, message: IMAGE_STUDIO_OFF_MESSAGE };
  const raw = error?.data?.message;
  const message = typeof raw === "string" && raw ? raw : IMAGE_STUDIO_START_FAILED_MESSAGE;
  const safety = error?.data?.safety as ImageStudioError["safety"];
  return { status, message, ...(status === 422 && safety ? { safety } : {}) };
};

/** One slot's in-flight results, readable without starting anything (no API calls). */
export const useSlotImageJobs = (slotKey: string) => {
  const slot = useSyncExternalStore(
    imageJobStore.subscribe,
    () => imageJobStore.get(slotKey),
    () => imageJobStore.get(slotKey),
  );
  return useMemo(() => {
    const pendingCount = slot.images.filter(image => !isImageSettled(image)).length;
    const readyCount = slot.images.filter(
      image => image.status === "succeeded" && image.imageUrl,
    ).length;
    return { images: slot.images, error: slot.error, pendingCount, readyCount };
  }, [slot]);
};

/**
 * Start Image Studio jobs for a slot and keep polling `GET /jobs?ids=` every
 * 3 s until each image is settled (`succeeded` / `failed`), capped at ~6 min.
 *
 * Results live in a module-level store keyed by `slotKey` (see
 * `imageStudioJobStore`), so they survive the modal closing: the slot keeps
 * showing "Generating…" and later "N images ready — review", and reopening the
 * modal shows them again. Mounting resumes polling for anything unsettled.
 */
export const useImageStudioJobs = (slotKey: string) => {
  const slot = useSlotImageJobs(slotKey);
  const [createJobs] = useCreateImageJobsMutation();
  const [createBatch] = useCreateImageBatchMutation();
  const [pollJobs] = useLazyGetImageJobsQuery();

  const poll = useCallback((ids: string[]) => pollJobs(ids).unwrap(), [pollJobs]);

  useEffect(() => {
    if (slot.pendingCount > 0) imageJobStore.ensurePolling(poll);
  }, [slot.pendingCount, poll]);

  /** Rejects with an ImageStudioError. */
  const start = useCallback(
    async (request: GenerateImageRequest): Promise<GenerateImageResponse> => {
      let response: GenerateImageResponse;
      try {
        response = await createJobs({ ...request, slotKey }).unwrap();
      } catch (caught) {
        throw toImageStudioError(caught);
      }
      imageJobStore.add(slotKey, response.images ?? []);
      imageJobStore.ensurePolling(poll);
      return response;
    },
    [createJobs, poll, slotKey],
  );

  /**
   * One request per slot (each `variants` is forced to 1 server-side). The
   * response is matched back to its slot by an echoed `slotKey` when the
   * backend sends one, otherwise by position.
   */
  const startBatch = useCallback(
    async (request: GenerateImageBatchRequest): Promise<GenerateImageResponse> => {
      let response: GenerateImageResponse;
      try {
        response = await createBatch(request).unwrap();
      } catch (caught) {
        throw toImageStudioError(caught);
      }
      (response.images ?? []).forEach((image, index) => {
        const key = image.slotKey ?? request.items[index]?.slotKey;
        if (key) imageJobStore.add(key, [image]);
      });
      imageJobStore.ensurePolling(poll);
      return response;
    },
    [createBatch, poll],
  );

  const dismiss = useCallback(
    (imageId: string) => imageJobStore.remove(slotKey, imageId),
    [slotKey],
  );
  const clear = useCallback(() => imageJobStore.clear(slotKey), [slotKey]);
  const resume = useCallback(() => imageJobStore.ensurePolling(poll), [poll]);

  return {
    ...slot,
    isGenerating: slot.pendingCount > 0,
    start,
    startBatch,
    dismiss,
    clear,
    resume,
  };
};
