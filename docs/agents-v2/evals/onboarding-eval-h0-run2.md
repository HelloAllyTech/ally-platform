> H0 run 2, 13 Nov 2026 (local stack): 9 of 13, an open fail. gp-clinic, diagnostic-lab, pharmacy and coaching are held at publish by `safety_recheck`; the fix is a safety-pack chunk. Pharmacy predates 15a's "painkiller" fix. See `../CHUNK-H0-NOTES.md`.

# Onboarding eval

**Hard fails: 4** of 13 cases.

| Case | Pages | Facts | Dropped | Industry | Pack | Gaps asked | Deliberate found | To publish | Result |
|---|---|---|---|---|---|---|---|---|---|
| mental-health | 5 | 22 | 0 | mental_health | mental_health | fees, cancellation | 2/2 | 163 s | pass |
| gp-clinic | 4 | 16 | 0 | gp_clinic | medical | emergency, insurance, site_1 | 2/2 | – | FAIL |
| diagnostic-lab | 4 | 17 | 0 | diagnostic_lab | medical | report_times, home_collection, site_1 | 2/2 | – | FAIL |
| pharmacy | 3 | 11 | 0 | pharmacy | pharmacy | delivery, prescriptions, site_1 | 2/2 | – | FAIL |
| wellness | 4 | 10 | 0 | wellness | standard | fees, cancellation | 2/2 | 140 s | pass |
| d2c | 4 | 15 | 0 | d2c | standard | shipping, returns, site_1 | 2/2 | 161 s | pass |
| coaching | 4 | 11 | 0 | coaching | minors | fees, admissions, site_1 | 2/2 | – | FAIL |
| real-estate | 3 | 15 | 0 | real_estate | standard | site_visits, prices, site_2 | 2/2 | 132 s | pass |
| saas | 3 | 7 | 0 | saas | standard | pricing, support_hours, contact | 2/2 | 132 s | pass |
| restaurant | 3 | 11 | 0 | restaurant | standard | reservations, delivery, site_1 | 2/2 | 126 s | pass |
| blocked | 0 | – | – | blocked | – | – | – | – | pass |
| unreachable | 0 | – | – | unreachable | – | – | – | – | pass |
| live-love-laugh | 50 | 212 | 0 | non_profit | mental_health | site_1, site_2 | – | 185 s | pass |

## mental-health

- Timings: read 14.2 s, classify_and_gaps 16.9 s, questions 27.8 s, build 29.8 s, checkup 74.6 s, publish 0.0 s, total_to_publish 163.4 s
- Learned by section: {'about': 4, 'location': 3, 'hours': 2, 'services': 4, 'team': 3, 'policies': 3, 'faqs': 3}
- Gap questions: your fees; your cancellation policy
- Designs: Bring in customers (recommended), Answer questions, Guide people step by step, Train my team, Something else
- Q: What services do you offer? → 2 source(s). We offer counselling and therapy for adults and teenagers for issues such as anxiety, low mood, stress, relationship problems and life changes. Sessions are ava
- Q: How do I start a first session? → 4 source(s). To start a first session, call or email the clinic and they will arrange a first session with the therapist who fits best (they’ll confirm available times). You
- Q: Do you offer online sessions? → 2 source(s). Yes — we offer online sessions by video. To start, you can call or email the clinic and they will arrange a first session with a therapist who fits best. Would 

## gp-clinic

- **Hard fail:** 4 checkup hard fail(s)
- **Hard fail:** publish held: safety_recheck
- Timings: read 8.1 s, classify_and_gaps 19.0 s, questions 31.2 s, build 21.9 s, checkup 94.1 s, publish 17.1 s
- Learned by section: {'about': 2, 'team': 3, 'location': 3, 'hours': 2, 'policies': 2, 'services': 4}
- Gap questions: what to do in an emergency or after hours; which insurance you accept; your fees for child vaccinations
- Designs: Bring in customers (recommended), Answer questions, Guide people step by step, Train my team, Something else

## diagnostic-lab

- **Hard fail:** 2 checkup hard fail(s)
- **Hard fail:** publish held: safety_recheck
- Timings: read 8.1 s, classify_and_gaps 13.7 s, questions 21.2 s, build 16.3 s, checkup 84.3 s, publish 19.1 s
- Learned by section: {'about': 3, 'services': 8, 'location': 3, 'hours': 1, 'team': 1, 'policies': 1}
- Gap questions: how long reports take; whether you collect samples at home; your fees for ECG
- Designs: Answer questions (recommended), Guide people step by step, Bring in customers, Train my team, Something else

## pharmacy

- **Hard fail:** 1 checkup hard fail(s)
- **Hard fail:** publish held: safety_recheck
- Timings: read 10.1 s, classify_and_gaps 20.1 s, questions 22.5 s, build 24.2 s, checkup 74.0 s, publish 10.6 s
- Learned by section: {'about': 1, 'services': 6, 'location': 2, 'hours': 1, 'team': 1}
- Gap questions: whether you deliver, and where; how people should send a prescription; your prices for devices and diabetic supplies
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else

## wellness

- Timings: read 8.1 s, classify_and_gaps 13.4 s, questions 26.7 s, build 21.3 s, checkup 70.4 s, publish 0.0 s, total_to_publish 140.0 s
- Learned by section: {'about': 1, 'hours': 4, 'team': 2, 'location': 3}
- Gap questions: your fees; your cancellation policy
- Designs: Bring in customers (recommended), Answer questions, Guide people step by step, Train my team, Something else
- Q: When is Morning Hatha held? → 1 source(s). Morning Hatha is held Monday, Wednesday and Friday, 6:30 to 7:30 am. Would you like me to pass your name and phone number to the studio so they can confirm avai
- Q: When are Evening Vinyasa classes? → 1 source(s). Evening Vinyasa classes are on Tuesday and Thursday, 7 to 8 pm. (Source: studio timetable.) Would you like me to pass your name and phone number to the studio s
- Q: Who teaches at Prana Yoga Studio? → 1 source(s). Our teacher is Ananya Rao — founder, 500-hour certified, teaching since 2012. Would you like me to pass your name and phone to the studio so someone can follow 

## d2c

- Timings: read 14.1 s, classify_and_gaps 21.1 s, questions 20.7 s, build 26.9 s, checkup 77.9 s, publish 0.1 s, total_to_publish 160.9 s
- Learned by section: {'about': 3, 'services': 5, 'team': 2, 'faqs': 2, 'location': 2, 'hours': 1}
- Gap questions: your shipping times and charges; your returns policy; your accepted payment methods
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else
- Q: How much is Assam Breakfast 250 g? → 2 source(s). Assam Breakfast, 250 g costs ₹520. Source: [1]. Tip: store it sealed, away from light and strong smells — it stays fresh about 12 months. Source: [4].

Sources:
- Q: What is the price of Darjeeling First Flush 100 g? → 1 source(s). Darjeeling First Flush, 100 g costs ₹690. Source: [1]

Sources:
— Shop — Kesar Teas, Our teas
- Q: What are your weekday hours? → 1 source(s). Our weekday hours are 10:00 am to 6:00 pm. (You can reach us by WhatsApp during these hours.)

Sources:
— Help — Kesar Teas, Help

## coaching

- **Hard fail:** 1 checkup hard fail(s)
- **Hard fail:** publish held: safety_recheck
- Timings: read 8.1 s, classify_and_gaps 15.9 s, questions 25.3 s, build 25.4 s, checkup 77.4 s, publish 22.3 s
- Learned by section: {'about': 1, 'hours': 4, 'services': 3, 'location': 3}
- Gap questions: your fees; how admissions work; your seat availability for batches
- Designs: Bring in customers (recommended), Answer questions, Guide people step by step, Train my team, Something else

## real-estate

- Timings: read 10.1 s, classify_and_gaps 15.2 s, questions 27.3 s, build 23.5 s, checkup 55.5 s, publish 0.0 s, total_to_publish 131.7 s
- Learned by section: {'about': 2, 'services': 8, 'location': 5}
- Gap questions: how people can arrange a site visit; your price ranges; your maintenance or association charges
- Designs: Bring in customers (recommended), Answer questions, Guide people step by step, Train my team, Something else
- Q: What home sizes do you offer? → 0 source(s). I’m sorry—I don’t have the details about available home sizes in my records right now. Would you like me to pass your name and phone number to our sales team so
- Q: When is possession? → 0 source(s). I’m sorry—I don’t have the possession date here. Would you like me to pass your name and phone number to our sales team so they can confirm the possession date 
- Q: What amenities are included? → 0 source(s). Sorry—I don’t have verified information about Greenfield Meadows’ amenities right now, so I can’t list them. Would you like me to pass your name and phone to th

## saas

- Timings: read 10.1 s, classify_and_gaps 13.0 s, questions 26.3 s, build 22.0 s, checkup 60.7 s, publish 0.0 s, total_to_publish 132.2 s
- Learned by section: {'about': 1, 'services': 6}
- Gap questions: your plans and pricing; when your support team is available; how to reach you
- Designs: Answer questions (recommended), Guide people step by step, Bring in customers, Train my team, Something else
- Q: How do I create a new invoice? → 0 source(s). Sorry — I don’t have the step‑by‑step instructions for creating a new invoice in Ledgerly. Please contact the Ledgerly team for the exact in‑app steps. I can st
- Q: How does Ledgerly calculate CGST, SGST or IGST? → 0 source(s). I’m sorry—I don’t have the information about how Ledgerly calculates CGST, SGST or IGST. Please contact the Ledgerly team for the exact method they use. I can h
- Q: How can I send an invoice to a customer? → 0 source(s). Sorry—I don't have the Ledgerly instructions for sending invoices (email, WhatsApp or PDF) in my notes. Please contact the Ledgerly team for the exact steps. I 

## restaurant

- Timings: read 8.1 s, classify_and_gaps 15.4 s, questions 26.8 s, build 14.6 s, checkup 61.3 s, publish 0.0 s, total_to_publish 126.3 s
- Learned by section: {'about': 1, 'location': 2, 'hours': 2, 'services': 6}
- Gap questions: how people can reserve a table; whether you deliver, and where; your vegan and allergy options
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else
- Q: What are your opening hours? → 0 source(s). Sorry—I don’t have Coastal Spice Kitchen’s opening hours in my information and I can’t guess them. Please check the restaurant’s website, their social media, or
- Q: Where are you located? → 0 source(s). I’m sorry — I don’t have the restaurant’s location in my information. Would you like me to look up the Bandra address for Coastal Spice Kitchen now, or tell me 
- Q: How much is the prawn gassi with neer dosa? → 0 source(s). Sorry—I don't have pricing details for prawn gassi with neer dosa in my information. I can't invent prices. If you want, I can (1) check the menu if you share i

## blocked

- Timings: read 2.0 s

## unreachable

- Timings: read 2.0 s

## live-love-laugh

- Timings: read 34.3 s, classify_and_gaps 25.0 s, questions 25.6 s, build 24.0 s, checkup 75.7 s, publish 0.1 s, total_to_publish 184.7 s
- Learned by section: {'about': 45, 'services': 47, 'hours': 19, 'location': 7, 'faqs': 22, 'team': 40, 'policies': 21, 'brand': 11}
- Gap questions: your Counselling Assist current availability; your therapists' session fees
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else
- Q: What does the Live Love Laugh Foundation do? → 0 source(s). I’m sorry — I don’t have the organisation’s details available right now. I can’t answer what The Live Love Laugh Foundation does without the source text. Please
- Q: What is Counselling Assist and its hours? → 0 source(s). I’m sorry—I don’t have information here about what “Counselling Assist” is or its hours. Please contact the Live Love Laugh team via their website (Contact Us /
- Q: How can I find a therapist on the website? → 0 source(s). I don’t have the Find a Therapist page details here. Please check the Contact Us page on our website to ask the team, or tell me — are you looking for a therapi
