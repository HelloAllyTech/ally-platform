import type { CrawlProblem } from '../type/bot-draft.type';

/**
 * The builder lines ally-be writes itself (the crawl's outcome, a refusal), from
 * `docs/agents-v2/ONBOARDING-COPY.md`, word for word; `onboarding-copy.spec.ts` holds them to the
 * deck. Everything the builder says in a conversation step comes from ally-ai.
 */
export const ONBOARDING_COPY = {
  opening:
    "Hi, I'm here to set up your assistant with you. Paste your website and I'll start reading. You can watch what I find on the right.",
  openingChips: ['Use my website', 'Upload documents', 'Describe it instead'],
  readingDone:
    "I've read {n} pages. Here's what I learned, and each detail links to the page it came from. Take a quick look: if anything's wrong, tell me or edit it directly.",
  describedDone:
    "Here's what I took from your description. Take a quick look: if anything's wrong, tell me or edit it directly.",
  looksRight: 'Looks right',
  /** Live finding lines, by learned section, as running totals (copy §3). */
  findings: {
    services: 'Found your services and prices',
    hours: 'Found your opening hours',
    team: 'Found {n} team members',
    faqs: 'Found {n} questions people often ask',
    location: 'Found your address and contact details',
  } as Record<string, string>,
  problems: {
    unreachable:
      "We couldn't reach {domain}. Check the address, or upload documents instead.",
    blocked:
      "{domain} asks automated readers not to visit, so we've respected that. Upload documents or describe your business instead.",
    script_heavy:
      'Your site loads most of its content with scripts, so we could only read {n} pages. Add a few documents to fill the gaps.',
    little_found:
      'We found very little to work with. A short description or a document or two will make a big difference.',
    daily_limit:
      "You've reached today's setup limit. Your progress is saved, so pick up tomorrow.",
    generic:
      'Something went wrong on our side. Your progress is saved. Try again.',
  } satisfies Record<CrawlProblem, string>,
  /** After a problem, the other ways in (copy §2's chips). */
  problemChips: ['Upload documents', 'Describe it instead'],
} as const;

export function fill(
  text: string,
  values: Record<string, string | number>,
): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
