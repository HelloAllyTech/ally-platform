# Chunk 6b: notes

Booking polish, hand-over, data, live steps, and SP1's eval follow-ups. Built 17 Nov 2026 on `feat/agents-v2-6b` from master (A1 and SP1 merged). Commits are tagged `[6b]`.

Item 31 (assistant-only access) and the "Assistants" rename were added by Shehbaz mid-chunk.

## What each item became

| # | Item | Done | Where |
|---|---|---|---|
| 1 | "Thursday evening" with nothing free | ✅ in code | ally-ai `check/pipeline.py` (`answers_from_empty_find`, `found_nothing`, `looked_up`), `check/fixes.py` (`offers_slot` ignores "nothing's free"), `check/offered_times.py` ("latest/earliest/nearest"); ally-be `nearestForWindow` (the latest that day, then the next day's same stretch) |
| 2 | Forced search never fails a run | ✅ | `nodes/agent.py`: no time to ask again → the sent-back draft is checked as final |
| 3 | Slow booking turns | ⚠️ causes removed (1, 2); measured in the live runs (below) | |
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
