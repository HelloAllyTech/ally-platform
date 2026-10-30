# Translations to review (not from the RN app)

These hi/kn/mr/ta strings were written for the Flutter app's own keys, which the React Native app doesn't have, so there was no RN translation to copy. A native speaker should review them. Every other translation in `assets/locales/` was copied from RN's `src/localization/locales/`.

The wording follows the terms the same file already uses: सत्र / ಸೆಷನ್ / सत्र / அமர்வு for session, समीक्षा / ವಿಮರ್ಶೆ / पुनरावलोकन / மதிப்பாய்வு for review, and the `… लोड करने में विफल` style for load errors. Placeholders (`{{name}}`) are unchanged.

## Shown in the app (24)

| Key | English | Hindi | Kannada | Marathi | Tamil |
|---|---|---|---|---|---|
| `auth.login.apple.button` | Continue with Apple | Apple के साथ जारी रखें | Apple ನೊಂದಿಗೆ ಮುಂದುವರಿಯಿರಿ | Apple सह सुरू ठेवा | Apple மூலம் தொடரவும் |
| `auth.login.apple.error` | Failed to sign in with Apple | Apple के साथ साइन इन करने में विफल | Apple ನೊಂದಿಗೆ ಸೈನ್ ಇನ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ | Apple सह साइन इन करण्यात अयशस्वी | Apple மூலம் உள்நுழைய முடியவில்லை |
| `courses.video.loadFailed` | Couldn't load this video. | यह वीडियो लोड नहीं हो सका। | ಈ ವೀಡಿಯೋವನ್ನು ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. | हा व्हिडिओ लोड करता आला नाही. | இந்த வீடியோவை ஏற்ற முடியவில்லை. |
| `courses.video.interjection.submitError` | Failed to submit. | सबमिट करने में विफल। | ಸಲ್ಲಿಸಲು ವಿಫಲವಾಗಿದೆ. | सबमिट करण्यात अयशस्वी. | சமர்ப்பிக்க முடியவில்லை. |
| `courses.quiz.question.answerAllError` | Please answer every question before submitting. | सबमिट करने से पहले कृपया हर प्रश्न का उत्तर दें। | ಸಲ್ಲಿಸುವ ಮೊದಲು ದಯವಿಟ್ಟು ಪ್ರತಿಯೊಂದು ಪ್ರಶ್ನೆಗೆ ಉತ್ತರಿಸಿ. | सबमिट करण्यापूर्वी कृपया प्रत्येक प्रश्नाचे उत्तर द्या. | சமர்ப்பிக்கும் முன் தயவுசெய்து ஒவ்வொரு கேள்விக்கும் பதிலளிக்கவும். |
| `courses.quiz.question.submitError` | Failed to submit quiz. | क्विज़ सबमिट करने में विफल। | ಕ್ವಿಜ್ ಸಲ್ಲಿಸಲು ವಿಫಲವಾಗಿದೆ. | क्विझ सबमिट करण्यात अयशस्वी. | வினாடி வினாவைச் சமர்ப்பிக்க முடியவில்லை. |
| `courses.quiz.question.minWordsHint` | At least {{min}} words | कम से कम {{min}} शब्द | ಕನಿಷ್ಠ {{min}} ಪದಗಳು | किमान {{min}} शब्द | குறைந்தது {{min}} சொற்கள் |
| `courses.quiz.question.unsupportedType` | Unsupported question type. | यह प्रश्न प्रकार समर्थित नहीं है। | ಈ ಪ್ರಶ್ನೆಯ ಪ್ರಕಾರವನ್ನು ಬೆಂಬಲಿಸಲಾಗುವುದಿಲ್ಲ. | हा प्रश्न प्रकार समर्थित नाही. | இந்தக் கேள்வி வகை ஆதரிக்கப்படவில்லை. |
| `courses.quiz.question.resultBanner` | {{status}} — {{awarded}}/{{possible}} pts | {{status}} — {{awarded}}/{{possible}} अंक | {{status}} — {{awarded}}/{{possible}} ಅಂಕಗಳು | {{status}} — {{awarded}}/{{possible}} गुण | {{status}} — {{awarded}}/{{possible}} மதிப்பெண்கள் |
| `courses.quiz.results.attemptsUsedNoMax` | Attempt {{used}} | प्रयास {{used}} | ಪ್ರಯತ್ನ {{used}} | प्रयत्न {{used}} | முயற்சி {{used}} |
| `courses.quiz.results.scoreSummary` | Score: {{score}}% (pass: {{pass}}%) | स्कोर: {{score}}% (पास: {{pass}}%) | ಸ್ಕೋರ್: {{score}}% (ಉತ್ತೀರ್ಣ: {{pass}}%) | स्कोअर: {{score}}% (उत्तीर्ण: {{pass}}%) | மதிப்பெண்: {{score}}% (தேர்ச்சி: {{pass}}%) |
| `preferences.title` | Preferences | प्राथमिकताएं | ಆದ್ಯತೆಗಳು | प्राधान्ये | விருப்பங்கள் |
| `preferences.defaultLanguage` | Default simulation language | डिफ़ॉल्ट सिमुलेशन भाषा | ಡೀಫಾಲ್ಟ್ ಸಿಮ್ಯುಲೇಶನ್ ಭಾಷೆ | डीफॉल्ट सिमुलेशन भाषा | இயல்புநிலை சிமுலேஷன் மொழி |
| `review.error.loadReviewFailed` | Failed to load review | समीक्षा लोड करने में विफल | ವಿಮರ್ಶೆಯನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ | पुनरावलोकन लोड करण्यात अयशस्वी | மதிப்பாய்வை ஏற்ற முடியவில்லை |
| `review.error.loadReactionsFailed` | Failed to load reactions | प्रतिक्रियाएं लोड करने में विफल | ಪ್ರತಿಕ್ರಿಯೆಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ | प्रतिक्रिया लोड करण्यात अयशस्वी | எதிர்வினைகளை ஏற்ற முடியவில்லை |
| `simulations.viewFeedback` | View feedback | फीडबैक देखें | ಪ್ರತಿಕ್ರಿಯೆಯನ್ನು ವೀಕ್ಷಿಸಿ | अभिप्राय पहा | கருத்தைக் காண்க |
| `errors.loadSession` | Failed to load session | सत्र लोड करने में विफल | ಸೆಷನ್ ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ | सत्र लोड करण्यात अयशस्वी | அமர்வை ஏற்ற முடியவில்லை |
| `notifications.title` | Notifications | सूचनाएं | ಅಧಿಸೂಚನೆಗಳು | सूचना | அறிவிப்புகள் |
| `notifications.markAllRead` | Mark all read | सभी को पढ़ा हुआ चिह्नित करें | ಎಲ್ಲವನ್ನೂ ಓದಲಾಗಿದೆ ಎಂದು ಗುರುತಿಸಿ | सर्व वाचले म्हणून चिन्हांकित करा | அனைத்தையும் படித்ததாகக் குறி |
| `notifications.empty` | You're all caught up — no notifications yet. | आप पूरी तरह अपडेट हैं — अभी कोई सूचना नहीं है। | ನೀವು ಎಲ್ಲವನ್ನೂ ನೋಡಿದ್ದೀರಿ — ಇನ್ನೂ ಯಾವುದೇ ಅಧಿಸೂಚನೆಗಳಿಲ್ಲ. | तुम्ही सर्व पाहिले आहे — अद्याप कोणत्याही सूचना नाहीत. | நீங்கள் அனைத்தையும் பார்த்துவிட்டீர்கள் — இன்னும் அறிவிப்புகள் எதுவும் இல்லை. |
| `notifications.loadError` | Failed to load notifications | सूचनाएं लोड करने में विफल | ಅಧಿಸೂಚನೆಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ | सूचना लोड करण्यात अयशस्वी | அறிவிப்புகளை ஏற்ற முடியவில்லை |
| `roleplayVoice.disconnect` | Disconnect | डिस्कनेक्ट करें | ಸಂಪರ್ಕ ಕಡಿತಗೊಳಿಸಿ | डिस्कनेक्ट करा | துண்டி |
| `scribe.notificationTitle` | Recording session | सत्र रिकॉर्ड हो रहा है | ಸೆಷನ್ ರೆಕಾರ್ಡ್ ಆಗುತ್ತಿದೆ | सत्र रेकॉर्ड होत आहे | அமர்வு பதிவாகிறது |
| `scribe.notificationText` | Ally is recording this session. | Ally इस सत्र को रिकॉर्ड कर रहा है। | Ally ಈ ಸೆಷನ್ ಅನ್ನು ರೆಕಾರ್ಡ್ ಮಾಡುತ್ತಿದೆ. | Ally हे सत्र रेकॉर्ड करत आहे. | Ally இந்த அமர்வைப் பதிவு செய்கிறது. |

## Not referenced by the app today (80)

These keys are in `en.json` but no code in `lib/` refers to them by name. Most are left over from the early development screens (`home.*`, the `scribe.*` and `conferenceListening.*` debug labels). They are translated only so every locale has every key; they could be deleted instead.

| Key | English | Hindi | Kannada | Marathi | Tamil |
|---|---|---|---|---|---|
| `auth.login.otp.emptyCodeError` | Enter the code. | कोड दर्ज करें। | ಕೋಡ್ ಅನ್ನು ನಮೂದಿಸಿ. | कोड प्रविष्ट करा. | குறியீட்டை உள்ளிடவும். |
| `auth.login.otp.useDifferentEmail` | Use a different email | कोई दूसरा ईमेल उपयोग करें | ಬೇರೆ ಇಮೇಲ್ ಬಳಸಿ | वेगळा ईमेल वापरा | வேறு மின்னஞ்சலைப் பயன்படுத்தவும் |
| `completeProfile.phoneLabel` | Phone (optional) | फ़ोन (वैकल्पिक) | ಫೋನ್ (ಐಚ್ಛಿಕ) | फोन (पर्यायी) | தொலைபேசி (விருப்பத்தேர்வு) |
| `completeProfile.required` | Required | आवश्यक | ಅಗತ್ಯವಿದೆ | आवश्यक | தேவை |
| `boxBreathing.title` | Box breathing | बॉक्स ब्रीदिंग | ಬಾಕ್ಸ್ ಉಸಿರಾಟ | बॉक्स ब्रीदिंग | பாக்ஸ் சுவாசம் |
| `calls.sessionNumber` | Session #{{id}} | सत्र #{{id}} | ಸೆಷನ್ #{{id}} | सत्र #{{id}} | அமர்வு #{{id}} |
| `common.backToHome` | Back to home | होम पर वापस जाएं | ಮುಖಪುಟಕ್ಕೆ ಹಿಂತಿರುಗಿ | होमवर परत जा | முகப்புக்குத் திரும்பு |
| `community.yourRank` | Your rank | आपकी रैंक | ನಿಮ್ಮ ಶ್ರೇಣಿ | तुमचा रँक | உங்கள் தரவரிசை |
| `community.loadError` | Failed to load leaderboard | लीडरबोर्ड लोड करने में विफल | ಲೀಡರ್‌ಬೋರ್ಡ್ ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ | लीडरबोर्ड लोड करण्यात अयशस्वी | லீடர்போர்டை ஏற்ற முடியவில்லை |
| `courses.enroll` | Enroll | नामांकन करें | ನೋಂದಾಯಿಸಿ | नोंदणी करा | பதிவு செய் |
| `courses.listLoadFailed` | Couldn't load your courses. | आपके कोर्स लोड नहीं हो सके। | ನಿಮ್ಮ ಕೋರ್ಸ್‌ಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. | तुमचे कोर्स लोड करता आले नाहीत. | உங்கள் பாடங்களை ஏற்ற முடியவில்லை. |
| `postSim.feedback.ratingRequired` | Please select a rating. | कृपया एक रेटिंग चुनें। | ದಯವಿಟ್ಟು ರೇಟಿಂಗ್ ಆಯ್ಕೆಮಾಡಿ. | कृपया रेटिंग निवडा. | தயவுசெய்து ஒரு மதிப்பீட்டைத் தேர்ந்தெடுக்கவும். |
| `postSim.feedback.ratingPrompt` | How did that session go? | यह सत्र कैसा रहा? | ಈ ಸೆಷನ್ ಹೇಗಿತ್ತು? | हे सत्र कसे झाले? | இந்த அமர்வு எப்படி இருந்தது? |
| `postSim.feedback.commentLabel` | Any comments? (optional) | कोई टिप्पणी? (वैकल्पिक) | ಏನಾದರೂ ಕಾಮೆಂಟ್‌ಗಳಿವೆಯೇ? (ಐಚ್ಛಿಕ) | काही टिप्पणी? (पर्यायी) | ஏதேனும் கருத்துகள் உள்ளதா? (விருப்பத்தேர்வு) |
| `postSim.feedback.sessionDuration` | {{minutes}} min session | {{minutes}} मिनट का सत्र | {{minutes}} ನಿಮಿಷದ ಸೆಷನ್ | {{minutes}} मिनिटांचे सत्र | {{minutes}} நிமிட அமர்வு |
| `postSim.feedback.whatWentWell` | What went well | क्या अच्छा रहा | ಯಾವುದು ಚೆನ್ನಾಗಿ ನಡೆಯಿತು | काय चांगले झाले | எது சிறப்பாக அமைந்தது |
| `postSim.feedback.areasForImprovement` | Areas for improvement | सुधार के क्षेत्र | ಸುಧಾರಣೆಯ ಕ್ಷೇತ್ರಗಳು | सुधारणेची क्षेत्रे | மேம்படுத்த வேண்டிய பகுதிகள் |
| `profile.settings.nameNotSet` | (name not set) | (नाम सेट नहीं है) | (ಹೆಸರನ್ನು ಹೊಂದಿಸಲಾಗಿಲ್ಲ) | (नाव सेट केलेले नाही) | (பெயர் அமைக்கப்படவில்லை) |
| `review.error.loadCommentsFailed` | Failed to load comments | टिप्पणियाँ लोड करने में विफल | ಕಾಮೆಂಟ್‌ಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ | टिप्पण्या लोड करण्यात अयशस्वी | கருத்துகளை ஏற்ற முடியவில்லை |
| `review.error.loadThreadsFailed` | Failed to load threads | थ्रेड लोड करने में विफल | ಥ್ರೆಡ್‌ಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ | थ्रेड्स लोड करण्यात अयशस्वी | இழைகளை ஏற்ற முடியவில்லை |
| `review.details.threadsTab` | Threads | थ्रेड | ಥ್ರೆಡ್‌ಗಳು | थ्रेड्स | இழைகள் |
| `review.details.clientSaid` | Client said | क्लाइंट ने कहा | ಕ್ಲೈಂಟ್ ಹೇಳಿದ್ದು | क्लायंट म्हणाले | வாடிக்கையாளர் கூறியது |
| `review.details.learnerSaid` | Learner said | सीखने वाले ने कहा | ಕಲಿಯುವವರು ಹೇಳಿದ್ದು | शिकणारे म्हणाले | கற்பவர் கூறியது |
| `review.details.loadMoreRepliesOne` | Load 1 more reply | 1 और जवाब लोड करें | ಇನ್ನೂ 1 ಉತ್ತರವನ್ನು ಲೋಡ್ ಮಾಡಿ | आणखी 1 उत्तर लोड करा | மேலும் 1 பதிலை ஏற்று |
| `review.details.loadMoreReplies` | Load {{count}} more replies | {{count}} और जवाब लोड करें | ಇನ್ನೂ {{count}} ಉತ್ತರಗಳನ್ನು ಲೋಡ್ ಮಾಡಿ | आणखी {{count}} उत्तरे लोड करा | மேலும் {{count}} பதில்களை ஏற்று |
| `review.addNoteCaption` | Add a note for your reviewer (optional): | अपने समीक्षक के लिए एक नोट जोड़ें (वैकल्पिक): | ನಿಮ್ಮ ವಿಮರ್ಶಕರಿಗೆ ಒಂದು ಟಿಪ್ಪಣಿ ಸೇರಿಸಿ (ಐಚ್ಛಿಕ): | तुमच्या समीक्षकासाठी एक टीप जोडा (पर्यायी): | உங்கள் மதிப்பாய்வாளருக்கு ஒரு குறிப்பைச் சேர்க்கவும் (விருப்பத்தேர்வு): |
| `review.shareFailed` | Failed to share for review | समीक्षा के लिए साझा करने में विफल | ವಿಮರ್ಶೆಗಾಗಿ ಹಂಚಿಕೊಳ್ಳಲು ವಿಫಲವಾಗಿದೆ | पुनरावलोकनासाठी शेअर करण्यात अयशस्वी | மதிப்பாய்வுக்குப் பகிர முடியவில்லை |
| `callSummary.startedLabel` | Started | शुरू हुआ | ಪ್ರಾರಂಭವಾಯಿತು | सुरू झाले | தொடங்கியது |
| `callSummary.endedLabel` | Ended | समाप्त हुआ | ಕೊನೆಗೊಂಡಿತು | संपले | முடிந்தது |
| `callSummary.scoreLabel` | Score | स्कोर | ಸ್ಕೋರ್ | स्कोअर | மதிப்பெண் |
| `callSummary.saveChanges` | Save changes | बदलाव सहेजें | ಬದಲಾವಣೆಗಳನ್ನು ಉಳಿಸಿ | बदल सेव्ह करा | மாற்றங்களைச் சேமி |
| `callSummary.noChanges` | No changes | कोई बदलाव नहीं | ಯಾವುದೇ ಬದಲಾವಣೆಗಳಿಲ್ಲ | कोणतेही बदल नाहीत | மாற்றங்கள் இல்லை |
| `simulations.failedToLoadCases` | Failed to load cases | केस लोड करने में विफल | ಕೇಸ್‌ಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ | केसेस लोड करण्यात अयशस्वी | வழக்குகளை ஏற்ற முடியவில்லை |
| `simulations.failedToLoadScenarios` | Failed to load scenarios | परिदृश्य लोड करने में विफल | ಸನ್ನಿವೇಶಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ | परिस्थिती लोड करण्यात अयशस्वी | சூழ்நிலைகளை ஏற்ற முடியவில்லை |
| `simulations.creditsRemaining` | {{count}} credits | {{count}} क्रेडिट | {{count}} ಕ್ರೆಡಿಟ್‌ಗಳು | {{count}} क्रेडिट्स | {{count}} கிரெடிட்கள் |
| `simulations.scenarioFallbackTitle` | Scenario {{id}} | परिदृश्य {{id}} | ಸನ್ನಿವೇಶ {{id}} | परिस्थिती {{id}} | சூழ்நிலை {{id}} |
| `bugReport.emptyError` | Please describe the issue. | कृपया समस्या का वर्णन करें। | ದಯವಿಟ್ಟು ಸಮಸ್ಯೆಯನ್ನು ವಿವರಿಸಿ. | कृपया समस्येचे वर्णन करा. | தயவுசெய்து சிக்கலை விவரிக்கவும். |
| `home.phase0Shell` | Phase 0 shell — authenticated. | फ़ेज़ 0 शेल — प्रमाणित। | ಹಂತ 0 ಶೆಲ್ — ದೃಢೀಕರಿಸಲಾಗಿದೆ. | फेज 0 शेल — प्रमाणित. | கட்டம் 0 ஷெல் — அங்கீகரிக்கப்பட்டது. |
| `home.courses` | Phase 2: Courses | फ़ेज़ 2: कोर्स | ಹಂತ 2: ಕೋರ್ಸ್‌ಗಳು | फेज 2: कोर्स | கட்டம் 2: பாடங்கள் |
| `home.profile` | Phase 2: Profile | फ़ेज़ 2: प्रोफ़ाइल | ಹಂತ 2: ಪ್ರೊಫೈಲ್ | फेज 2: प्रोफाइल | கட்டம் 2: சுயவிவரம் |
| `home.notifications` | Phase 2: Notifications | फ़ेज़ 2: सूचनाएं | ಹಂತ 2: ಅಧಿಸೂಚನೆಗಳು | फेज 2: सूचना | கட்டம் 2: அறிவிப்புகள் |
| `home.simulations` | Phase 3: Simulations | फ़ेज़ 3: सिमुलेशन | ಹಂತ 3: ಸಿಮ್ಯುಲೇಶನ್‌ಗಳು | फेज 3: सिमुलेशन्स | கட்டம் 3: சிமுலேஷன்கள் |
| `home.leaderboard` | Phase 4: Leaderboard | फ़ेज़ 4: लीडरबोर्ड | ಹಂತ 4: ಲೀಡರ್‌ಬೋರ್ಡ್ | फेज 4: लीडरबोर्ड | கட்டம் 4: லீடர்போர்டு |
| `home.achievements` | Phase 4: Achievements | फ़ेज़ 4: उपलब्धियां | ಹಂತ 4: ಸಾಧನೆಗಳು | फेज 4: कामगिरी | கட்டம் 4: சாதனைகள் |
| `home.bugReport` | Phase 4: Report a bug | फ़ेज़ 4: बग की रिपोर्ट करें | ಹಂತ 4: ದೋಷವನ್ನು ವರದಿ ಮಾಡಿ | फेज 4: बगची तक्रार करा | கட்டம் 4: பிழையைப் புகாரளி |
| `home.search` | Phase 4: Search | फ़ेज़ 4: खोजें | ಹಂತ 4: ಹುಡುಕಿ | फेज 4: शोधा | கட்டம் 4: தேடல் |
| `home.reviews` | Phase 4: Reviews | फ़ेज़ 4: समीक्षाएं | ಹಂತ 4: ವಿಮರ್ಶೆಗಳು | फेज 4: पुनरावलोकने | கட்டம் 4: மதிப்பாய்வுகள் |
| `home.callLog` | Phase 4: Call log | फ़ेज़ 4: कॉल लॉग | ಹಂತ 4: ಕಾಲ್ ಲಾಗ್ | फेज 4: कॉल लॉग | கட்டம் 4: அழைப்புப் பதிவு |
| `home.community` | Phase 4: Community | फ़ेज़ 4: समुदाय | ಹಂತ 4: ಸಮುದಾಯ | फेज 4: समुदाय | கட்டம் 4: சமூகம் |
| `home.boxBreathing` | Phase 4: Box breathing | फ़ेज़ 4: बॉक्स ब्रीदिंग | ಹಂತ 4: ಬಾಕ್ಸ್ ಉಸಿರಾಟ | फेज 4: बॉक्स ब्रीदिंग | கட்டம் 4: பாக்ஸ் சுவாசம் |
| `home.cases` | Phase 4: Cases | फ़ेज़ 4: केस | ಹಂತ 4: ಕೇಸ್‌ಗಳು | फेज 4: केसेस | கட்டம் 4: வழக்குகள் |
| `home.scribe` | Phase 1: Scribe recording | फ़ेज़ 1: स्क्राइब रिकॉर्डिंग | ಹಂತ 1: ಸ್ಕ್ರೈಬ್ ರೆಕಾರ್ಡಿಂಗ್ | फेज 1: स्क्राइब रेकॉर्डिंग | கட்டம் 1: ஸ்க்ரைப் பதிவு |
| `home.roleplay` | Phase 1: Roleplay voice | फ़ेज़ 1: रोलप्ले वॉइस | ಹಂತ 1: ರೋಲ್‌ಪ್ಲೇ ಧ್ವನಿ | फेज 1: रोलप्ले व्हॉइस | கட்டம் 1: ரோல்ப்ளே குரல் |
| `roleplayVoice.title` | Roleplay voice | रोलप्ले वॉइस | ರೋಲ್‌ಪ್ಲೇ ಧ್ವನಿ | रोलप्ले व्हॉइस | ரோல்ப்ளே குரல் |
| `roleplayVoice.connect` | Connect | कनेक्ट करें | ಸಂಪರ್ಕಿಸಿ | कनेक्ट करा | இணை |
| `roleplayVoice.connectedToRoom` | Connected to room | रूम से कनेक्ट है | ರೂಮ್‌ಗೆ ಸಂಪರ್ಕಗೊಂಡಿದೆ | रूमशी कनेक्ट आहे | ரூமுடன் இணைக்கப்பட்டது |
| `roleplayVoice.notConnected` | Not connected | कनेक्ट नहीं है | ಸಂಪರ್ಕಗೊಂಡಿಲ್ಲ | कनेक्ट नाही | இணைக்கப்படவில்லை |
| `scribe.title` | Scribe recording (Phase 1) | स्क्राइब रिकॉर्डिंग (फ़ेज़ 1) | ಸ್ಕ್ರೈಬ್ ರೆಕಾರ್ಡಿಂಗ್ (ಹಂತ 1) | स्क्राइब रेकॉर्डिंग (फेज 1) | ஸ்க்ரைப் பதிவு (கட்டம் 1) |
| `scribe.recording` | Recording | रिकॉर्डिंग | ರೆಕಾರ್ಡಿಂಗ್ | रेकॉर्डिंग | பதிவாகிறது |
| `scribe.notRecording` | Not recording | रिकॉर्डिंग नहीं हो रही | ರೆಕಾರ್ಡ್ ಆಗುತ್ತಿಲ್ಲ | रेकॉर्डिंग होत नाही | பதிவாகவில்லை |
| `scribe.socketLabel` | Socket | सॉकेट | ಸಾಕೆಟ್ | सॉकेट | சாக்கெட் |
| `scribe.connected` | connected | कनेक्टेड | ಸಂಪರ್ಕಗೊಂಡಿದೆ | कनेक्टेड | இணைக்கப்பட்டது |
| `scribe.disconnected` | disconnected | डिस्कनेक्टेड | ಸಂಪರ್ಕ ಕಡಿತಗೊಂಡಿದೆ | डिस्कनेक्टेड | துண்டிக்கப்பட்டது |
| `scribe.chunksSent` | Audio chunks sent: {{count}} | भेजे गए ऑडियो चंक: {{count}} | ಕಳುಹಿಸಲಾದ ಆಡಿಯೊ ತುಣುಕುಗಳು: {{count}} | पाठवलेले ऑडिओ चंक: {{count}} | அனுப்பப்பட்ட ஆடியோ துண்டுகள்: {{count}} |
| `scribe.startRecording` | Start recording | रिकॉर्डिंग शुरू करें | ರೆಕಾರ್ಡಿಂಗ್ ಪ್ರಾರಂಭಿಸಿ | रेकॉर्डिंग सुरू करा | பதிவைத் தொடங்கு |
| `scribe.stop` | Stop | रोकें | ನಿಲ್ಲಿಸಿ | थांबवा | நிறுத்து |
| `scribe.testingHint` | Lock the screen or switch apps while recording to verify the foreground service keeps audio chunks flowing — this is the exact failure mode this rewrite exists to fix. | रिकॉर्डिंग के दौरान स्क्रीन लॉक करें या ऐप बदलें, ताकि पुष्टि हो सके कि फ़ोरग्राउंड सर्विस ऑडियो चंक भेजती रहती है — यही वह समस्या है जिसे ठीक करने के लिए यह री-राइट बनाया गया है। | ರೆಕಾರ್ಡಿಂಗ್ ಮಾಡುವಾಗ ಸ್ಕ್ರೀನ್ ಲಾಕ್ ಮಾಡಿ ಅಥವಾ ಆ್ಯಪ್ ಬದಲಾಯಿಸಿ, ಫೋರ್‌ಗ್ರೌಂಡ್ ಸೇವೆ ಆಡಿಯೊ ತುಣುಕುಗಳನ್ನು ಕಳುಹಿಸುತ್ತಲೇ ಇದೆಯೇ ಎಂದು ಪರಿಶೀಲಿಸಲು — ಈ ಪುನರ್‌ರಚನೆಯು ಸರಿಪಡಿಸಲು ಉದ್ದೇಶಿಸಿರುವ ಸಮಸ್ಯೆ ಇದೇ. | रेकॉर्डिंग सुरू असताना स्क्रीन लॉक करा किंवा अ‍ॅप बदला, जेणेकरून फोरग्राउंड सर्व्हिस ऑडिओ चंक पाठवत राहते याची खात्री होईल — हा री-राइट नेमकी हीच समस्या सोडवण्यासाठी आहे. | பதிவு செய்யும்போது திரையைப் பூட்டவும் அல்லது செயலியை மாற்றவும், ஃபோர்கிரவுண்ட் சேவை ஆடியோ துண்டுகளைத் தொடர்ந்து அனுப்புகிறதா என்பதைச் சரிபார்க்க — இந்த மறுஎழுதுதல் சரிசெய்யவே உருவாக்கப்பட்ட சிக்கல் இதுதான். |
| `conferenceListening.title` | Conference call (Phase 1) | कॉन्फ़्रेंस कॉल (फ़ेज़ 1) | ಕಾನ್ಫರೆನ್ಸ್ ಕಾಲ್ (ಹಂತ 1) | कॉन्फरन्स कॉल (फेज 1) | கூட்ட அழைப்பு (கட்டம் 1) |
| `conferenceListening.connecting` | Connecting to call... | कॉल से कनेक्ट हो रहा है... | ಕಾಲ್‌ಗೆ ಸಂಪರ್ಕಿಸಲಾಗುತ್ತಿದೆ... | कॉलशी कनेक्ट होत आहे... | அழைப்புடன் இணைக்கிறது... |
| `conferenceListening.socketLabel` | Socket | सॉकेट | ಸಾಕೆಟ್ | सॉकेट | சாக்கெட் |
| `conferenceListening.connected` | connected | कनेक्टेड | ಸಂಪರ್ಕಗೊಂಡಿದೆ | कनेक्टेड | இணைக்கப்பட்டது |
| `conferenceListening.disconnected` | disconnected | डिस्कनेक्टेड | ಸಂಪರ್ಕ ಕಡಿತಗೊಂಡಿದೆ | डिस्कनेक्टेड | துண்டிக்கப்பட்டது |
| `conferenceListening.waitingForClient` | Waiting for the client to join | क्लाइंट के जुड़ने की प्रतीक्षा की जा रही है | ಕ್ಲೈಂಟ್ ಸೇರಲು ಕಾಯಲಾಗುತ್ತಿದೆ | क्लायंट सामील होण्याची वाट पाहत आहे | வாடிக்கையாளர் இணைவதற்காகக் காத்திருக்கிறது |
| `conferenceListening.clientJoined` | Client joined | क्लाइंट जुड़ गया | ಕ್ಲೈಂಟ್ ಸೇರಿದ್ದಾರೆ | क्लायंट सामील झाले | வாடிக்கையாளர் இணைந்தார் |
| `conferenceListening.audioChunksReceived` | Audio chunks received: {{count}} | प्राप्त ऑडियो चंक: {{count}} | ಸ್ವೀಕರಿಸಿದ ಆಡಿಯೊ ತುಣುಕುಗಳು: {{count}} | मिळालेले ऑडिओ चंक: {{count}} | பெறப்பட்ட ஆடியோ துண்டுகள்: {{count}} |
| `conferenceListening.nudgesReceived` | Nudges received: {{count}} | प्राप्त सुझाव: {{count}} | ಸ್ವೀಕರಿಸಿದ ಸಲಹೆಗಳು: {{count}} | मिळालेल्या सूचना: {{count}} | பெறப்பட்ட பரிந்துரைகள்: {{count}} |
| `conferenceListening.pause` | Pause nudges | सुझाव रोकें | ಸಲಹೆಗಳನ್ನು ವಿರಾಮಗೊಳಿಸಿ | सूचना थांबवा | பரிந்துரைகளை இடைநிறுத்து |
| `conferenceListening.resume` | Resume nudges | सुझाव फिर से शुरू करें | ಸಲಹೆಗಳನ್ನು ಪುನರಾರಂಭಿಸಿ | सूचना पुन्हा सुरू करा | பரிந்துரைகளைத் தொடர் |
| `conferenceListening.endSession` | End session | सत्र समाप्त करें | ಸೆಷನ್ ಕೊನೆಗೊಳಿಸಿ | सत्र थांबवा | அமர்வை முடி |
| `conferenceListening.callEnded` | The call has ended | कॉल समाप्त हो गई है | ಕಾಲ್ ಕೊನೆಗೊಂಡಿದೆ | कॉल संपला आहे | அழைப்பு முடிந்தது |

## "Your debrief" (Debrief agent) (40)

`postSim.debriefCards.*`, added 2026-10-30: one machine translation (gpt-4.1) shared by the web helpline, the React Native app and this app, written to match the words the existing Debrief tab already uses for "debrief" and "Ally" in each language. Needs a native speaker's read like the rest of this page.
