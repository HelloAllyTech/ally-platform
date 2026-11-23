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

/**
 * Q4 3b ("Can you tell me if I have depression?" got "I don't know the answer to that; please
 * contact the team"): a request for a diagnosis gets a decline that says who can assess it, the
 * organisation's line and Tele-MANAS. Wording for review in Q4-PROMPTS.md (E1).
 */
const DIAGNOSIS: Record<ReplyLanguage, string> = {
  en: "I can't tell you whether you have that: only a doctor or mental health professional can assess it. If you'd like to talk it through, you can reach {organisation} on {contact}. If you're struggling right now, you can call Tele-MANAS on 14416 (free, 24×7).",
  hi: 'मैं यह नहीं बता सकता कि आपको यह है या नहीं: इसकी जाँच सिर्फ़ डॉक्टर या मानसिक स्वास्थ्य विशेषज्ञ कर सकते हैं। अगर आप बात करना चाहें, तो {organisation} से {contact} पर संपर्क कर सकते हैं। अगर अभी मुश्किल हो रही है, तो Tele-MANAS को 14416 पर कॉल करें (मुफ़्त, 24×7)।',
  'hi-latn':
    'Main yeh nahi bata sakta ki aapko yeh hai ya nahi: iski jaanch sirf doctor ya mental health professional kar sakte hain. Agar aap baat karna chahein, toh {organisation} se {contact} par sampark kar sakte hain. Agar abhi mushkil ho rahi hai, toh Tele-MANAS ko 14416 par call karein (free, 24×7).',
};

/** "Do I have depression?", "Am I bipolar?", "kya mujhe anxiety hai?": a request to be diagnosed. */
const ASKS_FOR_DIAGNOSIS =
  /\b(?:do|could|might) i have\b[^?.!]{0,40}\b(?:depression|anxiety|ocd|adhd|ptsd|bipolar|autism|schizophrenia|an? (?:eating|anxiety|mental) disorder|a mental illness|cancer|diabetes)\b|\b(?:tell|say) (?:me )?(?:if|whether) i(?:'m| am| have)\b|\bam i (?:depressed|bipolar|autistic|mentally ill)\b|\bkya mujhe\b[^?.!]{0,30}\b(?:depression|anxiety|bipolar|adhd)\b[^?.!]{0,10}\bhai\b|क्या मुझे[^?।]{0,30}(?:डिप्रेशन|अवसाद|एंग्जायटी)/iu;

export const asksForDiagnosis = (text: string | null | undefined): boolean =>
  ASKS_FOR_DIAGNOSIS.test(text ?? '');

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
    : asksForDiagnosis(options.question)
      ? DIAGNOSIS
      : asksAboutMedicine(options.question)
        ? MEDICINE
        : null;
  if (!texts || !options.contact) return null;
  return texts[options.language]
    .replace('{organisation}', options.organisation)
    .replace('{contact}', options.contact);
}
