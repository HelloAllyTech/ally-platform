# Chunk 6b: notes

Booking polish, hand-over, data, live steps, and SP1's eval follow-ups. Built 17 Nov 2026 on `feat/agents-v2-6b` from master (A1 and SP1 merged). Commits are tagged `[6b]`.

Item 31 (assistant-only access) and the "Assistants" rename were added by Shehbaz mid-chunk.

## What each item became

| # | Item | Done | Where |
|---|---|---|---|
| 1 | "Thursday evening" with nothing free | ✅ in code | ally-ai `check/pipeline.py` (`answers_from_empty_find`, `found_nothing`, `looked_up`), `check/fixes.py` (`offers_slot` ignores "nothing's free"), `check/offered_times.py` ("latest/earliest/nearest"); ally-be `nearestForWindow` (the latest that day, then the next day's same stretch) |
| 2 | Forced search never fails a run | ✅ | `nodes/agent.py`: no time to ask again → the sent-back draft is checked as final |
| 3 | Slow booking turns | ✅ median 8.7 s, worst 15.8 s (target 13 / 20) | carried entries for a plain yes; no second find after the nearest (see "Item 3" below) |
| 4 | Booking rules in the lists section | ✅ text | `lists.txt`, `purpose_enquiries_can_book.txt` (`6B-PROMPTS.md` §1–2) |
| 5 | Time check reads 4 messages; "at 4" is 16:00 | ✅ | `tools/confirmed.py` (`CONFIRM_WINDOW`, `_either_half`, `morning_only_hours`) |
| 6 | One retry after `invalid_value` | ✅ | `nodes/agent.py` `failed_tools` |
| 7 | Optional detail once; stray phrases | ✅ text + code | `lists.txt`; `check/text.py` `_DANGLING_LEAD_IN` |
| 8 | The `in_use` race | ✅ | `list-records.service.ts` `checkRelations` `FOR SHARE`; two-connection Postgres tests, both orders (both fail without the lock) |
| 9 | Time zone per assistant | ✅ | `settings.timeZone`, `assistantZone` (`list-tools.ts`), home field `timeZone`, How it works select; hand-over hours start in it |
| 10 | No "I'll pass it on" without a way | ✅ code + text | `check/fixes.py` `_trim_pass_on_promises`, `REACH_TEAM`; `purpose_enquiries*.txt` |
| 11 | Hand-over summary | ✅ | `tools/hand_over.py`: 160 characters at a word, field description |
| 12 | Overview "Handed to a person" | ✅ | `scorecard.service.ts` (chats with the hand-over message); migration `1982000000500` recounts stored days |
| 13 | Erasure reaches list entries | ✅ | `conversation.service.ts` `dropListEntries`, explicit erase only; Postgres test incl. retention untouched |
| 14 | Every search logged | ✅ | `nodes/tools.py` |
| 15 | Helpline lint | ✅ | prettier |
| 16 | Host test bot decline wording | ✅ local data | both local Host bots: "Sorry, I can't help with that one. Please ask the front desk." |
| 17 | Public wiki | ✅ drafted | `repos/ally-be.md`, `repos/ally-ai.md` in `.wiki-tmp/`; PR on Shehbaz's OK (no gateway auth details) |
| 18–23 | Live steps on the bot page and bubble | ✅ | ally-ai `activity.py` (opt-in `activity: true`); ally-be `live-steps.ts`, `publicEvent`, held with tokens until the crisis check clears, `PublicFinal.steps`/`confirmation` (`ListToolsService.confirmation`); ally-web `liveSteps.ts`, `StepLine`/`StepsDone`/`ConfirmationCard`, Try it too; copy deck §30 |
| 24 | Generic out-of-scope declines | ✅ code + text | `_keep_out_of_scope_declines_generic`; no fallback contact without a look-up; `system.txt` |
| 25 | Crisis reply fits the assistant | ✅ | `packCrisisText`, `crisisTextFor` (keyword and classifier paths); `system.txt` rule 1 |
| 26 | "Rs." cut-off | ✅ | `SENTENCE_END` abbreviations, `_AMOUNT`, `_PASSAGE_REF`; C4 reproduced in a test |
| 27 | Memory doesn't announce | ✅ text | `memory.txt` |
| 28 | Pharmacy prices | ⏳ re-run after 24/26 (live runs) | |
| 29 | Taking a lead | ✅ code + text | `purpose_answer_takes_details.txt`, `takes_details` on definitions, `bookingPurposePromptCodes` |
| 30 | Example choices never reach visitors | ✅ | `offeredWriteFields`, `stillExamples` (now and earlier sets); Leads' examples "A demo / Pricing / Something else"; required ones kept (none exist, tested) |
| 31 | Assistant-only access (added) | ✅ | ally-be `isAssistantMemberRoute`; migration `1982000000600`; ally-web `useAssistantOnly`, `AssistantOnlyHeader`, `AdminShell`, `DefaultRedirect` |
| — | "Assistants" everywhere (added) | ✅ | `en.ts` (59 strings), the toggle's label; "No organisation" = Ally's own |

## Item 3: where the time goes (17 Nov, local, gpt-5-mini through the Skills Store)

Turns are timed by the action-case runner (ally-be's end-to-end, with the crisis check in parallel). Steps come from ally-ai's per-run trace (`agent` is one model call, `tool` a gateway or search call, `check` the reply check).

### Booking turns (Host test bot: Slots and Appointments, Do it on; 8 action cases, 3 runs each)

| | Before 6b's fixes (51 turns) | After (51 turns, your live prompt text) |
|---|---|---|
| Turn, median | 12.1 s | **8.7 s** |
| Turn, 90th percentile | 16.0 s | 12.2 s |
| Turn, slowest | 22.5 s (past the 20 s cap) | **15.8 s** |
| v1 fallbacks (timeouts) | 3 | 0 |
| Action cases | 7, 6, 7 of 8 | 7, 6, 7 of 8; **8 of 8** once the test bookings left by stopped runs were removed |

Per step, before (66 runs):
- A booking turn is 2–3 model steps: decide to find, decide to book, write the reply.
- A model step takes 3.9 s at the median. The first is about 3.1 s; the reply step 5.2 s at the median and up to 9.6 s, longest after a write.
- Gateway tools take about 30 ms each; the check about 1 ms.
- 5 runs were sent back once.

Where the seconds went, and the fixes (booking causes only):
1. **"Yes, book it" found the slot again** (one model step, about 3.5 s), because the time check only knew this run's entries. Now a plain yes carries the previous message's entries, so it goes straight to the create (`graph._previous_records`, `carried_records`). A first draft carried them to every message; that booked on "can I book…?" and was narrowed the same day.
2. **"Thursday evening" looked again after the nearest came back** (one more model step plus a long reply): 19.5 s, and twice over the cap. A find that returned the nearest isn't offered again in that run (`answered_finds`).
3. **The forced-search failure** (item 2) and **empty-find declines and send-backs** (item 1), fixed earlier.

Not fixed in 6b:
- the reply step itself (5–12 s), which is model time;
- a "who else is booked?" question that runs 2–3 finds.

### Plain questions (Kesar Teas, no lists; 2 questions × 3 runs)

There's no hoodie store locally, so the same kind of question went to the D2C fixture: "Your teas look strong, should I use less per cup?" and "Do you ship to Pune, and how long does delivery take?"

| Run | Turn | Steps |
|---|---|---|
| advice 1 | 13.8 s | agent 3.6 s → search 1.2 s → agent 8.7 s → check |
| advice 2 | 13.3 s | agent 2.4 s → search 1.0 s → agent 5.1 s → check → **sent back** → agent 4.6 s → check |
| advice 3 | 8.4 s | agent 2.4 s → search 0.5 s → agent 5.5 s → check |
| shipping 1 | 13.8 s | agent 1.8 s → search 0.5 s → agent 4.2 s → check → **sent back** → agent 2.7 s → search 0.5 s → agent 4.1 s → check |
| shipping 2 | 14.4 s | agent 2.3 s → search 0.4 s → agent 3.9 s → check → **sent back** → agent 3.3 s → search 0.5 s → agent 4.0 s → check |
| shipping 3 | 5.8 s | agent 2.0 s → search 0.4 s → agent 3.4 s → check |

- **Send-backs drive it.** In 3 of 6 runs a decline was sent back: once to rewrite, twice to search again. That's 1–2 more model steps (4–8 s).
- **The reply step takes 3.4–8.7 s.**
- **Searches take 0.4–1.2 s**, against 30 ms for a gateway tool.
- **Locally none passed 20 s.** Shehbaz's 30+ s turns likely add a cold model, a send-back to search again and the crisis check's wait.

**For the next chunk (not 6b):**
- don't send back a decline to search again when the first search found nothing near the question;
- cap the reply step's length;
- look at the crisis check's share of the wait.

## Decisions and mismatches

- **Activity is opt-in** (`activity: true`), so WhatsApp and every other caller get byte-identical events and responses, and the existing contract tests are unchanged.
- **The confirmation card reads the stored record**, scoped to the person. Try it rolls its writes back, so Try it shows steps but no card.
- **A write's title is shown only when it reads as a day or time**, so a lead's name never appears as a step.
- **Crisis (25):** your scope. The bot's own wording wins; medical and pharmacy get your text; other packs get the platform wording without "supervisor"; bots with no pack are unchanged. The platform defaults and the keyword template are untouched.
- **`takes_details`** is a create on a list with a phone field the assistant fills in (Leads, Callback requests), not "a person field": otherwise Appointments would count.
- **`hasCreateTool` still reads stored abilities** (SP1's pack line), not the offered tools. Left for R2: it's in the request v1 also sends.
- **Item 31's migration skips custom logins** (more switches off than on); they exist to use assistants. The toggle cache needs clearing after it (checklist).
- **Local data:** a dry run of 31's SQL wasn't rolled back and briefly switched local admins 1 and 3 off. The migration then ran with nothing to do. Their switch is now off as the migration intends; their original `updatedAt` is lost.
- **Node:** ally-web's hook must run on Node 22 (`.nvmrc`); on Node 24 three helpline suites time out (pre-existing, also on HEAD).
- **Found live: the lists prompt never came from the Skills Store.** ally-be didn't send `ally_ai_agent_lists`, so ally-ai always ran the default in its code. Fixed (`AGENT_PROMPT_CODES`). Publish the 6b lists text before deploying.
- **Local dev trap:** `nest start --watch` runs from a bundle and doesn't refresh the separate files under `dist/` that `chatbot:basics` loads. Restart the ally-be container before live runs, or they test old code. Stopped runs also leave their bookings behind (no cleanup); remove them before the next run.
- **The Context Library MCP** is declared in each app's `.mcp.json`, not at the root, so it wasn't loaded in this session. Wording follows the brief and the copy deck.

## How to test

- **ally-ai:** `poetry run pytest tests/core/agent_runtime -q` (`test_list_tools.py`, `test_agent_check.py`, `test_activity.py`, `test_memory.py`, `test_search_again.py`, `test_gateway_tools.py`).
- **ally-be:**
  - `npx jest src/chatbot src/auth src/bot-draft`;
  - the Postgres specs with `CHATBOT_STORE_TEST_DB` on `ally_lists_test` (lists race, erasure) and `ally_scorecard_test` (hand-overs).
- **ally-web:**
  - `npx vitest run src/botPage src/routes src/pages/AssistantHome src/pages/SuperAdmins`;
  - Playwright in Docker: `liveSteps`, `widgetLiveSteps`.
- **Live:** the basics action cases (`run-basics.js --cases src/chatbot/basics/cases/lists.json`) on the Host bot and a Bring in customers bot, 3 runs.

## Open

- Publish the 6b prompts after Shehbaz's OK (`6B-PROMPTS.md`).
- The wiki PR.
- `system.txt` still says "over WhatsApp" on every channel (8a's open item; your call).
- Make `hasCreateTool` read the offered tools (R2).
