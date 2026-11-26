import type { ReplyLanguage } from '../chatbot/engine/reply-language';

/**
 * Every new fixed text from chunk WA-A, in one place (listed for approval in
 * `docs/agents-v2/TEXTS-WA-A.md`). The person-facing lines exist in English, Hindi and Hinglish,
 * like every other fixed reply (`reply-language.ts`); other languages fall back to English.
 */

// COPY: needs approval
/** A voice note that couldn't be transcribed, or is over 2 minutes. */
export const VOICE_NOTE_FAILED: Record<ReplyLanguage, string> = {
  en: "Sorry, I couldn't understand that voice note. Could you type your message instead?",
  hi: 'माफ़ कीजिए, मैं यह वॉइस नोट समझ नहीं पाया। क्या आप अपना संदेश लिखकर भेज सकते हैं?',
  'hi-latn':
    'Maaf kijiye, main yeh voice note samajh nahi paaya. Kya aap apna message type karke bhej sakte hain?',
};

// COPY: needs approval
/** An image or document: kept for the team, not read by the assistant (yet). */
export const FILE_NOT_READ: Record<ReplyLanguage, string> = {
  en: "Thanks, I've received your file, but I can't read files yet. Could you tell me in a message what you need?",
  hi: 'धन्यवाद, आपकी फ़ाइल मिल गई है, लेकिन मैं अभी फ़ाइलें नहीं पढ़ सकता। क्या आप संदेश में बता सकते हैं कि आपको क्या चाहिए?',
  'hi-latn':
    'Dhanyavaad, aapki file mil gayi hai, lekin main abhi files nahi padh sakta. Kya aap message mein bata sakte hain ki aapko kya chahiye?',
};

// COPY: needs approval
/** The invite-only refusal on a customer assistant, after the crisis check. */
export const INVITE_ONLY: Record<
  ReplyLanguage,
  { withContact: string; withoutContact: string }
> = {
  en: {
    withContact:
      'This assistant is by invitation. Please contact {organisation} at {contact}.',
    withoutContact:
      'This assistant is by invitation. Please contact {organisation}.',
  },
  hi: {
    withContact:
      'यह सहायक केवल आमंत्रण पर है। कृपया {organisation} से {contact} पर संपर्क करें।',
    withoutContact:
      'यह सहायक केवल आमंत्रण पर है। कृपया {organisation} से संपर्क करें।',
  },
  'hi-latn': {
    withContact:
      'Yeh assistant sirf invitation par hai. Kripya {organisation} se {contact} par sampark karein.',
    withoutContact:
      'Yeh assistant sirf invitation par hai. Kripya {organisation} se sampark karein.',
  },
};

// COPY: needs approval
/**
 * Why a WhatsApp send failed, in plain words for the team in the Inbox, by Meta's error code
 * (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes). English only:
 * the dashboard is in English.
 */
export const FAILED_SEND_REASONS: Record<number, string> = {
  131047:
    'More than 24 hours have passed since they last wrote, so WhatsApp only allows an approved template now.',
  131026:
    "WhatsApp couldn't deliver it. The number may not be on WhatsApp, or their app may need updating.",
  131051: "WhatsApp doesn't support this kind of message.",
  131052: "The file they sent couldn't be downloaded from WhatsApp.",
  131053:
    "The file couldn't be sent. It may be too large, or a type WhatsApp doesn't accept.",
  131049:
    'WhatsApp held it back to limit how many business messages one person gets. Try again later.',
  131050: 'They have chosen not to receive messages from this business.',
  131056:
    'Too many messages to this person in a short time. Try again in a few minutes.',
  130429:
    'Too many messages from this number in a short time. Try again in a few minutes.',
  131048:
    'WhatsApp is limiting messages from this number because of its quality rating.',
  131021: "A message can't be sent to the same number it comes from.",
  131031: 'Meta has locked this WhatsApp number. Contact Ally.',
  131042: "There's a payment problem on the WhatsApp account. Contact Ally.",
  368: 'Meta has restricted this number for a policy issue. Contact Ally.',
  190: 'The connection to WhatsApp needs to be renewed. Contact Ally.',
  100: 'WhatsApp rejected the format of this message.',
};

// COPY: needs approval
export const FAILED_SEND_FALLBACK =
  "WhatsApp couldn't send it. Try again, and contact Ally if it keeps failing.";

/** The plain-words reason for a failed send: by Meta's code, else the fallback. */
export function failedSendReason(code: number | null | undefined): string {
  return (code != null && FAILED_SEND_REASONS[code]) || FAILED_SEND_FALLBACK;
}
