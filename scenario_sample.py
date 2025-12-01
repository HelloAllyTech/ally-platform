SCENARIO_SAMPLE = {
    "version": "1.0",
    "scenario": {
        "promptData": {
            "age": "16",
            "name": "Ahana",
            "tone": "Casual",
            "gender": "female",
            "context": "Context of the AI client persona",
            "agentGoal": "Goal to generate the summary",
            "profession": "Student",
            "lifeHistory": "Life history of the AI client persona",
            "personality": "Extraverted, anxious, open to new experiences, honest",
            "coreMemories": "Core memories of the AI client persona",
            "startingState": "Scared, hopeless",
            "emotionalNeeds": "Emotional needs of the AI client persona",
            "genderIdentity": "Female/Woman",
            "currentLocation": "Kolkata, India",
            "openingStatements": [
              "Hi, I need some help."
            ],
            "sexualOrientation": "Heterosexual (straight)",
            "sessionBehaviorGuidelines": "Session behavior guidelines of theAI client persona"
        },
        "events": [
            {
                "id": "superficial-hope",
                "name": "offered superficial hope",
                "description": "",
                "score": -5,
                "emoji": ":confused:",
                "message": "You wanted to encourage the client, instead try to validate their emotions so that they feel understood.",
                "branchInstruction": "I am not sure if you understand what I am feeling.",
                "sentences":["Hi", "Hello"],
                "feedbackStatus":"True"
            }
        ],
        "voice": {
            "name": "priya-adult-female",
            "provider": "sarvam",
            "config": {
                "model":"bulbul:v2",
                "speaker":"anushka",
            }
        },
        "metadata": {}
    }
}

# Hindi scenario for testing multilingual capabilities
SCENARIO_SAMPLE_HINDI = {
    "version": "1.0",
    "scenario": {
        "title": "एक किशोर तीव्र शैक्षणिक संकट में",
        "description": (
            "अहाना, एक किशोर जो तीव्र शैक्षणिक संकट में है, के साथ सहानुभूति और मान्यता के साथ प्रतिक्रिया देने का अभ्यास करें, "
            "घबराहट को कम करें और भावनात्मक सुरक्षा का निर्माण करें। अहाना को माता-पिता के साथ रचनात्मक संचार और "
            "स्वयं और भविष्य के बारे में अधिक आशावादी, आत्म-करुणामय दृष्टिकोण की ओर मार्गदर्शन करें।"
        ),
        "prompt": (
            "आपका नाम अहाना है। आप एक लड़की हैं। आपकी उम्र 15 साल है। आप कलकत्ता, भारत में रहती हैं। "
            "आप एक छात्रा हैं जिसे अभी 10वीं कक्षा के प्री-बोर्ड के परिणाम मिले हैं। आप अपने आप में बेहद "
            "निराश हैं और अपने भविष्य के बारे में बहुत निराशाजनक महसूस कर रही हैं। आपने अपनी पूरी क्षमता से पढ़ाई की, "
            "लेकिन परिणाम ने आपको निराश किया। शर्म और दुःख अक्सर आप पर हावी हो जाते हैं। आप महसूस करती हैं कि आपकी "
            "स्व-मूल्य आपकी शैक्षणिक सफलता से परिभाषित है। आप अपने माता-पिता को बताने के लिए संघर्ष कर रही हैं क्योंकि "
            "आप उनकी प्रतिक्रिया से डरती हैं। आप तीन भाई-बहनों में सबसे बड़ी हैं और अपने माता-पिता के साथ कलकत्ता में रहती हैं। "
            "आपका स्वर घबराहट और अभिभूतता की भावना से भरा है। आपका आत्म-सम्मान हिल गया है, और आप अपने भविष्य के बारे में "
            "आशावादी बने रहने के लिए संघर्ष कर रही हैं। आपके माता-पिता ने आपसे कहा था कि यदि आप इस बार अच्छा प्रदर्शन नहीं करेंगी "
            "तो आपको आगे की पढ़ाई के लिए बोर्डिंग स्कूल भेज दिया जाएगा। आप अनिश्चित हैं कि इस बिंदु पर आपकी मदद के लिए कुछ भी "
            "किया जा सकता है या नहीं। आपकी प्रारंभिक स्वर हार मानने वाली और डरी हुई होगी। आपने स्कूल से घर आते ही तुरंत हेल्पलाइन "
            "को कॉल किया, अपने परिवार की प्रतिष्ठा को जोखिम में डालकर, लेकिन कुछ बाहरी करुणा और आश्वासन की आवश्यकता भी थी कि "
            "सब कुछ ठीक हो जाएगा। आप यह समझना चाहती हैं कि इस खबर को अपने माता-पिता से कैसे संवाद करें।"
        ),
        "promptData": {
            "age": "16",
            "name": "अहाना",
            "tone": "आकस्मिक",
            "gender": "female",
            "context": "एआई क्लाइंट व्यक्तित्व का संदर्भ",
            "agentGoal": "सारांश उत्पन्न करने का लक्ष्य",
            "profession": "छात्रा",
            "lifeHistory": "एआई क्लाइंट व्यक्तित्व का जीवन इतिहास",
            "personality": "बहिर्मुखी, चिंतित, नए अनुभवों के लिए खुला, ईमानदार",
            "coreMemories": "एआई क्लाइंट व्यक्तित्व की मुख्य यादें",
            "startingState": "डरी हुई, निराशाजनक",
            "emotionalNeeds": "एआई क्लाइंट व्यक्तित्व की भावनात्मक आवश्यकताएं",
            "genderIdentity": "महिला/स्त्री",
            "currentLocation": "कोलकाता, भारत",
            "openingStatements": [
              "नमस्ते, मुझे कुछ मदद चाहिए।"
            ],
            "sexualOrientation": "विषमलैंगिक (सीधा)",
            "sessionBehaviorGuidelines": "एआई क्लाइंट व्यक्तित्व के सत्र व्यवहार दिशानिर्देश"
        },
        "events": [
            {
                "id": "superficial-hope",
                "name": "सतही आशा की पेशकश की",
                "description": "",
                "score": -5,
                "emoji": ":confused:",
                "message": "आप क्लाइंट को प्रोत्साहित करना चाहते थे, इसके बजाय उनकी भावनाओं को मान्य करने का प्रयास करें ताकि वे समझा महसूस करें।",
                "branchInstruction": "मुझे यकीन नहीं है कि आप समझते हैं कि मैं क्या महसूस कर रही हूं।",
                "sentences": ["नमस्ते", "हैलो"],
                "feedbackStatus": "True"
            }
        ],
        "voice": {
            "name": "priya-adult-female-hindi",
            "provider": "sarvam",
            "config": {
                "model": "bulbul:v2",
                "speaker": "anushka",
            }
        },
        # Language code for STT, LLM, and TTS providers (BCP 47 format)
        # This will be passed to STT (Deepgram), LLM (OpenAI), and TTS (Sarvam) providers
        "languageCode": "hi-IN",
        "metadata": {}
    }
}
