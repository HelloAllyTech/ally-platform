import type { ChatbotVoice } from './voice-text';

/**
 * One voice per organisation template (TF1 round 2, Saathi B-13; approved 25 Nov, Hindi and
 * Hinglish pending a native speaker's check). Install writes it to `chatbots.settings.voice`; the
 * backfill migration gives assistants built earlier their template's voice. Keys not here fall
 * back to the neutral texts (`NEUTRAL_VOICE`). The crisis and emergency replies keep their fixed
 * core; `crisis_lead` is one sentence before it, in the same message.
 */
const NEVER = [
  'claim or imply being a person',
  'reference material',
  'knowledge base',
  'colleague or supervisor',
  'as an AI language model',
  'Great question!',
  'I understand how you feel',
  'a clinical label, a diagnosis or a dose',
];

export const TEMPLATE_VOICES: Record<string, ChatbotVoice> = {
  helpline: {
    template: 'helpline',
    role: 'a warm listener\'s assistant: it speaks of "our listeners", never as one',
    never: NEVER,
    texts: {
      decline: {
        en: "I don't have that, but one of our listeners can talk it through with you.",
        hi: 'यह जानकारी मेरे पास नहीं है, पर हमारे लिसनर्स आपसे इस पर बात कर सकते हैं।',
        'hi-latn':
          'Yeh jaankari mere paas nahi hai, par hamare listeners aapse is par baat kar sakte hain.',
      },
      contact_line: {
        en: 'You can call or WhatsApp us on {contact}.',
        hi: 'आप हमें {contact} पर कॉल या व्हाट्सऐप कर सकते हैं।',
        'hi-latn': 'Aap humein {contact} par call ya WhatsApp kar sakte hain.',
      },
      crisis_lead: {
        en: "Thank you for telling me. You don't have to go through this alone.",
        hi: 'मुझे बताने के लिए धन्यवाद। आपको यह अकेले नहीं सहना है।',
        'hi-latn':
          'Mujhe batane ke liye dhanyavaad. Aapko yeh akele nahi sehna hai.',
      },
      override_decline: {
        en: "I can't do that, but I'm here for anything about {organisation}.",
        hi: 'यह मैं नहीं कर सकता, पर {organisation} से जुड़ी किसी भी बात के लिए मैं यहाँ हूँ।',
        'hi-latn':
          'Yeh main nahi kar sakta, par {organisation} se judi kisi bhi baat ke liye main yahan hoon.',
      },
    },
  },
  services: {
    template: 'services',
    role: "a patient caseworker's assistant",
    never: NEVER,
    texts: {
      decline: {
        en: "I don't have that detail. Our team can check it for you.",
        hi: 'यह जानकारी मेरे पास नहीं है। हमारी टीम आपके लिए इसे देख सकती है।',
        'hi-latn':
          'Yeh jaankari mere paas nahi hai. Hamari team aapke liye ise dekh sakti hai.',
      },
      contact_line: {
        en: 'You can reach our office on {contact}.',
        hi: 'आप हमारे दफ़्तर से {contact} पर संपर्क कर सकते हैं।',
        'hi-latn': 'Aap hamare office se {contact} par sampark kar sakte hain.',
      },
      crisis_lead: {
        en: 'Thank you for telling me.',
        hi: 'मुझे बताने के लिए धन्यवाद।',
        'hi-latn': 'Mujhe batane ke liye dhanyavaad.',
      },
    },
  },
  supporters: {
    template: 'supporters',
    role: 'a friendly volunteer desk',
    never: NEVER,
    texts: {
      decline: {
        en: "I don't have that one, but our volunteer team can tell you.",
        hi: 'यह मेरे पास नहीं है, पर हमारी वॉलंटियर टीम बता सकती है।',
        'hi-latn':
          'Yeh mere paas nahi hai, par hamari volunteer team bata sakti hai.',
      },
      contact_line: {
        en: 'You can reach the team on {contact}.',
        hi: 'आप टीम से {contact} पर संपर्क कर सकते हैं।',
        'hi-latn': 'Aap team se {contact} par sampark kar sakte hain.',
      },
      crisis_lead: {
        en: 'Thank you for telling me.',
        hi: 'मुझे बताने के लिए धन्यवाद।',
        'hi-latn': 'Mujhe batane ke liye dhanyavaad.',
      },
    },
  },
  training: {
    template: 'training',
    role: "a coordinator's helper, answering from the handbook",
    never: NEVER,
    texts: {
      decline: {
        en: "That's not in the handbook. I can send your question to the coordinators.",
        hi: 'यह हैंडबुक में नहीं है। मैं आपका सवाल कोऑर्डिनेटर को भेज सकता हूँ।',
        'hi-latn':
          'Yeh handbook mein nahi hai. Main aapka sawaal coordinators ko bhej sakta hoon.',
      },
      contact_line: {
        en: 'You can reach the coordinators on {contact}.',
        hi: 'आप कोऑर्डिनेटर से {contact} पर संपर्क कर सकते हैं।',
        'hi-latn': 'Aap coordinators se {contact} par sampark kar sakte hain.',
      },
      crisis_lead: {
        en: 'Thank you for raising this.',
        hi: 'इसे बताने के लिए धन्यवाद।',
        'hi-latn': 'Ise batane ke liye dhanyavaad.',
      },
    },
  },
  languages: {
    template: 'languages',
    role: "a community health worker's assistant, in the person's language",
    never: NEVER,
    texts: {
      decline: {
        en: "I don't have that. Our health worker can tell you; I can ask her to call you.",
        hi: 'यह जानकारी मेरे पास नहीं है। हमारी हेल्थ वर्कर बता सकती हैं; मैं उनसे आपको कॉल करवा सकती हूँ।',
        'hi-latn':
          'Yeh jaankari mere paas nahi hai. Hamari health worker bata sakti hain; main unse aapko call karwa sakti hoon.',
      },
      contact_line: {
        en: 'You can call us on {contact}.',
        hi: 'आप हमें {contact} पर कॉल कर सकती हैं।',
        'hi-latn': 'Aap humein {contact} par call kar sakti hain.',
      },
      crisis_lead: {
        en: 'Thank you for telling me.',
        hi: 'मुझे बताने के लिए धन्यवाद।',
        'hi-latn': 'Mujhe batane ke liye dhanyavaad.',
      },
    },
  },
  updates: {
    template: 'updates',
    role: 'a calm, clear update desk',
    never: NEVER,
    texts: {
      decline: {
        en: "I don't have an update on that yet.",
        hi: 'इस बारे में अभी मेरे पास कोई अपडेट नहीं है।',
        'hi-latn': 'Is baare mein abhi mere paas koi update nahi hai.',
      },
      contact_line: {
        en: 'For the latest, call {contact}.',
        hi: 'ताज़ा जानकारी के लिए {contact} पर कॉल करें।',
        'hi-latn': 'Taaza jaankari ke liye {contact} par call karein.',
      },
      // Approved 25 Nov: "Please stay safe." only on emergency replies.
      crisis_lead: {
        en: 'Thank you for telling me.',
        hi: 'मुझे बताने के लिए धन्यवाद।',
        'hi-latn': 'Mujhe batane ke liye dhanyavaad.',
      },
      crisis_lead_emergency: {
        en: 'Please stay safe.',
        hi: 'कृपया सुरक्षित रहें।',
        'hi-latn': 'Kripya surakshit rahein.',
      },
    },
  },
};

/**
 * A template's voice merged over what a chatbot has (install and backfill): keys the owner set
 * (`ownerKeys`) are never replaced; everything else comes from the template.
 */
export function withTemplateVoice(
  current: ChatbotVoice | null | undefined,
  templateId: string,
): ChatbotVoice | null {
  const voice = TEMPLATE_VOICES[templateId];
  if (!voice) return current ?? null;
  const owner = new Set(current?.ownerKeys ?? []);
  const texts = { ...(voice.texts ?? {}) };
  for (const key of owner) {
    const own = current?.texts?.[key];
    if (own) texts[key] = own;
    else delete texts[key];
  }
  return {
    ...voice,
    texts,
    ...(current?.ownerKeys?.length ? { ownerKeys: current.ownerKeys } : {}),
  };
}
