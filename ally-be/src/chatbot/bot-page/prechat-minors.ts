import { PrechatFieldType } from '../enum/bot-page.enum';
import type { PrechatField } from '../type/bot-page.type';

/** A question that asks a visitor who they are or how to reach them. */
const PERSONAL =
  /\b(name|phone|mobile|number|whats\s?app|e-?mail|contact|address)\b/i;

/**
 * The pre-chat questions an assistant may ask (Q3-fast Part 1, 17 Nov S3): with the young-people
 * pack on, never a name, phone, email or other contact detail, since under-18s aren't asked for
 * details. Applied where the page's questions are read and at publish, so assistants already live
 * lose them too without a migration. Every other assistant keeps its questions as they are.
 */
export function prechatFor(
  fields: PrechatField[],
  safetyPack: string | null | undefined,
): PrechatField[] {
  if (safetyPack !== 'minors') return fields;
  return fields.filter(
    (field) =>
      field.type !== PrechatFieldType.PHONE &&
      field.type !== PrechatFieldType.EMAIL &&
      !(field.type === PrechatFieldType.TEXT && PERSONAL.test(field.label)),
  );
}
