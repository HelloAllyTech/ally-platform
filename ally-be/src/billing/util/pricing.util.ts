/**
 * Pricing, as pure functions. Money is in micros (millionths of a US dollar); token prices are
 * micros per 1,000,000 tokens.
 *
 * Token accounting differs by provider (see `analytics/constants/llm-pricing.constants.ts`):
 *   - OpenAI and Gemini report `promptTokens` INCLUDING the cached share, so the uncached part is
 *     `input - cached`, priced at the input rate, and the cached part at the cached rate.
 *   - Anthropic reports cache reads IN ADDITION to `input_tokens`, so input and cached are priced
 *     separately as they come.
 * A model with no cached rate prices its cached tokens at the full input rate, so nothing is
 * ever under-priced.
 */
export interface PriceVersion {
  inputPer1MMicros: number | null;
  cachedInputPer1MMicros: number | null;
  outputPer1MMicros: number | null;
  unitPriceMicros: number | null;
  unit: string | null;
}

export interface UsageQuantities {
  provider?: string | null;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  /** Non-token quantity (minutes, pages, 1M chars), already in the price's unit. */
  units?: number | null;
}

const CACHED_IS_EXTRA = new Set(['anthropic']);

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** The call's cost in micros, or null when the price can't cover it (unpriced). */
export function costMicros(
  usage: UsageQuantities,
  price: PriceVersion | null,
): number | null {
  if (!price) return null;
  const input = Math.max(0, usage.inputTokens ?? 0);
  const cached = Math.max(0, usage.cachedTokens ?? 0);
  const output = Math.max(0, usage.outputTokens ?? 0);
  const units = usage.units ?? null;

  if (units !== null && units > 0) {
    if (price.unitPriceMicros === null) return null;
    return round3(units * Number(price.unitPriceMicros));
  }

  const hasTokens = input + cached + output > 0;
  if (!hasTokens) return 0;
  if (price.inputPer1MMicros === null && price.outputPer1MMicros === null) {
    return null;
  }

  const inRate = Number(price.inputPer1MMicros ?? 0);
  const cachedRate =
    price.cachedInputPer1MMicros === null
      ? inRate
      : Number(price.cachedInputPer1MMicros);
  const outRate = Number(price.outputPer1MMicros ?? 0);

  const provider = (usage.provider ?? '').toLowerCase();
  const uncached = CACHED_IS_EXTRA.has(provider)
    ? input
    : Math.max(0, input - cached);

  return round3(
    (uncached * inRate + cached * cachedRate + output * outRate) / 1_000_000,
  );
}

/** Dollars from micros, for Ally-admin screens only. */
export const microsToUsd = (value: number | string | null): number =>
  value === null ? 0 : Number(value) / 1_000_000;

export const usdToMicros = (usd: number): number =>
  round3(Number(usd) * 1_000_000);

/**
 * The version effective at `at`: the latest `effectiveFrom` on or before that day, ties broken
 * by the higher version (a same-day correction wins).
 */
export function priceAt<
  T extends { effectiveFrom: string | Date; version: number },
>(versions: T[], at: Date): T | null {
  const day = at.toISOString().slice(0, 10);
  let best: T | null = null;
  for (const version of versions) {
    const from =
      typeof version.effectiveFrom === 'string'
        ? version.effectiveFrom.slice(0, 10)
        : version.effectiveFrom.toISOString().slice(0, 10);
    if (from > day) continue;
    if (
      !best ||
      from > dayOf(best.effectiveFrom) ||
      (from === dayOf(best.effectiveFrom) && version.version > best.version)
    ) {
      best = version;
    }
  }
  return best;
}

const dayOf = (value: string | Date): string =>
  typeof value === 'string'
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);

/** Provider names as stored: ally-ai and the pickers say `gemini` for Google. */
export function canonicalBillingProvider(provider: string): string {
  const value = String(provider ?? '')
    .trim()
    .toLowerCase();
  if (value === 'google' || value === 'google-genai' || value === 'vertex') {
    return 'gemini';
  }
  return value;
}
