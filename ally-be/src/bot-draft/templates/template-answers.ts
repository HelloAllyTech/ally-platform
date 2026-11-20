import {
  answerText,
  type SetupAnswers,
} from '../../chatbot/templates/template-plan';
import type { UseCaseTemplate } from '../../chatbot/templates/templates';

/**
 * The owner's setup answers as the plan takes them: text (at most 2,000 characters), a yes or no,
 * or up to 10 short choices. Anything else, and keys that aren't plain words, are dropped.
 */
export function answersOf(raw: unknown): SetupAnswers {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: SetupAnswers = {};
  for (const [key, value] of Object.entries(raw).slice(0, 20)) {
    if (!/^[a-z_]{1,40}$/.test(key)) continue;
    if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string') out[key] = value.slice(0, 2000);
    else if (Array.isArray(value)) {
      out[key] = value
        .filter((v): v is string => typeof v === 'string')
        .slice(0, 10)
        .map((v) => v.slice(0, 100));
    }
  }
  return out;
}

/**
 * What a setup started from a template reads into "What we learned": the business's name, what the
 * template is for, and each answer with its question, in the owner's words.
 */
export function templateDescription(
  template: UseCaseTemplate,
  answers: SetupAnswers,
  name?: string,
): string {
  const lines = [
    `${name?.trim() || 'We'}: ${template.name}. ${template.one_liner}`,
    ...template.setup
      .filter((q) => q.kind !== 'yes_no')
      .map((q) => {
        const text = answerText(answers[q.key]);
        return text ? `${q.ask} ${text}` : null;
      })
      .filter((line): line is string => line !== null),
  ];
  return lines.join('\n').slice(0, 4000);
}
