import { isContactRelation } from '../lists/list-fields';
import type { ListDefinitionView } from '../lists/list-definitions.service';
import type { ListRecordView } from '../lists/list-types';

import { ListFieldType } from '../enum/list.enum';
import {
  atDefault,
  headlineFor,
  isRealName,
  placesFor,
  placesWords,
  placesWordsHi,
  type CardHeadline,
  type RelatedWords,
} from './entry-words';
/**
 * Consent for a list write (chunk H1 Part B). The agent may add or change an entry only after the
 * person said a plain yes, in a LATER turn, to an assistant message that named exactly that entry:
 * its day and time, its details (the service) and the person. Enforced in ally-be's gateway, so no
 * prompt, playbook or owner instruction can switch it off.
 *
 * The flow:
 * 1. The agent calls `create_*`/`update_*`. The gateway dry-runs the write (so a full slot or the
 *    per-person limit is refused before anything is asked) and, without consent, stores an offer
 *    for this conversation and answers `needs_confirmation` with a fixed question built from the
 *    dry-run record. ally-be makes sure the reply carries that question.
 * 2. Next turn, when ally-be signs the run token, it checks the person's message is a plain yes and
 *    the assistant's previous message contained the question; only then does the token carry the
 *    offer's id.
 * 3. The gateway writes only when the token's offer id matches the stored offer AND the write is
 *    the same entry. Anything else is a new offer and a new question.
 */

/** A write waiting for a yes: one per conversation, the latest. */
export interface WriteOffer {
  id: string;
  /** The run that asked: the yes must come in a later one. */
  runId: string;
  tool: string;
  /** What exactly would be written: the same key or no write. */
  key: string;
  list: string;
  questions: OfferQuestions;
  createdAt: number;
  /**
   * BT1: the tool's input as the agent sent it, so a Confirm tap writes exactly this entry through
   * the same tool, with no model call; and the card the tap confirms, built from the dry-run entry.
   * Absent on offers stored before BT1 (those are confirmed by a typed yes only).
   */
  input?: Record<string, string | number>;
  card?: OfferCard;
}

/** What a confirmation card shows (BT1): built in code from the dry-run entry, never from text. */
export interface OfferCard {
  action: 'create' | 'update' | 'cancel';
  list: string;
  title: string;
  headline: CardHeadline;
  details: { label: string; value: string }[];
}

export interface OfferQuestions {
  en: string;
  hi: string;
}

/** How long an unanswered question stays answerable. */
export const OFFER_TTL_S = 24 * 60 * 60;

// ---- a plain yes -------------------------------------------------------------------------------

const YES =
  /(?:^|[\s,.!])(?:yes|yeah|yep|yup|ya|yea|sure|ok|okay|okk?|confirm(?:ed)?|correct|right|perfect|great|fine|go ahead|book it|do it|please do|sounds good|that works|done|haan|haa|han|ha|haanji|ji|jee|theek hai|thik hai|thik h|chalega|kar do|kardo|kar dijiye|हाँ|हां|हा|जी|ठीक है|कर दो|कर दीजिए|कीजिए|बुक कर दो|बुक कर दीजिए)(?=$|[\s,.!])/iu;

/** Anything that adds or changes a detail, or says no: then it isn't a yes to the question. */
const NOT_YES =
  /\?|\d|[०-९]|(?:^|[\s,.!])(?:no|not|nope|don'?t|cancel|instead|but|change|another|different|other|then|rather|later|also|and|except|wait|nahi|nahin|nai|mat|na|o'?clock|baje|नहीं|मत|बदल|लेकिन|पर|बजे)(?=$|[\s,.!])/iu;

/** At most this many words: "Yes please, go ahead and book it." */
const MAX_YES_WORDS = 8;

/**
 * Whether a message is a plain yes, with nothing added or changed: "Yes.", "Yes, book it.",
 * "haan kar do", "हाँ, बुक कर दीजिए". A message that names a time ("OK, 1pm then for the LASIK
 * consultation."), asks something, or says no is never one.
 */
export function isPlainYes(text: string | null | undefined): boolean {
  const said = (text ?? '').trim();
  if (!said) return false;
  const words = said.split(/\s+/).filter(Boolean);
  if (words.length > MAX_YES_WORDS) return false;
  return YES.test(` ${said} `) && !NOT_YES.test(` ${said} `);
}

// ---- the question ------------------------------------------------------------------------------

const normal = (text: string): string =>
  text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[“”"'’‘*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Whether an assistant message carried the offer's question, in either language. */
export function questionShown(
  message: string | null | undefined,
  questions: OfferQuestions,
): boolean {
  const said = normal(message ?? '');
  if (!said) return false;
  return [questions.en, questions.hi].some((q) => said.includes(normal(q)));
}

/** The question in the reply's language: Hindi for a Hindi reply, otherwise English. */
export const questionIn = (
  questions: OfferQuestions,
  language: string | null | undefined,
): string => (/^hi/i.test(language ?? '') ? questions.hi : questions.en);

interface Described {
  title: string;
  person?: string;
  details: string[];
  status?: string;
  /** The related entry's day, time and place (Q4 G5): a registration's event, a booking's slot. */
  when?: string;
  where?: string;
  /** Places it takes, on a list with a capacity rule ("1 place"). */
  places?: number;
}

/** An entry as the question names it: its title, the person, and up to two other details. */
/** The detail that holds who a booking is for (Q4 B13; list-tools' `bookedForField`). */
const BOOKED_FOR = /booked.?for|patient|attendee|guest.?name|for.?whom/i;

function describe(
  list: ListDefinitionView,
  record: ListRecordView,
  related: RelatedWords = {},
): Described {
  const titleKey = list.settings?.title_field;
  const personKey = list.settings?.person_field;
  const display = record.display ?? {};
  const details: string[] = [];
  let status: string | undefined;
  let person = personKey ? display[personKey] : undefined;
  let bookedFor: string | undefined;
  for (const f of list.fields) {
    if (f.archived_at || f.privacy?.masked) continue;
    const value = String(display[f.key] ?? '').trim();
    if (!value) continue;
    if (f.key === 'status') {
      status = value;
      continue;
    }
    if (f.key === titleKey) continue;
    // Q4 B13: a booking for someone else is said back as theirs ("for Lakshmi Rao").
    if (
      f.type === ListFieldType.TEXT &&
      BOOKED_FOR.test(`${f.key} ${f.label}`)
    ) {
      bookedFor = value;
      continue;
    }
    // Q4 G5: a number at its default ("Guests 0") is never said back; places say it instead.
    if (atDefault(f, record.data?.[f.key] ?? value)) continue;
    if (f.type === ListFieldType.NUMBER && placesFor(list, {}) !== null)
      continue;
    if (f.options && isContactRelation(f)) {
      person = person ?? value;
      continue;
    }
    if (f.key === personKey) continue;
    if (value === record.title) continue;
    if (details.length < 2) details.push(value);
  }
  // A contact with no name yet ("A contact"), or Try it's test visitor: not a name to say back
  // (Q4 G5, Round 8: "Shall I add this… for Try it").
  if (person && !isRealName(person)) person = undefined;
  if (bookedFor && isRealName(bookedFor)) person = bookedFor;
  const places = placesFor(list, record.data ?? {});
  return {
    title: record.title,
    ...(person ? { person } : {}),
    details,
    ...(status ? { status } : {}),
    ...(related.when ? { when: related.when } : {}),
    ...(related.where ? { where: related.where } : {}),
    ...(places !== null ? { places } : {}),
  };
}

/** " on Sun 29 Nov, 11:00 at Bandra West station (1 place)" (Q4 G5). */
const whenWhere = (d: Described): string =>
  [
    d.when ? ` on ${d.when}` : '',
    d.where ? ` at ${d.where}` : '',
    d.places ? ` (${placesWords(d.places)})` : '',
  ].join('');
const whenWhereHi = (d: Described): string =>
  [
    d.when ? ` ${d.when}` : '',
    d.where ? `, ${d.where}` : '',
    d.places ? ` (${placesWordsHi(d.places)})` : '',
  ].join('');

const said = (d: Described, fallback: string): string =>
  d.details.length ? d.details.join(', ') : fallback;

/** Whether a change ends the entry ("cancelled", "no show"…): then the question says cancel. */
const ENDS = /cancel|withdraw|no.?show|rejected|declined/i;

/** Whether an update ends the entry (BT1: its card says cancel, its done card "Cancelled"). */
export function endsEntry(
  list: ListDefinitionView,
  after: ListRecordView,
  before: ListRecordView | null,
): boolean {
  if (!before) return false;
  const a = describe(list, after).status;
  const b = describe(list, before).status;
  return Boolean(a && ENDS.test(a) && !(b && ENDS.test(b)));
}

/**
 * What exactly a write would do, as a key (the same key or no write) and the question that names
 * it. `before` is the entry an update changes; `booking` is a list people book into.
 */
export function offerFor(
  list: ListDefinitionView,
  kind: 'create' | 'update',
  after: ListRecordView,
  before: ListRecordView | null,
  booking: boolean,
  related: RelatedWords = {},
  /** Q4 B13: the person a booking for someone else is for, said back in the question. */
  forPerson?: string,
): { key: string; questions: OfferQuestions } {
  const a = describe(list, after, related);
  if (forPerson) a.person = forPerson;
  // The person isn't in the key: the token pins every write to the person in the chat, and their
  // name can change between the question and the yes (it is saved after a reply).
  const personKey = list.settings?.person_field;
  const key = JSON.stringify([
    kind,
    list.key,
    before?.id ?? null,
    a.title,
    Object.entries(after.display ?? {})
      .filter(
        ([k, v]) =>
          k !== personKey && v !== '' && v !== null && v !== undefined,
      )
      .filter(([k]) => !isPersonField(list, k))
      // Q4 G5 (Round 7 R5): a yes still counts when the model only fills a quantity or the
      // person's name between the question and the yes. The list's rules still check both.
      .filter(([k]) => !isQuantityOrName(list, k))
      .sort(([x], [y]) => x.localeCompare(y)),
  ]);
  if (kind === 'update' && before) {
    const b = describe(list, before);
    if (a.status && ENDS.test(a.status) && !(b.status && ENDS.test(b.status))) {
      return {
        key,
        questions: {
          en: `Shall I cancel your ${said(b, 'entry')} on ${b.title}?`,
          hi: `क्या मैं ${b.title} का आपका ${said(b, 'एंट्री')} रद्द कर दूँ?`,
        },
      };
    }
    const sameDetails = said(a, '') === said(b, '');
    return {
      key,
      questions: sameDetails
        ? {
            en: `Shall I move your ${said(b, 'entry')} on ${b.title} to ${a.title}?`,
            hi: `क्या मैं ${b.title} का आपका ${said(b, 'एंट्री')} बदलकर ${a.title} कर दूँ?`,
          }
        : {
            en: `Shall I change your ${said(b, 'entry')} on ${b.title} to ${said(a, 'entry')} on ${a.title}?`,
            hi: `क्या मैं ${b.title} का आपका ${said(b, 'एंट्री')} बदलकर ${a.title} पर ${said(a, 'एंट्री')} कर दूँ?`,
          },
    };
  }
  const forWhom = a.person ? ` for ${a.person}` : '';
  const forWhomHi = a.person ? `${a.person} के लिए ` : '';
  // Q4 G5 (approved 23 Nov): the verb follows what the list is for, as the card's headline does.
  const asked = askedByKind(list, a, booking);
  if (asked) return { key, questions: asked };
  if (booking) {
    // The related entry names the day, time and place (Q4 G5): "Shall I book Bandra Sunday food
    // drive on Sun 29 Nov, 11:00 at Bandra West station (1 place)?", never "book 0 on…".
    if (a.when || a.where) {
      const what = [a.title, ...a.details].filter(Boolean).join(', ');
      return {
        key,
        questions: {
          en: `Shall I book ${what}${whenWhere(a)}${forWhom}?`,
          hi: `क्या मैं ${forWhomHi}${what}${whenWhereHi(a)} बुक कर दूँ?`,
        },
      };
    }
    const places = a.places ? ` (${placesWords(a.places)})` : '';
    return {
      key,
      questions: {
        en: `Shall I book ${said(a, 'this')} on ${a.title}${places}${forWhom}?`,
        hi: `क्या मैं ${forWhomHi}${a.title} पर ${said(a, 'यह')} बुक कर दूँ?`,
      },
    };
  }
  const what = [a.title, ...a.details].filter(Boolean).join(', ');
  return {
    key,
    questions: {
      en: `Shall I add this to ${list.name}: ${what}${forWhom}?`,
      hi: `क्या मैं इसे ${list.name} में जोड़ दूँ: ${what}${a.person ? ` (${a.person})` : ''}?`,
    },
  };
}

/**
 * The question for a registration, a callback or an application (Q4 G5): "Shall I register you
 * for…?", "Shall I request a callback for…?", "Shall I send your application for…?". Null for a
 * booking or anything else, which keeps "Shall I book…?" or "Shall I add… to {list}?".
 */
function askedByKind(
  list: ListDefinitionView,
  a: Described,
  booking: boolean,
): OfferQuestions | null {
  const kind = headlineFor(list, 'create', booking);
  if (kind !== 'registered' && kind !== 'callback' && kind !== 'application') {
    return null;
  }
  const what = [a.title, ...a.details]
    .filter((part) => part && part !== a.person)
    .join(', ');
  if (kind === 'registered') {
    const who = a.person ?? 'you';
    const whoHi = a.person ? `${a.person} को` : 'आपको';
    return {
      en: `Shall I register ${who} for ${what}${whenWhere(a)}?`,
      hi: `क्या मैं ${whoHi} ${what}${whenWhereHi(a)} के लिए रजिस्टर कर दूँ?`,
    };
  }
  if (kind === 'callback') {
    const about = what ? ` about ${what}` : '';
    const aboutHi = what ? ` (${what})` : '';
    return {
      en: `Shall I request a callback for ${a.person ?? 'you'}${about}?`,
      hi: `क्या मैं ${a.person ? `${a.person} के लिए` : 'आपके लिए'} कॉलबैक का अनुरोध भेज दूँ${aboutHi}?`,
    };
  }
  const forWhom = a.person ? ` (${a.person})` : '';
  return {
    en: `Shall I send your application for ${what || list.name}${forWhom}?`,
    hi: `क्या मैं ${what || list.name} के लिए आपका आवेदन भेज दूँ${forWhom}?`,
  };
}

/** What the agent reads when a write waits for a yes. */
export const askFirstMessage = (question: string): string =>
  `Not done yet: nothing is saved until the person says yes. Ask them exactly this, and nothing ` +
  `else about it: "${question}"`;

/** A number field, or a field for a name: what the model may still fill after the question. */
function isQuantityOrName(list: ListDefinitionView, key: string): boolean {
  const f = list.fields.find((field) => field.key === key);
  if (!f) return false;
  if (f.type === ListFieldType.NUMBER) return true;
  return (
    f.type === ListFieldType.TEXT && /(^|_)name$|^name|full.?name/i.test(f.key)
  );
}

function isPersonField(list: ListDefinitionView, key: string): boolean {
  const f = list.fields.find((field) => field.key === key);
  return Boolean(f?.options && isContactRelation(f));
}

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

/**
 * Whether an assistant message named this entry: its date (day and month), its time (13:00,
 * 1:00 PM, 1pm) and its details (the service), in any wording. Used when the person said a plain
 * yes to a question the model wrote itself (chunk H1): the same entry, named, is what they agreed
 * to. A title that isn't a day and time must appear as written.
 */
export function namesEntry(
  message: string | null | undefined,
  list: ListDefinitionView,
  record: ListRecordView,
): boolean {
  const text = normal(message ?? '');
  if (!text) return false;
  const d = describe(list, record);
  if (!d.details.every((detail) => text.includes(normal(detail)))) return false;
  const when = new RegExp(
    `(\\d{1,2})\\s+(${MONTHS})\\w*\\s+\\d{4},?\\s+(\\d{1,2}):(\\d{2})`,
    'i',
  ).exec(d.title);
  if (!when) return text.includes(normal(d.title));
  const [, day, month, hh, mm] = when;
  const hour = Number(hh);
  const twelve = hour % 12 || 12;
  const ampm = hour < 12 ? 'am' : 'pm';
  const times = [
    `${hh}:${mm}`,
    `${hour}:${mm}`,
    `${twelve}:${mm} ${ampm}`,
    `${twelve}:${mm}${ampm}`,
    ...(mm === '00' ? [`${twelve} ${ampm}`, `${twelve}${ampm}`] : []),
  ];
  const dated =
    new RegExp(`\\b${Number(day)}(?:st|nd|rd|th)?\\s+${month}`, 'i').test(
      text,
    ) || new RegExp(`${month}\\w*\\s+${Number(day)}\\b`, 'i').test(text);
  return dated && times.some((t) => text.includes(t));
}
