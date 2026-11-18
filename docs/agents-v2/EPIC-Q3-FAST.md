# Epic: Q3 fast track — the fixes real customers would notice first

> One session, about 5–5.5 days instead of 6, built from `chunk-q3b.md`, `chunk-q3a.md` and `chunk-q3c.md` with only their must-haves. Everything cut is listed at the end and stays in those briefs for later. Read with `FIXES-17NOV.md`. <!-- docs-path-lint: planned -->

## Order inside the session

### Part 0 — One path, no v1 (decided 18 Nov; about half a day)

- **No more v1 fallback.** When a run fails or runs out of time, the person gets a fixed, honest reply in their language ("Sorry, I couldn't answer that just now. Please try again, or contact {organisation}: {contact from sources}"), never the old pipeline's answer. The crisis check is unaffected (it never depended on v1).
- **One run path for every channel** (bot page, bubble, WhatsApp, Try it, checkups), with no runtime switch per bot or platform. Remove the switch from settings and screens; keep the v1 code only until R2/CL2 deletes it, unreachable.
- **Safety stays in two layers, simplified:** the way the assistant behaves (declines, medical, minors, finance) lives **in the prompt**, from the packs, as today. Spotting someone at risk or in an emergency stays **one fast check beside the run** (the keyword list and the classifier merged into one module), because it must answer in seconds, work even when the run fails or is talked into ignoring its rules, and send fixed, approved wording with real numbers.
- **Tests:** a failed or timed-out run sends the fixed reply, never v1; no code path still calls v1; the crisis check still answers when the run fails.


One path first, then safety, then answers, then the trust fixes in setup. Each part ends with its tests passing and a commit; the session tells Shehbaz before moving on.

### Part 0b — Booking that holds up with real customers (from section F of the E2E report; about half a day)

- **Free means free (C19):** a find on a list that others book into (Slots, Tables, Classes, Events, Property listings) shows only entries still free under the booking list's rules (one per slot, capacity), counting live bookings; "which tables are free?" never offers a taken one. Test on Table reservations (F5) and Appointments.
- **Refusals reach the customer in words (C19):** "That table is taken. Table 2 is free at 20:00." and "You already have 2 bookings; cancel one to book another", never "Something went wrong" or the fallback (F3, F4).
- **Tools stay for the whole conversation (C20):** find why the same chat lost its tools after a few turns and escalated itself with hand-over Off ("Couldn't help twice"); fix it; a test that a 10-turn booking chat keeps its tools; no automatic hand-over when hand-over is off.
- **Booking details (C21):** choosing between offers isn't a yes; confirm "Shall I book Sat 21 Nov, 20:00 for 4 at Table 1?" first; the reservation's title shows its table; finds match dates written as "21 Nov", "Saturday", "21/11".

### Part 1 — Safety (from Q3b; about 1 day)

1. **The eval suite** (Q3b §0), cut to the safety cases from both reports plus 10 everyday look-alikes. Run before changing anything.
2. **Three levels** (Q3b §1): at risk → the crisis reply with a real number; **medical emergency** → "go to the nearest emergency now, call 112 / 108", plus the business's emergency number from its sources; **upset, not at risk** → a warm, normal reply. Questions about the assistant itself ("what do you remember about me?", "do you have a helpline?") are never at risk. Classifier text at the stop.
3. **Sent immediately** (Q3b §2): the crisis and emergency replies go out as soon as the check decides; the agent's run is cancelled. Target under 6 s.
4. **Owners can correct a wrong pack** (Q3b §4): equal or stricter at once; less strict with a reason and a log line.
5. **Sourced general information isn't advice** on medical packs (C6: the site's own FAQ may be answered with its source).
6. **Young people:** no name or phone pre-chat questions.
7. **Finance (C17):** the legal and financial pack never runs a suitability interview or implies returns may be guaranteed; it says it can't advise on what to invest in and offers an adviser (P5, P6, P9).

### Part 2 — Answers (from Q3a; about 2 days)

1. **The suite and a quick diagnosis** (Q3a §0) on the round-3 cases only (The Souled Store, Cloudnine, Scripbox): for each failed case, the step that lost the fact. **Stop** with `Q3A-DIAGNOSIS.md` and the proposed fixes, ranked by how many cases each fixes.
2. **The top search fixes** the diagnosis points to (expected: facts and owner notes indexed as their own passages, keyword-plus-vector search, the decline threshold tuned on the suite, follow-ups searched with the conversation).
3. **No internal voice** (Q3a §2): "provided material / passages", "If I don't know the answer…" never reach a customer; when it truly doesn't know, one honest line and the real contact details.
4. **Honest offers** (Q3a §3): no "add to cart", "delivery estimate" or "shipping updates" without a tool.
5. **Memory on the live page** (Q3a §6): find why M1 and M2 failed; "please remember…" works; a new chat from the same visitor gets the memory.
6. **Speed** (Q3a §4): median under 12 s and worst under 20 s on plain questions, from 6b's tracing (send-backs that rarely help, the reply step, sequential calls).
7. **The whole suite:** the four round-1 and round-2 assistants (Mpower, Indian Accent, Honer, Neemrana) join the round-3 three.
8. **The right number (C15):** when two figures are close (RIA versus PMS registration), cite the one whose passage answers the question; a source label is never a phone number.
9. **Hand-over and leads in conversation (Q3a §5):** no automatic hand-over mid-chat (S12); a callback request is taken when a list can, otherwise the real number from the sources, never an unsourced one (C8c).

Target: **at least 85% pass** on the round-3 in-data cases , no internal-voice replies, no false offers.

### Part 2b — Tools bring their own instructions (decided 18 Nov; about 1 day)

Adding a tool must change how the assistant behaves, whatever purpose was chosen at setup. Today that's done with one-off purpose variants in code (`purpose_enquiries_can_book`, `purpose_answer_takes_details`). Replace them with one general mechanism:
- **A playbook per kind of tool,** an Ally-written prompt section (Skills Store, approved like any prompt) added to the run **only when that tool is offered**:
  - **Booking** (Appointments, Table reservations, Site visits, Classes, Events): find before offering, confirm the exact time, book, cite; the 6b rules.
  - **Taking details / sales** (Leads, Callback requests, Admissions enquiries): when it can't fully answer or the person shows interest, offer to take their details; ask only what the list needs; giving details is the confirmation; never pressure, never promise prices or outcomes that aren't in the sources.
  - **Orders and support** (Orders, Support tickets, Memberships): look up only the person's own entries; ask for the order number when needed; say plainly what the status means; raise a ticket when it can't help.
  - **Reference** (Products, Price list, Service areas, Menu): quote exactly as listed, with the source; never invent availability.
  A list made from scratch gets the playbook for what its tools do (a create on a list with a date-and-time relation is booking; a create on a list with a phone or person field is taking details; read-only is reference).
- **The purpose sets the goal and tone; the playbooks add behaviour.** Several playbooks can apply at once (a clinic with Appointments and Callback requests gets both), in a fixed order, within the prompt budget.
- **The owner's own line per list:** "How should your assistant use this list?" (Tools → the list → What your assistant can do), a short free-text instruction added under that list's playbook as the owner's layer (it can't override safety or the playbook's rules).
- **How it works** shows each active playbook in plain words ("Because you added Appointments, your assistant finds free times, confirms the exact time and books it").
- **Tests:** each playbook appears only with its tools; an assistant with no tools is byte-identical to today; 6b's booking cases, the Ledgerly lead probe and the round-3 suite pass at least as well as with the old variants. Playbook texts go to the prompt stop.

### Part 3 — Trust in setup (from Q3c; about half a day)

1. **Never store an error page as a fact** (403, captcha, empty).
2. **The grader stops failing correct answers** (B9), and **the setup message matches the score** (no "You're ready" at 38%).
3. **A publish gate:** every safety question passing (with a real number) and at least 70% of the rest, or "Publish anyway" with the score shown.

## Stops

1. After Part 1's drafts: the classifier and reply texts, before → after.
2. After Part 2's diagnosis: `Q3A-DIAGNOSIS.md` and the ranked fixes.
3. After Part 2's fixes: the prompt texts, before → after.
4. At the end: `PR-Q3-FAST.md`.

## Cut for now (later, from the full briefs)

- **Q3b:** new maternity, lab and vet packs (owners can switch to medical meanwhile); setup finding the helpline on the site (the default numbers cover it); the crisis-text editor (B7); fixed translations of the crisis reply in every reply language (English and Hindi only for now).
- **Q3c:** reading sites that block bots or need a browser; "Describe your business" asking the basics; multi-branch; all screen and setup polish (team reply after New chat, page language, Try it blank, languages, names, step counter, branding).
