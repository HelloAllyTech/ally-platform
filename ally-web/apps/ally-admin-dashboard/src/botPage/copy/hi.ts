import type { BotPageCopy } from "./en";

/** The bot page's own words, in Hindi. To be reviewed by a native speaker before launch. */
export const hi: BotPageCopy = {
  lang: "hi",
  start: "शुरू करें",
  poweredBy: "Ally द्वारा संचालित",
  loading: "लोड हो रहा है…",
  cover: {
    privateNote: "यह चैट केवल आमंत्रित लोगों के लिए है।",
    organisationNote: "संगठन के सदस्यों के लिए। पहले आपको अपना कार्य ईमेल पुष्टि करना होगा।",
    // needs review: drafted in chunk 20d, not yet checked by a Hindi speaker.
    coverAlt: "{business} की कवर तस्वीर",
  },
  access: {
    emailTitle: "अपना ईमेल पुष्टि करें",
    emailHelp: "हम इस पते पर 6 अंकों का कोड भेजेंगे।",
    emailLabel: "ईमेल पता",
    emailPlaceholder: "aap@example.com",
    sendCode: "कोड भेजें",
    codeTitle: "अपना कोड डालें",
    codeHelp:
      "अगर {email} इस चैट का उपयोग कर सकता है, तो कोड भेज दिया गया है। यह 10 मिनट तक मान्य है।",
    codeLabel: "6 अंकों का कोड",
    verify: "आगे बढ़ें",
    resend: "नया कोड भेजें",
    resendIn: "{seconds} सेकंड में नया कोड भेजें",
    changeEmail: "दूसरा ईमेल इस्तेमाल करें",
    invalidEmail: "सही ईमेल पता डालें।",
  },
  prechat: {
    progress: "प्रश्न {n} / {total}",
    next: "आगे",
    back: "पीछे",
    finish: "चैट शुरू करें",
    optional: "वैकल्पिक",
    required: "कृपया इस प्रश्न का उत्तर दें।",
    choose: "एक चुनें",
    agree: "मैं सहमत हूँ",
  },
  chat: {
    inputLabel: "आपका संदेश",
    placeholder: "अपना प्रश्न लिखें…",
    send: "भेजें",
    newChat: "नई चैट",
    suggested: "आप पूछ सकते हैं",
    sources: "स्रोत",
    you: "आप",
    signedInAs: "{email} के रूप में साइन इन",
    tooLong: "{count} / {max} अक्षर",
    // needs review: drafted in chunk 20d, not yet checked by a Hindi speaker.
    headerIdle: "{name} की अपनी जानकारी से जवाब",
    // needs review: drafted in chunk 20d, not yet checked by a Hindi speaker.
    typing: "लिख रहे हैं…",
    // needs review: drafted in chunk 11a, not yet checked by a Hindi speaker.
    talkToPerson: "किसी व्यक्ति से बात करें",
    joined: "{sender} चैट में शामिल हुए हैं।",
    backToAssistant: "अब आप फिर से सहायक से बात कर रहे हैं।",
    // needs review: drafted in chunk Q2a, not yet checked by a Hindi speaker.
    feedback: {
      question: "क्या यह मददगार था?",
      up: "मददगार",
      down: "मददगार नहीं",
      whatWrong: "क्या गलत था?",
      reasons: {
        wrong_info: "गलत जानकारी",
        not_answered: "मेरे सवाल का जवाब नहीं दिया",
        other: "कुछ और",
      },
      notePlaceholder: "और बताएँ (वैकल्पिक)",
      send: "भेजें",
      skip: "छोड़ें",
      thanks: "धन्यवाद, इससे टीम को इसे बेहतर बनाने में मदद मिलती है।",
    },
    status: {
      thinking: "सोच रहा है…",
      searching: "जानकारी खोज रहा है…",
      found: "मिली जानकारी पढ़ रहा है…",
      checking: "उत्तर जाँच रहा है…",
      rewriting: "उत्तर बेहतर कर रहा है…",
      writing: "उत्तर लिख रहा है…",
    },
  },
  errors: {
    BOT_PAGE_NOT_FOUND: "यह चैट लिंक उपलब्ध नहीं है। हो सकता है इसे बंद कर दिया गया हो।",
    BOT_PAGE_BOT_CHECK_FAILED: "हम पुष्टि नहीं कर सके कि आप इंसान हैं। कृपया फिर से कोशिश करें।",
    BOT_PAGE_START_AGAIN: "आपका सत्र समाप्त हो गया है। कृपया फिर से शुरू करें।",
    BOT_PAGE_NOT_ALLOWED: "यह ईमेल इस चैट का उपयोग नहीं कर सकता। लिंक भेजने वाले व्यक्ति से पूछें।",
    BOT_PAGE_CODE_WRONG: "यह कोड सही नहीं है। कृपया जाँचें और फिर से कोशिश करें।",
    BOT_PAGE_CODE_EXPIRED: "यह कोड समाप्त हो गया है। नया कोड मँगाएँ।",
    BOT_PAGE_CODE_TOO_MANY: "बहुत सारी कोशिशें हो गईं। नया कोड मँगाएँ।",
    BOT_PAGE_EMAIL_UNAVAILABLE: "अभी ईमेल नहीं भेजा जा सका। कृपया एक मिनट बाद कोशिश करें।",
    BOT_PAGE_THROTTLED:
      "आप बहुत जल्दी संदेश भेज रहे हैं। कृपया {minutes} मिनट रुककर फिर कोशिश करें।",
    BOT_PAGE_BUSY_UNAVAILABLE: "अभी हम व्यस्त हैं। कृपया बाद में कोशिश करें।",
    BOT_PAGE_MESSAGE_TOO_LONG: "कृपया अपना संदेश {max} अक्षरों से छोटा रखें।",
    BOT_PAGE_INTAKE_REQUIRED: "कृपया पहले प्रश्नों के उत्तर दें।",
    BOT_PAGE_INTAKE_INVALID: "कृपया अपना उत्तर जाँचें।",
    NETWORK: "लगता है आप ऑफ़लाइन हैं। अपना कनेक्शन जाँचें और फिर कोशिश करें।",
    INTERNAL: "कुछ गड़बड़ हो गई। कृपया फिर से कोशिश करें।",
    tryAgain: "फिर कोशिश करें",
    startAgain: "फिर से शुरू करें",
  },
};
