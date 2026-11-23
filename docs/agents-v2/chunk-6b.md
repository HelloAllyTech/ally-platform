# Chunk 6b — Booking polish, and every open item from the fast track

> Brief for Claude Code. Read `CONTEXT.md`, `EPIC-6B-R2.md`, `CHUNK-06-NOTES.md`, `CHUNK-05B-NOTES.md`, `CHUNK-08A-NOTES.md` (§5, the Amaha fixes and "Still open"), `CHUNK-03B-NOTES.md` (§6), `CHUNK-03A-NOTES.md` (the retrieval-log items), `CHUNK-A1-NOTES.md` (access is members-only now: eval and checkup tokens must be on the assistant's team) and `CHUNK-SP1-NOTES.md` (the evals behind section F, and lists.txt versions 4 and 5 behind item 29), then this file. Plan first, as usual. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-6b`, from master (A1 and SP1 are merged). Tag commits `[6b]`. Repos: all three.
> **One stop for Shehbaz:** every prompt or tool-description text this chunk changes, sent together in one Markdown file. Draft them first and keep building.
> **Goal:** after 6b, bookings can go on for pilots, and the bot page and bubble show the assistant working. About 2 days (sections A–F, items 1–30).

## A. Booking behaviour

1. **No slot at the time asked.** "Thursday evening" on a list whose Thursday ends at 16:00 must get "Nothing's free on Thursday evening. The latest is 16:00, or Friday has 18:00 and 19:00", from a find, cited. Today it gets the decline wording, a v1 fallback or a hand-over. Find where it goes wrong (the empty find, the check's send-back, the decline gate) and fix it in code. An empty find is an answer, not a missing source.
2. **The forced-search step** fails the run when the model replies anyway and too little time is left (8a notes). When the model replies instead of searching, take its reply through the normal checks; never fail the run for it.
3. **Slow booking turns** (35–50 s on Amaha; 12–17 s median elsewhere). Trace three slow turns and fix the causes (repeated finds, send-backs, retries). Target: median under 13 s, worst under 20 s, across 6's action cases.
4. **Option 1 (decided): the booking rules live in the lists section,** so every purpose with a create tool follows them, not only Bring in customers: book directly once confirmed; ask for a name once only when unknown; "the team will confirm" only when entries start as requested. The can-book variant keeps only what's specific to enquiries. Prompt text: at the stop.
5. **The time check reads further back:** the person's last 4 messages, not 2, so a time confirmed a few turns earlier still books. A bare "at 1" to "at 7" with no am or pm means the afternoon or evening, unless only the morning time exists in the list.
6. **One retry after `invalid_value`** (a shortened id): the failed tool stays offered once more in that run. Every other failure still stops it.
7. **Asking an optional detail twice** (the service): the lists section says to ask for an optional detail at most once, and book without it if the person skips it. **Stray phrases** after citation cleanup ("See the slot info:.") are removed.
8. **The `in_use` race:** a create locks its relation targets `FOR SHARE` in `checkRelations`, so a slot deleted at the same moment can't leave a booking behind. Postgres test with two connections.
9. **A time zone per assistant:** a setting in How it works (default Asia/Kolkata), used by lists, `{today}`, Repeat weekly, the time check and hand-over hours (which keep their own zone if set). Shown wherever times are.

## B. Hand-over

10. **With `hand_over` off,** the assistant never promises "I'll pass it on" or "the team will get back to you". When no hand-over and no callback list are offered, the check trims those promises and the reply says how to reach the team from the information.
11. **The hand-over summary:** one sentence, at most 160 characters, what the person needs, never guessing the channel (the run's channel is passed in). Its description text: at the stop.
12. **The Overview's "Handed to a person"** counts hand-overs (asked, assistant, needs person), not team replies.

## C. Data and logs

13. **Erasure reaches list entries:** erasing a contact deletes their entries in lists with a person field, and blanks any other relation-to-contact field pointing at them. Remove the manual-erasure line from `LAUNCH-CHECKLIST.md`. (Export and caps stay in 21a.)
14. **3a's retrieval-log items:** later searches in the same message, and searches made as a tool, are logged in the retrieval log.

## D. Housekeeping

15. **ally-web lint:** the prettier error in `ally-helpline-dashboard/…/CustomFieldValuesPanel.tsx`.
16. **Host test bot:** neutral decline wording (local data only, so basics' platform pattern stops tripping).
17. **The public wiki** (`repos/ally-be.md`, `repos/ally-ai.md`): the list routes, the gateway's list tools, memory routes.

## E. Show the assistant working, on the bot page and the bubble (decided 16 Nov)

Today the bot page and the website bubble (the same page in a frame) show one loader until the reply arrives, often 10–15 s on a booking. People should see what the assistant is doing, step by step, the way a good chat product does. **WhatsApp stays as it is** (its typing indicator).

18. **Live steps while it works,** from the run's existing step events (3c streams status and steps to Preview; check what `messages/stream` already carries and add what's missing in ally-be). Each step is one calm line with a small animated icon, replaced or ticked as the next one starts:
   - "Reading your message…"
   - "Searching {organisation}'s information…" (a knowledge search)
   - "Checking free times…" / "Looking in {list}…" (a find; the list's name as the owner wrote it)
   - "Booking Thu 19 Nov, 11:00…" / "Cancelling your booking…" / "Updating your booking…" (a create or update, with the record's title)
   - "Passing this to the team…" (a hand-over)
   - "Writing a reply…"
   Never shown: tool or field names (`find_appointments`), ids, search queries, memory text ("remember" never appears), refusals' internal codes, or anything from a check that sent a reply back.
19. **After the reply,** the steps collapse into one quiet line under it, "Checked free times · Booked Thu 19 Nov, 11:00", which opens to the list of steps with their sources. A booking or change made in the reply gets a small confirmation card (what, when, with whom), from the stored record, not the model's text.
20. **The reply text** appears progressively once it has passed the checks (3c's reveal), never before. **A crisis or Safety reply never streams and shows no steps:** it appears whole, as today.
21. **Feel:** a steady rhythm (a step shows for at least 400 ms so lines don't flicker); the reply area doesn't jump; works at 390 px; `aria-live="polite"` for the steps, the reply announced once; reduced motion respected; every string in the bot page's copy files with Hindi marked "needs review".
22. **When it's slow:** after 12 s with no new step, "Still working on it…"; if the run fails and v1 answers, the steps end with no error shown to the person.
23. **Owner control:** none needed in 6b; on by default for every v2 assistant's page and bubble.

## F. From A1 and SP1's evals (17 Nov)

24. **Out-of-scope declines stay generic.** On a poem or the weather, the decline may say in general terms what the assistant helps with ("I can help with questions about our courses"), but adds no specific facts: no phone numbers, prices or timings unless cited. Contact details only from a source (the existing rule). The judge is right to fail "Please call …" with an uncited number.
25. **The crisis reply fits the assistant.** On medical and pharmacy assistants, a physical emergency (chest pain, an overdose) gets "Call 112 or an ambulance (108) now", plus the bot's helplines; never "contact a supervisor" or a mental-health line alone. The mental-health wording stays for mental-health risk. Its text: at the stop. Find where "supervisor" comes from and remove it everywhere it doesn't belong.
26. **A number cut off after "Rs."** (Sunrise C4, the student-discount sum): find which step truncates it (citation cleanup, the sanitiser, the check) and fix it with a test; then C4 is judged on its answer.
27. **Memory: don't announce what isn't stored.** "I can't store medication details" was judged an uncited fact. The memory section says to simply not remember health details, without telling the person. Text at the stop.
28. **Pharmacy's prices question:** the reply listed what the store stocks without sources. Check it's grounded in the pharmacy's documents and cited, or declined.

29. **Taking a lead when the assistant can't answer (Ledgerly, 17 Nov).** On an assistant with a create tool on a list with a person or phone field (Leads, Callback requests), a question it can't fully answer (a price that isn't published) gets an offer to take their name and number, and once they give them, it saves them without asking "shall I save you as a lead?": giving their details for that purpose is their confirmation. Do it the way §7 did for booking: a variant of the answer purpose chosen in code only when such a tool is offered, plus the lists section's rules (item 4). Assistants without one keep today's prompt byte-for-byte. Target on Ledgerly: offered in at least 5 of 6 price questions, saved every time details are given, 3 runs. Text at the stop.
30. **Example choices never reach visitors.** While a select still holds the ready-made examples (Make it yours not done), the agent isn't given those options and never reads them out; it takes the person's words as free text or leaves the field empty. And the ready-made examples fit each list (Leads: "A demo", "Pricing", "Something else"), not the clinic's ("Consultation / Follow-up / Check-up").

## Out of scope

Dark mode for the home. Hindi review. WhatsApp buttons for slots (10). Ask me first (14a). Export and caps (21a).

## Tests

- Unit and Postgres tests for each numbered item.
- **E:** unit tests for the step lines (never a tool name, id, query or memory text), Playwright on the bot page and the bubble with a slowed fake stream (steps appear, collapse, the card shows; a crisis reply has no steps), axe clean, screenshots at 1440 and 390 for Shehbaz at the stop.
- **6's action cases** on a test bot (no purpose) and on a Bring in customers bot, **plus three new cases:** "Thursday evening" with no evening slots; a time confirmed 3 turns earlier; a cancel. **3 runs each, all pass.** Latency against the target in A3.
- **8a's memory cases** and **the Sunrise and fixture checkups:** unchanged (0 hard fails, 0 wrong declines).
- Full suites, lint and typecheck in all three apps, with the commit hook (never `--no-verify`).

## Done when

- [ ] "Thursday evening" gets the latest time and the next free evening, cited
- [ ] No run fails on the forced-search step; booking turns median under 13 s
- [ ] Every purpose that can book follows the same booking rules
- [ ] On the bot page and the bubble, a booking shows its live steps, then a collapsed "what I did" line and a confirmation card; a crisis reply shows none; WhatsApp unchanged; Playwright with axe at 1440 and 390
- [ ] Every item in A–F closed, or listed in the notes with why not
- [ ] `LAUNCH-CHECKLIST.md`: the line "don't turn Add on for an enquiries pilot" removed; "bookings for pilots after 6b" added
- [ ] `CHUNK-06B-NOTES.md`; the Progress row; `PR-6B.md` (what changed, what pilots can now turn on) <!-- docs-path-lint: planned -->
