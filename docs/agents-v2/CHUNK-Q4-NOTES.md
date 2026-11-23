# Q4 light: notes

> In progress on `fix/agents-v2-q4`. The code map, decisions and results are filled in as each section lands; the before/after is at the end.

## Decisions

- **Keyword search beside vector search: added in Q4 (Shehbaz, 23 Nov),** because 28 of the 40 in-data misses at the first measurement were search misses. Weaviate hybrid in the same query, with one setting to turn it off.
- **Keyword search measured, and off by default (23 Nov):** at weightings 0.7, 0.5 and 0.3 it found the expected fact for 2 of the 8 exact-term misses, against 4 for vector search alone, at the same speed (p50 about 340 ms with the query's embedding, every setting). The facts sit in short fragment chunks the page reader cut: "Dr Priti Udhay" (chunk 73) before "Head - Oculoplasty & Aesthetic Services…" (74); "Call Us 95949 04015" in the navigation; "Home Vaccination" as one list item. The question's words are in the chunk beside the fact, so neither search reaches it. The code and `KNOWLEDGE_AGENT__HYBRID_SEARCH` stay; the fix that fits is giving a short chunk its neighbours (asked of Shehbaz).
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
