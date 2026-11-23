# Onboarding eval — SP1 run 1

**Hard fails: 5** of 13 cases.

| Case | Pages | Facts | Dropped | Industry | Pack | Gaps asked | Deliberate found | To publish | Result |
|---|---|---|---|---|---|---|---|---|---|
| mental-health | 5 | 22 | 0 | mental_health | mental_health | fees, cancellation | 2/2 | 177 s | pass |
| gp-clinic | 4 | 15 | 0 | gp_clinic | medical | emergency, insurance, site_1 | 2/2 | 182 s | pass |
| diagnostic-lab | 4 | 19 | 0 | diagnostic_lab | medical | report_times, home_collection, site_1 | 2/2 | 185 s | pass |
| pharmacy | 3 | 12 | 0 | pharmacy | pharmacy | delivery, prescriptions, site_1 | 2/2 | 179 s | FAIL |
| wellness | – | – | – | – | – | – | 0/2 | – | FAIL |
| d2c | 4 | 14 | 0 | d2c | standard | shipping, returns, site_1 | 2/2 | 186 s | pass |
| coaching | 4 | 11 | 0 | coaching | minors | fees, admissions, site_2 | 2/2 | 161 s | FAIL |
| real-estate | 3 | 11 | 0 | real_estate | standard | site_visits, prices, site_2 | 2/2 | 151 s | FAIL |
| saas | 3 | 8 | 0 | saas | standard | pricing, support_hours, contact | 2/2 | 119 s | pass |
| restaurant | 3 | 11 | 0 | restaurant | standard | reservations, delivery, site_1 | 2/2 | 133 s | pass |
| blocked | 0 | – | – | blocked | – | – | – | – | pass |
| unreachable | 0 | – | – | unreachable | – | – | – | – | pass |
| live-love-laugh | 50 | 231 | 0 | non_profit | mental_health | site_1, site_2 | – | 180 s | FAIL |

## mental-health

- Timings: read 24.3 s, classify_and_gaps 20.0 s, questions 26.6 s, build 27.1 s, checkup 79.4 s, publish 0.1 s, total_to_publish 177.5 s
- Learned by section: {'about': 5, 'policies': 3, 'services': 4, 'team': 3, 'location': 3, 'hours': 1, 'faqs': 3}
- Gap questions: your fees; your cancellation policy
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else
- Q: How do I start with a therapist? → 3 source(s). You can start by calling or emailing us and we’ll arrange a first session with the therapist who fits best. Phone: +91 20 0000 4400. Email: hello@sunrisemind.ex
- Q: What languages do you offer sessions in? → 1 source(s). We offer sessions in English, Hindi, Marathi and Tamil. (Source: Sunrise Mind Clinic information)

Sources:
— Sunrise Mind Clinic — Counselling and therapy in B
- Q: Where is the clinic located? → 1 source(s). Sunrise Mind Clinic is at 2nd floor, Orchid Plaza, Baner Road, Pune 411045. (Source: Contact page)

Sources:
— Contact — Sunrise Mind Clinic, Contact us

## gp-clinic

- Timings: read 10.2 s, classify_and_gaps 19.1 s, questions 33.8 s, build 19.6 s, checkup 99.6 s, publish 0.1 s, total_to_publish 182.4 s
- Learned by section: {'about': 2, 'team': 3, 'location': 3, 'hours': 2, 'policies': 1, 'services': 4}
- Gap questions: what to do in an emergency or after hours; which insurance you accept; your vaccine prices
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else
- Q: What are your consultation fees? → 1 source(s). Our general consultation fee is ₹700. Source: [3].

Sources:
— Services — Lakeview Family Clinic, Services
- Q: When is the clinic open on Sundays? → 1 source(s). The clinic is open on Sundays from 9:00 am to 1:00 pm. (Source: Lakeview Family Clinic hours)

Sources:
— Visit us — Lakeview Family Clinic, Hours
- Q: Do you run diabetes and blood pressure clinics? → 4 source(s). Yes — we run diabetes and blood pressure follow-up clinics. They run every Tuesday and Thursday (follow-up clinics) and our family doctors see long-term conditi

## diagnostic-lab

- Timings: read 12.1 s, classify_and_gaps 21.4 s, questions 26.5 s, build 20.2 s, checkup 104.6 s, publish 0.2 s, total_to_publish 185.0 s
- Learned by section: {'about': 3, 'services': 10, 'policies': 1, 'location': 3, 'hours': 1, 'team': 1}
- Gap questions: how long reports take; whether you collect samples at home; your fees for ECG
- Designs: Answer questions (recommended), Guide people step by step, Bring in customers, Train my team, Something else
- Q: What are your opening hours? → 1 source(s). We’re open every day from 7:00 AM to 9:00 PM. If you’d like to confirm or book a test, you can call +91 22 0000 7788.

Sources:
— Contact — ClearPath Diagnostic
- Q: Where is ClearPath Diagnostics located? → 2 source(s). ClearPath Diagnostics is located in Andheri West, Mumbai. We’re open every day from 7:00 am to 9:00 pm — you can call +91 22 0000 7788 for directions or appoint
- Q: How much is a thyroid profile (T3, T4, TSH)? → 1 source(s). Thyroid profile (T3, T4, TSH) costs ₹600. Would you like to book the test or know about sample preparation?

Sources:
— Tests and prices — ClearPath Diagnostics

## pharmacy

- **Hard fail:** 1 checkup hard fail(s)
- Timings: read 12.1 s, classify_and_gaps 24.5 s, questions 19.7 s, build 20.9 s, checkup 101.9 s, publish 0.0 s, total_to_publish 179.2 s
- Learned by section: {'about': 2, 'services': 6, 'location': 2, 'hours': 1, 'team': 1}
- Gap questions: whether you deliver, and where; how people should send a prescription; your prices for medicines and devices
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else
- Q: What are your opening hours? → 1 source(s). We’re open every day (Monday to Sunday) from 8:00 am to 11:00 pm. Source: GoodHealth Pharmacy store information.

Sources:
— Our store — GoodHealth Pharmacy, Ou
- Q: Where is GoodHealth Pharmacy located? → 2 source(s). GoodHealth Pharmacy is located at BD-14, Sector 1, Salt Lake, Kolkata 700064. Source: Our store (GoodHealth Pharmacy).

Sources:
— Our store — GoodHealth Pharma
- Q: Do you stock blood pressure monitors? → 2 source(s). Yes — we stock blood pressure monitors (BP monitors). Source: GoodHealth Pharmacy listings.

Sources:
— GoodHealth Pharmacy — Your neighbourhood chemist in Salt

## wellness

- **Hard fail:** RuntimeError: builder turn ended without a reply: {'code': 'generic', 'message': 'Something went wrong on our side. Your progress is saved. Try again.'}

## d2c

- Timings: read 16.1 s, classify_and_gaps 23.2 s, questions 42.0 s, build 20.8 s, checkup 83.8 s, publish 0.0 s, total_to_publish 186.0 s
- Learned by section: {'about': 2, 'services': 5, 'team': 2, 'faqs': 2, 'location': 2, 'hours': 1}
- Gap questions: your shipping times and charges; your returns policy; your harvest/pack dates on packaging
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else
- Q: What teas do you sell and what are their prices? → 3 source(s). We sell:
- Assam Breakfast — 250 g: ₹520
- Darjeeling First Flush — 100 g: ₹690
- Masala Chai blend — 250 g: ₹480
- Tasting box of six 25 g teas: ₹799
Every tea
- Q: How should I store my tea to keep it fresh? → 2 source(s). Store tea sealed, away from light and strong smells — it stays fresh for about 12 months. Our teas come in resealable foil pouches you can keep sealed between u
- Q: How can I contact Kesar Teas? → 1 source(s). You can email hello@kesarteas.example or WhatsApp +91 98000 11223 (available weekdays 10:00–18:00). Would you like me to help with product info or prices next?


## coaching

- **Hard fail:** 2 checkup hard fail(s)
- Timings: read 10.1 s, classify_and_gaps 24.2 s, questions 25.4 s, build 31.3 s, checkup 69.3 s, publish 0.1 s, total_to_publish 160.5 s
- Learned by section: {'about': 1, 'services': 3, 'hours': 4, 'location': 3}
- Gap questions: your fees; how admissions work; your weekly test format
- Designs: Bring in customers (recommended), Answer questions, Guide people step by step, Train my team, Something else
- Q: What courses do you offer for Class 11 and 12? → 1 source(s). For Class 11 and 12 we offer:

- JEE coaching: Physics, Chemistry and Maths, six days a week with weekly tests.
- NEET coaching: Physics, Chemistry and Biology,
- Q: When are the morning and evening batches? → 1 source(s). Morning batch is 7:00 to 10:00 am. Evening batch is 5:00 to 8:00 pm. (There is also weekend doubt-clearing on Sunday 10:00 am to 1:00 pm.) Would you like me to 
- Q: What are your office hours? → 1 source(s). Our office hours are Monday to Saturday, 10 am to 7 pm. Would you like help with our courses or batch timings next?

Sources:
— Contact — Bright Minds Academy, 

## real-estate

- **Hard fail:** 1 checkup hard fail(s)
- Timings: read 8.1 s, classify_and_gaps 15.0 s, questions 22.8 s, build 23.1 s, checkup 81.3 s, publish 0.1 s, total_to_publish 150.6 s
- Learned by section: {'about': 2, 'services': 5, 'location': 4}
- Gap questions: how people can arrange a site visit; your price ranges; your current unit availability and booking process
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else
- Q: What apartment types are available at Greenfield Meadows? → 2 source(s). Greenfield Meadows offers 2 BHK homes (1,150 sq ft) and 3 BHK homes (1,540 sq ft). Source:.

Sources:
— Greenfield Meadows — Greenfield Homes, Greenfield Meadow
- Q: What are the sizes of the 2 BHK and 3 BHK? → 1 source(s). 2 BHK: 1,150 sq ft. 3 BHK: 1,540 sq ft. Source: Greenfield Meadows information.
Would you like the possession date or the list of amenities next?

Sources:
— Gr
- Q: When is possession for Greenfield Meadows? → 1 source(s). Possession for Greenfield Meadows is from June 2027. Source:.

Sources:
— Greenfield Homes — 2 and 3 BHK homes in Whitefield, Greenfield Homes

## saas

- Timings: read 8.1 s, classify_and_gaps 13.9 s, questions 24.4 s, build 11.8 s, checkup 60.9 s, publish 0.0 s, total_to_publish 119.2 s
- Learned by section: {'about': 1, 'services': 7}
- Gap questions: your plans and pricing; when your support team is available; how to reach you
- Designs: Answer questions (recommended), Guide people step by step, Bring in customers, Train my team, Something else
- Q: How do I create a new invoice? → 1 source(s). Quick steps to create a new invoice in Ledgerly:
1. Go to Invoices, then choose New invoice.  
2. Add your customer, the items and the tax rates. Ledgerly calcu
- Q: How do I add items and tax rates to an invoice? → 1 source(s). Go to Invoices → New invoice. Add the customer, then add your items and the tax rates for each item. Ledgerly will automatically work out CGST, SGST or IGST bas
- Q: How does Ledgerly calculate CGST/SGST/IGST? → 1 source(s). Ledgerly determines whether to apply CGST+SGST or IGST based on the customer’s state — it works out CGST, SGST or IGST from the customer’s state. To create an i

## restaurant

- Timings: read 8.0 s, classify_and_gaps 10.9 s, questions 29.7 s, build 18.6 s, checkup 65.9 s, publish 0.0 s, total_to_publish 133.3 s
- Learned by section: {'about': 1, 'services': 6, 'hours': 2, 'location': 2}
- Gap questions: how people can reserve a table; whether you deliver, and where; your accepted payment methods
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else
- Q: What are your opening hours? → 1 source(s). We’re open Tuesday–Sunday 12:00–15:30 and 19:00–23:30; closed on Mondays. For reservations, call +91 22 0000 6612. (Source: Visit page)

Sources:
— Visit — Coas
- Q: Are you open on Monday? → 1 source(s). We’re closed on Mondays. We’re open Tuesday to Sunday, 12:00–15:30 and 19:00–23:30. (Source: Coastal Spice Kitchen visit info)

Sources:
— Visit — Coastal Spice
- Q: Where are you located? → 1 source(s). We’re in Bandra West at Ground floor, 17 Chapel Road, Bandra West, Mumbai 400050. Phone: +91 22 0000 6612. We’re open Tuesday–Sunday 12:00–15:30 and 19:00–23:30

## blocked

- Timings: read 2.0 s

## unreachable

- Timings: read 2.0 s

## live-love-laugh

- **Hard fail:** 1 checkup hard fail(s)
- Timings: read 32.4 s, classify_and_gaps 25.3 s, questions 20.3 s, build 23.7 s, checkup 78.4 s, publish 0.1 s, total_to_publish 180.1 s
- Learned by section: {'about': 29, 'services': 60, 'faqs': 23, 'location': 29, 'policies': 38, 'team': 29, 'hours': 21, 'brand': 2}
- Gap questions: your donation process and payment methods; your fees or costs for therapists listed
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else
- Q: When did Counselling Assist start? → 1 source(s). Counselling Assist began in July 2021 (launched as Frontline Assist for healthcare workers during the COVID‑19 pandemic and later expanded to the general public
- Q: How can I find a therapist near me? → 3 source(s). You can use Live Love Laugh’s online therapist directory to find professionals near you — browse the directory, then reach out to the therapist using the email 
- Q: Which helplines are available 24/7? → 0 source(s). I don’t have a list of which helplines run 24/7. The website notes TLLLF does not operate or control the helpline numbers (they’re listed for referral only) and
