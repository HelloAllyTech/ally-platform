import { PrechatFieldType } from '../enum/bot-page.enum';
import type { PrechatField } from '../type/bot-page.type';

/** One stored pre-chat answer, with the question as it read when answered. */
interface IntakeAnswer {
  id: string;
  label: string;
  type: PrechatFieldType;
  value: string;
}

/** What `chatbot_conversations.metadata.intake` holds. */
export interface StoredIntake {
  completedAt: string;
  answers: IntakeAnswer[];
  /** The consent wording agreed to and when, for each consent question. */
  consents: { id: string; text: string; acceptedAt: string }[];
}

export class IntakeError extends Error {
  constructor(
    readonly fieldId: string,
    message: string,
  ) {
    super(message);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Digits with an optional leading +, spaces, dashes or brackets; 7–15 digits in all. */
const PHONE = /^\+?[\d\s\-()]{7,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Check the visitor's answers against the page's current questions and build what is stored.
 *
 * Unknown ids are ignored (a question removed while the visitor was answering); a missing required
 * answer, a choice that isn't offered, or a malformed email, phone or date is refused. A required
 * consent must be "true", and its wording is stored with the time it was accepted.
 */
export function validateIntake(
  fields: PrechatField[],
  answers: { id: string; value: string }[],
  now = new Date(),
): StoredIntake {
  const given = new Map(answers.map((a) => [a.id, (a.value ?? '').trim()]));
  const stored: IntakeAnswer[] = [];
  const consents: StoredIntake['consents'] = [];

  for (const field of fields) {
    const value = given.get(field.id) ?? '';
    if (!value) {
      if (field.required) {
        throw new IntakeError(field.id, `"${field.label}" needs an answer.`);
      }
      continue;
    }
    switch (field.type) {
      case PrechatFieldType.EMAIL:
        if (!EMAIL.test(value)) {
          throw new IntakeError(
            field.id,
            `"${field.label}" needs an email address.`,
          );
        }
        break;
      case PrechatFieldType.PHONE: {
        const digits = value.replace(/\D/g, '');
        if (!PHONE.test(value) || digits.length < 7 || digits.length > 15) {
          throw new IntakeError(
            field.id,
            `"${field.label}" needs a phone number.`,
          );
        }
        break;
      }
      case PrechatFieldType.DATE: {
        const parsed = new Date(`${value}T00:00:00Z`);
        if (
          !DATE.test(value) ||
          Number.isNaN(parsed.getTime()) ||
          parsed.toISOString().slice(0, 10) !== value
        ) {
          throw new IntakeError(field.id, `"${field.label}" needs a date.`);
        }
        break;
      }
      case PrechatFieldType.CHOICE:
        if (!(field.options ?? []).includes(value)) {
          throw new IntakeError(
            field.id,
            `Choose one of the options for "${field.label}".`,
          );
        }
        break;
      case PrechatFieldType.CONSENT:
        if (value !== 'true') {
          throw new IntakeError(
            field.id,
            `"${field.label}" needs your agreement.`,
          );
        }
        consents.push({
          id: field.id,
          text: field.consentText ?? field.label,
          acceptedAt: now.toISOString(),
        });
        break;
      default:
        break;
    }
    stored.push({
      id: field.id,
      label: field.label,
      type: field.type,
      value: value.slice(0, 500),
    });
  }

  return { completedAt: now.toISOString(), answers: stored, consents };
}

/** Whether a page asks anything that must be answered before the chat. */
export function intakeRequired(fields: PrechatField[]): boolean {
  return fields.some((f) => f.required);
}
