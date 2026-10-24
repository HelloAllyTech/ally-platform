/**
 * Redaction for the Ally team's transcript review (plans/ally-guide/plan.md
 * §2.1 decision 10, §8.2): the team reads conversations to improve Ally, not
 * to learn who said what. Contact details and long numbers are masked here;
 * a message the Sentinel flagged as naming a real third party is hidden
 * whole, because a name in free text cannot be found reliably by pattern.
 *
 * Deterministic and conservative. The model-based redactor (plan §7.7,
 * Summariser / Redactor) replaces this with `redactedContent` when it runs;
 * this is the floor until then and whenever it has not.
 */

const PATTERNS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]'],
  [/https?:\/\/\S+/g, '[link]'],
  // Phone-like runs: 7+ digits, allowing spaces, dots, dashes and a leading +.
  [/\+?\d[\d\s().-]{5,}\d/g, '[number]'],
];

export function redactText(text: string): string {
  return PATTERNS.reduce(
    (out, [pattern, mask]) => out.replace(pattern, mask),
    text,
  );
}

export const HIDDEN_FOR_PRIVACY =
  '[hidden: this message named or identified a real person]';

/** What a reviewer may see of one message. */
export function reviewableText(message: {
  content?: string | null;
  redactedContent?: string | null;
  flags?: { pii?: boolean; realCase?: boolean } | null;
}): string | null {
  if (message.redactedContent) return message.redactedContent;
  if (!message.content) return null;
  if (message.flags?.pii) return HIDDEN_FOR_PRIVACY;
  return redactText(message.content);
}
