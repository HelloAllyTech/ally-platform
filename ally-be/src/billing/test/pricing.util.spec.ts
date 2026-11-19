import {
  canonicalBillingProvider,
  costMicros,
  priceAt,
  usdToMicros,
} from '../util/pricing.util';

const luna = {
  inputPer1MMicros: usdToMicros(0.1),
  cachedInputPer1MMicros: usdToMicros(0.01),
  outputPer1MMicros: usdToMicros(0.5),
  unitPriceMicros: null,
  unit: null,
};

describe('costMicros', () => {
  it('prices OpenAI tokens with the cached share inside the input count', () => {
    // 1,000 input of which 400 cached, 200 output on gpt-6-luna:
    // 600 × $0.10/M + 400 × $0.01/M + 200 × $0.50/M = $0.000164
    expect(
      costMicros(
        {
          provider: 'openai',
          inputTokens: 1000,
          cachedTokens: 400,
          outputTokens: 200,
        },
        luna,
      ),
    ).toBeCloseTo(164, 3);
  });

  it('prices Anthropic cache reads on top of the input count', () => {
    const sonnet = {
      ...luna,
      inputPer1MMicros: 3e6,
      cachedInputPer1MMicros: 3e5,
      outputPer1MMicros: 15e6,
    };
    // 1,000 × 3 + 400 × 0.3 + 200 × 15 = 6,120 micros-per-M × tokens / 1M
    expect(
      costMicros(
        {
          provider: 'anthropic',
          inputTokens: 1000,
          cachedTokens: 400,
          outputTokens: 200,
        },
        sonnet,
      ),
    ).toBeCloseTo(6.12 * 1000, 3);
  });

  it('prices cached tokens at the full input rate when the model has no cached rate', () => {
    const noCache = { ...luna, cachedInputPer1MMicros: null };
    expect(
      costMicros(
        { provider: 'openai', inputTokens: 1000, cachedTokens: 1000 },
        noCache,
      ),
    ).toBeCloseTo(100, 3);
  });

  it('prices a per-minute model by units', () => {
    const whisper = {
      inputPer1MMicros: null,
      cachedInputPer1MMicros: null,
      outputPer1MMicros: null,
      unitPriceMicros: 6000,
      unit: 'minute',
    };
    expect(costMicros({ units: 2.5 }, whisper)).toBe(15000);
  });

  it('is unpriced (null) without a price, and for units on a token-only price', () => {
    expect(costMicros({ inputTokens: 10 }, null)).toBeNull();
    expect(costMicros({ units: 3 }, luna)).toBeNull();
  });

  it('keeps fractions of a micro rather than rounding a tiny call to zero', () => {
    expect(
      costMicros(
        { provider: 'openai', inputTokens: 30 },
        { ...luna, inputPer1MMicros: 20000 },
      ),
    ).toBe(0.6);
  });
});

describe('priceAt', () => {
  const versions = [
    { version: 1, effectiveFrom: '2026-01-01', id: 'a' },
    { version: 2, effectiveFrom: '2026-12-01', id: 'b' },
    { version: 3, effectiveFrom: '2026-12-01', id: 'c' },
  ];
  it('picks the latest version effective on that day, a same-day correction winning', () => {
    expect(priceAt(versions, new Date('2026-11-30T23:00:00Z'))?.id).toBe('a');
    expect(priceAt(versions, new Date('2026-12-01T00:00:00Z'))?.id).toBe('c');
  });
  it('has nothing before the first version', () => {
    expect(priceAt(versions, new Date('2025-06-01'))).toBeNull();
  });
});

it('names Google gemini, as ally-ai does', () => {
  expect(canonicalBillingProvider('Google')).toBe('gemini');
  expect(canonicalBillingProvider('openai')).toBe('openai');
});
