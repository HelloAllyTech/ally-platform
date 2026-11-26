import { fixedCrisisInformation } from '../engine/blocked-notice';
import type { ReplyLanguage } from '../engine/reply-language';

/**
 * The fixed words sent to a person whose chat was flagged, and in the alert emails (assistants
 * build, stage 1b; R6 and R8). One file so the approver reads every line in one place.
 *
 * Not generated and not translated at run time: English, Hindi and Hindi in Latin script only.
 * The crisis information is the findahelpline.com link; a builder's own numbers come first when
 * set (R6). The holding message promises a reply that may not come, so its wording needs care.
 */

export const CRISIS_LINK = 'https://findahelpline.com';

// COPY: needs approval
// TF1 round 2 (approved 25 Nov): after a crisis reply, no numbers again (the reply has them).
export const HOLDING_COPY: Record<ReplyLanguage, string> = {
  en: 'Someone from the team will see this and reply as soon as they can.',
  hi: 'टीम का कोई व्यक्ति इसे देखेगा और जितनी जल्दी हो सके जवाब देगा।',
  'hi-latn':
    'Team ka koi vyakti ise dekhega aur jitni jaldi ho sake jawab dega.',
};

// COPY: needs approval
export const NO_ONE_AVAILABLE_COPY: Record<ReplyLanguage, string> = {
  en: 'No one from the team is available to reply right now. {help}',
  hi: 'अभी टीम का कोई व्यक्ति जवाब देने के लिए उपलब्ध नहीं है। {help}',
  'hi-latn':
    'Abhi team ka koi vyakti jawab dene ke liye uplabdh nahin hai. {help}',
};

// COPY: needs approval
const HELP_COPY: Record<ReplyLanguage, { link: string; numbers: string }> = {
  en: {
    link: 'If you need support now, you can find a helpline near you: {link}',
    numbers:
      'If you need support now, you can call {numbers}, or find other helplines: {link}',
  },
  hi: {
    link: 'अगर आपको अभी सहायता चाहिए, तो अपने पास की हेल्पलाइन यहाँ खोजें: {link}',
    numbers:
      'अगर आपको अभी सहायता चाहिए, तो {numbers} पर कॉल करें, या दूसरी हेल्पलाइन यहाँ खोजें: {link}',
  },
  'hi-latn': {
    link: 'Agar aapko abhi sahayata chahiye, to apne paas ki helpline yahan khojein: {link}',
    numbers:
      'Agar aapko abhi sahayata chahiye, to {numbers} par call karein, ya doosri helpline yahan khojein: {link}',
  },
};

/**
 * The help line: the builder's numbers first when set, always the link. In India (`india`), the
 * crisis information with 112 and Tele-MANAS 14416 first (`fixedCrisisInformation`).
 */
export function helpLine(
  language: ReplyLanguage,
  helplineNumbers?: string | null,
  india = false,
): string {
  if (india) return fixedCrisisInformation(helplineNumbers, language, true);
  const numbers = helplineNumbers?.trim();
  const text = numbers ? HELP_COPY[language].numbers : HELP_COPY[language].link;
  return text
    .replace('{numbers}', numbers ?? '')
    .replace('{link}', CRISIS_LINK);
}

/**
 * The line after the crisis reply. TF1 round 2 (Saathi): it no longer repeats the crisis
 * information the reply gave three seconds earlier ("two messages that repeat the numbers"); the
 * "no one is available" message, which can come much later, still carries it.
 */
export function holdingMessage(language: ReplyLanguage): string {
  return HOLDING_COPY[language];
}

// COPY: needs approval (TF1 F19). After an emergency reply (a collapse, a flood), not the self-harm
// help line, which was wrong for them.
export const EMERGENCY_HOLDING_COPY: Record<
  ReplyLanguage,
  { india: string; elsewhere: string }
> = {
  en: {
    india:
      'Someone from the team will reply to you. If anyone is in danger, call 112 now.',
    elsewhere:
      'Someone from the team will reply to you. If anyone is in danger, call your local emergency number now.',
  },
  hi: {
    india:
      'टीम का कोई व्यक्ति आपको जवाब देगा। अगर किसी की जान खतरे में है, तो अभी 112 पर कॉल करें।',
    elsewhere:
      'टीम का कोई व्यक्ति आपको जवाब देगा। अगर किसी की जान खतरे में है, तो अभी अपने स्थानीय आपातकालीन नंबर पर कॉल करें।',
  },
  'hi-latn': {
    india:
      'Team ka koi vyakti aapko jawab dega. Agar kisi ki jaan khatre mein hai, to abhi 112 par call karein.',
    elsewhere:
      'Team ka koi vyakti aapko jawab dega. Agar kisi ki jaan khatre mein hai, to abhi apne local emergency number par call karein.',
  },
};

export function emergencyHoldingMessage(
  language: ReplyLanguage,
  _helplineNumbers?: string | null,
  india = false,
): string {
  return EMERGENCY_HOLDING_COPY[language][india ? 'india' : 'elsewhere'];
}

export function noOneAvailableMessage(
  language: ReplyLanguage,
  helplineNumbers?: string | null,
  india = false,
): string {
  return NO_ONE_AVAILABLE_COPY[language].replace(
    '{help}',
    helpLine(language, helplineNumbers, india),
  );
}

// COPY: needs approval
/** Alert emails carry no message text: the assistant's name and a link only. */
export const ALERT_COPY = {
  crisisSubject: 'Urgent: a conversation was flagged for safety',
  crisisBody:
    'A conversation with {assistant} was flagged for safety. Please open it and reply as soon as you can: {link}',
  digestSubject: 'Conversations are waiting for a person',
  digestBody:
    'Conversations with {assistant} are waiting for a person. Open them: {link}',
  untakenSlack:
    'A flagged conversation on "{assistant}" (chatbot {chatbotId}) has had no one take it for {minutes} minutes.',
  failedSlack:
    'An alert for chatbot {chatbotId} ({kind}) could not be delivered after {attempts} attempts: {error}',
} as const;
