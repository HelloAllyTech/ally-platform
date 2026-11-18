/** S3 prefixes in the learn-media public bucket. */
export const IMAGE_STUDIO_S3_PREFIX = 'image-studio';
export const IMAGE_STUDIO_ORIGINALS_PREFIX = `${IMAGE_STUDIO_S3_PREFIX}/originals`;

export const IMAGE_STUDIO_MAX_VARIANTS = 4;
export const IMAGE_STUDIO_MAX_BATCH = 20;
export const IMAGE_STUDIO_DESCRIPTION_MAX = 2000;
export const IMAGE_STUDIO_HISTORY_LIMIT = 24;

/** A job gets two attempts: one silent retry after a failed check or a lost run. */
export const IMAGE_STUDIO_MAX_ATTEMPTS = 2;
/** Poll interval of the worker loop when idle. */
export const IMAGE_STUDIO_IDLE_POLL_MS = 2_000;
export const IMAGE_STUDIO_HEARTBEAT_MS = 15_000;
/** A running job whose heartbeat is older than this lost its task (a deploy). */
export const IMAGE_STUDIO_STALE_MS = 3 * 60_000;
/** Unaccepted, unused images older than this are removed by the daily cleanup. */
export const IMAGE_STUDIO_RETENTION_DAYS = 30;
export const IMAGE_STUDIO_CLEANUP_BATCH = 200;

export const IMAGE_STUDIO_LLM_TASK_IDS = {
  COMPOSE: 'image-studio-compose',
  IMAGE: 'image-studio-image',
  JUDGE: 'image-studio-judge',
} as const;

export const IMAGE_STUDIO_FAILED_MESSAGE =
  "Couldn't generate this image. Try again in a moment.";

/**
 * Per-image price estimates in USD, by model prefix. Image APIs bill per
 * image by size and quality (OpenAI) or per output image (Gemini), which the
 * token pricing table deliberately does not model. These are list-price
 * estimates for the sizes this feature asks for; set
 * IMAGE_STUDIO_COST_PER_IMAGE_USD to override them all, and re-check against
 * the providers' pricing pages when a model changes. Each reference image
 * adds input cost, estimated per reference below.
 */
export const IMAGE_PRICE_ESTIMATES_USD: {
  prefix: string;
  byQuality?: Record<'low' | 'medium' | 'high', number>;
  flat?: number;
}[] = [
  {
    prefix: 'gpt-image',
    byQuality: { low: 0.016, medium: 0.063, high: 0.25 },
  },
  { prefix: 'dall-e-3', flat: 0.08 },
  { prefix: 'gemini-3-pro-image', flat: 0.134 },
  { prefix: 'gemini-2.5-flash-image', flat: 0.039 },
  { prefix: 'gemini', flat: 0.039 },
];
export const IMAGE_PRICE_PER_REFERENCE_USD = 0.01;
export const IMAGE_PRICE_FALLBACK_USD = 0.1;
/** The compose + judge calls, per image, on fast models. */
export const IMAGE_PRICE_OVERHEAD_USD = 0.002;

export const estimateImageCostUsd = (
  model: string,
  quality: 'low' | 'medium' | 'high',
  references: number,
  override?: number,
): number => {
  if (override && override > 0) return override;
  const id = model.replace(/^models\//, '');
  const row = IMAGE_PRICE_ESTIMATES_USD.find((entry) =>
    id.startsWith(entry.prefix),
  );
  const base =
    row?.flat ?? row?.byQuality?.[quality] ?? IMAGE_PRICE_FALLBACK_USD;
  return (
    Math.round(
      (base +
        references * IMAGE_PRICE_PER_REFERENCE_USD +
        IMAGE_PRICE_OVERHEAD_USD) *
        10_000,
    ) / 10_000
  );
};
