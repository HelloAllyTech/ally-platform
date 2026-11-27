# Course Copilot

An admin agent that interviews a trainer about a course, proposes a blueprint, waits for approval,
generates every component in the background into a DRAFT Track 2.0 course, and then keeps editing
that course on request. Release 1 is platform-tier only: the `course_copilot` feature toggle plus
`view:admin:course-copilot` / `edit:admin:course-copilot`. The admin page lives at
`/course-copilot` in ally-web.

Data model: [`DATA_SCHEMA.md` §3.19](../DATA_SCHEMA.md). Model calls: the `COURSE_COPILOT_TASKS` rows in
`src/llm/constants/ai-task-registry.constants.ts`.

## The flow

```
INTERVIEWING ──propose_blueprint──▶ AWAITING_BLUEPRINT ──Approve & build──▶ BUILDING ──all jobs settle──▶ EDITING
     ▲  ask_trainer / update_brief        update_blueprint / PUT blueprint       socket + polling            edit tools
     └──────────────────────────────── (EDIT mode starts here, bound to an existing course) ─────────────────┘
```

1. **Interview** — one question per turn through `ask_trainer` (2–4 options, one recommended, a custom
   answer always allowed). The order (seed → learners → outcomes → assessment first → shape → practice
   ladder → look → final check) lives in the prompt; the only code guard is that `propose_blueprint` is
   refused until the brief has a seed, an audience, a terminal outcome, a competency, an assessment, a
   duration and a language. The brief is a JSON document patched with `update_brief`; undeclared keys
   are dropped and reported back to the model, and `notes` can only grow.
2. **Blueprint** — one call to the planner specialist, then normalise → estimate → validate. The tree
   in the admin pane and chat edits (`update_blueprint`) both go through that same path, version-checked.
   Approval re-validates, refuses an estimate above the remaining budget, claims the status atomically
   (a double-click creates one course) and creates the DRAFT `tracks` row.
3. **Build** — one `course_copilot_jobs` row per item plus course meta, cover image, article images and
   a final reviewer. See "The build runner".
4. **Edit loop** — course-aware tools that read the live course, mutate it and save through
   `TrackService.upsertStructure`. Each change is logged and pushed to the pane as a `course_patch`.

## Architecture

| Piece | File | Notes |
|---|---|---|
| Turn loop | `service/course-copilot-orchestrator.service.ts` | Fork of the Builder interview orchestrator: two cached system blocks (prompt + platform rules; a per-session library snapshot), volatile state on the newest user turn, summarisation after 40 messages, truncation / invalid-call / empty-turn recovery, per-tool checkpointing |
| Tools | `service/course-copilot-tools.service.ts`, `course-copilot-edit-tools.service.ts` | Exposed by session state (progressive disclosure). Only `ask_trainer`, `propose_blueprint` and confirmation questions end a turn |
| Design guidance | `constants/course-copilot-guidance.constants.ts` | `design_guidance_search` / `design_guidance_get` read the Context Library's **Learning Design** collection (`LD-` codes) through `ContextToolsService`, as the `course_copilot` use case with the session's organisation as audience — the same pipeline, cards and soft failure as Builder's `principles_*` |
| Library search | `service/course-copilot-library.service.ts` | `search_library` (same name and parameters) searches the Context Library's **Content Catalogue** (`CC-` codes, synced from Studio by `ContextCatalogueSyncService`) by meaning, scoped to the session's organisation and to the kind asked for. Every hit is rechecked at hydration against who may open its row — `ContentAccessService` for roleplays and cases, the character library's own scope for characters — and built from the row itself. Competencies, languages, trigger warnings and cover images are still read straight from their tables |
| Citations | `service/course-copilot-blueprint.service.ts` | `[LD-…]` / `[CC-…]` codes in a stored blueprint are checked with `ContextCitationService`, as Builder's PRD is: a code this session was never shown is stripped before the save; the rest are verified in the background |
| Specialists | `service/specialists/*.specialist.ts` | One-shot JSON calls with narrow prompts (article, quiz, journal, annotation, course meta, reviewer, image prompt, blueprint planner, roleplay brief, roleplay fit check). Output is normalised and validated in code before it is written |
| Landing page draft | `service/course-copilot-landing-page.service.ts`, `specialists/landing-page.specialist.ts` | `POST /v1/course-copilot/tracks/:trackId/landing-page-draft` — outside any session: reads the *saved* course, one JSON call (+ one repair pass), returns `{ draft }` and saves nothing. The builder's Landing page tab fills only empty fields. Usage rows carry `metadata.trackId`, not a session id, so they never count against a build's budget |
| Ally notes draft | `service/course-copilot-ally-notes.service.ts`, `specialists/ally-notes.specialist.ts` | `POST /v1/course-copilot/tracks/:trackId/ally-notes-draft` — outside any session, like the landing page: reads the saved outline (titles, types, default tension, short article and scenario excerpts, trigger warnings — never answer keys), one JSON call (+ one repair pass, also taken when the draft quotes a correct quiz answer), returns `{ draft: { notes, tension, draftedByCopilot } }` and saves nothing. The builder's Ally notes editor saves it through `PUT /v1/learn/admin/tracks/:id/guide-notes` |
| New roleplays | `src/learn/service/agent-builder-chain.service.ts` | The admin Agent Builder field chain, server-side |
| Roleplay brief and casting | `service/specialists/roleplay-brief.specialist.ts`, `service/specialists/roleplay-fit-check.specialist.ts` | The brief writer also returns the slot as the manual's structured roleplay brief (`type/roleplay-brief.type.ts`): mode, gate, difficulty and length set in code, opportunities, learner goal and setting written by the model. When the slot reuses a library character, the fit check reads that character's full profile (`CourseCopilotLibraryService.characterProfiles`, the character library's own scope) against the brief, and swaps in the best-fitting library alternative when it does not fit. The swap is stated in the job's summary for the trainer to check, and both brief and verdict are kept on the job result. A failed check keeps the trainer's character |
| Reference material | `service/course-copilot-sources.service.ts`, `util/pptx.extractor.ts`, `entity/course-copilot-source.entity.ts` | Files a trainer attaches to one session (`POST/GET/DELETE /v1/course-copilot/sessions/:id/sources`; PDF, .docx, .pptx; 10 files, 50 MB each). Text is extracted with the Knowledge Base extractors (PDF, Word) or the .pptx reader (slides in presentation order, with speaker notes), split into passages and kept in `course_copilot_sources`; the file is dropped. Files belong to the session, not the organisation, and are deleted on archive. The interviewer gets an overview of every file in its system context and a `search_sources` tool; the blueprint planner and every writer get the best-matching passages (in-memory BM25) appended after their rendered prompt, under `COURSE_COPILOT_SOURCE_RULES` (follow the content, write in your own words, keep key terms, programme names and helpline numbers exact). A session without files sends exactly the prompts it sent before. Each job records the files and pages it was given as `result.references` |
| Roleplay modes in Studio's Agent Builder wizard | `src/learn/util/roleplay-design.util.ts` (mode rules, shared with Copilot), `GET /v1/learn/agent-builder/roleplay-design?mode=`, `generate-field` `roleplayMode` | The wizard asks for a mode after the competency, puts that mode's supports, experience mode and state-aware main prompt on the form, and lays the generated states out for the mode (rupture below 0, bands 50 / 70 / 100). The trainer reviews and saves as before. Also served from here for the wizard: `POST /v1/learn/agent-builder/character-suggestions` (Character Library search plus the fit check) and `POST /v1/learn/agent-builder/revise-plan` (prompt `agent_builder_wizard_revise_plan`: after generating, which fields a change request touches; the wizard rewrites only those through enhance-field) |
| Roleplay design by mode (Course Pilot) | `util/roleplay-mode-design.util.ts`, `src/learn/util/roleplay-design.util.ts`, `AgentBuilderChainService` `design` input | Each new roleplay gets the design for its brief's mode: states from `agent_builder_states` laid out with a rupture state below 0 and bands of 50 / 70 / 100 points (learning / practice / performance and assessment), the first state-aware main prompt that exists (`STATE_AWARE_MAIN_PROMPTS`; states don't run without one), and supports by mode (learning: reminders, state shown, supervisor notes; practice: supervisor notes off; performance and assessment: none, experience mode None). The experience mode is Feedback for learning and practice until Copilot creates anchor events, which a checklist would list. A reused character's saved profile rides on the brief so the role instruction, challenge and opening lines can't contradict it. A validator runs before the save and repairs what it can (reminders on but empty, states no prompt reads); the rest is reported. The job result carries `roleplayCard` (mode, learner goal, states, supports, checks) for the build panel. When the fit check rejects a character and no library alternative fits, a new character is written and saved to the library |
| Learner profiles and skill targets | `service/course-copilot-learner-profile.service.ts`, `data/learner-profiles.json` | The Course Design Manual's 19 learner profiles, verbatim. Interview tools `list_learner_profiles` / `get_learner_profile`; brief fields `learnerProfileId` (+ `learnerProfileName`, set by the server), `skillTargets` (A1–A4 × B1–B3) and `rubric` (EQUIP groups). The matched profile's trainer view is appended to the blueprint planner's prompt |
| Example courses | `service/course-copilot-example-course.service.ts`, `data/example-courses.json`, `scripts/course-copilot/build-example-courses.mjs` | Published courses a person chose as models of good design, as compact outlines (titles, types, sizes, completion rules; no full content or learner data). The planner's reference block gets the one closest in size to the new course as a pattern, never content to copy; the interview has `list_example_courses` / `get_example_course`. To add or refresh one: fetch `GET /api/v1/learn/admin/tracks/:id` and run the script on the JSON files |
| Design principles for planner and reviewer | `service/course-copilot-design-guidance.service.ts` | The interview searches the Context Library's Learning Design collection itself (`design_guidance_search`). The planner and the reviewer can't call tools, so they get the principles ranked for this course: searches written from the brief (audience, outcome, skill target, assessment, components), same retrieval, access rules and org audience. Empty or failing library: nothing is added |
| Learner results | `service/course-copilot-learner-results.service.ts` | What real learners did in the session's own published course: per item reached / completed / attempts / score / time, quiz questions most missed on first try, roleplay sessions ended early or under the bar and the unhelpful behaviours most detected, scenario-quiz endings, bucket-sort first-try accuracy, video watched. Read-only aggregates; test organisations and review enrolments excluded; scoped to the session's organisation; items reached by fewer than 5 learners withheld; no user ids or journal text. Interview tool `get_learner_results`; appended to the course reviewer's reference block when the course has learners |
| Scenario quiz and bucket sort | `service/specialists/scenario-quiz.specialist.ts`, `service/specialists/bucket-sort.specialist.ts` | Job kinds `branching_scenario` and `bucket_sort` (migration `1985500000000`). Scenario quiz: scenes with 2–6 choices, endings with an outcome and score, a recoverable scene after a poor choice; pass mark 0 explores. Bucket sort: 2–6 buckets, explanations written for the expected wrong guess |
| Course review | `course-copilot-job-executor.service.ts` `courseReview` | The reviewer reads inside each roleplay (challenge, role instruction, states with bands, supports), not only its id |
| Structure | `service/course-copilot-structure.service.ts` | Every write: Redis lock → re-read the course → mutate → `upsertStructure`. Outline, previews and the publish-readiness checklist |
| Build | `service/course-copilot-build.service.ts`, `course-copilot-job-executor.service.ts` | Runner, retries, budget hold, cancel, reconcile |
| Media | `service/course-copilot-media.service.ts` | Images via `ImageGenerationProviderFactory` → learn-media bucket under `track-media/image/` |
| Events | `service/course-copilot-event.service.ts`, `gateway/course-copilot.gateway.ts` | `/course-copilot` socket namespace |
| Prompts | `src/prompts/course_copilot/*.txt` | Synced into Prompt Management under the "Course Copilot" category; each row can carry its own model |

## The build runner

- **Durable.** Everything the runner knows is in `course_copilot_jobs`. A job claims itself with a
  conditional `queued → running` UPDATE, beats `heartbeatAt` every 30 s, and settles with a conditional
  `running → done|failed|skipped` UPDATE that carries its result. A Redis lock keeps one runner per
  session across ECS tasks, and the claim makes any overlap harmless.
- **Resumable.** `course-copilot.reconcile` runs on the 5-minute scheduler bucket and once 30 s after boot.
  A running job whose heartbeat is older than 3 minutes (six missed beats) gets its remaining attempt
  back and is re-queued — a restart says nothing about its content — or is failed if it has none; any
  session with queued work and no runner is restarted; a session whose jobs died with nothing left to
  run is marked `BUILD_FAILED`. Verified locally: a build killed mid-flight by a restart resumed on boot
  and finished with every job done.
- **Concurrency 4**, roleplays first (they are the long pole). A new case waits for its member roleplays;
  an article image waits for its article; the reviewer runs once everything else has settled.
- **Two attempts per job.** A validator rejection is retried with the validator's own errors fed back
  to the specialist (the repair pass). A job whose dependency did not finish is **skipped**, not failed.
  An item that goes into the live course is placed *before* its job is marked done, and a placement
  failure (a deleted section, a structure lock) fails the job without a retry — regenerating the content
  would fail in the same place and pay twice.
  `CourseCopilotJobSkip` marks environment limits (no image provider, a video with no link, a library
  roleplay since unpublished) as skipped-with-a-reason rather than failures.
- **Budget.** At every job boundary, spend (summed from `llm_usage` by `courseCopilotSessionId`, images at
  a flat rate) is compared with `budgetUsd`; over the ceiling, queued jobs become `held` and a
  `budget_hold` event asks for a raise. `POST sessions/:id/budget` refuses a figure at or below spend and
  treats 0 as uncapped — the Builder contract.
- **Where results go.** During the first build, item content stays on the job and the course is rewritten
  from the approved blueprint (debounced 2 s) so items land in blueprint order; rows added in the editor
  meanwhile are kept. Once the build finishes (`metadata.buildCompletedAt`), a retried job is inserted
  into the live course next to its nearest blueprint sibling instead, so the trainer's later edits are
  never undone by a rewrite.

## Ids

`upsertStructure` refuses an id it did not create, so the copilot cannot write blueprint ids as track ids.
The first write creates rows without ids; `trackIdMap` records what the server assigned, by position;
every later write is an update of the same rows. Nothing is soft-deleted and recreated between jobs,
which matters because learner progress rows point at item ids.

## Confirmed actions

`publish_course`, `assign_to_tenants` and `duplicate_course` are confirmed **in code**: the tool raises a
question and stores `metadata.pendingConfirmation`; it only acts when the trainer's next message answers
that question id with `confirm`, and it acts on the stored input, not on whatever the model passes the
second time. Publishing runs the readiness checklist first and returns what is missing instead of asking.

## Learner access to generated roleplays

Verified 2026-10-14: a roleplay started from a course item is authorised by the learner's unlocked
progress row and the course's `track_tenants` row (`TrackProgressService.validateRoleplayStart`); the
`scenario_tenants` check applies only to standalone roleplays. So generated roleplays are ACTIVE (a course
may only reference active roleplays), non-global and unassigned, and assigning the course is enough.
They carry `category = 'COURSE_COPILOT'` so the library can filter them.

## Product analytics

Captured server-side through the global PostHog client (the admin console has none), keyed on the
admin's user id, properties limited to ids, counts and money — never brief text or course content:

| Event | When | Properties |
|---|---|---|
| `course_copilot.session_started` | A new session (CREATE or EDIT) | `session_id`, `mode`, `track_id` (EDIT) |
| `course_copilot.blueprint_approved` | Approve & build | `session_id`, `track_id`, `items`, `new_roleplays`, `minutes`, `estimate_usd` |
| `course_copilot.build_finished` | Every job settled, or the build was cancelled | `session_id`, `track_id`, `items`, `failed`, `skipped`, `usd`, `cancelled` |
| `course_copilot.course_published` | `publish_course` after the trainer confirmed | `session_id`, `track_id` |

## Local verification

`node scripts/course-copilot/e2e.mjs` drives a whole session against the local stack with the real
models: answers each question with its recommended option, fast-forwards after `MAX_QUESTIONS`, approves
the blueprint, polls the build to completion and prints the course, readiness and review. `SESSION=<id>`
resumes an existing session; `EDIT="…"` adds one edit-loop turn. Note the local dev server is
`nest start --watch` over this checkout and compiles specs too: editing backend files while a build runs
restarts the process (which is a fair test of resumption, but not what you want mid-demo), and a type
error in any spec takes the server down. Generated images upload to localstack but their URLs are built
in AWS form, so they do not render locally — the same as the course editor's own uploads.

## Configuration

| Env | Default | Notes |
|---|---|---|
| `COURSE_COPILOT_MODEL` / `COURSE_COPILOT_PROVIDER` | REASONING tier | Fallback only — set the model on the `course_copilot_interviewer_system` prompt row (Claude Sonnet recommended for tool-use reliability) |
| `COURSE_COPILOT_MAX_TOOL_ITERATIONS` | 10 | Per turn |
| `COURSE_COPILOT_SESSION_BUDGET_USD` | 15 | Per session; 0 = uncapped |
| `COURSE_COPILOT_IMAGE_COST_USD` | 0.10 | Flat per image |
| `COURSE_COPILOT_BUILD_CONCURRENCY` | 4 | |
| `OPENAI_IMAGE_MODEL` / `CHARACTER_IMAGE_DEFAULT_PROVIDER` + `LEARN_MEDIA_PUBLIC_S3_BUCKET` | — | Images are skipped with a reason without them |
| `COURSE_PILOT_STAGES` | true | Course Pilot stage machine (below), the Researcher and the B2/B3 transfer check; `false` turns them off |
| `COURSE_PILOT_CRITIC` | false | Course Pilot blueprint critic (below) |
| `COURSE_PILOT_ANSWER_CHECK` | true | Course Pilot quiz answer-key check (below); `false` turns it off |
| `ROLEPLAY_PILOT_STAGES` | true | Course Pilot stages for the roleplay interview (below); `false` turns it off |
| `CHARACTER_PILOT_STAGES` | true | Course Pilot stages for the character interview (below); `false` turns it off |

Limits (sections 20, items 100, items per section 30, new cases 2, images 12, languages per roleplay 4, two
active CREATE sessions per user) are in `constants/course-copilot.constants.ts` and enforced in code. New roleplays
have no limit of their own; the item limits and the session budget bound them.

## Course Pilot (behind switches)

Phases 1, 3, 4B and 5 of the Course Pilot architecture plan, each behind its own env switch. The
critic is off until turned on; the course stage machine (with the Researcher), the answer-key
check and the roleplay and character interviews' stages are on unless set to `false`.

- **Stage machine** (`COURSE_PILOT_STAGES`, `src/course-copilot/util/course-pilot-stages.util.ts`). The interview's
  stages live in code: intake → learners → outcomes and skill targets → assessment → time and
  language → final check → blueprint. The stage is *derived* from the brief (the first stage whose
  exit check fails), so changing an earlier answer simply puts the interview back in that stage.
  Each stage has its own tool belt and question limit (12 in the whole interview); `propose_blueprint`
  exists only after the trainer confirms the brief on a card code writes (`brief.final`; the
  confirmation is matched to a hash of what the card shows, so changing any of it reopens the
  check). State: `course_copilot_sessions.metadata.coursePilot` (questions per stage, the pending
  confirm card, the confirmed hash, stage history).
- **Researcher and knowledge per stage** (same switch, `src/course-copilot/service/specialists/researcher.specialist.ts`,
  prompt `course_copilot_researcher`). Each stage lists what it may read (files, Learning Design
  principles, learner profiles, example courses, learner results); its belt has one `research`
  tool instead of the raw reading tools. Code gathers snippets from that stage's sources in
  parallel and a fast model condenses them into a short pack, every point citing a snippet it was
  given (uncited points are dropped). Code runs it once when the interview enters a stage and
  hands the pack to the agent (`metadata.coursePilot.research`); after the confirm card, the brief
  is locked for that turn so the plan is built from what was confirmed. Lookups that return ids for the brief (learner profile and
  competency lists, languages, the roleplay library) stay on the belt.
- **Transfer check** (same switch, `src/course-copilot/util/course-pilot-transfer.util.ts`). Practice items carry
  `spec.transfer` (`practised` / `new-similar` / `new-harder`) and `spec.targetSkills`; a B2 skill
  target needs a `new-similar` practice and a B3 one a `new-harder` practice, each after a practised
  one. Told to the planner up front, checked in code, repaired once; shown to the trainer as a
  warning, never a block.
- **Length check** (same switch, `src/course-copilot/util/course-pilot-length.util.ts`). When the trainer gave
  a length, the plan must come within 10% of it (at least 2 minutes either way). Each item counts
  at no less than half its usual minutes, so shrinking estimates cannot pass it. Off-length plans
  get the planner's one repair, which is kept only if it has fewer problems and no new transfer
  problem; a plan still off is shown to the trainer with a plain note. What the planner's check
  found and whether the repair was kept: `metadata.coursePilot.planner`.
- **Blueprint critic** (`COURSE_PILOT_CRITIC`, `src/course-copilot/service/specialists/blueprint-critic.specialist.ts`, prompt
  `course_copilot_blueprint_critic`). A separate model checks each proposed plan against the brief
  and Learning Design principles; blocking findings get one planner repair round, kept only if it is
  no worse. Adds about 100 s per plan; its report is in `metadata.coursePilot.critic`.
- **Answer-key check** (`COURSE_PILOT_ANSWER_CHECK`, `src/course-copilot/service/specialists/answer-key-check.specialist.ts`,
  prompt `course_copilot_answer_key_check`). After the quiz writer, a second model answers every
  single-choice, multi-choice and true/false question without the key or explanations; code
  compares its answers with the key. Any disagreement, or a question it calls ambiguous, goes back
  to the writer as repair notes. On the repair pass a question still answered differently is
  dropped while at least half the quiz remains (otherwise the item summary says to check it). Other
  question types and scenario quizzes are not checked. A failed check never blocks the quiz.
- **Roleplay interview stages** (`ROLEPLAY_PILOT_STAGES`, `src/course-copilot/roleplay-interview/util/roleplay-pilot-stages.util.ts`).
  The roleplay chat's stages in code: learners and goal → competency and mode → client → practice
  details → plan, derived from the brief like the course stages. Question limits 2/2/2/3 (8 in
  all); a card for a later stage's field waits for that stage; propose_plan opens at practice
  details and is refused until difficulty, language and pass mark are in the brief (defaults are
  fine). No stored state: each question card is tagged with its stage and counted from the
  transcript.
- **Character interview stages** (`CHARACTER_PILOT_STAGES`, `src/scenario-character/util/character-pilot-stages.util.ts`).
  The character interview records what is settled as it goes (`record_character` →
  `character_interview_sessions.metadata.characterBrief`), and its stage is derived from that
  record: kind of character → identity → life → languages and voices → draft. Question limits
  2/3/3/3/1 (10 in all); save_character_draft opens only at the end, and the draft must carry
  every recorded language with its voice. Needs validated turns.
- **Stages tab** (platform admins only; `GET /v1/course-copilot/sessions/:id/stages`,
  `src/course-copilot/service/course-pilot-stages-report.service.ts`). Every stage of a session
  (interview stages, plan, build, course) with what happens there, the checks code ran, the
  Researcher's pack, and a timeline of questions, replies sent back to the agent and refused tool
  calls. Computed on request with the same functions the pipeline runs. Each assistant turn's row
  keeps `pilotStage`, `sentBack` (problem keys) and `refused` for it.
- **Evals** (`scripts/course-pilot-evals/`): `run.mjs` plays 10 fixed course requests end to end with
  a simulated trainer; `plan-eval.mjs` plans the same briefs with and without the critic or transfer
  check and scores them with an independent judge (`judge.mjs`); `manual-tests.mjs` runs test cases
  2-8 of the manual test plan; `roleplay-run.mjs` plays 8 roleplay requests (stages on vs off) and
  `roleplay-stage-test.mjs` checks one roleplay interview stage by stage. All need the local stack and the seeded test accounts.

## Departures from the plan (plans/course-copilot-plan.md)

- **Ids are mapped, not reused** — see "Ids". The plan assumed blueprint ids could become track ids.
- **Scenario category is an enum value** (`COURSE_COPILOT`), not the free text "Course Copilot":
  `scenarios.category` is `ScenarioCategory`.
- **No scenario co-assignment** on `assign_to_tenants` — outcome A of the plan's §7.4 check.
- **Images bypass the cover-image library service**: it files every image into the roleplay cover
  library and records usage with no session id, which the budget could not see.
- **A video without a link is a warning**, skipped at build time, not an approval blocker.
- **Creating a new case from chat** is not offered in release 1 (a case needs its roleplays to exist
  first); library cases can be added.
- **Design guidance and library search moved into the Context Library** (phase 7 of its plan,
  2026-11-09): the tools keep their names, but read Learning Design and the Content Catalogue instead
  of the retired third-party guidance service and the old substring search. Guidance lookups and
  library searches fail soft and say the library could not be searched, never that it is empty.
