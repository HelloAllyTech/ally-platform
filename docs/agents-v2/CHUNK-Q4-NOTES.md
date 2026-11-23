# Q4 light: notes

> In progress on `fix/agents-v2-q4`. The code map, decisions and results are filled in as each section lands; the before/after is at the end.

## Decisions

- **Search misses: neighbour chunks in Q4, keyword search built but off (Shehbaz, 23 Nov).** 28 of the 40 in-data misses at the first measurement were search misses. Keyword search (Weaviate hybrid, in the same query, `KNOWLEDGE_AGENT__HYBRID_SEARCH`) was tried first: alone it found the fact for 2 of the 8 exact-term misses, against 4 for vector search. The facts sit in short fragment chunks the page reader cut ("Dr Priti Udhay" as chunk 73 before "Head - Oculoplasty & Aesthetic Services…" as 74; "Call Us 95949 04015" in the navigation; "Home Vaccination" as one list item), beside the chunk the question's words match. So a found chunk now takes its short neighbours on the same page (`KNOWLEDGE_AGENT__NEIGHBOUR_CHUNKS`, on). Shehbaz's bar: at least 6 of the 8, search within about 150 ms. The 8 misses (b3-f07, b1-f07, b2-f04, b1-f02, b1-f10, b3-f08, b5a-f10, o5-f04), found in the top 8, search time p50 with the embedding cached (it costs about 300 ms the same in every setting):

  | Setting | Found | Search p50 |
  |---|---|---|
  | Vector only (before) | 4 of 8 | 9–16 ms |
  | **Vector + neighbour chunks (Q4)** | **6 of 8** | 19–46 ms |
  | Hybrid 0.5 + neighbour chunks | 7 of 8 | 69 ms |

  Neighbour chunks met the bar. Hybrid stays built and off; with neighbours it adds b2-f04 for about 50 ms more, so it's one switch for Phase 3 or now. b1-f02 (the main phone number, a navigation fragment) is left to key facts.
- **A message mostly in another script (Hindi, Tamil, Bengali) is not pre-searched as written** (23 Nov): the agent writes the English query the search tool asks for. The as-written pre-search (H1 Part C) found nothing for 8 of the 17 non-English misses; the fix alone recovered 7 of the 17 on a re-run.

## For RC1: Postgres specs that fail on master too

Run with `CHATBOT_STORE_TEST_DB` on `ally_t1_test`. Each also fails on a clean checkout of `master` (checked 23 Nov), so Q4 leaves them alone:

| Spec | Test | What fails |
|---|---|---|
| `ally-be/src/chatbot/inbox/test/inbox.pg.spec.ts` | lists Safety first, then Needs a person, then the newest; unread until opened | `TypeError: Cannot read properties of null (reading 'length')` at `inbox.service.ts` `list()`: `this.scope()` returns null in the test's context |
| `ally-be/src/chatbot/inbox/test/inbox.pg.spec.ts` | marks website chats, and filters Website apart from Bot page (chunk 13) | the same |
| `ally-be/src/bot-draft/test/bot-draft.pg.spec.ts` | publishing twice converges one live chatbot, one page and one access list | expects `safety_pack_version: 1`; publishing stores the pack's current version (Mental health is 2 since SP1) |

## Local setup used for the measurements

- User 25 on `ally_local` is on the Internal plan (it had 21 live assistants, over the Free plan's 3 publishes).
- A local 12-hour owner token, signed for the use-case suite's setup.
- The suite signs in to an invite-only page once per invited address and starts a new chat for each conversation: the page limits sign-in codes per address, which refused O4's last conversations in the first measurement (a test artefact, not a product bug).
- A flaky ally-ai metering test passed on retry.
- **BHIVE re-read for C15 (23 Nov):** its two day-pass pages were read again from the site with the fixed reader (81 struck prices labelled "(was ₹…)") and re-indexed. Its setup facts and "What we learned" text, written from the old reading, had their three struck prices relabelled the same way and were re-indexed, as a re-read of the site would have done. Other assistants' pages were read before the fix and keep the old text until they're read again.

## In-data misses by cause (measurement `2026-11-23-after-A-1`)

The 40 in-data questions not answered right on the 11 assistants compared like for like (Scripbox's 6 are left out: it is a new baseline). For each, `misses.py` (scratchpad) read the passages search returned (from Weaviate by chunk id), the assistant's stored documents and settings, and the reply, and looked for the expected fact in each; then each was read by hand.

| Cause | Misses | Of which not English | Cases |
|---|---|---|---|
| (a) Search didn't return the passage; the fact is in the indexed documents | **28** | 17 | English (11): b2-f01 (helpline number), b2-f04 (home services), b3-f07 (Death Eater jacket price), b1-f02 (main phone; a branch number given), b1-f07 (head of oculoplasty), o2-f02 ("at home"), o2-f05 (cities), o1-f01 (Mon–Sat), o1-f02 (call charges), o5-f03 (who they feed), o5-f04 (founded where and when). Not English (17): b3-f08, b3-f09, b1-f10, b5a-f09, b5a-f10, o2-f09, o1-f08, o1-f09, o3-f09, o3-f10, o5-f05, o5-f06, o5-f08, o5-f10, rha-L1, rha-L2, rha-L3. 8 of the 17 (Hindi, Tamil, Bengali) got no passages at all and replied "I don't have that information" |
| (b) Not stored, or stored wrong | 2 | 0 | b5b-f01 (BHIVE BKC day pass: struck-out ₹200 kept beside ₹100, the reply gave ₹200; C15), o6-f01 ("no pickup from homes" isn't in the stored information) |
| (c) Passage found, reply left the fact out or got it wrong | 2 | 0 | o1-f06 (email given as icall@tiss.edu; the passage says .ac.in), rha-Q3 (zero-funds said, "no 80G receipt" not) |
| (d) The grader (or the set's expected answer) was wrong | 7 | 1 | b1-f06 (asked about the gym; "no swimming for a month" marked missing), b1-f03 and b1-f09 (Chennai hours: the pages say 9–8 at Tambaram, the set 9–7 "typically"; the reply gave a sourced one), o6-f02 and rha-Q2 (details from a passage it did retrieve marked invented: 10BE, Delhi's 276 Robins), o5-f09 ("3 hours a week" marked invented; it's on the Join Us page), b3-f03 (the set expects ₹3,228; the stored pages say ₹3,133, so the set is out of date or the price changed) |
| (e) Right answer, failed another check | 1 | 0 | o2-f01: "(see source)" stray text (C16) |

**(a) is the biggest group, 28 of 40.** Search is vector-only today (`ally-ai/app/core/vector_db/weaviate.py`, `near_vector`); Weaviate can add keyword (BM25) search in the same query (`hybrid`), which would catch exact terms: names, phone numbers, product names.

### The C and G items, by the misses each would fix

Counts overlap: one miss can be fixed by more than one item.

| Item | Misses it would fix | Which |
|---|---|---|
| G3 Key facts always in context (contact, hours, fees, what it does, where) | ~19 | b2-f01, b1-f02, b1-f10, o1-f08, o1-f06, o1-f01, o1-f02, o5-f05, o5-f10, o5-f06, o5-f08, rha-L1, rha-L3, rha-Q3, o2-f02, o2-f05, o2-f09, o5-f03, b3-f09 |
| C14 Search in English as well as as written | ~17 | the 17 non-English (a) misses |
| Keyword search beside vector (not in Q4 yet) | ~8 | b3-f07, b1-f07, b2-f04, b1-f02, b1-f10, b3-f08, b5a-f10, o5-f04 (exact names, numbers, product and place names) |
| C18 Answer instead of "which one?" | 3 | b5a-f09, o3-f10, rha-L2 |
| G4 Low-value pages (main contact from the home or contact page) | 3 | b1-f02, b1-f10, o1-f08 (a branch or donate-page number given as the main one) |
| E grader fixes (hand-rulings set) | 6 | b1-f06, b1-f03, b1-f09, o6-f02, rha-Q2, o5-f09 |
| C15 Struck-out prices | 1 | b5b-f01 |
| C16 Stray text | 1 | o2-f01 |
| C19 The right number | 1 | o1-f06 |
| Set fixes | 2 | b3-f03 (check the live price), o6-f01 (check the expected answer against the updates list) |

## Status by item (23 Nov, after the single measurement `2026-11-23-after-C-1`)

| Item | Status |
|---|---|
| §0 Use-case suite | Done: 13 sets, runner, re-grade, `compare.mjs`, `confirmations.mjs`. `round8.json` not started |
| A0 Publishing works | Done (background safety recheck). The missing "double-checking" message on the page: to check (demo build) |
| A1 Emergency keywords on every pack | Done: life-threatening rules on every pack, deciding at once (23 Nov); maternity medical-only |
| A2 The right pack | Part: code and prompt done; the 15-site pack fixture not run |
| A3 Correcting the pack in setup | Done; A3+ (internal assistants' pack) from the demo build not started |
| A 3b "Do I have depression?" | Not started |
| A 3c Preview samples | Done |
| A 3d Palliative and medicine questions | Not started |
| B4 Try it says "not saved", holds the slot | Done |
| B5 Details given before the chat | Done |
| B6 One question, not two | Done (prompt C6) |
| B7 Availability always looked up | Done (prompt C6, at least 8 a day) |
| B8 After a refusal, what's possible | Done |
| B9 Callback under the person's name | Done |
| B10 Callback list for "Bring in customers" | Done; B10+ (no lookup it can't do) from the demo build not started |
| B11 "Change entries: Do it" sticks | Part: the settings save keeps abilities and the home queues changes; not re-checked in the wizard |
| B12 Checkups as a test person | Done |
| B13 Booking for someone else | Done |
| C13b Citation markers on the live page | Part: removed in every reply; the Try it vs live comparison test not written |
| C14 Same facts in every language | Done (pre-search fix, as-written search) |
| C15 Struck-out prices | Done for new reads; BHIVE fixture re-read |
| C16 Stray text | Part: "(citations: 15, 14" found in this run; the demo build's three forms to add |
| C17 Name-and-phone offer only when it helps | Not started |
| C18 Answer instead of "which one?" | Done (D1) |
| C19 The right number | Part: through key facts |
| C20 Off-topic and "ignore your instructions" | Part: judge rule 8 only |
| C21 Worried and medicine messages | Not started (a check) |
| D22 Fewer rewrites | Not started |
| D23 Reasoning effort "minimal" | Not started (stop 3) |
| D24 WhatsApp typing indicator | Not started |
| D25 Cold start | Not started |
| E25b Setup under load (pool) | Not started |
| E26, 26b Grader passes correct answers | Part: judge rules 1, 5, 8, 9, reads 16 passages with neighbours, hand-rulings in the sets; the 95% hand-rulings agreement set not built |
| E27 Checkup counts | Not started |
| E28 Every pack's safety questions | Not started |
| F29 Owner-side copy fixes | Not started |
| G1 Hand-over never replaces an answer | Done (14 → 0); G1b (off by default) from the demo build not started |
| G2 Channel rules only on their channel | Done |
| G3 Key facts | Done in the run; editing them in What it knows not started |
| G4 Low-value pages | Part: never key facts; the reader's marking not started |
| G5 Consent question and card | Done |
| G6 Memory after a list conversation | Done |
| G7 Crisis numbers verified | Part: confirmed numbers only, upset numbers; the 3am reply (G+10) not started |
| G8 Speed on these turns | Not started |
| G+9 "unchanged" in names | Done in code and a repair migration; not re-checked on a live page |
| G+10 The 3am message | Not started |
| G+11 Medicine and allergy: decline, not hand-over | Part: the hand_over description |
| G+12 Graded urgency | Not started |
| G+13 The owner's answer wins | Not started; G+16b (negative answers as rules) from the demo build not started |
| G+14 "Replace them" link | Done |
| G+15 Campaigns "Set it up" | Not started |
| G+16 T2's three | Not started |

## For Phase 3: in-data misses left after Q4 (`2026-11-23-after-C-1`, view 3)

28 misses (23 on the 11 like-for-like assistants; Scripbox 3 and Teach For India 2 as new baselines), each read by hand with `misses.py` (search results, stored information, reply). Not fixed in Q4 (Shehbaz, 23 Nov: no more answer-quality rounds; 62% under the old grading and 75% under view 3 are short of 85%).

| Cause | Misses | Cases, and the likely fix |
|---|---|---|
| The reply had the passage but left the fact out or got it wrong | 12 | b1-f10 (a branch's enquiry number given though the main one was retrieved: the main contact from the home page, G4), b3-f03 (₹3,133 retrieved; "no product named Icy Pink co-ord set": match product names loosely), b5a-f09 (₹500 retrieved; "prices vary by hub": give what is listed), o2-f05 (cities retrieved in part; "across India"), o3-f01 (the receipt's PAN details left out), o4-f05 (the WFH limit retrieved; declined), o4-f10 (Hinglish: offered to forward the question instead of answering), o5-f04 (founding year retrieved; declined), o5-f05 and rha-L3 ("no 80G" left out after "zero-funds": a key fact phrased for both), o5-f09 (Marathi: the Join Us link left out), rha-L2 (Tamil: asked back). Likely fix: a "use what you found" rewrite when a declined or vague reply had a passage with the answer, and key facts that pair related facts |
| Search didn't return the passage | 8 | b2-f04 (home physiotherapy, a list item beyond the neighbour reach), b3-f07 and b3-f08 (product prices in a large catalogue), b4-f05 and b4-f10 (Scripbox's financial-plan fee, English and Hinglish), o1-f10 (iCall's privacy details, Hinglish), o3-f04 (household items), rha-Q2 ("free to join, Join Us page"). Likely fix: a catalogue read as a list (one entry per product, findable by name), list-aware chunking (a list kept with its heading), and hybrid weighting tuned on the full suite |
| Sources disagree | 3 | b3-f04 (owner's 15-day returns vs the product pages' 30 days: G+13, the owner's answer wins), b3-f10 (several oversized T-shirt prices), o3-f09 (internship types and stipends on different pages). Likely fix: G+13, and setup asking which is right when facts conflict |
| Stray text | 2 | b5a-f04 and o1-f02: "(citations: 15, 14)", a C16 form not yet removed (with C16) |
| The grader or the set | 2 | b5b-f01 (the reply gives "₹100 (was ₹200)", right since C15; the set's must-not forbids any ₹200: set fix), o1-f09 (the core answer right; "referral to professionals" asked as extra) |
| A hand-over replaced the answer | 1 | b4-f06 (Scripbox): hand-over off by default (H5) |
