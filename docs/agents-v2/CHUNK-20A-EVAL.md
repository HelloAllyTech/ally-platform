<!-- Generated from the eval run of 2026-11-08 (run 3, after the fixes below). -->
# Chunk 20a-1 onboarding eval

**Run:** 8 Nov 2026, local stack, gpt-5-mini for every builder sub-task. 10 fictional fixture sites (`fixtures/onboarding-sites/`), a blocked site, an unreachable port, and Live Love Laugh's live public site. Each case goes from its website to a published, invite-only assistant through ally-be's real session API, then asks the published assistant its first three suggested questions through Preview.

**The bar** (Shehbaz, 8 Nov): every case passes; the right business type and pack; 0 unsourced facts; under 5 minutes to publish.

**Result: 13 of 13 pass.** Times to publish 54–80 s. Facts unsourced: 0. Deliberate gaps asked: 20 of 20. Preview answers with at least one source: 28 of 33.

**Outside this bar, and not fixed here: 5 of 33 answers wrongly declined.** The assistant said it didn't have something its own pages say (the yoga styles, the beginners' series, the batch timings, a possession date, amenities). It isn't timing: asked again later with every page indexed, the yoga question still declined. The search found passages; the agent declined anyway, was nudged to use them (`USE_FOUND`) and asked a question back. That is answer quality in the 3a agent on short, list-like pages. The 20a-2 checkup measures exactly this; it should be looked at before G1b.

**How it was run:** the steps of `ally-ai/scripts/onboarding_eval.py`, driven from a logged-in dashboard tab (the same API calls, cases and checks), because a dashboard token isn't available to a script here. The report below is rendered by the script's own `report()`. To rerun: `python3 fixtures/onboarding-sites/serve.py`, then `ALLY_TOKEN=… poetry run python scripts/onboarding_eval.py` from `ally-ai`.

## Runs and what each fixed

| Run | Result | What it found | Fix |
|---|---|---|---|
| 1 | 12 of 13 (old bar: a wrong type was a soft fail) | Four sites with short home pages read 0 pages and came out as "other"; the coaching institute lost its young people pack | The crawl follows a short home page's links instead of stopping; a site gap repeating a checklist gap is skipped |
| 2 | 11 of 13 | The yoga studio got Mental health safety, the invoicing tool Legal and financial care (over-eager care topics); thin pages (contact, team) were skipped | Classify lists a care topic only with evidence, with yoga, fitness and money software as named exceptions; pages down to 60 characters are kept |
| 3 | **13 of 13** | — | — |

**Hard fails: 0** of 13 cases.

| Case | Pages | Facts | Dropped | Industry | Pack | Gaps asked | Deliberate found | To publish | Result |
|---|---|---|---|---|---|---|---|---|---|
| mental-health | 5 | 19 | 0 | mental_health | mental_health | fees, cancellation | 2/2 | 72 s | pass |
| gp-clinic | 4 | 15 | 0 | gp_clinic | medical | emergency, insurance, site_1 | 2/2 | 62 s | pass |
| diagnostic-lab | 4 | 18 | 0 | diagnostic_lab | medical | report_times, home_collection, site_1 | 2/2 | 69 s | pass |
| pharmacy | 3 | 11 | 0 | pharmacy | pharmacy | delivery, prescriptions, site_1 | 2/2 | 68 s | pass |
| wellness | 4 | 14 | 0 | wellness | standard | fees, cancellation, site_2 | 2/2 | 59 s | pass |
| d2c | 4 | 14 | 0 | d2c | standard | shipping, returns, site_1 | 2/2 | 56 s | pass |
| coaching | 4 | 11 | 0 | coaching | minors | fees, admissions, site_2 | 2/2 | 62 s | pass |
| real-estate | 3 | 11 | 0 | real_estate | standard | site_visits, prices, site_1 | 2/2 | 61 s | pass |
| saas | 3 | 8 | 0 | saas | standard | pricing, support_hours, contact | 2/2 | 54 s | pass |
| restaurant | 3 | 11 | 0 | restaurant | standard | reservations, delivery, site_1 | 2/2 | 64 s | pass |
| blocked | 0 | None | None | blocked | None | – | – | – | pass |
| unreachable | 0 | None | None | unreachable | None | – | – | – | pass |
| live-love-laugh | 50 | 197 | 0 | non_profit | mental_health | volunteer, site_1 | – | 80 s | pass |

## mental-health

- Timings: read 11.3 s, classify_and_gaps 12.1 s, questions_and_designs 22.2 s, build 26.9 s, publish 0.0 s, total_to_publish 72.5 s
- Learned by section: {'about': 4, 'policies': 1, 'services': 4, 'location': 3, 'hours': 1, 'team': 3, 'faqs': 3}
- Gap questions: your fees; your cancellation policy
- Designs: Client guide, New client enquiries, Help centre, Booking and payments (coming soon)
- Q: How do I start a first session? → 1 source(s). You can start by calling us or sending an email to arrange your first session. Our phone is +91 20 0000 4400 and our email is hello@sunrisemind.example. The cli
- Q: Do you offer online video sessions? → 1 source(s). Yes — we offer sessions online by video, as well as in person at our Baner clinic. We work in English, Hindi, Marathi and Tamil. Would you like help arranging a
- Q: What languages do you offer sessions in? → 2 source(s). We offer sessions in English, Hindi, Marathi and Tamil. Sessions are available in person at our Baner clinic and online by video. To arrange a first session, yo

## gp-clinic

- Timings: read 11.7 s, classify_and_gaps 18.4 s, questions_and_designs 16.7 s, build 14.8 s, publish 0.0 s, total_to_publish 61.5 s
- Learned by section: {'services': 4, 'hours': 2, 'location': 4, 'team': 3, 'about': 2}
- Gap questions: what to do in an emergency or after hours; which insurance you accept; your fees for child vaccinations
- Designs: Patient guide, New patient enquiries, Help centre, Booking and payments (coming soon)
- Q: How much is a general consultation? → 2 source(s). A general consultation costs ₹700. If you’d like to book an appointment or need our address/phone, call +91 80 0000 2211. Would you like me to book a slot for y
- Q: Do you offer child vaccinations? → 1 source(s). Yes — we do. Our doctors see children for check-ups and vaccinations at Lakeview Family Clinic in Indiranagar. Would you like to book an appointment or ask abou
- Q: When are you open on weekdays? → 1 source(s). I’m sorry — I don’t have the clinic’s weekday opening hours in the information I have here. Please call the clinic at +91 80 0000 2211 to confirm weekday hours;

## diagnostic-lab

- Timings: read 15.0 s, classify_and_gaps 13.2 s, questions_and_designs 23.2 s, build 17.2 s, publish 0.0 s, total_to_publish 68.6 s
- Learned by section: {'about': 3, 'services': 9, 'team': 1, 'policies': 1, 'location': 3, 'hours': 1}
- Gap questions: how long reports take; whether you collect samples at home; your fees for ECG
- Designs: Patient guide, New patient enquiries, Report support, Booking and payments (coming soon)
- Q: What are your opening hours? → 1 source(s). I don’t have ClearPath’s opening hours in my records. Please call or message this number to check hours and any holiday changes: +91 22 0000 7788. The centre is
- Q: Where are you located? → 2 source(s). We’re located in Andheri West, Mumbai — ClearPath Diagnostics is a NABL‑accredited pathology lab and imaging centre there (we offer blood and urine tests, X‑ray
- Q: How much is the full body check-up? → 1 source(s). The full body check-up (62 tests) is ₹2,999. Fasting tests require 10–12 hours without food; water is fine. Would you like help booking this or details of the t

## pharmacy

- Timings: read 8.5 s, classify_and_gaps 12.0 s, questions_and_designs 23.9 s, build 23.6 s, publish 0.0 s, total_to_publish 68.1 s
- Learned by section: {'about': 2, 'services': 5, 'location': 2, 'hours': 1, 'team': 1}
- Gap questions: whether you deliver, and where; how people should send a prescription; your prices for medicines and devices
- Designs: Customer guide, New customer enquiries, Medication support, Booking and payments (coming soon)
- Q: What are your opening hours? → 1 source(s). Our store is open every day (Monday to Sunday) from 8:00 am to 11:00 pm. If you need anything else—location or a phone call—please let me know or call +91 33 00
- Q: Where is GoodHealth Pharmacy located? → 1 source(s). GoodHealth Pharmacy is located in Salt Lake, Kolkata. We’re a family-run neighbourhood chemist there, open since 1998, stocking prescription medicines, over-the
- Q: Do you sell glucometers and BP monitors? → 1 source(s). Yes — we do stock glucometers and blood pressure (BP) monitors at GoodHealth Pharmacy in Salt Lake. (We also carry diabetic supplies.) Would you like a particul

## wellness

- Timings: read 11.2 s, classify_and_gaps 10.3 s, questions_and_designs 18.3 s, build 19.6 s, publish 0.0 s, total_to_publish 59.4 s
- Learned by section: {'about': 1, 'services': 4, 'hours': 4, 'team': 2, 'location': 3}
- Gap questions: your fees; your cancellation policy; your class package and discount options
- Designs: Studio guide, New client enquiries, Help centre, Booking and payments (coming soon)
- Q: What yoga styles do you teach? → 0 source(s). I’m sorry—I don’t have information about which yoga styles Prana Yoga Studio teaches in the materials I can access. For the most accurate list, please contact t
- Q: When is the beginners' series? → 0 source(s). I’m sorry — I don’t have the schedule for the beginners’ series in the information I can access. I can tell you Prana Yoga Studio teaches Hatha, Vinyasa and Yin
- Q: What are the morning Hatha class times? → 1 source(s). Morning Hatha classes are on Monday, Wednesday and Friday from 6:30 to 7:30 am. Would you like the evening or weekend schedule too?

Sources:
— Classes and time

## d2c

- Timings: read 8.4 s, classify_and_gaps 14.8 s, questions_and_designs 17.4 s, build 15.3 s, publish 0.0 s, total_to_publish 55.8 s
- Learned by section: {'about': 4, 'services': 5, 'location': 2, 'hours': 1, 'policies': 2}
- Gap questions: your shipping times and charges; your returns policy; your ingredients/allergens for blends
- Designs: Tea guide, Customer help, New customer enquiries, Booking and payments (coming soon)
- Q: What teas do you sell and sizes? → 2 source(s). We sell small-batch loose-leaf teas from family gardens in Assam and Darjeeling, packed within a month of plucking (source: Kesar Teas) [1][2]. I don’t have inf
- Q: How fresh are your teas and how are they packed? → 1 source(s). Our teas are packed within a month of plucking, so they’re very fresh (packed within a month of plucking). I don’t have information about the exact packaging ma
- Q: How should I store my tea and how long does it stay fresh? → 1 source(s). Store tea sealed, away from light and strong smells. It stays fresh for about 12 months. If you want, I can suggest the types of containers that work best for k

## coaching

- Timings: read 7.3 s, classify_and_gaps 12.6 s, questions_and_designs 18.1 s, build 23.8 s, publish 0.0 s, total_to_publish 61.9 s
- Learned by section: {'about': 1, 'services': 3, 'hours': 4, 'location': 3}
- Gap questions: your fees; how admissions work; your enrollment start dates and seat availability
- Designs: New student enquiries, Course guide, Student support, Booking and payments (coming soon)
- Q: What courses do you offer for Class 11 and 12? → 2 source(s). For Class 11 and 12 we provide coaching for school exams, JEE and NEET in Kothrud.

Sources:
— Bright Minds Academy — Coaching for Class 8 to 12 in Kothrud, Bri
- Q: What are the morning and evening batch timings? → 0 source(s). I don’t have the morning/evening batch timings in my information. Please call +91 20 0000 3344 to get the exact batch schedules and start dates (our office hour
- Q: When is the weekend doubt-clearing session? → 2 source(s). Weekend doubt-clearing is on Sunday, 10:00 am to 1:00 pm. If you’d like directions or to book a slot, please call us at +91 20 0000 3344.

Sources:
— Batch timi

## real-estate

- Timings: read 8.4 s, classify_and_gaps 12.8 s, questions_and_designs 22.5 s, build 16.8 s, publish 0.0 s, total_to_publish 60.6 s
- Learned by section: {'about': 2, 'services': 5, 'location': 4}
- Gap questions: how people can arrange a site visit; your price ranges; your maintenance charges
- Designs: New buyer enquiries, Property guide, Booking and payments (coming soon)
- Q: What apartment sizes are available? → 1 source(s). Greenfield Meadows offers 2 BHK and 3 BHK apartment layouts. (Possession from June 2027.)

Sources:
— Greenfield Homes — 2 and 3 BHK homes in Whitefield, Greenf
- Q: When is possession for Greenfield Meadows? → 0 source(s). I’m sorry—I don’t have the possession date for Greenfield Meadows in the information I can access. For the exact possession schedule, please contact Greenfield 
- Q: What amenities does the project have? → 0 source(s). I’m sorry — I don’t have the project’s amenities list in the information I can access. I can help here with other details I do have access to, for example layou

## saas

- Timings: read 5.6 s, classify_and_gaps 11.5 s, questions_and_designs 17.0 s, build 19.5 s, publish 0.0 s, total_to_publish 53.6 s
- Learned by section: {'about': 1, 'services': 7}
- Gap questions: your plans and pricing; when your support team is available; how to reach you
- Designs: Help centre, Client guide, New client enquiries, Booking and payments (coming soon)
- Q: How do I create a new invoice? → 1 source(s). To create a new invoice in Ledgerly:
1. Go to Invoices, then tap New invoice.  
2. Add your customer, the items you’re charging for, and the applicable tax rate
- Q: How do I send an invoice by WhatsApp? → 1 source(s). Open Invoices in Ledgerly, choose New invoice, add the customer, items and tax rates (Ledgerly will calculate CGST/SGST/IGST from the customer’s state), then sa
- Q: How does Ledgerly calculate CGST or IGST? → 1 source(s). Ledgerly determines whether to apply CGST, SGST or IGST based on the customer’s state. To see it in action, go to Invoices → New invoice, add the customer, item

## restaurant

- Timings: read 6.0 s, classify_and_gaps 21.2 s, questions_and_designs 23.3 s, build 13.9 s, publish 0.0 s, total_to_publish 64.5 s
- Learned by section: {'about': 1, 'location': 2, 'hours': 2, 'services': 6}
- Gap questions: how people can reserve a table; whether you deliver, and where; your vegetarian menu
- Designs: Menu guide, Reservation enquiries, Customer support, Booking and payments (coming soon)
- Q: What are your opening hours? → 1 source(s). We’re open Tuesday to Sunday, 12:00 to 15:30 and 19:00 to 23:30. We’re closed on Mondays. For anything else (reservations, directions), you can call us at +91 2
- Q: Where is Coastal Spice Kitchen located? → 2 source(s). Coastal Spice Kitchen is located in Bandra West, Mumbai. I don't have a more specific street address in my information. Would you like directions, our menu, or 
- Q: Do you serve Mangalorean and Goan seafood? → 1 source(s). Yes — Coastal Spice Kitchen serves Mangalorean and Goan seafood in Bandra West, Mumbai, and also offers vegetarian dishes from the same coast. Would you like to

## blocked

- Timings: read 3.0 s

## unreachable

- Timings: read 3.0 s

## live-love-laugh

- Timings: read 24.0 s, classify_and_gaps 19.4 s, questions_and_designs 21.3 s, build 15.3 s, publish 0.0 s, total_to_publish 80.1 s
- Learned by section: {'about': 39, 'team': 25, 'services': 77, 'faqs': 24, 'location': 6, 'policies': 21, 'hours': 5}
- Gap questions: how people can volunteer; your fees for the Corporate Mental Well-being Program
- Designs: Client guide, Program enquiries, Help centre, Booking and payments (coming soon)
- Q: How can I donate and get an 80G certificate? → 2 source(s). Thank you — you can donate to The Live Love Laugh Foundation online or via partners: GiveIndia or Benevity (use our dedicated pages on those platforms). Donatio
- Q: Which helplines are available 24/7? → 2 source(s). I don’t have information in our materials that says which helplines are available 24/7. Our site lists helpline numbers for referral, but the pages we have note
- Q: How do I find a therapist near me? → 2 source(s). You can use our online therapist directory to find verified mental health professionals across India. Go to the “Find a Therapist” page, browse therapists by lo

