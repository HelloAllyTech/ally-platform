/**
 * Counterfactual variants of a case (plans/ally-guide/plan.md §7.13): the
 * same intent with a different surface, so a pass is not luck with one
 * wording. A static suite passes by memorising its phrasing; the variants
 * keep the expectations and change everything the expectations should not
 * depend on — spelling, register, channel, what came before
 * (Stacks: Static Test Suites Are Insufficient for Agentic Systems;
 * Synthetic Datasets for Red Teaming Agent Systems — noisy, malformed input).
 *
 * Deterministic: the same case always yields the same variants, so a variant
 * that fails can be replayed exactly.
 */

export interface CaseInputLike {
  message: string;
  channel?: 'text' | 'voice';
  history?: Array<{ role: 'learner' | 'ally'; text: string }>;
}

export interface Variant<T extends CaseInputLike> {
  kind: string;
  input: T;
}

/** Swap two inner letters in every third word of five letters or more. */
export function withTypos(text: string): string {
  let n = 0;
  return text.replace(/\p{L}{5,}/gu, (word) => {
    n++;
    if (n % 3 !== 0) return word;
    const chars = [...word];
    const i = Math.floor(chars.length / 2) - 1;
    [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
    return chars.join('');
  });
}

/** The way people text on a phone: lower case, no punctuation. */
export function terse(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"“”‘’()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PREAMBLES = [
  'Sorry, quick one. ',
  'Not sure if this is the right place but ',
  'ok so ',
];

export function counterfactualVariants<T extends CaseInputLike>(
  input: T,
): Array<Variant<T>> {
  const message = input.message ?? '';
  const variants: Array<Variant<T>> = [];
  const push = (kind: string, patch: Partial<CaseInputLike>) => {
    const next = { ...input, ...patch } as T;
    if (
      next.message !== message ||
      next.channel !== input.channel ||
      (next.history?.length ?? 0) !== (input.history?.length ?? 0)
    ) {
      variants.push({ kind, input: next });
    }
  };
  if (message.trim()) {
    push('typos', { message: withTypos(message) });
    push('terse', { message: terse(message) });
    const preamble =
      PREAMBLES[
        [...message].reduce((sum, c) => sum + c.charCodeAt(0), 0) %
          PREAMBLES.length
      ];
    push('preamble', { message: `${preamble}${message.trim()}` });
  }
  push('voice', { channel: input.channel === 'voice' ? 'text' : 'voice' });
  if (input.history?.length) push('no_history', { history: [] });
  return variants;
}
