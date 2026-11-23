# Use-case suite: g3-keyfacts-on

2026-11-23T08:31:15.136Z · setup `2026-11-22` · 1 run(s)

| Set | In-data right (x of runs) | PASS · PARTIAL · FAIL | Hard fails | Emergencies right | Slowest emergency | False alarms | Actions complete | Status line (median) | First words (median) | Reply (median) | Conflicting facts |
|---|---|---|---|---|---|---|---|---|---|---|---|
| b2-cloudnine | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.3 s | 4.8 s | 1 |
| b1-dragarwal | 3/3 (100%) | 3 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 3.0 s | 3.4 s | 1 |
| b3-tss | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.9 s | 5.6 s | 0 |
| b4-scripbox | 0/3 (0%) | 0 · 3 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 2.7 s | 3.6 s | 0 |
| b5-91springboard | 1/3 (33%) | 1 · 2 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 5.0 s | 6.4 s | 0 |
| b5-bhive | 0/3 (0%) | 0 · 3 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 6.9 s | 9.2 s | 2 |
| o1-icall | 1/3 (33%) | 1 · 2 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.5 s | 5.4 s | 1 |
| o3-goonj | 1/3 (33%) | 1 · 2 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 4.3 s | 5.3 s | 0 |
| o2-cansupport | 0/3 (0%) | 0 · 3 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 5.7 s | 6.7 s | 0 |
| o4-tfi-staff | 3/3 (100%) | 3 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 3.1 s | 3.9 s | 0 |
| o5-rha | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 3.8 s | 4.4 s | 0 |
| o6-updates | 0/1 (0%) | 0 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 3.3 s | 4.1 s | 0 |
| rha | 2/3 (67%) | 2 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/0 | 0.0 s | 5.0 s | 5.7 s | 0 |

## b2-cloudnine

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b2-f01 | fact | P | Yes — Cloudnine has a 24/7 emergency helpline for mother and child, and it is a free service. It also provides pregnancy counselling and follow-up support. You can reach them at +91 99728-99728 if you’d like to call now. | grader: facts_missing; conflicting_facts |
| b2-f02 | fact | P | Cloudnine’s emergency helpline supports newborns and children up to the age of 16. Would you like the helpline number or a callback? |  |
| b2-f03 | fact | P | Our general contact number is +91 99728-99728 and the contact email is info@cloudninecare.com. |  |

## b1-dragarwal

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b1-f01 | fact | P | We have 325+ hospitals across 80+ cities. Would you like me to find the nearest clinic for you? |  |
| b1-f02 | fact | P | You can call us at 95949 04015. website) |  |
| b1-f03 | fact | P | Some Chennai centres run Mon–Sat 09:00–20:00 and Sun 10:00–14:00 (Tambaram is an example). The TTK Road Centre of Excellence runs Mon–Sat 09:00–20:00 and Sun 09:00–17:00. Would you like me to find the exact hours for a s |  |

## b3-tss

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b3-f01 | fact | P | The Batman: Gotham Blaze Men High Top Sneakers are listed at ₹4,499 product listing). If you want a different men’s high-top style, some are listed at ₹3,999. Would you like me to check availability or sizes for the Batm |  |
| b3-f02 | fact | P | The Spiderman: Slides are ₹ 1,299. They’re eligible for our 30-day return/exchange policy. | grader: invented_facts |
| b3-f03 | fact | P | The Icy Pink co‑ord set is listed at ₹3,133 (was ₹3,298). |  |

## b4-scripbox

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b4-f01 | fact | P | Yes. Scripbox offers SEBI‑registered portfolio management through Scripbox Wealth Managers Private Limited — Registration No. INP000001660. Would you like the team to confirm details or help with anything else? | grader: invented_facts; facts_missing |
| b4-f02 | fact | P | Our customer support is available 8:00 AM to 8:00 PM, 7 days a week (by phone, email and chat). Toll‑free (India): 1800-102-1265. For overseas customers: +91 92432 00042. For WhatsApp (investment/product queries): +91 88 | grader: invented_facts |
| b4-f03 | fact | P | Minimum investment for Portfolio Management Services (PMS) in India is ₹50 lakh (as per SEBI regulations). Scripbox does offer PMS; to start or get exact onboarding steps, please contact customer support at 1800-102-1265 | grader: invented_facts |

## b5-91springboard

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b5a-f01 | fact | P | We operate in nine cities: Bengaluru, Delhi, Goa, Gurugram, Hyderabad, Mumbai, Noida, Pune and Chennai. We have 49 hubs across these cities. Would you like details for any one city or a particular hub? | grader: invented_facts |
| b5a-f02 | fact | P | You can schedule a visit or reach the team at 9597519191. (Call to schedule a visit. Would you like me to help find virtual office options in a specific city? |  |
| b5a-f03 | fact | P | Yes — we have multiple hubs across Bengaluru. Hubs are listed in Indiranagar, ITPL (Whitefield) / Mahadevapura, MG Road (8th Block), Koramangala, JP Nagar, Outer Ring Road and Helios Business Park (Bengaluru). ) If you’d | grader: invented_facts |

## b5-bhive

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b5b-f01 | fact | P | A Day Pass at BHIVE Platinum Plus BKC, Mumbai is listed as ₹200 per day (the page also shows a ₹100/day listing in that same entry); bulk 10-day passes are shown as ₹2000 with an ₹800 /10 Days option. See the BHIVE Day P | must not: ₹ ?200\b |
| b5b-f02 | fact | P | BHIVE Platinum Plus, BKC Mumbai ke liye Day Pass: ₹200 (₹100/Day) aur Bulk 10-day Pass: ₹2000 (₹800/10 Days). price list. Agar aap chahen, main aapko sales team se connect karne ke tarike bata doon: phone +91-95386 77774 | grader: invented_facts; conflicting_facts |
| b5b-f03 | fact | P | BHIVE Platinum Plus, BKC (Mumbai) के लिए Day Pass की कीमत: ₹200 (ऑफ़र/कम: ₹100/Day)। Bulk 10-Day Pass: ₹2000 (ऑफ़र/कम: ₹800 /10 Days)। (सूत्र:) अगर आप चाहें तो मैं सेल्स टीम का नंबर या WhatsApp भेज दूँ ताकि आप बुक करने य | grader: invented_facts |

## o1-icall

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o1-f01 | fact | P | We’re available Monday to Saturday, 8:00 AM to 9:00 PM. (iCALL helpline hours. You can call 9152987821 or 022-25521111, or email icall@tiss.ac.in (they say they’ll respond within 24 hours). | grader: invented_facts |
| o1-f02 | fact | P | Yes — iCALL’s telephone and email counselling services are free of cost.. If you’d like to reach them, the helpline number is 9152987821 and the email is icall@tiss.ac.in.. | grader: invented_facts; facts_missing |
| o1-f03 | fact | P | You can speak with iCALL counsellors in several Indian languages. They list: English, Hindi, Marathi, Gujarati, Assamese, Bengali, Punjabi, Malayalam, Konkani, Tamil and Telugu. |  |

## o3-goonj

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o3-f01 | fact | P | Yes. All Indian monetary contributions to GOONJ are eligible for 50% tax exemption under section 80G, and you can get a receipt for your donation. To receive the receipt, send your donation details (name, amount, address | stray text: \bcitations?:\s*\d |
| o3-f02 | fact | P | No — under Indian government rules you won’t get tax exemption on material contributions such as old clothes. (See our FAQ. If you need a tax receipt for a cash donation, Indian donations to GOONJ are eligible for 50% ta | grader: invented_facts |
| o3-f03 | fact | P | As a policy we don’t pick up material from individual homes; please use a Goonj dropping centre or courier material to the nearest Goonj office. For institutions, we ask they drop material themselves. If you can pay for  |  |

## o2-cansupport

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o2-f01 | fact | P | No — CanSupport’s home‑based palliative care and related home visits are provided free. (CanSupport provides free home‑based care, counselling, helpline support and training for cancer patients across India. If you want  | grader: invented_facts |
| o2-f02 | fact | P | CanSupport is a team of palliative care experts who provide free home-based care, counselling, helpline support and training for cancer patients across India, working to maximise quality of life while respecting each per | grader: invented_facts |
| o2-f03 | fact | P | CanSupport provides free home-based (home care) palliative care for cancer patients. I don’t have details here about specific eligibility criteria. Please call the National Palliative Care ‘Saath Saath’ helpline on 1800  | grader: invented_facts |

## o4-tfi-staff

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o4-f01 | fact | P | You get 18 days of earned leave per year (1.5 days accrue each month). You may carry forward up to 10 earned leave days to the next leave year; any balance beyond 10 lapses. For planned leave of 3 or more days, apply at  |  |
| o4-f02 | fact | P | You need a doctor’s certificate only if your sick leave is more than 2 days in a row. Apply for leave in Keka and get your manager’s approval as usual. Next step: if you expect to be off for 3+ days, upload the doctor’s  |  |
| o4-f03 | fact | P | After confirmation the notice period is 60 days for Manager level and above, and 30 days for everyone else. To resign, send an email to your manager and copy people@tfi-handbook.test. (Also: full and final is paid within |  |

## o5-rha

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o5-f01 | fact | P | No — Robin Hood Army is a volunteer-run, zero-funds organisation and does not accept money donations. You can contribute surplus food or join as a volunteer instead. |  |
| o5-f02 | fact | P | We ask volunteers for about 3 hours per week, at least twice a month to make a real impact. If there’s a team in your city looking to grow, a local Robin will reach out to you. |  |
| o5-f03 | fact | P | We serve surplus food from restaurants and the community to less fortunate people. Would you like to know how we collect food or how to volunteer? | grader: facts_missing; did_not_answer |

## o6-updates

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o6-f02 | fact | P | Yes. All Indian contributions to GOONJ are eligible for 50% tax exemption under section 80G of the Income Tax Act, 1961. For donors to get the certificate (Form 10BE) you must provide a complete address and a government- | grader: invented_facts |

## rha

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| rha-Q1 | fact | P | The Robin Hood Army is a volunteer-based, zero-funds organisation whose volunteers (“Robins”) collect surplus food from restaurants and the community and distribute it to people living on the streets, in slums, orphanage |  |
| rha-Q2 | fact | P | To volunteer in Delhi: Robin Hood Army asks volunteers to give about 3 hours/week, at least twice a month. For Delhi-specific joining steps, see the Delhi city page. | grader: invented_facts; facts_missing; did_not_answer |
| rha-Q3 | fact | P | Thanks — we don’t accept donations. The Robin Hood Army is a zero-funds organisation and does not take money (so we cannot issue an 80G receipt). You can instead contribute food if you wish; see the Contribute Food page  |  |
