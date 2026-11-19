import { isContactRelation } from '../lists/list-fields';
import type { ListDefinitionView } from '../lists/list-definitions.service';
import type { ListRecordView } from '../lists/list-types';

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
}

/** An entry as the question names it: its title, the person, and up to two other details. */
function describe(list: ListDefinitionView, record: ListRecordView): Described {
  const titleKey = list.settings?.title_field;
  const personKey = list.settings?.person_field;
  const display = record.display ?? {};
  const details: string[] = [];
  let status: string | undefined;
  let person = personKey ? display[personKey] : undefined;
  for (const f of list.fields) {
    if (f.archived_at || f.privacy?.masked) continue;
    const value = String(display[f.key] ?? '').trim();
    if (!value) continue;
    if (f.key === 'status') {
      status = value;
      continue;
    }
    if (f.key === titleKey) continue;
    if (f.options && isContactRelation(f)) {
      person = person ?? value;
      continue;
    }
    if (f.key === personKey) continue;
    if (value === record.title) continue;
    if (details.length < 2) details.push(value);
  }
  return {
    title: record.title,
    ...(person ? { person } : {}),
    details,
    ...(status ? { status } : {}),
  };
}

const said = (d: Described, fallback: string): string =>
  d.details.length ? d.details.join(', ') : fallback;

/** Whether a change ends the entry ("cancelled", "no show"…): then the question says cancel. */
const ENDS = /cancel|withdraw|no.?show|rejected|declined/i;

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
): { key: string; questions: OfferQuestions } {
  const a = describe(list, after);
  const key = JSON.stringify([
    kind,
    list.key,
    before?.id ?? null,
    a.title,
    Object.entries(after.display ?? {})
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
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
  if (booking) {
    return {
      key,
      questions: {
        en: `Shall I book ${said(a, 'this')} on ${a.title}${forWhom}?`,
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

/** What the agent reads when a write waits for a yes. */
export const askFirstMessage = (question: string): string =>
  `Not done yet: nothing is saved until the person says yes. Ask them exactly this, and nothing ` +
  `else about it: "${question}"`;
