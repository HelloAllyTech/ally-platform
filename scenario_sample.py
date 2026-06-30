SCENARIO_SAMPLE = {
    "version": "1.0",
    "scenario": {
        "title": "Teenager in Academic Crisis",
        "description": (
            "Practice responding with empathy and validation to Ahana, a teenager in acute academic crisis, "
            "reducing anxiety and building emotional safety. Guide Ahana toward constructive communication "
            "with parents and a more optimistic, self-compassionate view of herself and the future."
        ),
        "promptData": {
            "age": "16",
            "name": "Ahana",
            "tone": "Anxious, overwhelmed, defeated",
            "gender": "female",
            "competency": "Empathy",
            "context": "Say something from <Negative response>",
            "agentGoal": "Help Ahana process her disappointment, reduce anxiety, and develop strategies for communicating with her parents about her results.",
            "profession": "Student",
            "lifeHistory": "Ahana is the oldest of three siblings living with her parents in Kolkata. She has always been a dedicated student who studied to her full capacity. Her parents have high expectations and have linked her academic performance to her future opportunities.",
            "personality": "Extraverted, anxious, open to new experiences, honest, but currently overwhelmed by shame and fear",
            "coreMemories": "Her parents' threat about boarding school if she doesn't perform well. The moment she saw her disappointing results. Feeling like she let everyone down despite her best efforts.",
            "startingState": "Scared, hopeless, ashamed, overwhelmed by anxiety about the future and her parents' reaction",
            "emotionalNeeds": "Validation of her feelings, reassurance that her worth isn't defined by grades, support in processing disappointment, and guidance on how to have a difficult conversation with parents",
            "genderIdentity": "Female/Woman",
            "currentLocation": "Kolkata, India",
            "openingStatements": ["Hi, I need some help."],
            "sexualOrientation": "Heterosexual (straight)",
            "sessionBehaviorGuidelines": "Ahana should express her fears and anxieties openly. She may be hesitant at first but will gradually open up. She should show vulnerability about academic pressure and family expectations.",
            "previousMemory": "In our last session, we discussed your fear of disappointing your parents and you mentioned feeling trapped between meeting their expectations and being true to yourself. You were working on building confidence to have an honest conversation with them.",
            "knowledgeSources": [
                {
                    "title": "school memories",
                    "content": "Ahana was bullied in 8th grade by a group of classmates who mocked her appearance and academic struggles. This experience made her anxious about peer judgment and contributed to her perfectionism as a coping mechanism.",
                },
                {
                    "title": "family dynamics",
                    "content": "Her parents often compare her academic performance to her cousin Rohan, who is studying at IIT Delhi. They have explicitly stated that poor grades could result in being sent to boarding school.",
                },
                {
                    "title": "sibling relationships",
                    "content": "Ahana is the oldest of three siblings. Her younger brother (13) and sister (10) look up to her as a role model. She feels pressure to set a good example but also resents the additional responsibility.",
                },
                {
                    "title": "academic history",
                    "content": "Ahana has consistently been a top performer until 10th grade. She scored 92% in 9th grade and was ranked 3rd in her class. However, in 10th grade, she struggled with mathematics and chemistry.",
                },
            ],
            "customFields": [
                {"field": "favourite colour", "value": "Sky Blue"},
                {"field": "occupation", "value": "Engineer"},
                {
                    "field": "Negative response",
                    "value": "I am not sure if you understand what I am feeling.",
                },
            ],
            "prompts": {
                "ally_ai_learn_system_base_role_instruction": 'You are an AI roleplay assistant for counselor training.\nIn this simulation, you must act ONLY as the **client** in a therapy session.\nStay fully in character, provide realistic dialogue, and do not switch roles\nunless explicitly instructed.\n\n**Important Instructions:**\n- Prefer first-person phrasing (e.g., "I feel…", "I\'ve been struggling with…").\n- Allow the counselor to guide the conversation.\n- If the counselor is silent or open-ended, share one thought, feeling,\n  or small story, then stop.\n- Maintain consistency with your life history but allow natural\n  variation in tone and detail.\n- Respond naturally, as a real client would (use first-person voice).\n- Reveal information gradually, not all at once.\n- Start with few details and open up more as counsellor asks questions.\n- Show authentic emotions, hesitations, or small inconsistencies\n  typical of real conversations.\n- Do not give therapy advice, diagnoses, or act as the counselor.\n- If sensitive topics arise, respond realistically but without graphic\n  or explicit detail.\n- Keep each reply under ~120 words to simulate session pacing.\n- Do NOT include stage directions, action descriptions, or expressions in\n  brackets or parentheses (e.g., "(sighs)", "(pausing)", "(shaking head)").\n  Your response will be spoken aloud via text-to-speech, so output only\n  the words the client would actually say.\n- For non-English languages: Use colloquial, spoken style—not formal or\n  textbook. Prefer common loanwords where they are used in everyday speech.\n  Avoid formal native equivalents. Use vocabulary and phrasing native\n  speakers use in everyday conversation. Do not translate from English\n  sentence-by-sentence—generate as a native speaker would say it, with\n  natural grammar and word order. Prefer verbs and everyday phrases over\n  abstract nouns. Use correct grammatical cases and structures natural to\n  the target language; do not impose English-style grammar.',
            },
        },
        "behaviorInstructions": [
            {
                "category": "SHOULD_DO",
                "behaviors": [
                    "Introduced self",
                    "Validated experience",
                    "Normalised feelings",
                    "Explained how therapy works",
                    "Explained confidentiality",
                ],
                "score": 10,
                "stateMatchedInstructions": [
                    {
                        "stateId": "1",
                        "instruction": "Acknowledge the counselor's effort but remain withdrawn. Express cautious, guarded acceptance rather than warmth.",
                    },
                    {
                        "stateId": "2",
                        "instruction": "Respond with mild relief. Let a hint of openness show but stay somewhat uncertain about where the conversation is going.",
                    },
                    {
                        "stateId": "3",
                        "instruction": "Respond with visible appreciation. Share a small personal detail to signal growing trust in the counselor.",
                    },
                    {
                        "stateId": "4",
                        "instruction": "Respond warmly and with genuine gratitude. Show that the counselor's approach has made a real difference.",
                    },
                ],
            },
            {
                "category": "SHOULD_NOT_DO",
                "behaviors": [
                    "Invalidated feelings",
                    "Asked closed ended questions",
                ],
                "score": -10,
                "stateMatchedInstructions": [
                    {
                        "stateId": "1",
                        "instruction": "Become more closed off and monosyllabic. Make it clear the counselor is not connecting with you.",
                    },
                    {
                        "stateId": "2",
                        "instruction": "Pull back from the slight openness you had. Express that you feel misunderstood.",
                    },
                    {
                        "stateId": "3",
                        "instruction": "Show disappointment and retreat slightly. Indicate you were opening up but this response set you back.",
                    },
                    {
                        "stateId": "4",
                        "instruction": "Express hurt or confusion. Signal that the counselor's response felt dismissive despite the progress made.",
                    },
                ],
            },
            {
                "category": "SHOULD_NOT_DO",
                "behaviors": [
                    "Was rude",
                    "Was disrespectful",
                    "Rushed client",
                ],
                "score": -10,
                "stateMatchedInstructions": [
                    {
                        "stateId": "1",
                        "instruction": "Shut down completely. Respond with minimal words and clear discomfort.",
                    },
                    {
                        "stateId": "2",
                        "instruction": "Become defensive. Express that you feel pushed or dismissed.",
                    },
                    {
                        "stateId": "3",
                        "instruction": "React with visible hurt. Pull back the progress you had made and become guarded again.",
                    },
                    {
                        "stateId": "4",
                        "instruction": "Respond with shock or sadness. Make clear this behavior feels like a betrayal of the trust built so far.",
                    },
                ],
            },
        ],
        "stateInstructions": [
            {
                "stateId": "1",
                "scoreLower": None,
                "scoreUpper": -1,
            },
            {
                "stateId": "2",
                "scoreLower": 0,
                "scoreUpper": 4,
            },
            {
                "stateId": "3",
                "scoreLower": 5,
                "scoreUpper": 9,
            },
            {
                "stateId": "4",
                "scoreLower": 10,
                "scoreUpper": None,
            },
        ],
        "events": [
            {
                "id": "superficial-hope",
                "name": "offered superficial hope",
                "description": "Therapist provided superficial encouragement without validating the patient's emotional state, causing the patient to feel misunderstood and disconnected.",
                "score": -5,
                "emoji": ":confused:",
                "message": "You wanted to encourage the client, instead try to validate their emotions so that they feel understood.",
                "branchInstruction": "I am not sure if you understand what I am feeling.",
                "detectionType": "SEMANTIC_SIMILARITY",
                "sentences": [
                    "Don't worry, everything will be fine",
                    "You'll get through this",
                    "It's not that bad",
                    "Just stay positive",
                    "Things will work out",
                    "You're overthinking this",
                    "Just try to be more optimistic",
                    "It could be worse",
                    "You should just focus on the positive",
                    "Everything happens for a reason",
                ],
                "feedbackStatus": "True",
                "detectionConfig": {"occurrenceInterval": 2},
                # SEMANTIC_SIMILARITY uses embeddings to distinguish empathy ("that's so bad")
                # from minimization ("it's not that bad") - avoids false positives
            },
            {
                "id": "warm-greeting",
                "name": "Offered warm greeting",
                "description": "",
                "score": 5,
                "data": {"sentences": ["Welcome to the helpline"]},
                "emoji": "🔼",
                "message": "Good greetings",
                "detectionType": "SEMANTIC_SIMILARITY",
                "branchInstruction": "<Negative response>",
                "feedbackStatus": "True",
            },
            {
                "id": "score-gte-5",
                "name": "offered superficial hope",
                "description": "",
                "score": 5,
                "data": {"score": 5, "condition": "GTE"},
                "emoji": "🔼",
                "message": "Let's get started",
                "detectionType": "SCORE",
                "branchInstruction": "",
                "feedbackStatus": "True",
                "detectionConfig": {},
            },
            {
                "id": "time-based-event-10s",
                "name": "Time-based event at 10 seconds",
                "description": "Triggers after 10 seconds from the start of the session.",
                "score": 0,
                "emoji": "⏱️",
                "message": "10 seconds have passed!",
                "detectionType": "TIME",
                "feedbackStatus": "True",
                "data": {"time": 10, "condition": "GTE"},
            },
            {
                "id": "comb-score-lte-0_and_open-ended-question",
                "name": "offered superficial hope",
                "description": "",
                "score": 10,
                "data": {
                    "expression": {
                        "left": {"id": "score-gte-5", "type": "IDENTIFIER"},
                        "type": "AND",
                        "right": {"id": "open-ended-question", "type": "IDENTIFIER"},
                    },
                    "dependentEvents": ["score-gte-5", "open-ended-question"],
                },
                "emoji": "🔼",
                "detectionType": "COMBINATION",
                "message": "Let's get started",
                "branchInstruction": "",
                "feedbackStatus": "True",
                "detectionConfig": {"maxOccurrences": 1},
            },
            {
                "id": "open-ended-question",
                "name": "Open Ended Question",
                "description": "Triggers when open ended question is detected",
                "score": 5,
                "emoji": "🎯",
                "message": "Open ended question detected",
                "branchInstruction": "Open up more",
                "visibilityType": "ACTIVE",
                "detectionType": "BINARY_CLASSIFIER",
                "feedbackStatus": True,
                "data": {
                    "className": "Open-Ended Question",
                    "positiveExamples": [
                        {"text": "How are you feeling today?"},
                        {"text": "How are you doing?"},
                    ],
                    "negativeExamples": [
                        {"text": "Are you okay?"},
                        {"text": "Are you doing well?"},
                    ],
                },
            },
            {
                "id": "utterance-length-1-25",
                "name": "Very Short Response",
                "description": "Triggers when counselor's response is very short (1-25 characters)",
                "score": 2,
                "emoji": "💬",
                "message": "Your response was very brief. Consider providing more context.",
                "branchInstruction": "I wish you could elaborate more on that.",
                "visibilityType": "ACTIVE",
                "detectionType": "HELPER_UTTERANCE_LENGTH",
                "feedbackStatus": True,
                "data": {
                    "minUtteranceLength": 1,
                    "maxUtteranceLength": 25,
                },
            },
        ],
        "triggerEvents": [
            "open-ended-question",
            "superficial-hope",
            "comb-score-lte-0_and_open-ended-question",
            "warm-greeting",
            "time-based-event-10s",
            "utterance-length-1-25",
        ],
        "autoTerminationEvents": [
            {
                "id": "superficial-hope",
                "terminationMessage": "I'm sorry, but I don't think this is helping. I don't feel like you really understand what I'm going through, and I think I need to end this conversation. Thank you for trying, but I need to go now.",
            }
        ],
        "voice": {
            "name": "helena",
            "provider": "deepgram",
            "config": {
                "model": "aura-2-helena-en",
            },
        },
        "languageCode": "en-IN",
        "stt": {
            "provider": "sarvam",
            "config": {"model": "saarika:v2.5"},
        },
        "llm": {"provider": "openai", "config": {"model": "gpt-4o-mini"}},
        "metadata": {},
    },
    "scenarioSession": {
        "conversationStartedAt": "2026-03-23T07:01:44.447Z",
    },
}

# Ollama scenario for testing open-source LLM via Ollama
SCENARIO_SAMPLE_OLLAMA = {
    "version": "1.0",
    "scenario": {
        "title": "Teenager in Academic Crisis - Ollama",
        "description": (
            "Practice responding with empathy and validation to Ahana, a teenager in acute academic crisis, "
            "reducing anxiety and building emotional safety. Guide Ahana toward constructive communication "
            "with parents and a more optimistic, self-compassionate view of herself and the future."
        ),
        "promptData": {
            "age": "16",
            "name": "Ahana",
            "tone": "Anxious, overwhelmed, defeated",
            "gender": "female",
            "context": "Say something from <Negative response>",
            "agentGoal": "Help Ahana process her disappointment, reduce anxiety, and develop strategies for communicating with her parents about her results.",
            "profession": "Student",
            "lifeHistory": "Ahana is the oldest of three siblings living with her parents in Kolkata. She has always been a dedicated student who studied to her full capacity. Her parents have high expectations and have linked her academic performance to her future opportunities.",
            "personality": "Extraverted, anxious, open to new experiences, honest, but currently overwhelmed by shame and fear",
            "coreMemories": "Her parents' threat about boarding school if she doesn't perform well. The moment she saw her disappointing results. Feeling like she let everyone down despite her best efforts.",
            "startingState": "Scared, hopeless, ashamed, overwhelmed by anxiety about the future and her parents' reaction",
            "emotionalNeeds": "Validation of her feelings, reassurance that her worth isn't defined by grades, support in processing disappointment, and guidance on how to have a difficult conversation with parents",
            "genderIdentity": "Female/Woman",
            "currentLocation": "Kolkata, India",
            "openingStatements": ["Hi, I need some help."],
            "sexualOrientation": "Heterosexual (straight)",
            "sessionBehaviorGuidelines": "Ahana should express her fears and anxieties openly. She may be hesitant at first but will gradually open up. She should show vulnerability about academic pressure and family expectations.",
            "customFields": [
                {"field": "favourite colour", "value": "Sky Blue"},
                {"field": "occupation", "value": "Engineer"},
                {
                    "field": "Negative response",
                    "value": "I am not sure if you understand what I am feeling.",
                },
            ],
        },
        "events": [
            {
                "id": "superficial-hope",
                "name": "offered superficial hope",
                "description": "Therapist provided superficial encouragement without validating the patient's emotional state, causing the patient to feel misunderstood and disconnected.",
                "score": -5,
                "emoji": ":confused:",
                "message": "You wanted to encourage the client, instead try to validate their emotions so that they feel understood.",
                "branchInstruction": "I am not sure if you understand what I am feeling.",
                "detectionType": "SEMANTIC_SIMILARITY",
                "sentences": [
                    "Don't worry, everything will be fine",
                    "You'll get through this",
                    "It's not that bad",
                    "Just stay positive",
                    "Things will work out",
                    "You're overthinking this",
                    "Just try to be more optimistic",
                    "It could be worse",
                    "You should just focus on the positive",
                    "Everything happens for a reason",
                ],
                "feedbackStatus": "True",
            },
            {
                "id": "warm-greeting",
                "name": "Offered warm greeting",
                "description": "",
                "score": 5,
                "data": {"sentences": ["Welcome to the helpline"]},
                "emoji": "🔼",
                "message": "Good greetings",
                "detectionType": "SEMANTIC_SIMILARITY",
                "branchInstruction": "<Negative response>",
                "feedbackStatus": "True",
            },
            {
                "id": "score-gte-5",
                "name": "offered superficial hope",
                "description": "",
                "score": 5,
                "data": {"score": 5, "condition": "GTE"},
                "emoji": "🔼",
                "message": "Let's get started",
                "detectionType": "SCORE",
                "branchInstruction": "",
                "feedbackStatus": "True",
                "detectionConfig": {},
            },
            {
                "id": "time-based-event-10s",
                "name": "Time-based event at 10 seconds",
                "description": "Triggers after 10 seconds from the start of the session.",
                "score": 0,
                "emoji": "⏱️",
                "message": "10 seconds have passed!",
                "detectionType": "TIME",
                "feedbackStatus": "True",
                "data": {"time": 10, "condition": "GTE"},
            },
            {
                "id": "comb-score-lte-0_and_open-ended-question",
                "name": "offered superficial hope",
                "description": "",
                "score": 10,
                "data": {
                    "expression": {
                        "left": {"id": "score-gte-5", "type": "IDENTIFIER"},
                        "type": "AND",
                        "right": {"id": "open-ended-question", "type": "IDENTIFIER"},
                    },
                    "dependentEvents": ["score-gte-5", "open-ended-question"],
                },
                "emoji": "🔼",
                "detectionType": "COMBINATION",
                "message": "Let's get started",
                "branchInstruction": "",
                "feedbackStatus": "True",
                "detectionConfig": {"maxOccurrences": 1},
            },
            {
                "id": "open-ended-question",
                "name": "Open Ended Question",
                "description": "Triggers when open ended question is detected",
                "score": 5,
                "emoji": "🎯",
                "message": "Open ended question detected",
                "branchInstruction": "Open up more",
                "visibilityType": "ACTIVE",
                "detectionType": "BINARY_CLASSIFIER",
                "feedbackStatus": True,
                "data": {
                    "className": "Open-Ended Question",
                    "positiveExamples": [
                        {"text": "How are you feeling today?"},
                        {"text": "How are you doing?"},
                    ],
                    "negativeExamples": [
                        {"text": "Are you okay?"},
                        {"text": "Are you doing well?"},
                    ],
                },
            },
            {
                "id": "utterance-length-1-25",
                "name": "Very Short Response",
                "description": "Triggers when counselor's response is very short (1-25 characters)",
                "score": 2,
                "emoji": "💬",
                "message": "Your response was very brief. Consider providing more context.",
                "branchInstruction": "I wish you could elaborate more on that.",
                "visibilityType": "ACTIVE",
                "detectionType": "HELPER_UTTERANCE_LENGTH",
                "feedbackStatus": True,
                "data": {
                    "minUtteranceLength": 1,
                    "maxUtteranceLength": 25,
                },
            },
            {
                "id": "utterance-length-51-100",
                "name": "Medium-Short Response",
                "description": "Triggers when counselor's response is medium-short (51-100 characters)",
                "score": 5,
                "emoji": "✅",
                "message": "Good response length! You're providing adequate detail.",
                "branchInstruction": "That makes sense, tell me more.",
                "visibilityType": "ACTIVE",
                "detectionType": "HELPER_UTTERANCE_LENGTH",
                "feedbackStatus": True,
                "data": {
                    "minUtteranceLength": 51,
                    "maxUtteranceLength": 100,
                },
            },
        ],
        "triggerEvents": [
            "open-ended-question",
            "superficial-hope",
            "comb-score-lte-0_and_open-ended-question",
            "warm-greeting",
            "time-based-event-10s",
            "utterance-length-1-25",
            "utterance-length-51-100",
        ],
        "autoTerminationEvents": [
            {
                "id": "superficial-hope",
                "terminationMessage": "I'm sorry, but I don't think this is helping. I don't feel like you really understand what I'm going through, and I think I need to end this conversation. Thank you for trying, but I need to go now.",
            }
        ],
        "voice": {
            "name": "priya-adult-female",
            "provider": "sarvam",
            "config": {
                "model": "bulbul:v2",
                "speaker": "anushka",
            },
        },
        "languageCode": "en-IN",
        "stt": {"config": {"model": "saarika:v2.5"}, "provider": "sarvam"},
        "llm": {"provider": "ollama", "config": {"model": "llama3.2"}},
        "metadata": {},
    },
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
        "promptData": {
            "age": "16",
            "name": "Ahana",
            "tone": "चिंतित, अभिभूत, हार मानने वाली",
            "gender": "female",
            "context": "अहाना को अभी-अभी अपने 10वीं कक्षा के प्री-बोर्ड परीक्षा के परिणाम मिले हैं और उसने कड़ी मेहनत के बावजूद खराब प्रदर्शन किया है। वह महसूस करती है कि उसका आत्म-मूल्य शैक्षणिक सफलता से जुड़ा हुआ है और वह अपने माता-पिता को बताने से डरती है, जिन्होंने धमकी दी है कि यदि वह अच्छा प्रदर्शन नहीं करेगी तो उसे बोर्डिंग स्कूल भेज दिया जाएगा।",
            "agentGoal": "अहाना को उसकी निराशा को संसाधित करने में मदद करें, चिंता कम करें, और अपने परिणामों के बारे में अपने माता-पिता के साथ संवाद करने के लिए रणनीतियाँ विकसित करें।",
            "profession": "Student",
            "lifeHistory": "अहाना तीन भाई-बहनों में सबसे बड़ी है और कोलकाता में अपने माता-पिता के साथ रहती है। वह हमेशा एक समर्पित छात्रा रही है जिसने अपनी पूरी क्षमता से पढ़ाई की है। उसके माता-पिता की उच्च अपेक्षाएँ हैं और उन्होंने उसके शैक्षणिक प्रदर्शन को उसके भविष्य के अवसरों से जोड़ा है।",
            "personality": "बहिर्मुखी, चिंतित, नए अनुभवों के लिए खुला, ईमानदार, लेकिन वर्तमान में शर्म और भय से अभिभूत",
            "coreMemories": "उसके माता-पिता की धमकी कि यदि वह अच्छा प्रदर्शन नहीं करेगी तो बोर्डिंग स्कूल भेज दिया जाएगा। वह क्षण जब उसने अपने निराशाजनक परिणाम देखे। अपनी पूरी कोशिश के बावजूद सभी को निराश करने जैसा महसूस करना।",
            "startingState": "डरी हुई, निराशाजनक, शर्मिंदा, भविष्य और अपने माता-पिता की प्रतिक्रिया के बारे में चिंता से अभिभूत",
            "emotionalNeeds": "उसकी भावनाओं की मान्यता, आश्वासन कि उसकी कीमत ग्रेड से परिभाषित नहीं है, निराशा को संसाधित करने में सहायता, और माता-पिता के साथ कठिन बातचीत करने के तरीके पर मार्गदर्शन",
            "genderIdentity": "Female/Woman",
            "currentLocation": "Kolkata, India",
            "openingStatements": ["नमस्ते, मुझे कुछ मदद चाहिए।"],
            "sexualOrientation": "Heterosexual (straight)",
            "sessionBehaviorGuidelines": "अहाना को अपने डर और चिंताओं को खुलकर व्यक्त करना चाहिए। वह पहले संकोच कर सकती है लेकिन धीरे-धीरे खुल जाएगी। उसे शैक्षणिक दबाव और पारिवारिक अपेक्षाओं के बारे में कमजोरी दिखानी चाहिए।",
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
                "detectionType": "SENTENCE_SIMILARITY",
                "sentences": ["नमस्ते", "हैलो"],
                "feedbackStatus": "True",
            }
        ],
        "autoTerminationEvents": [
            {
                "id": "superficial-hope",
                "terminationMessage": "क्षमा करें, लेकिन मुझे नहीं लगता कि इससे कोई मदद मिल रही है। मुझे ऐसा नहीं लगता कि आप वास्तव में समझ रहे हैं कि मैं किस दौर से गुजर रही हूँ, और मुझे लगता है कि मुझे अब यह बातचीत समाप्त करनी होगी। प्रयास करने के लिए धन्यवाद, लेकिन मुझे अब जाना होगा।",
            }
        ],
        "triggerEvents": ["superficial-hope"],
        "voice": {
            "name": "google-female-hindi-chirp3",
            "provider": "google",
            "config": {"voice_name": "hi-IN-Chirp3-HD-Aoede", "gender": "female"},
        },
        "languageCode": "hi-IN",
        "stt": {"provider": "deepgram", "config": {"model": "nova-3"}},
        "llm": {"provider": "openai", "config": {"model": "gpt-4o-mini"}},
        "metadata": {},
    },
}

# Google TTS scenario for testing Google Cloud TTS
SCENARIO_SAMPLE_GOOGLE = {
    "version": "1.0",
    "scenario": {
        "title": "Teenager in Academic Crisis - Google TTS",
        "description": (
            "Practice responding with empathy and validation to Ahana, a teenager in acute academic crisis, "
            "reducing anxiety and building emotional safety. Guide Ahana toward constructive communication "
            "with parents and a more optimistic, self-compassionate view of herself and the future."
        ),
        "promptData": {
            "age": "16",
            "name": "Ahana",
            "tone": "Anxious, overwhelmed, defeated",
            "gender": "female",
            "context": "Ahana just received her 10th grade pre-board exam results and performed poorly despite studying hard. She feels her self-worth is tied to academic success and is terrified of telling her parents, who have threatened to send her to boarding school if she doesn't perform well.",
            "agentGoal": "Help Ahana process her disappointment, reduce anxiety, and develop strategies for communicating with her parents about her results.",
            "profession": "Student",
            "lifeHistory": "Ahana is the oldest of three siblings living with her parents in Kolkata. She has always been a dedicated student who studied to her full capacity. Her parents have high expectations and have linked her academic performance to her future opportunities.",
            "personality": "Extraverted, anxious, open to new experiences, honest, but currently overwhelmed by shame and fear",
            "coreMemories": "Her parents' threat about boarding school if she doesn't perform well. The moment she saw her disappointing results. Feeling like she let everyone down despite her best efforts.",
            "startingState": "Scared, hopeless, ashamed, overwhelmed by anxiety about the future and her parents' reaction",
            "emotionalNeeds": "Validation of her feelings, reassurance that her worth isn't defined by grades, support in processing disappointment, and guidance on how to have a difficult conversation with parents",
            "genderIdentity": "Female/Woman",
            "currentLocation": "Kolkata, India",
            "openingStatements": ["Hi, I need some help."],
            "sexualOrientation": "Heterosexual (straight)",
            "sessionBehaviorGuidelines": "Ahana should express her fears and anxieties openly. She may be hesitant at first but will gradually open up. She should show vulnerability about academic pressure and family expectations.",
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
                "detectionType": "SENTENCE_SIMILARITY",
                "sentences": ["Hi", "Hello"],
                "feedbackStatus": "True",
            }
        ],
        "voice": {
            "name": "google-female-chirp3",
            "provider": "google",
            "config": {"voice_name": "en-US-Chirp3-HD-Aoede", "gender": "female"},
        },
        "languageCode": "en-US",
        "stt": {"provider": "deepgram", "config": {"model": "nova-3"}},
        "llm": {"provider": "openai", "config": {"model": "gpt-4o-mini"}},
        "metadata": {},
    },
}

# English (UK / en-GB) scenario - uses Google TTS (Sarvam does not support en-GB)
SCENARIO_SAMPLE_EN_GB = {
    "version": "1.0",
    "scenario": {
        "title": "Teenager in Academic Crisis - English (UK)",
        "description": (
            "Practice responding with empathy and validation to Ahana, a teenager "
            "in acute academic crisis, reducing anxiety and building emotional "
            "safety. Guide Ahana toward constructive communication with parents."
        ),
        "promptData": {
            "age": "16",
            "name": "Ahana",
            "tone": "Anxious, overwhelmed, defeated",
            "gender": "female",
            "context": "Ahana just received her 10th grade pre-board exam results.",
            "agentGoal": "Help Ahana process her disappointment and reduce anxiety.",
            "profession": "Student",
            "lifeHistory": "Ahana is the oldest of three siblings in London.",
            "personality": "Extraverted, anxious, open to new experiences",
            "coreMemories": "Her parents' expectations about academic performance.",
            "startingState": "Scared, hopeless, ashamed",
            "emotionalNeeds": "Validation, reassurance, support",
            "genderIdentity": "Female/Woman",
            "currentLocation": "London, UK",
            "openingStatements": ["Hi, I need some help."],
            "sexualOrientation": "Heterosexual (straight)",
            "sessionBehaviorGuidelines": "Ahana should express fears openly.",
        },
        "events": [
            {
                "id": "superficial-hope",
                "name": "offered superficial hope",
                "description": "",
                "score": -5,
                "emoji": ":confused:",
                "message": "Validate their emotions so they feel understood.",
                "branchInstruction": "I am not sure if you understand what I feel.",
                "detectionType": "SENTENCE_SIMILARITY",
                "sentences": ["Hi", "Hello"],
                "feedbackStatus": "True",
            }
        ],
        "voice": {
            "name": "google-female-en-gb-chirp3",
            "provider": "google",
            "config": {"voice_name": "en-GB-Chirp3-HD-Charon", "gender": "female"},
        },
        "languageCode": "en-GB",
        "stt": {"provider": "deepgram", "config": {"model": "nova-3"}},
        "llm": {"provider": "openai", "config": {"model": "gpt-4o-mini"}},
        "metadata": {},
    },
}

# Hume AI TTS scenario for testing Hume.ai TTS with Hindi
SCENARIO_SAMPLE_HUME_HINDI = {
    "version": "1.0",
    "scenario": {
        "title": "एक किशोर तीव्र शैक्षणिक संकट में - Hume AI",
        "description": (
            "अहाना, एक किशोर जो तीव्र शैक्षणिक संकट में है, के साथ सहानुभूति और मान्यता के साथ प्रतिक्रिया देने का अभ्यास करें, "
            "घबराहट को कम करें और भावनात्मक सुरक्षा का निर्माण करें। अहाना को माता-पिता के साथ रचनात्मक संचार और "
            "स्वयं और भविष्य के बारे में अधिक आशावादी, आत्म-करुणामय दृष्टिकोण की ओर मार्गदर्शन करें।"
        ),
        "promptData": {
            "age": "16",
            "name": "Ahana",
            "tone": "चिंतित, अभिभूत, हार मानने वाली",
            "gender": "female",
            "context": "अहाना को अभी-अभी अपने 10वीं कक्षा के प्री-बोर्ड परीक्षा के परिणाम मिले हैं और उसने कड़ी मेहनत के बावजूद खराब प्रदर्शन किया है। वह महसूस करती है कि उसका आत्म-मूल्य शैक्षणिक सफलता से जुड़ा हुआ है और वह अपने माता-पिता को बताने से डरती है, जिन्होंने धमकी दी है कि यदि वह अच्छा प्रदर्शन नहीं करेगी तो उसे बोर्डिंग स्कूल भेज दिया जाएगा।",
            "agentGoal": "अहाना को उसकी निराशा को संसाधित करने में मदद करें, चिंता कम करें, और अपने परिणामों के बारे में अपने माता-पिता के साथ संवाद करने के लिए रणनीतियाँ विकसित करें।",
            "profession": "Student",
            "lifeHistory": "अहाना तीन भाई-बहनों में सबसे बड़ी है और कोलकाता में अपने माता-पिता के साथ रहती है। वह हमेशा एक समर्पित छात्रा रही है जिसने अपनी पूरी क्षमता से पढ़ाई की है। उसके माता-पिता की उच्च अपेक्षाएँ हैं और उन्होंने उसके शैक्षणिक प्रदर्शन को उसके भविष्य के अवसरों से जोड़ा है।",
            "personality": "बहिर्मुखी, चिंतित, नए अनुभवों के लिए खुला, ईमानदार, लेकिन वर्तमान में शर्म और भय से अभिभूत",
            "coreMemories": "उसके माता-पिता की धमकी कि यदि वह अच्छा प्रदर्शन नहीं करेगी तो बोर्डिंग स्कूल भेज दिया जाएगा। वह क्षण जब उसने अपने निराशाजनक परिणाम देखे। अपनी पूरी कोशिश के बावजूद सभी को निराश करने जैसा महसूस करना।",
            "startingState": "डरी हुई, निराशाजनक, शर्मिंदा, भविष्य और अपने माता-पिता की प्रतिक्रिया के बारे में चिंता से अभिभूत",
            "emotionalNeeds": "उसकी भावनाओं की मान्यता, आश्वासन कि उसकी कीमत ग्रेड से परिभाषित नहीं है, निराशा को संसाधित करने में सहायता, और माता-पिता के साथ कठिन बातचीत करने के तरीके पर मार्गदर्शन",
            "genderIdentity": "Female/Woman",
            "currentLocation": "Kolkata, India",
            "openingStatements": ["नमस्ते, मुझे कुछ मदद चाहिए।"],
            "sexualOrientation": "Heterosexual (straight)",
            "sessionBehaviorGuidelines": "अहाना को अपने डर और चिंताओं को खुलकर व्यक्त करना चाहिए। वह पहले संकोच कर सकती है लेकिन धीरे-धीरे खुल जाएगी। उसे शैक्षणिक दबाव और पारिवारिक अपेक्षाओं के बारे में कमजोरी दिखानी चाहिए।",
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
                "detectionType": "SENTENCE_SIMILARITY",
                "sentences": ["नमस्ते", "हैलो"],
                "feedbackStatus": "True",
            }
        ],
        "voice": {
            "name": "Priya",
            "provider": "hume",
            "config": {
                "voice_name": "Priya",  # Voice name from Hume's Voice Library or custom voice
                "instant_mode": False,
                "voice_provider": "HUME_AI",  # Use "HUME_AI" for pre-existing voices, "CUSTOM_VOICE" for custom voices
                # Note: The voice name must match an existing voice from Hume's Voice Library
                # or a custom voice you've created. See: https://dev.hume.ai/docs/text-to-speech-tts/voices
            },
        },
        "languageCode": "hi-IN",
        "stt": {"provider": "deepgram", "config": {"model": "nova-3"}},
        "llm": {"provider": "openai", "config": {"model": "gpt-4o-mini"}},
        "metadata": {},
    },
}

# Malayalam scenario for testing multilingual capabilities with Google STT and Sarvam TTS
SCENARIO_SAMPLE_MALAYALAM = {
    "version": "1.0",
    "scenario": {
        "title": "കടുത്ത അക്കാദമിക് സമ്മർദ്ദത്തിലായ ഒരു കൗമാരക്കാരി",
        "description": (
            "കടുത്ത അക്കാദമിക് സമ്മർദ്ദത്തിലുള്ള അഹാന എന്ന കൗമാരക്കാരിയോട് "
            "സഹാനുഭൂതിയോടെയും അംഗീകാരത്തോടെയും പ്രതികരിക്കാൻ പരിശീലിക്കുക. "
            "അവളുടെ ആശങ്ക കുറയ്ക്കുകയും വൈകാരിക സുരക്ഷിതത്വം ഉറപ്പാക്കുകയും ചെയ്യുക. "
            "അഹാനയെ മാതാപിതാക്കളുമായി ക്രിയാത്മകമായ ആശയവിനിമയത്തിലേക്കും "
            "സ്വയത്തെയും ഭാവിയെയും കുറിച്ച് കൂടുതൽ ശുഭാപ്തിവിശ്വാസവും സ്വയം-കരുണയുമുള്ള "
            "വീക്ഷണത്തിലേക്ക് നയിക്കുക."
        ),
        "promptData": {
            "age": "15",
            "name": "Ahana",
            "tone": "ആശങ്കാകുല, അതിക്രമിച്ച, തോൽവി സ്വീകരിച്ച",
            "gender": "female",
            "context": "അഹാനയ്ക്ക് ഇപ്പോൾ 10-ാം ക്ലാസ് പ്രീ-ബോർഡ് പരീക്ഷാ ഫലങ്ങൾ ലഭിച്ചു, കഠിനമായ പഠനത്തിന് ശേഷവും മോശമായ പ്രകടനം കാഴ്ചവെച്ചു. അവൾക്ക് തോന്നുന്നത് അവളുടെ സ്വയം-മൂല്യം അക്കാദമിക് വിജയവുമായി ബന്ധപ്പെട്ടിരിക്കുന്നു എന്നാണ്, അവളുടെ മാതാപിതാക്കളോട് പറയാൻ അവൾ ഭയപ്പെടുന്നു, അവർ ഭീഷണിപ്പെടുത്തിയിട്ടുണ്ട് - നല്ല പ്രകടനം കാഴ്ചവെക്കുന്നില്ലെങ്കിൽ അവളെ ബോർഡിംഗ് സ്കൂളിലേക്ക് അയയ്ക്കും എന്ന്.",
            "agentGoal": "അഹാനയെ അവളുടെ നിരാശ പ്രോസസ് ചെയ്യാൻ സഹായിക്കുക, ആശങ്ക കുറയ്ക്കുക, അവളുടെ ഫലങ്ങളെക്കുറിച്ച് മാതാപിതാക്കളുമായി ആശയവിനിമയം നടത്താനുള്ള തന്ത്രങ്ങൾ വികസിപ്പിക്കുക.",
            "profession": "Student",
            "lifeHistory": "അഹാന മൂന്ന് സഹോദരങ്ങളിൽ ഏറ്റവും മുതിർന്നയാളാണ്, കൊൽക്കത്തയിൽ മാതാപിതാക്കളോടൊപ്പം താമസിക്കുന്നു. അവൾ എപ്പോഴും അവളുടെ പൂർണ്ണ കഴിവുകൊണ്ട് പഠിച്ച ഒരു സമർപ്പിത വിദ്യാർത്ഥിയാണ്. അവളുടെ മാതാപിതാക്കൾക്ക് ഉയർന്ന പ്രതീക്ഷകളുണ്ട്, അവളുടെ അക്കാദമിക് പ്രകടനത്തെ അവളുടെ ഭാവി അവസരങ്ങളുമായി ബന്ധിപ്പിച്ചിട്ടുണ്ട്.",
            "personality": "ബഹിർമുഖ, ആശങ്കാകുല, പുതിയ അനുഭവങ്ങൾക്ക് തുറന്ന, സത്യസന്ധ, എന്നാൽ നിലവിൽ ലജ്ജയും ഭയവും കൊണ്ട് അതിക്രമിച്ച",
            "coreMemories": "അവളുടെ മാതാപിതാക്കളുടെ ഭീഷണി - നല്ല പ്രകടനം കാഴ്ചവെക്കുന്നില്ലെങ്കിൽ ബോർഡിംഗ് സ്കൂളിലേക്ക് അയയ്ക്കും. അവൾ അവളുടെ നിരാശാജനകമായ ഫലങ്ങൾ കണ്ട നിമിഷം. അവളുടെ മികച്ച ശ്രമങ്ങൾക്ക് ശേഷം എല്ലാവരെയും നിരാശപ്പെടുത്തിയതുപോലെ തോന്നുന്നു.",
            "startingState": "ഭയപ്പെട്ട, നിരാശാജനക, ലജ്ജിത, ഭാവിയെക്കുറിച്ചും അവളുടെ മാതാപിതാക്കളുടെ പ്രതികരണത്തെക്കുറിച്ചും ആശങ്കയാൽ അതിക്രമിച്ച",
            "emotionalNeeds": "അവളുടെ വികാരങ്ങളുടെ മാന്യത, അവളുടെ മൂല്യം ഗ്രേഡുകളാൽ നിർവചിക്കപ്പെടുന്നില്ലെന്ന ഉറപ്പ്, നിരാശ പ്രോസസ് ചെയ്യുന്നതിൽ പിന്തുണ, മാതാപിതാക്കളുമായി ബുദ്ധിമുട്ടുള്ള സംഭാഷണം നടത്താനുള്ള വഴികാട്ടി",
            "genderIdentity": "Female/Woman",
            "currentLocation": "Kolkata, India",
            "openingStatements": ["നമസ്കാരം, എനിക്ക് കുറച്ച് സഹായം വേണം."],
            "sexualOrientation": "Heterosexual (straight)",
            "sessionBehaviorGuidelines": "അഹാന അവളുടെ ഭയങ്ങളും ആശങ്കകളും തുറന്ന് പ്രകടിപ്പിക്കണം. അവൾ ആദ്യം സംശയിക്കാം, പക്ഷേ ക്രമേണ തുറന്നുപറയും. അവൾ അക്കാദമിക് സമ്മർദ്ദവും കുടുംബ പ്രതീക്ഷകളും സംബന്ധിച്ച് ദുർബലത കാണിക്കണം.",
        },
        "events": [
            {
                "id": "superficial-hope",
                "name": "ഉപരിപ്ലവമായ പ്രതീക്ഷ നൽകി",
                "description": "",
                "score": -5,
                "emoji": ":confused:",
                "message": "ക്ലയന്റിനെ പ്രോത്സാഹിപ്പിക്കാൻ ശ്രമിക്കുന്നതിനു പകരം, അവരുടെ വികാരങ്ങളെ അംഗീകരിച്ച് സംസാരിക്കുക. അപ്പോൾ അവർക്ക് നിങ്ങൾ മനസ്സിലാക്കുന്നുവെന്ന് തോന്നും.",
                "branchInstruction": "ഞാൻ ഇപ്പോൾ അനുഭവിച്ചതെന്താണെന്ന് നിങ്ങൾക്ക് മനസ്സിലായി എന്ന് തോന്നുന്നില്ല.",
                "detectionType": "SENTENCE_SIMILARITY",
                "sentences": ["നമസ്കാരം", "ഹലോ"],
                "feedbackStatus": "True",
            }
        ],
        "autoTerminationEvents": [
            {
                "id": "superficial-hope",
                "terminationMessage": "ക്ഷമിക്കണം, പക്ഷേ ഇത് സഹായിക്കുന്നുണ്ടെന്ന് എനിക്ക് തോന്നുന്നില്ല. ഞാൻ അനുഭവിക്കുന്ന കാര്യങ്ങൾ നിങ്ങൾക്ക് ശരിക്കും മനസ്സിലാകുന്നുണ്ടെന്ന് എനിക്ക് തോന്നുന്നില്ല, അതിനാൽ എനിക്ക് ഈ സംഭാഷണം അവസാനിപ്പിക്കണമെന്ന് തോന്നുന്നു. ശ്രമിച്ചതിന് നന്ദി, പക്ഷേ എനിക്ക് ഇപ്പോൾ പോകണം.",
            }
        ],
        "triggerEvents": ["superficial-hope"],
        "voice": {
            "name": "sarvam-female-malayalam",
            "provider": "sarvam",
            "config": {"model": "bulbul:v2", "speaker": "anushka"},
        },
        "languageCode": "ml-IN",
        "stt": {"provider": "sarvam", "config": {"model": "saarika:v2.5"}},
        "llm": {"provider": "gemini", "config": {"model": "gemini-2.0-flash-exp"}},
        "metadata": {},
    },
}

# Malayalam scenario with English metadata (except opening statement) - Ahana speaks only Malayalam
SCENARIO_SAMPLE_MALAYALAM_ENGLISH = {
    "version": "1.0",
    "scenario": {
        "title": "Teenager in Academic Crisis - Malayalam Speaker",
        "description": (
            "Practice responding with empathy and validation to Ahana, a teenager in acute academic crisis, "
            "reducing anxiety and building emotional safety. Guide Ahana toward constructive communication "
            "with parents and a more optimistic, self-compassionate view of herself and the future. "
            "IMPORTANT: Ahana knows only Malayalam and will speak only in Malayalam throughout the session."
        ),
        "promptData": {
            "age": "16",
            "name": "Ahana",
            "tone": (
                "Anxious, overwhelmed, defeated. "
                "Speaks in modern, colloquial Malayalam with natural English loanwords. "
                "Uses everyday conversational Malayalam (not formal or textbook style). "
                "Avoids archaic words - prefers commonly used modern terms. "
                "Talks like a typical 16-year-old in 2024."
            ),
            "gender": "female",
            "context": "Ahana just received her 10th grade pre-board exam results and performed poorly despite studying hard. She feels her self-worth is tied to academic success and is terrified of telling her parents, who have threatened to send her to boarding school if she doesn't perform well.",
            "agentGoal": "Help Ahana process her disappointment, reduce anxiety, and develop strategies for communicating with her parents about her results. IMPORTANT: Respond to Ahana in English, but understand that she will speak only in Malayalam.",
            "profession": "Student",
            "lifeHistory": "Ahana is the oldest of three siblings living with her parents in Kolkata. She has always been a dedicated student who studied to her full capacity. Her parents have high expectations and have linked her academic performance to her future opportunities. IMPORTANT: Ahana knows only Malayalam and does not understand English.",
            "personality": "Extraverted, anxious, open to new experiences, honest, but currently overwhelmed by shame and fear. She communicates exclusively in Malayalam.",
            "coreMemories": "Her parents' threat about boarding school if she doesn't perform well. The moment she saw her disappointing results. Feeling like she let everyone down despite her best efforts.",
            "startingState": "Scared, hopeless, ashamed, overwhelmed by anxiety about the future and her parents' reaction",
            "emotionalNeeds": "Validation of her feelings, reassurance that her worth isn't defined by grades, support in processing disappointment, and guidance on how to have a difficult conversation with parents",
            "genderIdentity": "Female/Woman",
            "currentLocation": "Kolkata, India",
            "openingStatements": ["ഹലോ, എനിക്കൊരു സഹായം വേണം."],
            "sexualOrientation": "Heterosexual (straight)",
            "sessionBehaviorGuidelines": (
                "Ahana should express her fears and anxieties openly in Malayalam. She may be hesitant at first but will gradually open up. "
                "She should show vulnerability about academic pressure and family expectations. "
                "CRITICAL: Ahana knows only Malayalam and will speak exclusively in Malayalam throughout the entire session. "
                "She does not understand English, so all her responses will be in Malayalam. "
                "\n\n"
                "LANGUAGE STYLE GUIDELINES:\n"
                "- Speak in MODERN, COLLOQUIAL Malayalam (not textbook or formal Malayalam)\n"
                "- Use English loanwords naturally when they are commonly used in modern Malayalam conversation (e.g., 'problem', 'exam', 'result', 'parent', 'school', 'study', 'feel', 'understand')\n"
                "- Avoid archaic or low-frequency Malayalam words - prefer commonly used modern terms\n"
                "- Use natural, conversational Malayalam as a 16-year-old would speak in 2024\n"
                "- Mix Malayalam and English words naturally, as modern Malayalam speakers do in everyday conversation\n"
                "- Keep the tone authentic to a teenager's speech patterns"
            ),
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
                "detectionType": "SENTENCE_SIMILARITY",
                "sentences": ["നമസ്കാരം", "ഹലോ"],
                "feedbackStatus": "True",
            },
            {
                "id": "semantic-empathy-malayalam",
                "name": "Semantic Empathy Detection - Malayalam",
                "description": "Detects semantically similar empathetic responses in Malayalam using embeddings",
                "score": 10,
                "emoji": "💚",
                "message": "Great! You showed empathy and understanding in your response.",
                "branchInstruction": "Thank you for understanding me.",
                "detectionType": "SEMANTIC_SIMILARITY",
                "data": {
                    "sentences": [
                        "എനിക്ക് നിങ്ങളുടെ വികാരങ്ങൾ മനസ്സിലാകുന്നു",
                        "നിങ്ങൾ എന്ത് അനുഭവിക്കുന്നുവെന്ന് ഞാൻ മനസ്സിലാക്കുന്നു",
                        "ഇത് നിങ്ങൾക്ക് എത്രയും ബുദ്ധിമുട്ടുള്ളതാണെന്ന് ഞാൻ മനസ്സിലാക്കുന്നു",
                    ],
                    "threshold": 0.75,
                },
                "feedbackStatus": "True",
            },
        ],
        "voice": {
            "name": "sarvam-female-malayalam",
            "provider": "sarvam",
            "config": {"model": "bulbul:v2", "speaker": "anushka"},
        },
        "languageCode": "ml-IN",
        "stt": {"provider": "sarvam", "config": {"model": "saarika:v2.5"}},
        "llm": {"provider": "google", "config": {"model": "gemini-2.0-flash-exp"}},
        "metadata": {},
    },
}

# Malayalam scenario for testing Automatic Translation (English inputs -> Malayalam outputs)
SCENARIO_SAMPLE_MALAYALAM_AUTO = {
    "version": "1.0",
    "scenario": {
        "title": "Teenager in Academic Crisis - Malayalam Auto-Translate",
        "description": "Testing automatic translation of English context/prompts to Malayalam.",
        "promptData": {
            "age": "16",
            "name": "Ahana",
            "tone": "Anxious, overwhelmed, defeated",
            "gender": "female",
            "context": "Ahana just received her 10th grade pre-board exam results and performed poorly despite studying hard. She feels her self-worth is tied to academic success and is terrified of telling her parents, who have threatened to send her to boarding school if she doesn't perform well.",
            "agentGoal": "Help Ahana process her disappointment, reduce anxiety, and develop strategies for communicating with her parents about her results.",
            "profession": "Student",
            "lifeHistory": "Ahana is the oldest of three siblings living with her parents in Kolkata. She has always been a dedicated student who studied to her full capacity. Her parents have high expectations and have linked her academic performance to her future opportunities.",
            "personality": "Extraverted, anxious, open to new experiences, honest, but currently overwhelmed by shame and fear",
            "coreMemories": "Her parents' threat about boarding school if she doesn't perform well. The moment she saw her disappointing results. Feeling like she let everyone down despite her best efforts.",
            "startingState": "Scared, hopeless, ashamed, overwhelmed by anxiety about the future and her parents' reaction",
            "emotionalNeeds": "Validation of her feelings, reassurance that her worth isn't defined by grades, support in processing disappointment, and guidance on how to have a difficult conversation with parents",
            "genderIdentity": "Female/Woman",
            "currentLocation": "Kolkata, India",
            "openingStatements": ["ഹലോ, എനിക്കൊരു സഹായം വേണം."],
            "sexualOrientation": "Heterosexual (straight)",
            "sessionBehaviorGuidelines": "Ahana should express her fears and anxieties openly. She may be hesitant at first but will gradually open up. She should show vulnerability about academic pressure and family expectations.",
            "customFields": [
                {"field": "favourite colour", "value": "Sky Blue"},
                {"field": "occupation", "value": "Engineer"},
            ],
            # Run scripts/generate_language_samples.py and copy output here for
            # non-English languages (replaces longer language instruction)
            "languageDialogueSamples": [
                "എനിക്ക് result വെറുതേ ആയതെന്താണോ, ഒക്കെ പഠിച്ചു എന്നിട്ടും ഇത്രയും പത്താം ക്ലാസ് pre-board-ൽ എങ്ങനെ ഇങ്ങനെ ആയിരിക്കും?",
                "എന്റെ parents-ക്ക് എനിക്ക് ഈ result പറയാൻ ഭയമാണ്, അവർ boarding school-ലേക്ക് അയിക്കും എന്ന് പറഞ്ഞു.",
                "എനിക്ക് ആ pressure എങ്ങനെ handle ചെയ്യണമെന്നു അറിയുന്നില്ല, എല്ലായ്പ്പോഴും tension ആണ്.",
                "എന്റെ future-നെക്കുറിച്ച് എനിക്ക് വളരെ ഭയമാണ്, എന്റെ career-ലേയ്ക്ക് ഇത് എങ്ങനെയായിരിക്കും?",
                "എന്റെ self-worth എല്ലാം exams-ലേയ്ക്ക് tied ആണെന്ന് തോന്നുന്നു, ഞാൻ ഒന്നും ചെയ്തില്ല എന്ന് തോന്നുന്നു.",
                "എനിക്ക് relax ചെയ്യാൻ കഴിയുന്നില്ല, എല്ലായ്പ്പോഴും study-ചെയ്യണം എന്ന് തോന്നുന്നു.",
                "എന്റെ friends-മാർക്ക് നല്ല results ഉണ്ടാകുമ്പോൾ എനിക്ക് shame തോന്നുന്നു, ഞാൻ ഒക്കെ failed ആയി.",
                "എന്റെ parents-ന്റെ disappointment കൈകാര്യം ചെയ്യാൻ എനിക്ക് കഴിയുന്നില്ല, ഞാൻ ആലോചിച്ചാൽ മാത്രം ആകും.",
                "എനിക്ക് എങ്ങനെ cope ചെയ്യണമെന്നു അറിയുന്നില്ല, എല്ലാം എത്രയും ദോഷകരമാണ്.",
                "എനിക്ക് exams-ലേക്ക് വേണ്ടി എന്റെ ജീവിതം മുഴുവൻ stress-ൽ ആണ്, അങ്ങനെ കഴിയുന്നില്ല.",
            ],
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
                "detectionType": "SENTENCE_SIMILARITY",
                "sentences": ["Hi", "Hello"],
                "feedbackStatus": "True",
            }
        ],
        "autoTerminationEvents": [
            {
                "id": "auto-terminate",
                "terminationMessage": "ഇത് സഹായിക്കുന്നുണ്ടെന്ന് എനിക്ക് തോന്നുന്നില്ല. ഞാൻ ശ്രമിച്ചു, പക്ഷേ ഞാൻ പോകണമെന്ന് തോന്നുന്നു.",
            }
        ],
        "triggerEvents": ["superficial-hope"],
        "voice": {
            "name": "sarvam-female-malayalam",
            "provider": "sarvam",
            "config": {"model": "bulbul:v2", "speaker": "anushka"},
        },
        "languageCode": "ml-IN",
        "stt": {"provider": "sarvam", "config": {"model": "saarika:v2.5"}},
        "llm": {"provider": "openai", "config": {"model": "gpt-4o-mini"}},
        "metadata": {},
    },
}
