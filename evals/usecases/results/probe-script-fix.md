# Use-case suite: probe-script-fix

2026-11-23T07:57:27.425Z · setup `2026-11-22` · 1 run(s)

| Set | In-data right (x of runs) | PASS · PARTIAL · FAIL | Hard fails | Emergencies right | Slowest emergency | False alarms | Actions complete | Status line (median) | First words (median) | Reply (median) | Conflicting facts |
|---|---|---|---|---|---|---|---|---|---|---|---|
| b2-cloudnine | 0/0 (–) | 0 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | – | – | – | 0 |
| b4-scripbox | 0/0 (–) | 0 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | – | – | – | 0 |
| b1-dragarwal | 0/1 (0%) | 0 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.1 s | 3.8 s | 6.9 s | 1 |
| b5-bhive | 0/0 (–) | 0 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | – | – | – | 0 |
| b5-91springboard | 0/2 (0%) | 0 · 2 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 12.7 s | 14.2 s | 0 |
| b3-tss | 0/2 (0%) | 0 · 2 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 13.8 s | 15.3 s | 0 |
| o2-cansupport | 1/1 (100%) | 1 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 6.6 s | 7.7 s | 0 |
| o4-tfi-staff | 0/0 (–) | 0 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | – | – | – | 0 |
| o1-icall | 2/2 (100%) | 2 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 6.0 s | 7.1 s | 1 |
| o6-updates | 0/0 (–) | 0 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | – | – | – | 0 |
| o3-goonj | 0/2 (0%) | 0 · 2 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 7.0 s | 7.6 s | 0 |
| o5-rha | 2/4 (50%) | 2 · 2 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 5.9 s | 6.7 s | 0 |
| rha | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 7.4 s | 8.8 s | 0 |

## b2-cloudnine

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|

## b4-scripbox

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|

## b1-dragarwal

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b1-f10 | fact | P | Hamare general enquiries ka contact number: 9594924026. (Main madad aur appointments mein madad kar sakta hoon. | grader: facts_missing; conflicting_facts |

## b5-bhive

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|

## b5-91springboard

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b5a-f09 | fact | P | Day pass ka price har hub ke liye alag hota hai — har hub ka price jaanne ke liye team se puchhna padta hai. Price list. Kaunsa hub chahenge aap? | grader: expected_answer_got_clarified |
| b5a-f10 | fact | P | Nehru Place hub ke liye hamare paas dedicated desk ka exact rate listed nahin hai. Price list sirf services ka zikr karti hai (Day pass, hot desk, dedicated desk, private cabin, meeting room) aur har hub ke liye team se  | grader: facts_missing; did_not_answer |

## b3-tss

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b3-f08 | fact | P | माफ़ कीजिए — मेरे पास ‘बैटमैन हाई-टॉप स्नीकर्स’ की कीमत का कोई जानकारी उपलब्ध नहीं है। कृपया The Souled Store की वेबसाइट पर प्रोडक्ट पेज देखें या उनकी कस्टमर सपोर्ट टीम से पूछें। मैं अन्य किसी प्रोडक्ट की उपलब्ध जानकारी  | grader: wrong_decline |
| b3-f09 | fact | P | मुझे हमारी जानकारी में डिलीवरी में लगने वाले दिनों का विवरण नहीं मिला। डिलीवरी समय जानने के लिए कृपया ग्राहक सहायता को लिखें: grievanceofficer@thesouledstore.com (स्रोत नीचे)। अगर आप अपना ऑर्डर नंबर यहाँ देंगे तो मैं आपक | grader: facts_missing; did_not_answer |

## o2-cansupport

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o2-f09 | fact | P | हम दिल्ली, हरियाणा, पंजाब, उत्तर प्रदेश, झारखंड, हिमाचल प्रदेश और महाराष्ट्र (पुणे) में काम करते हैं। (पंजाब में 6 होम केयर टीमें और 2 आउटपेशेंट क्लिनिक — अमृतसर, बठिंडा, मानसा और पटियाला)। |  |

## o4-tfi-staff

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|

## o1-icall

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o1-f08 | fact | P | हाँ, आप हिंदी में बात कर सकती हैं। आप iCALL को कॉल कर सकती हैं: 9152987821. सेवा के घंटे सुबह 10 बजे से रात 8 बजे तक हैं। (स्रोत: iCALL) |  |
| o1-f09 | fact | P | नहीं—iCALL आमने-सामने (face-to-face) काउंसलिंग नहीं देता। हमारी सेवाएँ चैट, हेल्पलाइन और ईमेल के माध्यम से उपलब्ध हैं; हम पास के फे्स‑टू‑फे्स प्रोफेशनल्स का एक क्राउडसोर्स्ड रेफरल‑लिस्ट देते हैं। (स्रोत:) अगर आप बात करना |  |

## o6-updates

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|

## o3-goonj

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o3-f09 | fact | P | Goonj का Paid Urban Internship 3 महीने का होता है, और यह पेड (स्टाइपेंड) इंटरनशिप है। क्या आप आवेदन करने में मदद चाहेंगे? | grader: facts_missing |
| o3-f10 | fact | P | Maine Goonj ke Delhi pages dekhe, lekin wahan visiting hours (centre ka time) nahin diya gaya. Our Offices; Dropping Centers. Kya chahenge ki main aapka message team ko bhej doon taaki woh visiting hours bata saken? | grader: expected_answer_got_clarified |

## o5-rha

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o5-f05 | fact | P | नहीं — Robin Hood Army एक "zero‑funds" स्वयंसेवी संगठन है और "No money involved" कहता है, इसलिए दान स्वीकार नहीं करता (यहाँ से: Join Us और About पृष्ठ)। अगर आप आगे बात करना चाहें तो info@robinhoodarmy.com पर संपर्क कर सक | grader: facts_missing; did_not_answer |
| o5-f06 | fact | P | हमें प्रति सप्ताह कम से कम 3 घंटे, और महीने में कम से कम दो बार देना होता है — इससे असल प्रभाव पड़ता है। अगर आपके शहर में टीम बढ़ाने की जरूरत होगी तो वहाँ का Robin आपसे संपर्क करेगा। |  |
| o5-f08 | fact | P | Nahi — Robin Hood Army volunteer-run, zero-funds organisation hai; join karne ke liye koi fees nahi hoti. Join the Robin Hood Army) | grader: invented_facts |
| o5-f10 | fact | P | না—আমরা একটি স্বেচ্ছাসেবী, জিরো-ফান্ডস (টাকা নেই) সংগঠন; সেখানে অর্থ নেয়া হয় না (No money involved). আরও জানতে চান? এখানে ইমেইল করুন: info@robinhoodarmy.com। |  |

## rha

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| rha-L1 | fact | P | बढ़िया — दिल्ली में वॉलंटियर बनने के लिए Robin Hood Army के लोकल चैप्टर्स से जुड़कर आप Robins के साथ मिलकर फूड कलेक्शन और वितरण करते हैं; यह पूरी तरह वॉलंटियर-रन और बिना फंड वाला अभियान है (कोई पैसा नहीं लगता). दिल्ली मे |  |
| rha-L2 | fact | P | நன்றி — நீங்கள் சென்னையில் உள்ள உங்கள் உணவகத்தில் மீதமுள்ள உணவை நன்கொடுக்க Robin Hood Army உடன் சேர்வதற்கு எளிது. Robin Hood Army பதிவுசெய்த రెஸ்டாரண்டுகள், விருப்பமுள்ள நிகழ்வுகள் மற்றும் சமையற்கூடத்திலிருந்து மேலதிக உண |  |
| rha-L3 | fact | P | Nahin — Robin Hood Army ek volunteer-run, “zero-funds” organisation hai; hum paise nahin lete (No money involved). 80G ke baare mein humare paas koi jankari nahi hai; iske liye aap team se poochh sakte hain: info@robinho | grader: invented_facts; facts_missing; did_not_answer |
