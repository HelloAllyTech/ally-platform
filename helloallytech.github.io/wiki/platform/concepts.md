---
title: Core Concepts
tags: [platform, concepts, glossary, agents, reference]
summary: The vocabulary map of the platform — every core concept as a card (what it is, what it is made of, which code owns it, whether it is live and what gates it) plus the overloaded terms that trip agents up. CI keeps it complete.
last_reconciled: 2026-11-18
---

# Core Concepts

Read this before working in an area you don't know. It answers four questions per concept —
**what is it, what is it made of, where is its code, is it on** — and then sends you to the
page that goes deeper. It is a map, not a manual: data shapes live in
[DATA_SCHEMA](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md),
service internals in the [repo pages](../index.md#repositories), data flow in
[Architecture](architecture.md), counts in [Platform Stats](stats.md), and traps in
[Memory](../memory.md).

**Every module, package, page and feature directory in the monorepo is on a card or in
[Plumbing](#plumbing), and every `FeatureToggleKey` is named on a card.**
`scripts/concepts_lint.py` enforces both on every PR — see
[Keeping this page current](#keeping-this-page-current).

## How to read a card

| Field | Meaning |
|---|---|
| **Is** | One sentence: what it is and who it is for. |
| **Also called / Not to be confused with** | The names it goes by in UI and code, and the look-alikes. Read this line — most wrong turns start with a word that means two things. |
| **Composed of** | Its parts and the other concepts it depends on. |
| **Status** | Its lifecycle state **judged from the code on `master`**, then its gate. Not production state, and not release state — `master` is not live until tagged (see [Releases](#releases)). |
| **Code** | The directories that own it. A directory listed here is claimed by this concept. |
| **Deep doc** | Where to go next. "None yet" is a real gap. |

**Status values** — **Live**: reachable with defaults as shipped. **Dark**: merged but off by
default. **Partial**: some parts built, others explicitly not. **Deprecated**: still in code,
superseded. **Removed**: gone from code but the word still turns up.

**Gates come in five kinds**, and confusing them is a common bug:

| Gate | Scope | Where it lives |
|---|---|---|
| `FeatureToggleKey` | one platform admin | `admin_feature_toggles` rows; see [Admin feature toggle](#admin-feature-toggle) |
| Role permission | one user, via roles | `group_permissions`; see [Roles & permissions](#roles-and-permissions) |
| `PreferenceName` org preference | one organisation | `preference` rows, read fail-closed (absent = off) |
| `global_settings` / `*_settings` row | the whole platform or one subsystem | e.g. `builder_settings`, `pm_agent_settings`, `global_settings.ally_guide` |
| Env var | one deployment | `.env` / ECS-style env; usually a kill switch |

## Overloaded terms

The same word names different things in different places. When you meet one of these, find
out which meaning is in play before you change anything.

| Term | Meanings |
|---|---|
| **Skill** | a prompt in the [Skills Store](#skills-store) · an [AI Lab](#ai-lab) Skill (lab-only template) · the Studio "Skill Version" picker (a main-agent prompt variant) · a foundational [helping skill](#helping-skills) · an [Ally Guide](#ally-guide) skill · a [skill experiment](#auto-improve) · one of the five [SJT](#sjt) skills · a Claude Code skill (`.claude/skills/`) |
| **Track** | in the UI, "Tracks" = the legacy pathway ([Track](#track), code `scenario-path`) · in code, `track`/`tracks` = Track 2.0 = what the UI calls a [Course](#course) |
| **Simulation / Roleplay / Scenario** | the authored definition is a [Scenario](#scenario); one learner's run of it is a [Roleplay session](#roleplay-session); "Simulation Studio" is the [authoring hub](#simulation-studio) |
| **Session** | [Roleplay session](#roleplay-session) (`scenario_sessions`) · [Builder](#builder) session · [Course Copilot](#course-copilot) session · a sign-in session |
| **Chat** | ally-be `chat` = [Scribe](#scribe) sessions · `helpline` chats = the [Text helpline](#helpline) · `chatbot` = [Assistants](#assistants) · `ai-chat` = a model provider layer ([Model catalog](#model-catalog)) · text-chat roleplays ([Roleplay session](#roleplay-session)) |
| **Helpline** | `ally-helpline-dashboard` is the **whole** learner/counsellor web app (and the old `helpline-v*` tag) · the [Text helpline](#helpline) is one product inside it |
| **Builder** | the engineering [Builder](#builder) agent · ally-ai `builder` = the [Assistants](#assistants) onboarding guide · the Builder role in [Roadmap](#roadmap) v2 |
| **PM agent** | the product [PM Agent](#pm-agent) (ally-be `pm-agent`) · the [Debrief agent](#debrief-agent)'s own PM agent (ally-ai `pm_agent`) |
| **Guide** | the [Ally Guide](#ally-guide) tutor · the wiki's [Cross-Repo Agent Guide](agent-guide.md) (a doc for agents) |
| **Debrief** | today's [Debrief](#debrief) (live) · the [Debrief agent](#debrief-agent) family (dark). Two entities are both called `DebriefFeedback`: `debrief_feedback` vs `debrief_run_feedback` |
| **Review** | [Session review](#session-review) (human peers) · expert review in the [Debrief agent](#debrief-agent) console · PR review in [Builder](#builder) / [Bug Hunter](#bug-hunter) |
| **Counselor / client** | in roleplay code the **learner** is the counselor/helper (`counselorId`) and the AI is the client; in [Scribe](#scribe) the counsellor is a real practitioner |
| **Inbox** | the [Assistants](#assistants) conversation inbox — not bug reports ([Report a bug](#report-a-bug)) |
| **Community** | the leaderboard and practice streaks ([Badges, streaks & leaderboard](#badges-and-leaderboard)); on mobile, a link to an external site. There is no community feed |
| **Roadmap** | the internal [Roadmap](#roadmap) (opportunities, votes) · the public roadmap page ([Public content](#public-content)) |
| **Component Library** | course item templates ([Component Library](#component-library)) · not the admin DesignSystem page (a UI-kit gallery) |
| **Guardrail** | admin-managed [Conversational guardrails](#guardrails) · the branching instructions the ally-ai-learn docs also call guardrails ([Scenario event](#scenario-event)) |

## Learning product

### Tenant / Organisation
<!-- concept: tenant -->
**Is:** A customer organisation — the isolation boundary for users, sessions and data, and the unit content is assigned to.
**Also called:** organisation, org, `tenantId`, tenant `code` · **Not to be confused with:** cohorts (sub-groups inside one tenant); `groups` (RBAC roles); a test organisation (`isTestOrganization`, excluded from analytics). Some columns hold the tenant **code** (e.g. `preference.relatedId`) where others hold the uuid.
**Composed of:** `tenants` (unique code, status, branding). Content reaches a tenant through `*_tenants` joins for [Scenario](#scenario), [Case](#case), [Course](#course) and [Track](#track), then **cohorts** narrow it — their restriction rows only ever subtract. Org-level switches are `preference` rows. Tenants define custom fields on [Scribe](#scribe) notes; `places` is shared geo reference data. Branding is edited by the org admin in the learner app and served publicly by code.
**Status:** Live — gate: none; admin surfaces `FeatureToggleKey.USERS`, `FeatureToggleKey.ORG_DETAIL_CONTENT_TABS`
**Code:** `ally-be/src/tenant/` · `ally-be/src/cohort/` · `ally-be/src/custom-fields/` · `ally-be/src/place/` · `ally-web/apps/ally-admin-dashboard/src/pages/OrganizationDetail/` · `ally-web/apps/ally-helpline-dashboard/src/pages/org-branding/`
**Deep doc:** [DATA_SCHEMA §3.1](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md) · [Architecture](architecture.md)

### Roles & permissions
<!-- concept: roles-and-permissions -->
**Is:** Ally's RBAC: named roles carry permission strings, and ally-be guards check them on every route.
**Also called:** groups, `UserRole`, `roles[]`, permissions (`view:admin:…`), `allowedRoles` · **Not to be confused with:** cohorts; [Admin feature toggles](#admin-feature-toggle) (a per-admin layer on top); the single collapsed `role` the API also returns — it cannot represent a multi-role account, so gate on `roles[]` or permissions, never a role name.
**Composed of:** `groups` → `group_permissions` → `permissions`, plus `user_groups`. App roles LEARNER, COUNSELOR, CLIENT; `ADMIN` is a tenant's org admin; `PLATFORM_ADMIN` is Ally staff and replaced the old SUPER_ADMIN tiers (check `PLATFORM_TIER_ROLES`, not `SUPER_ADMIN_ROLES`); additive roles such as EVALUATOR, LISTENER, HELPLINE_SUPERVISOR, CLINICAL_ADVISOR, DEBRIEF_OWNER and the reviewer roles. Platform admins can be held to a tenant allowlist. Guards: `@AuthPermissions`, `@RequireFeatureToggle`, `@OrgScopedRoute`, `@PlatformWidePermissions`.
**Status:** Live — gate: none; managing admins needs `FeatureToggleKey.ADMIN_USER_MANAGEMENT`, the tenant allowlist `FeatureToggleKey.MULTI_TENANT_ALLOWLIST_MANAGEMENT`
**Code:** `ally-be/src/auth/` · `ally-be/src/authorization/` · `ally-be/src/common/constants/user.constants.ts`
**Deep doc:** [Login allowedRoles](login-allowed-roles.md) · [DATA_SCHEMA §3.1](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md)

### Admin feature toggle
<!-- concept: admin-feature-toggle -->
**Is:** A per-admin-user on/off switch that decides which admin-console surfaces one platform admin can reach — the fine-grained layer under the single `PLATFORM_ADMIN` role.
**Also called:** feature toggle, `FeatureToggleKey`, `admin_feature_toggles` · **Not to be confused with:** org preferences (`PreferenceName`), `global_settings` rows, env flags, permissions — see the gate table above.
**Composed of:** One registry, `admin-feature-toggle.constants.ts` (key, label, `defaultEnabled`, `platformOnly`, `orgScopedRoutesOnly`), served to ally-web from `GET /v1/authorization/feature-toggles/registry`. One row per (user, key); a missing row is off unless the key is `defaultEnabled`. Enforced by `FeatureToggleGuard` + `@RequireFeatureToggle` and by `requiredFeature` on admin routes — some keys are enforced only in ally-web. A new key stays off for existing admins unless a migration backfills it. Tenant ADMINs never hold toggles. `ally-be/src/settings/` holds the other two switch stores (global settings and org preferences). Two keys gate no feature: `FeatureToggleKey.OPERATIONAL_ADMIN_ACTIONS` fences cross-tenant bulk actions and AI-vs-AI test sessions; `FeatureToggleKey.SIDEBAR_HOVER_EXPAND` is a sidebar preference.
**Status:** Live — gate: holders of `FeatureToggleKey.ADMIN_USER_MANAGEMENT` edit others' toggles
**Code:** `ally-be/src/authorization/constants/admin-feature-toggle.constants.ts` · `ally-be/src/auth/guards/feature-toggle.guard.ts` · `ally-be/src/settings/`
**Deep doc:** none yet — the route-by-route map is pinned in `ally-be/src/authorization/constants/test/admin-tab-toggle-gates.spec.ts`

### User
<!-- concept: user -->
**Is:** A person with an Ally account, scoped to one [Tenant](#tenant): a learner, a counsellor, a tenant admin, or Ally staff.
**Also called:** learner, counsellor/counselor, helper, admin, "Ally admin" (platform staff) · **Not to be confused with:** a role — a user's "type" is just the roles it holds; anonymous helpline talkers and Guide visitors, who have no account.
**Composed of:** `users` (status, profile completion, terms acceptance, `lastActiveAt`), preferences and role memberships. Sign-in by OTP, magic link, Google or Apple, filtered by the client-supplied `allowedRoles`. Staff can impersonate. Suspended users land on a dedicated screen. User Management lists organisations and users; its "Ally admins" tab grants `PLATFORM_ADMIN` and edits [toggles](#admin-feature-toggle).
**Status:** Live — gate: none; admin tab `FeatureToggleKey.USERS` (defaultEnabled)
**Code:** `ally-be/src/user/` · `ally-web/apps/ally-admin-dashboard/src/pages/UserManagement/` · `ally-web/apps/ally-admin-dashboard/src/pages/SuperAdmins/` · `ally-web/apps/ally-admin-dashboard/src/pages/Login/` · `ally-web/apps/ally-admin-dashboard/src/pages/MagicLinkVerify/` · `ally-web/apps/ally-helpline-dashboard/src/pages/auth/` · `ally-web/apps/ally-helpline-dashboard/src/pages/magic-link-verify/` · `ally-web/apps/ally-helpline-dashboard/src/pages/impersonate/` · `ally-web/apps/ally-helpline-dashboard/src/pages/complete-profile/` · `ally-web/apps/ally-helpline-dashboard/src/pages/suspended-user/` · `ally-web/apps/ally-helpline-dashboard/src/pages/access-denied/` · `ally-mobile/lib/features/auth/` · `ally-mobile/lib/features/account/` · `ally-mobile/lib/features/suspended/`
**Deep doc:** [Login allowedRoles](login-allowed-roles.md) · [DATA_SCHEMA §3.1](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md)

### Scenario
<!-- concept: scenario -->
**Is:** An authored roleplay definition — the AI character, how it behaves, and what the learner practises. Learners run it as [Roleplay sessions](#roleplay-session).
**Also called:** simulation, roleplay, sim (UI "Roleplays"/"Simulations"; code `scenario`, module `learn`) · **Not to be confused with:** Roleplay Studio v2 / AgentV2 / `roleplay_specs` (Removed); a [Case](#case) or [Course](#course) that contains scenarios; a scenario report ([Scoring](#scoring)).
**Composed of:** A `scenarios` row (prompt, states, flags, difficulty, competencies) with per-language translations and trigger warnings; a library character (persona + one voice per language from the `scenario_voices` catalog); a cover image ([Image studio](#image-studio)); [Scenario events](#scenario-event) and behaviour instructions. Versioned DRAFT → PUBLISHED → ARCHIVED; the published version is copied into `scenarios`. Visible per tenant, narrowed by cohorts. `ally-be/src/learn/` is the catch-all module that also hosts competencies, configs and test cases.
**Status:** Live — gate: none for learners. Authoring: `FeatureToggleKey.CREATE_ROLEPLAYS`, `FeatureToggleKey.CHARACTER_LIBRARY`, `FeatureToggleKey.SCENARIO_VOICES`; tenant admins reach the character library only with the org preference `CHARACTER_LIBRARY_ENABLED`
**Code:** `ally-be/src/learn/` · `ally-be/src/scenario-character/` · `ally-be/src/scenario-cover-image-library/` · `ally-be/src/voice-preview/` · `ally-ai-learn/app/core/scenario/` · `ally-web/apps/ally-admin-dashboard/src/pages/CreateSimulation/` · `ally-web/apps/ally-admin-dashboard/src/pages/CharacterLibrary/` · `ally-web/apps/ally-admin-dashboard/src/pages/ScenarioVoices/` · `ally-web/apps/ally-helpline-dashboard/src/pages/learn/` · `ally-web/apps/ally-helpline-dashboard/src/pages/scenario/` · `ally-web/apps/ally-helpline-dashboard/src/pages/character-library/` · `ally-mobile/lib/features/simulations/`
**Deep doc:** [Scenario engine](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/09-scenario-engine.md) · [Scenario versioning smoke test](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/scenario-versioning-smoke-test.md) · [DATA_SCHEMA §3.2](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md)

### Scenario event
<!-- concept: scenario-event -->
**Is:** A detectable moment in a roleplay — a phrase, behaviour, timer or score condition — that, when it fires, scores the session, shows live feedback, steers the character or ends the session.
**Also called:** event, session event, detection, branching instruction (the steering kind) · **Not to be confused with:** behaviour instructions (a sibling detector scoring a flat ±10); NestJS emitter events; PostHog events; admin [Guardrails](#guardrails).
**Composed of:** `session_events` (the reusable library, admin Events tab) → `scenario_events` (attached to one [Scenario](#scenario)) → `scenario_session_events` (what fired). In ally-ai-learn each event has a detection type — sentence or semantic similarity, LLM binary classifier, time, score threshold, combination, utterance length / interruption / paraphrase, guardrail. Fired events commit scores ([Scoring](#scoring)); branching instructions inject text into the character's reply; termination events end the session.
**Status:** Live — gate: none; the library tab needs `FeatureToggleKey.EVENTS` (defaultEnabled)
**Code:** `ally-be/src/session-event/` · `ally-ai-learn/app/core/events/` · `ally-ai-learn/app/core/branching_instructions/` · `ally-web/apps/ally-admin-dashboard/src/pages/EventManagement/`
**Deep doc:** [Event system](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/03-event-system.md) · [Event types](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/04-event-types-reference.md) · [Branching instructions](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/10-branching-instructions.md)

### Roleplay session
<!-- concept: roleplay-session -->
**Is:** One learner's live practice conversation with a scenario's AI character, from room creation to end — voice by default, typed where enabled.
**Also called:** simulation, roleplay, scenario session (`scenario_sessions`) · **Not to be confused with:** an admin preview (a `preview-*` room, no session row); a scenario report run; an [Ally Guide](#ally-guide) voice session. In session code the learner is the "counselor" (`counselorId`) and the AI is the "client".
**Composed of:** ally-be creates a LiveKit room and dispatches the ally-ai-learn worker, which plays the [Scenario](#scenario) through the [Voice agent pipeline](#voice-agent-pipeline). Turns, fired [events](#scenario-event) and metrics return over SQS ([Queues](#queues-and-jobs)). Ending emits the completion event that drives [Scoring](#scoring), [Debrief](#debrief), [XP](#xp-and-levels) and course progress. Sweepers mark stranded sessions ABANDONED.
**Status:** Live — gate: none. Text chat needs the org preference `TEXT_CHAT_ROLEPLAY_ENABLED` plus the scenario's `textChatEnabled`; the session-log viewer needs `FeatureToggleKey.ROLEPLAY_SESSION_LOGS`
**Code:** `ally-be/src/livekit/` · `ally-be/src/roleplay-session-logs/` · `ally-web/apps/ally-helpline-dashboard/src/pages/simulation/` · `ally-web/apps/ally-admin-dashboard/src/pages/LiveSimulationPreview/` · `ally-web/apps/ally-admin-dashboard/src/pages/RoleplaySessionLogs/` · `ally-mobile/lib/features/roleplay/`
**Deep doc:** [Worker lifecycle](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/01-worker-lifecycle.md) · [Text-chat roleplays](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/text-chat.md) · [DATA_SCHEMA §3.3](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md)

### Scoring & scenario report
<!-- concept: scoring -->
**Is:** How a roleplay is scored and gated — plus two LLM judges that grade the AI character, not the learner.
**Also called:** session score, minimum score, completion logic, actor evaluation · **Not to be confused with:** [XP](#xp-and-levels), which never pays for score; the [Debrief](#debrief); [Session review](#session-review).
**Composed of:** **Session score** — the sum of fired [event](#scenario-event) and behaviour-instruction scores on `scenario_sessions.score`; unbounded and author-defined, so not comparable across scenarios. **Gates** — `meetsMinimumScore` (0 means no gate) serves [Course](#course) completion logic (score / duration / both / participation), [Track](#track) and [Case](#case). **Scenario report** — an admin-run simulated conversation between the character and an AI counsellor, judged on fixed metrics. **Actor evaluation** — judges the character in a real session against [agent test cases](#agent-testing).
**Status:** Live — gate: none
**Code:** `ally-ai-learn/app/core/scoring/` · `ally-ai-learn/app/core/scenario_report/` · `ally-ai-learn/app/core/scenario_session_evaluation/` · `ally-be/src/scenario-report/` · `ally-be/src/common/util/progression.util.ts`
**Deep doc:** [DATA_SCHEMA §3.4](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md)

### Session review
<!-- concept: session-review -->
**Is:** Human peer and supervisor review of a learner's roleplay or a counsellor's [Scribe](#scribe) session: the session is shared, reviewers comment on exact transcript lines in threads and react.
**Also called:** Review tab, shared for review, reactions, `scenario-session-reviews` / `scribe-session-reviews` · **Not to be confused with:** expert review in the [Debrief agent](#debrief-agent) console; the AI [Debrief](#debrief).
**Composed of:** A shared base in ally-be `review` (review → thread anchored to a transcript selection → comment → reaction, read status, access policy), specialised for [Roleplay sessions](#roleplay-session) and for Scribe chats. Reviewers hold SIMULATION_REVIEWER or SCRIBE_REVIEWER. Comments earn `PEER_COMMENT` [XP](#xp-and-levels) (with a substance floor and daily cap) and [badges](#badges-and-leaderboard); reactions earn badges only.
**Status:** Live — gate: permissions `VIEW_SIMULATION_REVIEWS` / `VIEW_SCRIBE_REVIEWS`
**Code:** `ally-be/src/review/` · `ally-be/src/scenario-session-review/` · `ally-be/src/scribe-session-review/` · `ally-web/apps/ally-helpline-dashboard/src/pages/review/` · `ally-web/apps/ally-helpline-dashboard/src/pages/review-details/` · `ally-mobile/lib/features/reviews/` · `ally-mobile/lib/features/reactions/`
**Deep doc:** [DATA_SCHEMA §3.6](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md)

### Debrief
<!-- concept: debrief -->
**Is:** The post-roleplay coaching feedback a learner reads beside the transcript — what went well, what to work on. This is what learners get today.
**Also called:** feedback, post-simulation summary, Debrief tab, "today's debrief" · **Not to be confused with:** the [Debrief agent](#debrief-agent) (the newer generator, Dark); a scenario report; live supervisor notes.
**Composed of:** At session end ally-be calls ally-ai `POST /api/v1/summary/scenario/evaluate` (AI task `scenario-evaluation`, prompt in the [Skills Store](#skills-store)) over the [Roleplay session](#roleplay-session) transcript. Learners rate it and comment (`debrief_feedback`). A scenario can hide its Debrief tab. For an organisation switched onto the Debrief agent, that agent's output fills the same tab.
**Status:** Live — gate: none
**Code:** `ally-be/src/debrief-feedback/` · `ally-ai/app/api/v1/endpoints/summary.py` · `ally-ai/app/core/summaries/` · `ally-web/apps/ally-helpline-dashboard/src/pages/post-simulation-summary/`
**Deep doc:** [Debrief Agent](debrief-agent.md)

### Debrief agent
<!-- concept: debrief-agent -->
**Is:** The multi-agent system built to write, check and improve each learner's debrief, with a console where clinical experts review results.
**Also called:** Debrief family, Debrief console (admin "Debriefs"), debrief graph, Ask Ally · **Not to be confused with:** today's [Debrief](#debrief); the product [PM Agent](#pm-agent) — ally-ai `pm_agent` is this family's own PM agent.
**Composed of:** ally-ai's LangGraph debrief graph (safety reader, analyst, guidance, writer, checks, evaluator) and optional orchestrator; Ask Ally, which answers learners' replies under a debrief; an independent quality judge ([Quality evals](#quality-evals)); expert verdicts from CLINICAL_ADVISOR holders; releases that pin [Skills Store](#skills-store) prompts and models; a PM agent proposing changes. ally-be (`debrief_runs` and related tables) is the system of record.
**Status:** Dark — gate: a per-organisation `live` override in `agent_config_overrides` (none by default) and env `DEBRIEF_AGENT_MODE` (`off` stops it). The console opens with `FeatureToggleKey.ANALYTICS`; `FeatureToggleKey.DEBRIEF_CLINICAL_SIGN_OFF` now only routes escalation notices despite its name; `FeatureToggleKey.DEBRIEF_SCHEDULES` controls job schedules
**Code:** `ally-be/src/debrief/` · `ally-ai/app/core/debrief/` · `ally-ai/app/core/debrief_graph/` · `ally-ai/app/core/ask_ally/` · `ally-ai/app/core/pm_agent/` · `ally-web/apps/ally-admin-dashboard/src/pages/Debriefs/`
**Deep doc:** [Debrief Agent](debrief-agent.md) · [Contract](https://github.com/HelloAllyTech/ally-platform/blob/master/docs/debrief-harness/CONTRACT.md)

### Case
<!-- concept: case -->
**Is:** A fixed, ordered set of roleplays a learner works through as one case, with a message at each step.
**Also called:** case (`cases`) · **Not to be confused with:** a scenario's "case card" on the learner app; "case memory" (a [Debrief agent](#debrief-agent) step); a helpline chat.
**Composed of:** `cases` → `case_items`, each a [Scenario](#scenario) with an order, optional message and minimum score; progress in `case_sessions`. Visible per [Tenant](#tenant) and cohort. Shares the score gate with [Track](#track) and [Course](#course), and can itself be an item inside a Course.
**Status:** Live — gate: none for learners; authoring needs `FeatureToggleKey.CREATE_CASES` (defaultEnabled)
**Code:** `ally-be/src/case/` · `ally-web/apps/ally-admin-dashboard/src/pages/CreateCase/` · `ally-web/apps/ally-helpline-dashboard/src/pages/case-track-details/`
**Deep doc:** [DATA_SCHEMA §3.5](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md)

### Track (legacy Learning Pathway)
<!-- concept: track -->
**Is:** The original ordered list of roleplays a learner works through, superseded by [Course](#course).
**Also called:** "Tracks" (Studio tab, "Create Track"), pathway, Learning Pathway, scenario path (code `scenario-path`, route `/pathway/:id`) · **Not to be confused with:** Track 2.0 (the `tracks` table), which is the [Course](#course).
**Composed of:** `scenario_paths` → `scenario_path_items` (each a [Scenario](#scenario)), visible per tenant; learner runs in `scenario_path_sessions`, gated by `meetsMinimumScore`. Shares the learner detail page with [Case](#case).
**Status:** Deprecated — gate: none for learners; the Studio's Create button shows only for the retired collapsed role `SUPER_DUPER_ADMIN`, so creation is effectively frozen
**Code:** `ally-be/src/scenario-path/` · `ally-web/apps/ally-admin-dashboard/src/pages/CreatePath/`
**Deep doc:** [DATA_SCHEMA §3.2](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md)

### Course
<!-- concept: course -->
**Is:** A structured learning programme a learner enrols in and completes in order — sections of mixed items: roleplays, cases, quizzes, articles, videos, journals, games and more.
**Also called:** Track 2.0 (code `track`, tables `tracks`/`track_*`), "Courses" in the UI · **Not to be confused with:** the legacy [Track](#track); the [Ally Guide](#ally-guide) journey through a course. Certification is planned, not in code.
**Composed of:** `tracks` → `track_sections` → `track_items` (ROLEPLAY → [Scenario](#scenario), CASE → [Case](#case)); enrolments with pre-created `track_item_progress` rows and sequential unlock; completion logic per roleplay item ([Scoring](#scoring)); quiz, journal and annotation attempts; translations; per-tenant and cohort visibility; a public share link with a story landing page; per-item discussions; reusable item templates ([Component Library](#component-library)).
**Status:** Live — gate: none for learners; authoring needs `FeatureToggleKey.CREATE_COURSES` (defaultEnabled)
**Code:** `ally-be/src/track/` · `ally-be/src/course-discussion/` · `ally-web/apps/ally-admin-dashboard/src/pages/CreateTrack/` · `ally-web/apps/ally-helpline-dashboard/src/pages/track-overview/` · `ally-web/apps/ally-helpline-dashboard/src/pages/track-player/` · `ally-web/apps/ally-helpline-dashboard/src/pages/track-progress/` · `ally-web/apps/ally-helpline-dashboard/src/pages/course-landing/` · `ally-mobile/lib/features/courses/`
**Deep doc:** [Course discussions](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/course-discussions.md) · [DATA_SCHEMA §3.2](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md)

### Simulation Studio
<!-- concept: simulation-studio -->
**Is:** The admin authoring hub — one library page with Simulations, Tracks, Cases and Courses tabs, where platform admins create, publish, archive and open each item's editor.
**Also called:** Studio, `/simulation-studio` · **Not to be confused with:** Roleplay Studio / Roleplay Studio v2 (Removed; the name survives in comments, migrations and permission names); a [Scenario](#scenario) itself.
**Composed of:** Lists from ally-be's `learn` admin endpoints. Per-admin toggles narrow it: `FeatureToggleKey.CONTENT_VIEW_ALL` off shows only the admin's own items; `FeatureToggleKey.CREATE_ROLEPLAYS`, `FeatureToggleKey.CREATE_CASES` and `FeatureToggleKey.CREATE_COURSES` control authoring per type. A new course can start in [Course Copilot](#course-copilot). Roleplay editors pick a main-agent prompt variant ("Skill Version") from the [Skills Store](#skills-store), a model, a voice and, when allowed, the [video actor](#video-actor).
**Status:** Live — gate: `FeatureToggleKey.CONTENT_MANAGEMENT`, enforced only in ally-web (no backend guard yet)
**Code:** `ally-web/apps/ally-admin-dashboard/src/pages/SimulationStudio/`
**Deep doc:** none yet

### Component Library
<!-- concept: component-library -->
**Is:** A global library of reusable course item templates (journal, quiz, article, video, annotated artifact) that course authors save, browse and insert.
**Not to be confused with:** the admin DesignSystem page (a UI-kit gallery, [Plumbing](#plumbing)); "theme" (consumer app styling).
**Composed of:** Templates served by the track module at `/v1/learn/admin/component-templates`, an admin page and a side panel; inserted as [Course](#course) items.
**Status:** Live — gate: `FeatureToggleKey.COMPONENT_LIBRARY` (per-admin grant)
**Code:** `ally-web/apps/ally-admin-dashboard/src/pages/ComponentLibrary/` · `ally-be/src/track/controller/track-component-template.controller.ts`
**Deep doc:** none yet

### Course Copilot
<!-- concept: course-copilot -->
**Is:** An admin agent that interviews a trainer, proposes a blueprint and, once approved, generates a whole draft [Course](#course) — then keeps editing it on request.
**Also called:** copilot, copilot session, blueprint · **Not to be confused with:** the removed Roleplay Studio v2 copilot (`copilot_sessions`); [Builder](#builder); the character interview agent.
**Composed of:** A session state machine (interviewing → awaiting blueprint → building → editing) with append-only messages, background jobs and specialist generators (articles, quizzes, journals, annotated transcripts, games, roleplays), running on ally-be's agent harness (`llm-agent`, see [Model catalog](#model-catalog)). Cover images reuse [Image studio](#image-studio). Its model calls are rows in the [AI task registry](#ai-task-registry).
**Status:** Live — gate: `FeatureToggleKey.COURSE_COPILOT` (backfilled on for existing platform admins; new admins start off) plus permission `edit:admin:course-copilot`
**Code:** `ally-be/src/course-copilot/` · `ally-web/apps/ally-admin-dashboard/src/pages/CourseCopilot/`
**Deep doc:** [Course Copilot](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/course-copilot.md)

### Ally Guide
<!-- concept: ally-guide -->
**Is:** Ally as a conversational tutor that walks a learner, or a signed-out visitor, through a course by chat or voice at `/journey/:trackId`; operated from the Ally Console.
**Also called:** Ally, guided course, journey, Ally Console (its admin page) · **Not to be confused with:** Ask Ally ([Debrief agent](#debrief-agent)); "Ally admins" (platform staff); the wiki's [Cross-Repo Agent Guide](agent-guide.md); [Assistants](#assistants).
**Composed of:** ally-be `guide` — conductor, tools, learner memories, visitor chat, outreach, per-organisation crisis lines, releases — working over a [Course](#course) and its `guideNotes`. `guide-learning` is the guide's own eval, shadow-run and canary loop. ally-ai-learn's guide worker handles speech in and out only; ally-be writes every reply. The Ally Console is one tabbed admin page: monitoring, releases and rollback, canaries, evals, playground, configuration, crisis copy, per-turn traces.
**Status:** Dark — gate: the `global_settings` row `ally_guide` (`enabled`, `anonymousChat`, `voice` all default false; per-tenant and per-course deny lists); anything short of a clear yes falls back to the classic course. Console: `FeatureToggleKey.ALLY_GUIDE`; learner transcripts `FeatureToggleKey.ALLY_GUIDE_TRANSCRIPTS` (per person); organisation settings `FeatureToggleKey.ALLY_GUIDE_ORG`
**Code:** `ally-be/src/guide/` · `ally-be/src/guide-learning/` · `ally-ai-learn/app/core/guide/` · `ally-ai-learn/app/guide_worker.py` · `ally-web/apps/ally-helpline-dashboard/src/pages/guided-course/` · `ally-web/apps/ally-admin-dashboard/src/pages/AllyConsole/`
**Deep doc:** [Guide voice worker](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/guide-voice-worker.md) · [DATA_SCHEMA §3.20](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md)

### XP & levels
<!-- concept: xp-and-levels -->
**Is:** A learner's effort points and level ladder, shown on the Progress dashboard and a level indicator in the nav.
**Also called:** Progress, progress ladder, level · **Not to be confused with:** the session score ([Scoring](#scoring)), which XP deliberately never pays for; course progress (`track_item_progress`); "L1 certified" (a retired chart).
**Composed of:** An append-only `xp_events` ledger, idempotent on (user, tenant, rule, source), rolled up into `user_progress`. Rules pay for practice minutes, session completion and daily depth, [Course](#course) item completion, engaging with a debrief, peer comments ([Session review](#session-review)) and weekly consistency, with daily caps. The ladder is a hand-written table; each level reached awards a [badge](#badges-and-leaderboard).
**Status:** Dark — gate: org preference `PROGRESS_DASHBOARD_ENABLED` (absent = off). XP is recorded for every learner regardless
**Code:** `ally-be/src/progress/` · `ally-web/apps/ally-helpline-dashboard/src/pages/progress/` · `ally-mobile/lib/features/progress/`
**Deep doc:** [DATA_SCHEMA §3.7](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md)

### Badges, streaks & leaderboard
<!-- concept: badges-and-leaderboard -->
**Is:** The engagement rewards learners see — earned badges ("achievements"), practice-day streaks and a per-tenant leaderboard.
**Also called:** achievements, Community tab (on web, `/community` *is* the leaderboard) · **Not to be confused with:** a community feed (none exists); the mobile Community tab (only a link to an external site); [XP & levels](#xp-and-levels).
**Composed of:** A global badge catalog targeted by role group and tenant, auto-awarded by category (simulation minutes, active-day streak, comments and reactions, XP level). ally-be `community` ranks the leaderboard by XP over week/month/year windows from `user_daily_scores`, computes practice streaks and sends streak-at-risk emails directly through SES (not via [Notifications](#notifications)).
**Status:** Live — gate: leaderboard permission `VIEW_LEADERBOARD`; the badge catalog admin needs `FeatureToggleKey.USER_BADGES`
**Code:** `ally-be/src/badge/` · `ally-be/src/community/` · `ally-web/apps/ally-admin-dashboard/src/pages/UserBadges/` · `ally-web/apps/ally-helpline-dashboard/src/pages/leaderboard/` · `ally-web/apps/ally-helpline-dashboard/src/pages/achievements-view-all/` · `ally-mobile/lib/features/leaderboard/` · `ally-mobile/lib/features/achievements/` · `ally-mobile/lib/features/community/`
**Deep doc:** [DATA_SCHEMA §3.7](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/DATA_SCHEMA.md)

## Counselling & public product

### Scribe
<!-- concept: scribe -->
**Is:** The counsellor's tool for real sessions: it records or ingests a counselling session, transcribes it, and drafts a structured note the counsellor checks and saves.
**Also called:** Ally Assist (marketing), Scribe Logs, call log, `chat`/`chats` + `call_details` in code, dictation, voice note · **Not to be confused with:** [Text helpline](#helpline) chats; [Assistants](#assistants) (`chatbot`); the `calls` page also renders Roleplay Logs.
**Composed of:** ally-be `chat` (calls, messages, notes with merge-based summary writes, live nudges), `audio` (encrypted uploads) and `audio-ingest` (cloud-telephony audio); note fields come from two systems — built-in sections and per-org custom fields ([Tenant](#tenant)). ally-ai `transcriptions` (multi-provider STT and diarisation), `summaries`, `conversations` (nudge and stage detection) and `note_harness` (Scribe v2, shadow only). Prompts live in the [Skills Store](#skills-store). Ending a recording offers a [Wellbeing](#wellbeing) exercise.
**Status:** Live — gate: role permissions (`CALL_PERMISSIONS`, `VIEW_CALL_LOGS`); org preferences `SCRIBE_NOTE_CREATION_ENABLED`, `SCRIBE_VOICE_NOTE_ENABLED`, `SCRIBE_NOTE_HARNESS_SHADOW_ENABLED` each off when absent
**Code:** `ally-be/src/chat/` · `ally-be/src/audio/` · `ally-be/src/audio-ingest/` · `ally-ai/app/core/transcriptions/` · `ally-ai/app/core/summaries/` · `ally-ai/app/core/conversations/` · `ally-ai/app/core/note_harness/` · `ally-web/apps/ally-helpline-dashboard/src/pages/audio-call/` · `ally-web/apps/ally-helpline-dashboard/src/pages/calls/` · `ally-web/apps/ally-helpline-dashboard/src/pages/post-call-summary/` · `ally-mobile/lib/features/scribe/` · `ally-mobile/lib/features/calllog/`
**Deep doc:** [Scribe summary writes](scribe-summary-writes.md) · [Scribe v2 design](https://github.com/HelloAllyTech/ally-platform/blob/master/docs/scribe-v2/DESIGN.md)

### Text helpline
<!-- concept: helpline -->
**Is:** An anonymous web chat connecting a member of the public (the "talker") to an organisation's trained human listeners, with an AI copilot that assists listeners but never writes to talkers.
**Also called:** Helpline tab, listener workspace, `/talk/:tenantCode` · **Not to be confused with:** `ally-helpline-dashboard` (the whole web app); text-chat roleplays; recorded sessions in [Scribe](#scribe).
**Composed of:** ally-be `helpline` — chats, claims, presence, supervision (monitor, whisper, transfer), QA scores, risk flags, retention, separate talker and staff socket rooms — and `queue` (the waiting-talker queue, not SQS). ally-ai `helpline` is a stateless, fail-open copilot (risk classifier, suggestion and nudge drafts). Adds the LISTENER and HELPLINE_SUPERVISOR roles. Settings are an org preference merged over code defaults.
**Status:** Dark — gate: org preference `TEXT_HELPLINE_ENABLED` (absent = off, set by platform admins); fails closed on every listener route and the socket handshake
**Code:** `ally-be/src/helpline/` · `ally-be/src/queue/` · `ally-ai/app/core/helpline/` · `ally-web/apps/ally-helpline-dashboard/src/pages/helpline/` · `ally-web/apps/ally-helpline-dashboard/src/pages/helpline-talk/`
**Deep doc:** [Text helpline build contract](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/text-helpline.md)

### SJT (situational judgement test)
<!-- concept: sjt -->
**Is:** A public, sign-in-free self-check on how a teacher should respond to a struggling student, plus a standalone readiness report for school leadership.
**Also called:** `/SJT1`, `/SJT1/edit`, `/sjtreport1`, "the five SJT skills" · **Not to be confused with:** [Helping skills](#helping-skills) or roleplay [Scoring](#scoring) — SJT has its own items, scoring and bands.
**Composed of:** Frontend only: scenario items, a scoring module, and a copy model addressed by path. Progress and copy edits stay in the browser's localStorage; edits reach the shared page only by being exported and committed. The report computes per-skill stats from sample data or a CSV read in the browser, with a minimum group size.
**Status:** Live — gate: none (public routes, linked from nowhere, shared as links; no backend)
**Code:** `ally-web/apps/ally-helpline-dashboard/src/pages/sjt/` · `ally-web/apps/ally-helpline-dashboard/src/pages/sjt-report/`
**Deep doc:** none yet

### Wellbeing tools
<!-- concept: wellbeing -->
**Is:** A short self-care exercise for counsellors right after a real session — a guided box-breathing pacer with calming messages.
**Also called:** Stress Buster (web), box breathing (mobile) · **Not to be confused with:** comfort audio (ambient room tone in voice roleplays, [Voice agent pipeline](#voice-agent-pipeline)); the breathing item in courses.
**Composed of:** Client-only screens: the web `stress-buster` page and the mobile `boxbreathing` feature (pacer, breath sounds, call-end overlay). Both open when a [Scribe](#scribe) recording ends.
**Status:** Live — gate: permission `CALL_PERMISSIONS` (same as Scribe recording)
**Code:** `ally-web/apps/ally-helpline-dashboard/src/pages/stress-buster/` · `ally-mobile/lib/features/boxbreathing/`
**Deep doc:** none yet

### Helping skills & competencies
<!-- concept: helping-skills -->
**Is:** The vocabulary for what a learner is getting better at: foundational helping skills, measured passively from roleplay transcripts, and the authored competency library that scenarios and courses are tagged with.
**Also called:** FHS, foundational helping skills, competencies, clusters, behaviours · **Not to be confused with:** every other "skill" — see [Overloaded terms](#overloaded-terms).
**Composed of:** `foundational-skills` holds the rubric (the code copy wins over the doc); a scheduled LLM judge ticks behaviours, with quoted evidence, on slices of the learner's speech, and code derives levels 1–4. It also has a benchmark, human ratings and an unused self-assessment API. Competencies, behaviours and clusters live in ally-be `learn`; the seeded competencies deliberately differ from the rubric.
**Status:** Live — gate: env `FOUNDATIONAL_SKILLS_SCHEDULE` (on unless set off); the Competencies tab needs `FeatureToggleKey.COMPETENCIES`
**Code:** `ally-be/src/foundational-skills/` · `ally-web/apps/ally-admin-dashboard/src/pages/Competencies/`
**Deep doc:** [Foundational helping skills](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/foundational-helping-skills.md)

### Knowledge base & reference documents
<!-- concept: knowledge-base -->
**Is:** Two libraries of vetted documents: the Knowledge Base, the corpus [Assistants](#assistants) answer from, and Reference Documents, resources counsellors search.
**Also called:** KB, corpus `whatsapp_qa`, Weaviate `KnowledgeChunk` / `ReferenceDocument`, Search tab, resources · **Not to be confused with:** the [Context Library](#context-library), which took over the KB's former character, guide and debrief corpora.
**Composed of:** ally-be `knowledge-base` runs upload → extract → chunk → index over SQS; Postgres is the system of record and vectors are derived ([Retrieval](#retrieval)); documents are archived, never deleted; per-document organisation targeting is enforced at search. ally-ai `knowledge_base` maps corpus → collection and `knowledge_agent` translates, then answers grounded or declines. Reference documents (`reference-document` + `reference_documents`) are uploaded by CSV and searched semantically.
**Status:** Live — gate: `FeatureToggleKey.KNOWLEDGE_BASE`; reference search needs permission `VIEW_REFERENCE_DOCUMENT`. On web, search sits in the Scribe call sidebar (the `/search` route is unlinked); on mobile it is a tab
**Code:** `ally-be/src/knowledge-base/` · `ally-be/src/reference-document/` · `ally-ai/app/core/knowledge_base/` · `ally-ai/app/core/knowledge_agent/` · `ally-ai/app/core/reference_documents/` · `ally-web/apps/ally-helpline-dashboard/src/pages/search/` · `ally-mobile/lib/features/search/`
**Deep doc:** [ally-be](../repos/ally-be.md) · [ally-ai](../repos/ally-ai.md)

### Language & translation
<!-- concept: language -->
**Is:** What lets Ally run in several languages: the language registry roleplays run in, an auto-maintained glossary that sets the voice agent's register, translated app copy and in-app help text, and on-demand transcript translation.
**Also called:** Scenario Languages, language glossary, variety profile, Translations, dynamic i18n, Tooltips · **Not to be confused with:** language-quality evals ([Quality evals](#quality-evals)); the repos' static `i18n/locales` files — the published bundle overrides them at runtime.
**Composed of:** ally-be `language` — `languages` rows (`llmConfigId` is one step of [model resolution](#ai-task-registry)) and glossary sections compiled into the agent prompt, maintained by scheduled mining/consolidation/adjudication jobs. `dynamic-i18n` publishes immutable versioned bundles with rollback. `transcript-translation` caches per-message translations of roleplay transcripts. `tooltip` holds help text keyed by location. Indic text matching needs the `\p{M}` mark class.
**Status:** Live — gate: `FeatureToggleKey.MANAGE_SCENARIO_LANGUAGES` (languages, glossary), `FeatureToggleKey.TRANSLATIONS`, `FeatureToggleKey.MANAGE_TOOLTIPS`; glossary jobs per `GLOSSARY_*_SCHEDULE` env
**Code:** `ally-be/src/language/` · `ally-be/src/dynamic-i18n/` · `ally-be/src/transcript-translation/` · `ally-be/src/tooltip/` · `ally-web/apps/ally-admin-dashboard/src/pages/LanguageManagement/` · `ally-web/apps/ally-admin-dashboard/src/pages/LanguageGlossary/` · `ally-web/apps/ally-admin-dashboard/src/pages/TranslationManagement/` · `ally-web/apps/ally-admin-dashboard/src/pages/Tooltips/`
**Deep doc:** [Language glossary v2](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/language-glossary-v2-design.md) · [Dynamic i18n](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/dynamic-i18n.md)

### Assistants
<!-- concept: assistants -->
**Is:** Configurable AI assistants that an organisation sets up to answer people over WhatsApp, a public chat page (`/b/<slug>`) or a website widget, grounded in its own documents.
**Also called:** Assistants (UI), WhatsApp bot (toggle key `whatsapp_bot`), AI Chatbots (v1), Agents v2, `chatbot`, bot draft, checkup, onboarding builder · **Not to be confused with:** the [Ally Guide](#ally-guide); [Scribe](#scribe) `chat`; the [Text helpline](#helpline), where humans answer; the engineering [Builder](#builder).
**Composed of:** ally-be `chatbot` — a channel-agnostic engine running access, consent, crisis and kill-switch checks, plus conversation store, inbox, memory and tool gateway; `whatsapp` registers the channel and maps phone → organisation for corpus targeting; `bot-draft` drives agent-led onboarding and checkups. v1 answers through the [Knowledge base](#knowledge-base) agent; v2 runs ally-ai's `agent_runtime` LangGraph loop and falls back to v1 on failure. ally-ai `builder` is the onboarding guide, `memory_lines` filters per-person memory, `checkup` grades a bot. Dev-only fixture pages exist under `Dev*`.
**Status:** Partial — gate: `FeatureToggleKey.WHATSAPP_BOT` (create and list; a bot's team members don't need it). v1 is Live; the v2 runtime is Dark behind `agentRuntimeAllowed` (default false) and still being built in chunks
**Code:** `ally-be/src/chatbot/` · `ally-be/src/whatsapp/` · `ally-be/src/bot-draft/` · `ally-ai/app/core/agent_runtime/` · `ally-ai/app/core/builder/` · `ally-ai/app/core/memory_lines/` · `ally-ai/app/core/checkup/` · `ally-web/apps/ally-admin-dashboard/src/pages/WhatsAppBot/` · `ally-web/apps/ally-admin-dashboard/src/pages/AssistantHome/` · `ally-web/apps/ally-admin-dashboard/src/pages/DevAssistantHome/` · `ally-web/apps/ally-admin-dashboard/src/pages/DevV2Components/` · `ally-web/apps/ally-admin-dashboard/src/pages/Inbox/` · `ally-web/apps/ally-admin-dashboard/src/pages/DevInbox/` · `ally-web/apps/ally-admin-dashboard/src/pages/Onboarding/` · `ally-web/apps/ally-admin-dashboard/src/pages/DevOnboarding/`
**Deep doc:** [Agents v2 context](https://github.com/HelloAllyTech/ally-platform/blob/master/docs/agents-v2/CONTEXT.md) · [ally-be](../repos/ally-be.md)

### Public content channels
<!-- concept: public-content -->
**Is:** The signed-out pages Ally publishes to anyone: blog, product-updates feed, changelog, public roadmap, legal pages, and a trial conversational homepage.
**Also called:** `/blog`, `/blog/changelog`, `/blog/roadmap`, `/terms`, `/privacy`, `/v2` (home-v2) · **Not to be confused with:** the internal [Roadmap](#roadmap); the `ally-changelog` repo file vs Product Updates (plain-language entries an LLM writes from merges).
**Composed of:** ally-be `blog` (drafts, sanitised HTML, public reads by slug); `product-updates` (a scheduled pipeline: merge journal → sources → LLM consolidation → publish, plus a digest; admins can correct or hide entries); `changelog` (parses the changelog repo's file, with a code-activity heatmap); `public-roadmap` (hand-written cards). Legal text and roadmap cards are edited in admin Settings. home-v2 is scripted, with no model call.
**Status:** Live — gate: `FeatureToggleKey.BLOG`, `FeatureToggleKey.PRODUCT_UPDATES` (both defaultEnabled), `FeatureToggleKey.SETTINGS` for the legal and roadmap editors; the product-updates pipeline needs env `PRODUCT_UPDATES_ENABLED=true` (default false); home-v2 is Dark (unlinked)
**Code:** `ally-be/src/blog/` · `ally-be/src/product-updates/` · `ally-be/src/changelog/` · `ally-be/src/public-roadmap/` · `ally-web/apps/ally-admin-dashboard/src/pages/Blog/` · `ally-web/apps/ally-admin-dashboard/src/pages/ProductUpdates/` · `ally-web/apps/ally-admin-dashboard/src/pages/Privacy/` · `ally-web/apps/ally-admin-dashboard/src/pages/Terms/` · `ally-web/apps/ally-admin-dashboard/src/pages/Settings/` · `ally-web/apps/ally-helpline-dashboard/src/pages/blog/` · `ally-web/apps/ally-helpline-dashboard/src/pages/legal/` · `ally-web/apps/ally-helpline-dashboard/src/pages/home-v2/`
**Deep doc:** [ally-changelog](../repos/ally-changelog.md)

### Notifications
<!-- concept: notifications -->
**Is:** How Ally tells users something happened while they were away: an in-app feed and mobile push, with email and Slack through the same module.
**Also called:** notification feed, bell, device tokens, FCM push, engagement reminder · **Not to be confused with:** product-updates digest emails; the streak emails ([Badges](#badges-and-leaderboard), sent via SES directly).
**Composed of:** ally-be `notification` — `in_app_notifications` (unread count, read-all), `user_device_tokens`, data-only FCM push that prunes dead tokens, SES email and Slack. Writers include `engagement-reminder` (an hourly inactivity nudge with a cooldown), course-discussion replies, debrief escalations, Ally Guide outreach and helpline alerts.
**Status:** Live — gate: none for the feed; push is off unless env `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` is set
**Code:** `ally-be/src/notification/` · `ally-be/src/engagement-reminder/` · `ally-mobile/lib/features/notifications/`
**Deep doc:** none yet

## AI platform

### Skills Store
<!-- concept: skills-store -->
**Is:** ally-be's versioned store of every prompt the platform runs, edited by admins in the Skills Store tab and by engineers with the `prompts` CLI.
**Also called:** System Skills (old name), Prompt Management, `prompts` tables, "skill" · **Not to be confused with:** every other "skill" — see [Overloaded terms](#overloaded-terms).
**Composed of:** Each prompt code has immutable versions (text + provider/model/temperature), translations, and a contract declared in code. A new version is a draft and serves nothing until published. A service's `.txt` is only the default that seeds the prompt on first deploy and the fallback for an unknown code — **editing the `.txt` changes nothing that runs**. All three services resolve the live version at runtime, and each session records the version and hash it used. [Auto-improve](#auto-improve) runs on top of it.
**Status:** Live — gate: `FeatureToggleKey.PROMPTS` (defaultEnabled)
**Code:** `ally-be/src/prompt/` · `ally-be/src/prompts/` · `ally-web/apps/ally-admin-dashboard/src/pages/PromptManagement/` · `ally-ai/app/prompts/` · `ally-ai-learn/app/prompts/` · `scripts/prompts/prompts.mjs`
**Deep doc:** [Adding a prompt](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/adding-a-prompt.md) · [Prompts API](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/prompts-api.md) · [Skills Store design](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/skills-store-design.md)

### AI task registry & model resolution
<!-- concept: ai-task-registry -->
**Is:** The in-code list of every platform action that calls a model — completion, embedding, transcription, speech, image — and the model that serves it by default. **Adding, removing or re-pointing a model call means updating its row in the same change.**
**Also called:** AI Tasks tab, `AI_TASK_REGISTRY`, `LlmTask` · **Not to be confused with:** the [Model catalog](#model-catalog) (which models exist); `llm_usage` (what calls actually spent).
**Composed of:** One row per call site with a distinct purpose, keyed to an `LlmTask` label that each service's `llm_usage` emitter records; served at `GET /v1/llm/tasks`. A jest guard fails on an `LlmTask` without a row; `.docs-map.yml` fails a PR touching an LLM call site without the registry. Models listed are defaults: at request time a model resolves code default → `languages.llmConfigId` → `prompts.model` → request/simulation override (later wins). Tiered ally-be rows resolve instead explicit argument → prompt row → `fast`/`reasoning` platform tier → compiled floor.
**Status:** Live — gate: `FeatureToggleKey.AI_TASKS` (frontend only; the endpoint checks language permissions)
**Code:** `ally-be/src/llm/` · `ally-be/src/llm/constants/ai-task-registry.constants.ts` · `ally-be/src/llm/constants/llm-tier.constants.ts` · `ally-web/apps/ally-admin-dashboard/src/pages/AiTasks/` · `ally-ai/app/core/llm_usage/` · `ally-ai-learn/app/core/llm_usage/`
**Deep doc:** [The AI task registry](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/ai-task-registry.md) · [Per-prompt LLM config ADR](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/prompt-llm-config-standardization-adr.md)

### Model catalog & providers
<!-- concept: model-catalog -->
**Is:** The admin-managed lists of which language models and speech-recognition setups the platform may use, and the provider clients and preview endpoints that exercise them.
**Also called:** Language Model Catalog, Speech Recognition, Providers, `llm_models`, `llm_configs`, `stt_configs` · **Not to be confused with:** the [AI task registry](#ai-task-registry) (which call uses which model); the voices catalog ([Scenario](#scenario)).
**Composed of:** `llm_models` (one row per model); `llm_configs` (a model + temperature choice a language points at via `languages.llmConfigId`); `stt_configs` (speech recognition per language). LLM preview checks a model answers; voice preview plays TTS samples. Three provider layers send a resolved model to OpenAI, Anthropic or Gemini: ally-be `ai-chat` (text-roleplay chat), ally-be `llm-agent` (the agent harness used by Guide, Builder, Course Copilot, PM Agent and others) and ally-ai `llm`.
**Status:** Live — gate: `FeatureToggleKey.MANAGE_LLM_MODEL_CATALOG` · `FeatureToggleKey.MANAGE_STT_CONFIGS`; the combined Providers page is built but unrouted (Dark)
**Code:** `ally-be/src/llm-agent/` · `ally-be/src/llm-preview/` · `ally-be/src/ai-chat/` · `ally-ai/app/core/llm/` · `ally-web/apps/ally-admin-dashboard/src/pages/LlmModelCatalog/` · `ally-web/apps/ally-admin-dashboard/src/pages/SttConfigs/` · `ally-web/apps/ally-admin-dashboard/src/pages/Providers/`
**Deep doc:** [LLM providers](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/07-llm-providers.md) · [STT providers](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/06-stt-providers.md) · [TTS providers](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/05-tts-providers.md)

### Voice agent pipeline
<!-- concept: voice-agent-pipeline -->
**Is:** The ally-ai-learn LiveKit worker that plays the simulated client in a voice roleplay — learner speech in, one LLM turn, reply out as speech, in real time.
**Also called:** the actor / AI actor, roleplay agent, `AgentWorker` · **Not to be confused with:** the [Ally Guide](#ally-guide) voice worker (`guide-` rooms).
**Composed of:** The worker joins a room ally-be's `livekit` module created ([Roleplay session](#roleplay-session)). Provider factories (`app/stt`, `app/tts`, `app/llms`) pick providers per language; semantic end-of-utterance detection decides when the learner has finished. Each turn is a LangGraph graph: process [events](#scenario-event) → resolve branching instruction → generate reply. Around it: fillers and openers, the Stage Director or client working memory (chosen by the scenario's main prompt), live Supervisor notes, per-turn metrics, language-matched fallback lines on LLM timeout, emergency finalize, and comfort audio (ambient room tone).
**Status:** Live — gate: none; Supervisor notes need the per-scenario `supervisorNotesEnabled` (default off); env `SEMANTIC_TURN_DETECTION_ENABLED` is a kill switch (default on)
**Code:** `ally-ai-learn/app/core/agent/` · `ally-ai-learn/app/core/graph/` · `ally-ai-learn/app/core/livekit/` · `ally-ai-learn/app/core/stage_director/` · `ally-ai-learn/app/core/supervisor/` · `ally-ai-learn/app/core/working_memory/` · `ally-ai-learn/app/core/metrics/` · `ally-ai-learn/app/core/diagnostics.py` · `ally-ai-learn/app/llms/` · `ally-ai-learn/app/stt/` · `ally-ai-learn/app/tts/` · `ally-ai-learn/app/worker.py` · `ally-be/src/comfort-audio/`
**Deep doc:** [Architecture](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/architecture.md) · [Graph pipeline](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/02-graph-pipeline.md) · [ally-ai-learn](../repos/ally-ai-learn.md)

### Conversational guardrails
<!-- concept: guardrails -->
**Is:** Admin-managed boundaries for voice roleplays: when the learner says something that crosses one, the simulated client gives a set response instead of improvising.
**Also called:** Guardrails, `conversational_guardrails`, Coherence Guard · **Not to be confused with:** branching instructions ([Scenario event](#scenario-event)); the [Assistants](#assistants) crisis check; the [Image studio](#image-studio) safety screen.
**Composed of:** Each guardrail has a trigger (`helperDialogue`), the client's response (`actorDialogue`), a kind — USER (admin-managed, sampled per session) or SYSTEM (always injected) — and a detector (CATEGORY, or COHERENCE for gibberish and mis-transcribed speech; the STT Coherence Guard cannot be disabled). In the [Voice agent pipeline](#voice-agent-pipeline) each becomes a `GuardrailEvent`; a hit injects `actorDialogue` as the branching instruction.
**Status:** Live — gate: `FeatureToggleKey.MANAGE_GUARDRAILS` (the admin screen)
**Code:** `ally-be/src/conversational-guardrails/` · `ally-web/apps/ally-admin-dashboard/src/pages/GuardrailsManagement/` · `ally-ai-learn/app/core/events/coherence_guard.py`
**Deep doc:** [Event system](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/03-event-system.md)

### Retrieval & embeddings
<!-- concept: retrieval -->
**Is:** The shared vector-search layer: ally-ai embeds text and stores and queries it in Weaviate for every corpus that needs semantic retrieval.
**Also called:** vector DB, Weaviate, RAG, embeddings · **Not to be confused with:** the [Context Library](#context-library) and [Knowledge base](#knowledge-base), products built on this layer.
**Composed of:** `vector_db` wraps the Weaviate client and `embeddings` the embedding API. Each corpus has its own collection, created by numbered scripts in `ally-ai/app/migrations/` (older corpora are being retired into the Context Library). `retrieval_log` reports retrievals to ally-be and treats a query as sensitive unless told otherwise. ally-ai-learn keeps its own embedding client for semantic-similarity events. [Quality evals](#quality-evals) judge retrieval quality.
**Status:** Live — gate: none
**Code:** `ally-ai/app/core/vector_db/` · `ally-ai/app/core/embeddings/` · `ally-ai/app/core/retrieval_log/` · `ally-ai-learn/app/core/embeddings/` · `ally-ai/app/migrations/`
**Deep doc:** [ally-ai](../repos/ally-ai.md) · [Knowledge-source retrieval policies](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/knowledge-source-retrieval-policies.md)

### Context Library
<!-- concept: context-library -->
**Is:** Ally's curated retrieval library of product, learning-design and engineering guidance, run by ally-be and searched by Ally's own agents and by engineers' Claude Code sessions.
**Also called:** CL, `cl_*` tables, the `search_context` / `get_chunks` / `list_collections` MCP tools, `planning_context` (human-only MCP prompt) · **Not to be confused with:** the [Knowledge base](#knowledge-base); [Retrieval](#retrieval) (the index underneath); the tombstoned `wiki/product/` pages.
**Composed of:** Collections defined by profiles. Uploads and written entries pass a worker (extract, gate, critic, dedupe) into Postgres chunks, which ally-ai `context_library` mirrors into Weaviate. Retrieval fuses, re-ranks and cites. Learning loops, a judge and gap reports tune it. Callers include Builder, Bug Hunter, Course Copilot, the Ally Guide and Debrief; engineers reach it over MCP with read-only keys.
**Status:** Live — gate: `FeatureToggleKey.CONTEXT_LIBRARY` (platform admins) or `FeatureToggleKey.ALLY_GUIDE_ORG` (an organisation's own entries)
**Code:** `ally-be/src/context-library/` · `ally-ai/app/core/context_library/` · `ally-web/apps/ally-admin-dashboard/src/pages/ContextLibrary/`
**Deep doc:** [Working with the Context Library](../contributing/planning-with-context-library.md) · [Build notes](https://github.com/HelloAllyTech/ally-platform/blob/master/docs/context-library/NOTES.md)

### Analytics charts
<!-- concept: analytics -->
**Is:** The read-only metrics surfaces: the admin Analytics tab, the helpline dashboard's organisation analytics, and the mobile Session Metrics tab.
**Also called:** Analytics tab, Organization Metrics, chart ids `AAQ-NNN` · **Not to be confused with:** the [Analytics Agent](#analytics-agent); PostHog product analytics ([UX Signals](#ux-signals)); `llm_usage` cost records.
**Composed of:** ally-be `analytics` serves the charts (`v1/analytics`, tenant-scoped `v1/tenant-analytics`) and hosts the [quality-eval](#quality-evals) judge services. Every admin chart carries a stable `AAQ-NNN` id that never changes when it moves; the canonical map is `GET /v1/analytics/chart-registry`. Admin charts use Carbon; an organisation-restricted admin sees only `@OrgScopedRoute` charts. The helpline page mixes native charts with signed Metabase embeds; mobile embeds Metabase in WebViews.
**Status:** Live — gate: `FeatureToggleKey.ANALYTICS` (admin); permission `VIEW_ANALYTICS_DASHBOARD` (helpline)
**Code:** `ally-be/src/analytics/` · `ally-be/src/analytics/constants/admin-analytics-chart-registry.constants.ts` · `ally-web/apps/ally-admin-dashboard/src/pages/Analytics/` · `ally-web/apps/ally-helpline-dashboard/src/pages/analytics/` · `ally-mobile/lib/features/analytics/`
**Deep doc:** [Effectiveness analytics plan](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/effectiveness-analytics-plan.md) · [ally-web](../repos/ally-web.md)

### Analytics Agent
<!-- concept: analytics-agent -->
**Is:** An Analytics sub-tab where a platform admin asks a question in English and gets a narrated answer plus the read-only SQL behind it.
**Also called:** text-to-SQL · **Not to be confused with:** [Analytics charts](#analytics); the [PM Agent](#pm-agent).
**Composed of:** question → ally-ai plans SQL → ally-be guards it → ally-be runs it read-only over allowlisted views → ally-ai narrates. The planner never sees rows and the narrator cannot change the query. Every query is audit-logged; both prompts live in the [Skills Store](#skills-store).
**Status:** Live — gate: `FeatureToggleKey.ANALYTICS_AGENT` on top of `FeatureToggleKey.ANALYTICS` (platform-only)
**Code:** `ally-be/src/analytics-agent/` · `ally-ai/app/core/analytics_agent/` · `ally-web/apps/ally-admin-dashboard/src/pages/Analytics/tabs/AnalyticsAgentTab.tsx`
**Deep doc:** [Analytics Agent](analytics-agent.md)

### UX Signals
<!-- concept: ux-signals -->
**Is:** A scheduled scan that reads PostHog session data back and files what looks broken to [Bug Hunter](#bug-hunter) and what looks like friction as [PM Agent](#pm-agent) evidence.
**Also called:** UX scan, "Scan now" · **Not to be confused with:** PostHog capture (the write side: frontend `VITE_POSTHOG_*` and ally-be's `posthog` client); [Analytics charts](#analytics).
**Composed of:** `posthog` provides the process-wide capture client. `ux-signals` queries aggregates with a read-scoped key, classifies them with an LLM, and writes `bug_findings` and `pm_agent_signals` rows. No UI of its own — its scan control is on the Bug Hunter page. It cannot dispatch a fix or file a roadmap item.
**Status:** Live — gate: `FeatureToggleKey.UX_SIGNALS`; the scan skips itself unless the `POSTHOG_*` read env vars are set
**Code:** `ally-be/src/ux-signals/` · `ally-be/src/posthog/`
**Deep doc:** none yet

### Quality evals
<!-- concept: quality-evals -->
**Is:** LLM judges that grade, after the fact, what the AI already did — voice-roleplay language, drift and fillers; retrieval and recall; feedback and debriefs — so quality shows up as analytics rather than anecdotes.
**Also called:** drift / language-quality / filler / RAG-quality / recall-quality / feedback-groundedness / debrief-quality judges, round-trip WER · **Not to be confused with:** the learner's score ([Scoring](#scoring)); actor evaluation ([Agent testing](#agent-testing)); the [Assistants](#assistants) checkup.
**Composed of:** ally-be `analytics` picks sessions, builds transcripts, calls a stateless ally-ai judge and stores the labels; rates are computed in SQL, never by the model. Judge prompts live in the [Skills Store](#skills-store). A scheduler judges unjudged sessions, with a backlog drainer and manual backfills. Round-trip runs the agent's own text through TTS and back through STT to measure pronunciation. Results appear as [Analytics](#analytics) tabs.
**Status:** Live — gate: `FeatureToggleKey.ANALYTICS` (to view)
**Code:** `ally-ai/app/core/drift/` · `ally-ai/app/core/language_quality/` · `ally-ai/app/core/filler_quality/` · `ally-ai/app/core/recall_quality/` · `ally-ai/app/core/rag_quality/` · `ally-ai/app/core/feedback_groundedness/` · `ally-ai/app/core/debrief_quality/` · `ally-ai/app/core/round_trip/` · `ally-web/apps/ally-admin-dashboard/src/pages/ConversationDrift/`
**Deep doc:** [Language-quality evaluation](language-quality-eval.md)

### Agent testing
<!-- concept: agent-testing -->
**Is:** Test cases platform admins write that an LLM judge applies to the AI actor (not the learner) after real roleplay sessions, plus a tester bot that runs voice-to-voice test sessions.
**Also called:** Agent Test Cases, actor evaluation, `compositeScore`, V2V test · **Not to be confused with:** the learner's score; [Auto-improve](#auto-improve); [AI Lab](#ai-lab) runs; ally-be's `test/` directory ([Plumbing](#plumbing)).
**Composed of:** An `agent_test_cases` row is CONDITION (a condition to simulate + what passing looks like) or FULL_SESSION (rubric rows). When a session ends, ally-be sends the transcript and every test case to ally-ai-learn's `scenario_session_evaluation` ([Scoring](#scoring)); the result is shown only on platform-admin and analytics surfaces. The V2V tester joins a LiveKit room as a simulated learner.
**Status:** Live — gate: `FeatureToggleKey.AGENT_TEST_CASES`; V2V test sessions need `FeatureToggleKey.OPERATIONAL_ADMIN_ACTIONS`
**Code:** `ally-web/apps/ally-admin-dashboard/src/pages/AgentTestCases/` · `ally-ai-learn/app/v2v_tester/` · `ally-be/src/learn/controller/agent-test-case.controller.ts`
**Deep doc:** none yet

### Auto-improve
<!-- concept: auto-improve -->
**Is:** A loop that keeps trying to improve one Skills Store prompt on live traffic: an AI designer drafts a challenger, a router splits calls, and an LLM judge scores outputs against an admin-written rubric.
**Also called:** skill experiments, Experiments tab, champion/challenger · **Not to be confused with:** [AI Lab](#ai-lab) (offline, by hand); [Agent testing](#agent-testing).
**Composed of:** A run snapshots the prompt as baseline, then tests champion vs challenger; a challenger wins only by a minimum margin that passes a significance test. It pauses on reaching the target or the budget. Only "connected" prompts — whose call sites ask the router which text to use and report the output — can run it. A winner is never published automatically; an admin applies it.
**Status:** Live — gate: `FeatureToggleKey.PROMPTS`; off for every prompt until an admin starts a run
**Code:** `ally-be/src/skill-experiment/` · `ally-web/apps/ally-admin-dashboard/src/pages/PromptManagement/experiments/`
**Deep doc:** [Auto-improve](auto-improve.md) · [Skill experiments](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/skill-experiments.md)

### AI Lab
<!-- concept: ai-lab -->
**Is:** An internal workbench for trying prompt templates against chosen models and collecting human and LLM-judge ratings of the outputs.
**Also called:** Lab, `lab_*` tables, the Evaluate portal (`/evaluate`) · **Not to be confused with:** a [Skills Store](#skills-store) prompt — an AI Lab Skill is a lab-only template that serves no production call.
**Composed of:** Skills (`{{variable}}` templates, optionally pinned to a catalog model), variables and values, runs (one log row per value combination), question sets, and evaluators — outside reviewers who sign in to the `/evaluate` micro-app with their own evaluator login to score published runs. An optional auto-eval has an LLM judge answer the same questions. A run never falls back to a substitute model.
**Status:** Live — gate: `FeatureToggleKey.AI_LAB`; the evaluator portal has its own login
**Code:** `ally-be/src/lab/` · `ally-web/apps/ally-admin-dashboard/src/pages/AILab/` · `ally-web/apps/ally-admin-dashboard/src/pages/Evaluate/`
**Deep doc:** [AI Lab](ai-lab.md)

### Image studio
<!-- concept: image-studio -->
**Is:** The shared "Generate" option beside every image field an author fills in (course, roleplay, case, path, character, badge), which drafts AI image candidates to choose from.
**Also called:** Image Studio, `generated_images`, cover image generation · **Not to be confused with:** the [Video actor](#video-actor); uploading or picking from the library.
**Composed of:** `image-studio` makes one fast LLM call that writes the scene spec, screens it for safety and writes alt text, then queues jobs; a worker generates them through `image-generation`'s provider adapters. An optional vision judge checks each result; images go to S3. Nothing applies until the author accepts a candidate. The scenario cover library ([Scenario](#scenario)) uses the same adapters.
**Status:** Live — gate: env `IMAGE_STUDIO_ENABLED` (default on); `IMAGE_STUDIO_JUDGE_ENABLED` (default on) for the judge
**Code:** `ally-be/src/image-studio/` · `ally-be/src/image-generation/`
**Deep doc:** [Image Studio](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/image-studio.md)

### Video actor
<!-- concept: video-actor -->
**Is:** An experimental lip-synced video track for a roleplay character, published into the same LiveKit room as its voice.
**Also called:** AI video actor, `videoActorEnabled` · **Not to be confused with:** [Image studio](#image-studio).
**Composed of:** Sits strictly after TTS in the [Voice agent pipeline](#voice-agent-pipeline). ally-be offers providers and faces to the [Simulation Studio](#simulation-studio) editor. No vendor plugin is installed yet; all three gates must pass before a session publishes video.
**Status:** Dark — gate: `FeatureToggleKey.VIDEO_ACTOR` (granted to no one; only reveals the Studio switch) + per-scenario `videoActorEnabled` (absent = off) + env kill switch `VIDEO_ACTOR_ENABLED`
**Code:** `ally-ai-learn/app/core/livekit/video_actor.py` · `ally-be/src/learn/service/video-actor-catalog.service.ts`
**Deep doc:** [AI video actor](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/video-actor.md)

## Internal agent tooling

### Builder
<!-- concept: builder -->
**Is:** An internal engineering agent: it takes a described change, interviews an admin into a PRD, then designs and codes it in GitHub Actions and moves the resulting PRs through review, merge and release.
**Also called:** Builder agent, builder session (kind `build` | `plan`) · **Not to be confused with:** ally-ai `builder` ([Assistants](#assistants) onboarding); the Builder role in [Roadmap](#roadmap) v2.
**Composed of:** `builder_session` rows, a versioned PRD, build runs, PRs, rules and an eval suite in ally-be. Design passes run read-only via `builder-session.yml`; builds go through a labelled GitHub issue (`builder.yml` → `builder-opencode.yml`), with review in `builder-review*.yml`. Dispatched through `ally-be/src/github/` and shipped through [Releases](#releases). Cards can be opened from the [Roadmap](#roadmap).
**Status:** Dark — gate: `FeatureToggleKey.BUILDER` (who sees the tab) + `builder_settings.enabled` (default false: nothing dispatches); `builder_settings.validatedTurns` (default true) is the interview kill switch
**Code:** `ally-be/src/builder/` · `ally-web/apps/ally-admin-dashboard/src/pages/Builder/` · `.github/workflows/builder.yml`
**Deep doc:** [Builder Agent](builder-agent.md) · [Builder eval](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/builder-eval.md)

### Roadmap
<!-- concept: roadmap -->
**Is:** The internal product roadmap: admins file ideas and bugs as *opportunities*, vote, rank, assign owners and track each to release.
**Also called:** Product Roadmap, opportunities, votes (formerly "coins"), Prod Director star · **Not to be confused with:** the public roadmap page ([Public content](#public-content)); a [Builder](#builder) `plan` session.
**Composed of:** Opportunities (new → prioritised → released → archived), product goals, vote grants, owners, saved views and the director-only star. `product-planning` adds plan spend ceilings, checks, notifications and the Idea/Builder/Owner roles. ally-ai `roadmap` embeds opportunities for duplicate detection. Fed by [PM Agent](#pm-agent) and [Report a bug](#report-a-bug); feeds [Builder](#builder).
**Status:** Live — gate: `FeatureToggleKey.PRODUCT_ROADMAP` (defaultEnabled; view and vote) / `FeatureToggleKey.PRODUCT_ROADMAP_MANAGE`. `ProductRoadmap` is the current page; the v2 `Roadmap` pages are Dark behind `builder_settings.roadmapV2Enabled`, and planning behind `builder_settings.planningEnabled`
**Code:** `ally-be/src/product-roadmap/` · `ally-be/src/product-planning/` · `ally-ai/app/core/roadmap/` · `ally-web/apps/ally-admin-dashboard/src/pages/ProductRoadmap/` · `ally-web/apps/ally-admin-dashboard/src/pages/Roadmap/`
**Deep doc:** none yet

### PM Agent
<!-- concept: pm-agent -->
**Is:** An admin AI product manager that studies analytics, code and the roadmap and produces a short feed of recommendation and question *cards*; an accepted card is filed to the [Roadmap](#roadmap). It never builds.
**Also called:** AI product manager, card feed, `/pm-agent` · **Not to be confused with:** the [Debrief agent](#debrief-agent)'s PM agent (ally-ai `pm_agent`).
**Composed of:** Bounded LLM lanes with no write tools; each card cites evidence from the same run. Deterministic code owns the queue, the reserve-before-spend budget and filing. Includes impact checks and weekly lessons; takes friction evidence from [UX Signals](#ux-signals). The old auto-build chain into Builder was removed.
**Status:** Dark — gate: `FeatureToggleKey.PM_AGENT` (platformOnly) + `pm_agent_settings.enabled` (default false)
**Code:** `ally-be/src/pm-agent/` · `ally-web/apps/ally-admin-dashboard/src/pages/PmAgent/`
**Deep doc:** [PM Agent](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/pm-agent.md)

### Bug Hunter
<!-- concept: bug-hunter -->
**Is:** An autonomous find-and-fix agent: it sweeps the code for bugs, records *findings*, opens fix sessions that produce PRs, verifies and releases them.
**Also called:** bug findings, hunt runs, sweeps, fix sessions
**Composed of:** `bug_findings` and `bug_hunt_runs` with a policy service, PR review, held-PR watch and protection-drift checks. GitHub workflows `bug-hunt-sweep.yml` (scheduled), `bug-fix-session.yml` and `bug-hunter-evals.yml`. User reports from [Report a bug](#report-a-bug) and breakage from [UX Signals](#ux-signals) land as findings. Ships through [Releases](#releases).
**Status:** Dark — gate: `FeatureToggleKey.BUG_HUNTER` + `bug_hunter_settings.mode` (`off` by default; `manual` | `ai`)
**Code:** `ally-be/src/bug-hunter/` · `ally-web/apps/ally-admin-dashboard/src/pages/BugHunter/` · `.github/workflows/bug-hunt-sweep.yml`
**Deep doc:** [Bug Hunter tools](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/bug-hunter-tools.md) · [Memory ADR](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/bug-hunter-memory-adr.md)

### Report a bug
<!-- concept: report-a-bug -->
**Is:** The "Report a bug" form in the admin, helpline and mobile apps that any signed-in user can file.
**Not to be confused with:** the admin Inbox pages ([Assistants](#assistants)).
**Composed of:** One shared web form (`ui-shared`) and the Flutter `bugreport` feature, both posting to the rate-limited `POST /v1/product-roadmap/bug-reports`. A report becomes a `bug`-type [Roadmap](#roadmap) opportunity and a [Bug Hunter](#bug-hunter) finding.
**Status:** Live — gate: none (signed-in only)
**Code:** `ally-mobile/lib/features/bugreport/` · `ally-web/libs/ui-shared/src/lib/bug-report-form/`
**Deep doc:** none yet

## Delivery & ops

### Releases & versioning
<!-- concept: releases -->
**Is:** How a merged change on `master` becomes a versioned production release. **`master` is not live until it is tagged.**
**Also called:** production release, release tag, auto-release, forced update
**Composed of:** One `production-release-*.yaml` per deployable, each validating its tag prefix: `be-v*`, `ai-v*`, `learn-v*`, and `frontend-v*` (one tag for admin and helpline; `admin-v*`/`helpline-v*` are legacy). ally-be's release service dispatches and watches releases for [Builder](#builder) and [Bug Hunter](#bug-hunter) through the shared GitHub Actions client. Mobile releases via `scheduled-mobile-release.yml` then a promote/submit workflow. `app-version` serves the minimum versions behind the app's forced-update modal.
**Status:** Live — gate: `FeatureToggleKey.MOBILE_RELEASES` (the page); mobile auto-release kill switch in repo variable `AUTO_RELEASE_ENABLED`
**Code:** `ally-be/src/release/` · `ally-be/src/github/` · `ally-be/src/app-version/` · `ally-be/src/mobile-releases/` · `ally-web/apps/ally-admin-dashboard/src/pages/MobileReleases/`
**Deep doc:** [Release Process](../contributing/release-process.md)

### Deploy
<!-- concept: deploy -->
**Is:** How a release reaches servers: the release workflows build images and deploy them to the production stack.
**Composed of:** Production releases deploy through the `deploy-metal01` composite action, which runs an Ansible playbook from the separate private **infra** repo against Incus containers; images stay in a container registry and migrations run inside the playbook. The manual `deploy-*.yml` workflows still target the older ECS and CDN path for a chosen environment.
**Status:** Live — gate: none
**Code:** `.github/actions/` · `.github/workflows/deploy-ecs-service.yml`
**Deep doc:** [infra](../repos/infra.md)

### Queues & scheduled jobs
<!-- concept: queues-and-jobs -->
**Is:** The asynchronous machinery between and inside services: SQS queues, Redis pub/sub and ally-be's scheduler.
**Not to be confused with:** ally-be `queue` (the helpline's waiting-talker queue, [Text helpline](#helpline)).
**Composed of:** ally-be `aws` provides `@SqsListener` / `@SqsDlqListener` and a polling registry; consumers live in each feature module. `message-broker` is Redis pub/sub fanning socket events across replicas. `scheduler` holds fixed-interval tasks, guarded by a Postgres advisory lock so one replica runs each tick, plus DB-configured tasks. ally-ai's queue package runs the transcription-request worker; ally-ai-learn's publishes session messages and events.
**Status:** Live — gate: none
**Code:** `ally-be/src/aws/` · `ally-be/src/message-broker/` · `ally-be/src/scheduler/` · `ally-ai/app/core/queue/` · `ally-ai-learn/app/core/queue/`
**Deep doc:** [Queue messaging](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-ai-learn/docs/11-queue-messaging.md) · [Architecture](architecture.md)

### Documentation system
<!-- concept: docs-system -->
**Is:** The routing and CI machinery that keeps docs findable and in step with the code, for AI sessions first. This page is part of it.
**Also called:** docs guard, docs map, routing index, wiki
**Composed of:** `AGENTS.md` routers in each app, mirrored byte-for-byte to `CLAUDE.md`. `.docs-map.yml` rules checked by `docs.yml`, which also runs this page's lint and the docs-path lint. The wiki source lives in `helloallytech.github.io/` and `publish-wiki.yml` mirrors it to GitHub Pages; `gen-routing.py` generates `ROUTING.md` (checked by `routing-index.yml`); `wiki-health.yml` runs a weekly lint. This page is also readable inside the admin app: the book icon in the [Roadmap](#roadmap) header opens it view-only, fetched from the published wiki each time.
**Status:** Live — gate: none (escape with the `docs:skip` label on a PR, a `Docs-Skip:` trailer on a direct push, or `Wiki-PR: none — <reason>` for a `wiki:` rule)
**Code:** `helloallytech.github.io/` · `scripts/concepts_lint.py` · `.docs-map.yml` · `ally-web/apps/ally-admin-dashboard/src/pages/Roadmap/components/ConceptsDrawer.tsx`
**Deep doc:** [Documentation System](../contributing/docs-system.md)

### Storage archive
<!-- concept: storage-archive -->
**Is:** A weekly job that moves private S3 objects older than 30 days to a VPN-only storage box, then deletes them from S3, to cut storage cost.
**Composed of:** The Go + htmx `ally-archiver` app with a SQLite ledger and audit table; an object is deleted only after its SHA-256 is re-verified on the box. Each bucket starts disabled and unarmed. Releases are tagged `archiver-v*`.
**Status:** Partial — gate: per-bucket enabled/armed state in the archiver's ledger (off for every new bucket)
**Code:** `ally-archiver/`
**Deep doc:** [Storage Archive](storage-archive.md) · [ally-archiver](../repos/ally-archiver.md)

### Audit & PHI logging
<!-- concept: audit-and-phi -->
**Is:** The designated places where security- and PHI-relevant events are recorded, and where ops read application logs. **Never log PII/PHI anywhere else.**
**Also called:** audit log, HIPAA audit, PHI logger, Logs page
**Composed of:** ally-be `audit` writes audit events (logins, OTPs, calls, audio uploads) to `audit_logs` and optionally a cloud log group; ally-ai's `phi_logger` / `phi_events` do the same for AI-side PHI events. `logs` backs the admin Logs page. `observability` holds OpenTelemetry spans for the agent harness — content-free, and a no-op until an SDK registers.
**Status:** Live — gate: `FeatureToggleKey.LOGS` (platformOnly) for the page; cloud shipping off by default (`ENABLE_AUDIT_LOGS_TO_CLOUDWATCH` in ally-be, `HIPAA_AUDIT.ENABLED` in ally-ai)
**Code:** `ally-be/src/audit/` · `ally-be/src/logs/` · `ally-be/src/observability/` · `ally-web/apps/ally-admin-dashboard/src/pages/Logs/` · `ally-ai/app/core/phi_logger.py` · `ally-ai/app/core/phi_events.py`
**Deep doc:** [Architecture](architecture.md)

## Plumbing

Directories with no domain meaning of their own. They are listed so the lint knows they were
left off the cards on purpose.

- `ally-be/src/common/` — shared base entities, constants and utilities
- `ally-be/src/config/` — env validation and the typed config service
- `ally-be/src/database/` — TypeORM data source, migrations, seeds
- `ally-be/src/exception/` — exception filter and error codes
- `ally-be/src/factory/` — provider factory picking the analytics integration
- `ally-be/src/health/` — health endpoint
- `ally-be/src/redis/` — Redis client and cache controller
- `ally-be/src/rate-limit/` — throttler guards and decorators
- `ally-be/src/logger/` — app logger singleton
- `ally-be/src/test/` — repo-wide env, load and lint-performance specs (not [Agent testing](#agent-testing))
- `ally-be/src/ai/` — ally-be's HTTP client to ally-ai and the transcription-response consumers
- `ally-ai/app/core/ally_core/` — ally-ai's HTTP client back to ally-be
- `ally-ai/app/core/storage/` — S3 client wrapper
- `ally-ai/app/core/text_generations/` — generic text-generation client used by summaries and notes
- `ally-web/apps/ally-admin-dashboard/src/pages/DesignSystem/` — public gallery of the UI kit's components
- `ally-web/apps/ally-helpline-dashboard/src/pages/health-check/` — health route
- `ally-web/apps/ally-helpline-dashboard/src/pages/settings/` — unrouted "Coming Soon" stub
- `ally-web/apps/ally-helpline-dashboard/src/pages/calendar/` — unrouted "Coming Soon" stub

## Keeping this page current

Three things keep this page true. Each covers a gap the others can't see.

1. **`scripts/concepts_lint.py`** — the `concepts` job in `.github/workflows/docs.yml`, on every
   PR. It fails when a module, package, page or feature directory under `ally-be/src`,
   `ally-ai/app/core`, `ally-ai-learn/app/core`, either dashboard's `src/pages` or
   `ally-mobile/lib/features` is on no card's **Code** line and not under
   [Plumbing](#plumbing); when a path this page names no longer exists; when a
   `FeatureToggleKey` is on no card; or when a card is malformed. Citing a file inside a
   directory does not claim the directory. Run it locally: `python3 scripts/concepts_lint.py`
   (`--unclaimed` lists just the gaps).
2. **The `concepts-gates` rule in `.docs-map.yml`** — touching the toggle registry or any
   `*settings*.entity.ts` requires touching this page. That is where a concept flips between
   Live and Dark without a path changing. If the change moves no status, add the `docs:skip`
   label to the PR (a `Docs-Skip:` trailer works only on a direct push to `master`).
3. **The agent rule in `AGENTS.md` / `CLAUDE.md`** — adding, retiring, renaming or re-gating a
   concept updates its card in the same PR.

**When you edit:** keep each card to the six fields and roughly 120 words — depth belongs in
the deep doc. State invariants, not counts (counts go in [Platform Stats](stats.md)). Judge
**Status** from code on `master`. A new concept gets a card in the right section with a
unique `<!-- concept: slug -->`; a removed one either goes, or stays as **Removed** with no
**Code** paths if agents will still meet the word. If a term gains a second meaning, add it
to [Overloaded terms](#overloaded-terms). The page is public: no customer names, hostnames,
internal metrics or strategy.
