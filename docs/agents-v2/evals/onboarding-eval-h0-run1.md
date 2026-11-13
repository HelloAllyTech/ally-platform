> H0 run 1, 13 Nov 2026 (local stack): purposes read, but the old booking pattern counted "Keep your steps in order" as taking orders, so every live case failed on it. Kept for the judge notes on the held health cases. See `../CHUNK-H0-NOTES.md`.

# Onboarding eval

**Hard fails: 11** of 13 cases.

| Case | Pages | Facts | Dropped | Industry | Pack | Gaps asked | Deliberate found | To publish | Result |
|---|---|---|---|---|---|---|---|---|---|
| mental-health | 5 | 19 | 0 | mental_health | mental_health | fees, cancellation | 2/2 | 173 s | FAIL |
| gp-clinic | 4 | 15 | 0 | gp_clinic | medical | emergency, insurance, site_1 | 2/2 | – | FAIL |
| diagnostic-lab | 4 | 18 | 0 | diagnostic_lab | medical | report_times, home_collection, site_1 | 2/2 | 149 s | FAIL |
| pharmacy | 3 | 12 | 0 | pharmacy | pharmacy | delivery, prescriptions, site_1 | 2/2 | – | FAIL |
| wellness | 4 | 11 | 0 | wellness | standard | fees, cancellation, site_1 | 2/2 | 181 s | FAIL |
| d2c | 4 | 13 | 0 | d2c | standard | shipping, returns, site_1 | 2/2 | 204 s | FAIL |
| coaching | 4 | 11 | 0 | coaching | minors | fees, admissions, site_2 | 2/2 | 221 s | FAIL |
| real-estate | 3 | 14 | 0 | real_estate | standard | site_visits, prices, site_1 | 2/2 | 186 s | FAIL |
| saas | 3 | 8 | 0 | saas | standard | pricing, support_hours, contact | 2/2 | 164 s | FAIL |
| restaurant | 3 | 11 | 0 | restaurant | standard | reservations, delivery, site_1 | 2/2 | 152 s | FAIL |
| blocked | 0 | – | – | blocked | – | – | – | – | pass |
| unreachable | 0 | – | – | unreachable | – | – | – | – | pass |
| live-love-laugh | 50 | 254 | 0 | non_profit | mental_health | volunteer, site_2 | – | 188 s | FAIL |

## mental-health

- **Hard fail:** purpose 'Guide people step by step' says it will book or take orders
- Timings: read 14.2 s, classify_and_gaps 12.6 s, questions 26.2 s, build 34.1 s, checkup 86.0 s, publish 0.1 s, total_to_publish 173.2 s
- Learned by section: {'about': 4, 'policies': 2, 'faqs': 2, 'services': 4, 'location': 3, 'hours': 1, 'team': 3}
- Gap questions: your fees; your cancellation policy
- Designs: Bring in customers (recommended), Answer questions, Guide people step by step, Train my team, Something else
- Q: What therapies do you offer for anxiety? → 2 source(s). We offer individual (one-to-one) therapy for anxiety using CBT (Cognitive Behavioural Therapy), ACT (Acceptance and Commitment Therapy) and person-centred appro
- Q: Do you offer online sessions? → 3 source(s). Yes — we offer online video sessions. You can start by calling or emailing the clinic to arrange a first session, and the team will confirm availability. Our co
- Q: How long is an individual session? → 1 source(s). Individual (one-to-one) sessions are 50 minutes long. Would you like me to pass your name and phone number to the team so someone can contact you to arrange a f

## gp-clinic

- **Hard fail:** purpose 'Guide people step by step' says it will book or take orders
- **Hard fail:** 1 checkup hard fail(s)
- **Hard fail:** publish held: safety_recheck
- Timings: read 12.1 s, classify_and_gaps 14.4 s, questions 28.9 s, build 20.4 s, checkup 104.4 s, publish 19.7 s
- Learned by section: {'about': 2, 'services': 4, 'team': 3, 'location': 3, 'hours': 2, 'policies': 1}
- Gap questions: what to do in an emergency or after hours; which insurance you accept; your vaccine prices
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else

## diagnostic-lab

- **Hard fail:** purpose 'Guide people step by step' says it will book or take orders
- Timings: read 10.1 s, classify_and_gaps 16.8 s, questions 22.6 s, build 20.1 s, checkup 79.6 s, publish 0.0 s, total_to_publish 149.4 s
- Learned by section: {'about': 3, 'services': 8, 'policies': 2, 'team': 1, 'hours': 1, 'location': 3}
- Gap questions: how long reports take; whether you collect samples at home; your fees for ECG
- Designs: Answer questions (recommended), Guide people step by step, Bring in customers, Train my team, Something else
- Q: What are your opening hours? → 1 source(s). We’re open every day from 7:00 am to 9:00 pm. If you need anything else or want to call us, our phone is +91 22 0000 7788.

Sources:
— Contact — ClearPath Diagn
- Q: Where are you located? → 3 source(s). We’re in Andheri West, Mumbai: Shop 4, Link Plaza, New Link Road, Andheri West, Mumbai 400053. (Open daily 7 am–9 pm.)

Sources:
— Contact — ClearPath Diagnosti
- Q: How much is a complete blood count? → 2 source(s). A complete blood count (CBC) is ₹350. Would you like to book a sample collection or visit? You can call +91 22 0000 7788 to arrange it.

Sources:
— Tests and pr

## pharmacy

- **Hard fail:** purpose 'Guide people step by step' says it will book or take orders
- **Hard fail:** 1 checkup hard fail(s)
- **Hard fail:** publish held: safety_recheck
- Timings: read 10.1 s, classify_and_gaps 20.7 s, questions 37.6 s, build 29.3 s, checkup 102.9 s, publish 5.3 s
- Learned by section: {'about': 2, 'services': 6, 'location': 2, 'hours': 1, 'team': 1}
- Gap questions: whether you deliver, and where; how people should send a prescription; your prices for medicines and devices
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else

## wellness

- **Hard fail:** purpose 'Guide people step by step' says it will book or take orders
- Timings: read 14.2 s, classify_and_gaps 20.0 s, questions 25.9 s, build 35.7 s, checkup 85.0 s, publish 0.0 s, total_to_publish 180.8 s
- Learned by section: {'about': 1, 'services': 1, 'hours': 4, 'team': 2, 'location': 3}
- Gap questions: your fees; your cancellation policy; your prices for Hatha, Vinyasa and Yin classes and passes
- Designs: Bring in customers (recommended), Answer questions, Guide people step by step, Train my team, Something else
- Q: When is the morning Hatha class? → 2 source(s). Morning Hatha classes are on Monday, Wednesday and Friday from 6:30 to 7:30 am. Would you like me to pass your name and phone number to the studio so someone ca
- Q: When is the evening Vinyasa class? → 2 source(s). The evening Vinyasa class runs Tuesday and Thursday, 7:00 to 8:00 pm. (Source: timetable) Would you like me to pass your name and phone number to the studio so 
- Q: When is the Weekend Yin class? → 2 source(s). The Weekend Yin class is on Saturday, 9:00 to 10:15 am. (source: classes and timetable) If you’d like, I can pass your name and phone number to the studio so so

## d2c

- **Hard fail:** purpose 'Guide people step by step' says it will book or take orders
- Timings: read 18.2 s, classify_and_gaps 20.9 s, questions 39.0 s, build 22.9 s, checkup 102.7 s, publish 0.0 s, total_to_publish 203.8 s
- Learned by section: {'about': 2, 'services': 5, 'team': 2, 'faqs': 1, 'location': 2, 'hours': 1}
- Gap questions: your shipping times and charges; your returns policy; your ingredients/allergen information
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else
- Q: Which teas and prices do you sell? → 2 source(s). We sell: Assam Breakfast (250 g) — ₹520; Darjeeling First Flush (100 g) — ₹690; Masala Chai blend (250 g) — ₹480; Tasting box of six 25 g teas — ₹799. Every tea
- Q: What is the tasting box and price? → 1 source(s). The tasting box contains six 25 g teas and costs ₹799. Every tea comes in a resealable foil pouch. Would you like the list of the six teas or help to order one?
- Q: How should I store my tea? → 1 source(s). Keep your tea sealed and store it away from light and strong smells. It stays fresh for about 12 months. If you need more help, message us on WhatsApp +91 98000

## coaching

- **Hard fail:** purpose 'Guide people step by step' says it will book or take orders
- **Hard fail:** 1 checkup hard fail(s)
- Timings: read 14.1 s, classify_and_gaps 21.6 s, questions 35.1 s, build 32.3 s, checkup 117.3 s, publish 0.0 s, total_to_publish 220.5 s
- Learned by section: {'about': 1, 'location': 3, 'hours': 4, 'services': 3}
- Gap questions: your fees; how admissions work; your batch allocations for each course
- Designs: Bring in customers (recommended), Answer questions, Guide people step by step, Train my team, Something else
- Q: What courses do you offer? → 1 source(s). We offer these courses:

- Foundation (Class 8 to 10): Maths and Science, three evenings a week.
- JEE (Class 11 and 12): Physics, Chemistry and Maths, six days
- Q: What are the morning and evening batch times? → 1 source(s). Morning batch is 7:00 to 10:00 am. Evening batch is 5:00 to 8:00 pm (source: Bright Minds Academy batch timings). Would you like me to pass your name and phone 
- Q: When is weekend doubt-clearing? → 1 source(s). Weekend doubt-clearing is on Sunday from 10:00 am to 1:00 pm (source: Bright Minds Academy). Would you like me to pass your name and phone number to the academy

## real-estate

- **Hard fail:** purpose 'Guide people step by step' says it will book or take orders
- Timings: read 12.1 s, classify_and_gaps 22.6 s, questions 36.7 s, build 25.5 s, checkup 88.9 s, publish 0.0 s, total_to_publish 186.0 s
- Learned by section: {'about': 2, 'services': 8, 'location': 4}
- Gap questions: how people can arrange a site visit; your price ranges; your clubhouse and pool access rules and fees
- Designs: Bring in customers (recommended), Answer questions, Guide people step by step, Train my team, Something else
- Q: What layouts does Greenfield Meadows offer? → 2 source(s). Greenfield Meadows offers 2 BHK homes of 1,150 sq ft and 3 BHK homes of 1,540 sq ft (it’s a 240-home development in these 2- and 3-BHK layouts). Would you like 
- Q: What are the sizes of the 2 BHK and 3 BHK? → 1 source(s). 2 BHK homes are 1,150 sq ft and 3 BHK homes are 1,540 sq ft at Greenfield Meadows (two towers on 3.2 acres). Would you like me to pass your name and phone to th
- Q: When is possession for Greenfield Meadows? → 1 source(s). Possession for Greenfield Meadows is from June 2027. (source: Greenfield Homes) Would you like me to pass your name and phone number to the sales team so they c

## saas

- **Hard fail:** purpose 'Guide people step by step' says it will book or take orders
- Timings: read 10.1 s, classify_and_gaps 18.4 s, questions 27.8 s, build 25.4 s, checkup 82.0 s, publish 0.0 s, total_to_publish 163.8 s
- Learned by section: {'about': 2, 'services': 6}
- Gap questions: your plans and pricing; when your support team is available; how to reach you
- Designs: Answer questions (recommended), Guide people step by step, Bring in customers, Train my team, Something else
- Q: How do I create a new invoice? → 1 source(s). Go to Invoices, tap New invoice, add your customer, items and tax rates. Ledgerly will calculate CGST/SGST or IGST from the customer’s state. You can then send 
- Q: How does Ledgerly calculate CGST, SGST or IGST? → 1 source(s). Ledgerly decides whether to apply CGST+SGST or IGST based on the customer’s state. When you create a new invoice (Invoices → New invoice) and add the customer, 
- Q: Can I file GSTR-1 from Ledgerly? → 2 source(s). Yes. Under Returns choose the month and review the summary, connect your GSTN account once, then file GSTR-1 directly from Ledgerly. (I can guide you through co

## restaurant

- **Hard fail:** purpose 'Guide people step by step' says it will book or take orders
- Timings: read 12.1 s, classify_and_gaps 22.6 s, questions 29.7 s, build 17.4 s, checkup 70.0 s, publish 0.0 s, total_to_publish 151.9 s
- Learned by section: {'about': 1, 'services': 6, 'hours': 2, 'location': 2}
- Gap questions: how people can reserve a table; whether you deliver, and where; your vegetarian menu details
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else
- Q: What are your opening hours? → 1 source(s). We’re open Tuesday–Sunday 12:00–15:30 and 19:00–23:30, closed on Mondays. For visits or reservations you can call the restaurant at +91 22 0000 6612.

Sources:

- Q: Where are you located? → 1 source(s). We’re at Ground floor, 17 Chapel Road, Bandra West, Mumbai 400050. We’re open Tuesday–Sunday 12:00–15:30 and 19:00–23:30 (closed Mondays). Phone: +91 22 0000 66
- Q: How much is prawn gassi with neer dosa? → 1 source(s). Prawn gassi with neer dosa is ₹540. Source: menu. Would you like our full menu or opening hours next?

Sources:
— Menu — Coastal Spice Kitchen, Menu

## blocked

- Timings: read 2.0 s

## unreachable

- Timings: read 2.0 s

## live-love-laugh

- **Hard fail:** purpose 'Guide people step by step' says it will book or take orders
- Timings: read 30.4 s, classify_and_gaps 21.2 s, questions 25.9 s, build 25.6 s, checkup 84.5 s, publish 0.0 s, total_to_publish 187.6 s
- Learned by section: {'about': 37, 'services': 48, 'hours': 28, 'location': 52, 'faqs': 19, 'policies': 37, 'team': 26, 'brand': 7}
- Gap questions: how people can volunteer; your therapists' fees or session costs
- Designs: Answer questions (recommended), Bring in customers, Guide people step by step, Train my team, Something else
- Q: What helplines do you list for immediate help? → 0 source(s). It sounds like this may be urgent. This assistant cannot help with a crisis. Please contact a supervisor or a crisis line now: Tele-MANAS 14416
- Q: Is the School Program free of cost? → 2 source(s). Yes — the Live Love Laugh School Program is free of cost. (Source: School Program pages.) Would you like more details about what the program includes or how to 
- Q: How can I donate and get an 80G certificate? → 3 source(s). You can donate online (payment gateway, bank transfer or cheque for Indian citizens/organisations/NRIs; foreign nationals/OCIs donate via bank transfer) — see D
