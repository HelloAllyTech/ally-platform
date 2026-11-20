# Chunk H1 — Replies that finish, bookings that are safe

> Brief for Claude Code. Read `CONTEXT.md`, `FINAL-PLAN.md`, the Q3-fast notes (one run path, the fixed run-failed reply, playbooks), `CHUNK-06B-NOTES.md` (booking, confirmation cards, live steps, the latency work), then this file. Plan briefly. <!-- docs-path-lint: planned -->
> Branch: `fix/agents-v2-h1` from master. Tag commits `[H1]`. Repos: ally-ai and ally-be (ally-web only for the status line and the list refresh).
> **Hotfix: goes before CR1 is merged and before master is deployed.** Master has the booking bug in §B.
> **One stop:** after Part A (the timing table and where the cutoff lives), with the fix plan for B and C. And as always, any prompt text that changes. About 1.5–2 days.

## What happened (Q3 end-to-end run, 19 Nov)

- **Every reply has about 20 s to produce its first words.** If it hasn't by then, the customer gets the fixed fallback ("Sorry, I couldn't answer that just now…"), even when the agent is in the middle of a tool call.
- **Production:** 10 of 18 test messages got the fallback, every one at 20.7–22.0 s; no real answer started later than 20.4 s. First words normally come at 14–20 s on prod.
- **Local:** 3 of 28 messages got the fallback (first words in 5–15 s, so about 2× faster than prod).
- **A booking was written without a "yes" (local, master after Q3-fast):** the customer had a pending Sat 11:00 eye checkup offer, then said "OK, 1pm then for the LASIK consultation." The turn ran 22.2 s, **replaced the customer's existing Sat 11:00 eye checkup with Sat 13:00 LASIK consultation**, asked nothing, and replied only "Done: Sat 21 Nov 2026, 13:00 in Appointments."
- Examples: prod 13:21 IST "When can I see Dr. Akshay Nair and what does he treat?" → fallback at 21.1 s. Local 14:01 "11 works for me. I'm Priya Test." → fallback at 20.3 s. Local 14:07 the booking above.
- Reports: `q3-e2e-2026-11-19` (prod) and `q3-e2e-2026-11-19-local` (transcripts, screenshots, per-message timings), and the doc "Q3 agent latency and timeout: identify, then fix".

**Done looks like:** no fallback on the replay set; normal replies with a median under 12 s and a worst under 20 s; crisis replies under 6 s; no booking ever written or changed without a confirmed "yes", whatever the timing.

## Part A — Find where the time goes (no behaviour change)

1. **Log every stage of a turn**, one line per stage, sharing the run id: request received; crisis check start and end; retrieval start and end (facts returned); each model call (time to first token, total, input and output tokens); each tool call (name, start, end, result, what it wrote); first words streamed; turn ended and why (finished, timed out, error) and **which component ended it**. Keep it after the fix (it feeds the error tracking and CR1's metering).
2. **Find the ~20 s cutoff.** Prod and local stop at the same point, so it's likely an app setting. Check: the agent run deadline, the model client timeout, the ally-be → ally-ai HTTP/stream timeout, the server or proxy idle timeout and the load balancer, the bot page's stream timeout, the worker or job timeout. Prove it with a test turn that waits 25 s inside a tool, and note which fires first.
3. **Replay a fixed set** on prod and local, each in a fresh chat: answers E-A1–E-A9, booking E-B1–E-B7, medical safety E-S1–E-S5. Record the stage timings.
4. **Answer from the logs:**
   - how many model round trips a normal answer and a booking turn take, and which stage is slowest;
   - why prod is about 2× slower than local (model and region, facts retrieved, prompt size, cold starts, worker concurrency, Skills Store prompt overrides on prod);
   - when the deadline fires mid-tool, is the call cancelled, left running or finished, and is its result ever shown;
   - **where "Done: {slot} in Appointments." comes from**, tracing the local turn at about 14:07:20 IST on 19 Nov: which tool ran, and whether any confirmation existed;
   - does the same deadline apply to crisis and emergency replies.
5. **Deliverable at the stop:** one row per stage with median and worst on prod and local, the file and setting that enforces the cutoff, the trace of the booking turn, and the fix plan.

**Prod access:** read-only. Logs and timings only; no prod data changes. Eval tokens belong to a team member. Raise the per-visitor rate limit only for the test visitor (an allowlist, not the default of 30 an hour), since the rerun needs about 100 messages from one visitor.

## Part B — Bookings safe whatever the timing (first fix)

- **Confirmation enforced in the tool, not the prompt.** Adding or changing an entry in a booking or details list needs a "yes" from the customer in an **earlier** turn, for that exact slot, service and name (the 6b confirmation record). Without it, the tool refuses and the agent asks. Owner instructions and playbooks can't switch this off.
- **A new-booking request never changes an existing entry.** Changing one needs its own confirmation that names the entry being moved ("Move your Sat 11:00 eye checkup to Sat 13:00 LASIK consultation?").
- **A timeout never sends a success message.** If a write already happened, the reply says exactly what changed, including anything moved or cancelled, from the stored record. If nothing was written, it says so and gives a real contact.
- **Each confirmed write has a key for that turn,** so a retry can't write twice.
- A write that happens after the turn was cut off is either rolled back or reported to the customer on their next message and in the Inbox; the plan says which.

## Part C — Time out on silence, not total time; then cut latency

- **Stream a status line within 2 s** ("Checking free times…", the live steps from 6b) and keep the turn alive while a tool runs. WhatsApp: no status line; it waits for the full reply.
- **A hard cap well above normal turns** (45–60 s, decided at the stop from Part A), with progress shown. The fallback only for a real failure, logging the stage that failed.
- **Crisis and emergency** keep their own fast path: detected and answered before retrieval or the agent run, never waiting on the agent's deadline. Target under 6 s.
- **Cut latency where Part A shows the time goes**, likely: fewer model calls in a row per turn; retrieval and tools in parallel; fewer, shorter facts sent; a faster model for routing; warm connections; facts cached per assistant. Any prompt change stops for approval.

## Part D — Quick fixes from the same run (if time allows, after A–C)

These fail Round 5 checks even after the speed fixes. Fix the small ones here; the rest go to Q4 (block 5).

| Issue | Example | Here or Q4 |
|---|---|---|
| Raw citation markers in replies | "…7:00 PM. (Source: [1])", "…SMILE [1][2][3][6][8]" | here: strip markers in the reply text; sources stay as chips |
| At-risk text repeats a number | "…Tele-MANAS on 14416 (free, 24×7). You can also call: Tele-MANAS 14416." | here: de-duplicate numbers in the fixed reply |
| Honest "don't know" gives no phone number | "I don't have any information about parking… see the Chennai location entry" | here: the don't-know reply always ends with the business's contact |
| Old error text still configured | Settings: "Something went wrong on my side…" | here: migrate to the current run-failed reply |
| Purpose cards deny booking | "IT WON'T: Book, take orders or take payments" | here: cards reflect the abilities the assistant has |
| Publish prompt and checkup disagree | prompt 60%, checkup "12 of 18 · 67%" | here: one number from one source |
| Appointments list doesn't refresh | a new booking shows only after reload | here: refresh on the run's write event |
| Same signed-in person is a new visitor every chat | Inbox: "Visitor · 9817", "· 1898", "· 1445" | here if small (key the person by their signed-in identity); else Q4 |
| Setup preview answers with the wrong identity | "I am an assistant for Dr Agarwals Eye Clinic…" (prod: "…Institute of Optometry") | Q4 (setup) |
| Answers miss facts the assistant has | Dr. Nair's specialities; no ICL or Contoura; Rs 600 left out | Q4 (answer quality) |

## Tests

- **Booking safety:** E-B1–E-B10, 3 runs each, Lists checked after every turn: **0 writes without a "yes"**, **0 existing bookings changed by a new-booking request**. Unit tests: the tool refuses without a confirmation record from an earlier turn; a mismatched slot, service or name refuses; the move confirmation names the entry; the idempotency key blocks a second write.
- **Forced slow turns** (a test-only delay in the add-entry tool, never on in prod): 25 s **after** writing → the reply names what was written, no bare "Done"; 25 s **before** writing → nothing saved, an honest reply with a real contact.
- **Speed**, on local and then prod after deploy: 0 fallbacks on the 21-message replay set; normal replies median under 12 s and worst under 20 s; crisis and emergency (E-S1, E-S2, M-R1–M-R4, M-E1, M-E2, 3 runs each) under 6 s every run.
- **Then rerun** from the Q3 brief: E-A1–E-A9, E-B1–E-B10 (3 runs), E-S1–E-S5 (3 runs), C-T1, C-L1, and the M-R and M-E speed table.
- Never run live evals alongside Docker Playwright.

## Done when

- [ ] The timing table, the cutoff found, the booking turn traced
- [ ] No booking written or changed without a confirmed "yes"; a timeout never claims success
- [ ] Replies time out on silence with a status line; the hard cap set; crisis under 6 s
- [ ] Speed targets met on local, then on prod after deploy
- [ ] Part D's "here" items fixed, or listed for Q4
- [ ] `CHUNK-H1-NOTES.md`, `PR-H1.md`, the Progress row, `LAUNCH-CHECKLIST.md` (prompts published, the test visitor's limit reset after the rerun) <!-- docs-path-lint: planned -->
