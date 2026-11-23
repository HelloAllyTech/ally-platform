import type { ReplyLanguage } from './reply-language';

/**
 * Fixed replies for a run that ends in an empty decline (chunk H1 Part D, wording approved 19 Nov):
 * an upset person gets a warm line instead of the bot's generic decline wording, and a question
 * about medicines or treatment gets a polite decline that points to their doctor. Both end with
 * how to reach the business. Fixed text, never generated.
 */
const UPSET: Record<ReplyLanguage, string> = {
  en: "I'm sorry you're going through this, and it's completely understandable to feel this way. If you'd like to talk it through with our team, you can reach {organisation} on {contact}.",
  hi: 'मुझे दुख है कि आप ऐसा महसूस कर रहे हैं, और ऐसा महसूस करना बिल्कुल स्वाभाविक है। अगर आप हमारी टीम से बात करना चाहें, तो {organisation} से {contact} पर संपर्क कर सकते हैं।',
  'hi-latn':
    'Mujhe afsos hai ki aap aisa mehsoos kar rahe hain, aur aisa lagna bilkul swabhavik hai. Agar aap hamari team se baat karna chahein, toh {organisation} se {contact} par sampark kar sakte hain.',
};

const MEDICINE: Record<ReplyLanguage, string> = {
  en: "I'm sorry, I can't advise on medicines or treatment. Please check with your doctor, or contact {organisation} on {contact}.",
  hi: 'माफ़ कीजिए, मैं दवाओं या इलाज के बारे में सलाह नहीं दे सकता। कृपया अपने डॉक्टर से पूछें, या {organisation} से {contact} पर संपर्क करें।',
  'hi-latn':
    'Maaf kijiye, main dawaiyon ya ilaaj ke baare mein salaah nahi de sakta. Kripya apne doctor se poochhein, ya {organisation} se {contact} par sampark karein.',
};

/** A question asking what medicine to take or use, or how much. */
const ASKS_ABOUT_MEDICINE =
  /\b(?:dose|dosage|medicines?|medications?|tablets?|pills?|capsules?|drops|ointment|cream|antibiotics?|painkillers?|paracetamol|ibuprofen|aspirin|steroids?|dawa(?:i|ai|aiyan)?|dawai|goli|ilaaj)\b|\bcan i (?:take|use|apply|put)\b|\bhow much (?:should|can) i take\b|दवा|दवाई|गोली|ड्रॉप|इलाज/iu;

export const asksAboutMedicine = (text: string | null | undefined): boolean =>
  ASKS_ABOUT_MEDICINE.test(text ?? '');

/**
 * The caring reply for an empty decline, or null when the generic decline wording should go out:
 * upset first (how they feel matters more than the topic), then a medicine question.
 */
export function caringDecline(options: {
  upset: boolean;
  question: string;
  language: ReplyLanguage;
  organisation: string;
  contact: string | null;
}): string | null {
  const texts = options.upset
    ? UPSET
    : asksAboutMedicine(options.question)
      ? MEDICINE
      : null;
  if (!texts || !options.contact) return null;
  return texts[options.language]
    .replace('{organisation}', options.organisation)
    .replace('{contact}', options.contact);
}
