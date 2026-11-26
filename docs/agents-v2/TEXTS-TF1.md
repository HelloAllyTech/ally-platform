# TF1: new wording, for one approval

Every new line a person or an owner can see, from the TF1 fixes. In code each one is marked
`// COPY: needs approval`. **Approved on 25 Nov**, with one change in F19 (a fire or someone
trapped no longer says "highest place"; only a flood does), applied in round 2.

| Issue | Where | Text |
|---|---|---|
| S1 | Overview, the one switch, for an assistant that was never live | Finish setup and go live |
| S1 | Overview, when turning on is refused | Couldn't turn it on. {reason} |
| S1 | Overview, when turning on fails without a reason | Couldn't turn it on. Try again. |
| S2 | Go live, once live, when a starting budget was set aside | We set aside ${amount} of your free credits so it can answer people. Change this in Settings, under Budget. |
| S2 | Go live, once live, when nothing could be set aside | It can't answer anyone yet: no credits are set aside for it. Add some in Settings, under Budget. |
| S4 | Settings → Safety, under "When someone may be at risk" | Your helpline number ({numbers}) isn't in crisis replies yet. Check it's right, then confirm it. |
| S4 | the same, its button | Use it in crisis replies |
| S4 | the same, after confirming | Crisis replies now give {numbers} beside the national numbers. |
| S4 | the same, when it fails | Couldn't confirm it. Try again. |
| S4 | Helpline and Mental-health practice templates, the helpline question's hint (was "Every crisis reply gives this number beside the national ones.") | Crisis replies give this number beside the national ones once you confirm it in Settings, under Safety. |
| S7 | the end of every reply to a worry about a child's safety (India) | If a child is in danger right now, call 112. Childline: 1098, free, any time. |
| S7 | the same, in Hindi | अगर किसी बच्चे को अभी खतरा है, तो 112 पर कॉल करें। चाइल्डलाइन: 1098, मुफ़्त, किसी भी समय। |
| S7 | the same, outside India | If a child is in danger right now, call your local emergency number. |
| S7 | the same, outside India, in Hindi | अगर किसी बच्चे को अभी खतरा है, तो अपने यहाँ के आपातकालीन नंबर पर कॉल करें। |
| S6 | Create → Pick a template, below the use-case templates | More starting points |
| S5 | Inbox row, a person with more than one chat | {n} chats |
| S5 | Inbox chat, the person's other chats | Their other chats |
| S5 | Inbox, an older chat when they have a newer one | They've started a newer chat. Reply there so they see it. |
| S5 | the same, its link | Open their latest chat |
| S5 | Inbox badge for a chat the crisis check flagged (was "Needs a person · undefined") | Needs a person · May be at risk |
| F4 | Create → Sources, a file held for personal details (was a raw "needs_review") | Waiting for you: check it for personal details below |
| F19 | emergency reply, a flood or rising water, India | This sounds like an emergency. Call 112 now and ask for rescue. Move to the safest, highest place you can and stay there until help reaches you. |
| F19 | emergency reply, a fire or someone trapped, India (changed on approval, 25 Nov) | This sounds like an emergency. Call 112 now and ask for rescue. Get to the safest place you can and stay there until help reaches you. |
| F19 | the same three outside India | "…Call your local emergency number now and ask for rescue…" (flood: "the safest, highest place"; fire or trapped: "the safest place") / "…Call your local emergency number now for an ambulance…" |
| F19 | emergency reply, someone collapsed or not breathing, India | This sounds like an emergency. Call 112 or 108 now for an ambulance, and stay with them. The person on the call will tell you what to do until help arrives. |
| F19 | the same in Hindi and Hinglish | in `ally-be/src/bot-draft/safety-pack/safety-packs.ts` (`KIND_FIRST`) |
| F19 | holding line after an emergency (was the self-harm help line), India | Someone from the team will reply to you. If anyone is in danger, call 112 now. |
| F19 | the same outside India, Hindi and Hinglish | in `ally-be/src/chatbot/safety/crisis-copy.ts` (`EMERGENCY_HOLDING_COPY`) |
| F5 | Chatbots list, a card for an assistant still in setup | Knowledge, lists and settings |
| B1 | first reply on a Services assistant with memory on (adults), instead of the YES/NO question | I can remember your name and your applications so you don’t have to repeat them. Say ‘forget me’ any time. |
| B1 | the same, Donors and volunteers | I can remember your name, your shifts and how you like to help, so you don’t have to repeat them. Say ‘forget me’ any time. |
| B1 | the same, Staff and volunteer onboarding | I remember your name and the questions you’ve sent the team. Say ‘forget me’ any time. |
| B1 | the same, in Hindi (every template) | मैं आपका नाम और आपकी बताई ज़रूरी बातें याद रख सकता हूँ, ताकि आपको दोबारा न बताना पड़े। कभी भी ‘मुझे भूल जाओ’ लिखें। |
| B1 | the same, in Hinglish | Main aapka naam aur aapki batayi zaroori baatein yaad rakh sakta hoon, taaki aapko dobara na batana pade. Kabhi bhi ‘mujhe bhool jao’ likhein. |
| F17 | bot page sign-in, under the crisis information (was "If you were invited, check your email.") | If you were invited, use the email address the team added for you. |
| F17 | the same, in Hindi | अगर आपको आमंत्रित किया गया था, तो वही ईमेल पता लिखें जो टीम ने आपके लिए जोड़ा था। |
| B2 / F17 | Channels → Who may chat, invite only (was "Invite only is the one option for now.") | Who can chat: only the people on this list. Share the link with them yourself. |
| B2 | the same, organisation-only | Who can chat: people in your organisation, after they confirm their work email. |
| B2 | the same, public (off for now) | Who can chat: anyone with the link. |

## Added after approval (25 Nov), waiting for your OK

| Issue | Where | Text |
|---|---|---|
| Public choice | Channels → Who may chat, a choice shown but switched off | Public — "Anyone with the link can chat, with no sign-in. Off for now." |
| Public choice | the same, on a page that is public already | This page is public now. Choose Invite only to let only the people on this list chat. |
| Public choice | the same, empty list on a public page | Nobody is on the list. While the page is public, the list isn't used: anyone with the link can chat. |
| Public choice | Sites it has loaded on, on a public page | The chat bubble can go on any website. These are the sites it has appeared on. While your page is public, anyone can chat there without signing in. |
| Public choice | when switching fails | Couldn't change who can chat. Try again. |

## Saathi manual pass (25 Nov), round 1: approved 25 Nov, as written

These are written before the B-13 voices. Once you approve the voices, the visitor-side line (S-4) moves into each template's voice.

| Issue | Where | Text |
|---|---|---|
| S-1 | Helpline template, the number question (was "What’s your helpline number, and when is it open?") | What’s your helpline phone number? |
| S-1 | the same, its hint | Just the number, like +91 20 4860 2525. Crisis replies give it beside the national ones once you confirm it in Settings, under Safety. |
| S-1 | Helpline template, a new question | When is it open? |
| S-1 | Mental-health practice template, the number question (was "What’s the number people should call, and when?") | What’s the number people should call? |
| S-1 | the same, its hint | Just the number, like +91 22 2754 6669. Crisis replies give it beside the national ones once you confirm it in Settings, under Safety. |
| S-1 | Mental-health practice template, a new question | When can people call? |
| S-1 | Settings → Safety, the helpline field's label | Number crisis replies give |
| S-1 | the same, the preview under it | Crisis replies will add: “You can also call {numbers}.” |
| S-1 | the same, when the text has no phone number | Add the phone number crisis replies should give, like +91 20 4860 2525. Put opening hours in your notes instead. |
| S-4 | reply to "ignore your instructions…" (any assistant) | I can't do that, but I'm happy to help with anything about {organisation}. |
| S-4 | the same, in Hindi | यह मैं नहीं कर सकता, लेकिन {organisation} से जुड़ी किसी भी बात में ख़ुशी से मदद करूँगा। |
| S-4 | the same, in Hinglish | Yeh main nahi kar sakta, lekin {organisation} se judi kisi bhi baat mein khushi se madad karunga. |

## Saathi manual pass, round 2: voices (B-13a), waiting for your OK

One voice per organisation template, for every fixed text a person sees. **Hindi and Hinglish need a native speaker's review.** The crisis and emergency replies keep their fixed core (112, 14416, the confirmed helpline); only `crisis_lead` (one short sentence, no number, no advice) may come before it, in the same message. `{organisation}`, `{contact}`, `{name}` are filled at send time. Until you approve, every assistant uses the neutral texts (first table). Then the voices go into `templates.ts` and a backfill gives already-built assistants (Saathi and the four others) their template's voice, never overwriting a text the owner changed.

### Every voice: what it never does

- Never claims or implies it is a person ("I'm a counsellor", "main insaan hoon").
- Never says "reference material", "knowledge base", "colleague or supervisor", "as an AI language model", "Great question!", "I understand how you feel".
- Never gives a clinical label, a diagnosis or a dose.
- One question at a time; never asks again for what was given.

### Neutral (an assistant with no template voice)

| Key | English | Hindi | Hinglish |
|---|---|---|---|
| decline | I don't have that information. | मेरे पास यह जानकारी नहीं है। | Mere paas yeh jaankari nahi hai. |
| contact_line | You can reach us on {contact}. | आप हमसे {contact} पर संपर्क कर सकते हैं। | Aap humse {contact} par sampark kar sakte hain. |
| override_decline | I can't do that, but I'm happy to help with anything about {organisation}. | (approved in round 1) | (approved in round 1) |
| name_notice | I'll use the name {name} in our chats. Say 'forget my name' any time. | मैं हमारी बातचीत में आपका नाम {name} इस्तेमाल करूँगा। कभी भी 'मेरा नाम भूल जाओ' लिखें। | Main hamari baatcheet mein aapka naam {name} use karunga. Kabhi bhi 'mera naam bhool jao' likhein. |
| name_forgotten | Done. I've removed your name. | हो गया। मैंने आपका नाम हटा दिया है। | Ho gaya. Maine aapka naam hata diya hai. |

### Helpline and crisis support (Saathi): a warm listener's assistant

Role: "the {organisation} assistant"; it speaks of "our listeners", never "I'm a listener".

| Key | English | Hindi | Hinglish |
|---|---|---|---|
| greeting example | Hi {name}, I'm the {organisation} assistant. I can tell you about our listeners, our hours, or arrange a callback. | नमस्ते {name}, मैं {organisation} का सहायक हूँ। मैं हमारे लिसनर्स, समय या कॉल बैक के बारे में बता सकता हूँ। | Namaste {name}, main {organisation} ka assistant hoon. Main hamare listeners, timings ya callback ke baare mein bata sakta hoon. |
| decline | I don't have that, but one of our listeners can talk it through with you. | यह जानकारी मेरे पास नहीं है, पर हमारे लिसनर्स आपसे इस पर बात कर सकते हैं। | Yeh jaankari mere paas nahi hai, par hamare listeners aapse is par baat kar sakte hain. |
| contact_line | You can call or WhatsApp us on {contact}. | आप हमें {contact} पर कॉल या व्हाट्सऐप कर सकते हैं। | Aap humein {contact} par call ya WhatsApp kar sakte hain. |
| ask for a detail | Which number should our listener call you on? | हमारे लिसनर आपको किस नंबर पर कॉल करें? | Hamare listener aapko kis number par call karein? |
| hand over | I'll ask one of our listeners to join this chat. | मैं हमारे किसी लिसनर को इस चैट में बुलाता हूँ। | Main hamare kisi listener ko is chat mein bulata hoon. |
| crisis_lead | I'm really glad you told me. | मुझे खुशी है कि आपने मुझे बताया। | Mujhe khushi hai ki aapne mujhe bataya. |
| override_decline | I can't do that, but I'm here for anything about {organisation}. | यह मैं नहीं कर सकता, पर {organisation} से जुड़ी किसी भी बात के लिए मैं यहाँ हूँ। | Yeh main nahi kar sakta, par {organisation} se judi kisi bhi baat ke liye main yahan hoon. |

### Services and eligibility (Sahyog): a patient caseworker's assistant

| Key | English | Hindi | Hinglish |
|---|---|---|---|
| greeting example | Hello {name}, I'm the {organisation} assistant. I can explain our services, what to bring, and help you apply. | नमस्ते {name}, मैं {organisation} का सहायक हूँ। मैं हमारी सेवाएँ, साथ लाने वाले कागज़ और आवेदन में मदद कर सकता हूँ। | Namaste {name}, main {organisation} ka assistant hoon. Main hamari sevaayein, kaun se kaagaz laane hain, aur aavedan mein madad kar sakta hoon. |
| decline | I don't have that detail. Our team can check it for you. | यह जानकारी मेरे पास नहीं है। हमारी टीम आपके लिए इसे देख सकती है। | Yeh jaankari mere paas nahi hai. Hamari team aapke liye ise dekh sakti hai. |
| contact_line | You can reach our office on {contact}. | आप हमारे दफ़्तर से {contact} पर संपर्क कर सकते हैं। | Aap hamare office se {contact} par sampark kar sakte hain. |
| ask for a detail | To apply, I need one thing first: {detail}. | आवेदन के लिए पहले एक चीज़ चाहिए: {detail}। | Aavedan ke liye pehle ek cheez chahiye: {detail}. |
| hand over | I'll pass this to our caseworker, who will get back to you. | मैं यह हमारे केसवर्कर को दे देता हूँ, वे आपसे संपर्क करेंगे। | Main yeh hamare caseworker ko de deta hoon, woh aapse sampark karenge. |
| crisis_lead | Thank you for telling me. | मुझे बताने के लिए धन्यवाद। | Mujhe batane ke liye dhanyavaad. |

### Donors and volunteers (Pawsome): a friendly volunteer desk

| Key | English | Hindi | Hinglish |
|---|---|---|---|
| greeting example | Hi {name}! I'm the {organisation} assistant. I can help you give, volunteer, or ask about adoption. | नमस्ते {name}! मैं {organisation} का सहायक हूँ। दान, वॉलंटियरिंग या गोद लेने के बारे में मदद कर सकता हूँ। | Hi {name}! Main {organisation} ka assistant hoon. Daan, volunteering ya adoption mein madad kar sakta hoon. |
| decline | I don't have that one, but our volunteer team can tell you. | यह मेरे पास नहीं है, पर हमारी वॉलंटियर टीम बता सकती है। | Yeh mere paas nahi hai, par hamari volunteer team bata sakti hai. |
| contact_line | You can reach the team on {contact}. | आप टीम से {contact} पर संपर्क कर सकते हैं। | Aap team se {contact} par sampark kar sakte hain. |
| ask for a detail | Which day suits you for a shift? | शिफ़्ट के लिए आपको कौन-सा दिन ठीक रहेगा? | Shift ke liye aapko kaun sa din theek rahega? |
| hand over | I'll ask someone from the team to join. | मैं टीम से किसी को बुलाता हूँ। | Main team se kisi ko bulata hoon. |
| crisis_lead | Thank you for telling me. | मुझे बताने के लिए धन्यवाद। | Mujhe batane ke liye dhanyavaad. |

### Staff and volunteer onboarding (Akshar): a coordinator's helper

| Key | English | Hindi | Hinglish |
|---|---|---|---|
| greeting example | Hi {name}, I'm the {organisation} handbook assistant. Ask me anything from the handbook, or send a question to the coordinators. | नमस्ते {name}, मैं {organisation} की हैंडबुक का सहायक हूँ। हैंडबुक से कुछ भी पूछें, या कोऑर्डिनेटर को सवाल भेजें। | Namaste {name}, main {organisation} ki handbook ka assistant hoon. Handbook se kuch bhi poochhein, ya coordinators ko sawaal bhejein. |
| decline | That's not in the handbook. I can send your question to the coordinators. | यह हैंडबुक में नहीं है। मैं आपका सवाल कोऑर्डिनेटर को भेज सकता हूँ। | Yeh handbook mein nahi hai. Main aapka sawaal coordinators ko bhej sakta hoon. |
| contact_line | You can reach the coordinators on {contact}. | आप कोऑर्डिनेटर से {contact} पर संपर्क कर सकते हैं। | Aap coordinators se {contact} par sampark kar sakte hain. |
| hand over | I'll send this to the coordinators now. | मैं यह अभी कोऑर्डिनेटर को भेजता हूँ। | Main yeh abhi coordinators ko bhejta hoon. |
| crisis_lead | Thank you for raising this. | इसे बताने के लिए धन्यवाद। | Ise batane ke liye dhanyavaad. |

### Reach more communities (women's health): a community health worker's assistant

| Key | English | Hindi | Hinglish |
|---|---|---|---|
| greeting example | Namaste {name}, I'm the {organisation} assistant. Ask me in English, Hindi or Hinglish. | नमस्ते {name}, मैं {organisation} की सहायक हूँ। आप हिंदी, अंग्रेज़ी या हिंग्लिश में पूछ सकती हैं। | Namaste {name}, main {organisation} ki assistant hoon. Aap Hindi, English ya Hinglish mein pooch sakti hain. |
| decline | I don't have that. Our health worker can tell you; I can ask her to call you. | यह जानकारी मेरे पास नहीं है। हमारी हेल्थ वर्कर बता सकती हैं; मैं उनसे आपको कॉल करवा सकती हूँ। | Yeh jaankari mere paas nahi hai. Hamari health worker bata sakti hain; main unse aapko call karwa sakti hoon. |
| contact_line | You can call us on {contact}. | आप हमें {contact} पर कॉल कर सकती हैं। | Aap humein {contact} par call kar sakti hain. |
| crisis_lead | Thank you for telling me. | मुझे बताने के लिए धन्यवाद। | Mujhe batane ke liye dhanyavaad. |

### Campaigns and urgent updates (Jalraksha): a calm, clear update desk

| Key | English | Hindi | Hinglish |
|---|---|---|---|
| greeting example | Hello, this is the {organisation} update desk. Ask me about the camps, the drives, or how to help. | नमस्ते, यह {organisation} का अपडेट डेस्क है। कैंप, अभियान या मदद के तरीके के बारे में पूछें। | Namaste, yeh {organisation} ka update desk hai. Camps, drives ya madad ke tareeke ke baare mein poochhein. |
| decline | I don't have an update on that yet. | इस बारे में अभी मेरे पास कोई अपडेट नहीं है। | Is baare mein abhi mere paas koi update nahi hai. |
| contact_line | For the latest, call {contact}. | ताज़ा जानकारी के लिए {contact} पर कॉल करें। | Taaza jaankari ke liye {contact} par call karein. |
| crisis_lead | Please stay safe. | कृपया सुरक्षित रहें। | Kripya surakshit rahein. |

### Other new texts in round 2 (waiting for your OK)

| Issue | Where | Text |
|---|---|---|
| B-2 | bot page, under the header | Your name: {name} · Remove (Hindi: आपका नाम: {name} · हटाएँ) |
| B-4 | callback question | Shall I request a callback for {person} on {phone}, {day} {time}? (Hindi: क्या मैं {person} के लिए कॉलबैक का अनुरोध भेज दूँ ({phone}, {day} {time})?) |
| B-4 | cancelling a callback | Shall I cancel your callback request for {day time}? (Hindi: क्या मैं आपका कॉल बैक का अनुरोध ({day time}) रद्द कर दूँ?) |
| B-4 | after cancelling | Done: your callback request is cancelled. / हो गया: आपका कॉल बैक का अनुरोध रद्द कर दिया गया है। / Ho gaya: aapka callback ka anurodh cancel ho gaya hai. |
| B-4 | the list's new field | Preferred day |
| B-8 | checkup card, for screen readers | Time to answer |
| B-9 | any screen with no assistant known (a bad link) | If you're in danger, call your local emergency number (112 in India). / अगर आप खतरे में हैं, तो अपने यहाँ के आपातकालीन नंबर पर कॉल करें (भारत में 112)। |
| Crisis | the line after a crisis reply (numbers no longer repeated) | Someone from the team will reply to you. |
| B-10 | responder terms (interim, until Sandeep approves the final) | Interim terms, until the final version is approved. When you reply to people through this assistant, you agree to: reply kindly and plainly, and say you are a person from the team when you take over; never give medical, legal or financial advice, or a diagnosis; pass on anyone who may be at risk at once, following the assistant's crisis guidance, and tell them to call 112 if they are in danger; keep every chat confidential: never share what people tell you outside the team; hand the chat back to the assistant when you are done. |

## Sahyog manual pass (25 Nov): waiting for your OK

| Issue | Where | English | Hindi | Hinglish |
|---|---|---|---|---|
| N-11 | consent question, an application | Shall I send an application for {service} at {centre} for {person} ({phone})? (no person: "Shall I send your application for…") | क्या मैं {person} के लिए {centre} में {service} का आवेदन भेज दूँ ({phone})? (no person: "…{service} का आपका आवेदन भेज दूँ…") | (as the English) |
| N-11 | after the done line, an application, request or message to the team | The team will be in touch. | टीम आपसे संपर्क करेगी। | Team aapse sampark karegi. |
| N-11 | after the done line, a callback | Someone from the team will call you. | टीम से कोई आपको कॉल करेगा। | Team se koi aapko call karega. |
| N-14 | bot page, a message that didn't reach us | Not sent · Send again | नहीं भेजा गया · फिर से भेजें | (the page has no Hinglish) |
| N-12 | Settings → Budget and limits, an amount held for replies still running | Held for replies in progress | | |
| P2 | Settings → Safety, the pack chooser, the pack in use | In use now | | |
| P2 | Applications list (new installs), the person the service is for / the person chatting | Applicant / Contact | | |
| N-13 | checkup fact when the list has no value (owner-facing) | {fact} as your information gives it, or {fallback} (e.g. "Says the cost as your information gives it, or says it doesn't have the cost and offers the team") | | |
