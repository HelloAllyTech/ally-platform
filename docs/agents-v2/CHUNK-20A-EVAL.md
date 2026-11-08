<!-- Generated from the eval run of 2026-11-08 (run 3, after the fixes below). -->
# Chunk 20a-1 onboarding eval

**Run:** 8 Nov 2026, local stack, gpt-5-mini for every builder sub-task. 10 fictional fixture sites (`fixtures/onboarding-sites/`), a blocked site, an unreachable port, and Live Love Laugh's live public site. Each case goes from its website to a published, invite-only assistant through ally-be's real session API, then asks the published assistant its first three suggested questions through Preview.

**The bar** (Shehbaz, 8 Nov): every case passes; the right business type and pack; 0 unsourced facts; under 5 minutes to publish.

**Result: 13 of 13 pass.** Times to publish 54–80 s. Facts unsourced: 0. Deliberate gaps asked: 20 of 20. Preview answers with at least one source: 28 of 33.

**Outside this bar, and not fixed here: 5 of 33 answers wrongly declined.** The assistant said it didn't have something its own pages say (the yoga styles, the beginners' series, the batch timings, a possession date, amenities). It isn't timing: asked again later with every page indexed, the yoga question still declined. The search found passages; the agent declined anyway, was nudged to use them (`USE_FOUND`) and asked a question back. That is answer quality in the 3a agent on short, list-like pages. The 20a-2 checkup measures exactly this; it should be looked at before G1b. **Update:** the diagnosis below finds the cause is passage selection, not the agent: search retrieved the right page every time, but a heading-only chunk set the similarity bar and the answer was cut before the agent saw it. See [The 5 wrong declines: diagnosis](#the-5-wrong-declines-diagnosis).

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

## The 5 wrong declines: diagnosis

*Written 8 Nov 2026, from the eval runs' own LangGraph checkpoints (`ally_agent_runtime`, schema `agent_runtime`; every Preview question is its own `preview-<uuid>` thread), plus 15 fresh `/agent/run` calls with the same bot payloads. No code was changed to observe this.*

**In one line:** the agent never saw the answer. `search_knowledge` retrieved the right page every time, but `KnowledgeAgentService._select_passages` (`ally-ai/app/core/knowledge_agent/agent.py`) keeps only hits within `similarity_band` (0.08, from the bot's `settings.retrieval.similarityBand`) of the best hit. On these sites the best hit was often a 2–4 token chunk holding only a heading ("Prana Yoga Studio", "Greenfield Meadows"), which matches any query that names the business. That set the bar, and the answer chunk fell below it. With only the heading or the home sentence in front of it, the agent's decline was honest, and the check's nudge (`USE_FOUND`) couldn't help: the passages really didn't say.

**Why there are heading-only chunks.** `extractPastedText` in `ally-be/src/knowledge-base/extractor/index.ts` starts each section *after* its heading line (`start: offset + line.length`). So a page's first heading becomes its own "preface" chunk, and later headings are glued to the end of the section before ("Founder, 500-hour certified, teaching since 2012.\nVikram Shetty"). Sections are hard chunk boundaries (`chunker.ts`), so these never merge with their content.

**Evidence that it is selection, not the model.** Across the 6 eval runs (5 from run 3, plus the yoga question asked again at 14:07) and 13 completed reruns, the agent answered every time the answer chunk was among its passages (6 of 6) and declined every time it wasn't (13 of 13). It never declined with the answer in front of it.

### 1. wellness: "What yoga styles do you teach?"

- **Answer is on:** `/` "Prana Yoga Studio teaches Hatha, Vinyasa and Yin yoga…" (also implied by `/classes`).
- **Search** (`What yoga styles does Prana Yoga Studio teach?`): 6 hits. Best: "Prana Yoga Studio" (heading only, home page, 0.769). The answer sentence was hit #2 at 0.616, below the band floor of 0.689. `/classes` was hit #4 at 0.486.
- **Passages the agent got:** P1 "Prana Yoga Studio". Nothing else.
- **Draft:** decline. "I'm sorry — I don't have information in my files about which yoga styles Prana Yoga Studio teaches. I can help look up the class schedule…"
- **Check:** `check.py` `_require_sources` → `Rejection.USE_FOUND` (the question names the organisation: "yoga" matches the display name). Sent back with `REJECTIONS[USE_FOUND]`.
- **Rewrite / final:** decline again, kept in its own words (`keeps_text`): "I'm sorry—I don't have information about which yoga styles Prana Yoga Studio teaches in the materials I can access. For the most accurate list, please contact the studio at +91 80 0000 6060…" The 14:07 re-ask got the same single passage and ended as `clarify` ("Would you like me to look up the current class types…?"): that is the "asked a question back".
- **What made it a decline:** the model, correctly following `agent/system` rule at line 12 ("If you searched and still have nothing to cite, be honest…"). Cause: selection band. It did not search again (line 10, "If a search misses, try once more", doesn't fire: the search returned a passage, so it doesn't look like a miss).
- **Reruns now: 2 answer, 1 decline (plus 1 timeout).** Both answers got the home sentence as P2: once because the query happened to add "(Hatha, Vinyasa, Yin, etc.)", once via a second search.

### 2. wellness: "When is the beginners' series?"

- **Answer is on:** `/classes` "Beginners' series: four Sundays each month, 8 am."
- **Search** (`When is the beginners' series at Prana Yoga Studio in Koramangala?`): best was the home sentence (0.713). `/classes` was hit #2 at 0.602, below the floor of 0.633.
- **Passages:** P1 "Prana Yoga Studio teaches Hatha, Vinyasa and Yin yoga… for beginners and regular practitioners." That is why the decline mentions the three styles.
- **Draft:** decline, with the studio's phone number.
- **Check:** `_drop_unsourced_details` → `Rejection.UNSOURCED_DETAIL` ("It contained a number"). The phone came from the persona instructions and decline wording, not a passage. `USE_FOUND` did not apply: the question doesn't name the organisation.
- **Rewrite / final:** decline again, citing P1. The phone sentence was cut. Final: "I'm sorry — I don't have the schedule for the beginners' series in the information I can access. I can tell you Prana Yoga Studio teaches Hatha, Vinyasa and Yin…"
- **What made it a decline:** the model (rule at line 12). Cause: selection band.
- **Reruns now: 1 answer, 2 decline (plus 1 timeout).** Every run that searched a second time with different words got `/classes`; the one that finished answered correctly ("four Sundays each month at 8:00 am").

### 3. coaching: "What are the morning and evening batch timings?"

- **Answer is on:** `/batches` "Morning batch: 7 to 10 am. Evening batch: 5 to 8 pm."
- **Search** (`Bright Minds Academy morning and evening batch timings for classes (8-12) in Kothrud`): best was the home sentence (0.716). The batch chunk was hit #4 at 0.575, below the floor of 0.636. A heading-only "Bright Minds Academy" chunk was #3 (0.627).
- **Passages:** P1 home sentence, P2 contact page (address, phone, office hours).
- **Draft:** decline. "I'm sorry—I don't have the morning/evening batch timings in my records. Please call our centre at +91 20 0000 3344…"
- **Check:** `_require_sources` → `USE_FOUND`. "Batch timings" counts as an organisation name here: `organisation_of` takes the part before " — " in each document title as a name, and the builder titles pages "Batch timings — Bright Minds Academy".
- **Rewrite / final:** decline again (`keeps_text`): "I don't have the morning/evening batch timings in my information. Please call +91 20 0000 3344…"
- **What made it a decline:** the model (line 12). Cause: selection band, and the query's extra words ("classes (8-12) in Kothrud") pulled the home sentence above the batch chunk.
- **Reruns now: 3 answer, 0 decline.** The queries were shorter ("…batch timings at Bright Minds Academy in Kothrud?") and the batch chunk came first (0.64–0.66). This one is query luck.

### 4. real-estate: "When is possession for Greenfield Meadows?"

- **Answer is on:** `/` "…with possession from June 2027."
- **Search** (`What is the possession date for Greenfield Meadows?`): best was "Greenfield Meadows" (heading only, `/project`, 0.631). The home sentence was hit #2 at 0.539, below the floor of 0.551.
- **Passages:** P1 "Greenfield Meadows". Nothing else.
- **Draft:** decline, with the sales phone.
- **Check:** `_require_sources` → `USE_FOUND`.
- **Rewrite / final:** decline again: "I'm sorry—I don't have the possession date for Greenfield Meadows in the information I can access. For the exact possession schedule, please contact Greenfield Meadows' sales office directly…"
- **What made it a decline:** the model (line 12). Cause: selection band.
- **Reruns now: 0 answer, 3 decline.** All three got only "Greenfield Meadows" (0.685).

### 5. real-estate: "What amenities does the project have?"

- **Answer is on:** `/project` "Clubhouse, pool, children's play area, and a 1 km walking track."
- **Search** (`Greenfield Meadows amenities list for the project (2 BHK 3 BHK Whitefield)`): best was the home sentence (0.764), then "Greenfield Meadows" (heading only, 0.732). The amenities chunk was hit #4 at 0.555, far below the floor of 0.684.
- **Passages:** P1 home sentence, P2 "Greenfield Meadows".
- **Draft:** intent `answer`, citing P1 and P2, but opening "I don't have the project's amenities listed…", with the sales phone and the 2/3 BHK sizes (1,150 / 1,540 sq ft). The sizes came from the bot's persona instructions, which the builder wrote with facts in them.
- **Check:** `_read_draft` → `says_it_has_nothing` relabels it a decline. Then `_drop_unsourced_details` → `UNSOURCED_DETAIL` (phone and sizes not in any passage).
- **Rewrite / final:** decline, phone sentence cut: "I'm sorry — I don't have the project's amenities list in the information I can access. I can help here with other details…"
- **What made it a decline:** the model (line 12), confirmed by `says_it_has_nothing`. Cause: selection band.
- **Reruns now: 0 answer, 3 decline.** All three got only "Greenfield Meadows" (0.72–0.73).

### Pattern

All five pages are short. The chunker turns each page heading into a tiny chunk of its own, and the agent's queries name the business, so that chunk often scores highest. The selection band is relative to the best hit, so one heading-only chunk at the top pushes everything useful out. The agent then declines honestly, the check's rules work as designed, and `USE_FOUND` can't rescue a reply whose passages don't hold the answer. The agent rarely searches a second time, because its first search "found" something. When it did search again, it found the answer each time. This also affects v1, which uses the same `_select_passages`. Two smaller things made the replies worse: the builder puts facts and the phone number in the persona instructions, so drafts carry details the check then sends back (`UNSOURCED_DETAIL`); and 2 of 15 reruns hit the 20 s run cap and returned 504.

### Suggested fix for 20a-2 (task 1, target 0 wrong declines on the fixtures)

Suggestions only; nothing here is built.

1. **Keep headings with their section.** In `extractPastedText`, start a section at its heading line, not after it, so "Greenfield Meadows" is part of the chunk that describes it. Or merge any chunk under ~10 tokens into the next one. Re-index the fixtures. This alone removes the top hit in 1, 4 and 5.
2. **Don't let a tiny or weak top hit set the band.** In `_select_passages`, ignore chunks under a minimum token count when finding `best`, and always keep at least 4 passages above `decline_similarity`. With that rule, every answer chunk above would have been offered: they ranked 2nd to 4th among the hits, with scores of 0.54–0.62, far above 0.30. This is shared with v1, so check v1 parity.
3. **Send a decline back to search again.** When the agent declines after one search and has searches left, have the check send it back with "search again with different words" (a new rejection, or `USE_FOUND` with that sentence added), whether or not the question names the organisation. Today `USE_FOUND` doesn't ask for a new search and only fires when `organisation.named_in(question)`. In the reruns, a second search found the answer every time.
4. **Keep the business name out of queries for its own pages.** Rule line 10 of `agent/system` makes queries self-contained, so the agent adds "Prana Yoga Studio" to every query, and that is what matches the heading chunks. A prompt change goes through the Skills Store as a new version, not the `.txt` file.
5. **Builder: no facts or phone numbers in the persona instructions.** They make the agent write details the check then strips (`UNSOURCED_DETAIL`), which costs a rewrite and turns answers into declines (question 5).
6. **Make the checkup catch this.** For each fixture question, assert that the page holding the answer is among the passages offered (`state.passages`, or the response's `retrieval.hit_chunk_ids` against the selected set), not only that the reply has a source. Run each question 3 times: results vary by query wording.
7. Minor: `organisation_of` reads "Batch timings", "Courses" and "Location" as organisation names, because builder pages are titled "Page — Business" and the code takes the left side. Harmless here, but `USE_FOUND` and the "about the organisation" rules then trigger on ordinary words.
