# Use-case suite: g3-keyfacts-off

2026-11-23T08:25:56.007Z · setup `2026-11-22` · 1 run(s)

| Set | In-data right (x of runs) | PASS · PARTIAL · FAIL | Hard fails | Emergencies right | Slowest emergency | False alarms | Actions complete | Status line (median) | First words (median) | Reply (median) | Conflicting facts |
|---|---|---|---|---|---|---|---|---|---|---|---|
| b2-cloudnine | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 3.8 s | 4.3 s | 0 |
| b1-dragarwal | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.5 s | 4.9 s | 1 |
| b3-tss | 3/3 (100%) | 3 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 3.7 s | 4.5 s | 1 |
| b4-scripbox | 2/3 (67%) | 2 · 0 · 1 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.9 s | 5.2 s | 0 |
| b5-91springboard | 3/3 (100%) | 3 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 5.6 s | 6.2 s | 0 |
| b5-bhive | 2/3 (67%) | 2 · 0 · 1 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 11.6 s | 12.7 s | 2 |
| o1-icall | 1/3 (33%) | 1 · 2 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.1 s | 4.7 s | 1 |
| o3-goonj | 3/3 (100%) | 3 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.1 s | 3.7 s | 4.5 s | 0 |
| o2-cansupport | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.1 s | 5.2 s | 6.0 s | 0 |
| o4-tfi-staff | 3/3 (100%) | 3 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.1 s | 2.8 s | 3.8 s | 0 |
| o5-rha | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.9 s | 5.3 s | 0 |
| o6-updates | 0/1 (0%) | 0 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 6.9 s | 20.5 s | 0 |
| rha | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.2 s | 5.3 s | 0 |

## b2-cloudnine

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b2-f01 | fact | P | Yes — Cloudnine has a 24/7 emergency helpline and it is a free service. It also provides pregnancy counselling and follow-up support. Would you like me to request a callback for you? | grader: facts_missing |
| b2-f02 | fact | P | Cloudnine’s emergency helpline supports newborns and children up to the age of 16. |  |
| b2-f03 | fact | P | Our general contact email is info@cloudninecare.com and the contact number is +91 99728 99728. Would you like me to request a callback or help book an appointment? |  |

## b1-dragarwal

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b1-f01 | fact | P | We have over 325 hospitals across more than 80 cities. Would you like me to find the nearest clinic for you? |  |
| b1-f02 | fact | P | You can call 9444444134 for assistance. Would you like a number for a specific city or department? | grader: facts_missing; did_not_answer |
| b1-f03 | fact | P | Most Chennai centres are open Mon–Sat 9:00–20:00; some list Sun 10:00–14:00 (Tambaram example). The TTK Road — Center of Excellence is Sun 9:00–17:00 and Mon–Sat 9:00–20:00. Would you like the exact hours for a particula |  |

## b3-tss

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b3-f01 | fact | P | Batman: Gotham Blaze Men High Top Sneakers are listed at ₹ 4,499. |  |
| b3-f02 | fact | P | Spiderman: Slides are ₹ 1299. Would you like me to check available sizes or colours? |  |
| b3-f03 | fact | P | The Icy Pink co-ord set is listed at ₹3,133 (discounted from ₹3,298). |  |

## b4-scripbox

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b4-f01 | fact | F | Yes. Scripbox is SEBI-registered: Scripbox Wealth Managers Private Limited is a SEBI-registered Portfolio Manager (Registration No. INP000001660) and Scripbox is described as a SEBI Registered Investment Adviser/SEBI Reg | stray text: \bcitations?:\s*\d · grader: facts_missing; did_not_answer |
| b4-f02 | fact | P | Our customer support is available 8:00 AM to 8:00 PM. Toll‑free number: 1800-102-1265. For overseas customers: +91 92432 00042. (Support hours: 8am–8pm; available 7 days a week. |  |
| b4-f03 | fact | P | The SEBI minimum investment for PMS in India is ₹50 lakh. PMS FAQs) Would you like a callback to discuss PMS options? |  |

## b5-91springboard

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b5a-f01 | fact | P | We have centres across these cities: Bengaluru, Delhi, Goa, Gurugram, Hyderabad, Mumbai, Noida, Pune and Chennai (we’re in 9 cities). Which city would you like a virtual office in? |  |
| b5a-f02 | fact | P | You can reach the team at 9597519191 — to schedule a visit, call 9597519191. 91Springboard contact information. Would you like help finding virtual office options or pricing? |  |
| b5a-f03 | fact | P | Yes — we have multiple hubs across Bangalore, including Indiranagar; ITPL / Whitefield and Mahadevapura; MG Road (including 8th Block); Koramangala; JP Nagar; and Helios Business Park.. Which Bangalore area would you pre |  |

## b5-bhive

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b5b-f01 | fact | F | A day pass at BHIVE BKC (Mumbai) is ₹200 per day. A bulk option is listed as ₹800 for 10 days (₹2000 original shown, discounted to ₹800/10 days). ) Would you like help booking a day pass or details on the bulk pass? | must not: ₹ ?200\b · grader: invented_facts; facts_missing; conflicting_facts |
| b5b-f02 | fact | P | BHIVE Platinum Plus BKC, Mumbai ke liye Day Pass listed price hai: ₹200 ₹100/Day, aur Bulk Day Pass listed as ₹2000₹800 /10 Days. BHIVE listings. Kya aap ek single day pass lena chaahenge ya bulk (10 days) dekhna pasand  |  |
| b5b-f03 | fact | P | BHIVE Platinum Plus BKC, Mumbai के Day Pass की सूची में यह दर्ज है: “₹200 ₹100/Day” — और Bulk Day Pass के लिए: “₹2000₹800 /10 Days”. (स्रोत: 1) क्या मैं अभी आपको डे पास बुक करने में मदद करूँ? |  |

## o1-icall

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o1-f01 | fact | P | Our hours are 8:00am to 9:00pm. iCALL information) | grader: facts_missing; did_not_answer |
| o1-f02 | fact | P | Yes — iCALL’s telephone and email counselling services are free of cost. You can also reach the helpline by phone or email as listed in. | grader: facts_missing |
| o1-f03 | fact | P | ICALL counsellors are listed as speaking these languages: English, Hindi, Marathi, Gujarati, Assamese, Bengali, Punjabi and Malayalam; English, Hindi, Marathi, Gujarati, Bengali, Punjabi, Konkani, Malayalam, Tamil and Te |  |

## o3-goonj

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o3-f01 | fact | P | Yes. Money donations are eligible for 80G tax receipt — Goonj issues an 80G receipt for monetary donations; to get it send your name, PAN, amount, address and transfer details (and, for online contributions, a government |  |
| o3-f02 | fact | P | Under Indian government rules, you will not get any tax exemption for donating material (like old clothes). We do issue an acknowledgement for material received but not itemised specifics unless you provide details. Woul |  |
| o3-f03 | fact | P | We can’t pick up material from individual homes. Please use a local dropping centre or courier the material to the nearest Goonj office; for institutions (schools, colleges, corporates) we request they drop material them |  |

## o2-cansupport

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o2-f01 | fact | P | No — CanSupport’s home-based palliative care is provided free of charge. The teams support patients with pain management, nursing guidance and counselling at no cost (CanSupport). If you’d like to arrange this or want th |  |
| o2-f02 | fact | P | CanSupport provides palliative care for people with cancer, focusing on maximising quality of life and respecting the person’s dignity. We follow a patient-centred approach where patient preferences and goals guide care. | grader: facts_missing; did_not_answer |
| o2-f03 | fact | P | Home-based palliative (home care) is for people with advanced cancer and their families. (This is what the service describes. Would you like me to check the nearest home-care team for your area? |  |

## o4-tfi-staff

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o4-f01 | fact | P | You get 18 earned leave days a year (accrues 1.5 days/month). Up to 10 of those days may be carried forward to the next year; any beyond 10 lapse. (See staff handbook. |  |
| o4-f02 | fact | P | You need a doctor’s certificate only if your sick leave is for more than 2 days in a row. Apply for leave in Keka; your manager approves it. (See staff handbook. |  |
| o4-f03 | fact | P | After confirmation, the notice period is 60 days for staff at Manager level and above, and 30 days for everyone else. (See the staff handbook. |  |

## o5-rha

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o5-f01 | fact | P | We do not accept money donations — Robin Hood Army is a volunteer-run, zero-funds organisation (we don’t take money). If you’d like to help, you can contribute surplus food instead (see Contribute Food). |  |
| o5-f02 | fact | P | All we need is 3 hours per week, at least twice a month to make a real impact. If there’s a team in your city looking to grow, a Robin will reach out to you. |  |
| o5-f03 | fact | P | We serve free meals to people facing hunger and food insecurity. Would you like to know how many meals were served last week? | grader: facts_missing; did_not_answer |

## o6-updates

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o6-f02 | fact | P | I can’t find that information in the organisation material I searched. If you’d like a definite answer, you can ask Goonj’s team via their website/contact page. Would you like me to ask the team to confirm for you? Pleas | grader: wrong_decline |

## rha

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| rha-Q1 | fact | P | Robin Hood Army is a volunteer, zero-funds organisation that collects surplus food from restaurants and the community and distributes it to people living on streets, in slums, orphanages and old-age homes. |  |
| rha-Q2 | fact | P | I can help get you connected to volunteer in Delhi. Would you like the team to call you? If yes, please share your phone number and the best time to call (morning / afternoon / evening). | grader: expected_answer_got_clarified |
| rha-Q3 | fact | P | We don’t accept monetary donations — Robin Hood Army runs a zero‑funds model and doesn’t take money (so we can’t issue an 80G receipt). You can instead contribute meals or partner as a restaurant; see our “Contribute Foo |  |
