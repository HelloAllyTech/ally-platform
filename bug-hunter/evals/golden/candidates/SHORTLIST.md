# Shortlist (34 bug, 28 clean of 1397 candidates)

Review, then accept by id: `poetry run bug-hunter eval accept <id> [<id> …]`.
Bug rows: `lines` = source lines changed by the real fix (tests excluded); `tests` = oracle test files;
`risk` = touches a risk path (expected outcome: escalate); `lock=HEAD` = same lockfile as master,
so the sandbox reuses one dependency volume. `layout` old = pre-cutover subtree history (app at the
worktree root; PR numbers refer to the archived repo). Clean rows: feat/chore commits no later fix
touched within the window.

## ally-ai  (4 bug, 6 clean)

| id | kind | date | lines | tests | risk | lock=HEAD | PR | title |
|---|---|---|---|---|---|---|---|---|
| `ally-ai-11eef73c` | bug | 2026-11-06 | mono | 7 | 1 |  | yes | #217 | the no-topics prompt line no longer leads the model into talk the check refuses (#23) |
| `ally-ai-b680c643` | bug | 2026-10-26 | mono | 12 | 1 |  | no | #69 | The prompt code resolution function does not correctly handle nested directory structures… |
| `ally-ai-e9a0e1c3` | bug | 2026-11-02 | mono | 14 | 1 |  | no | #169 | A block of code is duplicated within the `generate_scenario_evaluation` method, likely du… |
| `ally-ai-db50926e` | bug | 2026-10-26 | mono | 29 | 1 |  | no | #79 | add test coverage for summary generation failures |
| `ally-ai-6d1b48a8` | clean | 2026-07-06 | old | 10 |  |  |  |  | use gemini-2.5-flash in override tests (2.0-flash deprecated) |
| `ally-ai-1ff07399` | clean | 2026-07-06 | old | 29 |  |  |  |  | summary condense + dynamic-summary sub-calls honor per-prompt override |
| `ally-ai-6e81b510` | clean | 2026-09-15 | old | 33 |  |  |  |  | Add challenge description to simulation evaluation |
| `ally-ai-e6286217` | clean | 2026-06-25 | old | 39 |  |  |  |  | deliver transcript before summarization (phase 1) |
| `ally-ai-7d30a176` | clean | 2026-08-21 | old | 75 |  |  |  |  | let the supervisor note reference its own live notes |
| `ally-ai-f06c8ed5` | clean | 2026-06-24 | old | 91 |  |  |  |  | recover failed summaries — keep transcript, retry, manual edit |

## ally-ai-learn  (5 bug, 6 clean)

| id | kind | date | lines | tests | risk | lock=HEAD | PR | title |
|---|---|---|---|---|---|---|---|---|
| `ally-ai-learn-fb3d48fb` | bug | 2026-10-24 | mono | 2 | 1 |  | yes | #51 | Actor evaluation is failing with a generic exception, leading to an ERROR log. This indic… |
| `ally-ai-learn-1065743a` | bug | 2026-10-24 | mono | 6 | 1 |  | yes | #45 | An error is occurring in the actor evaluation service for scenario sessions. This could p… |
| `ally-ai-learn-7391ff7e` | bug | 2026-10-27 | mono | 16 | 1 |  | yes | #71 | The `_create_event_by_detection_type` function in `app/core/events/factory.py` uses bare … |
| `ally-ai-learn-995242d7` | bug | 2026-11-03 | mono | 24 | 2 |  | yes | #185 | The Sarvam TTS provider is frequently failing with the error "Text must contain at least … |
| `ally-ai-learn-f41b78f0` | bug | 2026-10-26 | mono | 97 | 1 |  | yes | #75 | The `HelperParaphrasedEvent` has missing test coverage for `OPENAI_API_KEY` being unset, … |
| `ally-ai-learn-b408b775` | clean | 2026-06-16 | old | 28 |  |  |  |  | add thinking-filler back-channel to mask turn latency |
| `ally-ai-learn-88592f67` | clean | 2026-08-25 | old | 30 |  |  |  |  | tag the emergency-finalize end-of-session message with a reason |
| `ally-ai-learn-c77f929e` | clean | 2026-06-19 | old | 33 |  |  |  |  | redefine response_latency_ms as time-to-first-audio |
| `ally-ai-learn-66d9a037` | clean | 2026-05-12 | old | 37 |  |  |  |  | inject regional dialect block for English variants |
| `ally-ai-learn-a645303c` | clean | 2026-06-29 | old | 42 |  |  |  |  | Run V2V Test launcher on Roleplay Session Logs |
| `ally-ai-learn-b6c51894` | clean | 2026-08-26 | old | 47 |  |  |  |  | say whether the feature engaged, and why not |

## ally-be  (14 bug, 8 clean)

| id | kind | date | lines | tests | risk | lock=HEAD | PR | title |
|---|---|---|---|---|---|---|---|---|
| `ally-be-bd603f41` | bug | 2026-10-28 | mono | 1 | 3 |  | yes | #127 | remove infra from ship-volume tracking |
| `ally-be-af4511e8` | bug | 2026-11-02 | mono | 2 | 1 |  | yes | #173 | remove unverified price for gemini-2.0-flash |
| `ally-be-582b1d5f` | bug | 2026-10-30 | mono | 2 | 1 |  | yes | #153 | add retry to xp award service for db errors |
| `ally-be-b82759ae` | bug | 2026-10-28 | mono | 2 | 2 |  | yes | #123 | Tried creating a character in the morning using the bot and got the pop up of 'failed to … |
| `ally-be-99584ee6` | bug | 2026-10-27 | mono | 2 | 1 |  | yes | #96 | Blueprint repair operations are failing to return valid JSON, potentially leading to an u… |
| `ally-be-e4b33dc8` | bug | 2026-10-26 | mono | 2 | 1 |  | yes | #63 | The blueprint repair mechanism within the BlueprintPlannerSpecialist is failing to return… |
| `ally-be-d039e256` | bug | 2026-10-27 | mono | 3 | 1 | **yes** | yes | #87 | The production logs show a high volume of `UnauthorizedException` errors across various e… |
| `ally-be-89d8e055` | bug | 2026-10-30 | mono | 4 | 1 |  | yes | #147 | make translation token validation robust to zero-width spaces |
| `ally-be-adf36739` | bug | 2026-11-02 | mono | 5 | 1 |  | yes | #171 | Badge assignment to tenants is failing due to a database error ("DB error"). This prevent… |
| `ally-be-ab56980a` | bug | 2026-10-30 | mono | 5 | 1 |  | yes | #161 | verify OpenAI cached token pricing as an estimate |
| `ally-be-2096fab2` | bug | 2026-10-30 | mono | 5 | 1 |  | yes | #152 | throw specific exception on db error |
| `ally-be-8c4f9caf` | bug | 2026-10-29 | mono | 5 | 1 |  | yes | #134 | when trying to generate a cover image within a course I get this error message even for t… |
| `ally-be-c2d5c1f8` | bug | 2026-10-28 | mono | 6 | 1 | **yes** | yes | #108 | There are recurring `UnauthorizedException: Unauthorized` errors across various API endpo… |
| `ally-be-a6fb0071` | bug | 2026-10-27 | mono | 7 | 1 | **yes** | yes | #102 | There are recurring `UnauthorizedException: Unauthorized` errors across various API endpo… |
| `ally-be-b29aa1be` | clean | 2026-09-15 | old | 39 |  |  |  |  | expose the review and approve switches on the settings API |
| `ally-be-f3e78b7e` | clean | 2026-09-15 | old | 39 |  |  |  |  | run the review phase in the engine |
| `ally-be-0f139f7a` | clean | 2026-04-07 | old | 39 |  |  |  |  | add language translation support to scenario session endpoints |
| `ally-be-8c5367c1` | clean | 2026-04-02 | old | 39 |  |  |  |  | Add translation support for pathways |
| `ally-be-6b5647ff` | clean | 2026-06-29 | old | 40 |  |  |  |  | enable comfort audio, trim history, and interim reply for all existing roleplays |
| `ally-be-a2ed4959` | clean | 2026-09-03 | old | 41 |  |  |  |  | split machine time from waiting for a person |
| `ally-be-d77c088a` | clean | 2026-08-06 | old | 41 |  |  |  |  | v2v-test a track item via trackItemProgressId |
| `ally-be-5017783f` | clean | 2026-08-03 | old | 41 |  |  |  |  | backfill historyTrimEnabled=true for all scenarios |

## ally-mobile  (1 bug, 0 clean)

| id | kind | date | lines | tests | risk | lock=HEAD | PR | title |
|---|---|---|---|---|---|---|---|---|
| `ally-mobile-83bdf91e` | bug | 2026-11-06 | mono | 59 | 3 |  | yes |  | reconnect in place on Try again, and stop starting sessions muted |

## ally-web  (10 bug, 8 clean)

| id | kind | date | lines | tests | risk | lock=HEAD | PR | title |
|---|---|---|---|---|---|---|---|---|
| `ally-web-9299e9aa` | bug | 2026-11-06 | mono | 8 | 1 |  | yes | #217 | Preview sends only the last 10 messages |
| `ally-web-d62320ac` | bug | 2026-10-23 | mono | 8 | 1 |  | yes | #50 | hide intent-only learner turns; don't repeat the type word in card meta |
| `ally-web-e5ad37b3` | bug | 2026-01-13 | old | 9 | 1 | **yes** | no |  | Update AutoTerminationRuleField to display no rules by default and adjust tests for empty… |
| `ally-web-f3e902b9` | bug | 2026-10-31 | mono | 10 | 1 |  | yes | #167 | shorten AAQ-252 target legend, one x-axis title |
| `ally-web-55812e5c` | bug | 2026-06-17 | old | 12 | 1 | **yes** | no |  | persist sidebar order across refresh |
| `ally-web-dd128ff8` | bug | 2026-11-02 | mono | 22 | 1 |  | yes | #170 | When editing a simulation, if a memory is set to unlock in a specific state, and that sta… |
| `ally-web-f35e117d` | bug | 2026-10-24 | mono | 23 | 2 |  | yes | #50 | a withheld Ally chart says so instead of "no activity" |
| `ally-web-b300d69b` | bug | 2026-10-27 | mono | 24 | 1 |  | yes | #105 | Tried creating a new character using the character interview bot and when it shows the li… |
| `ally-web-eebbfd01` | bug | 2026-10-23 | mono | 30 | 1 |  | yes | #27 | pageview tracker uses the app's own router — app crashed on load |
| `ally-web-3b3db9b5` | bug | 2026-10-24 | mono | 37 | 2 |  | yes | #50 | thumbs given earlier come back on reload |
| `ally-web-382b51ea` | clean | 2026-07-01 | old | 37 |  |  |  |  | Add 'Failures by session mode' chart to scribe failure tab |
| `ally-web-8890b80b` | clean | 2026-07-01 | old | 37 |  |  |  |  | Add 'Top failure reasons' list to scribe summary-failure tab |
| `ally-web-7b655598` | clean | 2026-09-24 | old | 40 |  |  |  |  | deep-link COURSE_DISCUSSION_REPLY notifications to the post |
| `ally-web-2ae8d573` | clean | 2026-07-14 | old | 40 |  |  |  |  | permission-aware event management for multi-tenant admins |
| `ally-web-da6535f4` | clean | 2026-09-11 | old | 42 |  |  |  |  | say when nothing is indexed, instead of blaming the floor |
| `ally-web-bbaeab31` | clean | 2026-09-03 | old | 42 |  |  |  |  | show where the losses come from |
| `ally-web-ffa86627` | clean | 2026-07-27 | old | 42 |  |  |  |  | add language column and filter |
| `ally-web-1364881b` | clean | 2026-07-01 | old | 42 |  |  |  |  | unify scribe review structure with simulation |
