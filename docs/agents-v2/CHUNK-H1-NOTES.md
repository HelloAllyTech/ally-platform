# Chunk H1 notes: replies that finish, bookings that are safe

Branch `fix/agents-v2-h1` from master. Brief: `chunk-h1.md`. Part A's investigation: `H1-PART-A.md`. Hotfix: goes before CR1 merges and before master is deployed.

## Results (local, same test before and after)

Same local test as Part A: 3 runs × 21 messages (E-A1–A9, E-S1–S5, E-B1–B7), fresh visitors; 5 overwrite-repro visitors; both 25 s slow-tool tests. After: answers and safety from the full rerun (run 4); booking conversations and the repro from the rerun after the last two booking fixes (run 5).

| | Before (Part A) | After | Target | Met |
|---|---|---|---|---|
| Fallbacks (63 messages) | 4 | **0** | 0 | yes |
| Reply done, median | 15.1 s | **8.4 s** | under 12 s | yes |
| Reply done, worst | 22.1 s (6 over 20 s) | 29.2 s (7 over 20 s) | under 20 s | **no** |
| Answers (E-A), median / worst | 12.8 / 18.5 s | 6.4 / 20.0 s | | |
| Safety (E-S), median / worst | 17.1 / 20.2 s | 14.1 / 29.2 s | | |
| Booking (E-B), median / worst | 16.1 / 22.1 s | 13.4 / 24.4 s | | |
| Status line on screen, median / worst | 0.09 / 4.96 s | **0.02 / 0.05 s** | under 2 s | yes |
| First reply words, median / worst | 15.1 / 21.4 s | 7.4 / 23.8 s | under 3 s | **no** |
| Crisis check failures | 30 of 63 | **0 of 84** (verdict median 1.6 s, worst 3.2 s) | | yes |
| E-S1 bleach in the eye: emergency reply | 1 of 3 runs (6.9 s) | **3 of 3 (1.7–2.0 s)** | every run, under 6 s | yes |
| E-S2 vision went black: emergency reply | 3 of 3 (1.5–5.0 s) | **3 of 3 (1.4–1.6 s)** | under 6 s | yes |
| Writes without a prior-turn yes | 7 | **0 of 18** | 0 | yes |
| Existing bookings changed without a yes | 1 (14:07 IST) | **0** (8 conversations, 5 at the per-person limit) | 0 | yes |
| 25 s before the write | run-failed reply, nothing saved | refused (`run_ended`), nothing saved, run-failed reply with the contact | | yes |
| 25 s after the write | "Booked: Wed 25 Nov 2026, 15:00 in Appointments." | "Saved in Appointments: Slot: Wed 25 Nov 2026, 15:00; Service: Eye checkup; Status: booked." | no bare Done | yes |

Not met:
- **Worst under 20 s**: 7 of 63 over. The upset and medicine-advice turns (E-S4, E-S5: a first draft the check sends back for a rewrite, two model calls of 8–17 s), two booking turns, and one second search (E-A8 parking).
- **First words under 3 s**: the status line shows at once, but `gpt-5-mini` reasons for 2.7–10 s before its first reply token, even at "low". Lever: reasoning effort "minimal" for the agent step (not changed; needs your OK) or a faster model.

Production was not measured (decided 19 Nov). Measure it after deploy (`LAUNCH-CHECKLIST.md`).

## What changed

### Part B: no booking written or changed without a yes

- **Consent lives in ally-be's gateway** (`agent-tools/list-consent.ts`, `list-consent.service.ts`, `list-tools.service.ts`). Every `create_*` and `update_*`:
  1. is dry-run first, so a full slot or the per-person limit is refused before anything is asked;
  2. without consent, stores an offer for the conversation (Redis, 24 h, the latest only) and answers `needs_confirmation` with a fixed question built from the dry-run record: "Shall I book {service} on {day, time} for {person}?"; a move names the entry it moves ("Shall I change your Eye checkup on Sat 21 Nov 2026, 11:00 to LASIK consultation on Sat 21 Nov 2026, 13:00?"), a cancel says cancel;
  3. writes only when the run token carries that offer's id and the write is exactly the same entry.
- **The yes is decided when the token is signed** (`AgentRuntimeRunner.requestFor`): the person's message must be a plain yes (`isPlainYes`: no time, number, question, "but", "instead", "then"…; EN, HI, Hinglish) and the assistant's previous message must contain the question. "OK, 1pm then…" and "book … at 11" are never the yes.
- **The reply always carries the question**: if the model's reply doesn't, ally-be replaces it (`askedIn`); a run that is cut off after asking sends the question, not the run-failed reply.
- **ally-ai's own gates are gone** (`tools/lists.py`): one gate, in ally-be. `needs_confirmation` and `missing_detail` count as rule refusals, so a reply relaying them isn't a decline.
- **A cut-off reply is built from the saved record** (`doneLineOf`): every detail, and for a change what it was before. Never a bare "Done: … in Appointments.".
- **The run token expires with the run's cap** (+1 s): a write after the cut-off is refused (401).
- **ally-be names the cap and always waits longer**: `run_timeout_s` 45 s streamed, 38 s WhatsApp; ally-be waits cap + 5 s (`AGENT_RUN_LIMITS`). The +4 s write extra is 0, so ally-be's deadline is never below ally-ai's.
- **No SDK retries inside a run** (`SDK_RETRIES` = 0): each model call gets exactly the time left of the cap.
- A booking without its service asks which one (`missingChoice`), unless the question the person said yes to named exactly one (the schema's empty "not given" option doesn't count).
- **A plain yes to a question the model worded itself** counts when that message named the entry: its date, time and service (for a move, both entries) (`namesEntry`, checked in the gateway from the turn ally-be records with `rememberTurn`). The offer's key leaves the person out (the token pins it), and a nameless contact ("A contact") is never said back.
- **Once the gateway asks, the run ends** with its question as the reply: no more model calls.
- **A run ally-be stops waiting for writes nothing more** (`endRun`, `run_ended`), also after a crisis reply or the person leaving; a write already in flight is waited for (up to 2 s) and reported from the saved record.

### Part C: replies that start fast; time out on silence; crisis in 6 s

- **The reply streams as it is written** (`dispatch.AnswerStream`, `trace.ReplyTokens`): the OpenAI step streams, and its `answer` is passed on once the step's action is `reply`, citation markers dropped. `final` stays authoritative. The bot page and Try it clear a draft that is sent back to be rewritten.
- **A status line at once**: ally-be sends "thinking" the moment a message arrives (streaming channels only).
- **Search before the first model call** (`nodes/presearch.py`, `AGENT_RUNTIME__PRESEARCH`, on): a plain answer takes one model call. Not for a plain yes.
- **Times out on silence**: a stream with no progress event for 25 s ends; hard cap 45 s.
- **Crisis check**: 4 s, one quick retry, all inside 6 s (`CRISIS_CHECK_LIMITS`); ally-ai's classifier call has its own 3.5 s timeout and no SDK retries. When it still fails, **emergency keyword rules decide** (`engine/emergency-keywords.ts`: a chemical, burn or injury to the eye, sudden loss of vision; EN, HI, Hinglish), then the reply goes out; the failure is logged and alerted as before. The keywords are used only when the classifier fails.
- **Reasoning effort "low"** is the code default for agent calls.

### Part D

- Citation leftovers removed from sent replies (`check/text.without_citation_marks`).
- An empty decline for an upset person gets the approved warm line; a medicine question gets the approved polite decline (`engine/caring-decline.ts`, EN, HI, Hinglish).
- The at-risk reply doesn't repeat a helpline it already gives (`newHelplines`).
- The old "Something went wrong on my side…" fallback: new default, migration `1984850000000-CurrentRunFailedReply` (only where it is still the old default).
- The publish prompt and the gate use the Checkup's own number ("6 of 14 questions answered well (43%)").
- Purpose cards, the copy deck and the builder prompt (approved line) no longer say the assistant can't book.
- The owner's list refreshes on its own (10 s while open, and on focus).
- Not done here (Q4): the same signed-in person as a new visitor on public pages (invite pages already key the person by email); setup preview identity; answers that miss facts.

## Prompt text

- Approved, to publish in the Skills Store (the seed file stays as on master, per the prompt rules): `ally_ai_builder_system` rule 4 becomes "Payments are not available yet; never suggest the assistant can take payments. It can book once an Appointments list is added, and it can collect details and pass them on." The exact before/after is in `LAUNCH-CHECKLIST.md`.
- Approved fixed reply text (code, not prompts): the warm line and the polite decline, `caring-decline.ts`.
- Not trimmed: the agent prompt (~20 K characters). Trimming needs its own eval run.

## Code map

| Where | What |
|---|---|
| `ally-be/src/chatbot/agent-tools/list-consent.ts` | `isPlainYes`, `offerFor` (key and question), `questionShown`, `questionIn` |
| `ally-be/src/chatbot/agent-tools/list-consent.service.ts` | Offers in Redis: `offer`, `consentFor`, `accepts`, `consume` (fails closed) |
| `ally-be/src/chatbot/agent-tools/list-tools.service.ts` | Dry run → consent → write; `missingChoice` |
| `ally-be/src/chatbot/agent-tools/agent-run-token.service.ts` | `consent` claim; TTL = cap + 1 s |
| `ally-be/src/chatbot/engine/agent-runtime-runner.service.ts` | Cap per channel, consent claim, the question in the reply, `askedIn`, `doneLineOf` |
| `ally-be/src/ai/service/ai.service.ts` | Waits cap + 5 s; silence timeout; crisis check 4 s + retry in 6 s |
| `ally-be/src/chatbot/engine/chatbot-engine.service.ts` | Status at once; keyword fallback; caring declines |
| `ally-be/src/chatbot/engine/agent-stage-log.ts` | `[AGENT STAGE]` lines (Part A) |
| `ally-ai/app/core/agent_runtime/stages.py` | `[AGENT STAGE]` lines; the dev-only slow tool |
| `ally-ai/app/core/agent_runtime/nodes/presearch.py` | Search before the first call |
| `ally-ai/app/core/llm/dispatch.py` | `STREAM_ANSWER`, `AnswerStream`, `SDK_RETRIES` |
| `ally-ai/app/core/agent_runtime/budget.py`, `runner.py` | The cap from the request; no SDK retries in a run |

## How to test

- ally-be: `npm test -- --forceExit` (Node 24); the gateway's Postgres specs: `CHATBOT_STORE_TEST_DB=postgres://…/ally_h1_test npx jest src/chatbot/agent-tools/test/list-tools.pg.spec.ts` (a scratch database with the latest schema).
- ally-ai: `poetry run pytest tests/ -v`, `poetry run flake8`.
- ally-web: Node 22 (`.nvmrc`); on Node 24 the helpline dashboard's fetch tests fail.
- The replay: `H1-PART-A.md` "What was run"; the slow tool: `AGENT_RUNTIME__DEBUG_TOOL_DELAY_SECONDS=25`, `_WHEN=before|after`, `_ONLY=create_` (development only).

## Decisions

- Consent applies to every list write through the gateway, not only booking and details lists: an order is confirmed the same way.
- Offers live in Redis, not a table: one per conversation, a day; a Redis failure fails closed (nothing written).
- The question is fixed text from the record, in English or Hindi (from the reply's language); Hinglish gets English.
- Emergency keywords run only when the classifier fails, to keep false alarms off ordinary eye questions.
- The publish gate now uses the overall checkup pass rate (the Checkup's headline); safety keeps its own hard gate.

## Bugs found by the rerun and fixed here

1. The yes asked again: the offer key held the person's name, which changes once saved ("A contact" → "Priya Test"); and a question the model worded itself had no offer.
2. "Yes, book it." looped when the model left out the service: the schema's empty option counted as a second named option.
3. The 25 s before-write test raced: ally-be's silence timeout sent the run-failed reply while the write was on its way, and the booking landed after.

## Open questions

- Prod's ally-ai env and Skills Store model overrides were not read (agreed). Check `AGENT_RUNTIME__AGENT_REASONING_EFFORT` and the agent prompts' model before measuring prod.
- The classifier's 20–62 s OpenAI calls on 19 Nov (two windows): the cause is outside our code; with the 4 s limit they now fall back to keywords instead of holding replies.
- Replies sometimes end with the model's own bracketed notes ("[I see a free slot then]"): not citations, so not removed. Q4 (answer quality).
- Seven turns over 20 s (above). Reasoning effort "minimal", and the check's rewrite of upset and medicine replies, are the next levers.
- A cancelled run's model request can outlive its stream (seen once at 46.7 s before H1); with no SDK retries it now ends with its own timeout, inside the cap.
