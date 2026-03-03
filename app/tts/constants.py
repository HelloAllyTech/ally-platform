"""Constants for the API layer."""

from typing import Dict

# ---------------------------------------------------------------------------
# Mapping of BCP 47 language codes to sample text in that language.
# Used by the voice preview endpoint to generate audio in the correct language
# when the caller does not supply explicit text.
# Covers all Indic languages supported by Sarvam, Google, and Hume providers.
# ---------------------------------------------------------------------------
LANGUAGE_SAMPLE_TEXT: Dict[str, str] = {
    # English variants
    "en-US": ("Hello, this is a preview of how I sound."),
    "en-IN": ("Hello, this is a preview of how I sound."),
    "en-GB": ("Hello, this is a preview of how I sound."),
    "en-GLOBAL": ("Hello, this is a preview of how I sound."),
    # Hindi
    "hi-IN": ("नमस्ते, यह मेरी आवाज़ का एक प्रीव्यू है। " "मैं आपकी कैसे मदद कर सकती हूँ?"),
    # Bengali
    "bn-IN": (
        "নমস্কার, এটি আমার কণ্ঠস্বরের একটি প্রিভিউ। " "আমি আপনাকে কীভাবে সাহায্য করতে পারি?"
    ),
    # Kannada
    "kn-IN": ("ನಮಸ್ಕಾರ, ಇದು ನನ್ನ ಧ್ವನಿಯ ಮುನ್ನೋಟ. " "ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?"),
    # Malayalam
    "ml-IN": ("നമസ്കാരം, ഇത് എന്റെ ശബ്ദത്തിന്റെ ഒരു പ്രിവ്യൂ ആണ്. " "ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കാം?"),
    # Marathi
    "mr-IN": ("नमस्कार, हा माझ्या आवाजाचा एक प्रीव्ह्यू आहे. " "मी तुम्हाला कशी मदत करू शकते?"),
    # Odia (or-IN is ISO 639-1; od-IN is Sarvam's expected code)
    "or-IN": ("ନମସ୍କାର, ଏହା ମୋ ସ୍ୱରର ଏକ ପ୍ରିଭ୍ୟୁ। " "ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିପାରିବି?"),
    "od-IN": ("ନମସ୍କାର, ଏହା ମୋ ସ୍ୱରର ଏକ ପ୍ରିଭ୍ୟୁ। " "ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିପାରିବି?"),
    # Punjabi
    "pa-IN": (
        "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਇਹ ਮੇਰੀ ਆਵਾਜ਼ ਦਾ ਇੱਕ ਪ੍ਰੀਵਿਊ ਹੈ। " "ਮੈਂ ਤੁਹਾਡੀ ਕਿਵੇਂ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ?"
    ),
    # Tamil
    "ta-IN": ("வணக்கம், இது என் குரலின் முன்னோட்டம். " "நான் உங்களுக்கு எப்படி உதவ முடியும்?"),
    # Telugu
    "te-IN": ("నమస్కారం, ఇది నా గొంతు ఎలా ఉంటుందో ప్రివ్యూ. " "నేను మీకు ఎలా సహాయం చేయగలను?"),
    # Gujarati
    "gu-IN": ("નમસ્તે, આ મારા અવાજનું પ્રીવ્યૂ છે. " "હું તમને કેવી રીતે મદદ કરી શકું?"),
}

DEFAULT_SAMPLE_TEXT = "Hello, this is a preview of how I sound."
