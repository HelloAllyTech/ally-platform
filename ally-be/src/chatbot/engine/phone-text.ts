/**
 * Phone numbers in free text (TF1 round 2, S-1: Saathi's whole setup answer, hours and all, went
 * into every crisis reply as its "number"). One place decides what counts as a number, so a crisis
 * reply, the run-failed reply and the owner's Safety screen agree.
 */

/** A phone number: an optional +, then at least 8 digits with spaces, dashes or brackets. */
const PHONE = /\(?\+?\d[\d\s\-()]{6,}\d/g;
/** "2024-2025" has 8 digits but is a span of years. */
const YEAR_RANGE = /^(?:19|20)\d\d\s*[-–]\s*(?:19|20)\d\d$/;
/**
 * A short helpline code (112, 1098, 14416): 3 to 6 digits standing alone, never part of a price,
 * a thousands group, a time, a date or a percentage.
 */
const SHORT_CODE =
  /(?<![\d₹$€£.,:/\p{L}])(?<!\bRs\.?\s?)\d{3,6}(?![\d.,:/%]|\s?(?:am|pm|hrs?|rs|rupees)\b)/giu;
const YEAR = /^(?:19|20)\d\d$/;

const digits = (text: string) => text.replace(/\D/g, '');

/**
 * A number never ends inside a bracket it didn't open: "+91 80 4567 8800 (9 am–6 pm)" is
 * "+91 80 4567 8800", not "+91 80 4567 8800 (9" (TF1 round 2: Pawsome's contact line).
 */
function balanced(number: string): string {
  let out = number;
  while ((out.match(/\(/g) ?? []).length > (out.match(/\)/g) ?? []).length) {
    out = out.slice(0, out.lastIndexOf('(')).trim();
  }
  while ((out.match(/\)/g) ?? []).length > (out.match(/\(/g) ?? []).length) {
    out = out.slice(0, out.lastIndexOf(')')).trim();
  }
  return out;
}

/** Every real phone number in a text, as written. Years, prices and times have too few digits. */
export function phonesIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.match(PHONE) ?? []) {
    const number = balanced(match.trim());
    const count = digits(number).length;
    if (count < 8 || count > 13 || YEAR_RANGE.test(number)) continue;
    found.push(number);
  }
  return found;
}

/** The first real phone number in a text, or null. */
export function phoneIn(text: string): string | null {
  return phonesIn(text)[0] ?? null;
}

/** Short helpline codes in a text (112, 1098, 14416), leaving out any inside `phones`. */
function shortCodesIn(text: string, phones: string[]): string[] {
  const inPhones = phones.map(digits).join(' ');
  return (text.match(SHORT_CODE) ?? []).filter(
    (code) => !YEAR.test(code) && !inPhones.includes(code),
  );
}

/** "Call us on", "Phone:" and the like before a number say nothing a crisis reply doesn't. */
const LEAD_IN =
  /^(?:(?:please\s+)?(?:call|phone|dial|ring|contact|whatsapp)(?:\s+us)?(?:\s+(?:on|at))?|(?:phone|tel|mobile|number|helpline)\s*:)\s*/i;

/** A label beside a number is kept when it is short and not a sentence ("iCall 9152987821"). */
const MAX_LABEL = 24;

/**
 * The helplines a crisis reply may give, from whatever was typed: each comma, semicolon, slash or
 * line separated piece is kept only when it carries a phone number or a short helpline code; a
 * short label stays beside its number, anything longer (hours, notes, sentences) is dropped and
 * only the number kept. A comma inside a number ("2,000") never splits it. Duplicates go. Empty
 * when no number is found: free text never reaches a crisis reply.
 */
export function helplineLines(text: string | null | undefined): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of (text ?? '').split(/\s*(?:,(?!\d)|;|\n|\s\/\s)\s*/)) {
    const piece = raw.trim().replace(LEAD_IN, '').trim();
    if (!piece) continue;
    const phones = phonesIn(piece);
    let label = piece;
    for (const phone of phones) label = label.replace(phone, ' ');
    const short = label.replace(/\s+/g, ' ').trim().length <= MAX_LABEL;
    const numbers = short ? [...phones, ...shortCodesIn(label, [])] : phones;
    if (!numbers.length) continue;
    const fresh = numbers.filter((n) => !seen.has(digits(n)));
    if (!fresh.length) continue;
    numbers.forEach((n) => seen.add(digits(n)));
    kept.push(short && !/[.!?]\s/.test(piece) ? piece : fresh.join(', '));
  }
  return kept.join(', ');
}
