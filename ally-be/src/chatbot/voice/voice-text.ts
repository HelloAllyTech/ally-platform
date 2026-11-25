import type { ReplyLanguage } from '../engine/reply-language';

/**
 * The fixed texts a person sees, in the assistant's voice and their language (TF1 round 2,
 * Saathi B-1 and B-13). One place for each: a template's voice (stored on the chatbot's settings
 * as `voice`, written when the template is installed) or, without one, the neutral platform
 * default. Never the staff WhatsApp wording ("My reference material does not cover that. A
 * colleague or supervisor is the better route for this one."), which is for staff only.
 *
 * Crisis and emergency replies keep their own fixed core (112, 14416, the confirmed helpline);
 * only `crisis_lead`, one short warm sentence, may come from the voice.
 */
export const VOICE_KEYS = [
  'decline',
  'contact_line',
  'override_decline',
  'name_notice',
  'name_forgotten',
  // One short sentence before the fixed crisis core, same message; no number, no advice.
  'crisis_lead',
  'crisis_lead_emergency',
] as const;
export type VoiceKey = (typeof VOICE_KEYS)[number];

export type VoiceTexts = Partial<
  Record<VoiceKey, Partial<Record<ReplyLanguage, string>>>
>;

/** A template's voice, as stored on `chatbots.settings.voice`. */
export interface ChatbotVoice {
  /** The template it came from (`helpline`, `services`, …). */
  template?: string;
  /** How the assistant refers to itself and the organisation, for the agent's prompt. */
  role?: string;
  texts?: VoiceTexts;
  /** Words this voice never uses. */
  never?: string[];
  /** Keys the owner changed: never overwritten by a template or a backfill. */
  ownerKeys?: VoiceKey[];
}

// COPY: needs approval (TF1 round 2, Saathi B-1). The neutral defaults, for an assistant with no
// voice of its own.
export const NEUTRAL_VOICE: Record<VoiceKey, Record<ReplyLanguage, string>> = {
  decline: {
    en: "I don't have that information.",
    hi: 'मेरे पास यह जानकारी नहीं है।',
    'hi-latn': 'Mere paas yeh jaankari nahi hai.',
  },
  contact_line: {
    en: 'You can reach us on {contact}.',
    hi: 'आप हमसे {contact} पर संपर्क कर सकते हैं।',
    'hi-latn': 'Aap humse {contact} par sampark kar sakte hain.',
  },
  // TF1 round 2 (Saathi B-2, decided 25 Nov): the reply that first learns the name says so, once.
  name_notice: {
    en: "I'll use the name {name} in our chats. Say 'forget my name' any time.",
    hi: "मैं हमारी बातचीत में आपका नाम {name} इस्तेमाल करूँगा। कभी भी 'मेरा नाम भूल जाओ' लिखें।",
    'hi-latn':
      "Main hamari baatcheet mein aapka naam {name} use karunga. Kabhi bhi 'mera naam bhool jao' likhein.",
  },
  name_forgotten: {
    en: "Done. I've removed your name.",
    hi: 'हो गया। मैंने आपका नाम हटा दिया है।',
    'hi-latn': 'Ho gaya. Maine aapka naam hata diya hai.',
  },
  // No lead without a template voice: the fixed crisis reply alone.
  crisis_lead: { en: '', hi: '', 'hi-latn': '' },
  crisis_lead_emergency: { en: '', hi: '', 'hi-latn': '' },
  override_decline: {
    en: "I can't do that, but I'm happy to help with anything about {organisation}.",
    hi: 'यह मैं नहीं कर सकता, लेकिन {organisation} से जुड़ी किसी भी बात में ख़ुशी से मदद करूँगा।',
    'hi-latn':
      'Yeh main nahi kar sakta, lekin {organisation} se judi kisi bhi baat mein khushi se madad karunga.',
  },
};

/**
 * A fixed text in the assistant's voice and the person's language, with `{placeholders}` filled.
 * A voice without this key, or without this language, falls back to the neutral default.
 */
export function voiceText(
  settings: { voice?: ChatbotVoice | null } | null | undefined,
  key: VoiceKey,
  language: ReplyLanguage,
  vars: Record<string, string> = {},
): string {
  const own = settings?.voice?.texts?.[key]?.[language]?.trim();
  const text =
    own || NEUTRAL_VOICE[key][language] || NEUTRAL_VOICE[key].en || '';
  return Object.entries(vars).reduce(
    (out, [name, value]) => out.split(`{${name}}`).join(value),
    text,
  );
}
