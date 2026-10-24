import { ngrams } from '../checks/text.util';

/**
 * The 8-gram check (plans/ally-guide/plan.md §7.13): a curator change that
 * shares a run of `n` words with anything a learner wrote is blocked, so a
 * lesson can never smuggle a learner's words into every conversation's
 * prompt. Built once per run over the transcripts, then probed per change.
 */
export class CopiedTextIndex {
  private readonly grams = new Set<string>();

  constructor(
    corpus: Iterable<string>,
    private readonly n: number,
  ) {
    for (const text of corpus) {
      for (const gram of ngrams(text, n)) this.grams.add(gram);
    }
  }

  get size(): number {
    return this.grams.size;
  }

  /** The first run of `n` words `text` shares with the corpus, or null. */
  firstCopied(text: string | null | undefined): string | null {
    if (!text) return null;
    for (const gram of ngrams(text, this.n)) {
      if (this.grams.has(gram)) return gram;
    }
    return null;
  }
}
