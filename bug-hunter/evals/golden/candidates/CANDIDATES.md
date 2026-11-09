# Candidate golden cases

Review, then accept by id: `poetry run bug-hunter eval accept <id> [<id> …]`.
Bug rows: `lines` = source lines changed by the real fix (tests excluded); `tests` = oracle test files;
`risk` = touches a risk path (expected outcome: escalate); `lock=HEAD` = same lockfile as master,
so the sandbox reuses one dependency volume. `layout` old = pre-cutover subtree history (app at the
worktree root; PR numbers refer to the archived repo). Clean rows: feat/chore commits no later fix
touched within the window.

## ally-ai  (4 bug, 13 clean)

| id | kind | date | lines | tests | risk | lock=HEAD | PR | title |
|---|---|---|---|---|---|---|---|---|
| `ally-ai-11eef73c` | bug | 2026-11-06 | mono | 7 | 1 |  | yes | #217 | the no-topics prompt line no longer leads the model into talk the check refuses (#23) |
| `ally-ai-b680c643` | bug | 2026-10-26 | mono | 12 | 1 |  | no | #69 | The prompt code resolution function does not correctly handle nested directory structures… |
| `ally-ai-e9a0e1c3` | bug | 2026-11-02 | mono | 14 | 1 |  | no | #169 | A block of code is duplicated within the `generate_scenario_evaluation` method, likely du… |
| `ally-ai-db50926e` | bug | 2026-10-26 | mono | 29 | 1 |  | no | #79 | add test coverage for summary generation failures |
| `ally-ai-6d1b48a8` | clean | 2026-07-06 | old | 10 |  |  |  |  | use gemini-2.5-flash in override tests (2.0-flash deprecated) |
| `ally-ai-ed0800d8` | clean | 2026-03-24 | old | 15 |  |  |  |  | Add prompt variable parsing and include available variables in prompt metadata. |
| `ally-ai-1ff07399` | clean | 2026-07-06 | old | 29 |  |  |  |  | summary condense + dynamic-summary sub-calls honor per-prompt override |
| `ally-ai-7fd68c56` | clean | 2026-02-06 | old | 31 |  |  |  |  | make session summary bulletin points |
| `ally-ai-6e81b510` | clean | 2026-09-15 | old | 33 |  |  |  |  | Add challenge description to simulation evaluation |
| `ally-ai-48363e14` | clean | 2026-03-17 | old | 33 |  |  |  |  | Introduce `internal_path` for direct template file lookup and enhance error handling duri… |
| `ally-ai-e6286217` | clean | 2026-06-25 | old | 39 |  |  |  |  | deliver transcript before summarization (phase 1) |
| `ally-ai-dc7db44c` | clean | 2026-04-29 | old | 55 |  |  |  |  | Phase 4 — ally-ai support for custom AI field keys |
| `ally-ai-7d30a176` | clean | 2026-08-21 | old | 75 |  |  |  |  | let the supervisor note reference its own live notes |
| `ally-ai-f06c8ed5` | clean | 2026-06-24 | old | 91 |  |  |  |  | recover failed summaries — keep transcript, retry, manual edit |
| `ally-ai-776073bc` | clean | 2026-02-23 | old | 94 |  |  |  |  | change the skill metrics in summary |
| `ally-ai-65fddb1b` | clean | 2026-02-13 | old | 122 |  |  |  |  | added 3 more metrics to post simulation summary |
| `ally-ai-4a711a3a` | clean | 2026-04-15 | old | 128 |  |  |  |  | add dictation session mode support with dedicated prompt template and request handling |

## ally-ai-learn  (5 bug, 64 clean)

| id | kind | date | lines | tests | risk | lock=HEAD | PR | title |
|---|---|---|---|---|---|---|---|---|
| `ally-ai-learn-fb3d48fb` | bug | 2026-10-24 | mono | 2 | 1 |  | yes | #51 | Actor evaluation is failing with a generic exception, leading to an ERROR log. This indic… |
| `ally-ai-learn-1065743a` | bug | 2026-10-24 | mono | 6 | 1 |  | yes | #45 | An error is occurring in the actor evaluation service for scenario sessions. This could p… |
| `ally-ai-learn-7391ff7e` | bug | 2026-10-27 | mono | 16 | 1 |  | yes | #71 | The `_create_event_by_detection_type` function in `app/core/events/factory.py` uses bare … |
| `ally-ai-learn-995242d7` | bug | 2026-11-03 | mono | 24 | 2 |  | yes | #185 | The Sarvam TTS provider is frequently failing with the error "Text must contain at least … |
| `ally-ai-learn-f41b78f0` | bug | 2026-10-26 | mono | 97 | 1 |  | yes | #75 | The `HelperParaphrasedEvent` has missing test coverage for `OPENAI_API_KEY` being unset, … |
| `ally-ai-learn-a4e9da63` | clean | 2026-03-10 | old | 6 |  |  |  |  | finalize system prompt separation by updating python references to base_role_instruction |
| `ally-ai-learn-29be2a87` | clean | 2026-08-06 | old | 8 |  |  |  |  | ROLLING_SUMMARY_ENABLED defaults to ON |
| `ally-ai-learn-62ecff12` | clean | 2026-07-06 | old | 8 |  |  |  |  | use gemini-2.5-flash in precedence/evaluator tests (2.0-flash deprecated) |
| `ally-ai-learn-3462548a` | clean | 2026-06-22 | old | 12 |  |  |  |  | make per-scenario pause opt-in (default disabled) |
| `ally-ai-learn-de03778c` | clean | 2026-09-29 | old | 14 |  |  |  |  | delete the dead v2 NaturalnessController and filler_audio |
| `ally-ai-learn-45740ce8` | clean | 2026-03-25 | old | 14 |  |  |  |  | Add prompt categorization based on metadata or top-level directory. |
| `ally-ai-learn-0bd0b5ff` | clean | 2026-03-17 | old | 14 |  |  |  |  | Add `PROMPT_SERVICE_API_KEY` to config and prioritize its use for prompt synchronization. |
| `ally-ai-learn-0a9fa521` | clean | 2026-06-19 | old | 15 |  |  |  |  | honor per-scenario pauseEnabled opt-out |
| `ally-ai-learn-cdc8d32c` | clean | 2026-03-26 | old | 15 |  |  |  |  | Allow dynamic role instructions to be injected into the main agent's system prompt via `P… |
| `ally-ai-learn-6b69b5e1` | clean | 2026-06-25 | old | 16 |  |  |  |  | default BEHAVIORS_OFF_GATE=True (de-gate behavior scoring) |
| `ally-ai-learn-14c10374` | clean | 2026-03-26 | old | 17 |  |  |  |  | merge available variables from prompt content and metadata |
| `ally-ai-learn-fc00f7bb` | clean | 2026-06-05 | old | 18 |  |  |  |  | reliably surface all errors to Slack |
| `ally-ai-learn-15bf574d` | clean | 2026-03-23 | old | 18 |  |  |  |  | Prioritize guardrail events for branching instructions when available. |
| `ally-ai-learn-9cbafdce` | clean | 2026-08-05 | old | 20 |  |  |  |  | log tier0/tier1 glossary presence at session start |
| `ally-ai-learn-7559e3a7` | clean | 2026-07-15 | old | 25 |  |  |  |  | render multiple competencies in prompts |
| `ally-ai-learn-bdf7472e` | clean | 2026-08-19 | old | 26 |  |  |  |  | persist prompt-cache token counts for the latency dashboard |
| `ally-ai-learn-a9c33140` | clean | 2026-03-26 | old | 27 |  |  |  |  | Enable `title` and `description` variables for main and branching agent system prompts. |
| `ally-ai-learn-b408b775` | clean | 2026-06-16 | old | 28 |  |  |  |  | add thinking-filler back-channel to mask turn latency |
| `ally-ai-learn-88592f67` | clean | 2026-08-25 | old | 30 |  |  |  |  | tag the emergency-finalize end-of-session message with a reason |
| `ally-ai-learn-c77f929e` | clean | 2026-06-19 | old | 33 |  |  |  |  | redefine response_latency_ms as time-to-first-audio |
| `ally-ai-learn-66d9a037` | clean | 2026-05-12 | old | 37 |  |  |  |  | inject regional dialect block for English variants |
| `ally-ai-learn-b7630866` | clean | 2026-03-06 | old | 37 |  |  |  |  | add new prompt metadata files for report generation, prosody parameters, system prompts, … |
| `ally-ai-learn-017dea13` | clean | 2025-12-09 | old | 37 |  |  |  |  | implement custom field instructions |
| `ally-ai-learn-a645303c` | clean | 2026-06-29 | old | 42 |  |  |  |  | Run V2V Test launcher on Roleplay Session Logs |
| `ally-ai-learn-b6c51894` | clean | 2026-08-26 | old | 47 |  |  |  |  | say whether the feature engaged, and why not |
| `ally-ai-learn-c64aeec6` | clean | 2026-03-30 | old | 47 |  |  |  |  | Add support for allowed filler words in multilingual instructions, enhancing dialogue gui… |
| `ally-ai-learn-b6344aa4` | clean | 2026-02-20 | old | 47 |  |  |  |  | add competency to prompt data |
| `ally-ai-learn-399f4379` | clean | 2025-12-17 | old | 52 |  |  |  |  | add more fields for prompt |
| `ally-ai-learn-29a2965a` | clean | 2026-04-02 | old | 54 |  |  |  |  | Add model_name support to VoiceConfig and GoogleTTSClient for enhanced TTS customization |
| `ally-ai-learn-98ae6dc2` | clean | 2026-04-02 | old | 54 |  |  |  |  | Add model_name support to VoiceConfig and GoogleTTSClient for enhanced TTS customization |
| `ally-ai-learn-d935f485` | clean | 2026-05-19 | old | 57 |  |  |  |  | add per-simulation enable_prosody toggle |
| `ally-ai-learn-a850a8eb` | clean | 2026-02-06 | old | 60 |  |  |  |  | use memory from previous session for cases |
| `ally-ai-learn-ce6640b3` | clean | 2026-03-25 | old | 64 |  |  |  |  | Implement dynamic behavior detection using new system and user prompts. |
| `ally-ai-learn-d012929c` | clean | 2026-06-24 | old | 66 |  |  |  |  | remove static fillerDialogues (LLM now generates fillers) |
| `ally-ai-learn-8990bf36` | clean | 2026-10-02 | old | 69 |  |  |  |  | say which interim masked a turn; count only heard bridges |
| `ally-ai-learn-b1cbb149` | clean | 2026-06-11 | old | 69 |  |  |  |  | complete per-turn latency breakdown + per-detector timing logs |
| `ally-ai-learn-bb238f65` | clean | 2026-08-28 | old | 80 |  |  |  |  | fall back to what the session is ABOUT when the conversation offers no cue |
| `ally-ai-learn-cf906004` | clean | 2026-09-03 | old | 81 |  |  |  |  | mark which kind of client utterance a line is |
| `ally-ai-learn-b36a0488` | clean | 2026-01-22 | old | 83 |  |  |  |  | send all detected event ids to ui |
| `ally-ai-learn-8974344a` | clean | 2026-08-23 | old | 88 |  |  |  |  | wire the store into the worker and run config |
| `ally-ai-learn-b281c731` | clean | 2026-05-12 | old | 90 |  |  |  |  | inject language label into multilingual prompt block |
| `ally-ai-learn-2e7c9b6e` | clean | 2026-03-24 | old | 90 |  |  |  |  | Support structured prompt data with variable validation and literal key handling in promp… |
| `ally-ai-learn-20ed5f91` | clean | 2026-06-17 | old | 93 |  |  |  |  | capture LLM generation config on turn metrics |
| `ally-ai-learn-0476b99f` | clean | 2026-05-12 | old | 104 |  |  |  |  | unify language label with per-scenario override |
| `ally-ai-learn-27bc5acb` | clean | 2026-06-01 | old | 106 |  |  |  |  | strict body-driven state gate + character backstory in Prompt #2 |
| `ally-ai-learn-5321b65d` | clean | 2026-07-21 | old | 109 |  |  |  |  | remove the rehearsal harness |
| `ally-ai-learn-7e0b106d` | clean | 2026-03-11 | old | 110 |  |  |  |  | Implement custom field filtering for prompt generation based on a new `useInDefaultPrompt… |
| `ally-ai-learn-c2b9777f` | clean | 2026-06-17 | old | 114 |  |  |  |  | per-language filler dialogues + email-gated Thinking Filler |
| `ally-ai-learn-ae46835d` | clean | 2026-07-06 | old | 116 |  |  |  |  | report evaluator honors selected evaluator prompt's model/temperature |
| `ally-ai-learn-72c2b360` | clean | 2026-03-09 | old | 116 |  |  |  |  | add occurrence interval based event trigger |
| `ally-ai-learn-310ffaf6` | clean | 2026-05-07 | old | 120 |  |  |  |  | handle optional studio fields in AI graph |
| `ally-ai-learn-ada256e2` | clean | 2026-08-20 | old | 121 |  |  |  |  | carry whether the learner talked over a client turn |
| `ally-ai-learn-640271c2` | clean | 2026-08-07 | old | 125 |  |  |  |  | per-scenario override for max endpointing delay |
| `ally-ai-learn-3075d3a9` | clean | 2026-02-09 | old | 136 |  |  |  |  | models for behaviour and state instructions |
| `ally-ai-learn-848a209c` | clean | 2026-06-25 | old | 138 |  |  |  |  | randomized delay + probability so fillers feel natural |
| `ally-ai-learn-c828f6e4` | clean | 2026-08-04 | old | 139 |  |  |  |  | add detection kill-switches for deprecated similarity events |
| `ally-ai-learn-e3f27b01` | clean | 2026-09-25 | old | 147 |  |  |  |  | record the post-session actor evaluation as actor_evaluation |
| `ally-ai-learn-3a5dca08` | clean | 2026-08-28 | old | 156 |  |  |  |  | the stance selects the authored state guidance |
| `ally-ai-learn-c716f2f8` | clean | 2026-09-25 | old | 162 |  |  |  |  | record back-channel phrase generation as backchannel_phrases |
| `ally-ai-learn-28d1546d` | clean | 2026-06-26 | old | 173 |  |  |  |  | add per-simulation continuous back-channeling toggle |
| `ally-ai-learn-9f45363e` | clean | 2026-06-05 | old | 183 |  |  |  |  | reliably surface all errors to Slack |
| `ally-ai-learn-bb670bf1` | clean | 2026-09-24 | old | 189 |  |  |  |  | add dialogue length instruction to prompt (#236) |
| `ally-ai-learn-be4156f3` | clean | 2026-03-18 | old | 192 |  |  |  |  | Enhance prompt system by introducing dynamic block generation and metadata support, while… |
| `ally-ai-learn-95d2a0e5` | clean | 2026-01-16 | old | 196 |  |  |  |  | add static variable substitution for branching instruction |

## ally-be  (280 bug, 404 clean)

| id | kind | date | lines | tests | risk | lock=HEAD | PR | title |
|---|---|---|---|---|---|---|---|---|
| `ally-be-bd603f41` | bug | 2026-10-28 | mono | 1 | 3 |  | yes | #127 | remove infra from ship-volume tracking |
| `ally-be-d0fd4c85` | bug | 2026-09-28 | old | 1 | 1 |  | no | #564 | propagate errors in XpAwardService (#564) |
| `ally-be-dc599d6c` | bug | 2026-09-24 | old | 1 | 1 |  | no |  | remove redundant disconnect handler |
| `ally-be-f345a6ed` | bug | 2026-09-17 | old | 1 | 1 |  | no |  | repair the type errors blocking every release |
| `ally-be-af4511e8` | bug | 2026-11-02 | mono | 2 | 1 |  | yes | #173 | remove unverified price for gemini-2.0-flash |
| `ally-be-582b1d5f` | bug | 2026-10-30 | mono | 2 | 1 |  | yes | #153 | add retry to xp award service for db errors |
| `ally-be-b82759ae` | bug | 2026-10-28 | mono | 2 | 2 |  | yes | #123 | Tried creating a character in the morning using the bot and got the pop up of 'failed to … |
| `ally-be-99584ee6` | bug | 2026-10-27 | mono | 2 | 1 |  | yes | #96 | Blueprint repair operations are failing to return valid JSON, potentially leading to an u… |
| `ally-be-e4b33dc8` | bug | 2026-10-26 | mono | 2 | 1 |  | yes | #63 | The blueprint repair mechanism within the BlueprintPlannerSpecialist is failing to return… |
| `ally-be-898a2726` | bug | 2026-10-23 | mono | 2 | 1 |  | no |  | read "ready for the next step" as a ready claim |
| `ally-be-2ac7c9dc` | bug | 2026-10-08 | old | 2 | 1 |  | no |  | run each repo on its own Node, and block deleted specs |
| `ally-be-1a637068` | bug | 2026-09-28 | old | 2 | 1 |  | no | #566 | propagate errors in BadgeTenantService (#566) |
| `ally-be-7a70965e` | bug | 2026-09-25 | old | 2 | 1 |  | no | #546 | The Bug Hunter memory search endpoint is returning a 400 Bad Request error when the `limi… |
| `ally-be-b2f2d586` | bug | 2026-09-24 | old | 2 | 1 |  | no |  | use singular permission for unread review count |
| `ally-be-532727f9` | bug | 2026-09-24 | old | 2 | 1 |  | no |  | correct filtering of english language variants > > The logic for filtering out the defaul… |
| `ally-be-84061dab` | bug | 2026-09-21 | old | 2 | 1 |  | no | #506 | Increase default limit for /findings endpoint (#506) |
| `ally-be-b38fdbd3` | bug | 2026-09-21 | old | 2 | 1 |  | no |  | Correct /model endpoint routing. The Bug Hunter API was reporting NotFoundException error… |
| `ally-be-642cd5ab` | bug | 2026-09-17 | old | 2 | 1 |  | no | #499 | Bug Hunter pipeline NotFoundException for recordModel endpoint (#499) |
| `ally-be-19cbe177` | bug | 2026-09-16 | old | 2 | 2 | **yes** | no | #491 | Production logs show multiple instances of an unhandled error during WebSocket authentica… |
| `ally-be-3d2cde33` | bug | 2026-09-04 | old | 2 | 1 |  | no | #458 | surface guarded-path reminder on repos the bot can't merge to (#458) |
| `ally-be-96759494` | bug | 2026-08-24 | old | 2 | 1 |  | no |  | carry detectionConfig and checklistVisibilityStatus when duplicating a scenario |
| `ally-be-fd09abb4` | bug | 2026-08-21 | old | 2 | 1 |  | no |  | skip saving a freshly-created overlay section with no proposals |
| `ally-be-216894fa` | bug | 2026-03-02 | old | 2 | 1 |  | no |  | list only checklist events |
| `ally-be-4ce96778` | bug | 2026-02-26 | old | 2 | 1 |  | no |  | scenario session transcript sort order |
| `ally-be-25e37b5f` | bug | 2026-01-20 | old | 2 | 1 |  | no |  | update query to filter out passive event in scenario session |
| `ally-be-d039e256` | bug | 2026-10-27 | mono | 3 | 1 | **yes** | yes | #87 | The production logs show a high volume of `UnauthorizedException` errors across various e… |
| `ally-be-02c72814` | bug | 2026-09-24 | old | 3 | 1 |  | no |  | correct all-time query logic in getQualitySentiment |
| `ally-be-67caf7ee` | bug | 2026-09-24 | old | 3 | 1 |  | no |  | correct all-time start date logic |
| `ally-be-fb8a867b` | bug | 2026-09-24 | old | 3 | 1 |  | no |  | correct all-time start date logic |
| `ally-be-fa99891b` | bug | 2026-09-15 | old | 3 | 1 |  | no |  | add minLength checks to PRD fields |
| `ally-be-aaa0d9ba` | bug | 2026-04-27 | old | 3 | 1 |  | no |  | resolve test failures from leftJoinAndMapMany changes |
| `ally-be-ebd024ab` | bug | 2026-02-02 | old | 3 | 1 |  | no |  | remove default value for isPublic in scenario mapping |
| `ally-be-89d8e055` | bug | 2026-10-30 | mono | 4 | 1 |  | yes | #147 | make translation token validation robust to zero-width spaces |
| `ally-be-2d84070a` | bug | 2026-10-21 | old | 4 | 1 |  | no |  | a prompt candidate that clears the temperature clears it on publish |
| `ally-be-9e6ae627` | bug | 2026-10-10 | old | 4 | 1 |  | no | #611 | The Redis health check has a retry mechanism, but the error handling in the retry logic i… |
| `ally-be-d4ba09fd` | bug | 2026-09-24 | old | 4 | 1 |  | no |  | Handle undefined userId in scheduled tasks |
| `ally-be-cf66f75f` | bug | 2026-09-23 | old | 4 | 1 |  | no |  | a run's own account of itself is no longer lost to its newlines |
| `ally-be-e907602f` | bug | 2026-09-15 | old | 4 | 1 |  | no |  | ensure knowledgeSources is an array |
| `ally-be-50d06cda` | bug | 2026-08-31 | old | 4 | 2 | **yes** | no |  | clear the three prettier errors that turned master red |
| `ally-be-7048169a` | bug | 2026-08-28 | old | 4 | 1 |  | no |  | project queueRank in findOneWithScore |
| `ally-be-9fcf495f` | bug | 2026-07-23 | old | 4 | 1 |  | no |  | metadataFetch url was missing the global /api prefix |
| `ally-be-e1aca796` | bug | 2026-02-25 | old | 4 | 1 |  | no |  | award badge to users on adding a badge to a tenant |
| `ally-be-adf36739` | bug | 2026-11-02 | mono | 5 | 1 |  | yes | #171 | Badge assignment to tenants is failing due to a database error ("DB error"). This prevent… |
| `ally-be-ab56980a` | bug | 2026-10-30 | mono | 5 | 1 |  | yes | #161 | verify OpenAI cached token pricing as an estimate |
| `ally-be-2096fab2` | bug | 2026-10-30 | mono | 5 | 1 |  | yes | #152 | throw specific exception on db error |
| `ally-be-8c4f9caf` | bug | 2026-10-29 | mono | 5 | 1 |  | yes | #134 | when trying to generate a cover image within a course I get this error message even for t… |
| `ally-be-0060266c` | bug | 2026-10-21 | old | 5 | 1 |  | no |  | record a negative rating as not helpful |
| `ally-be-85689544` | bug | 2026-09-24 | old | 5 | 1 |  | no |  | redact sensitive data in error logs |
| `ally-be-d6e4d7ec` | bug | 2026-08-28 | old | 5 | 1 |  | no |  | fall back to caller tenant when enabling Character Library |
| `ally-be-25c97c58` | bug | 2026-08-27 | old | 5 | 1 |  | no |  | apply the documented 2s deadline to the DB ping check |
| `ally-be-2559fef5` | bug | 2026-11-02 | mono | 6 | 1 |  | yes | #174 | throw error on memory mapping failure |
| `ally-be-c2d5c1f8` | bug | 2026-10-28 | mono | 6 | 1 | **yes** | yes | #108 | There are recurring `UnauthorizedException: Unauthorized` errors across various API endpo… |
| `ally-be-1402bb89` | bug | 2026-10-27 | mono | 6 | 1 |  | yes | #93 | The system logs warnings about invalid or expired Anthropic API keys, causing a fallback … |
| `ally-be-1be2fc61` | bug | 2026-10-27 | mono | 6 | 1 |  | yes |  | send the prompt's version and hash with the judge request |
| `ally-be-68a34a82` | bug | 2026-10-06 | old | 6 | 1 |  | no |  | admin settings writes invalidate the public status cache |
| `ally-be-2ab4daaf` | bug | 2026-07-27 | old | 6 | 1 |  | no |  | carry environment field through slim room-metadata envelope |
| `ally-be-b83757b5` | bug | 2026-07-23 | old | 6 | 1 |  | no |  | specFetch url was missing the global /api prefix |
| `ally-be-7293e18d` | bug | 2026-10-29 | mono | 7 | 2 |  | yes | #131 | The API endpoint `/api/v1/simulation-credits` is receiving requests without a required `U… |
| `ally-be-099de82c` | bug | 2026-10-28 | mono | 7 | 1 |  | yes | #101 | The translation service is failing to translate prompts due to token mismatches or unconf… |
| `ally-be-a6fb0071` | bug | 2026-10-27 | mono | 7 | 1 | **yes** | yes | #102 | There are recurring `UnauthorizedException: Unauthorized` errors across various API endpo… |
| `ally-be-4ac7d2cf` | bug | 2026-09-04 | old | 7 | 1 |  | no |  | record a deferral when an accept fails the token cap |
| `ally-be-24de2708` | bug | 2026-08-27 | old | 7 | 1 |  | no |  | badge current-generation platform admins as staff on bug reports |
| `ally-be-8cffeaf2` | bug | 2026-07-27 | old | 7 | 1 |  | no |  | carry environment in v2 room metadata |
| `ally-be-0dcba840` | bug | 2026-10-22 | old | 8 | 1 |  | no |  | Send the breathing exercise configuration when a game item starts |
| `ally-be-a62d3191` | bug | 2026-10-16 | old | 8 | 1 |  | no | #648 | The `studyContradictsFault` function does not correctly handle all cases where a fix sess… |
| `ally-be-881000db` | bug | 2026-09-25 | old | 8 | 1 |  | no |  | redact an access token Meta echoes back in its error text |
| `ally-be-e09260d2` | bug | 2026-09-18 | old | 8 | 1 |  | no | #505 | Expose correct simulation count for courses (#505) |
| `ally-be-42aed4f1` | bug | 2026-09-17 | old | 8 | 1 |  | no | #496 | Handle invalid iOS version format in auto-bump task\n\nThe scheduled task  was failing du… |
| `ally-be-c670c627` | bug | 2026-09-04 | old | 8 | 1 |  | no |  | include the last day in filler quality dashboard windows |
| `ally-be-b2dcaafa` | bug | 2026-08-21 | old | 8 | 1 |  | no |  | count actual rows written by mergeLeanLabels |
| `ally-be-9a44fb8b` | bug | 2026-10-26 | mono | 9 | 1 | **yes** | yes | #54 | A high volume of "Unauthorized" errors are being logged in production. This may indicate … |
| `ally-be-7907b059` | bug | 2026-10-22 | old | 9 | 1 |  | no |  | persist clearing a section/item description |
| `ally-be-e829f9ee` | bug | 2026-10-21 | old | 9 | 1 |  | no | #671 | align breathing exercise DTO validation with service (#671) |
| `ally-be-e820190a` | bug | 2026-09-17 | old | 9 | 2 | **yes** | no |  | propagate original WebSocket auth errors |
| `ally-be-1aead9bd` | bug | 2026-09-16 | old | 9 | 1 |  | no |  | keeping a branch current is not a fix |
| `ally-be-1383a077` | bug | 2026-08-21 | old | 9 | 1 |  | no |  | dual-key tenant match in variety-profile turn queries |
| `ally-be-819f6ccf` | bug | 2026-07-23 | old | 9 | 1 | **yes** | no |  | learnMetadataFetchEnabled read env string 'true' as false |
| `ally-be-5f26cc90` | bug | 2026-07-08 | old | 9 | 1 |  | no |  | exclude Roleplay Studio v2 shells from v1 roleplays list |
| `ally-be-55582a85` | bug | 2026-04-30 | old | 9 | 1 |  | no |  | trigger AI custom field fill for MICROPHONE provider calls |
| `ally-be-9d6967d9` | bug | 2026-10-24 | mono | 10 | 1 |  | yes | #50 | continue a paused turn instead of ending it |
| `ally-be-d3c95a13` | bug | 2026-09-03 | old | 10 | 1 |  | no |  | exclude tenant overlay sections from glossary go-live date |
| `ally-be-7b4783b5` | bug | 2026-08-20 | old | 10 | 1 |  | no |  | keep frequency-fallback lexemes out of the judge's target variety |
| `ally-be-1ade06cf` | bug | 2026-08-03 | old | 10 | 1 |  | no |  | price gemini-2.5-flash so the model swap keeps its cost |
| `ally-be-c5bfb165` | bug | 2026-07-15 | old | 10 | 1 | **yes** | no |  | add TTL to user:groups cache in getUserGroupIds |
| `ally-be-de1f1a12` | bug | 2026-01-07 | old | 10 | 1 | **yes** | no |  | organization logo upload |
| `ally-be-e431ec95` | bug | 2026-11-06 | mono | 11 | 1 |  | yes | #217 | decline wording cut to ally-ai's 500-character limit in the agent request (#1) |
| `ally-be-06249390` | bug | 2026-10-28 | mono | 11 | 1 | **yes** | yes | #124 | While generating an image during simulation creation, I get the following error, and the … |
| `ally-be-8e44b1ef` | bug | 2026-09-30 | old | 11 | 1 |  | no |  | take only the @handle as a journal entry's author |
| `ally-be-d63e8a37` | bug | 2026-09-25 | old | 11 | 1 |  | no | #547 | allow reports on completed runs (#547) |
| `ally-be-b45f25fe` | bug | 2026-09-22 | old | 11 | 2 |  | no |  | Give the roleplay log filter a way to tell same-named people apart |
| `ally-be-c548896f` | bug | 2026-09-01 | old | 11 | 1 |  | no |  | make preview monologue length-guard atomic |
| `ally-be-b9cb3fbe` | bug | 2026-08-25 | old | 11 | 1 |  | no |  | guard handleEndScenarioSessionEvent against a delayed end-of-session event double-chargin… |
| `ally-be-f6415e08` | bug | 2026-01-07 | old | 11 | 1 | **yes** | no |  | profile image upload |
| `ally-be-2270998f` | bug | 2026-10-23 | old | 12 | 1 |  | no | #705 | The application is receiving requests for /favicon.ico and returning a 404 Not Found erro… |
| `ally-be-8c351ed1` | bug | 2026-09-16 | old | 12 | 1 |  | no |  | announce a release that merged but never deployed |
| `ally-be-f3e4c8ba` | bug | 2026-09-10 | old | 12 | 1 |  | no |  | stop re-writing the identity link on every new number |
| `ally-be-1278b557` | bug | 2026-08-25 | old | 12 | 1 | **yes** | no |  | resolve 4 prettier/prettier lint errors blocking the style gate |
| `ally-be-2d4fcbf4` | bug | 2026-02-02 | old | 12 | 1 |  | no |  | dynamic branch instruction for scenario events |
| `ally-be-0eadda20` | bug | 2026-01-22 | old | 12 | 1 |  | no |  | add reviewStatus and reviewId in get scenario session by id |
| `ally-be-d4a7bce7` | bug | 2026-11-02 | mono | 13 | 2 |  | yes |  | Ask Ally replies are not cut short; the run keeps its language source |
| `ally-be-401a94a6` | bug | 2026-10-15 | old | 13 | 1 |  | no |  | a fix that never reached the branch is not a fix |
| `ally-be-ab60ef03` | bug | 2026-08-28 | old | 13 | 1 |  | no |  | recognize current PLATFORM_ADMIN accounts as eligible roadmap owners |
| `ally-be-cad2a5b6` | bug | 2026-08-19 | old | 13 | 1 |  | no |  | give the round-trip top-up a row to write to |
| `ally-be-c40a999b` | bug | 2026-05-08 | old | 13 | 1 |  | no |  | use take/skip so customFieldValues join doesn't deflate page size |
| `ally-be-46ed0fe2` | bug | 2026-03-26 | old | 13 | 1 |  | no |  | make profession field required and non-empty in scenario DTOs. |
| `ally-be-6ba5fc4c` | bug | 2026-10-24 | mono | 14 | 1 |  | no | #43 | The translation backfill for badges may not re-translate descriptions that failed on a pr… |
| `ally-be-02217ae8` | bug | 2026-10-12 | old | 14 | 1 |  | no | #615 | The `videoStructuralSignature` function, which is used to detect structural changes in a … |
| `ally-be-273fd8d4` | bug | 2026-10-02 | old | 14 | 1 |  | no |  | CI sync treats a blank draft value as missing |
| `ally-be-093fabd5` | bug | 2026-09-10 | old | 14 | 1 |  | no |  | includeArchived=false actually excludes archived documents |
| `ally-be-79dcdade` | bug | 2026-11-02 | mono | 15 | 1 |  | yes |  | Ask Ally may echo the learner's words and the card names |
| `ally-be-8d5a6ac6` | bug | 2026-11-02 | mono | 15 | 1 |  | yes |  | Ask Ally may quote a card's skill name |
| `ally-be-c34dda8a` | bug | 2026-10-28 | mono | 15 | 6 | **yes** | yes | #115 | update default openai image model to dall-e-3 |
| `ally-be-8be8070d` | bug | 2026-08-19 | old | 15 | 1 |  | no |  | bug entries can't be assigned coins |
| `ally-be-3b88caf9` | bug | 2026-05-26 | old | 15 | 1 |  | no |  | dedupe agent dispatch via listDispatch across instances |
| `ally-be-98294d70` | bug | 2026-01-07 | old | 15 | 1 |  | no |  | get scenario path by id status fix |
| `ally-be-50b59720` | bug | 2026-11-05 | mono | 16 | 1 | **yes** | yes | #210 | send the product-updates digest only from the production database |
| `ally-be-5d0dd729` | bug | 2026-10-30 | mono | 16 | 1 |  | yes | #148 | add auth guard to unread-count endpoint |
| `ally-be-22a8206c` | bug | 2026-10-27 | mono | 16 | 2 | **yes** | yes | #98 | A user is unable to create a new character and start a chat with the interview agent, enc… |
| `ally-be-e78bfa96` | bug | 2026-10-27 | mono | 16 | 1 |  | yes | #86 | The translation service is failing for prompts due to a token mismatch, specifically for … |
| `ally-be-d830056f` | bug | 2026-10-19 | old | 16 | 1 |  | no | #649 | The application may crash when making calls to newer Gemini models (version 3 and later) … |
| `ally-be-79c0b175` | bug | 2026-09-25 | old | 16 | 1 |  | no |  | make "mark all as read" actually mark anything as read |
| `ally-be-c307db18` | bug | 2026-10-26 | mono | 17 | 1 | **yes** | yes | #58 | The application logs numerous `UnauthorizedException` errors across various endpoints. Th… |
| `ally-be-de6c29c3` | bug | 2026-10-21 | old | 17 | 2 |  | no |  | save the comment posted after the rating |
| `ally-be-1cb5714d` | bug | 2026-10-14 | old | 17 | 1 |  | no |  | treat ElevenLabs v4 like v3 in the per-voice model verdict |
| `ally-be-f00e93b7` | bug | 2026-10-21 | old | 18 | 1 |  | no |  | send a system-only Gemini prompt as a user turn |
| `ally-be-48b9249a` | bug | 2026-10-05 | old | 18 | 1 |  | no |  | bugs found per day leaves out findings since dismissed or rejected (AAQ-201) |
| `ally-be-9e29ea47` | bug | 2026-09-17 | old | 18 | 1 |  | no |  | a completed session that shipped nothing is not a dead end |
| `ally-be-5354ea89` | bug | 2026-09-16 | old | 18 | 1 |  | no |  | tell every run that CI happens after it, not during it |
| `ally-be-4c1f9082` | bug | 2026-09-02 | old | 18 | 1 |  | no |  | include the last day of a filed/released date range |
| `ally-be-6887295e` | bug | 2026-08-28 | old | 18 | 1 |  | no |  | fail a scan outright when every detector failed |
| `ally-be-f7b36ca5` | bug | 2026-08-24 | old | 18 | 1 |  | no |  | consume simulation credits on natural roleplay session end |
| `ally-be-6b0a670c` | bug | 2026-08-20 | old | 18 | 1 |  | no |  | stop telling an unjudged session to re-judge itself |
| `ally-be-622a592c` | bug | 2026-07-14 | old | 18 | 1 |  | no |  | gate endpoints to SUPER_DUPER_ADMIN only |
| `ally-be-0d8e33ad` | bug | 2026-02-23 | old | 18 | 1 |  | no |  | add behaviour instructions in getAdminScenarios return fields |
| `ally-be-1cfeb623` | bug | 2026-10-29 | mono | 19 | 1 |  | yes | #135 | Users or services are attempting to access `/api/v1/scribe-session-reviews/unread-count` … |
| `ally-be-e57f907e` | bug | 2026-10-22 | old | 19 | 1 |  | no | #699 | The system failed to use the Anthropic Claude model for grading quizzes due to various er… |
| `ally-be-57658e8e` | bug | 2026-09-18 | old | 19 | 1 |  | no |  | the default-engine picker applies to new sessions |
| `ally-be-4689537b` | bug | 2026-09-16 | old | 19 | 2 |  | no |  | a merged pull request is the strongest evidence there is |
| `ally-be-9fbce409` | bug | 2026-09-02 | old | 19 | 1 |  | no |  | Handle a microphone disconnect once, not twice |
| `ally-be-fd7f06b4` | bug | 2026-07-07 | old | 19 | 1 |  | no |  | read RETURNING tuple in copilot appendMessage |
| `ally-be-3c0e2fc0` | bug | 2026-10-21 | old | 20 | 1 |  | no | #686 | preserve rich text in course descriptions (#686) |
| `ally-be-fdecd2a8` | bug | 2026-07-15 | old | 20 | 1 | **yes** | no |  | give user:roles Redis cache a TTL so role changes self-heal |
| `ally-be-31fc920d` | bug | 2026-04-30 | old | 20 | 1 |  | no |  | in-app getDefinitions returns all scopes; UI hides SUPER_ADMIN from manage dialog |
| `ally-be-cf7b884d` | bug | 2026-02-03 | old | 20 | 1 |  | no |  | update badge event handling to use review context and fix badge revocation |
| `ally-be-3ffdd3c8` | bug | 2026-10-27 | mono | 21 | 2 |  | yes |  | store translations with their tokens written exactly |
| `ally-be-236f667f` | bug | 2026-10-12 | old | 21 | 1 |  | no |  | file build spend under the model's own provider, never a default vendor |
| `ally-be-64405be2` | bug | 2026-10-01 | old | 21 | 1 |  | no |  | drop the ally-web:web target; its workflow does not exist |
| `ally-be-5633d516` | bug | 2026-09-04 | old | 21 | 1 | **yes** | no | #461 | make email-based login lookups case/whitespace-insensitive (#461) |
| `ally-be-4eb88e4c` | bug | 2026-01-14 | old | 21 | 1 |  | no |  | enhance session event deletion logic to prevent deletion of system-generated events |
| `ally-be-59b81b29` | bug | 2026-10-21 | old | 22 | 2 |  | no |  | a call that names its model on an untiered row resolves instead of throwing |
| `ally-be-7454bf41` | bug | 2026-10-05 | old | 22 | 3 |  | no |  | correct Gemini 2.5 cached-input rates |
| `ally-be-86d5692c` | bug | 2026-09-25 | old | 22 | 1 |  | no |  | a rollup that cannot be read is not a commit without checks |
| `ally-be-6e5a07a9` | bug | 2026-09-21 | old | 22 | 1 | **yes** | no |  | Expand JWT token extraction in WebSocketAuthMiddleware |
| `ally-be-53c1369c` | bug | 2026-08-12 | old | 22 | 1 |  | no |  | show real state names for hasStates roleplay skills |
| `ally-be-44617653` | bug | 2026-10-29 | mono | 23 | 1 |  | yes |  | require language style and dialect samples in the draft |
| `ally-be-c805ce37` | bug | 2026-10-23 | mono | 23 | 1 |  | no |  | health check falls back to the row's service when the PR file listing is truncated |
| `ally-be-7ded9d9e` | bug | 2026-10-21 | old | 23 | 1 |  | no |  | an eval suite with no loop stamped replays the legacy loop |
| `ally-be-89bf7a19` | bug | 2026-10-21 | old | 23 | 2 |  | no |  | a cached chat no longer crosses orgs; hold summary export to scope |
| `ally-be-4d677719` | bug | 2026-10-20 | old | 23 | 1 |  | no |  | draft a design from the PRD's planned repos when the session has none |
| `ally-be-fa3dbfd4` | bug | 2026-10-14 | old | 23 | 2 |  | no | #628 | translate tooltips based on languageCode parameter (#628) |
| `ally-be-7da7ebfc` | bug | 2026-10-14 | old | 23 | 1 |  | no |  | a chain that stops before its last repo fails visibly and can restart |
| `ally-be-2e444a61` | bug | 2026-10-02 | old | 23 | 1 |  | no |  | make gate rechecks cheap, and make ally-web's test check real |
| `ally-be-d44f303b` | bug | 2026-09-24 | old | 23 | 1 |  | no |  | handle complex emojis in asEmoji |
| `ally-be-8eb9e54f` | bug | 2026-09-16 | old | 23 | 1 |  | no | #493 | I get this error message when trying to save a course even though the question and respon… |
| `ally-be-7c22f9a8` | bug | 2026-09-03 | old | 23 | 1 |  | no |  | overlay routing needs at least two profiles to mean anything |
| `ally-be-1bef2ff7` | bug | 2026-10-22 | old | 24 | 1 |  | no | #701 | The system failed to scan a session for glossary adherence, resulting in an error. This c… |
| `ally-be-ca9f27c9` | bug | 2026-10-13 | old | 24 | 1 |  | no |  | fix-PR admin link opens the bug's drawer |
| `ally-be-26e9836e` | bug | 2026-03-10 | old | 24 | 1 |  | no |  | scenario session experience mode and convert duration to seconds |
| `ally-be-882b352e` | bug | 2026-10-30 | mono | 25 | 1 |  | yes |  | unquote language keys and reject ones that resolve to nothing |
| `ally-be-7a649a2e` | bug | 2026-10-27 | mono | 25 | 1 |  | yes | #95 | Users are unable to create new characters through the characters tab due to an error duri… |
| `ally-be-d536f0de` | bug | 2026-10-24 | mono | 25 | 1 |  | yes | #50 | Ally weekly charts keyed by text weeks, not server-local dates |
| `ally-be-4ef7b162` | bug | 2026-10-01 | old | 25 | 2 |  | no |  | stop the interview going silent after every answered question |
| `ally-be-2e18e903` | bug | 2026-03-25 | old | 25 | 1 |  | no |  | languageCode argument passing in getScenario |
| `ally-be-64ad131f` | bug | 2026-03-03 | old | 25 | 1 |  | no |  | Enhance getLanguagesWithVoices method to support returning all active languages when voic… |
| `ally-be-4d0d2622` | bug | 2026-02-03 | old | 25 | 1 |  | no |  | community score decrement for comment deletion |
| `ally-be-d40b68f2` | bug | 2026-11-02 | mono | 26 | 1 |  | yes |  | a quote's edge punctuation is not a different quote |
| `ally-be-aaa80409` | bug | 2026-10-21 | old | 26 | 1 |  | no |  | org-restricted admins read and set credits only in their orgs |
| `ally-be-1c1fc8dc` | bug | 2026-10-07 | old | 26 | 2 |  | no |  | the supervisor aborted finished runs; Claude Code stays an engine |
| `ally-be-c04c6456` | bug | 2026-09-07 | old | 26 | 1 |  | no |  | stop the autofill rows advertising config nothing reads |
| `ally-be-6083b8d8` | bug | 2026-09-30 | old | 27 | 3 | **yes** | no |  | trust the load balancer's X-Forwarded-For so req.ip is the client |
| `ally-be-6f47df90` | bug | 2026-09-02 | old | 27 | 1 |  | no |  | bound the consolidation read to 90 days |
| `ally-be-56bef669` | bug | 2026-11-02 | mono | 28 | 1 |  | yes |  | Ask Ally may quote across one speaker's split turns |
| `ally-be-c9dee810` | bug | 2026-10-28 | mono | 28 | 2 |  | yes | #126 | let an answer restart a bug past its escalation cap |
| `ally-be-a3108474` | bug | 2026-09-17 | old | 28 | 1 |  | no |  | a stopped session can start another build |
| `ally-be-f860f992` | bug | 2026-10-21 | old | 29 | 1 |  | no |  | cold PRD reviewer files only defects that would make the build wrong |
| `ally-be-753a9728` | bug | 2026-03-02 | old | 29 | 1 |  | no |  | reflection prompts get multiple questions on session end |
| `ally-be-88f38d8a` | bug | 2026-09-18 | old | 30 | 1 |  | no |  | a premature completion is refused, not fatal, and the agent is told |
| `ally-be-33f39e12` | bug | 2026-08-28 | old | 30 | 2 |  | no |  | flag truncation in the tool-loop wrap-up pass |
| `ally-be-82d5b373` | bug | 2026-08-25 | old | 30 | 1 |  | no |  | anchor transcript-timestamp correction on agent join, not session start |
| `ally-be-c0c60b5d` | bug | 2026-05-01 | old | 30 | 1 |  | no |  | pin English fallback to en-IN by value |
| `ally-be-ec7821c2` | bug | 2026-10-24 | mono | 31 | 1 | **yes** | yes | #50 | integrate the M3 builders — one migration timestamp each, spec wiring |
| `ally-be-e928c8b1` | bug | 2026-10-22 | old | 31 | 1 |  | no |  | source the squatting-repair English reference from drafts |
| `ally-be-8b4fc962` | bug | 2026-10-21 | old | 31 | 1 |  | no |  | hold a named tenant to the caller's org scope |
| `ally-be-bdbb5c0b` | bug | 2026-10-14 | old | 31 | 1 |  | no |  | a code review can file its findings |
| `ally-be-11e0c591` | bug | 2026-10-05 | old | 31 | 1 |  | no |  | skip transcript turns a report already has |
| `ally-be-61fa450f` | bug | 2026-09-01 | old | 31 | 1 |  | no | #443 | carry tenant assignments when duplicating a non-global scenario (#443) |
| `ally-be-4c95b2a5` | bug | 2026-06-24 | old | 31 | 1 |  | no |  | branch published version from live state; reuse deleted version numbers |
| `ally-be-f2d19a1a` | bug | 2026-11-02 | mono | 32 | 2 |  | yes |  | per-step timeouts; Ask Ally hears its length rule last |
| `ally-be-4fc7edd2` | bug | 2026-10-30 | mono | 32 | 1 |  | yes | #144 | keep coordinated plans moving instead of parking them |
| `ally-be-110582bd` | bug | 2026-10-21 | old | 32 | 1 | **yes** | no |  | removing an admin's last org must say it lifts the restriction |
| `ally-be-3de650ca` | bug | 2026-10-14 | old | 32 | 3 |  | no |  | drop temperature for Claude models that reject it |
| `ally-be-e72d61a2` | bug | 2026-10-09 | old | 32 | 1 |  | no | #608 | The application frequently fails health checks due to Redis being unreachable. The logs s… |
| `ally-be-51eab7d1` | bug | 2026-10-21 | old | 33 | 1 |  | no |  | reviewer reads a plain systems list and tighter reuse/metric definitions |
| `ally-be-a13fee62` | bug | 2026-10-05 | old | 33 | 2 |  | no |  | keep the debrief chat's 10-turn window, with the summary pinned ahead of it |
| `ally-be-c6f32600` | bug | 2026-08-28 | old | 33 | 2 |  | no |  | fail a sweep that ends without closing its run |
| `ally-be-6f43d871` | bug | 2026-04-08 | old | 33 | 1 | **yes** | no |  | filter webhooks by environment before processing |
| `ally-be-46eed99b` | bug | 2026-10-28 | mono | 34 | 1 |  | yes | #129 | The PostHog analytics service is consistently unreachable or returning errors (HTTP 502).… |
| `ally-be-e2ebce2e` | bug | 2026-10-21 | old | 34 | 1 | **yes** | no |  | scrub password hashes from past impersonation audit rows |
| `ally-be-fd322db0` | bug | 2026-09-16 | old | 34 | 1 |  | no |  | recognise its own pushes |
| `ally-be-65b60338` | bug | 2026-10-21 | old | 35 | 2 | **yes** | no |  | org-restricted admins can load and save their chart layout |
| `ally-be-a5d66381` | bug | 2026-10-21 | old | 35 | 2 | **yes** | no |  | organization-restricted admins cannot impersonate |
| `ally-be-40ccf3ed` | bug | 2026-10-23 | mono | 36 | 1 |  | no |  | read "the build is ready to start" and "next, a technical design" as ready claims |
| `ally-be-850e2c0b` | bug | 2026-09-02 | old | 36 | 1 |  | no |  | an empty consolidation run must still record a batch |
| `ally-be-0ff1cad3` | bug | 2026-08-28 | old | 36 | 1 |  | no |  | attribute the sessions we generate to compare prompts |
| `ally-be-54c2314b` | bug | 2026-08-20 | old | 36 | 1 |  | no |  | flag weekly buckets too thin to read as a rate |
| `ally-be-90c0ceb4` | bug | 2026-09-16 | old | 37 | 1 |  | no |  | let an answer whose resume failed be retried |
| `ally-be-01b67017` | bug | 2026-09-07 | old | 37 | 1 |  | no |  | actually honour neverFallback, so a preview cannot lie |
| `ally-be-60852501` | bug | 2026-09-01 | old | 37 | 1 | **yes** | no |  | drop the two Roleplay Studio v2 permissions the cleanup missed |
| `ally-be-8512f4c7` | bug | 2026-08-21 | old | 37 | 1 |  | no |  | stop supervisor debrief note freezing session count at 5 |
| `ally-be-4797c034` | bug | 2026-08-03 | old | 37 | 1 |  | no |  | make Enhance fail loudly instead of returning an empty 200 |
| `ally-be-23016805` | bug | 2026-10-23 | mono | 38 | 1 |  | no | #36 | make-translations fills only missing languages |
| `ally-be-67073f91` | bug | 2026-09-04 | old | 38 | 1 |  | no |  | close the daily XP/personal-best cap race |
| `ally-be-e67a5b06` | bug | 2026-10-22 | old | 39 | 1 |  | no |  | ciSync repairs drafts that echo English over a real translation |
| `ally-be-86402b01` | bug | 2026-08-03 | old | 39 | 1 |  | no |  | write the v3 advisory for studio users, not engineers |
| `ally-be-e37a63b8` | bug | 2026-10-13 | old | 40 | 1 |  | no |  | use latest published version for scenario title and description |
| `ally-be-88cb680f` | bug | 2026-09-25 | old | 40 | 2 |  | no |  | a mined pair is confirmed only if counsellors say it |
| `ally-be-1abbe7ca` | bug | 2026-09-16 | old | 40 | 1 |  | no |  | doing the right thing must not look like failing |
| `ally-be-af82250d` | bug | 2026-11-03 | mono | 41 | 1 | **yes** | yes | #190 | migrate the already-stuck sessions to ABANDONED |
| `ally-be-91a4a063` | bug | 2026-10-24 | mono | 41 | 1 |  | yes | #50 | strip replies that echo the conversation's scaffolding |
| `ally-be-8aa706f4` | bug | 2026-09-29 | old | 41 | 1 |  | no | #567 | The Bug Hunter pipeline is repeatedly sending malformed JSON to the `/api/v1/bug-hunter/r… |
| `ally-be-a37eb15a` | bug | 2026-08-12 | old | 41 | 1 | **yes** | no |  | make optGuardrails actually gate user guardrail sampling |
| `ally-be-3b86fc28` | bug | 2026-04-29 | old | 41 | 3 |  | no |  | fix callName filter SQL quoting and wire it for counsellor logs |
| `ally-be-f9444b4c` | bug | 2026-10-29 | mono | 42 | 4 | **yes** | yes |  | move to gpt-image-1.5 and relax moderation for counselling topics |
| `ally-be-97a79c4f` | bug | 2026-08-24 | old | 42 | 1 |  | no |  | block competency delete when still referenced by a scenario or roleplay spec |
| `ally-be-6da5c5fc` | bug | 2026-03-10 | old | 42 | 3 | **yes** | no |  | Magic link url in email body |
| `ally-be-2dd42ce9` | bug | 2026-02-11 | old | 42 | 1 | **yes** | no |  | dashboard assignment logic in TenantDashboardSharedService |
| `ally-be-4ea0b2ae` | bug | 2026-09-03 | old | 43 | 2 |  | no |  | consume the evidence when a proposal restates a published rule |
| `ally-be-9e9321ec` | bug | 2026-09-02 | old | 43 | 2 |  | no |  | the adjudicator was shown the proposals as existing glossary |
| `ally-be-9a5dd527` | bug | 2026-01-06 | old | 43 | 2 | **yes** | no |  | detection data removed from translations |
| `ally-be-d8b0a6d3` | bug | 2026-10-29 | mono | 45 | 1 |  | yes | #138 | show the sweep what is already open so it stops filing duplicates |
| `ally-be-3d189da8` | bug | 2026-09-08 | old | 45 | 1 |  | no |  | walk the whole Beyond Presence roster |
| `ally-be-1cb22ca5` | bug | 2026-08-14 | old | 45 | 2 |  | no |  | make both session-end LLM passes idempotent |
| `ally-be-3e462b9e` | bug | 2026-10-08 | old | 46 | 2 |  | no |  | return a scenario's voiced languages on the learner detail |
| `ally-be-77bdac7e` | bug | 2026-10-08 | old | 46 | 3 |  | no |  | stop sending temperature to Gemini 3+ |
| `ally-be-ec4af39d` | bug | 2026-09-18 | old | 46 | 1 |  | no |  | Compute course simulation count from ROLEPLAY items, not scenario states |
| `ally-be-ecb67fcb` | bug | 2026-09-18 | old | 46 | 2 |  | no |  | the course progress dashboard shows the learner's roleplay score |
| `ally-be-3db04ef2` | bug | 2026-09-03 | old | 46 | 1 |  | no |  | stop a green job counting as a shipped build |
| `ally-be-3eb8d5c1` | bug | 2026-09-25 | old | 47 | 1 |  | no |  | a failed review no longer strands its pull request |
| `ally-be-0723d734` | bug | 2026-09-16 | old | 47 | 1 |  | no |  | drop a session error the pull requests have disproved |
| `ally-be-d00df39b` | bug | 2026-10-14 | old | 48 | 1 |  | no |  | read CI through the Actions API when the checks API is refused |
| `ally-be-4bfb6444` | bug | 2026-09-17 | old | 48 | 1 |  | no |  | evidence can correct a success the agent claimed |
| `ally-be-f89fbece` | bug | 2026-09-16 | old | 48 | 2 |  | no |  | sweep sessions, not open pull requests |
| `ally-be-4043ba49` | bug | 2026-07-31 | old | 48 | 2 |  | no |  | read callDuration as milliseconds; open Roleplay Session Logs to super-admins |
| `ally-be-39401017` | bug | 2026-10-21 | old | 49 | 1 |  | no |  | quote camelCase columns the planner leaves bare |
| `ally-be-af0c70c2` | bug | 2026-09-25 | old | 49 | 1 |  | no |  | a plan is not an outcome |
| `ally-be-62deb775` | bug | 2026-02-03 | old | 49 | 1 |  | no |  | update getUserBadges to support group filtering |
| `ally-be-3ac239ff` | bug | 2026-10-27 | mono | 50 | 2 |  | yes | #81 | make webhook handlers ignore Ally guide rooms (#81) |
| `ally-be-64d29bb0` | bug | 2026-10-12 | old | 50 | 1 |  | no |  | stop clipping a staff report's words in the brief |
| `ally-be-29dcade3` | bug | 2026-10-10 | old | 51 | 1 |  | no | #612 | translate tooltips based on Accept-Language header (#612) |
| `ally-be-8db08c21` | bug | 2026-08-21 | old | 51 | 1 |  | no |  | wrap restriction replace delete+insert in a transaction |
| `ally-be-e2773649` | bug | 2026-02-10 | old | 51 | 2 |  | no |  | add startedAt for scenario session only on agent join |
| `ally-be-9fd0723c` | bug | 2026-08-28 | old | 52 | 1 |  | no |  | fail a fix session that ends without reporting an outcome |
| `ally-be-87c6ecb8` | bug | 2026-08-27 | old | 52 | 1 | **yes** | no |  | stop a tenant's user list showing Ally staff accounts |
| `ally-be-a831d3f0` | bug | 2026-10-20 | old | 53 | 1 |  | no |  | tune the copilot's product grounding from live gpt-5 runs |
| `ally-be-9cbed6fe` | bug | 2026-08-19 | old | 53 | 1 |  | no |  | treat a job that stopped advancing as dead |
| `ally-be-0abd3d6d` | bug | 2026-10-31 | mono | 54 | 1 |  | yes |  | duplicating a simulation copies its translations |
| `ally-be-46a9a6bf` | bug | 2026-10-21 | old | 54 | 2 |  | no |  | only the session's learner can rate its debrief |
| `ally-be-4417ab09` | bug | 2026-10-21 | old | 54 | 4 |  | no |  | org-restricted admins edit only their own courses, never global |
| `ally-be-71973e21` | bug | 2026-10-21 | old | 55 | 4 |  | no |  | unique Gemini tool-call ids across passes; a refused call is not a failure |
| `ally-be-dd4074e9` | bug | 2026-09-30 | old | 55 | 1 |  | no |  | stop the wrap-up pass announcing an unsaved draft |
| `ally-be-002b5881` | bug | 2026-08-21 | old | 55 | 1 |  | no |  | let en-IN opening dialogue use its own scenario_translations row |
| `ally-be-3302676a` | bug | 2026-07-14 | old | 55 | 1 | **yes** | no |  | stop copilot turns dying at the tool-iteration cap |
| `ally-be-e37d4b01` | bug | 2026-10-23 | mono | 56 | 1 |  | no | #5 | never reuse a prompt-gate baseline from before a fixture edit (#5) |
| `ally-be-6b62bf92` | bug | 2026-10-14 | old | 56 | 1 |  | no |  | label the issue for real, and hand the spec to opencode by file |
| `ally-be-046135cf` | bug | 2026-10-05 | old | 57 | 2 |  | no |  | cancel the ai-learn run when ally-be gives up on a report |
| `ally-be-34599e51` | bug | 2026-08-31 | old | 57 | 1 |  | no |  | sweep never-started ACTIVE sessions instead of hiding them forever |
| `ally-be-c12a0cec` | bug | 2026-10-06 | old | 58 | 3 |  | no |  | keep GET me for a listener finishing chats while switched off; summaries say 'not discuss… |
| `ally-be-61b9b577` | bug | 2026-09-20 | old | 59 | 1 |  | no | #508 | contract placeholders to the source language, not a cell's own past (#508) |
| `ally-be-0ea1e6c7` | bug | 2026-09-17 | old | 59 | 1 |  | no |  | read past the first page of tags when picking a version |
| `ally-be-e75071ab` | bug | 2026-07-20 | old | 59 | 1 |  | no |  | i18n changes |
| `ally-be-5400024c` | clean | 2026-07-22 | old | 5 |  |  |  |  | support Enhance for the reminders field |
| `ally-be-4956bdd8` | clean | 2026-01-20 | old | 5 |  |  |  |  | add experience mode and timer mode to scenario seed data |
| `ally-be-1425ab83` | clean | 2026-09-15 | old | 6 |  |  |  |  | report an article's question count on the learner card |
| `ally-be-78bea8a5` | clean | 2026-09-11 | old | 6 |  |  |  |  | include evaluationMarkdown in the progress dashboard |
| `ally-be-5a8fb2fb` | clean | 2026-08-23 | old | 6 |  |  |  |  | give client working memory its own cost bucket |
| `ally-be-e6d58394` | clean | 2026-05-12 | old | 6 |  |  |  |  | pass language label to LLM for stronger regional dialect signal |
| `ally-be-27ae9daf` | clean | 2026-03-31 | old | 6 |  |  |  |  | state ID validation |
| `ally-be-8be49fce` | clean | 2026-03-05 | old | 6 |  |  |  |  | add note and created at fields in scenario session summary |
| `ally-be-5fffcb10` | clean | 2026-01-27 | old | 6 |  |  |  |  | update existing review comment reactions with new values |
| `ally-be-c0eb0a33` | clean | 2026-08-19 | old | 7 |  |  |  |  | add SPROUT to TrackGameKey |
| `ally-be-6ae3d435` | clean | 2026-08-06 | old | 7 |  |  |  |  | persist structured session memory alongside the summary text |
| `ally-be-21eb44fe` | clean | 2026-07-06 | old | 7 |  |  |  |  | drop deprecated gemini-2.0-flash from registry (keep 2.5-pro/2.5-flash) |
| `ally-be-974f6044` | clean | 2026-01-23 | old | 7 |  |  |  |  | Added message in checklist events |
| `ally-be-c188a9d4` | clean | 2026-10-05 | old | 8 |  |  |  |  | scorecard and accuracy panel are unmounted again (AAQ-167, AAQ-168) |
| `ally-be-ccd0aeb5` | clean | 2026-05-13 | old | 8 |  |  |  |  | increase share-for-review note limit from 250 to 1000 chars |
| `ally-be-d4f4ddbe` | clean | 2026-03-17 | old | 8 |  |  |  |  | return structured items array alongside prompt string for event detection |
| `ally-be-c6fa2930` | clean | 2026-10-05 | old | 9 |  |  |  |  | register the Bug Agent spend-over-time chart (AAQ-170) |
| `ally-be-193e6934` | clean | 2026-09-11 | old | 9 |  |  |  |  | expose lastActiveAt on GET /v1/users |
| `ally-be-9a947fee` | clean | 2026-07-08 | old | 9 |  |  |  |  | persist naturalness flags on the v2 spec |
| `ally-be-b07869e9` | clean | 2026-07-02 | old | 9 |  |  |  |  | fix prettier violations in tenant-admin files |
| `ally-be-d490d07f` | clean | 2026-04-15 | old | 9 |  |  |  |  | log super admin impersonation events |
| `ally-be-30b77075` | clean | 2026-09-17 | old | 10 |  |  |  |  | resume where a stopped run left off, and write the PR body where the agent can |
| `ally-be-1654ca8f` | clean | 2026-07-07 | old | 10 |  |  |  |  | expose incompleteRecording on the chat detail response |
| `ally-be-5f102d40` | clean | 2026-06-30 | old | 10 |  |  |  |  | create manual scribe notes in Dictation mode |
| `ally-be-367e3d59` | clean | 2026-04-27 | old | 10 |  |  |  |  | add local environment bypass for throttling and integrate AppConfigService |
| `ally-be-ab77fa30` | clean | 2026-01-07 | old | 10 |  |  |  |  | enhance termination event validation to require non-empty messages |
| `ally-be-0a1f570e` | clean | 2026-10-08 | old | 11 |  |  |  |  | remove Claude from the Finder menu and the workflows |
| `ally-be-4b43f336` | clean | 2026-09-25 | old | 11 |  |  |  |  | add the backchannel_phrases usage task label |
| `ally-be-94aad3c0` | clean | 2026-07-19 | old | 11 |  |  |  |  | return translated scenario description on session start |
| `ally-be-c76c856c` | clean | 2026-04-30 | old | 11 |  |  |  |  | remove the 3-fields-per-tenant cap |
| `ally-be-2be778be` | clean | 2026-04-02 | old | 11 |  |  |  |  | Added tanslation supoort for trigger warnings in single scenario |
| `ally-be-3472c335` | clean | 2026-04-01 | old | 11 |  |  |  |  | Added tanslation supoort for cases |
| `ally-be-abd17171` | clean | 2026-08-27 | old | 12 |  |  |  |  | add org_metrics_layout to per-user preferences DTO |
| `ally-be-42d24479` | clean | 2026-08-18 | old | 12 |  |  |  |  | add three game keys — tic-tac-toe, memory match, cub n pup |
| `ally-be-3ed63028` | clean | 2026-08-18 | old | 13 |  |  |  |  | update voice-latency target to 4s, add LLM TTFT target of 1.5s |
| `ally-be-d70bc44f` | clean | 2026-03-31 | old | 13 |  |  |  |  | add translation coverage for getReviewById API |
| `ally-be-75135f1a` | clean | 2026-01-19 | old | 13 |  |  |  |  | add your context in dynamic branch instruction and show code in combination events |
| `ally-be-d1d177f6` | clean | 2026-09-01 | old | 14 |  |  |  |  | validate the force-update version format at the API boundary |
| `ally-be-449fdc0f` | clean | 2026-04-13 | old | 15 |  |  |  |  | add state names to scenario seeds and pin localstack image to version 3.8.1 |
| `ally-be-fba00ea5` | clean | 2026-07-14 | old | 16 |  |  |  |  | optional scenarioId filter on GET scenario-session-reviews |
| `ally-be-d07cbe7c` | clean | 2026-06-17 | old | 16 |  |  |  |  | emit structured JSON for Basic Settings autofill |
| `ally-be-799dd8a0` | clean | 2026-07-15 | old | 17 |  |  |  |  | add excludeOwn filter to GET scenario-session-reviews |
| `ally-be-49a7269b` | clean | 2026-03-31 | old | 17 |  |  |  |  | add search by organization code |
| `ally-be-06e1a5a9` | clean | 2026-01-27 | old | 17 |  |  |  |  | add comments count retrieval by review IDs with hidden comments filter |
| `ally-be-99024196` | clean | 2026-10-08 | old | 18 |  |  |  |  | register the Bug Agent scoreboard and decision replay tables (AAQ-235, AAQ-236) |
| `ally-be-ca0c112c` | clean | 2026-09-24 | old | 18 |  |  |  |  | the reporting protocol as MCP tools, not shell commands |
| `ally-be-cae181fc` | clean | 2026-07-20 | old | 18 |  |  |  |  | Add Transcript Translation Support for Supervisors on Feedback Screen |
| `ally-be-6c4f7298` | clean | 2026-06-29 | old | 18 |  |  |  |  | deprecate enableProsody DTO field |
| `ally-be-d6fccab6` | clean | 2026-06-10 | old | 18 |  |  |  |  | record main-agent skill version per report |
| `ally-be-c34e4f00` | clean | 2026-03-24 | old | 18 |  |  |  |  | updated packages and made related changes |
| `ally-be-eb2abcb4` | clean | 2026-02-24 | old | 18 |  |  |  |  | add AI Learn Service URL and Key to configuration and update AiService to support learn s… |
| `ally-be-a4aeb870` | clean | 2026-01-02 | old | 18 |  |  |  |  | google signin implementation for android and ios |
| `ally-be-1c72234b` | clean | 2026-09-25 | old | 19 |  |  |  |  | register backchannel-phrases in the AI task registry |
| `ally-be-c511e5d9` | clean | 2026-09-11 | old | 19 |  |  |  |  | let the agent read the corpus retrieval log and its judgments |
| `ally-be-cc0f33ae` | clean | 2026-05-10 | old | 19 |  |  |  |  | track client platform on scenario sessions |
| `ally-be-2b86e22e` | clean | 2026-01-22 | old | 19 |  |  |  |  | add checklist events to scenario preview response |
| `ally-be-28291212` | clean | 2026-02-17 | old | 20 |  |  |  |  | add getCaseItemByScenarioId method to CaseSharedService and integrate it into ScenarioSer… |
| `ally-be-50718992` | clean | 2026-09-25 | old | 21 |  |  |  |  | register agent-clip-tts in the AI task registry |
| `ally-be-d2f594c8` | clean | 2026-08-18 | old | 21 |  |  |  |  | fix pre-existing prettier violations blocking lint |
| `ally-be-7c314dd3` | clean | 2026-06-04 | old | 21 |  |  |  |  | add enableFeedback flag to toggle post-session AI summary |
| `ally-be-de5602cf` | clean | 2026-05-04 | old | 21 |  |  |  |  | serve published translations at /i18n/* via Nest static |
| `ally-be-fd2b8d9a` | clean | 2026-01-16 | old | 21 |  |  |  |  | update README and API references to reflect Node.js v24 and Ally API changes |
| `ally-be-44444562` | clean | 2026-09-30 | old | 22 |  |  |  |  | accept opencode as a Bug Hunter engine |
| `ally-be-145fa0b2` | clean | 2026-09-17 | old | 22 |  |  |  |  | report turns per attempt, so routing can be judged on evidence |
| `ally-be-3029c1e6` | clean | 2026-06-26 | old | 22 |  |  |  |  | add interimReplyEnabled per-simulation flag |
| `ally-be-b7b5710f` | clean | 2026-06-25 | old | 22 |  |  |  |  | per-scenario Trim History toggle to shorten the prompt |
| `ally-be-9246dab3` | clean | 2026-06-16 | old | 22 |  |  |  |  | add fillerEnabled scenario toggle |
| `ally-be-fa79aa44` | clean | 2026-05-07 | old | 22 |  |  |  |  | make studio fields optional in scenario validation |
| `ally-be-8d015331` | clean | 2026-03-09 | old | 22 |  |  |  |  | Prevent duplicate agent dispatches by checking for existing agents in the room before dis… |
| `ally-be-137807ec` | clean | 2026-02-25 | old | 22 |  |  |  |  | add enabled flag to badge response and update repository query |
| `ally-be-2f6f5af4` | clean | 2026-01-29 | old | 22 |  |  |  |  | add 'view:user:tenant' permission to REVIEWER group and create migration for database upd… |
| `ally-be-77685e35` | clean | 2026-01-27 | old | 22 |  |  |  |  | implement badge revocation on review comment deletion |
| `ally-be-2d42784c` | clean | 2026-08-19 | old | 23 |  |  |  |  | widen the judge backlog window to 150 days |
| `ally-be-1d82cedb` | clean | 2026-08-03 | old | 23 |  |  |  |  | surface sttFinalizeMs in admin latency analytics |
| `ally-be-031a5bc6` | clean | 2026-07-15 | old | 23 |  |  |  |  | support multiple languages per roleplay actor |
| `ally-be-9b88fee6` | clean | 2026-06-19 | old | 24 |  |  |  |  | per-scenario pauseEnabled toggle (opt-out default) |
| `ally-be-0c5a2e2d` | clean | 2026-03-20 | old | 24 |  |  |  |  | deprecated voiceId from simulation metadata |
| `ally-be-fdb2a91b` | clean | 2026-03-03 | old | 24 |  |  |  |  | update language mapping from en-GLOBAL to en-GB |
| `ally-be-9bd4f844` | clean | 2026-01-19 | old | 24 |  |  |  |  | add experienceMode default to scenario metadata |
| `ally-be-aab1caf6` | clean | 2026-09-25 | old | 25 |  |  |  |  | re-home AAQ-018/019/020/026/035 to Highlights > Goals |
| `ally-be-c659fc55` | clean | 2026-09-04 | old | 25 |  |  |  |  | log why a mobile recording never starts |
| `ally-be-114185ba` | clean | 2026-08-04 | old | 25 |  |  |  |  | offer age on every provider, not just Sarvam |
| `ally-be-f037b321` | clean | 2026-05-27 | old | 25 |  |  |  |  | add VIEW_PROMPT permission for multi-tenant admin and adjust scenario validation logging |
| `ally-be-078e3870` | clean | 2026-05-10 | old | 25 |  |  |  |  | persist credits used in session metadata |
| `ally-be-b1f695da` | clean | 2026-03-17 | old | 25 |  |  |  |  | Scope prompt obsolescence by sync source to prevent unintended deletions of prompts from … |
| `ally-be-7bc3add2` | clean | 2026-03-16 | old | 25 |  |  |  |  | implement multi-tenant admin role restrictions for add/update user |
| `ally-be-9ef0512f` | clean | 2026-02-18 | old | 25 |  |  |  |  | update unique index for scenario_behavior_instruction_behaviors table |
| `ally-be-210f6c11` | clean | 2026-01-12 | old | 25 |  |  |  |  | filter sensitive/unwanted fields from sceanrio-session |
| `ally-be-f849f47f` | clean | 2026-10-01 | old | 26 |  |  |  |  | return the session creator's name on session detail |
| `ally-be-52f6c601` | clean | 2026-09-30 | old | 26 |  |  |  |  | a scheduled pass catches up a large backlog in one go |
| `ally-be-f1db83e1` | clean | 2026-08-07 | old | 26 |  |  |  |  | per-scenario turnMaxEndpointingDelay setting |
| `ally-be-c8c80871` | clean | 2026-07-27 | old | 26 |  |  |  |  | trace webhook events dropped by the environment filter |
| `ally-be-0dc5c0f4` | clean | 2026-01-21 | old | 26 |  |  |  |  | add flag to hide rank in leaderboard |
| `ally-be-3264275a` | clean | 2026-09-24 | old | 27 |  |  |  |  | accept quarter bucket on weak-performing-metrics |
| `ally-be-b25749ff` | clean | 2026-09-02 | old | 27 |  |  |  |  | add a "filed by" (createdBy) board grouping (#446) |
| `ally-be-de31f4e9` | clean | 2026-08-14 | old | 27 |  |  |  |  | apply prettier to files that landed unformatted |
| `ally-be-08650c2f` | clean | 2026-08-12 | old | 27 |  |  |  |  | surface last scenario session id for completed roleplay items |
| `ally-be-7b340346` | clean | 2026-05-25 | old | 27 |  |  |  |  | add tooltip translations |
| `ally-be-40bf0cec` | clean | 2026-04-03 | old | 27 |  |  |  |  | add default stateNames to scenario metadata |
| `ally-be-bd4968b7` | clean | 2026-08-03 | old | 28 |  |  |  |  | filter the admin course list by tenant assignment |
| `ally-be-2086f57a` | clean | 2026-02-25 | old | 28 |  |  |  |  | add endpoint to remove badges from tenants |
| `ally-be-ebd074a6` | clean | 2026-08-03 | old | 29 |  |  |  |  | persist sttFinalizeMs on scenario_session_turn_metrics |
| `ally-be-4be941d8` | clean | 2026-04-03 | old | 29 |  |  |  |  | Add State names for simulation room |
| `ally-be-c4f034cf` | clean | 2026-01-23 | old | 29 |  |  |  |  | Add tags field to session events entity, DTO, and mapping with a database migration. (#93) |
| `ally-be-c434a516` | clean | 2026-06-29 | old | 30 |  |  |  |  | add per-roleplay LLM temperature to scenario metadata |
| `ally-be-a7299818` | clean | 2026-03-02 | old | 30 |  |  |  |  | Optional linguistic style samples |
| `ally-be-b07e4308` | clean | 2026-02-23 | old | 30 |  |  |  |  | add competecyId and behaviorInstructions in scenario duplication logic |
| `ally-be-28d5a081` | clean | 2026-01-06 | old | 30 |  |  |  |  | add validation for max autotermination events and filter autotermination events from scen… |
| `ally-be-62815ca2` | clean | 2026-08-22 | old | 31 |  |  |  |  | filter findings by the sweep that touched them |
| `ally-be-8f8e89b5` | clean | 2026-03-17 | old | 33 |  |  |  |  | Added role permission for multi tenant admin |
| `ally-be-867df764` | clean | 2026-01-27 | old | 33 |  |  |  |  | enhance review response with reactions and user-specific reaction data |
| `ally-be-3fa2c9dc` | clean | 2026-01-21 | old | 33 |  |  |  |  | add reviewId and review status in scenario session get |
| `ally-be-9f76ade3` | clean | 2026-09-18 | old | 34 |  |  |  |  | tell the agent how to run one test file |
| `ally-be-c5e14f91` | clean | 2026-08-06 | old | 34 |  |  |  |  | persist v2v tester run metrics on the session |
| `ally-be-ee08d052` | clean | 2026-05-07 | old | 34 |  |  |  |  | add reportMarkdown field to scenario reports |
| `ally-be-4192cd3d` | clean | 2026-03-26 | old | 34 |  |  |  |  | Update language samples for voice preview. |
| `ally-be-8f02129f` | clean | 2026-01-15 | old | 34 |  |  |  |  | add checklistVisibilityStatus to scenario events |
| `ally-be-b82b573b` | clean | 2026-06-11 | old | 35 |  |  |  |  | persist fan-out branch times on turn metrics |
| `ally-be-3bc1b225` | clean | 2026-05-18 | old | 35 |  |  |  |  | grant session/scenario events view permissions to multi-tenant admin |
| `ally-be-ea89ca03` | clean | 2026-02-12 | old | 35 |  |  |  |  | add get latest scenario session by cse session item id API |
| `ally-be-5a48ae1b` | clean | 2026-08-20 | old | 36 |  |  |  |  | tell the judge which client turns the learner talked over |
| `ally-be-2be0acb2` | clean | 2026-05-19 | old | 36 |  |  |  |  | add per-simulation enableProsody toggle |
| `ally-be-182b246b` | clean | 2026-05-13 | old | 36 |  |  |  |  | strip HTML from challenge description before sending to LiveKit |
| `ally-be-cfc30527` | clean | 2026-03-24 | old | 36 |  |  |  |  | Enhance prompt resolution to prioritize default prompts when dashboard override is disabl… |
| `ally-be-95dede3c` | clean | 2026-03-03 | old | 36 |  |  |  |  | Add open ai translation layer on scenario events |
| `ally-be-b416571d` | clean | 2026-02-13 | old | 36 |  |  |  |  | add session glimpse in upcoming case API |
| `ally-be-cbe66429` | clean | 2026-01-15 | old | 36 |  |  |  |  | add VIEW_ADMIN_LANGUAGES permission for language management |
| `ally-be-dfa5cf1e` | clean | 2026-08-20 | old | 37 |  |  |  |  | name the still-accruing bucket on the weak-metrics response |
| `ally-be-d168f0c3` | clean | 2026-08-05 | old | 37 |  |  |  |  | temporary per-simulation canary gate for the glossary |
| `ally-be-fc08d6be` | clean | 2026-07-27 | old | 37 |  |  |  |  | add language column and filter |
| `ally-be-5fd842ca` | clean | 2026-06-18 | old | 37 |  |  |  |  | voice-latency endpoint filters by language |
| `ally-be-ad30466a` | clean | 2026-05-07 | old | 37 |  |  |  |  | add NONE option to ExperienceMode enum |
| `ally-be-c0295eb4` | clean | 2026-04-14 | old | 37 |  |  |  |  | add translated event names to scenario session event checklist |
| `ally-be-ffd3475a` | clean | 2026-04-07 | old | 37 |  |  |  |  | add language translation support to scenario session endpoints |
| `ally-be-19d0a1b9` | clean | 2026-03-27 | old | 37 |  |  |  |  | add enableDictationMode to tenant settings |
| `ally-be-bd3c1c8b` | clean | 2026-02-24 | old | 37 |  |  |  |  | add migration to convert active scenarios to draft with missing mandatory fields |
| `ally-be-d8ebaa03` | clean | 2026-01-07 | old | 37 |  |  |  |  | add validation for time and score type events |
| `ally-be-ecfac12b` | clean | 2026-09-01 | old | 38 |  |  |  |  | forward an optional What's New text on Android promotion |
| `ally-be-b7cf4066` | clean | 2026-03-06 | old | 38 |  |  |  |  | enhance prompt handling with default content fallback |
| `ally-be-b29aa1be` | clean | 2026-09-15 | old | 39 |  |  |  |  | expose the review and approve switches on the settings API |
| `ally-be-f3e78b7e` | clean | 2026-09-15 | old | 39 |  |  |  |  | run the review phase in the engine |
| `ally-be-0f139f7a` | clean | 2026-04-07 | old | 39 |  |  |  |  | add language translation support to scenario session endpoints |
| `ally-be-8c5367c1` | clean | 2026-04-02 | old | 39 |  |  |  |  | Add translation support for pathways |
| `ally-be-0ab23d6e` | clean | 2026-04-01 | old | 39 |  |  |  |  | Added tanslation supoort for pathways |
| `ally-be-bfff4f65` | clean | 2026-03-25 | old | 39 |  |  |  |  | migrate scenario translations into scenarios.translations JSON column |
| `ally-be-2f31f398` | clean | 2026-03-23 | old | 39 |  |  |  |  | Add state instruction in start and preview scenario session |
| `ally-be-9b6f1220` | clean | 2026-03-05 | old | 39 |  |  |  |  | add occurrence interval in detection config |
| `ally-be-6f2d6c4a` | clean | 2026-02-27 | old | 39 |  |  |  |  | implement pagination for scenario report transcripts with limit and offset options |
| `ally-be-6b5647ff` | clean | 2026-06-29 | old | 40 |  |  |  |  | enable comfort audio, trim history, and interim reply for all existing roleplays |
| `ally-be-0bb979b5` | clean | 2026-03-24 | old | 40 |  |  |  |  | increase rate limit for role plays |
| `ally-be-2238031b` | clean | 2026-01-27 | old | 40 |  |  |  |  | emit event on comment deletion to handle related data |
| `ally-be-cc76e7dc` | clean | 2026-10-06 | old | 41 |  |  |  |  | retry a failed QA judgement on later ticks, up to 3 attempts |
| `ally-be-a2ed4959` | clean | 2026-09-03 | old | 41 |  |  |  |  | split machine time from waiting for a person |
| `ally-be-d77c088a` | clean | 2026-08-06 | old | 41 |  |  |  |  | v2v-test a track item via trackItemProgressId |
| `ally-be-5017783f` | clean | 2026-08-03 | old | 41 |  |  |  |  | backfill historyTrimEnabled=true for all scenarios |
| `ally-be-7920812e` | clean | 2026-03-06 | old | 41 |  |  |  |  | enhance prompts with optional metadata support |
| `ally-be-2c0661e1` | clean | 2026-09-09 | old | 42 |  |  |  |  | expose corpus and character topics on the document API |
| `ally-be-9016fe8b` | clean | 2026-07-10 | old | 42 |  |  |  |  | add author name field to posts |
| `ally-be-d4acea06` | clean | 2026-06-08 | old | 42 |  |  |  |  | show Reviewed badge on simulation review cards |
| `ally-be-1b4ec212` | clean | 2026-01-12 | old | 42 |  |  |  |  | add autotermination status in scenario session events |
| `ally-be-7de66c0b` | clean | 2026-08-20 | old | 43 |  |  |  |  | default sweeps/fixes to Sonnet 5, escalate to Opus 5 per-bug |
| `ally-be-4add2c14` | clean | 2026-06-17 | old | 43 |  |  |  |  | add STT-model dimension to 'by experiment'; drop provider |
| `ally-be-549a07a6` | clean | 2026-04-14 | old | 43 |  |  |  |  | concatenate messages into a single paragraph for dictation mode |
| `ally-be-fc350daf` | clean | 2026-10-03 | old | 44 |  |  |  |  | fhsBenchmark per-roleplay flag on scenarios.metadata |
| `ally-be-df45073a` | clean | 2026-08-10 | old | 44 |  |  |  |  | all-languages adherence overview endpoint |
| `ally-be-fbaade74` | clean | 2026-07-22 | old | 44 |  |  |  |  | serve Tier 1 glossary sections for knowledge retrieval |
| `ally-be-035b9973` | clean | 2026-07-09 | old | 44 |  |  |  |  | align agent-join-reliability auth with SUPER_ADMIN_ROLES |
| `ally-be-e00d23dc` | clean | 2026-06-26 | old | 44 |  |  |  |  | persist per-simulation continuous back-channeling toggle |
| `ally-be-733b08ad` | clean | 2026-02-24 | old | 44 |  |  |  |  | add icon url in skills reponse |
| `ally-be-34e98acb` | clean | 2026-08-31 | old | 45 |  |  |  |  | pass whatsNew through to the App Store submission |
| `ally-be-e126ce2c` | clean | 2026-06-18 | old | 45 |  |  |  |  | chart drift by main-agent prompt NAME, not version number |
| `ally-be-88dbbc8f` | clean | 2026-03-24 | old | 45 |  |  |  |  | Update AI prompt structures to support `PromptOverride` type with `availableVariables`. |
| `ally-be-12cb21ac` | clean | 2026-03-16 | old | 45 |  |  |  |  | implement multi-tenant admin auth in updateTenant & fix uniqueness bug |
| `ally-be-e7efa8b5` | clean | 2026-02-23 | old | 45 |  |  |  |  | add API for bulk insertion of behaviors |
| `ally-be-42ff3c20` | clean | 2026-05-12 | old | 46 |  |  |  |  | per-scenario language label override plumbed end-to-end |
| `ally-be-5ea36c5e` | clean | 2026-03-10 | old | 46 |  |  |  |  | add sortOrder and sortBy to get comments API |
| `ally-be-c7ece239` | clean | 2026-09-17 | old | 47 |  |  |  |  | Record LLM engine and model for pipeline runs (#497) |
| `ally-be-d3941796` | clean | 2026-07-06 | old | 48 |  |  |  |  | wire module, engine branch, v1 edit guard, docs |
| `ally-be-20564e93` | clean | 2026-05-12 | old | 48 |  |  |  |  | Added rich text editor |
| `ally-be-fb29a7ed` | clean | 2026-02-17 | old | 49 |  |  |  |  | add includeUserCount option to findById in TenantController and update related services a… |
| `ally-be-cedbdb39` | clean | 2026-07-01 | old | 50 |  |  |  |  | unify scribe review structure with simulation |
| `ally-be-ca67d6ee` | clean | 2026-03-09 | old | 50 |  |  |  |  | Implement race condition prevention for agent dispatch by tracking in-progress dispatches… |
| `ally-be-9ea41d62` | clean | 2026-07-22 | old | 51 |  |  |  |  | serve Tier 0 language glossary in room metadata + size telemetry |
| `ally-be-56bd4118` | clean | 2026-03-31 | old | 51 |  |  |  |  | add translation support for scenario titles in review list API |
| `ally-be-733407b1` | clean | 2026-02-27 | old | 51 |  |  |  |  | add language support to scenario report DTO and service |
| `ally-be-370c750a` | clean | 2026-02-18 | old | 51 |  |  |  |  | add prompts in metadat for ai service |
| `ally-be-bf447389` | clean | 2026-01-14 | old | 51 |  |  |  |  | add provider configurations to language management |
| `ally-be-82bf5665` | clean | 2026-01-08 | old | 51 |  |  |  |  | add dynamic branch instructions (#82) |
| `ally-be-b6bb2ade` | clean | 2026-03-24 | old | 52 |  |  |  |  | Add audit log and multi tenant restriction on settings module |
| `ally-be-a8824dfe` | clean | 2026-03-23 | old | 52 |  |  |  |  | Update seed script for scenario behavior state instructions |
| `ally-be-ff72e09a` | clean | 2026-01-29 | old | 52 |  |  |  |  | add user based replies count to get all messages API and update isHidden variable name to… |
| `ally-be-b7ed8566` | clean | 2026-06-30 | old | 53 |  |  |  |  | add read tracking, read filter, and sort support |
| `ally-be-05103e1e` | clean | 2026-02-05 | old | 53 |  |  |  |  | Add endpoint and logic to retrieve unique session event tags with optional search filter.… |
| `ally-be-f19603d1` | clean | 2026-10-06 | old | 54 |  |  |  |  | registry componentFile paths match where the effectiveness cards render |
| `ally-be-70f7637e` | clean | 2026-09-24 | old | 54 |  |  |  |  | average rating per period on quality-distribution |
| `ally-be-e367aec7` | clean | 2026-04-30 | old | 54 |  |  |  |  | require SYSTEM_ACCESS for tenant-scoped custom field operations |
| `ally-be-09d4f01e` | clean | 2026-03-30 | old | 55 |  |  |  |  | add viewUserTenant permission to scribe reviewer |
| `ally-be-83e12463` | clean | 2026-02-18 | old | 55 |  |  |  |  | add behavior instructions in livekit metadata and update test cases |
| `ally-be-08a9519c` | clean | 2026-03-24 | old | 56 |  |  |  |  | update behavior stae instructions generation |
| `ally-be-c1836e82` | clean | 2026-01-23 | old | 56 |  |  |  |  | Added filter on scenario voices |
| `ally-be-fa5634ed` | clean | 2026-01-22 | old | 56 |  |  |  |  | add scenario session in response of review get by id and list all reviews API |
| `ally-be-07099ef1` | clean | 2026-01-19 | old | 56 |  |  |  |  | implement session timer feature for simulations |
| `ally-be-4a94d984` | clean | 2026-08-13 | old | 57 |  |  |  |  | add LLM TTFT to the voice-latency trend endpoint |
| `ally-be-283e18e5` | clean | 2026-08-05 | old | 57 |  |  |  |  | stamp glossary provenance on room metadata for analytics |
| `ally-be-7e2c7f53` | clean | 2026-07-17 | old | 57 |  |  |  |  | email evaluators a portal invite on create/regenerate |
| `ally-be-2cc650cc` | clean | 2026-05-29 | old | 57 |  |  |  |  | clear stale availableVariables for Main Agent Prompt #2 on next boot |
| `ally-be-d91ab128` | clean | 2026-02-25 | old | 57 |  |  |  |  | Add active column in voices |
| `ally-be-26eb0adb` | clean | 2026-04-02 | old | 58 |  |  |  |  | enhance translation handling by normalizing opening statements and adding metadata parsing |
| `ally-be-6025c98e` | clean | 2026-08-31 | old | 59 |  |  |  |  | Remove the manual iOS TestFlight promote endpoint |
| `ally-be-23fe5382` | clean | 2026-07-07 | old | 59 |  |  |  |  | record V2V test audio and expose playback URL |
| `ally-be-764daa4f` | clean | 2026-08-31 | old | 60 |  |  |  |  | seed the missing Live events tab tooltip |
| `ally-be-888d8c06` | clean | 2026-08-26 | old | 60 |  |  |  |  | drop the two unauthenticated public routes |
| `ally-be-b7758ecc` | clean | 2026-08-04 | old | 60 |  |  |  |  | offer Google's Gemini voices, and let preview render them |
| `ally-be-7925fa5e` | clean | 2026-03-02 | old | 60 |  |  |  |  | enhance logging for scenario report updates and webhook handling |
| `ally-be-8d5547a4` | clean | 2026-08-18 | old | 61 |  |  |  |  | drain the language backlog too |
| `ally-be-83d187cd` | clean | 2026-03-16 | old | 61 |  |  |  |  | add review check while deleting a chat |
| `ally-be-9027c368` | clean | 2026-02-19 | old | 61 |  |  |  |  | add endpoint to retrieve badges assigned to a specific tenant |
| `ally-be-cfff6d62` | clean | 2026-01-27 | old | 61 |  |  |  |  | enhance review comment service with user-specific reaction retrieval and count |
| `ally-be-4ec6cd0e` | clean | 2026-02-06 | old | 62 |  |  |  |  | Add endpoint to delete multiple scenario characters with validation |
| `ally-be-fbc92ece` | clean | 2026-02-26 | old | 63 |  |  |  |  | implement time validation for maxTimeValue in scenario service |
| `ally-be-560a61f7` | clean | 2026-01-29 | old | 63 |  |  |  |  | add createdBy and updatedBy fields to Badge entity |
| `ally-be-64c48be0` | clean | 2026-06-27 | old | 64 |  |  |  |  | add POST /v1/chats/note for manual scribe notes |
| `ally-be-576e01a2` | clean | 2026-06-01 | old | 64 |  |  |  |  | require strict numeric bounds (drop "open" ends) |
| `ally-be-d887b4eb` | clean | 2026-03-04 | old | 64 |  |  |  |  | Add endpoint to retrieve available OpenAI models for autofill and implement caching mecha… |
| `ally-be-b65f1389` | clean | 2026-09-22 | old | 65 |  |  |  |  | seed Apr-Aug 2026 XP goals, fix Goals chart floor to Apr 2026 |
| `ally-be-5f804625` | clean | 2026-02-09 | old | 65 |  |  |  |  | Added versions limitaion on prompt |
| `ally-be-16e5e9ee` | clean | 2026-09-28 | old | 67 |  |  |  |  | register the seven Bug Agent volume charts (AAQ-158 to AAQ-164) |
| `ally-be-00507dce` | clean | 2026-08-31 | old | 67 |  |  |  |  | let a roadmap manager assign an owner when filing |
| `ally-be-5473f3a0` | clean | 2026-03-26 | old | 67 |  |  |  |  | Added translation support for Cases and Pathwways |
| `ally-be-337ede73` | clean | 2026-03-12 | old | 67 |  |  |  |  | add summary name field to return type |
| `ally-be-881f5aef` | clean | 2026-01-22 | old | 67 |  |  |  |  | edit comment API |
| `ally-be-4064d7ef` | clean | 2026-10-05 | old | 68 |  |  |  |  | a stated repo beats a guessed one; re-classify on edit; teach the classifier the folder m… |
| `ally-be-ae357812` | clean | 2026-09-01 | old | 68 |  |  |  |  | expose the Android production-track status as a read endpoint |
| `ally-be-a25e62cf` | clean | 2026-08-26 | old | 69 |  |  |  |  | bug READ endpoints follow the roadmap, not the toggle |
| `ally-be-fe22e1d8` | clean | 2026-06-24 | old | 69 |  |  |  |  | remove static fillerDialogues (LLM now generates fillers) |
| `ally-be-d7b28bd0` | clean | 2026-06-17 | old | 69 |  |  |  |  | persist per-user sidebar order + grant super-admin preference perms |
| `ally-be-0f888bf2` | clean | 2026-03-25 | old | 69 |  |  |  |  | Introduce a `category` field for prompts with corresponding database migration, API DTOs,… |
| `ally-be-d4971e66` | clean | 2026-03-24 | old | 69 |  |  |  |  | Add `availableVariables` to prompts, including database migration, entity updates, and se… |
| `ally-be-36ee6f05` | clean | 2026-02-11 | old | 69 |  |  |  |  | migrate context and dialogues to stateInstructions in scenarios |
| `ally-be-9f7a65a1` | clean | 2026-01-15 | old | 69 |  |  |  |  | add API to retrieve count of badges awarded to the current user |
| `ally-be-22595113` | clean | 2026-01-02 | old | 69 |  |  |  |  | add google sign in |
| `ally-be-98cadc37` | clean | 2026-08-19 | old | 70 |  |  |  |  | persist and chart prompt-cache hit rate |
| `ally-be-dbd0ea58` | clean | 2026-05-11 | old | 70 |  |  |  |  | add audio playback for role-play sessions in review feed |
| `ally-be-07e3576f` | clean | 2026-07-30 | old | 71 |  |  |  |  | generate backstory, opening dialogues, reminders, and linguistic style/filler fields |
| `ally-be-1bef2d30` | clean | 2026-05-30 | old | 71 |  |  |  |  | tags based feedback on simulation |
| `ally-be-59b0cedd` | clean | 2026-01-19 | old | 71 |  |  |  |  | add tenant column to review related entities |
| `ally-be-c95d5f61` | clean | 2026-01-06 | old | 71 |  |  |  |  | add google signin access token integration |
| `ally-be-29b9b2e9` | clean | 2026-07-22 | old | 73 |  |  |  |  | gate reminders visibility behind a new remindersEnabled scenario toggle |
| `ally-be-1c617637` | clean | 2026-03-03 | old | 73 |  |  |  |  | Implement language code normalization for TTS providers and update sample text mappings |
| `ally-be-f3fcd439` | clean | 2026-03-26 | old | 74 |  |  |  |  | Added tanslation supoort for Path ways |
| `ally-be-4dd8a80c` | clean | 2026-10-05 | old | 75 |  |  |  |  | return per-status counts with the findings list |
| `ally-be-c354d441` | clean | 2026-03-20 | old | 75 |  |  |  |  | Added log system for tenant and learn for multi tenant |
| `ally-be-45f392e9` | clean | 2026-01-28 | old | 75 |  |  |  |  | add learner role filter in leaderboard and null for new user |
| `ally-be-2fed59e8` | clean | 2026-08-31 | old | 76 |  |  |  |  | narrow the owner picker to the named product leads |
| `ally-be-7273151a` | clean | 2026-03-18 | old | 76 |  |  |  |  | Add `kind` and `usesBlocks` properties to the prompt entity, DTOs, services, types, and d… |
| `ally-be-75458462` | clean | 2026-01-16 | old | 76 |  |  |  |  | add experience mode and checklist type support |
| `ally-be-59de34de` | clean | 2026-08-06 | old | 78 |  |  |  |  | glossary + multilingual prompts ON by default, SDA-gated opt-out |
| `ally-be-ac7f3716` | clean | 2026-06-23 | old | 78 |  |  |  |  | re-translate primary+translation fields on enhance |
| `ally-be-126683e4` | clean | 2026-03-20 | old | 78 |  |  |  |  | add cover image, video, and profile text fields to character |
| `ally-be-f5178113` | clean | 2026-03-16 | old | 78 |  |  |  |  | Add dynamic prompt override capability to AI requests via PromptModule integration and Ai… |
| `ally-be-053a9e79` | clean | 2026-03-10 | old | 78 |  |  |  |  | support marking obsolete prompts during sync and soft deletes |
| `ally-be-53068912` | clean | 2026-08-04 | old | 80 |  |  |  |  | deprecate Sentence/Semantic Similarity event types |
| `ally-be-c2739e73` | clean | 2026-06-25 | old | 80 |  |  |  |  | deliver transcript before summarization (phase 1) |
| `ally-be-d6eed2c3` | clean | 2026-10-02 | old | 81 |  |  |  |  | split bridge lines from the legacy interim in "heard first" |
| `ally-be-8119348c` | clean | 2026-08-04 | old | 81 |  |  |  |  | publish each catalog voice's gender so pickers can narrow by it |
| `ally-be-d7adbce5` | clean | 2026-03-16 | old | 81 |  |  |  |  | implement multi-tenant admin auth and permission updates |
| `ally-be-6985db5b` | clean | 2026-01-19 | old | 81 |  |  |  |  | add badge viewed status change API |
| `ally-be-3bfa71ee` | clean | 2026-03-18 | old | 82 |  |  |  |  | Enhance getPrompts method to include an optional includeBlocks parameter, updating relate… |
| `ally-be-e7fffeaf` | clean | 2026-03-12 | old | 82 |  |  |  |  | Add Multi tenant role |
| `ally-be-7647b993` | clean | 2026-02-19 | old | 83 |  |  |  |  | add minimum supported version endpoints for Android and iOS |
| `ally-be-88e7c452` | clean | 2026-01-21 | old | 83 |  |  |  |  | add admin API to retrieve all badges and update available badges endpoint |
| `ally-be-4d90e70a` | clean | 2026-03-31 | old | 84 |  |  |  |  | Added tanslation supoort for badges |
| `ally-be-9dd04875` | clean | 2026-03-27 | old | 85 |  |  |  |  | Migrate scenario voice management from `voiceId` to `languageVoices` and consolidate scen… |
| `ally-be-acc0f60a` | clean | 2026-03-11 | old | 85 |  |  |  |  | add review check when archiving a chat |
| `ally-be-866a6d4f` | clean | 2026-03-24 | old | 86 |  |  |  |  | implement dynamic payload localization for scenario fetch APIs |
| `ally-be-5311f88a` | clean | 2026-07-14 | old | 87 |  |  |  |  | promote gopikrishnan.sasikumar to SUPER_DUPER_ADMIN |
| `ally-be-b13ea12d` | clean | 2026-01-22 | old | 87 |  |  |  |  | add API to get review reaction and count |
| `ally-be-8ab3e79e` | clean | 2026-08-04 | old | 88 |  |  |  |  | annotate the model catalog per voice, and let ElevenLabs overrule us |
| `ally-be-bef5f673` | clean | 2026-08-03 | old | 88 |  |  |  |  | expose ElevenLabs' account-wide model catalog |
| `ally-be-7304cdc0` | clean | 2026-04-15 | old | 89 |  |  |  |  | added impersonation option for super admin |
| `ally-be-7568c329` | clean | 2026-06-29 | old | 90 |  |  |  |  | restrict scribe/dictation recording to counsellors |
| `ally-be-c74fca97` | clean | 2026-07-27 | old | 91 |  |  |  |  | populate language on turn/start metrics at write time |
| `ally-be-18d4a755` | clean | 2026-02-10 | old | 92 |  |  |  |  | add validate permissions endpoint |
| `ally-be-17f16e3c` | clean | 2026-01-30 | old | 92 |  |  |  |  | add new response DTOs and type definitions |
| `ally-be-0c68deba` | clean | 2026-08-04 | old | 93 |  |  |  |  | filter the voices list by age, and share one config-field filter |
| `ally-be-42bd3e44` | clean | 2026-07-14 | old | 93 |  |  |  |  | allow multi-tenant admins to create and edit their own events |
| `ally-be-a2df3be3` | clean | 2026-04-24 | old | 93 |  |  |  |  | add support for en-US language and update en-GB label to English (UK) |
| `ally-be-77b30693` | clean | 2026-03-24 | old | 93 |  |  |  |  | add translations JSONB column with optimized persistence and change detection |
| `ally-be-eec53742` | clean | 2026-10-01 | old | 94 |  |  |  |  | gate Open in Builder on Builder access; revoke product_roadmap_manage |
| `ally-be-1eed9610` | clean | 2026-03-12 | old | 94 |  |  |  |  | add knowledge sources in scenario |
| `ally-be-e5bab597` | clean | 2026-10-06 | old | 95 |  |  |  |  | LlmTask labels and AI task registry rows for the copilot and QA |
| `ally-be-9033fe86` | clean | 2026-09-25 | old | 95 |  |  |  |  | make the PRD say which repo owns each change |
| `ally-be-9b455168` | clean | 2026-04-01 | old | 95 |  |  |  |  | Added tanslation supoort for trigger warnings |
| `ally-be-53ba7afa` | clean | 2026-09-30 | old | 96 |  |  |  |  | start the consolidation prompt on gpt-5; fix repo queries |
| `ally-be-fad31492` | clean | 2026-04-17 | old | 96 |  |  |  |  | Remove fallback voice and add scenario based languages |
| `ally-be-f3816e8a` | clean | 2026-02-19 | old | 96 |  |  |  |  | update scenario report and transcript entities |
| `ally-be-83bacba5` | clean | 2026-09-23 | old | 99 |  |  |  |  | knowledge source unlocksFromStateId |
| `ally-be-cd3a1835` | clean | 2026-04-13 | old | 100 |  |  |  |  | Add mode option in call details |
| `ally-be-6444de07` | clean | 2026-03-23 | old | 100 |  |  |  |  | Add audit log and restrictions for multi tenant admin |
| `ally-be-571c0295` | clean | 2026-09-09 | old | 101 |  |  |  |  | extend XP-goals window to upcoming periods |
| `ally-be-bd5f0164` | clean | 2026-08-24 | old | 101 |  |  |  |  | per-simulation turn-endpointing delays |
| `ally-be-862ee305` | clean | 2026-07-17 | old | 101 |  |  |  |  | contract test, telemetry race recovery, allowlist cleanup |
| `ally-be-af6d259f` | clean | 2026-07-09 | old | 101 |  |  |  |  | capture AGENT_LEFT + fallback dispatch; agent name in detail |
| `ally-be-b3f107b4` | clean | 2026-07-03 | old | 101 |  |  |  |  | per-tenant toggle to gate voice-note (mic dictation), default off |
| `ally-be-2aa79782` | clean | 2026-03-17 | old | 102 |  |  |  |  | Added some permissions for multi tenant admin for tenant level setting |
| `ally-be-dca695d8` | clean | 2026-09-07 | old | 103 |  |  |  |  | per-roleplay video actor flag + video_actor admin toggle |
| `ally-be-21bc0bfc` | clean | 2026-04-06 | old | 103 |  |  |  |  | Enhance participant joined handling with improved agent dispatch logic and metadata manag… |
| `ally-be-0c456b47` | clean | 2026-02-21 | old | 103 |  |  |  |  | Add prompt use case in prompts |
| `ally-be-5b25932d` | clean | 2026-06-17 | old | 105 |  |  |  |  | per-language filler dialogues + email-gated Thinking Filler |
| `ally-be-685e5828` | clean | 2026-03-31 | old | 106 |  |  |  |  | Added tanslation supoort for badges |
| `ally-be-dade603b` | clean | 2026-02-25 | old | 106 |  |  |  |  | update functionality to upload and manage scenario cover images in the library |
| `ally-be-3b4b2da1` | clean | 2026-08-26 | old | 108 |  |  |  |  | add content_management toggle and backfill it |
| `ally-be-52532a19` | clean | 2026-07-01 | old | 108 |  |  |  |  | gate manual note creation on tenant toggle + counsellor permission |
| `ally-be-083c40f7` | clean | 2026-02-25 | old | 108 |  |  |  |  | implement paginated retrieval of badges for tenants with search and sorting options |
| `ally-be-4e4e3f81` | clean | 2026-06-25 | old | 109 |  |  |  |  | register ally_ai_learn_system_audio_tag_guidance |
| `ally-be-57c3ab96` | clean | 2026-06-24 | old | 109 |  |  |  |  | slice & compare conversation drift by scenario version |
| `ally-be-822a2922` | clean | 2026-07-24 | old | 110 |  |  |  |  | Agent Builder Copilot generates and fills States |
| `ally-be-47a72bf1` | clean | 2026-07-03 | old | 110 |  |  |  |  | persist dictated voice-note transcript |
| `ally-be-5185d091` | clean | 2026-02-18 | old | 110 |  |  |  |  | add skills api |
| `ally-be-edef705d` | clean | 2026-09-04 | old | 111 |  |  |  |  | add per-tenant toggle for the Progress dashboard |
| `ally-be-fdfb7bc1` | clean | 2026-09-11 | old | 113 |  |  |  |  | accept two external retrieval surfaces, and keep the judge honest about them |
| `ally-be-54aeeef3` | clean | 2026-01-23 | old | 113 |  |  |  |  | enhance review comment and reaction services with logging and update functionality |
| `ally-be-3a4f0c1b` | clean | 2026-01-07 | old | 113 |  |  |  |  | start and end time, min and max score and occurrence changes |
| `ally-be-47fc3424` | clean | 2026-06-29 | old | 117 |  |  |  |  | disable Comfort Audio by default across all scenarios |
| `ally-be-11620af5` | clean | 2026-08-14 | old | 118 |  |  |  |  | exclude inapplicable goals from the actor composite score |
| `ally-be-61e7b60d` | clean | 2026-07-14 | old | 118 |  |  |  |  | enable gopikrishnan.sasikumar for super-duper-admin and v2 |
| `ally-be-bd8d4529` | clean | 2026-09-29 | old | 119 |  |  |  |  | audit every prompt against one structure; fence untrusted input; fix engine-blind escalat… |
| `ally-be-92f59eaf` | clean | 2026-08-19 | old | 119 |  |  |  |  | let fix sessions target ally-mobile, PR-only |
| `ally-be-d568c806` | clean | 2026-10-05 | old | 121 |  |  |  |  | attribute per-language debriefs and judge spend to sessions |
| `ally-be-d56796c2` | clean | 2026-07-31 | old | 121 |  |  |  |  | paginate and batch the bulk checklist retranslation |
| `ally-be-06cd2cd8` | clean | 2026-07-16 | old | 122 |  |  |  |  | per-skill model selection + provider routing |
| `ally-be-e6546bfe` | clean | 2026-01-23 | old | 123 |  |  |  |  | add includeMessage query param in threads api to return message in threads |
| `ally-be-8cfb2df0` | clean | 2026-08-01 | old | 124 |  |  |  |  | generate and persist a Claude Code prompt per opportunity |
| `ally-be-08bc1739` | clean | 2026-06-25 | old | 125 |  |  |  |  | one Retry recovers both failure modes (regenerate or re-transcribe) |
| `ally-be-e8694a33` | clean | 2026-09-28 | old | 126 |  |  |  |  | mark a merged fix Live when its deployable is released from GitHub |
| `ally-be-9ccbcc2d` | clean | 2026-10-01 | old | 127 |  |  |  |  | public by default; internal only for work of no value |
| `ally-be-64531dd6` | clean | 2026-03-16 | old | 128 |  |  |  |  | Add User and Org access to multi tenant admin |
| `ally-be-6cbe747e` | clean | 2026-01-27 | old | 128 |  |  |  |  | add support for counting replies |
| `ally-be-2925f4b3` | clean | 2026-03-26 | old | 129 |  |  |  |  | Added tanslation supoort for Cases |
| `ally-be-00b162fe` | clean | 2026-06-16 | old | 132 |  |  |  |  | editable Terms & Privacy legal content endpoints |
| `ally-be-5f0e21c4` | clean | 2026-02-04 | old | 132 |  |  |  |  | trigger badge awarding on role change |
| `ally-be-485352e6` | clean | 2026-09-10 | old | 134 |  |  |  |  | add the EVALUATOR consumer-app role |
| `ally-be-32f5372b` | clean | 2026-09-01 | old | 134 |  |  |  |  | auto-raise the iOS minimum version once Apple confirms it's live |
| `ally-be-f3c1df70` | clean | 2026-03-15 | old | 135 |  |  |  |  | Add Simulation access to multi tenant |
| `ally-be-54d4a578` | clean | 2026-08-21 | old | 136 |  |  |  |  | hold seed generation to the evidence standard |
| `ally-be-62092d40` | clean | 2026-05-20 | old | 136 |  |  |  |  | add translations step with title view/edit |
| `ally-be-c9cae85b` | clean | 2026-08-06 | old | 137 |  |  |  |  | remove the INTERNAL role |
| `ally-be-7c9826a7` | clean | 2026-06-26 | old | 137 |  |  |  |  | superadmin endpoint to start V2V test sessions |
| `ally-be-ce95abcb` | clean | 2026-04-03 | old | 138 |  |  |  |  | Add names for states in behaviour instructions |
| `ally-be-347a9103` | clean | 2026-05-13 | old | 140 |  |  |  |  | generate challenge description as rich HTML across all languages |
| `ally-be-1efb3d61` | clean | 2026-08-31 | old | 142 |  |  |  |  | rework the readiness checklist, gate on size, propose a rewrite |
| `ally-be-f8be1168` | clean | 2026-08-03 | old | 142 |  |  |  |  | add INTERNAL role as a permission clone of SUPER_ADMIN |
| `ally-be-40adde42` | clean | 2026-08-19 | old | 143 |  |  |  |  | plain-language intro in bug finding descriptions |
| `ally-be-daf05850` | clean | 2026-02-11 | old | 143 |  |  |  |  | add settings status in get all tenants |
| `ally-be-84be9716` | clean | 2026-06-12 | old | 144 |  |  |  |  | add transcript-derived v2v latency alongside pipeline rows |
| `ally-be-111f7f3a` | clean | 2026-01-07 | old | 144 |  |  |  |  | Add translation support for detection data |
| `ally-be-b4ee868c` | clean | 2026-01-09 | old | 145 |  |  |  |  | removeTermsAndAgreementPermission |
| `ally-be-3e1ce181` | clean | 2026-08-12 | old | 146 |  |  |  |  | resolve range=all for tenant Organization Metrics |
| `ally-be-2ee19782` | clean | 2026-01-27 | old | 146 |  |  |  |  | add batch creation functionality for badges |
| `ally-be-f11b3d6e` | clean | 2026-10-08 | old | 147 |  |  |  |  | the locale-parity sense (OPP-0782) |
| `ally-be-1b31e826` | clean | 2026-09-22 | old | 147 |  |  |  |  | wire the 4 new Goals-tab endpoints into the controller |
| `ally-be-c6a5af87` | clean | 2026-07-20 | old | 149 |  |  |  |  | filter call logs by built-in columns (date, duration, mode, tags, status, channel) |
| `ally-be-7a69937f` | clean | 2026-07-31 | old | 150 |  |  |  |  | promote the gopi.s aliases to SUPER_DUPER_ADMIN |
| `ally-be-d9f4a505` | clean | 2026-07-03 | old | 151 |  |  |  |  | make voice-note extraction prompt editable via Prompt Management |
| `ally-be-f365be5b` | clean | 2026-10-03 | old | 153 |  |  |  |  | paired small-sample stats util (bootstrap CI, sign test, BH, MDE) |
| `ally-be-d327c255` | clean | 2026-07-14 | old | 154 |  |  |  |  | archive/unarchive + rename library tracks |
| `ally-be-89b5edc2` | clean | 2026-09-17 | old | 155 |  |  |  |  | mark an opportunity released when Builder ships it |
| `ally-be-f2c9bbe1` | clean | 2026-01-27 | old | 155 |  |  |  |  | implement badge awarding for simulation minutes and active day streak based on leaderboar… |
| `ally-be-8faa0999` | clean | 2026-03-02 | old | 156 |  |  |  |  | add OpenAI general text translation prompt and service integration |
| `ally-be-476558ab` | clean | 2026-08-20 | old | 158 |  |  |  |  | renumber variety-profile migrations past bug-finding 1916 |
| `ally-be-630b6e55` | clean | 2026-06-29 | old | 159 |  |  |  |  | wire non-v3 expression flags + seed expressivity prompts |
| `ally-be-941ff2a9` | clean | 2026-01-14 | old | 161 |  |  |  |  | Add language-specific LLM and STT provider configurations |
| `ally-be-29f9dd09` | clean | 2026-08-17 | old | 162 |  |  |  |  | add visibleInStudio to hide variants from the studio pickers |
| `ally-be-26bc80a2` | clean | 2026-09-24 | old | 163 |  |  |  |  | chain copilot field generation on established context (#544) |
| `ally-be-9b189242` | clean | 2026-08-04 | old | 164 |  |  |  |  | pick an ElevenLabs voice by name instead of pasting its id |
| `ally-be-4e385ba5` | clean | 2026-10-05 | old | 165 |  |  |  |  | label the unmeasured AI calls and correct their registry rows |
| `ally-be-c027ba69` | clean | 2026-03-04 | old | 165 |  |  |  |  | add note to a review |
| `ally-be-3f2490a1` | clean | 2026-01-13 | old | 168 |  |  |  |  | add badge management entities and constants |
| `ally-be-74a5f6ac` | clean | 2026-05-26 | old | 170 |  |  |  |  | optimize session data structure and fix recording race conditions |
| `ally-be-321ad066` | clean | 2026-08-31 | old | 172 |  |  |  |  | deprecate transcript annotations end to end |
| `ally-be-c03317cd` | clean | 2026-10-04 | old | 173 |  |  |  |  | org filter for the helping-skills progress, habits and benchmark |
| `ally-be-e3392d3e` | clean | 2026-02-23 | old | 174 |  |  |  |  | Add open ai translation layer on session events |
| `ally-be-67b9cc51` | clean | 2026-03-05 | old | 176 |  |  |  |  | implement ReviewReadStatus API for notification badge and mark review as read |
| `ally-be-73c3477c` | clean | 2026-03-04 | old | 177 |  |  |  |  | add general comments API and related changes |
| `ally-be-41d49484` | clean | 2026-07-09 | old | 178 |  |  |  |  | suspected mid-session "freeze" detection |
| `ally-be-e9f9bb9a` | clean | 2026-08-31 | old | 180 |  |  |  |  | add App Store review submission endpoint |
| `ally-be-13bdbda1` | clean | 2026-05-18 | old | 180 |  |  |  |  | auto-translate new keys from English via OpenAI |
| `ally-be-ea7b231b` | clean | 2026-03-16 | old | 180 |  |  |  |  | add scenario-session-chat prompt in Prompt manager |
| `ally-be-1df7b6df` | clean | 2026-01-16 | old | 181 |  |  |  |  | add validation for scenario event and tests |
| `ally-be-340e497c` | clean | 2026-08-28 | old | 182 |  |  |  |  | add effort sizing, and make ASC sorts a true reverse |
| `ally-be-ca98f8da` | clean | 2026-07-27 | old | 182 |  |  |  |  | per-language runtime model override for the multilingual path |
| `ally-be-4aada41d` | clean | 2026-09-29 | old | 183 |  |  |  |  | a failed fix session leaves a post-mortem the next one reads (OPP-0735) |
| `ally-be-c8fae971` | clean | 2026-08-10 | old | 183 |  |  |  |  | show learners which roleplays they've already completed |
| `ally-be-4349535b` | clean | 2026-09-22 | old | 185 |  |  |  |  | Filter admin roleplay logs by person and by role play |
| `ally-be-fab5afc3` | clean | 2026-07-22 | old | 185 |  |  |  |  | add translatable reminders field to v1 scenarios |
| `ally-be-5a553a1a` | clean | 2026-05-25 | old | 185 |  |  |  |  | Add Sign in with Apple endpoint |
| `ally-be-485af35d` | clean | 2026-10-01 | old | 186 |  |  |  |  | replace categories with tags; add per-post cover colour |
| `ally-be-67de4735` | clean | 2026-08-13 | old | 186 |  |  |  |  | add voice, dialect and knowledge-source fields |
| `ally-be-7db42991` | clean | 2026-01-15 | old | 186 |  |  |  |  | implement badge assignment to tenants and event consumer base structure |
| `ally-be-5c9a3fff` | clean | 2026-03-26 | old | 187 |  |  |  |  | remap behavior state instruction state IDs and update related constants and services |
| `ally-be-f678dc03` | clean | 2026-09-25 | old | 192 |  |  |  |  | ship runtime word swaps to the live agent |
| `ally-be-aa66867c` | clean | 2026-10-01 | old | 194 |  |  |  |  | mine bookish words weekly for every non-English language |
| `ally-be-3cf15b11` | clean | 2026-09-01 | old | 196 |  |  |  |  | expose Apple's full App Store review submission history |
| `ally-be-a2a03b1d` | clean | 2026-08-06 | old | 197 |  |  |  |  | open track roleplays with the previous item's session memory |

## ally-mobile  (1 bug, 0 clean)

| id | kind | date | lines | tests | risk | lock=HEAD | PR | title |
|---|---|---|---|---|---|---|---|---|
| `ally-mobile-83bdf91e` | bug | 2026-11-06 | mono | 59 | 3 |  | yes |  | reconnect in place on Try again, and stop starting sessions muted |

## ally-web  (248 bug, 378 clean)

| id | kind | date | lines | tests | risk | lock=HEAD | PR | title |
|---|---|---|---|---|---|---|---|---|
| `ally-web-520d8159` | bug | 2026-09-03 | old | 1 | 1 |  | no |  | re-enable Scan now button when a watched scan stalls |
| `ally-web-a4cc6436` | bug | 2026-08-31 | old | 1 | 1 |  | no |  | stop RaiseBudgetDialog from submitting a ceiling removal on an empty field |
| `ally-web-bfbf5e6e` | bug | 2026-08-19 | old | 1 | 1 |  | no |  | register eslint-plugin-react-hooks in the flat config |
| `ally-web-03301ab8` | bug | 2026-10-13 | old | 2 | 1 |  | yes |  | in a course, quiz questions that are not graded still show for learner as incorrect while… |
| `ally-web-5821d625` | bug | 2026-10-12 | old | 2 | 1 |  | yes | #799 | The discussion forum within a course component shows only after scrolling to the very bot… |
| `ally-web-22daf6cd` | bug | 2026-09-21 | old | 2 | 1 |  | no | #675 | A lint error exists due to missing dependencies in a React useEffect hook. This may lead … |
| `ally-web-d468fd99` | bug | 2026-09-21 | old | 2 | 1 |  | no | #672 | Resolve useEffect missing dependency lint error in CommentThread component (#672) |
| `ally-web-22c481a9` | bug | 2026-09-21 | old | 2 | 1 |  | no | #668 | add isValidTabId to useEffect dependency array in Learn.tsx (#668) |
| `ally-web-40489304` | bug | 2026-09-04 | old | 2 | 1 |  | no |  | sort level-indicator export alphabetically in barrel |
| `ally-web-aa39e6c3` | bug | 2026-09-04 | old | 2 | 1 |  | no |  | alphabetize progress-ladder import in icons barrel |
| `ally-web-86ee2936` | bug | 2026-09-02 | old | 2 | 1 |  | no | #579 | skip getCallTags fetch on Organization Logs simulation tab (#579) |
| `ally-web-2770b8d3` | bug | 2026-09-02 | old | 2 | 1 |  | no | #577 | catch the rerun write in scribe autosave (#577) |
| `ally-web-3fe182f6` | bug | 2026-09-02 | old | 2 | 1 |  | no |  | treat an emptied weight box as invalid, not zero |
| `ally-web-50ad3d67` | bug | 2026-09-01 | old | 2 | 1 |  | no |  | correct stale "total votes" tooltip on queue rank |
| `ally-web-98b15eed` | bug | 2026-08-31 | old | 2 | 1 |  | no |  | stop the held-budget banner outliving the build it warns about |
| `ally-web-a881b21b` | bug | 2026-08-28 | old | 2 | 1 |  | no |  | handle category-only search URLs without crashing |
| `ally-web-f6fce027` | bug | 2026-08-27 | old | 2 | 1 |  | no |  | sort hooks/index.ts imports alphabetically |
| `ally-web-a33574d4` | bug | 2026-08-20 | old | 2 | 1 |  | no |  | make the missing-timer fallback 600 seconds, not 600000 |
| `ally-web-f2144916` | bug | 2026-08-19 | old | 2 | 1 |  | no | #433 | explain the gap on a not-instrumented weak-metrics card (#433) |
| `ally-web-80214735` | bug | 2026-02-03 | old | 2 | 2 |  | no |  | Adjust minimum width of ThreadCard component from 350px to 250px for improved layout |
| `ally-web-20fdd362` | bug | 2026-01-30 | old | 2 | 1 |  | no |  | Fix test case error |
| `ally-web-25a0576a` | bug | 2026-01-13 | old | 2 | 3 |  | no |  | Update watchedRules initialization to default to an empty array |
| `ally-web-e342cfb4` | bug | 2026-10-02 | old | 3 | 1 |  | yes | #749 | Unlabelled / non-interactive control on /blog receiving dead clicks (#749) |
| `ally-web-1a6e254b` | bug | 2026-09-04 | old | 3 | 1 |  | no | #605 | fix import/order in HeaderTooltip.tsx (#605) |
| `ally-web-9be84f99` | bug | 2026-05-08 | old | 3 | 1 |  | no |  | keep Load More button visible on user logs table |
| `ally-web-0a8fa392` | bug | 2026-03-09 | old | 3 | 1 |  | no |  | Update minimum time configuration in SESSION_TIMER_CONFIG and add minTime prop to FormFie… |
| `ally-web-2d664deb` | bug | 2026-09-25 | old | 4 | 1 |  | yes |  | send the auth token on getChatTypes again |
| `ally-web-77086df0` | bug | 2026-09-15 | old | 4 | 1 |  | no |  | initialize character properties to prevent crash |
| `ally-web-f77361f9` | bug | 2026-09-15 | old | 4 | 1 |  | no |  | Pass userId to getSimulationCredits |
| `ally-web-a9109346` | bug | 2026-08-26 | old | 4 | 1 |  | no |  | silence no-console lint errors in baseQueryWithReauth |
| `ally-web-107cce0a` | bug | 2026-08-19 | old | 4 | 1 |  | no |  | avoid the @hooks barrel for useTranscriptDisclaimer |
| `ally-web-0de10b61` | bug | 2026-07-07 | old | 4 | 2 |  | no |  | make empty feedback rating stars visible |
| `ally-web-55553bc5` | bug | 2026-10-14 | old | 5 | 1 |  | yes |  | show the Ally logo on the public course page header |
| `ally-web-41a8c79f` | bug | 2026-10-12 | old | 5 | 1 |  | yes | #795 | With Marathi selected as the app language (sidebar language selector, bottom left), the t… |
| `ally-web-9fb40b0b` | bug | 2026-09-24 | old | 5 | 1 |  | yes |  | show distinct error in notification bell |
| `ally-web-15d295eb` | bug | 2026-09-15 | old | 5 | 2 |  | no |  | send simulation-credits userId as a query param |
| `ally-web-596a0eef` | bug | 2026-08-29 | old | 5 | 1 |  | no |  | clear stale product-goal chip when dropped on No goal lane |
| `ally-web-8ba4bd33` | bug | 2026-08-28 | old | 5 | 1 |  | no |  | keep New session inside the roadmap drawer |
| `ally-web-bdbae153` | bug | 2026-08-27 | old | 5 | 1 |  | no |  | stop failed PRD section saves from throwing an unhandled rejection |
| `ally-web-d9a00204` | bug | 2026-08-24 | old | 5 | 1 |  | no |  | don't advertise a minimum score of 0 on a track item |
| `ally-web-eeaf1395` | bug | 2026-07-10 | old | 5 | 1 |  | no |  | close short-session roleplay drawer instead of stalling on feedback guard |
| `ally-web-d5eab977` | bug | 2026-07-09 | old | 5 | 2 |  | no |  | make empty rating stars visible in SessionRatingTrigger |
| `ally-web-d5cb407f` | bug | 2026-03-19 | old | 5 | 2 |  | no |  | Simulation edit restriction for multi tenant id |
| `ally-web-fc52f057` | bug | 2026-02-12 | old | 5 | 1 |  | no |  | Update session ID parameter naming in CaseTrackDetails and add optional caseSessionItemId… |
| `ally-web-5b7ef79d` | bug | 2026-02-10 | old | 5 | 1 |  | no |  | Refactor voice configuration handling in LanguageVoiceMapping to remove languageCode from… |
| `ally-web-74af65bf` | bug | 2026-10-23 | old | 6 | 1 |  | yes |  | course interview agent stopped with this error message: The interview stream failed — ple… |
| `ally-web-73c7cf23` | bug | 2026-09-30 | old | 6 | 1 |  | yes | #727 | Unlabelled/unresponsive control on /auth/verify receiving dead clicks (#727) |
| `ally-web-3060732d` | bug | 2026-09-15 | old | 6 | 1 |  | no |  | prevent dead clicks on load more button |
| `ally-web-3b8c0012` | bug | 2026-09-15 | old | 6 | 1 |  | no | #634 | Unlabelled, unresponsive control on /review receives dead clicks and may block reviews (#… |
| `ally-web-70f65460` | bug | 2026-08-28 | old | 6 | 1 |  | no |  | guard org-metrics reorder patch against a pending preferences fetch |
| `ally-web-ba3fb6d6` | bug | 2026-08-27 | old | 6 | 1 |  | no |  | show Stopped note when a reply is interrupted with no text |
| `ally-web-8343ea38` | bug | 2026-08-27 | old | 6 | 1 |  | no |  | stop the search box from treating "all" as a clear sentinel |
| `ally-web-29881a1c` | bug | 2026-04-28 | old | 6 | 1 |  | no |  | resolve OOM crash and missing mock exports in helpline-dashboard |
| `ally-web-411015df` | bug | 2026-10-22 | old | 7 | 1 |  | yes |  | stop the voice shortlist strip duplicating the live voice question |
| `ally-web-2ca11b3f` | bug | 2026-09-24 | old | 7 | 1 |  | yes |  | pass languageCode to getLearnTracks query |
| `ally-web-460e1437` | bug | 2026-09-18 | old | 7 | 1 |  | no | #664 | Display correct simulation count on course card (#664) |
| `ally-web-4f8ef60d` | bug | 2026-09-14 | old | 7 | 1 |  | no | #631 | ensure tooltip button in TurnConditionsSection has accessible label (#631) |
| `ally-web-6d27495d` | bug | 2026-09-04 | old | 7 | 1 |  | no |  | suppress points/min below 10 practice minutes |
| `ally-web-61f76b89` | bug | 2026-09-02 | old | 7 | 1 |  | no | #580 | stop AppTooltip force-refetching getActiveTooltips on every mount (#580) |
| `ally-web-da731846` | bug | 2026-07-07 | old | 7 | 2 |  | no |  | make empty feedback rating stars clearly visible |
| `ally-web-b352de75` | bug | 2026-02-11 | old | 7 | 1 |  | no |  | enforce language↔voice mapping as mandatory |
| `ally-web-9299e9aa` | bug | 2026-11-06 | mono | 8 | 1 |  | yes | #217 | Preview sends only the last 10 messages |
| `ally-web-d62320ac` | bug | 2026-10-23 | mono | 8 | 1 |  | yes | #50 | hide intent-only learner turns; don't repeat the type word in card meta |
| `ally-web-6e9b9a6c` | bug | 2026-10-21 | old | 8 | 1 |  | yes |  | align the Report a problem icon with the other nav icons |
| `ally-web-2548ba8b` | bug | 2026-10-07 | old | 8 | 1 |  | yes | #783 | As a learner, the title and description configured for a component within a course is not… |
| `ally-web-aaf2df1d` | bug | 2026-08-31 | old | 8 | 1 |  | no |  | delete the orphaned custom competency when a race is lost |
| `ally-web-58417e8a` | bug | 2026-08-19 | old | 8 | 1 |  | no |  | match the Guardrails nav icon to the rest of the rail |
| `ally-web-d7df9870` | bug | 2026-07-07 | old | 8 | 1 |  | no |  | keep add-filter popovers open in real browsers |
| `ally-web-ad4651f7` | bug | 2026-03-10 | old | 8 | 1 |  | no |  | Update minimum widths for table columns in SimulationCreator and adjust layout width in C… |
| `ally-web-43ed632d` | bug | 2026-10-14 | old | 9 | 1 |  | yes |  | open a session on its latest build, not a finished review |
| `ally-web-b1d2ce6f` | bug | 2026-09-28 | old | 9 | 1 |  | yes |  | say how a fix went live when the release was not cut from the tab |
| `ally-web-5634f549` | bug | 2026-08-28 | old | 9 | 1 |  | no |  | clamp month-card priority bar to 100% |
| `ally-web-37cc4074` | bug | 2026-08-19 | old | 9 | 1 |  | no |  | keep the cover once it loads after an empty first paint |
| `ally-web-560b77d6` | bug | 2026-02-04 | old | 9 | 1 |  | no |  | Update feature flag |
| `ally-web-8b4be340` | bug | 2026-02-02 | old | 9 | 1 |  | no |  | Update comment thread selection logic and randomize thread ID assignment in SelectableTex… |
| `ally-web-e5ad37b3` | bug | 2026-01-13 | old | 9 | 1 | **yes** | no |  | Update AutoTerminationRuleField to display no rules by default and adjust tests for empty… |
| `ally-web-f3e902b9` | bug | 2026-10-31 | mono | 10 | 1 |  | yes | #167 | shorten AAQ-252 target legend, one x-axis title |
| `ally-web-19a5f5f7` | bug | 2026-10-22 | old | 10 | 4 |  | yes | #875 | A function is being used as a React child, which is not valid, and an unrecognized `butto… |
| `ally-web-bb542d89` | bug | 2026-10-20 | old | 10 | 1 |  | yes |  | cover generator copy and error handling from live testing |
| `ally-web-f6b3e323` | bug | 2026-08-31 | old | 10 | 1 |  | no |  | send the product goal to the roadmap readiness grader |
| `ally-web-c209ab9f` | bug | 2026-08-24 | old | 10 | 1 |  | no |  | translate Score/Best/Start over/Game over text |
| `ally-web-4cc6ff7e` | bug | 2026-08-24 | old | 10 | 1 |  | no |  | warn when the simulation latency ranking is truncated |
| `ally-web-844318a4` | bug | 2026-08-21 | old | 10 | 2 |  | no |  | stop the bottom CTA bar from covering tab content |
| `ally-web-90393ee7` | bug | 2026-03-05 | old | 10 | 2 |  | no |  | Update CommentCard user ID comparison and change Comment createdBy ID type to number |
| `ally-web-3dc86800` | bug | 2026-02-18 | old | 10 | 1 |  | no |  | Simplify FeedbackSection rendering logic and ensure default score value in getFormattedFe… |
| `ally-web-f537a0e1` | bug | 2026-02-04 | old | 10 | 1 |  | no |  | Add forceRefetch option to reviews API and enhance CommentCard to support reply indication |
| `ally-web-2c22acde` | bug | 2026-10-21 | old | 11 | 1 |  | yes |  | stop opening a video item from marking the course as unsaved |
| `ally-web-58760833` | bug | 2026-03-18 | old | 11 | 1 |  | no |  | Add toast for showing error in session in review deletion |
| `ally-web-04e7842d` | bug | 2026-10-13 | old | 12 | 1 |  | yes | #804 | The "Force fix session" checkbox state persists between different bug findings in the Bug… |
| `ally-web-b6f077c6` | bug | 2026-10-13 | old | 12 | 1 |  | yes | #803 | When viewing paginated archived sessions in the Builder, applying a status filter or sear… |
| `ally-web-7792eed1` | bug | 2026-08-19 | old | 12 | 1 |  | no |  | show CLI-reported cost, not just the cache-blind estimate |
| `ally-web-55812e5c` | bug | 2026-06-17 | old | 12 | 1 | **yes** | no |  | persist sidebar order across refresh |
| `ally-web-4dbefb67` | bug | 2026-10-14 | old | 13 | 1 |  | yes |  | the budget banner stops pulling focus to "Raise budget" |
| `ally-web-fb6c8d91` | bug | 2026-09-25 | old | 13 | 1 |  | yes |  | stop the header reading "Building" after the build is done |
| `ally-web-69ecb6a4` | bug | 2026-08-27 | old | 13 | 1 |  | no |  | key socket dedup by run, not seq alone |
| `ally-web-2eef564f` | bug | 2026-08-06 | old | 13 | 1 |  | no |  | edit form reflects the default-ON glossary/multilingual reads |
| `ally-web-0d6f35ab` | bug | 2026-09-30 | old | 14 | 1 |  | yes |  | always show the year on the heatmap's month labels |
| `ally-web-8b5a1fe3` | bug | 2026-09-25 | old | 14 | 1 |  | yes |  | refetch the active chat when permissions arrive late |
| `ally-web-0942169a` | bug | 2026-09-22 | old | 14 | 1 |  | yes | #687 | Prevent timer interval reset on re-render (#687) |
| `ally-web-89221284` | bug | 2026-09-15 | old | 14 | 1 |  | no |  | renumber article question chips when an earlier one is deleted |
| `ally-web-079df555` | bug | 2026-09-15 | old | 14 | 1 |  | no |  | combine back button and arrow into a single clickable element |
| `ally-web-f97d01a3` | bug | 2026-09-02 | old | 14 | 1 | **yes** | no | #581 | make the login OTP back control accessible and keyboard-operable (#581) |
| `ally-web-b9ca5218` | bug | 2026-09-02 | old | 14 | 1 |  | no | #576 | guard unmount autosave against overlapping writes (#576) |
| `ally-web-01bbee63` | bug | 2026-08-12 | old | 14 | 1 |  | no |  | give Logs, WhatsApp Bot and Roleplay Studio sidebar icons |
| `ally-web-e588205f` | bug | 2026-08-06 | old | 14 | 1 |  | no |  | hoist MULTI_TENANT_ADMIN in resolveAdminRole so multi-role users aren't locked out of the… |
| `ally-web-8a14fdc5` | bug | 2026-07-31 | old | 14 | 1 |  | no |  | open Roleplay Session Logs to both super-admin tiers |
| `ally-web-886d72ef` | bug | 2026-07-14 | old | 14 | 1 |  | no |  | gate Roleplay Logs to SUPER_DUPER_ADMIN only |
| `ally-web-2cdd0629` | bug | 2026-05-25 | old | 14 | 1 |  | no |  | suppress post-call feedback popup when feedback already exists |
| `ally-web-103bcde6` | bug | 2026-10-13 | old | 15 | 1 |  | yes |  | Bug Hunter opens a bug from a fix PR's ?finding= link |
| `ally-web-3e1e614c` | bug | 2026-10-12 | old | 15 | 1 |  | yes | #801 | When I did a course where the last component was a quiz with discussion enabled, as soon … |
| `ally-web-e2671fa2` | bug | 2026-09-25 | old | 15 | 1 |  | yes |  | keep a lone in-progress XP by Tenant period on the plot |
| `ally-web-59a8733c` | bug | 2026-09-01 | old | 15 | 1 |  | no |  | retry autosave writes automatically after a failure |
| `ally-web-19657572` | bug | 2026-08-12 | old | 15 | 1 |  | no |  | hide video download control and watch-gate label on track player |
| `ally-web-97d60cbd` | bug | 2026-07-31 | old | 15 | 1 |  | no |  | give Voices, Speech Recognition and Language Model distinct icons |
| `ally-web-9b98a77f` | bug | 2026-01-23 | old | 15 | 1 |  | no |  | Update badge API endpoint and refactor badge data structure in AchievementsViewAll compon… |
| `ally-web-dffec161` | bug | 2026-09-08 | old | 16 | 1 |  | no |  | clear fields with null, so removing a face actually saves |
| `ally-web-137a49f9` | bug | 2026-08-04 | old | 16 | 1 |  | no |  | shorten the not-recommended model label |
| `ally-web-ee19faa3` | bug | 2026-03-02 | old | 16 | 2 |  | no |  | UX review changes |
| `ally-web-3dc62f88` | bug | 2026-10-21 | old | 17 | 1 |  | yes |  | stop legacy plain-text prompts from dirtying the course form on open |
| `ally-web-1dba7df3` | bug | 2026-10-12 | old | 17 | 1 |  | yes |  | save ARTICLE resources (they were silently dropped) |
| `ally-web-e4c150fe` | bug | 2026-10-05 | old | 17 | 1 |  | yes |  | guard a rejoined scribe recording against page unload |
| `ally-web-51100f92` | bug | 2026-09-17 | old | 17 | 1 |  | no | #662 | stop a double Enter creating two scenario versions (#662) |
| `ally-web-34b571ff` | bug | 2026-09-02 | old | 17 | 1 |  | no |  | stop reference-image upload from reverting a concurrent edit |
| `ally-web-df6c6b70` | bug | 2026-10-15 | old | 18 | 1 |  | yes |  | a chain's primary merge is only ever its first unmerged PR |
| `ally-web-2e5db115` | bug | 2026-10-02 | old | 18 | 1 |  | yes |  | translate the 385 strings per language that shipped blank, and make a blank never show ag… |
| `ally-web-9f91336d` | bug | 2026-09-22 | old | 18 | 1 |  | yes | #678 | remove limit from bugs tab (#678) |
| `ally-web-9ec1f65d` | bug | 2026-08-07 | old | 18 | 1 |  | no |  | stop resetting the learner's language pick to English |
| `ally-web-041d431a` | bug | 2026-08-05 | old | 18 | 1 |  | no |  | stop autosave 400 loop for Tracks/Case-member simulations |
| `ally-web-3a3a5c38` | bug | 2026-01-28 | old | 18 | 1 |  | no |  | fix comment card rendering issue |
| `ally-web-4fe8907e` | bug | 2026-10-16 | old | 19 | 1 |  | yes |  | keep a voice-note recording when the drawer is dismissed |
| `ally-web-a57e3198` | bug | 2026-10-05 | old | 19 | 1 |  | yes | #766 | The real-time simulation feature may behave unexpectedly due to a technical issue in its … |
| `ally-web-1378d2f5` | bug | 2026-09-22 | old | 19 | 1 |  | yes | #686 | keep the event row the admin just added (#686) |
| `ally-web-cb416290` | bug | 2026-09-05 | old | 19 | 1 |  | no |  | stop an unset table cell from crashing the page |
| `ally-web-7b31eab8` | bug | 2026-09-02 | old | 19 | 1 |  | no |  | fix prettier formatting in NotionTable row-click JSX |
| `ally-web-04960b49` | bug | 2026-09-02 | old | 19 | 1 |  | no |  | make disabled Age cell clickable for row navigation |
| `ally-web-593f80ae` | bug | 2026-09-25 | old | 20 | 1 |  | yes |  | adopt the app language for enrollments saved without one |
| `ally-web-b9b5ab6b` | bug | 2026-08-17 | old | 20 | 2 |  | no |  | stop the prompt panel minting a version on metadata-only saves |
| `ally-web-92f1d33a` | bug | 2026-01-28 | old | 20 | 1 |  | no |  | Update CommentCard styling and logic for user profile images and reply count display |
| `ally-web-f5da1efd` | bug | 2026-10-14 | old | 21 | 1 |  | yes |  | clean answered labels and item-aware Apply in Course Copilot chat |
| `ally-web-1fe30a85` | bug | 2026-10-12 | old | 21 | 1 |  | yes |  | the PRD stays editable after a failed or stopped build |
| `ally-web-32c68dc5` | bug | 2026-09-02 | old | 21 | 2 |  | no | #578 | resync selected post-session tab when tabList shrinks after data loads (#578) |
| `ally-web-d6a0e9d6` | bug | 2026-09-02 | old | 21 | 1 |  | no |  | store the calendar day the user actually clicked |
| `ally-web-dd128ff8` | bug | 2026-11-02 | mono | 22 | 1 |  | yes | #170 | When editing a simulation, if a memory is set to unlock in a specific state, and that sta… |
| `ally-web-4e976229` | bug | 2026-09-16 | old | 22 | 1 |  | no |  | let a session over its ceiling be raised |
| `ally-web-ff24660f` | bug | 2026-08-31 | old | 22 | 2 |  | no |  | lift a section marker the model wrote inline |
| `ally-web-7954cbfa` | bug | 2026-07-15 | old | 22 | 2 |  | no |  | unbreak admin & helpline dashboard suites after recent features |
| `ally-web-a67d0470` | bug | 2026-04-15 | old | 22 | 1 |  | no |  | move challenge description to overview step |
| `ally-web-b461fbb7` | bug | 2026-02-11 | old | 22 | 1 |  | no |  | Add summary-fields api in call summary side bar |
| `ally-web-91ba579e` | bug | 2026-01-27 | old | 22 | 2 | **yes** | no |  | Update allowed roles in auth API and enhance CommentCard component with useEffect for emo… |
| `ally-web-f35e117d` | bug | 2026-10-24 | mono | 23 | 2 |  | yes | #50 | a withheld Ally chart says so instead of "no activity" |
| `ally-web-b300d69b` | bug | 2026-10-27 | mono | 24 | 1 |  | yes | #105 | Tried creating a new character using the character interview bot and when it shows the li… |
| `ally-web-156f5337` | bug | 2026-10-13 | old | 24 | 1 |  | yes | #808 | in a course, even when a journal prompt is marked not mandatory, the learner has to click… |
| `ally-web-a79b02ce` | bug | 2026-09-17 | old | 24 | 1 |  | no |  | offer a restart on a completed session that shipped nothing |
| `ally-web-9b54276e` | bug | 2026-09-17 | old | 24 | 1 |  | no |  | stopping a build no longer strands the session |
| `ally-web-6fede87c` | bug | 2026-08-04 | old | 24 | 1 |  | no |  | put Google's Model name ahead of the Voice name it scopes |
| `ally-web-a8d67082` | bug | 2026-07-15 | old | 24 | 1 |  | no |  | Keep deleted summary-field comments from reappearing |
| `ally-web-9962e842` | bug | 2026-01-30 | old | 24 | 1 |  | no |  | Update emoji style from Apple to Google across multiple components and improve reply hand… |
| `ally-web-5a36e826` | bug | 2026-07-31 | old | 25 | 1 |  | no |  | stop the rich text editor wiping fields it was only shown |
| `ally-web-6a9af0e3` | bug | 2026-01-23 | old | 25 | 4 |  | no |  | Change like button to emoji icon in comment-card |
| `ally-web-a19d9a35` | bug | 2026-10-08 | old | 26 | 1 |  | yes |  | give scribe dropdown lists a readable width on screen |
| `ally-web-01fa9fc8` | bug | 2026-09-22 | old | 26 | 1 |  | yes | #688 | Prevent infinite loop on thread open (#688) |
| `ally-web-d1a8b721` | bug | 2026-08-21 | old | 26 | 1 |  | no |  | re-trigger scroll/highlight on repeat chip tap |
| `ally-web-3222addf` | bug | 2026-03-11 | old | 26 | 1 |  | no |  | Correctly select and display prompts by filtering out obsolete entries from the table dat… |
| `ally-web-5193be39` | bug | 2026-03-02 | old | 26 | 1 |  | no |  | Fix Report upload  modal not shown on logging in |
| `ally-web-617eb4a7` | bug | 2026-10-14 | old | 27 | 1 |  | yes |  | opening copilot turn survives the dev double-mount; settings label |
| `ally-web-c5309e7a` | bug | 2026-08-20 | old | 27 | 1 | **yes** | no |  | keep thin buckets off the weak-metrics plots |
| `ally-web-fcf85850` | bug | 2026-08-17 | old | 27 | 1 |  | no |  | show the role grant date in the Ally admins "Added on" column |
| `ally-web-5244f1eb` | bug | 2026-07-07 | old | 27 | 1 |  | no |  | allow text-only filterable columns in add-filter picker |
| `ally-web-4e190700` | bug | 2026-09-02 | old | 28 | 2 |  | no | #585 | stop premature getCallLogs/getCallTags 401s and empty-name updateCallInfo 400s (#585) |
| `ally-web-09872540` | bug | 2026-08-19 | old | 28 | 1 |  | no |  | distinguish a measured zero from an unmeasured metric |
| `ally-web-50fed916` | bug | 2026-07-01 | old | 28 | 3 |  | no |  | drop broken dark UI themes (Midnight, Ocean) |
| `ally-web-be345fe2` | bug | 2026-09-09 | old | 29 | 1 |  | no | #623 | getActiveTooltips error loop worse than filed: worst session hit endpoint 66 times in 5 m… |
| `ally-web-9205e21d` | bug | 2026-07-09 | old | 29 | 2 |  | no |  | make feedback rating stars visible |
| `ally-web-eebbfd01` | bug | 2026-10-23 | mono | 30 | 1 |  | yes | #27 | pageview tracker uses the app's own router — app crashed on load |
| `ally-web-26c93592` | bug | 2026-09-01 | old | 30 | 1 |  | no |  | show invalid state on out-of-range ranking weights |
| `ally-web-ba7bc7b4` | bug | 2026-07-09 | old | 30 | 1 |  | no |  | render summary form for audio-less notes; surface save failures |
| `ally-web-5cecce31` | bug | 2026-03-19 | old | 30 | 1 |  | no |  | Add skip condition for transcript fetching in CallTranscriptTab and PostCallSummary compo… |
| `ally-web-71e4ae4d` | bug | 2026-02-12 | old | 30 | 1 |  | no |  | make experienceMode optional and removed default values |
| `ally-web-b6297303` | bug | 2026-09-24 | old | 31 | 1 |  | yes |  | Clear knowledge locks on unnamed states |
| `ally-web-347c362c` | bug | 2026-08-19 | old | 31 | 1 |  | no |  | bug entries can't be assigned coins |
| `ally-web-998c88ce` | bug | 2026-08-03 | old | 31 | 1 |  | no |  | clear the old provider's config on a provider switch |
| `ally-web-14eeeba8` | bug | 2026-09-10 | old | 32 | 3 |  | no |  | stop a failed refetch from wiping logs and summaries |
| `ally-web-4ca20aff` | bug | 2026-10-14 | old | 33 | 1 |  | yes |  | stop the start dialog's design block crashing the session page |
| `ally-web-8978543e` | bug | 2026-10-12 | old | 33 | 2 |  | yes |  | say what an empty-looking run feed means, and Starting for an accepted run |
| `ally-web-c1520937` | bug | 2026-08-24 | old | 33 | 1 |  | no |  | re-focus session panel on a repeat "View sessions" click |
| `ally-web-6e0454b8` | bug | 2026-08-18 | old | 33 | 1 | **yes** | no |  | name every judge family's version on the weak metrics tab |
| `ally-web-26b2811f` | bug | 2026-08-04 | old | 33 | 2 |  | no |  | stop flagging v3 as unrecommended for voices it suits fine |
| `ally-web-d742d7d9` | bug | 2026-09-16 | old | 34 | 1 |  | no |  | the budget banner's Raise button crashed the panel |
| `ally-web-0d55b4a5` | bug | 2026-01-30 | old | 34 | 1 |  | no |  | Add reply functionality to CommentCard and integrate success toast notification in Transc… |
| `ally-web-5161c798` | bug | 2026-09-25 | old | 35 | 1 |  | yes |  | keep quiet periods on the session-cost axis; never print seconds as 0 minutes |
| `ally-web-6c1d6932` | bug | 2026-07-22 | old | 35 | 1 |  | no |  | remove "Generate glossaries (all)" from the Languages page |
| `ally-web-80cd0be2` | bug | 2026-03-06 | old | 35 | 2 |  | no |  | Handle potential null values in reactions and user data in FeedCard component; update tab… |
| `ally-web-6eb9486e` | bug | 2026-09-22 | old | 36 | 2 |  | yes |  | Distinguish same-named people in the roleplay log filter |
| `ally-web-d45dc070` | bug | 2026-03-17 | old | 36 | 3 |  | no |  | Multi tenant admin role |
| `ally-web-3b3db9b5` | bug | 2026-10-24 | mono | 37 | 2 |  | yes | #50 | thumbs given earlier come back on reload |
| `ally-web-05349e52` | bug | 2026-10-07 | old | 37 | 1 |  | yes |  | show the component title and description in the player header |
| `ally-web-a48685cc` | bug | 2026-09-02 | old | 37 | 1 |  | no |  | deflake the model-filter analytics test |
| `ally-web-32ba6e6d` | bug | 2026-08-31 | old | 37 | 1 |  | no |  | open short ranges on weeks, so the default view is a trend |
| `ally-web-1d5eb229` | bug | 2026-08-28 | old | 37 | 1 |  | no |  | default merge primary to highest-scoring pick |
| `ally-web-61cb5f2c` | bug | 2026-03-09 | old | 37 | 1 |  | no |  | Improve comment handling by preventing actions on hidden comments and refactoring comment… |
| `ally-web-ac422d78` | bug | 2026-08-17 | old | 38 | 1 | **yes** | no |  | admit PLATFORM_ADMIN at login |
| `ally-web-643769bf` | bug | 2026-11-03 | mono | 39 | 1 |  | yes | #189 | save favicon immediately on upload |
| `ally-web-5a46335b` | bug | 2026-10-31 | mono | 39 | 1 |  | yes |  | V2V picker searches every simulation, newest first |
| `ally-web-3c17519d` | bug | 2026-08-03 | old | 39 | 1 |  | no |  | surface Enhance failures instead of failing silently |
| `ally-web-beedc38c` | bug | 2026-10-28 | mono | 40 | 1 |  | yes | #113 | when building a roleplay using the agent builder copilot, it generates challenge descript… |
| `ally-web-0be04c89` | bug | 2026-08-27 | old | 40 | 1 |  | no |  | keep filters when leaving a sweep scope |
| `ally-web-a3d0011a` | bug | 2026-09-08 | old | 41 | 1 |  | no |  | keep covers manual for a face with no picture |
| `ally-web-58354836` | bug | 2026-09-02 | old | 42 | 1 |  | no |  | gate Android pipeline panel on runs query state, not just versions |
| `ally-web-5543251b` | bug | 2026-01-28 | old | 42 | 1 |  | no |  | Add icon for hide,duration changes in feed-card and profile image refetch |
| `ally-web-aed39746` | bug | 2026-03-11 | old | 43 | 1 |  | no |  | Add comments count management to ReviewCommentsSidepanel and GeneralCommentsToShow compon… |
| `ally-web-9633c693` | bug | 2026-01-12 | old | 43 | 1 |  | no |  | Add tooltip and logo initial |
| `ally-web-ee9e240a` | bug | 2026-09-20 | old | 44 | 1 |  | no |  | validate translation placeholders against English, not the cell's past |
| `ally-web-dab31315` | bug | 2026-08-28 | old | 44 | 1 |  | no |  | stop the competency picker from overwriting the author's pick |
| `ally-web-2f410b74` | bug | 2026-08-26 | old | 44 | 1 |  | no |  | load the live-mirroring version from the live scenario |
| `ally-web-c995c6c8` | bug | 2026-02-04 | old | 44 | 1 |  | no |  | Improve comment handling by adding onCommentChange prop and updating reactions logic in C… |
| `ally-web-25067322` | bug | 2026-08-21 | old | 45 | 1 |  | no |  | expand the org share chart's own modal, not the count chart's |
| `ally-web-88be53dd` | bug | 2026-10-06 | old | 46 | 1 |  | yes |  | never re-point an unset roleplay at the first prompt variant |
| `ally-web-90016ba1` | bug | 2026-09-30 | old | 47 | 1 |  | yes |  | save the voice the admin chose in the character interview |
| `ally-web-56289fef` | bug | 2026-09-02 | old | 47 | 1 |  | no | #584 | wire completed segments in the progress rail to jump navigation (#584) |
| `ally-web-783f70a6` | bug | 2026-08-28 | old | 47 | 1 |  | no |  | hide roadmap manage controls from admins without the toggle |
| `ally-web-076eee66` | bug | 2026-06-04 | old | 47 | 1 |  | no |  | lift hideWhenUnused gate to the form parent so layout doesn't leave ghost gaps |
| `ally-web-670ab348` | bug | 2026-02-02 | old | 47 | 1 | **yes** | no |  | Fix google sign in error, fix leaderboard navigation icon |
| `ally-web-e59d301d` | bug | 2026-01-29 | old | 47 | 1 |  | no |  | Comment callout position changing on scroll |
| `ally-web-03487d02` | bug | 2026-09-15 | old | 48 | 1 |  | no |  | guard the second knowledgeSources crash site too |
| `ally-web-7517a921` | bug | 2026-08-18 | old | 48 | 1 |  | no |  | derive video watch % from player duration for embeds |
| `ally-web-4a5c446e` | bug | 2026-01-27 | old | 48 | 3 |  | no |  | Emoji selector changes in comment-card and credit-limit fix |
| `ally-web-b9900c63` | bug | 2026-10-14 | old | 49 | 1 |  | yes |  | Course Copilot unmarks a refused answer's card reliably |
| `ally-web-bea8d259` | bug | 2026-08-27 | old | 49 | 1 |  | no |  | keep a failed dictation, and register the voice-note tag |
| `ally-web-689f82eb` | bug | 2026-10-13 | old | 50 | 1 |  | yes |  | auto-fallback to a new tab when an embedded resource stalls |
| `ally-web-6bdfd0af` | bug | 2026-08-27 | old | 50 | 3 |  | no |  | keep a failed agent turn on screen after a reload |
| `ally-web-fda74d52` | bug | 2026-07-23 | old | 50 | 1 |  | no |  | extend form-helper focus-steal opt-outs beyond TextField |
| `ally-web-167abcce` | bug | 2026-06-09 | old | 50 | 1 |  | no |  | only fetch custom-fields-enabled setting for Counselor role |
| `ally-web-0768c17b` | bug | 2026-10-30 | mono | 52 | 1 |  | yes |  | new simulations keep their role instruction; custom fields always editable |
| `ally-web-9c099f76` | bug | 2026-10-21 | old | 52 | 1 |  | yes |  | show when debrief feedback fails to save, with a retry |
| `ally-web-6de47acc` | bug | 2026-09-21 | old | 52 | 1 |  | no |  | draw an answer once, on the card it answers |
| `ally-web-7e8721ad` | bug | 2026-08-19 | old | 54 | 1 | **yes** | no |  | say which direction is good, and stop the caveats crowding the numbers |
| `ally-web-34c8ce00` | bug | 2026-03-10 | old | 54 | 2 |  | no |  | Integrate Timer component into CommentCard and CommentItem for displaying relative time, … |
| `ally-web-da3391c5` | bug | 2026-09-17 | old | 55 | 1 |  | no | #661 | stop the preview disconnecting itself mid-connect (#661) |
| `ally-web-7e330095` | bug | 2026-08-28 | old | 55 | 1 |  | no |  | capture simulation_completed on in-app navigation away |
| `ally-web-d79d4e14` | bug | 2026-04-29 | old | 55 | 2 |  | no |  | allow admin and counsellor to edit custom fields per editPermission |
| `ally-web-79ba6c54` | bug | 2026-10-14 | old | 56 | 2 |  | yes |  | open article resources externally when the server finds any error |
| `ally-web-b25740be` | bug | 2026-09-02 | old | 56 | 1 |  | no |  | don't treat loading App Store review history as "never submitted" |
| `ally-web-a0424f9d` | bug | 2026-11-06 | mono | 57 | 1 |  | yes | #219 | emptying Max attempts no longer flips a quiz to Unlimited |
| `ally-web-306cab6a` | bug | 2026-09-08 | old | 57 | 1 |  | no |  | clear the cover video when a face is selected |
| `ally-web-18f05808` | bug | 2026-09-02 | old | 58 | 1 |  | no | #582 | render read-only Multiline summary fields as plain text, not a live textbox (#582) |
| `ally-web-ab28fbca` | bug | 2026-10-14 | old | 59 | 3 |  | yes |  | resumed agent chats show the admin's answer, not the ids for the model |
| `ally-web-12207055` | bug | 2026-08-19 | old | 59 | 1 |  | no |  | drop the standing mix-warning banner |
| `ally-web-f05426cb` | bug | 2026-09-16 | old | 60 | 1 |  | no |  | stop losing the reason a build wouldn't start |
| `ally-web-192d5fd0` | clean | 2026-10-01 | old | 5 |  |  |  |  | drop the changelog's on-page tagline |
| `ally-web-4863d6bf` | clean | 2026-09-19 | old | 5 |  |  |  |  | W2/W3 — retint Carbon to Claude instead of removing it |
| `ally-web-9b7d8a22` | clean | 2026-05-18 | old | 5 |  |  |  |  | clarify agent join wait time in loading copy |
| `ally-web-568b03be` | clean | 2026-04-15 | old | 5 |  |  |  |  | make impersonation app URL environment-configurable |
| `ally-web-b208b190` | clean | 2026-03-11 | old | 5 |  |  |  |  | Rename navigation options UI text on Super Admin |
| `ally-web-21dbd9bd` | clean | 2026-03-09 | old | 5 |  |  |  |  | Add isFeedOwner prop to ReviewCommentsSidepanel and GeneralCommentsToShow components for … |
| `ally-web-91598a87` | clean | 2026-10-08 | old | 6 |  |  |  |  | the locale-parity sense, a script and not a model (OPP-0782) |
| `ally-web-297c9759` | clean | 2026-10-05 | old | 6 |  |  |  |  | bugs found per day caption says dismissed and rejected findings are left out (AAQ-201) |
| `ally-web-6d7e6b1b` | clean | 2026-09-25 | old | 7 |  |  |  |  | render "Where the change belongs" in the PRD |
| `ally-web-863284e2` | clean | 2026-05-18 | old | 7 |  |  |  |  | translate Load More button |
| `ally-web-fed97380` | clean | 2026-05-07 | old | 7 |  |  |  |  | add NONE experience mode to skip feedback and checklist UI |
| `ally-web-79a81aaa` | clean | 2026-02-19 | old | 7 |  |  |  |  | Update API endpoints to include tags in transcript queries for enhanced data retrieval |
| `ally-web-8b54189e` | clean | 2026-02-05 | old | 7 |  |  |  |  | Add onAddComment prop to SelectableText and Transcription components for improved comment… |
| `ally-web-94a9bb76` | clean | 2026-01-19 | old | 7 |  |  |  |  | add eventCode property to CombinationExpressionNode and update getEventNameFromNode funct… |
| `ally-web-38c3d0b5` | clean | 2026-08-31 | old | 8 |  |  |  |  | remove Avg score column from the learner usage table |
| `ally-web-2275ca39` | clean | 2026-08-26 | old | 8 |  |  |  |  | carry the readiness rubric's agent-facing detail in the type |
| `ally-web-8c67682d` | clean | 2026-05-01 | old | 8 |  |  |  |  | gate dynamic i18n manifest fetch behind LANGUAGE_SELECTOR_FLAG |
| `ally-web-a9b87930` | clean | 2026-04-10 | old | 8 |  |  |  |  | Add translations for review |
| `ally-web-d664d761` | clean | 2026-03-04 | old | 8 |  |  |  |  | Add time formatting function to TranscriptSection for improved display of start times |
| `ally-web-ce49ce8b` | clean | 2026-02-10 | old | 8 |  |  |  |  | Introduce API endpoint constants for voice preview and update previewVoiceAPI to use them |
| `ally-web-312e5e97` | clean | 2026-01-20 | old | 8 |  |  |  |  | Add session timer on admin preview scenario |
| `ally-web-45dae972` | clean | 2026-01-02 | old | 8 |  |  |  |  | Update GoogleOAuthProvider to use environment variable for client ID in admin and helplin… |
| `ally-web-beefd724` | clean | 2026-09-30 | old | 9 |  |  |  |  | remove back-to-blog link from Changelog page |
| `ally-web-b050053c` | clean | 2026-06-17 | old | 9 |  |  |  |  | generate session feedback in the user's selected language |
| `ally-web-027686be` | clean | 2026-04-07 | old | 9 |  |  |  |  | add language translation support to scenario session endpoints |
| `ally-web-a3c7d44b` | clean | 2026-03-24 | old | 9 |  |  |  |  | Add max active users limit popup |
| `ally-web-c6e098b1` | clean | 2026-03-02 | old | 9 |  |  |  |  | Revert markdown changes |
| `ally-web-80f81a59` | clean | 2026-01-13 | old | 9 |  |  |  |  | Add REVIEWER role to UserRole enum and update user role filtering logic |
| `ally-web-8030ee44` | clean | 2026-01-06 | old | 9 |  |  |  |  | Add profileImageUrl to User type and update SimulationPreview and useStartSimulation comp… |
| `ally-web-b3e4ad62` | clean | 2026-01-06 | old | 9 |  |  |  |  | Add profileImageUrl to User type and update SimulationPreview and useStartSimulation to i… |
| `ally-web-69c64279` | clean | 2026-08-24 | old | 10 |  |  |  |  | default the Thinking Filler toggle on |
| `ally-web-e9432434` | clean | 2026-08-19 | old | 10 |  |  |  |  | add Snake game |
| `ally-web-5e641b22` | clean | 2026-06-17 | old | 10 |  |  |  |  | localize session feedback to the user's selected language |
| `ally-web-d14b6046` | clean | 2026-05-18 | old | 10 |  |  |  |  | add i18n keys for Scribe/Simulation tabs |
| `ally-web-6e5519f5` | clean | 2026-05-07 | old | 10 |  |  |  |  | deprecate voice instruction field from simulation studio |
| `ally-web-5d57a638` | clean | 2026-03-20 | old | 10 |  |  |  |  | deprecated voiceId from simulation metadata |
| `ally-web-5e6c07d3` | clean | 2026-03-16 | old | 10 |  |  |  |  | implement multi-tenant access for org analytics management |
| `ally-web-3423acf2` | clean | 2026-01-14 | old | 10 |  |  |  |  | Update package dependencies and enhance theme configuration for MUI compatibility |
| `ally-web-9622c263` | clean | 2026-08-04 | old | 11 |  |  |  |  | surface branching/orchestration/LLM-response in latency panel |
| `ally-web-0bd10325` | clean | 2026-06-16 | old | 11 |  |  |  |  | add Thinking Filler toggle to simulation creator |
| `ally-web-6467fb61` | clean | 2026-05-19 | old | 11 |  |  |  |  | add per-simulation Speech Prosody toggle |
| `ally-web-7a666557` | clean | 2026-04-27 | old | 11 |  |  |  |  | enhance error handling for missing linguistic style samples |
| `ally-web-eeac84e7` | clean | 2026-02-27 | old | 11 |  |  |  |  | Add support for markdown rendering in AskAiTab and update dependencies for improved local… |
| `ally-web-195edb21` | clean | 2026-06-29 | old | 12 |  |  |  |  | default comfort audio, trim history, and interim reply to true for new roleplays |
| `ally-web-09bf4a22` | clean | 2026-06-26 | old | 12 |  |  |  |  | add Interim Reply toggle to simulation Basic Settings |
| `ally-web-b556a5fa` | clean | 2026-06-26 | old | 12 |  |  |  |  | hide the Run V2V Test button on Roleplay Session Logs |
| `ally-web-aa13119d` | clean | 2026-06-11 | old | 12 |  |  |  |  | use IBM Plex Serif in ally-web |
| `ally-web-8a6df4cc` | clean | 2026-01-06 | old | 12 |  |  |  |  | Refactor mapped events initialization in SimulationEventMapTable to handle empty states a… |
| `ally-web-6b7cd928` | clean | 2026-06-01 | old | 13 |  |  |  |  | collapse role instruction field in an accordion by default |
| `ally-web-d62510fd` | clean | 2026-04-14 | old | 13 |  |  |  |  | add languageCode to event checklist API |
| `ally-web-2f0353c6` | clean | 2026-06-22 | old | 14 |  |  |  |  | make pause toggle opt-in (default disabled) |
| `ally-web-17899ea0` | clean | 2026-03-04 | old | 14 |  |  |  |  | Add validation for helper agent prompt in PromptConfiguration and update ReportSection to… |
| `ally-web-90c31ea8` | clean | 2026-03-11 | old | 15 |  |  |  |  | Implement expiration check for review notes in SimulationSummarySidebar and PostSimulatio… |
| `ally-web-40a2a261` | clean | 2026-02-25 | old | 15 |  |  |  |  | Add active column in voices |
| `ally-web-401b1009` | clean | 2026-01-27 | old | 15 |  |  |  |  | Added tags column on scenario events |
| `ally-web-614d5776` | clean | 2026-08-31 | old | 16 |  |  |  |  | rename the Live tab to "Live events" |
| `ally-web-90af6794` | clean | 2026-07-03 | old | 16 |  |  |  |  | gate Agent Builder Copilot on superadmin role |
| `ally-web-53535a92` | clean | 2026-06-01 | old | 16 |  |  |  |  | StatesEditor body-driven visibility (availableVariables gate) |
| `ally-web-4060e9cb` | clean | 2026-04-03 | old | 16 |  |  |  |  | Add translated version for scenario name |
| `ally-web-e44cf71e` | clean | 2026-03-12 | old | 16 |  |  |  |  | Rename navigation options UI text on Super Admin |
| `ally-web-2bffc0f1` | clean | 2026-02-17 | old | 16 |  |  |  |  | Add languageId support to UpNextSimulationCard and related components, enhancing metadata… |
| `ally-web-686d386c` | clean | 2026-06-04 | old | 17 |  |  |  |  | add enableFeedback flag to toggle post-session AI summary |
| `ally-web-391dd21e` | clean | 2026-03-31 | old | 17 |  |  |  |  | add translation support for badges name and description |
| `ally-web-e68682bd` | clean | 2026-03-06 | old | 17 |  |  |  |  | add support for Marathi, Tamil, and Kannada languages - Created new locale JSON files for… |
| `ally-web-13cf918e` | clean | 2026-01-23 | old | 17 |  |  |  |  | Enhance CommentAdditionDialog with user profile image and update CommentThread to hide co… |
| `ally-web-c17a3be9` | clean | 2026-01-08 | old | 17 |  |  |  |  | Refactor NavSideBar and useUser hooks to streamline tenant data handling |
| `ally-web-82096306` | clean | 2026-08-18 | old | 18 |  |  |  |  | update voice-latency target to 4s, add LLM TTFT target line |
| `ally-web-17a184f6` | clean | 2026-07-02 | old | 18 |  |  |  |  | add access-management tabs to Org. Settings |
| `ally-web-2acee424` | clean | 2026-06-19 | old | 18 |  |  |  |  | disable completed 3-month drift backfill button |
| `ally-web-bf3cb26d` | clean | 2026-05-18 | old | 18 |  |  |  |  | translate review popup, hide deeper reflection tab |
| `ally-web-6e5c824e` | clean | 2026-10-03 | old | 19 |  |  |  |  | 'Foundational skills benchmark' toggle on the simulation editor |
| `ally-web-341b0568` | clean | 2026-06-24 | old | 19 |  |  |  |  | remove static fillerDialogues (LLM now generates fillers) |
| `ally-web-2aef6616` | clean | 2026-06-19 | old | 19 |  |  |  |  | per-scenario pause toggle in simulation editor |
| `ally-web-5738c201` | clean | 2026-06-17 | old | 19 |  |  |  |  | remove Search tab from navigation |
| `ally-web-23ed69a0` | clean | 2026-08-04 | old | 20 |  |  |  |  | searchable simulation picker in Latency tab |
| `ally-web-238f62ce` | clean | 2026-08-04 | old | 20 |  |  |  |  | searchable simulation picker in Latency tab |
| `ally-web-13591dc4` | clean | 2026-07-09 | old | 20 |  |  |  |  | surface suspected-freeze signal in analytics + session detail |
| `ally-web-34fc2a81` | clean | 2026-02-17 | old | 20 |  |  |  |  | Enhance CreateBadgeSidePanel with new ArrowDownFilled icon and improve layout for criteri… |
| `ally-web-78c312d7` | clean | 2026-07-17 | old | 21 |  |  |  |  | live run status polling for async execution |
| `ally-web-cc9a1eed` | clean | 2026-07-17 | old | 21 |  |  |  |  | use AutoExpandableTextarea for open-ended quiz answer |
| `ally-web-3ead032e` | clean | 2026-06-19 | old | 21 |  |  |  |  | hide drift backfill button behind a flag |
| `ally-web-9eb3fd94` | clean | 2026-05-11 | old | 21 |  |  |  |  | add audio playback for role-play sessions in review feed |
| `ally-web-deeb0ef3` | clean | 2026-03-20 | old | 21 |  |  |  |  | Added name field in the state instruction and added currentState toggle button |
| `ally-web-cae8c2d7` | clean | 2026-02-16 | old | 21 |  |  |  |  | Update simulationStudio API to conditionally include status parameter and add CreateCase … |
| `ally-web-408d025a` | clean | 2026-08-06 | old | 22 |  |  |  |  | hide language rollout toggles from non-super-duper-admins |
| `ally-web-8346da34` | clean | 2026-06-29 | old | 22 |  |  |  |  | remove deprecated Speech Prosody toggle |
| `ally-web-5240db76` | clean | 2026-04-29 | old | 22 |  |  |  |  | replace per-field update reordering with a single reorder endpoint |
| `ally-web-7d62f37d` | clean | 2026-03-25 | old | 22 |  |  |  |  | Added languageCode for scenario to fetch translations for app language |
| `ally-web-1886f0d9` | clean | 2026-03-11 | old | 22 |  |  |  |  | Enhance SimulationTranscriptTab to accept agentName prop for improved context in transcri… |
| `ally-web-3593086e` | clean | 2026-03-10 | old | 22 |  |  |  |  | Added APP type in otp body |
| `ally-web-3e1f123b` | clean | 2026-10-06 | old | 23 |  |  |  |  | remove the waiting-on-you count from the Bug Hunter sidebar tab |
| `ally-web-f7b8a8ab` | clean | 2026-08-19 | old | 23 |  |  |  |  | show tokens consumed per run in the shift log |
| `ally-web-1d2e1b56` | clean | 2026-07-22 | old | 23 |  |  |  |  | add admin Reminders toggle and gate display on it |
| `ally-web-f11b2922` | clean | 2026-02-17 | old | 23 |  |  |  |  | Add tags support to SimulationTranscriptMessage and display tags in TranscriptListing wit… |
| `ally-web-8b342dbf` | clean | 2026-02-17 | old | 23 |  |  |  |  | Update UpNextSimulationCard to include case session completion logic and enhance current … |
| `ally-web-b1047c6b` | clean | 2026-09-11 | old | 24 |  |  |  |  | add the document search and roadmap surfaces, and say which are unjudged |
| `ally-web-23a2cc67` | clean | 2026-06-26 | old | 24 |  |  |  |  | add Continuous Back-channeling simulation toggle |
| `ally-web-bd582030` | clean | 2026-01-05 | old | 24 |  |  |  |  | Enhance GoogleLogin component in Login page with additional props for customization |
| `ally-web-cdf1e111` | clean | 2026-09-11 | old | 25 |  |  |  |  | show the WhatsApp bot's retrievals, and say when a question is withheld |
| `ally-web-67be08eb` | clean | 2026-09-01 | old | 25 |  |  |  |  | add What's New field to the Promote Android to Production dialog |
| `ally-web-d97f3b0c` | clean | 2026-07-28 | old | 25 |  |  |  |  | add test-organization toggle to the org editor |
| `ally-web-e9ca235b` | clean | 2026-03-10 | old | 25 |  |  |  |  | Add 'Simulation' tag display in FeedCard and ShareForReview components, and update relate… |
| `ally-web-ecf7f251` | clean | 2026-01-23 | old | 25 |  |  |  |  | Added notfication modal on the tracks |
| `ally-web-dd4b61ef` | clean | 2026-09-30 | old | 26 |  |  |  |  | offer OpenCode as an engine in AI Models settings |
| `ally-web-0684c0be` | clean | 2026-09-16 | old | 26 |  |  |  |  | control for releasing a merged pull request |
| `ally-web-f8ad92cb` | clean | 2026-06-29 | old | 26 |  |  |  |  | add non-v3 voice expression toggles |
| `ally-web-05c678e8` | clean | 2026-03-26 | old | 26 |  |  |  |  | Made profession a required field and prevented clearing of essential character details. |
| `ally-web-9cad126c` | clean | 2026-03-19 | old | 26 |  |  |  |  | Update jspdf dependency to version 4.2.1 and modify postCallSectionOrder to include Trans… |
| `ally-web-0922d045` | clean | 2026-07-14 | old | 27 |  |  |  |  | reserve old-tracks Create button for super-duper-admin |
| `ally-web-63a7eb45` | clean | 2026-01-30 | old | 27 |  |  |  |  | Add user name display in UserInfo component and pass it to NavSideBar for enhanced user e… |
| `ally-web-c5c48980` | clean | 2026-08-31 | old | 28 |  |  |  |  | keep a grandfathered owner visible in the picker |
| `ally-web-e53e75f7` | clean | 2026-08-13 | old | 28 |  |  |  |  | hide legacy track creation, Courses replaces it |
| `ally-web-4de8c1eb` | clean | 2026-08-11 | old | 28 |  |  |  |  | open Languages and its glossary to plain super-admins |
| `ally-web-bfc1465d` | clean | 2026-06-17 | old | 28 |  |  |  |  | 'by experiment' adds STT model, drops provider |
| `ally-web-dc32b9a0` | clean | 2026-05-29 | old | 28 |  |  |  |  | drop "Not used by selected prompt" badge + opacity dim |
| `ally-web-7b6feb17` | clean | 2026-02-25 | old | 28 |  |  |  |  | Update userBadgesAPI to include providesTags and invalidatesTags for better cache managem… |
| `ally-web-7e75d02c` | clean | 2026-01-13 | old | 28 |  |  |  |  | Implement leaderboard feature flag for conditional rendering in navigation and leaderboar… |
| `ally-web-062d1220` | clean | 2026-10-05 | old | 29 |  |  |  |  | drop the scorecard and accuracy panel from the Bug Agent tab |
| `ally-web-a4fb7e8a` | clean | 2026-06-08 | old | 29 |  |  |  |  | show Reviewed badge on simulation review cards |
| `ally-web-2be9e034` | clean | 2026-03-18 | old | 29 |  |  |  |  | Add support for block prompts in PromptManagement and update side panel to use combined p… |
| `ally-web-cc370f8d` | clean | 2026-01-08 | old | 29 |  |  |  |  | Add image validation for aspect ratio and file size in ImageUpload component |
| `ally-web-41a5a32a` | clean | 2026-10-09 | old | 30 |  |  |  |  | the PR review sense on the sweep workflow and in the admin (OPP-0785) |
| `ally-web-95dbb385` | clean | 2026-08-07 | old | 30 |  |  |  |  | add Max Endpointing Delay Studio field for turn-detection override |
| `ally-web-4d3951c8` | clean | 2026-02-19 | old | 30 |  |  |  |  | Enhance CharacterSidePanel with initial data state and form change detection |
| `ally-web-a39d71f3` | clean | 2026-09-24 | old | 31 |  |  |  |  | offer quarter grouping on Weak Performing Metrics |
| `ally-web-15286721` | clean | 2026-05-11 | old | 31 |  |  |  |  | track client platform on scenario sessions |
| `ally-web-da742b96` | clean | 2026-09-15 | old | 32 |  |  |  |  | let authors say why an article answer is wrong |
| `ally-web-fee36d89` | clean | 2026-09-10 | old | 32 |  |  |  |  | add engagement reminders toggle |
| `ally-web-5ee014d8` | clean | 2026-03-17 | old | 32 |  |  |  |  | Add restrictions for multi tenant admin on track and cases |
| `ally-web-060b4c9b` | clean | 2026-02-18 | old | 32 |  |  |  |  | Enhance BehavioursInstruction and EditableTable components with improved styling and data… |
| `ally-web-f826957f` | clean | 2026-09-10 | old | 33 |  |  |  |  | let any SUPER_DUPER_ADMIN see Organization Settings |
| `ally-web-b2b6c859` | clean | 2026-07-01 | old | 33 |  |  |  |  | Remove redundant 'Timeout vs other error' donut from scribe failure tab |
| `ally-web-8fa8899a` | clean | 2026-04-06 | old | 33 |  |  |  |  | add voice search in language voice mapping |
| `ally-web-8465c167` | clean | 2026-03-03 | old | 34 |  |  |  |  | Add manual socket reconnection |
| `ally-web-2392052d` | clean | 2026-02-12 | old | 34 |  |  |  |  | Enhance upcoming simulation API to support case type and refactor related components |
| `ally-web-17c160fd` | clean | 2026-01-05 | old | 34 |  |  |  |  | Update Login components in ally-admin and ally-helpline dashboards to set Google sign-in … |
| `ally-web-15140993` | clean | 2026-09-10 | old | 35 |  |  |  |  | recognise the EVALUATOR role and its permission |
| `ally-web-3bc7ac28` | clean | 2026-06-17 | old | 35 |  |  |  |  | drift dashboard — consistency fixes, STT split, live/historical trend, drop heatmap & ons… |
| `ally-web-7ed617da` | clean | 2026-01-08 | old | 35 |  |  |  |  | Inline image validation logic in handleFileChange for improved clarity |
| `ally-web-695bb26d` | clean | 2026-09-09 | old | 36 |  |  |  |  | surface weekly consistency, and retype the streak as XP-based |
| `ally-web-b9800712` | clean | 2026-07-01 | old | 36 |  |  |  |  | Show stored-audio-state breakdown on scribe failure tab |
| `ally-web-63af9cd5` | clean | 2026-08-31 | old | 37 |  |  |  |  | wire up the Mobile Releases page |
| `ally-web-53dcab8e` | clean | 2026-07-17 | old | 37 |  |  |  |  | use shared Button for straggler action buttons |
| `ally-web-382b51ea` | clean | 2026-07-01 | old | 37 |  |  |  |  | Add 'Failures by session mode' chart to scribe failure tab |
| `ally-web-8890b80b` | clean | 2026-07-01 | old | 37 |  |  |  |  | Add 'Top failure reasons' list to scribe summary-failure tab |
| `ally-web-20b803fc` | clean | 2026-06-18 | old | 37 |  |  |  |  | warn when a simulation has >10 advanced events |
| `ally-web-b860c95c` | clean | 2026-02-02 | old | 37 |  |  |  |  | Add dateTime prop to FeedCard and Review components for improved timestamp handling |
| `ally-web-abdad901` | clean | 2026-05-07 | old | 38 |  |  |  |  | hide focus button when ExperienceMode is NONE |
| `ally-web-869480af` | clean | 2026-01-06 | old | 38 |  |  |  |  | Enhance GoogleSignInButton by introducing authenticationType prop to support multiple sig… |
| `ally-web-ec8dcd80` | clean | 2026-03-24 | old | 39 |  |  |  |  | Add "Used Blocks" section with help text and updated styling to PromptSidePanel. |
| `ally-web-7b655598` | clean | 2026-09-24 | old | 40 |  |  |  |  | deep-link COURSE_DISCUSSION_REPLY notifications to the post |
| `ally-web-2ae8d573` | clean | 2026-07-14 | old | 40 |  |  |  |  | permission-aware event management for multi-tenant admins |
| `ally-web-6b4a5d04` | clean | 2026-01-05 | old | 41 |  |  |  |  | Update Login component to streamline Google sign-in process and enhance user experience; … |
| `ally-web-da6535f4` | clean | 2026-09-11 | old | 42 |  |  |  |  | say when nothing is indexed, instead of blaming the floor |
| `ally-web-bbaeab31` | clean | 2026-09-03 | old | 42 |  |  |  |  | show where the losses come from |
| `ally-web-ffa86627` | clean | 2026-07-27 | old | 42 |  |  |  |  | add language column and filter |
| `ally-web-1364881b` | clean | 2026-07-01 | old | 42 |  |  |  |  | unify scribe review structure with simulation |
| `ally-web-d0cb379d` | clean | 2026-04-29 | old | 42 |  |  |  |  | restrict AI fill mode to TEXT custom fields only |
| `ally-web-5856bcb7` | clean | 2026-09-25 | old | 43 |  |  |  |  | a switch for letting a clean review merge |
| `ally-web-905dce20` | clean | 2026-08-24 | old | 43 |  |  |  |  | add per-roleplay liveTabEnabled opt-out toggle |
| `ally-web-93421529` | clean | 2026-04-02 | old | 43 |  |  |  |  | add languageCode support to scenario paths and cases APIs |
| `ally-web-d8229cf1` | clean | 2026-08-03 | old | 44 |  |  |  |  | show STT finalize latency in admin dashboards |
| `ally-web-4ef55961` | clean | 2026-05-12 | old | 44 |  |  |  |  | add per-language label column to language-voice mapping |
| `ally-web-76a4e8da` | clean | 2026-01-14 | old | 44 |  |  |  |  | Add private and public filter for simulation listing |
| `ally-web-a488a07f` | clean | 2026-10-02 | old | 45 |  |  |  |  | show bridge lines apart from the legacy interim |
| `ally-web-061aed57` | clean | 2026-09-15 | old | 45 |  |  |  |  | controls for reviewing and approving its own pull requests |
| `ally-web-0e517ac5` | clean | 2026-07-30 | old | 45 |  |  |  |  | add roadmap owner filter so migrated views apply in full |
| `ally-web-3a96f669` | clean | 2026-08-04 | old | 46 |  |  |  |  | float the persona's own gender to the top of the voice picker |
| `ally-web-0a83775f` | clean | 2026-08-03 | old | 46 |  |  |  |  | show prompt-cache hit rate on the AI cost tab |
| `ally-web-2225edb8` | clean | 2026-03-16 | old | 46 |  |  |  |  | Add User and Org access to multi tenant admin |
| `ally-web-255dd0c3` | clean | 2026-03-10 | old | 46 |  |  |  |  | Add comments sorting |
| `ally-web-95cd5928` | clean | 2026-02-02 | old | 46 |  |  |  |  | Add hideRank prop to LeaderboardList for customizable rank visibility |
| `ally-web-9d1b93e2` | clean | 2026-10-01 | old | 47 |  |  |  |  | show Open in Builder to Builder users, not roadmap managers |
| `ally-web-37770901` | clean | 2026-02-04 | old | 47 |  |  |  |  | Refactor CaseTrackDetails component to support case and track types, integrating new API … |
| `ally-web-ece48285` | clean | 2026-10-01 | old | 48 |  |  |  |  | drop the heatmap legend; footer says "About Ally" |
| `ally-web-a7ef2ae3` | clean | 2026-08-20 | old | 48 |  |  |  |  | one glossary rail row per section, style variants behind a selector |
| `ally-web-d588d93a` | clean | 2026-08-04 | old | 48 |  |  |  |  | remove Sentence/Semantic Similarity from the event creation picker |
| `ally-web-7aab32d1` | clean | 2026-06-04 | old | 48 |  |  |  |  | trainer toggle to disable post-session AI feedback |
| `ally-web-e14152f2` | clean | 2026-06-03 | old | 48 |  |  |  |  | cull 9 ghost field references from catalog, types, and metadata mapper |
| `ally-web-08f9a65c` | clean | 2026-04-02 | old | 48 |  |  |  |  | added simulation traslation on checklist and other |
| `ally-web-79d93200` | clean | 2026-01-06 | old | 48 |  |  |  |  | Update Google sign-in handling across Login components to support both accessToken and id… |
| `ally-web-afd4340a` | clean | 2026-08-13 | old | 49 |  |  |  |  | GA the native Organization Metrics dashboard |
| `ally-web-d98b6155` | clean | 2026-02-24 | old | 49 |  |  |  |  | Enhance BehavioursInstruction component with row selection and deletion functionality, an… |
| `ally-web-563a88c5` | clean | 2026-01-17 | old | 49 |  |  |  |  | Shift demographic fields from basic settings to overview section and update requirements |
| `ally-web-99c410ee` | clean | 2026-07-03 | old | 50 |  |  |  |  | make live call screen responsive and fix events panel scroll |
| `ally-web-469a8a25` | clean | 2026-04-10 | old | 51 |  |  |  |  | UI Text Updates |
| `ally-web-8cf830d2` | clean | 2026-07-15 | old | 52 |  |  |  |  | peer sessions — exclude viewer's own, remove rollout allowlist |
| `ally-web-c8c27be1` | clean | 2026-10-07 | old | 53 |  |  |  |  | show where the independent verifier stands on a finding (OPP-0780) |
| `ally-web-da4eccc7` | clean | 2026-08-14 | old | 53 |  |  |  |  | show inapplicable goals as N/A, not as a low score |
| `ally-web-fe4dfddf` | clean | 2026-08-13 | old | 53 |  |  |  |  | reorder tabs to product order and hide empty ones |
| `ally-web-f79176ad` | clean | 2026-10-09 | old | 54 |  |  |  |  | a sortable Est. cost column on the Bugs I'm tracking table (OPP-0748) |
| `ally-web-bd798ea9` | clean | 2026-09-19 | old | 54 |  |  |  |  | Ally Blue as the accent, replacing Claude's clay |
| `ally-web-ebc13e95` | clean | 2026-09-11 | old | 54 |  |  |  |  | reach the reference corpus from the list, not from inside an interview |
| `ally-web-c5672b10` | clean | 2026-05-20 | old | 54 |  |  |  |  | add per-language title translations on Overview |
| `ally-web-dd172f47` | clean | 2026-04-29 | old | 54 |  |  |  |  | filter custom field type options by enabled types in ScribeSettings |
| `ally-web-06759109` | clean | 2026-03-16 | old | 55 |  |  |  |  | Implement general comments overview API and enhance CommentsSection component |
| `ally-web-3459339b` | clean | 2026-09-25 | old | 56 |  |  |  |  | tune Priority chart defaults, rename AAQ-009, drop scroll note |
| `ally-web-1571f1f6` | clean | 2026-06-22 | old | 57 |  |  |  |  | add search bar to primary navigation sidebar |
| `ally-web-c6f4394f` | clean | 2026-02-25 | old | 57 |  |  |  |  | Add AUDIO_UPLOAD call type and update Calls component to support audio upload functionali… |
| `ally-web-65bfc572` | clean | 2026-09-22 | old | 58 |  |  |  |  | move Goals under Highlights as its first sub-tab |
| `ally-web-08044d8c` | clean | 2026-07-28 | old | 58 |  |  |  |  | name the entry points after the modes they start |
| `ally-web-a21b41d5` | clean | 2026-07-03 | old | 58 |  |  |  |  | save dictated voice-note transcript so it shows in logs |
| `ally-web-34b2139c` | clean | 2026-04-08 | old | 58 |  |  |  |  | add language translation support to scenario simulation summary |
| `ally-web-0fb1ae63` | clean | 2026-03-10 | old | 58 |  |  |  |  | Implement permission-based tab visibility in Review component and update constants for en… |
| `ally-web-35ec0f0a` | clean | 2026-06-23 | old | 59 |  |  |  |  | add Improve (primary + re-translate) to Title |
| `ally-web-f9f0ff22` | clean | 2026-04-22 | old | 59 |  |  |  |  | add i18n support for TurnIndicator |
| `ally-web-a2f2efa9` | clean | 2026-08-04 | old | 60 |  |  |  |  | narrow a voice picker to the gender being configured |
| `ally-web-d3d450a2` | clean | 2026-07-06 | old | 60 |  |  |  |  | remove generate/regenerate field controls (superseded by Copilot + Improve) |
| `ally-web-e6cea6d3` | clean | 2026-09-08 | old | 61 |  |  |  |  | cap the local Vitest worker pool |
| `ally-web-2622c66e` | clean | 2026-02-20 | old | 61 |  |  |  |  | Update checklist and reflection tab components for improved data handling and user feedba… |
| `ally-web-a2a9d362` | clean | 2026-02-12 | old | 61 |  |  |  |  | Update API endpoints and refactor CreateCase component for scenario cases management |
| `ally-web-1b2777bd` | clean | 2026-06-29 | old | 62 |  |  |  |  | Drop AI/Scribe toggle, show all analytics tabs in one row |
| `ally-web-fbb9b287` | clean | 2026-04-22 | old | 63 |  |  |  |  | add LIST checklist type without status tick |
| `ally-web-cc495c41` | clean | 2026-07-20 | old | 64 |  |  |  |  | add tenant-scoped organization metrics endpoint |
| `ally-web-30daf08d` | clean | 2026-04-13 | old | 65 |  |  |  |  | add Mode column to real call logs table with i18n support |
| `ally-web-14567414` | clean | 2026-07-10 | old | 67 |  |  |  |  | collapsible Copilot pane in Agent Builder Copilot tab |
| `ally-web-17b20c49` | clean | 2026-04-30 | old | 67 |  |  |  |  | hide field-type picker when AI fill is selected |
| `ally-web-7363feb6` | clean | 2026-03-31 | old | 67 |  |  |  |  | add translation support for scenario titles in review list |
| `ally-web-2f4d42c6` | clean | 2026-03-04 | old | 68 |  |  |  |  | Add autofill model selection feature with API integration for dynamic model retrieval |
| `ally-web-283f3c98` | clean | 2026-02-18 | old | 68 |  |  |  |  | Implement chat functionality with chatReducer, message handling, and sendMessage utility … |
| `ally-web-0025ea29` | clean | 2026-08-31 | old | 69 |  |  |  |  | add What's New text field to App Store submit dialog |
| `ally-web-308e16ce` | clean | 2026-07-16 | old | 69 |  |  |  |  | AI Lab skill model dropdown |
| `ally-web-6fad4ac8` | clean | 2026-03-02 | old | 69 |  |  |  |  | Introduce report generation types and update import path for report generation module |
| `ally-web-bc8f166b` | clean | 2026-02-24 | old | 69 |  |  |  |  | Update placeholders and toast messages for case and track components, enhancing user expe… |
| `ally-web-24c1c9a3` | clean | 2026-03-26 | old | 70 |  |  |  |  | Update default role instruction prompt with detailed guidelines and automatically pre-fil… |
| `ally-web-323b9e4b` | clean | 2026-10-01 | old | 71 |  |  |  |  | show who posted each opportunity on Roadmap queue cards |
| `ally-web-48cc8d83` | clean | 2026-07-27 | old | 71 |  |  |  |  | add per-language voice-to-voice latency breakdown |
| `ally-web-0a1fed86` | clean | 2026-09-09 | old | 72 |  |  |  |  | replace monthly vote cap with an expiring vote-grant budget |
| `ally-web-356150fc` | clean | 2026-08-19 | old | 72 |  |  |  |  | add synchronized 3-2-1 visual countdown before session start |
| `ally-web-6d7e6d7c` | clean | 2026-05-08 | old | 72 |  |  |  |  | warn creators about empty optional fields before publish/preview |
| `ally-web-9a3410b1` | clean | 2026-07-27 | old | 74 |  |  |  |  | per-language runtime model dropdown in translations panel |
| `ally-web-6711704c` | clean | 2026-05-06 | old | 74 |  |  |  |  | add search to roleplay list |
| `ally-web-3a2c915f` | clean | 2026-04-13 | old | 74 |  |  |  |  | Add mode option in call details |
| `ally-web-ed027261` | clean | 2026-03-06 | old | 74 |  |  |  |  | Implement comment length restriction across components by introducing COMMENT_MAX_LENGTH … |
| `ally-web-9f416537` | clean | 2026-01-06 | old | 74 |  |  |  |  | Update login components to improve user agreement language and enhance Google sign-in int… |
| `ally-web-6ba32973` | clean | 2026-06-10 | old | 75 |  |  |  |  | show skill version & helper prompt per report-history log |
| `ally-web-97c6e199` | clean | 2026-04-29 | old | 75 |  |  |  |  | add Call Name text filter for counsellor and rename column |
| `ally-web-57497975` | clean | 2026-08-18 | old | 76 |  |  |  |  | remove the repo-picker dropdown from the fix-session dialog |
| `ally-web-6bfa6086` | clean | 2026-06-30 | old | 76 |  |  |  |  | add read tracking, read/unread filter tabs |
| `ally-web-6ef93855` | clean | 2026-05-13 | old | 76 |  |  |  |  | render HTML descriptions as plain text in list previews |
| `ally-web-4c315418` | clean | 2026-08-31 | old | 78 |  |  |  |  | add Submit for Full App Store Review button |
| `ally-web-4a38856c` | clean | 2026-07-01 | old | 80 |  |  |  |  | Add capture-method chart, fix note-mode labels, drop retryable donut |
| `ally-web-d6482af1` | clean | 2026-04-15 | old | 80 |  |  |  |  | add advanced settings view toggle for simulation event map |
| `ally-web-fbaad16c` | clean | 2026-02-26 | old | 80 |  |  |  |  | Enhance SkillsTab and FeedbackSection components with checklist mode support and improve … |
| `ally-web-cfac2ad5` | clean | 2026-04-07 | old | 81 |  |  |  |  | Add translations for session logs |
| `ally-web-fee9b6e8` | clean | 2026-07-09 | old | 82 |  |  |  |  | render session lifecycle timeline |
| `ally-web-01c8a476` | clean | 2026-09-04 | old | 83 |  |  |  |  | add Learner Progress toggle to org Simulations Settings |
| `ally-web-6df1f7ee` | clean | 2026-08-31 | old | 83 |  |  |  |  | Remove the manual iOS TestFlight promote button |
| `ally-web-6bed14ba` | clean | 2026-08-04 | old | 83 |  |  |  |  | add Gender and Age to the voices list filter |
| `ally-web-057aad61` | clean | 2026-07-30 | old | 83 |  |  |  |  | generate backstory, opening dialogues, reminders, and linguistic style/filler fields |
| `ally-web-6a5ec6cc` | clean | 2026-07-03 | old | 83 |  |  |  |  | make Agent Builder Copilot the canonical simulation builder |
| `ally-web-b4a957f8` | clean | 2026-09-10 | old | 84 |  |  |  |  | move engagement reminders toggle to admin console |
| `ally-web-2289a7dd` | clean | 2026-09-09 | old | 84 |  |  |  |  | show upcoming goal periods on XP earned vs. goal chart |
| `ally-web-ab97aeef` | clean | 2026-09-02 | old | 85 |  |  |  |  | wire up AI-drafted What's New for the Android promotion dialog |
| `ally-web-1a26d04c` | clean | 2026-02-18 | old | 85 |  |  |  |  | Integrate Ask AI and Skills tabs into SimulationSummarySidebar and PostSimulationSummary … |
| `ally-web-1aaf2d2d` | clean | 2026-08-04 | old | 86 |  |  |  |  | label a saved voice's picker on open, and let the v3 advisory expire |
| `ally-web-9b4e960c` | clean | 2026-08-24 | old | 87 |  |  |  |  | per-sim turn-endpointing delays in Basic Settings |
| `ally-web-6b3c6eb3` | clean | 2026-08-10 | old | 87 |  |  |  |  | show learners which roleplays they've already completed |
| `ally-web-6339b329` | clean | 2026-06-30 | old | 88 |  |  |  |  | add search to scenario dropdown in V2V test modal |
| `ally-web-c501ebae` | clean | 2026-10-01 | old | 89 |  |  |  |  | group the public changelog by day, not by week |
| `ally-web-6f480aaa` | clean | 2026-04-01 | old | 89 |  |  |  |  | Enhance linguistic style samples and opening dialogues panels with content checks and dyn… |
| `ally-web-f180eaf9` | clean | 2026-02-25 | old | 90 |  |  |  |  | Add functionality to manage badges for tenants, including adding and removing badges, wit… |
| `ally-web-9f6e0dac` | clean | 2026-08-31 | old | 91 |  |  |  |  | offer an owner picker when a manager files an opportunity |
| `ally-web-fecfeda1` | clean | 2026-07-24 | old | 91 |  |  |  |  | copilot generates and fills States (Studio v1) |
| `ally-web-6bc79c15` | clean | 2026-06-01 | old | 91 |  |  |  |  | switch StatesEditor to strict numeric bounds |
| `ally-web-7e504a69` | clean | 2026-07-28 | old | 92 |  |  |  |  | remove dictation-mode UI, now retired server-side |
| `ally-web-9b435d70` | clean | 2026-06-30 | old | 92 |  |  |  |  | tag V2V test sessions in roleplay logs and cap score display at 100 |
| `ally-web-b5ea21a3` | clean | 2026-02-25 | old | 92 |  |  |  |  | Enhance badges management by adding pagination, search, and sorting capabilities in the B… |
| `ally-web-90ac86ad` | clean | 2026-08-19 | old | 93 |  |  |  |  | add prompt cache hit rate chart to Latency & Reliability |
| `ally-web-364d7bde` | clean | 2026-10-05 | old | 94 |  |  |  |  | let staff name the codebase, at report time and when putting Bug Hunter on a bug |
| `ally-web-610a7a7f` | clean | 2026-09-30 | old | 94 |  |  |  |  | the changelog lists product updates, not one line per merge |
| `ally-web-4c71ad35` | clean | 2026-06-15 | old | 94 |  |  |  |  | adopt IBM Carbon design language with serif-only typography |
| `ally-web-0d4c9d63` | clean | 2026-09-01 | old | 95 |  |  |  |  | prefill What's New with an AI-drafted suggestion |
| `ally-web-464309bb` | clean | 2026-03-24 | old | 95 |  |  |  |  | enhance text input components with maxLength support and improve layout consistency acros… |
| `ally-web-ec78656a` | clean | 2026-02-04 | old | 95 |  |  |  |  | Enhance CharacterProfileSelector with search functionality and improved character display… |
| `ally-web-12db5b60` | clean | 2026-09-22 | old | 96 |  |  |  |  | mount the new Goals-tab charts, relocate ship-volume |
| `ally-web-8fbbb3a0` | clean | 2026-08-23 | old | 96 |  |  |  |  | disclose the live Supervisor tab is AI-generated (#475) |
| `ally-web-0747c845` | clean | 2026-06-17 | old | 96 |  |  |  |  | localize session feedback to the user's selected language |
| `ally-web-322e0a7e` | clean | 2026-01-08 | old | 96 |  |  |  |  | Add refetchUser function to update user data after profile changes; enhance profile image… |
| `ally-web-b9ae7df9` | clean | 2026-10-07 | old | 97 |  |  |  |  | show the Verifier's verdict and its runs (OPP-0779) |
| `ally-web-16548afd` | clean | 2026-01-08 | old | 97 |  |  |  |  | Implement score input handling and improve time input defaults across components |
| `ally-web-1ebdccce` | clean | 2026-06-17 | old | 98 |  |  |  |  | gate bulk-created users into profile completion on first login |
| `ally-web-a64d4d2a` | clean | 2026-09-19 | old | 100 |  |  |  |  | W4 — move shared colour literals onto per-app tokens |
| `ally-web-7036d916` | clean | 2026-06-23 | old | 101 |  |  |  |  | Improve re-translates other languages for primary fields |
| `ally-web-15fde22e` | clean | 2026-04-22 | old | 101 |  |  |  |  | enhance autofill model selection with provider categorization |
| `ally-web-7de42926` | clean | 2026-03-03 | old | 101 |  |  |  |  | add  Add app language option for search page |
| `ally-web-df03a962` | clean | 2026-05-06 | old | 103 |  |  |  |  | unified translation management UI with per-column filters |
| `ally-web-c5aacb82` | clean | 2026-10-05 | old | 104 |  |  |  |  | bugs found per day chart on the Bug Agent tab (AAQ-201) |
| `ally-web-aee2e85a` | clean | 2026-10-01 | old | 104 |  |  |  |  | compact changelog header and code-activity strip |
| `ally-web-2b04b1e4` | clean | 2026-04-01 | old | 104 |  |  |  |  | Add audio URL fetching and enhance AudioTranscriptPlayer with seek functionality |
| `ally-web-c315aff4` | clean | 2026-01-06 | old | 105 |  |  |  |  | Add ScoreWindowSection to EventSettingsSection and update index exports; enhance NumberIn… |
| `ally-web-eea720b9` | clean | 2026-08-24 | old | 106 |  |  |  |  | show timestamps, not bare dates, across Bug Hunter |
| `ally-web-64d311f2` | clean | 2026-10-04 | old | 108 |  |  |  |  | org filter on Highlights → Helping skills |
| `ally-web-f382e84a` | clean | 2026-08-13 | old | 108 |  |  |  |  | add LLM TTFT chart to Latency & Reliability tab |
| `ally-web-d2b55e3e` | clean | 2026-04-02 | old | 108 |  |  |  |  | Added transaltion on the simulation room |
| `ally-web-3c1c1c44` | clean | 2026-03-11 | old | 108 |  |  |  |  | Rename navigation options UI text on Super Admin |
| `ally-web-13fc8667` | clean | 2026-02-24 | old | 108 |  |  |  |  | Add validation for maximum rows in BehavioursInstruction and enhance error handling in Cr… |
| `ally-web-e605db0c` | clean | 2026-08-26 | old | 109 |  |  |  |  | add a footer and move the changelog link into it |
| `ally-web-0e38a86c` | clean | 2026-10-05 | old | 111 |  |  |  |  | show what the notebook retired on its own, with the reason and an undo (OPP-0752) |
| `ally-web-d43d8529` | clean | 2026-08-10 | old | 114 |  |  |  |  | Language glossary card in Roleplay Session Log detail |
| `ally-web-d49e3943` | clean | 2026-04-15 | old | 114 |  |  |  |  | Add impersonation in admin dashboard |
| `ally-web-ad4fded4` | clean | 2026-03-09 | old | 114 |  |  |  |  | Add short-session ui |
| `ally-web-e36e3991` | clean | 2026-09-16 | old | 115 |  |  |  |  | fold the PRD panel to a rail |
| `ally-web-168caaad` | clean | 2026-04-02 | old | 115 |  |  |  |  | add dictation mode session initiation flow |
| `ally-web-323d9c7e` | clean | 2026-02-12 | old | 117 |  |  |  |  | Enhance FeedbackSection to include Key Events as a table and update rendering logic for f… |
| `ally-web-287dcb3f` | clean | 2026-04-30 | old | 119 |  |  |  |  | ask fill mode before field type when creating a custom field |
| `ally-web-d33a3d5e` | clean | 2026-08-04 | old | 120 |  |  |  |  | record a voice's age, and order the studio picker by the persona's |
| `ally-web-d866ad79` | clean | 2026-08-06 | old | 121 |  |  |  |  | link Ally staff to the admin console from consumer nav |
| `ally-web-bb5ea49c` | clean | 2026-07-14 | old | 121 |  |  |  |  | peer sessions drawer on scenario case card |
| `ally-web-63d99a7b` | clean | 2026-03-25 | old | 121 |  |  |  |  | Implement category filtering in Prompt Management, update Prompt type, and add related do… |
| `ally-web-a177d20b` | clean | 2026-05-19 | old | 122 |  |  |  |  | event-driven ringing — stop on agent's first audio |
| `ally-web-6b3fb324` | clean | 2026-10-07 | old | 123 |  |  |  |  | show the case file budget and offer the override (OPP-0775) |
| `ally-web-d64902e3` | clean | 2026-06-29 | old | 123 |  |  |  |  | add LLM Temperature slider to simulation Basic Settings |
| `ally-web-1138d67a` | clean | 2026-07-07 | old | 124 |  |  |  |  | inline audio player for session recordings in roleplay logs |
| `ally-web-af9ccde8` | clean | 2026-09-29 | old | 125 |  |  |  |  | show why the last fix session failed in the drawer (OPP-0735) |
| `ally-web-e11b8635` | clean | 2026-07-08 | old | 126 |  |  |  |  | add voice-naturalness toggles to Roleplay Studio v2 |
| `ally-web-b99fe429` | clean | 2026-10-01 | old | 127 |  |  |  |  | switch a product update's audience from the table row |
| `ally-web-e9325fd8` | clean | 2026-07-17 | old | 128 |  |  |  |  | direct spec editing, duplicate, sturdier copilot ids |
| `ally-web-37b90dd7` | clean | 2026-07-14 | old | 128 |  |  |  |  | add enabled/disabled access filter to org detail access tabs |
| `ally-web-100a8383` | clean | 2026-07-01 | old | 128 |  |  |  |  | apply same filter+sort structure to Scribe tab and fix dropdown UI |
| `ally-web-e36d2a39` | clean | 2026-07-17 | old | 130 |  |  |  |  | skill generation params form and run cost display |
| `ally-web-17712739` | clean | 2026-06-24 | old | 130 |  |  |  |  | filter & compare conversation drift by scenario version |
| `ally-web-cf13f38a` | clean | 2026-03-12 | old | 131 |  |  |  |  | Add scribe review api integration in feedcard |
| `ally-web-4b38b155` | clean | 2026-05-25 | old | 133 |  |  |  |  | add helpline tooltip display |
| `ally-web-0705df58` | clean | 2026-02-05 | old | 134 |  |  |  |  | Add maximum users limit popup and its logic |
| `ally-web-5cfd48ff` | clean | 2026-01-06 | old | 137 |  |  |  |  | Update AutoTerminationRuleField to use terminationEvents and improve rule handling; add d… |
| `ally-web-80d54bf5` | clean | 2026-07-21 | old | 140 |  |  |  |  | live status polling + stuck-timeout in translations panel |
| `ally-web-6765aa32` | clean | 2026-07-01 | old | 141 |  |  |  |  | Single 'Failure breakdown' chart replacing the three overlapping ones |
| `ally-web-4d47c328` | clean | 2026-02-11 | old | 142 |  |  |  |  | Add TranscriptListing component for displaying simulation transcripts |
| `ally-web-0b72be9d` | clean | 2026-07-22 | old | 143 |  |  |  |  | add Enhance control to the Reminders panel |
| `ally-web-d4cc505a` | clean | 2026-06-30 | old | 145 |  |  |  |  | add read tracking, read/unread filter tabs, and sort dropdown |
| `ally-web-aa6591b0` | clean | 2026-07-31 | old | 146 |  |  |  |  | add 6 more Organization Metrics tiles and a top-simulations list |
| `ally-web-32a6fc4f` | clean | 2026-07-19 | old | 146 |  |  |  |  | add Reminders + Description tabs to roleplay screen |
| `ally-web-f3bae552` | clean | 2026-04-08 | old | 146 |  |  |  |  | Add Translation support for remaining keys |
| `ally-web-d7cbaa36` | clean | 2026-03-18 | old | 146 |  |  |  |  | Introduce prompt blocks with a dedicated editor and display of used blocks in the prompt … |
| `ally-web-395cca22` | clean | 2026-08-31 | old | 148 |  |  |  |  | show live iOS TestFlight status |
| `ally-web-0becc882` | clean | 2026-02-17 | old | 148 |  |  |  |  | Enhance UserBadges component with filtering options and improved empty state handling |
| `ally-web-797001a9` | clean | 2026-07-20 | old | 150 |  |  |  |  | filter session logs by built-in columns |
| `ally-web-88c7c3db` | clean | 2026-02-17 | old | 151 |  |  |  |  | Add ChecklistTab component and API integration for simulation checklist, enhancing post-s… |
| `ally-web-bb821998` | clean | 2026-01-19 | old | 151 |  |  |  |  | Add visual progress bar on simulation call |
| `ally-web-10c2fb00` | clean | 2026-08-31 | old | 152 |  |  |  |  | add manual trigger + next-check estimate |
| `ally-web-682a707a` | clean | 2026-10-08 | old | 154 |  |  |  |  | goal charts on Analytics → Bug Agent (OPP-0778) |
| `ally-web-b50e3268` | clean | 2026-08-07 | old | 154 |  |  |  |  | paginate the Product Roadmap opportunity board |
| `ally-web-195d83d9` | clean | 2026-06-02 | old | 155 |  |  |  |  | hide entry points behind feature flag |
| `ally-web-71817095` | clean | 2026-03-02 | old | 156 |  |  |  |  | Add toggle button for linguistic style samples |
| `ally-web-992906bc` | clean | 2026-07-17 | old | 158 |  |  |  |  | replace native text inputs with Carbon TextInput |
| `ally-web-89346f05` | clean | 2026-06-26 | old | 159 |  |  |  |  | Run V2V Test launcher on Roleplay Session Logs |
| `ally-web-0502a6c1` | clean | 2026-06-18 | old | 160 |  |  |  |  | shared page-level language picker across tabs |
| `ally-web-39c871ee` | clean | 2026-10-07 | old | 161 |  |  |  |  | show why a reported bug was missed in the drawer (OPP-0774) |
| `ally-web-d8313cd8` | clean | 2026-05-20 | old | 161 |  |  |  |  | add per-language title translations on Overview |
| `ally-web-36aa7bc3` | clean | 2026-01-02 | old | 162 |  |  |  |  | Refactor Terms and Agreement component to utilize new data structure and parsing utility |
| `ally-web-d8e38624` | clean | 2026-09-30 | old | 165 |  |  |  |  | remove the consumer-app Org. Settings mirror |
| `ally-web-1ca5b866` | clean | 2026-07-02 | old | 165 |  |  |  |  | add start-latency (time-to-first-word) chart to Latency tab |
| `ally-web-c97900ea` | clean | 2026-05-20 | old | 165 |  |  |  |  | add translations step with title view/edit |
| `ally-web-b5a6e124` | clean | 2026-08-01 | old | 166 |  |  |  |  | test a Language Model config against its provider |
| `ally-web-0426579b` | clean | 2026-06-02 | old | 166 |  |  |  |  | scope to email allowlist (drop env flag) |
| `ally-web-85e6af8a` | clean | 2026-01-06 | old | 167 |  |  |  |  | Add EventSettingsSection component with TimeWindow and OccurrenceControl sections; update… |
| `ally-web-b69fb96a` | clean | 2026-03-26 | old | 172 |  |  |  |  | Add audio preview functionality to the scenario voices table with play/pause controls and… |
| `ally-web-23d7cc9e` | clean | 2026-02-25 | old | 174 |  |  |  |  | Enhance dropdown components with portal rendering for improved positioning and outside cl… |
| `ally-web-8ef27a44` | clean | 2026-07-02 | old | 176 |  |  |  |  | scribe first-attempt series, phase funnel, STT/model panels |
| `ally-web-bf612544` | clean | 2026-06-17 | old | 178 |  |  |  |  | per-language filler dialogues + email-gated Thinking Filler |
| `ally-web-e5ca1dad` | clean | 2026-09-24 | old | 182 |  |  |  |  | hasDiscussion on track items + course discussion API slice |
| `ally-web-e3802349` | clean | 2026-07-03 | old | 182 |  |  |  |  | per-tenant toggle to gate voice-note (mic dictation), default off |
| `ally-web-5838f2e7` | clean | 2026-08-25 | old | 183 |  |  |  |  | show a clear message when a roleplay ended via a technical interruption |
| `ally-web-2d692506` | clean | 2026-06-27 | old | 183 |  |  |  |  | split Sessions tab into Scribe Logs and Roleplay Logs |
| `ally-web-ffd026f3` | clean | 2026-01-05 | old | 183 |  |  |  |  | Refactor GoogleSignInButton to utilize GoogleLogin component for improved sign-in handlin… |
| `ally-web-cefc7df7` | clean | 2026-08-19 | old | 184 |  |  |  |  | panel for what differed about the turns that went wrong |
| `ally-web-05e00e20` | clean | 2026-07-10 | old | 184 |  |  |  |  | author byline, post share links, and listing search |
| `ally-web-4d607aee` | clean | 2026-02-25 | old | 184 |  |  |  |  | Implement cross-tab streaming synchronization using BroadcastChannel in useSendMessage ho… |
| `ally-web-adc55dc8` | clean | 2026-08-24 | old | 185 |  |  |  |  | plot a per-session latency trend above the sessions table |
| `ally-web-d0b634ac` | clean | 2026-09-24 | old | 186 |  |  |  |  | chain Agent Builder Copilot generation in two stages (#706) |
| `ally-web-27837289` | clean | 2026-07-17 | old | 187 |  |  |  |  | matrix runs over value sets |
| `ally-web-c12296b2` | clean | 2026-02-19 | old | 191 |  |  |  |  | Update checklist and sidebar components for improved clarity and organization |
| `ally-web-5716e518` | clean | 2026-08-15 | old | 192 |  |  |  |  | show all accounts in Users, rename the tab to Ally admins |
| `ally-web-0e77bb60` | clean | 2026-06-26 | old | 192 |  |  |  |  | accessibility, states & consistency for shared components |
| `ally-web-0f173336` | clean | 2026-03-25 | old | 194 |  |  |  |  | Implement Max Active Users dialog in simulation preview and scenario components |
| `ally-web-6387b1b8` | clean | 2026-10-10 | old | 195 |  |  |  |  | show how Bug Hunter understood a feature before it fixed it |
| `ally-web-8d17cf23` | clean | 2026-04-21 | old | 198 |  |  |  |  | One role play can be only in languages enabled at role-play level |
