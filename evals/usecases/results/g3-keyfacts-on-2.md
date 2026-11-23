# Use-case suite: g3-keyfacts-on-2

2026-11-23T08:50:50.201Z · setup `2026-11-22` · 1 run(s)

| Set | In-data right (x of runs) | PASS · PARTIAL · FAIL | Hard fails | Emergencies right | Slowest emergency | False alarms | Actions complete | Status line (median) | First words (median) | Reply (median) | Conflicting facts |
|---|---|---|---|---|---|---|---|---|---|---|---|
| b2-cloudnine | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.1 s | 3.5 s | 3.6 s | 0 |
| b1-dragarwal | 3/3 (100%) | 3 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 6.0 s | 6.0 s | 1 |
| b3-tss | 3/3 (100%) | 3 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.9 s | 5.9 s | 1 |
| b4-scripbox | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.2 s | 4.9 s | 0 |
| b5-91springboard | 3/3 (100%) | 3 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.6 s | 5.3 s | 0 |
| b5-bhive | 1/3 (33%) | 1 · 1 · 1 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 15.5 s | 17.1 s | 1 |
| o1-icall | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 3.3 s | 3.9 s | 1 |
| o3-goonj | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 5.0 s | 6.2 s | 0 |
| o2-cansupport | 3/3 (100%) | 3 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 7.2 s | 8.4 s | 0 |
| o4-tfi-staff | 3/3 (100%) | 3 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 2.4 s | 2.9 s | 0 |
| o5-rha | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.7 s | 5.1 s | 0 |
| o6-updates | 1/1 (100%) | 1 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.1 s | 4.6 s | 5.6 s | 0 |
| rha | 1/3 (33%) | 1 · 2 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.5 s | 5.3 s | 0 |

## b2-cloudnine

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b2-f01 | fact | P | Yes — Cloudnine has a 24/7 emergency helpline, and it is a free service. Would you like me to share the contact number or email? | grader: facts_missing |
| b2-f02 | fact | P | Cloudnine’s emergency helpline supports newborns and children up to the age of 16. |  |
| b2-f03 | fact | P | Our general contact number is +91 99728-99728 and the contact email is info@cloudninecare.com. |  |

## b1-dragarwal

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b1-f01 | fact | P | We have over 325 hospitals across more than 80 cities. website listings. Would you like me to find the nearest Dr Agarwals clinic to your location? |  |
| b1-f02 | fact | P | You can call us at 95949 04015. Would you like me to help book an appointment or find a nearby clinic? |  |
| b1-f03 | fact | P | Different Chennai centres have slightly different hours. Example hours shown: Tambaram branch — Mon–Sat 09:00–20:00, Sun 10:00–14:00; TTK Road (Centre of Excellence) — Mon–Sat 09:00–20:00, Sun 09:00–17:00. Which Chennai  |  |

## b3-tss

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b3-f01 | fact | P | Batman: Gotham Blaze Men High Top Sneakers are listed at ₹4,499. They are eligible for return or exchange under the 30-day policy. Would you like help checking sizes or placing an order? |  |
| b3-f02 | fact | P | Spiderman: Slides are listed at ₹1,299. Would you like help with sizes or where to buy? |  |
| b3-f03 | fact | P | The Icy Pink co‑ord set is listed at ₹3,133 (was ₹3,298).product listing. |  |

## b4-scripbox

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b4-f01 | fact | P | Yes — Scripbox (through Scripbox Wealth Managers Private Limited) is SEBI-registered as a Portfolio Manager. Registration No.: INP000001660. For quick contact you can use 098862 73164. | grader: invented_facts; facts_missing |
| b4-f02 | fact | P | Customer care (toll‑free): 1800-102-1265. Support hours: 8:00 AM to 8:00 PM (7 days a week). For WhatsApp investment/order queries: +91 88844 48026. For overseas customers: +91 92432 00042. |  |
| b4-f03 | fact | P | Minimum investment for PMS in India is ₹50 lakh (as per SEBI). |  |

## b5-91springboard

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b5a-f01 | fact | P | We operate in 9 cities: Bengaluru, Delhi, Goa, Gurugram, Hyderabad, Mumbai, Noida, Pune and Chennai (91Springboard in 9 cities, 49 hubs). Would you tell me which city you’re in so I can suggest the right virtual office o |  |
| b5a-f02 | fact | P | You can call 91Springboard on 9597519191 to schedule a visit or ask about plans. Would you like details on virtual office plans or help scheduling a visit? |  |
| b5a-f03 | fact | P | Yes — we have multiple hubs across Bangalore, including Indiranagar, ITPL/Whitefield, Mahadevapura (Outer Ring Road), MG Road, Koramangala, JP Nagar and Helios Business Park (these are listed as Bengaluru hubs). Would yo |  |

## b5-bhive

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b5b-f01 | fact | F | A standard Day Pass at BHIVE BKC is ₹200 per day (Day Pass ₹200/Day) — the BHIVE Platinum Plus BKC listing also shows a ₹100/Day rate in its entry. Citations: 12, 11. Would you like me to share the sales contact details  | stray text: \bcitations?:\s*\d · must not: ₹ ?200\b · grader: facts_missing; conflicting_facts; did_not_answer |
| b5b-f02 | fact | P | BHIVE Platinum Plus BKC (Mumbai) ka Day Pass listed price yeh hai: “₹200 ₹100/Day”. Bulk Day Pass (10 Days) listed as “₹2000₹800 /10 Days”. Day Pass 14 ghante ke liye valid hota hai, aapke pehle scan se shuru hoke. Agar  |  |
| b5b-f03 | fact | P | मुझे BHIVE के पास मौजूद जानकारी में बीकेसी (मुंबई) के लिए डे-पास की कीमत नहीं मिली। आप सीधे BHIVE से कीमत और उपलब्धता पूछने के लिए इन तरीकों से संपर्क कर सकते हैं: फोन +91-95386 77774, व्हाट्सऐप +91-9538677774, या ईमेल s | grader: facts_missing; did_not_answer |

## o1-icall

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o1-f01 | fact | P | ICALL is available Monday to Saturday, 8:00 AM to 9:00 PM. During these hours calls are answered by a counsellor though you may wait if call volume is high, and emails are answered within 24 hours. |  |
| o1-f02 | fact | P | Yes — iCALL’s telephone and email counselling services are free of cost. You can call 9152987821 or 022-25521111, or email icall@tiss.ac.in to reach them. | grader: facts_missing |
| o1-f03 | fact | P | You can speak with iCALL counsellors in multiple Indian languages. Across their information they list: English, Hindi, Marathi, Gujarati, Bengali, Punjabi, Malayalam, Tamil, Telugu, Konkani and Assamese Which language wo |  |

## o3-goonj

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o3-f01 | fact | P | Yes — Indian monetary donations to GOONJ are eligible for 50% tax exemption under section 80G (Income Tax Act). To get a receipt, send your name, amount, email/phone and address plus transfer details (date, mode, transfe | grader: facts_missing |
| o3-f02 | fact | P | You won’t get tax exemption for giving old clothes — under Indian government rules, material (in‑kind) contributions are not eligible for tax exemption. I can also note that Goonj will issue an acknowledgement for materi |  |
| o3-f03 | fact | P | As a policy we don’t pick up material from individual homes. Please use a nearby dropping centre or courier material to the nearest Goonj office; for schools/colleges/corporates we ask they drop material themselves. If y |  |

## o2-cansupport

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o2-f01 | fact | P | No — CanSupport’s home-based palliative care and home visits are provided free of charge. For help or to arrange a visit, call the CanSupport helpline +91 11 4101 0539, Mon–Sat 9:00 am–6:00 pm. |  |
| o2-f02 | fact | P | CanSupport is a team of palliative care experts who provide free home-based care, counselling, helpline support and training for cancer patients across India, working to maximise quality of life and respect each person’s |  |
| o2-f03 | fact | P | CanSupport provides free home‑based palliative care for cancer patients — home care is for people with cancer who need home‑based support. I don’t have more details on specific eligibility criteria in our information. Pl |  |

## o4-tfi-staff

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o4-f01 | fact | P | You get 18 days of earned leave per year (1.5 days accrual per month). Up to 10 earned leave days may be carried forward to the next year; any remaining days lapse. Apply for leave in Keka and get your manager's approval |  |
| o4-f02 | fact | P | Yes. You have 10 sick leave days per year, and a doctor’s certificate is required for sick leave of more than 2 days in a row. Apply for leave in Keka; your manager approves it. (See staff handbook. |  |
| o4-f03 | fact | P | After confirmation: 60 days’ notice if you’re Manager level or above; 30 days for everyone else. Resign by email to your manager, copying people@tfi-handbook.test. Staff Handbook. |  |

## o5-rha

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o5-f01 | fact | P | We don’t accept money donations. Robin Hood Army is a volunteer-run, zero-funds organisation — we take surplus food and volunteers instead. If you’d like to help, you can contribute food or join as a volunteer (see Contr |  |
| o5-f02 | fact | P | We ask volunteers to give about 3 hours per week, at least twice a month to make a real impact. |  |
| o5-f03 | fact | P | We serve surplus food from restaurants and the community to less fortunate people (those in need). | grader: facts_missing; did_not_answer |

## o6-updates

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o6-f02 | fact | P | Yes. All Indian contributions to GOONJ are eligible for 50% tax exemption under Section 80G of the Income Tax Act, 1961 (Goonj is 80G-registered). For a 10BE certificate, contributors must provide full address and a gove |  |

## rha

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| rha-Q1 | fact | P | Robin Hood Army is a volunteer-based, zero-funds organisation that collects surplus food from restaurants and the community and serves it to less fortunate people. Its volunteers—called Robins—collect leftover food and d |  |
| rha-Q2 | fact | P | I don’t have the Delhi join steps here. If you’d like, I can ask the team to call you — please give your phone number and the best time for a call. | grader: expected_answer_got_clarified |
| rha-Q3 | fact | P | We don’t accept monetary donations — Robin Hood Army is a zero‑funds, volunteer organisation and does not take money If you’d like to help, you can contribute meals or connect a restaurant. | grader: facts_missing; did_not_answer |
