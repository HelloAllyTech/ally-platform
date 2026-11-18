# Debrief glossary

One word, one meaning. Where the code or the database still uses an older word, it is listed here so
nobody has to guess. Wire formats, stored JSON, table names and released mobile keys are not renamed
(see "Known debt").

## Changes and releases

| Say | Means | Other names you will meet |
|---|---|---|
| **change** | One proposal to alter the debrief: a prompt edit, a setting, an agent, or a hand-off. A person or the Debrief PM agent proposes it; it is tried, then goes live or is turned down. | **idea** (code, API routes `pm-agent/ideas/*`, JSON key `ideaKind`), **lesson** (DB table `agent_lessons`, `agent_lesson_audit`). The screens say "change". |
| **release** | A complete, versioned setup of the debrief that learners get: which prompts, models, steps and settings. Only one release is live at a time; a change makes a **draft** release. | `agent_releases` (shared table), `release_history`. |
| **bundle** | The JSON payload that holds a release's contents. A code word only: say "release" in screens and prose. | `DebriefBundle`, `bundle` in the ally-ai request. |
| **decision** | Approving or turning down a change. "Approve" is the positive decision, "turn down" the negative one. | `approve` / `reject` in routes and enums. |

## What runs

| Say | Means | Other names |
|---|---|---|
| **debrief flow** (code: **recipe**) | The fixed list of steps a release runs for one kind of session (standard, short, case, assessment). Chosen by simple rules from the session. The metrics filter calls the same thing "debrief type". | `recipe`, `recipes` in the bundle, `Recipe` in ally-ai. |
| **plan** | What the planner chose for one session in a planned run: which optional agents to add. Not the same as a recipe. | `default_plan`: a stored change kind meaning "the plan used when the planner adds nothing". |
| **step** | One stage of a flow that code controls: read for safety, analyse, write, check, evaluate, revise. | `DebriefStep`, "node" in the graph code. |
| **agent** | Any unit that calls a model: the steps above that use one, the planner, and the optional agents. | |
| **optional agent** | An agent only the planner adds to a session (learner history, cohort, case memory, and so on). | `registry agent`, `orchestrator agent`, `orchestratorAgents` in code. |
| **run** | One attempt to produce a debrief for one session, with its status and logs. | `debrief_runs`. |

Other screen words: **serious problem** (code: hard fail) is a flaw that fails a debrief whatever its score; **extra evidence round** (code: top-up) is the step that adds agents after a first draft falls below the bar; **reference values** (code: baselines) are the numbers proposed from a month of debriefs.

## Run modes

- **live**: the debrief a learner reads. Counts against the cost ceiling only as a minimum path.
- **shadow** (screens: "background"): a debrief made in the background for a session that still shows today's feedback; nobody sees it; used to compare.
- **replay** (a test run of a past session): a past session run again with a changed prompt or setting, to test a change before it goes live.

## The learner's debrief

- **cards** and **sections** are the same thing: the parts of the debrief note (what worked, what to work on, the important moment, and so on). The code and mobile locale files say `cards` (`postSim.debriefCards`); the data and API say sections or points.
- **important moment**: the card about a risk cue the client voiced and how the learner responded.
- **risk cue**: something the client says about dying, self-harm, harming others or being in danger (clear), or low mood, stress and the like (possible). The one pinned definition decides.
- **follow-up notice** (`followUp`): when a clear risk cue is still left out of a debrief, the debrief is shown as it is and the learner also sees a notice that someone from the team is checking it more closely (owner decision 2026-11-18: publish with a notice, never withhold). It promises no contact.

## Locked prompts (code: pinned rules)

The screens say **locked prompts**; code, routes and old data say `pinned rule` / `pinned_rule`. They are the prompts that decide what counts as safe and how debriefs are judged: safety rules, risk cue definition, rubric, judge's instructions, the PM agent's reviewer and the Evaluator's instructions. They are ordinary Skills Store prompts that only the people named in `SKILLS_STORE_PINNED_EDITORS` can publish. The Debrief PM agent can read them but never edit them. The words `pinned_rule` and `pinnedRule` in old data and code mean this; nothing can wait for approval any more.

## Known debt (names left as they are, and why)

| Name | Why it stays |
|---|---|
| `agent_lessons`, `agent_lesson_audit`, `ideaKind`, `pm-agent/ideas/*` | Stored data and API paths: renaming needs a migration and a compatibility window. |
| `pinned_rule` / "pinned rules" in code, routes and history (screens say "locked prompts") | Six old items carry it; they are shown as history. |
| `default_plan` as a change kind | Stored in changes already made. |
| `postSim.debriefCards` (mobile locale key) | Already in released app builds. |
| `recipe`, `bundle`, `registry agent` in code | Stored and on the wire; only screens and docs use the plain words. |
| `/debriefs/pm-agent` | Kept as a redirect to `/debriefs/changes`. |
| Mixed camelCase / snake_case in stored JSON (`riskCueOption` vs `risk_cues`) | Wire is snake_case and the database JSON grew both; convert at the edge, do not rename stored keys. |
