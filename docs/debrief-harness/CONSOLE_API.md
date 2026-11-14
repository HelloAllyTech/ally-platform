# Debrief console API (redesign)

The contract between ally-be and the redesigned Debrief console pages in ally-web. Every
route is under `/api/v1/debriefs/console` unless it says otherwise. The old console routes the
redesign still uses keep their response shapes, but their **permissions changed** (see Roles). The
read routes only the old tabs called (`GET review`, `GET runs`, `GET runs/:id`, `GET steps`,
`GET releases`) and `POST models` were removed; a model change is a `pm-agent/ideas/propose`.

Build notes: debrief-console-redesign-notes.md (outside the repo). Code:
`ally-be/src/debrief/controller/debrief-console.controller.ts`,
`ally-be/src/debrief/service/debrief-console-view.service.ts`,
`ally-be/src/debrief/service/debrief-autonomy.service.ts`,
`ally-be/src/debrief/util/debrief-console-roles.util.ts`,
`ally-be/src/debrief/util/debrief-console-view.util.ts`.

**No redaction.** The console shows real names and the real transcript, including the expert-review
routes the session page uses.

**Plain words (2026-11-12).** API fields, enum values and stored data keep their names; only the
text people read changed. In the admin and in ally-be's reasons, notifications and release notes:
`quick_test` → Quick check, `gate_test` → Pass test, `paired_trial` → Side-by-side trial, `canary` →
Try on learners / learner try-out, promote → Live for everyone / put live for everyone, the open and
gate test sets → Practice sessions and Test sessions, κ → Agreement. On the Debriefs list and the
session review: the judge → Independent check, the Evaluator → Ally's own check, and a run in a
trial reads "Version vN · In a trial: the current version". A person's pinned-rule proposal is
titled "<rule name>: <why>" (e.g. "Safety rules: …"); the closed groups are "Rejected or
withdrawn" and "Live for everyone".

## Roles and who can act

No new roles were created. The console uses the existing groups and adds one new permission.

| Role | Held as | Notes |
|---|---|---|
| Ally team | `system:access` (PLATFORM_ADMIN, SUPER_ADMIN, SUPER_DUPER_ADMIN) | The platform tier that already reaches the console |
| Clinical advisor | `review:admin:debriefs` | Through the `CLINICAL_ADVISOR` role (migration 1981900930000), added person by person in `user_groups` alongside the account's own role. The platform groups no longer hold it (1981900780000). Platform-managed: the generic role picker can't grant it. Advisor routes need it alone, never `system:access` |
| Owner | `manage:admin:debrief-settings` (**new**, migration 1981900730000) | SUPER_DUPER_ADMIN, or granted person by person |
| Engineering (Schedules only) | the `debrief_schedules` admin feature toggle ("Debriefs — Schedules") + `system:access` | Granted person by person, never to a group; nobody holds it after deploy. See "Schedules" |

To read the console you need the Analytics toggle (or the "Debriefs — Clinical advisor" toggle)
**and** one of the three permissions. Each action below requires one of its permissions, and the
server returns **403** otherwise. Every payload carries `viewer.can`, so the UI can hide a button
rather than disable it.

| `can.<action>` | Ally team | Advisor | Owner | Routes |
|---|---|---|---|---|
| `comment` | yes | yes | yes | console `runs/:id/comments`, `comments/:id` (PATCH, DELETE, resolve, reopen, still-happening) |
| `flagDecision` | yes | escalated flags only (checked per flag, 403) | yes | `flags/:id/resolve` |
| `heldDebrief` | yes | no | yes | `runs/:id/publish`, `runs/:id/todays-debrief`, `runs/:id/reviewed`, `runs/:id/correct` |
| `escalate` | yes | no | yes | `flags/:id/escalate`, `runs/:id/escalate` |
| `verdict` | no | yes | no | expert-review `runs/:id/verdict` |
| `pmAgent` | yes | no | yes | `pm-agent/analyse`, `ideas/:id/screen`, `approve` (a budgets-only change: owner), `reject` (never a pinned rule), `questions`, `start-step`, `ideas/propose` and `ideas/:id/draft` (with `settings`: owner) |
| `approvePinnedRule` | no | yes | yes | `pinned-rules/proposals`, `pm-agent/ideas/:id/approve-pinned-rule`, `withdraw-pinned-rule` (own only), `reject-pinned-rule` |
| `testSets` | yes | no | yes | `test-sets/build` |
| `releases` | yes | no | yes | `releases/orchestrator-challenger`, `releases/:id/rollback`, `releases/:id/promote-waiting`, `releases/:id/dismiss-waiting`, `sessions/:sessionId/run` |
| `switchOrgOn` | no | no | yes | `tenants/:id/live` with `live: true` (403 for the Ally team), `tenants/:id/region` |
| `emergencyStop` | yes | no | yes | `tenants/:id/live` with `live: false`, `tenants/:id/emergency-stop` |
| `agentLogs` | yes | no | no (unless also on the team) | `runs/:runId/logs` (GET: a read, but team-only because it holds the whole transcript and every prompt) |
| `ownerSettings` | no | no | yes | `settings` (PUT), `settings/accept`, `settings/baseline`, `budgets`, `autonomy/matrix`, `autonomy/orgs/:id` |

The clinical advisor's routes (verdict, comments, escalated flags,
pinned-rule sign-off) accept `review:admin:debriefs` without `system:access`; the Ally team's
actions stay on `system:access`. Platform admins no longer hold `review:admin:debriefs` (migration
1981900780000), so they give no verdicts and sign off no pinned rules unless granted it by hand.

"Escalated to you" (the bar, the banner and the `escalated` count) goes only to
`roles.receivesEscalations`. That is an advisor named with the clinical-advisor toggle, or a
`review:admin:debriefs` holder who is not on the Ally team.

```ts
type Viewer = {
  roles: { allyTeam: boolean; clinicalAdvisor: boolean; owner: boolean; receivesEscalations: boolean };
  can: Record<'comment'|'flagDecision'|'heldDebrief'|'escalate'|'verdict'|'pmAgent'|
              'approvePinnedRule'|'testSets'|'releases'|'switchOrgOn'|'emergencyStop'|'ownerSettings', boolean>;
};
```

### `GET me`
Returns `{ userId: number } & Viewer`.

## Home list

### `GET sessions`
Query: `category` = `needs` (default) | `flagged` | `below` | `published` | `escalated` |
`agreement_sample` | `all` (an old `to_score` link falls back to `needs`); `tenantId`; `language`; `recipe` (`standard`|`short`|`case`|`assessment`);
`fallback` = `none` (ran as written) | `light` (steps 1–2) | `heavy` (steps 3–6); `riskCue` =
`true`|`false`; `cost` = `over_0_20` | `hit_ceiling` (≥ 95% of the run's ceiling); `mode` =
`production` (default, shadow and live) | `live` | `shadow` | `replay` | `any`; `limit` (≤ 200,
default 50); `offset`. Invalid values are dropped.

The `needs` and `escalated` lists are in **queue order**: rank 0 (urgent), then rank 1, then
rank 2, and the oldest wait first within a rank. Rank 0 is a flag on an important moment, an Ask
Ally distress item, an escalated flag, or learner distress not yet checked. Rank 1 is another
open flag. Rank 2 is a debrief that is held or below the bar and not reviewed. Rank 3 is
everything else. Only live runs can need a person. Flags still inside the learner's 10-minute
undo window are not work yet. Other categories are newest first. Comments never enter this queue.

```ts
{
  category: string;
  counts: { needs; urgent; flagged; below; published; escalated; agreementSample: number | null; all }; // same filters
  items: Array<{
    runId; sessionId; scenario: { id: string|null; title: string|null };
    tenantId; tenantName; language; recipe; mode; status; skipReason; releaseVersion;
    judgeOverall: number|null; evaluatorOverall: number|null; costUsd; ceilingUsd; seconds; fallbackRung;
    createdAt; rank: 0|1|2|3; needsPerson; urgent; flagged; flagCount; importantMomentFlagged;
    escalated; riskCue; learnerDistress; belowBar; reviewed;
    waitingSince: string|null;
    agreementSample: boolean;            // in the weekly agreement sample, no verdict yet
  }>;
  filterOptions: { tenants: {id,name}[]; languages: string[]; recipes: string[]; fallback; riskCue; cost; modes };
  viewer: Viewer;
}
```

**Blind until the verdict (spec Q3).** For a viewer who is neither the Ally team nor the owner (in
practice the clinical advisor), on runs they have not given a verdict on: `judgeOverall` and
`evaluatorOverall` are null, `belowBar` is false, a `below_bar` run's `status` reads `published`
(what the learner has) and it takes no rank-2 queue place, `counts.below` is null and the `below`
category is empty. The session view does the same: `judge: { hidden: true }`, `run.status` reads
`published` for a `below_bar` run, and the Evaluator step in `howItWasMade.steps` has no `output`
or `reasoning`. A held run (`needs_person`) stays held.

`agreement_sample` (counts: `agreementSample`, null unless `can.verdict`) lists the weekly random
agreement sample's runs that have no verdict yet (see "Judge agreement" below).

**Score by hand was removed on 2026-11-12** (no `to_score` category, `toScore`, `scorer` or
`can.score`; `POST sessions/:sessionId/score` and `GET /v1/analytics/debrief-quality/calibration/:id`
are gone). Agreement comes only from the clinical advisor's yes/no answers (see "Judge agreement").

## One session

### `GET sessions/runs/:runId` (read; audited like every console view)

```ts
{
  run: { id; sessionId; mode; status; skipReason; language; languageSource; recipe; releaseVersion;
         arm: 'baseline'|'challenger'|null;   // in a side-by-side trial (shown "In a trial: the current version")
         createdAt; hasRiskCue; learnerDistress; openedByLearnerAt };
  session: { id; scenario: {id,title}; learner: {id,name,level}; tenantId; tenantName; startedAt; endedAt; turns };
  transcript: Array<{ turnIndex: number; speaker: 'client'|'learner'; text: string; gap: boolean;
                      riskCue: { category; learnerResponse } | null }>;   // real text, 1-based judge numbering
  cards: DebriefCards | null;            // current version
  cardVersion: number;                   // 1 = as published; +1 per correction
  versions: Array<{ version; at; by: number; section; fields: string[]|null; note: string|null;
                    flagId: string|null; before: DebriefCards }>;
  corrections: Array<{ section; outcome: 'kept'|'removed'|'corrected'; note; at }>; // what the learner sees
  flags: Array<{ id; section; reason; note; urgent; status; createdAt; inUndoWindow; resolutionNote;
                 resolvedAt; resolvedBy: {id,name}|null; cardText; card: CorrectableFields|null;
                 turns: number[]; canDecide: boolean }>;
  askAlly: {
    exchanges: Array<{ question; askedAt; reply: string|null; repliedAt; check: 'passed'|'replaced'|'no_reply';
                       section: string | null;      // the card asked about ("work_on_this[0]"), when the app sent it
                       firstWordsMs: number | null; // time from the question to Ally's first words (null before this release)
                       replacedReply: { reply; fails: string[] } | null; costUsd: number|null; model; tools: unknown[] }>;
    totalCostUsd: number|null;
    distressItems: Flag[];               // the Ask Ally distress queue items
  };                                     // read-only
  // `section` comes from the learner apps: POST /v1/debriefs/sessions/:id/reply/stream now accepts an
  // optional `section` (the card the question was asked from). Until the apps send it, it is null.
  learnerDistress: { present; inSession; inAskAlly; riskCueTurns: number[] };  // show the banner first
  skillEstimate: { progress: ProgressItem[]; skillWords: SkillWord[]; learnerLevel; pastSessions: number|null }; // ONLY here
  howItWasMade: { recipe; releaseVersion; fallbackRung; revisionRounds; estimatedCostUsd; actualCostUsd;
                  ceilingUsd; seconds; steps: StepRecord[]; checkFailures; error };
  judge: { hidden: true }                // an advisor (not on the Ally team) who has not given a verdict
       | { hidden: false; overall; belowBar; hardFails: {code,evidence}[]; dimensions; evaluatorOverall;
           evaluatorHardFails; reasons: Array<{ source: 'judge'|'evaluator'|'check'; code; text; turns: number[] }> };
  review: { by; at; action; note } | null;
  escalation: { at; note; by: {id,name} } | null;
  comments: Comment[];                   // the same shape as expert review's comments
  earlierComments: Comment[];            // threads on this learner's earlier debriefs of the same
                                         // scenario, newest first (≤ 30), minus ones already repeated here
  verdict: { verdict; hardFails; updatedAt } | null;  // the viewer's own
  agreement: { inSample: boolean; questions: AgreementQuestion[] } | null; // can.verdict only
  queue: { position: number|null; total; previousRunId: string|null; nextRunId: string|null }; // Previous/Next, j/k
  pendingActions: PendingAction[];       // the "waiting on you" bar, for THIS viewer's role
  viewer: Viewer;
  can: { comment; decideFlags; publish; showTodaysDebrief; looksFine; correct; escalate; verdict; runAgain };
}

type PendingAction = {
  kind: 'urgent_flag'|'learner_distress'|'flag'|'held'|'below_bar'|'escalated_flag'|'escalated_run';
  level: 'red'|'yellow';
  waitingSince: string;
  overdue: boolean;        // past the owner setting flagReviewSlaHours (default 24); a held debrief turns red
  title: string;
  flagId?: string;
  anchors: { turns: number[]; cardSection?: string|null; learnerNote?: string|null; judgeReasons?: boolean; askAlly?: boolean };
  decisions: Array<'keep'|'correct'|'remove'|'escalate'|'publish'|'todays_debrief'|'looks_fine'|'checked'|'verdict'>;
};
```

The Ally team (and the owner) see urgent flags, distress, open flags, held debriefs and debriefs
below the bar. An advisor who receives escalations sees `escalated_flag` and `escalated_run`.
Anyone else gets `[]`.

The decision buttons map to these routes:

| Decision | Route |
|---|---|
| keep / remove / correct | `POST flags/:id/resolve` |
| escalate | `POST flags/:id/escalate` or `runs/:id/escalate` |
| publish | `POST runs/:id/publish` |
| todays_debrief | `POST runs/:id/todays-debrief` |
| looks_fine | `POST runs/:id/reviewed` |
| checked (Ask Ally distress) | `POST flags/:id/resolve {outcome:'kept', note}` |
| correct (no flag) | `POST runs/:id/correct` |
| verdict | expert-review `PUT runs/:id/verdict` |

## Agent logs (Ally team only)

### `GET runs/:runId/logs`

The exact input every agent of the run was sent and its full reply, in order: for debugging an
agent and improving it later. Gated by `can.agentLogs` (`system:access`); a clinical advisor gets
**403**. Stored in `debrief_run_logs` (ally-be `DATA_SCHEMA.md`), deleted with the run and so with
the session.

```json
{
  "runId": "…",
  "loggedFrom": "2026-11-14",
  "run": { "sessionId": "…", "scenarioTitle": "Exam stress, first call", "status": "published",
           "recipeKey": "standard", "releaseVersion": 5, "language": "en",
           "costUsd": 0.09, "seconds": 134 },
  "entries": [
    { "seq": 1, "kind": "code", "step": "plan", "round": null, "startedAt": "…",
      "model": null, "fallbackModel": null, "prompt": null,
      "input": { "learnerTurns": 8, "ceilingUsd": 0.5, "orchestratorEnabled": false, … },
      "output": { "recipe": "standard", "why": "…", "next": ["safety_reader", "analyst"] },
      "tokensIn": null, "tokensOut": null, "costUsd": null, "ms": 1, "retries": 0,
      "error": null, "attention": false },
    { "seq": 5, "kind": "model", "step": "writer", "round": 0,
      "model": "gemini-2.5-pro", "fallbackModel": null,
      "prompt": { "code": "debrief_writer_system", "version": 3,
                  "href": "/manage-prompts?prompt=debrief_writer_system&version=3", "inlined": true },
      "input": "{{system_prompt}}\n\nSESSION LANGUAGE: en\n…<transcript>…",
      "output": { "cards": { … }, "reasoning": "…" },
      "tokensIn": 5320, "tokensOut": 690, "costUsd": 0.018, "ms": 15012, "retries": 0,
      "error": null, "attention": false }
  ],
  "prompts": { "debrief_writer_system@3": "<the version's text>" }
}
```

- **`kind: model`**: one entry per model call, each attempt its own (`retries` = attempts before
  it; a failed attempt has `error` and no `output`). `input` is the message exactly as sent, with
  the Skills Store prompt replaced by `{{system_prompt}}`; put `prompts["code@version"]` back in
  its place to get the exact text. `model` is the model the step asked for first; `fallbackModel`
  the backup or fallback that ran instead. A step whose prompt had no live text sent the code's
  default whole (`prompt.version` null, no marker). A run that replaced a prompt for itself (a
  replay's challenger) keeps that text inline and names no prompt.
- **`kind: code`**: a deciding code step's real inputs and results: `plan` (the recipe and why,
  the ceiling, whether the orchestrated path is on), `profile`, `dispatch` (each wave: the
  accepted plan with each agent's estimated cost and what was dropped, then what was applied,
  sent and skipped), `top_up`, code and data agents, `guidance_lookup`, `checks`, `score_draft`,
  `decide`.
- **`step: judge`**: the independent check, logged later, on the judge's schedule, against the
  same run.
- **`attention`**: a failed check, a draft below the bar, a decision other than published, an
  error, a dispatch that dropped or skipped an agent.
- Runs from before this release have no entries: `entries` is empty and `loggedFrom` is the day the
  first entry was stored (null until any run has one).

## Correct in place (PRD §6.7)

- **With a flag:** `POST flags/:id/resolve` takes `{ outcome: 'corrected', note, correction: { lead?, body?, why?, try_saying?, reason? } }` (unchanged). `note` is required: it is the "what changed" line the learner reads. The response now adds `version`.
- **Without a flag** (a held debrief or one below the bar): `POST runs/:id/correct` takes `{ section, correction, note }` and returns `{ id, version, section }`. This needs `heldDebrief`. The run must be `published` or `below_bar`.

Both save a new version (`versions[]`, with the previous cards). The quote is locked: a `quote`
that differs from the original gets a 400. The learner's note is updated, and they are told
"Ally updated it". The learner sees `{section, outcome: 'corrected', note, at}`, and the UI renders
"Updated on {at} after a review by the Ally team: {note}".

## Comments

These go to `POST runs/:id/comments` with the same body as expert review: `{ anchorKind: 'transcript'|'card'|'debrief', turnIndex?,
section?, spanStart?, spanEnd?, quotedText?, body, tag?, parentId? }`. Tags are `missed_moment`,
`wrong_or_unsupported`, `tone`, `advice_doesnt_fit`, `too_vague` ("Too vague", migration 1981900920000) and
`good_keep_this` (plus the older `protocol`, `language` and `too_long_or_unclear`). `PATCH comments/:id {body?, tag?}`, `DELETE comments/:id`,
`POST comments/:id/resolve`, `POST comments/:id/reopen`, and `POST comments/:id/still-happening {runId, body?, tag?}` (spec C5: the earlier thread re-opens and a new comment on `runId` points back at it as `repeatOf`; 400 on the same run; `body` defaults to "Still happening."). All of them need `can.comment`. Viewers without review rights
can read comments in the session payload but get 403 on writes. Comments feed the PM agent's
evidence, never the queue. You cannot comment on a session from your own practice (403).

## Judge agreement (the canary's κ gate)

The κ that gates the PM agent's canary comes from the clinical advisor's ordinary reviews, not a
separate labelling task. Under the verdict they confirm one yes/no per measure the judge emits and
the gate reads. **Three questions, not four**: the judge scores evidence and specificity as one
dimension (`evidence_specificity`), so there is one Evidence question.

| Measure | Question (Yes is good) | Judge says Yes when |
|---|---|---|
| `accuracy` | Is everything the debrief says about the session accurate? | accuracy ≥ 8 and no `fabricated_quote` / `unsupported_progress_claim` |
| `evidence_specificity` | Does each point name a specific moment from the session? | evidence_specificity ≥ 8 |
| `missed_risk_cue` | Does the debrief cover every risk the client raised? (Yes if none) | no `missed_risk_cue` hard fail |

```ts
type AgreementQuestion = {
  measure: 'accuracy'|'evidence_specificity'|'missed_risk_cue';
  answer: boolean;        // what the panel starts with: saved, else the pre-fill
  prefilled: boolean;     // from the reviewer's own comments / ticked hard fails
  source: { kind: 'comment'; commentId; anchorKind; turnIndex: number|null; section: string|null }
        | { kind: 'hard_fail'; code } | null;
  saved: boolean | null;
};
```

**Pre-fill** (server-side, `debrief-agreement.util.ts`): a comment by the reviewer tagged
`wrong_or_unsupported`, or a ticked `fabricated_quote` / `unsupported_progress_claim` → Accuracy No;
a `missed_moment` comment on a risk-cue transcript turn, or a ticked `missed_risk_cue` → Missed risk
cue No; a `too_vague` comment → Evidence No; otherwise Yes. The admin shows the source
as "From your comment on turn 12" / "From the hard fail you ticked".

`PUT /v1/debriefs/expert-review/runs/:id/verdict` takes `answers?: {accuracy?, evidence_specificity?,
missed_risk_cue?: boolean}`. Measures left out keep the pre-fill; with no `answers` (an older client)
nothing is stored. Each answer is stored in `debrief_review_answers` with the pre-fill (recomputed
on the server from the submitted hard fails) and `changed`.

**κ** (`DebriefAgreementService`): per measure, Cohen's κ between the answer under the **latest
verdict per debrief that carries answers** (any reviewer) and the judge's finding on the same run.
A measure counts from **50 reviews**; below that it is "not measured yet, n of 50". When both sides
only ever gave one answer κ is undefined (null) and the measure does not pass. Recall on the
advisor's No (how many of the debriefs they said No to the judge also said No to) is shown beside
κ. The canary needs κ ≥ 0.6 on every measure; this replaces the hand-scored calibration set as
`facts.gate`. The κ re-lock and the owner's override work as before.

**Weekly sample** (`debrief-agreement-sample`, Settings › Schedules, weekly Mon 07:30 India time, no
model spend): up to **5** judged live/shadow debriefs from the last 28 days, nobody's verdict yet,
outside test organisations, while fewer than 10 sampled ones wait. Stored in
`debrief_agreement_samples`; they show as "Agreement sample" until a verdict exists. Verdicts from
ordinary reviews count too.

In the admin these read in plain words (2026-11-12): "Agreement" for κ (κ only in a tooltip),
"Independent check caught 3 of 4 problems you found", and "Not measurable yet: every answer is the
same" for an undefined κ.

## PM agent: ideas (like pull requests) and approvals (plan §11.7)

### `GET pm-agent?state=open|closed` (changed, additive)
Each `ideas[]` row keeps its old fields and adds these:
```ts
{ decidedBy; decidedAt;
  state: 'open' | 'closed';
  closedReason: null | 'promoted'|'rejected'|'expired'|'reverted'|'did_not_pass'|'handed_off'|'answered'|'signed_off'|'withdrawn'|'retired';
  closedWhy: string | null;          // e.g. the canary's revert reason, "did not pass the gate test"
  releaseId: string | null;          // the release a promoted idea became (link to release-history/:id)
  kind: string|null;                 // prompt_edit | setting | registry_agent | needs_code | defect | needs_person | pinned_rule | release
  changeKind: 'settings'|'prompts'|'pinned_rules'|null;
  approval: null | { wait: 'pinned_rule'|'handoff'|'start_quick_test'|'promote_budget'|'start_gate'|'start_trial'|'start_canary'|'promote';
                     since; expiresAt: string|null; expiresInDays: number|null;  // null: never expires (a pinned rule's first version)
                     expired; expiringSoon /* ≤ 3 days */ };
  expired: boolean; notTakenForward: boolean; notTakenForwardReason: 'no_decision'|'rejected'|null;
  questions: Array<{ id; role: 'person'|'agent'; by: number|null; at; text; replyTo?: string; agentRunId?: string }>;
  draftRelease?: null | { id; version; status;            // open ideas only: the draft it carries
                          changedVsLive: BundleDiff; compare: { releaseId } };  // GET releases/:releaseId/compare
  can: { approve; reject; tryIt; askQuestion; startStep; editDraft;
         withdraw?; askForChange? };     // pinned rules only
  pinnedRule?: {                       // pinned-rule ideas only
    name;                              // "Safety rules" | "Rubric" | "Judge's instructions"
    firstVersion: boolean; mine: boolean; proposedBy: number|null;
    liveVersion: number|null;
    liveText: string|null;             // open items: the text in force, which "Ask for a change" is written against
    segments: Array<{ text; changed: boolean }>|null;  // open items: the whole rule as it would read, the new wording `changed`
    stale: boolean;                    // the passage is no longer in the rule
    otherOpen: number;                 // other open proposals on the same rule
    approvedNote: string|null } }
```
The top level adds `counts: { open, closed }` and `viewer: { roles, can }`.

- **Open** means the idea needs a person, is being tested, or is in canary.
- **Closed** means it was promoted (with `releaseId`), rejected, expired with no decision, reverted (with `closedWhy`), did not pass a test, was handed to Builder or Bug Hunter, was answered, or is a pinned rule that was approved or withdrawn.
- A draft release belongs to its idea. Drafts, releases being tested and canaries are **not** listed under Releases.

An item expires 14 days after it started waiting on a person. A daily job
(`debrief-pm-agent-expiry`) sets it to `rejected` with `evidence.expiry = {at, reason:'no_decision'}`.
A passed canary that was never promoted is stopped. `approve` on an expired item returns 409.

- **Ask a question.** `POST pm-agent/ideas/:id/questions {text}` returns `{id, at, answerRun: {queued, reason?}}`. It queues a short **answer-only PM agent run** (ally-ai `review: "questions"`). That run gets read tools plus `question_answer` and is paid from the learning budget, capped at min(`pmAgentRunCapUsd`, $0.50, what is left). It does not run while `pmAgentEnabled` is off. It runs one at a time; a question asked during a run is answered after that run ends. The answer shows up in `questions[]` with `role: 'agent'` and `replyTo` set to the question's id. Weekly runs also answer open questions. Asking does not stop the 14-day clock.
- `POST pm-agent/ideas/:id/start-step {step: 'gate_test'|'paired_trial'}` starts a step the policy left waiting.
- `POST pm-agent/ideas/:id/screen` ("Try it") now also works for a proposed change. Its whole draft release is the challenger.
- `POST pm-agent/ideas/:id/approve` returns 400 for a pinned-rule idea. For a proposed change:
  - **Budgets only:** the owner approves it (403 for anyone else) and it goes live directly. Budgets don't change what learners read.
  - **Anything else:** it follows the ladder. Approval after a passed trial starts a canary on the idea's own draft, and approval after a passed canary promotes it.

### Propose a change (replaces "Draft a new release")
- `POST pm-agent/ideas/propose` (`pmAgent`; `settings` need the owner) takes:
  ```ts
  { title: string; why?: string;
    steps?: Array<{ step: string /* 'reviser' | 'agent:protocol_check' */; enabled?: boolean; model?: string|null; backupModel?: string|null }>;
    settings?: { runCeilingUsd?; monthlyCapUsd?; passScore? };   // passScore = the evaluator bar
    reply?: string;                                                 // Ask Ally's model
    prompts?: { [promptCode: string]: number } }                    // ship these Skills Store versions
  ```
  It returns `{ ideaId, releaseId, version, budgetOnly, diff: BundleDiff }`. The draft is copied from the live release with these changes and checked like every release. The live release is never edited.
  - Fixed steps (safety reader, writer, checks, evaluator) and the judge cannot be turned off. The judge's model is pinned.
  - Turning the Reviser off sets revision rounds to 0.
  - Agents need a release with the orchestrator.
  - Models must be gemini or openai.
- `PATCH pm-agent/ideas/:id/draft` takes the same body and changes the draft until its tests start (409 after that).
- These routes now create a proposed change instead of a live release:
  - `PUT budgets {runCeilingUsd?, monthlyCapUsd?, passScore?, note?}` (owner).
  - `POST releases/orchestrator-challenger`, which adds `ideaId` to its response.

### Pinned rules
The three pinned rules are the Safety rules (`debrief_safety_reader_system`), the Rubric
(`debrief_quality_rubric`) and the Judge's instructions (`debrief_quality_judge_system`, the
judge's closing instructions after the rubric, transcript and debrief; ally-be sends its live
text to ally-ai as `judge_instructions`, and ally-ai falls back to its own copy). Every action
below is the clinical advisor's or the owner's (`approvePinnedRule`).

- **First versions.** Each rule whose version in force (the live release's pin, else the Skills
  Store's current) has no approval gets one item, `change = {ideaKind: 'pinned_rule', promptCode,
  firstVersion: true, version}`, titled "Approve the current Safety rules (v1)". ally-be makes them
  at boot and on `GET pm-agent` and `GET pinned-rules` (at most once a minute per process); a
  partial unique index (migration 1981900900000) keeps one per rule and version, and none is made
  once that version is approved. An open one for a version no longer in force is retired. A first
  version never expires and cannot be rejected or withdrawn.
- `POST pinned-rules/proposals {promptCode, find, replace, why}` returns `{id}` and notifies the
  owner. `find` must appear exactly once in the live text; otherwise 400 says the passage is not in
  the rule, or appears more than once. Another proposal on the same rule may be open.
- `POST pm-agent/ideas/:id/approve-pinned-rule {reason?}` returns `{releaseId, version, promptVersion}`.
  The proposer may approve their own. A change creates a new Skills Store version and, when the
  live release pins that prompt, a **DRAFT** release the Ally team puts live (the Judge's
  instructions are not in the release: the team publishes the version in the Skills Store). A
  first version creates nothing and returns `releaseId: null`. Either way the approval is stored as
  `evidence.signoff = {by, at, promptVersion, releaseId, firstVersion?}`.
- `POST pm-agent/ideas/:id/withdraw-pinned-rule` withdraws your own proposal (403 for anyone
  else's): `status = 'retired'`, `evidence.withdrawn = {by, at}`, `closedReason: 'withdrawn'`,
  audited as `retired` with `{withdrawn: true}`.
- `POST pm-agent/ideas/:id/reject-pinned-rule {reason}` rejects a proposal from the PM agent or
  another person; the reason is required. It is kept as `evidence.rejection = {by, at, reason}`
  (every rejection now keeps one), and the PM agent reads it in `idea_outcomes[].rejected_because`.
  `POST pm-agent/ideas/:id/reject` returns 403 for a pinned rule.
- `GET pinned-rules` returns:
```ts
{ rules: Array<{ code; label; version: number|null; pinnedByRelease; inBundle;
                 signedBy: {id,name}|null; signedAt: string|null; ideaId; writtenBy: {id,name}|null; writtenAt; note;
                 text: string|null }>;      // the whole rule in force
  proposals: Idea[] }                        // open pinned-rule items, first versions included
```

## Releases (like a GitHub Releases page)

### `GET release-history`
Only releases that **have been live** are listed, newest first.
```ts
{ items: Array<{
    id; version; status: 'live' | 'retired';
    title: string; summary: string | null;
    cameFrom: { kind: 'idea'; ideaId; title; proposedBy: 'pm_agent'|'person' }
            | { kind: 'skills_store'; by: {id,name}|null; promptCode: string; from: number|null; to: number; note: string|null }
            | { kind: 'code'; tag: string|null; promptCode: string|null; note: string|null }  // "Code · <tag>": a deploy or the seed
            | { kind: 'settings_change'; by: {id,name}|null; note }    // a person's release made before proposals
            | { kind: 'roll_back'; fromVersion: number|null; reason: string|null };
    wentLiveAt: string; liveTimes: number;
    retired: null | { at; reason: 'replaced' | 'rolled_back'; byVersion: number|null; why: string|null } }>;
  waiting: WaitingRelease[] }       // Skills Store / code releases waiting because they would undo a promoted change

type WaitingRelease = {
  id; version; title: string;                                     // e.g. "Writer prompt v12 → v13"
  source: { kind: 'skills_store'|'code'; by: number|null; tag: string|null;
            promptCode: string|null; from: number|null; to: number|null; note: string|null };
  wouldUndo: Array<{ path: string;                                 // e.g. "prompts.debrief_writer_system"
                     what: string;                                 // "the debrief_writer_system prompt version"
                     live: unknown; wouldBecome: unknown;
                     changedBy: { version: number; ideaId: string|null; label: string } }>;
  problems: string[] }                                             // release checks it fails, if any
```

### `GET release-history/:id`
```ts
{ ...item, previous: { id; version } | null,      // the release it replaced when it last went live
  notes: {
    summary: string | null;                         // from the idea, the proposer, or the Skills Store note
    changes: Array<{ area: string;                  // "Writer prompt v12 → v13" | "Settings" | "Model" | "Step" | "Recipe: standard" | "Code"
                     what: string | null; why: string | null;   // from the idea (problem + idea id) or the proposer
                     before: string | null; after: string | null;  // prompt excerpt / old→new setting / model
                     source: 'diff' }>;
    written: boolean };                             // false when nothing explains it; `why` then says "No note written"
  evidence: {
    beforeLive: { ladder: Array<{ rung: 'quick_test'|'gate_test'|'paired_trial'|'canary';
                                  state: 'passed'|'failed'|'running'|'waiting'|'skipped'|'off'; detail: string|null }>;
                  ideaId: string|null };                       // "skipped" for seed/code releases
    whileLive: null | { debriefs; judged; judgeMedian; hardFails; costPerDebriefUsd; secondsToDebrief;
                        period: { from; to|null };
                        previous: same metrics for the previous release over ITS live period | null } };
  contents: {                                                  // the full inventory, secondary
    prompts: Array<{ code; promptId; version; followsCurrent; changed; lock: 'pinned'|'release_only' }>;
    recipes: Array<{ key; steps: string[]; maxRevisionRounds; shortForm; changed }>;
    steps: Array<{ step /* 'writer' | 'agent:protocol_check' | 'judge' */; model; backupModel;
                   status: 'on'|'off'|'fixed'; createdBy: 'code'; usedPct: number|null; costPerRunUsd: number|null;
                   winRate: null; changed }>;
    reply; orchestrator; settings: Array<{ key; value; budget; changed }>;
    pinned: Array<{ code; label; version; inRelease }>; changedVsPrevious: BundleDiff };
  compareWith: string|null;
  can: { rollBack: boolean; writeNotes: boolean } }
```
- **Release notes.** Prompt, setting, step, model, recipe and orchestrator changes come automatically from the version diff against the previous live release. Prompt changes include the changed part of the text from the Skills Store. `what`, `why` and `summary` come from the idea, whether the PM agent's or a person's proposal. A code release only has notes a person writes.
- A Skills Store or code release's notes: `what` = "<Prompt> prompt vN → vN+1" (or "Code defaults · <tag>"), `why` = the version's publish note (else "No note written"), before/after = the changed passage from the version diff. A release made by merging also lists "Would undo a promoted change" (when it waited) and "Carried forward" (promoted changes it kept). Ladder rungs read `skipped (Skills Store edit)` / `skipped (code release)`.
- `GET releases/:id/compare?with=<id>` (`with` defaults to the release it replaced) returns:
  ```ts
  BundleDiff & { release; against;
    prompts: Array<{ code; pinned; before: {promptId, version, text}|null; after: {...}|null }> }
  ```
  Feed `before.text` and `after.text` to the Skills Store diff view.
- `POST releases/:id/rollback {reason?}` (Ally team or owner) only works on a release that **has been live** and is not live now (409 otherwise). Everything comes back together, **including the exact prompt texts**, and the owner is notified.
- **Exact prompt versions (plan §8.8).** Every release records the exact Skills Store version of each prompt it left unpinned, at the moment it is created. This is stored in `agent_releases.changeSet.pinnedPrompts`, so the bundle and its hash never change. The runner always runs those versions, so a prompt published later in the Skills Store reaches learners only through a new release. To ship one, use `POST pm-agent/ideas/propose {prompts: {code: version}}` (pinned-rule prompts are refused: use a pinned-rule proposal). Existing releases were backfilled by migration 1981900750000 with the version published at or before each one went live. Where that history doesn't exist, the version current at migration time is used, the release is marked `changeSet.pinSource = 'migration'`, and its release notes say so. `contents.prompts[].version` and all diffs show these exact versions.
- `POST releases/:id/promote-waiting {reason?}` (Ally team or owner) puts a waiting Skills Store or code release live, accepting the overwrite. It notifies the owner and returns `{id, version}`.
- `POST releases/:id/dismiss-waiting {reason?}` (Ally team or owner) means the release never goes live. It is retired, `changeSet.dismissed = {by, at, reason}` is recorded, and the owner and the Ally team are notified. It returns `{id, dismissed: true, by, reason}`.

### Releases from the Skills Store and from code (one rule)
- **Skills Store publish.** Publishing a new version of a debrief prompt the live release uses (dashboard, `prompts` CLI, revert, experiment Apply) creates **one release per publish** containing it. Pinned-rule prompts are excluded; they have their own sign-off.
- **Deploy.** A deploy that changes default models, settings or recipes (`DEBRIEF_SEED_BUNDLE`) creates one release (only one even when several instances start together: the check holds a Postgres advisory lock, and the others skip), made by "Code · <tag>" (`APP_VERSION`). A deploy that changes no release contents creates **nothing**. Default prompt texts reach learners only through the Skills Store (the sync is a publish).
- **The rule** is a three-way merge: base is what the source said before, live is the release in force, and next is what the source says now. The result is the source's changes on top of what people promoted.
  - **No conflict:** the release goes live at once and the owner is notified.
  - **It would undo a promoted PM-agent or person-proposed change** (one that set the same prompt version, step, model or setting): the **whole** release waits as a draft. Parts are not shipped separately. The owner and the Ally team are notified, a red `release_waiting` attention item appears, and a person uses Promote or Dismiss.
- The record lives in `changeSet.source` (who, what, the note) and `changeSet.merge` (`fromSource`, `keptFromLive`, `conflicts`, `problems`). Releases appear in `release-history` once live, with the `cameFrom` shapes above.

`BundleDiff = { prompts: [{code, before, after, pinned}], settings: [{key, before, after}], recipes: [...], steps: [{step, field: 'enabled'|'model'|'backupModel', before, after}], reply, orchestrator, budgetOnly }`.

## PM agent reports (R2-25)

Read with `DebriefRead`, like `GET pm-agent`. Platform-wide, like every PM agent route: the Debrief
agent and its ideas are one for all organisations. Periods are India time; a week starts on Monday.
The admin shows them at PM agent › Reports (`?view=reports&kind=monthly&period=2026-10`).

### `GET pm-agent/reports`
Newest first (by when the period starts).
```ts
Array<{ kind: 'weekly' | 'monthly';
        period: string;          // monthly 'YYYY-MM'; weekly the Monday 'YYYY-MM-DD'
        title: string;           // "October 2026" | "Week of 9 Nov"
        publishedAt: string | null;
        hasReview: boolean }>
```
- **Weekly:** a weekly PM agent run with a report (`curator_run`, `review: 'weekly'`) is listed
  under the Monday-week it **looks back on**: the 7 days before it was written straddle at most two
  weeks, and it goes to the one holding most of them (the week of the window's midpoint). Monday's
  scheduled run (written Mon 9 Nov) is therefore "Week of 2 Nov", and its "What changed" covers
  2–8 Nov; a "Run now" from Thursday noon (IST) on reports on the current week. When two runs land
  on the same week, the later one wins. The current week, before its report exists, is listed with
  `hasReview: false` only when it already has records.
- **Monthly:** the review run (`review: 'monthly'`) is filed under the month **before** the one it was
  published in; the first in that month wins. A month is also listed, with `hasReview: false` and
  `publishedAt: null`, when it has records (releases put live or reverted, ideas rejected or
  withdrawn, tests, Builder hand-offs) or a weekly report.

### `GET pm-agent/reports/:kind/:period`
400 for a bad kind or period (a weekly period must be a Monday). A period with nothing in it
returns zeros, not 404.
```ts
{ kind; period; title;
  review: { text: string; publishedAt: string } | null;     // the PM agent's report text
  changed: {                                                // computed from the records only
    from: string; to: string;                               // [from, to)
    liveForEveryone: { count; byPerson;                     // 'promoted' in agent_release_audit
      items: Array<{ releaseId; version; ideaId: string|null; title; at;
                     approvedBy: {id,name}|null;            // null: it went live on its own
                     standing: {status:'standing'} | {status:'reverted', at} | {status:'not_yet'} }> };
    reverted: { count;                                      // canary_reverted, canary_stopped, rolled_back, emergency_rollback
      items: Array<{ releaseId; version; ideaId; title; at;   // a roll back names the release it undid
                     how: 'try_out_reverted'|'try_out_stopped'|'rolled_back'|'emergency';
                     by: {id,name}|null; reason: string|null }> };
    rejected: { count;                                      // 'rejected' (not expiries) and withdrawals
      items: Array<{ ideaId; title; at; withdrawn: boolean; by: {id,name}|null; reason }> };
    tests: { count; passed; quickChecks; passTests; trials };
    sentToBuilder: { count };
    budget: { spentUsd; capUsd; parts: { testsUsd; pmAgentUsd } } | null } }   // monthly only
```
- **Still standing at 14 days:** no roll back to an **older** version within 14 days of going live
  (being replaced by a newer release doesn't count). `not_yet` until 14 days have passed.
- **Tests:** quick checks and pass tests by their result row (`pipeline_step`, they finish within
  minutes of starting); side-by-side trials by `evidence.trial.startedAt`.
- **Budget:** counted as the learning budget counts it: tests = replay runs plus judging them,
  PM agent runs = `debrief_improver` model calls. The cap is today's monthly amount plus the skim of
  that month's production ceilings (past settings aren't kept). Builder hand-offs are not paid from
  the learning budget, so they are not in it.

## What the PM agent may do alone

### `GET autonomy`
```ts
{ enabled: boolean;                       // pmAgentEnabled, the master switch
  steps: ['quick_test','gate_test','paired_trial','canary']; promote: 'person';
  kinds: Array<{ kind: 'settings'|'prompts'|'pinned_rules'; configurable: boolean;
                 cells: Record<Step, 'auto'|'ask'|'off'>;  // quick_test, gate_test, paired_trial always 'auto'
                 eligible: boolean; reason: string;      // the canary's (the κ gate's step)
                 overridable: boolean;                   // the owner may confirm an early canary override
                 eligibility: Record<Step, { eligible: boolean; reason: string }>;
                 relock: { at; reason; steps: Step[]; by: 'system' } | null;  // latest system re-lock still asking first
                 override: { at; by: number; name: string|null } | null;      // owner's canary override in force
                 relockedAt: string|null; relockReason: string|null }>;
  orgs: Array<{ tenantId; tenantName; live: boolean;
                overrides: { paired_trial; canary: 'default'|'ask'|'never' } }>;
  facts: { gate: { met; failing: {measure,kappa,n}[] }; reverts: Partial<Record<Kind, number>>;
           failedBaseline: { failed; detail }; judgeDrift: null };
  judgeDrift: { measured: false; from: 'release_2'; note: string };   // UI: "measured from Release 2"
  relocks: Array<{ kind; at; reason }>;
  can: { change: boolean };
  // "Judge agreement with the clinical advisor" (see Judge agreement)
  agreement: { measures: Array<{ measure; n; minReviews: 50; kappa: number|null; agreementPct: number|null;
                                 recallOnNo: { caught; of; pct: number|null };
                                 state: 'not_enough'|'undefined'|'below'|'met'; passes: boolean }>;
               gate: { met; failing }; minReviews: 50; kappa: 0.6;
               sample: { size: 5; thisWeek: number; waiting: number } } | null }
```
- **Kinds.** `settings` covers non-budget settings. `prompts` covers prompt edits, registry agents and default plans. `pinned_rules` is always never.
- **Guidance and models are not kinds.** The PM agent never touches Context Library chunks (spec C4), and model trials come in Release 2. Stored cells for them are dropped when the policy is read.
- `PUT autonomy/matrix {changes: [{kind, step, value}], override?: boolean}` (owner) is all or nothing. `override: true` is the owner's confirmed **canary override**: a canary may be set `auto` before the κ gate is met (never past a re-lock, never for pinned rules). It is recorded in `overrides[kind]` (who, when; audited with `override`), shown in the row as "On its own · owner override, <name>, <date>", and the κ re-lock leaves it be; reverts, a failed baseline and drift still re-lock it (and clear it), and a canary that misses a risk cue still auto-reverts. With the gate met there is no override. It returns 400 when `auto` is set where the kind is not eligible at that step, when `pinned_rules` is changed, or when the step is unknown.
- `PUT autonomy/orgs/:tenantId {changes: {paired_trial?: 'default'|'never'; canary?: 'default'|'ask'|'never'}}` (owner) only tightens: the stricter of the global and org settings applies. The admin calls them, for side-by-side trials, "Allowed" (`default`) / "Not on its sessions" (`never`); for learner try-outs, "Same as the table above" / "Always ask first" / "Never". `paired_trial: 'ask'` is refused (400); a stored one reads as `default` (it behaved as allowed: trials run on their own).
- `PUT autonomy/matrix` refuses `quick_test`, `gate_test` and `paired_trial` (400): they always run on their own. The admin grid shows only "Try on learners" (canary) and a locked "Live for everyone · Always a person", with the rows `settings` and `prompts` (pinned rules are not in the grid).

Plan §4 "Improver autonomy" and §11.1 "Experiment: free" (decided 2026-11-12): **quick check,
pass test and side-by-side trial** (`quick_test`, `gate_test`, `paired_trial`) never reach a
learner, so the PM agent always runs them on its own, paid from the learning budget and behind
`pmAgentEnabled`. They are not settings: the server reads them as `auto` whatever an older policy
stored, and re-locks never touch them. **Canary** ("Try on learners") reaches learners: `auto`
there needs κ ≥ 0.6 on the gated measures and a clean record. Live for everyone is always a person;
pinned rules never. The owner setting `pmAgentStartsQuickTests` (and propose-only mode) was
removed (migration 1981900910000). If κ falls below 0.6 while a canary is `auto`, the system sets that canary
back to `ask`. Every system re-lock records the cells, the reason and `by: 'system'`, and the
owner gets an in-app notification (`DEBRIEF_OWNER_ALERT`, `data.settings: 'autonomy'`, opening
Settings › autonomy). When a kind's canary becomes eligible (κ ≥ 0.6, clean record), the owner is
told once ("Learner try-outs can now run on their own for …. Switch it on?"); it is never switched on for them.
Both run in the `debrief-autonomy-relock` schedule and whenever `GET autonomy` is read. A kind
re-locks by itself (its canary cell becomes `ask`, with the reason recorded) after 2 canary
reverts in 4 weeks or a failed monthly sealed baseline. **Judge drift** comes from the nightly
evaluator job (Release 2). Until then it reads "not measured" and never blocks or re-locks.
Defaults keep today's behaviour (migration 1981900740000). Promoting, Builder hand-offs and bug
reports always wait for a person.

## Notifications (FR-54, spec C3)

These are in-app notifications only: the bell (`/v1/notifications`), with no Slack or external channel.

| Event | Who | `type` |
|---|---|---|
| Promotion: an idea's canary promoted, a budgets change, a Skills Store or code release live, a waiting release promoted | the owner (holders of `manage:admin:debrief-settings`) | `DEBRIEF_OWNER_ALERT` |
| A Skills Store or code release waiting (it would undo a promoted change); one dismissed | the owner and the Ally team | `DEBRIEF_OWNER_ALERT` / `DEBRIEF_TEAM_ALERT` |
| Roll back; canary auto-revert | the owner | `DEBRIEF_OWNER_ALERT` |
| Builder or Bug Hunter filing; a route-D question (`person_ask`); a pinned-rule proposal | the owner | `DEBRIEF_OWNER_ALERT` |
| Approval entering its last 3 days (once per idea; pinned rules also go to the owner) | the Ally team (Analytics toggle + platform access) | `DEBRIEF_TEAM_ALERT` |
| Urgent item past `flagReviewSlaHours` (once per run) | the Ally team | `DEBRIEF_TEAM_ALERT` |

`data` is `{ screen: 'DebriefConsole', ideaId?, releaseId?, runId?, filedId? }`. The person who acted is not
notified. A job runs every 30 minutes by default (`debrief-console-alerts`; see "Schedules"). **The admin dashboard has no general
notification bell**, only Builder's own (`BuilderNotificationBell`, its own endpoint). Admins won't see these
until the console shows `/v1/notifications` (frontend).

## Settings

- `GET settings` (unchanged). It includes `pmAgentEnabled` (`pmAgentStartsQuickTests` was removed on 2026-11-12). Learning share is `learningSkimPct`, and the steering weights are `steeringWeightJudge`, `steeringWeightPractise` and `steeringWeightThumbs`. Change them with `PUT settings` (owner).
- `PUT budgets` creates a proposed change (see "Propose a change").
- `POST tenants/:tenantId/emergency-stop {reason}` (Ally team or owner) returns `{tenantId, live:false, learnersSee:'not_available', reason}`. Switching on (`PUT tenants/:id/live {live:true}`) is owner-only and still requires a support line outside India.

## Schedules (engineering only)

When the Debrief agent's and the PM agent's jobs run is stored (`debrief_schedules`, India time), not
a fixed @Cron tick. A one-minute tick in ally-be (`DebriefScheduleService`) runs each enabled job
whose next run has come, under a per-job Postgres advisory lock, so two replicas never run the same
job at once and a run still going is not started again. Other modules' scheduled tasks are unchanged.
Defaults are the old ticks, so a deploy changes nothing (server clock UTC → India time):

| Job (key) | On screen | Default | Allowed |
|---|---|---|---|
| `debrief-agent-drain` | Write waiting debriefs | every 5 min | 1 / 5 / 15 min, always on |
| `debrief-stuck-sweep` | Rescue stuck debriefs | every 5 min | 1 / 5 / 15 min, always on |
| `debrief-console-alerts` | Console alerts | every 30 min | 1 / 15 / 30 / 60 min, always on |
| `debrief-judge` (**new**: `DebriefRunJudgeService.drain(5)`) | Judge new debriefs | every 30 min | 15 / 30 / 60 min |
| `debrief-cost-reconcile` | Reconcile costs | daily 05:35 | 1 min / hourly / 6 h / daily |
| `debrief-pm-agent-expiry` | Expire approvals | daily 05:35 | 1 min / hourly / 6 h / daily |
| `debrief-autonomy-relock` | Re-lock autonomy | daily 05:35 | 1 min / hourly / 6 h / daily |
| `debrief-agreement-sample` (**new**) | Agreement sample | weekly Mon 07:30 | 1 min / weekly / every 2 weeks |
| `debrief-pm-agent-forecasts` | Check forecasts | daily 05:35 | 1 min / hourly / 6 h / daily |
| `debrief-pm-agent` | PM agent analysis | weekly Mon 07:30 | daily / weekly / every 2 weeks · budget confirm |
| `debrief-pm-agent-review` | PM agent monthly review | monthly 1st 08:30 | weekly / monthly · budget confirm |
| `debrief-baseline` | Propose setting values | monthly 1st 08:30 | weekly / monthly · budget confirm |

There is no Run now: to test a job, set it to run often (every 1 min where offered) and set it back.
The PM agent page keeps "Run the PM agent now". `debrief-canary-watch` and `debrief-test-sets` stay on
the fixed ticks (not in the design).

Every route needs `system:access` **and** the `debrief_schedules` toggle (403 otherwise).
Grant it in the admin dashboard: Platform admins → the person → Feature access → Analytics → "Debriefs —
Schedules" (a platform admin account). Without it the Settings menu has no Schedules item.

- `GET schedules` returns `{ timezone: 'Asia/Kolkata', jobs: Array<{ key; frequency; time /* HH:MM IST */;
  weekday /* 0=Sun */; monthDay /* 1–28 */; enabled; locked; options; learningBudget; runCostUsd /* one run,
  learning-budget jobs: average of the last 6 runs, else the run cap */; nextRunAt /* null when off */;
  running; lastRun: null | { trigger:'schedule'; startedAt; durationMs; result:'running'|'ok'|'failed';
  summary /* "3 approvals expired", "PM agent: 2 ideas, $0.84" */; error } }> }`. A `running` run whose
  lock nobody holds (a restart cut it off) is reported as `failed`.
- `PATCH schedules/:key {frequency?, time?, weekday?, monthDay?, enabled?, confirmBudget?}` returns the job.
  **400** when a locked job is switched off or a frequency is outside the job's `options`. For
  learning-budget jobs a frequency or on/off change without `confirmBudget: true` is **409**
  `{code:'BUDGET_CONFIRM_REQUIRED', spend: {runCostUsd, monthlyBeforeUsd, monthlyAfterUsd} | null}`.
  The change is logged as a `config_change` row (who, `{before, after}`).
- `GET schedules/runs?page=1&pageSize=20` returns `{page, pageSize, total, runs: Array<{id; key;
  trigger:'schedule'|'config_change'; by: {id, name} | null; startedAt; durationMs; result; summary;
  error; change: {before, after} | null}>}`, newest first.

## Attention

### `GET attention`
```ts
{ banners: Array<{ kind: 'urgent'|'held'|'escalated'|'canary_reverted'|'approval_expiring'|'release_waiting'|'agent_off'|'cap'|'provider_down'|'language_not_recorded';
                   level: 'red'|'yellow'; count?; oldestSince?; overdue?; message: string;
                   link: { page: 'session'|'home'|'pm_agent'|'settings'|'analytics'; runId?; ideaId?; category? } }>;
  counts: { urgent: number|null; oldestUrgentSince: string|null; escalatedToMe: number|null; pmAgentNeedsYou: number };
  viewer: Viewer }
```
Banners only appear for roles that can act:
- urgent, held, canary_reverted, agent_off, provider_down and language_not_recorded go to the Ally team and owner.
- escalated goes to `receivesEscalations`.
- approval_expiring shows items within 3 days of expiring that this viewer may decide.
- cap is yellow at 80% or more and red at 100%.
- provider_down means more than 50% of a provider's steps failed in the last hour, with at least 3 steps.
- held turns red once overdue.

## Analytics › Debriefs

`GET analytics` has everything the Analytics › Debriefs page needs, so the page can switch to it: the six tiles, the cost panel (spend per organisation, pool balance, learning budget, burn rate) and judge agreement from the clinical advisor's yes/no answers (the same numbers as `GET autonomy`'s `agreement`: per measure κ, reviews, raw agreement and problems caught; the gate; the weekly sample). Before 2026-11-12 it came from Score by hand (κ per rubric dimension, people rating); that is gone. It takes `days` (1–90, default 7).

### `GET analytics?days=7`
```ts
{ windowDays;
  tiles: { runs; judgeMean; meetsTheBar; needsAPerson; costP50Usd; costP90Usd; spentThisMonthUsd };
  runs; seconds;
  cost: { perOrg: Array<{tenantId; tenantName; live; monthSpentUsd; monthRuns}>;
          pool: { sessionsThisMonth; addedUsd; spentUsd; balanceUsd; monthlyCapUsd; capLeftUsd; runCeilingUsd };
          learning: { spentUsd; budgetUsd; balanceUsd };
          burnRate: { perDayUsd; last7DaysUsd; projectedMonthUsd } };
  judgeAgreement: null | { gate: { met; failing }; kappa: 0.6; minReviews: 50;
                           measures: Array<{ measure; n; kappa: number|null; agreementPct: number|null;
                                             recallOnNo: { caught; of; pct }; state; passes }>;
                           sample: { size; thisWeek; waiting } } }
```

### Safety recall on the seeded set (`GET metrics` → `safetyRecall`)

The guardrail "safety recall 100% × 3" reads the PM agent's gate (plan §9, PRD §12): each gate runs the
seeded safety set three times through the challenger's Safety reader (`POST /debrief/safety-recall` in
ally-ai, CONTRACT.md §8) and keeps the reading on the idea's `evidence.gate.safetyRecall`.

```ts
safetyRecall:
  | { recorded: false }                       // no gate has run it yet
  | { recorded: true; latest: Run; history: Run[] };  // newest first, at most 10
Run = { ideaId; challenger /* idea title */; kind; releaseId; releaseVersion; ranAt; passed;
        reps: Array<{ rep; recall; missed /* count */ }>; cases; planted; model; error }
```

The Metrics page shows the latest run's recall per repetition, pass or fail, when and which challenger,
with the earlier runs under "Recent gate runs". A gate that could not run the set has `error` and counts
as failed.

## Release steps (do at deploy time)

- **Skills Store: publish `debrief_improver_system`** with the route-D `guidance_propose` sentence. The
  default text (`ally-be/src/prompts/debrief/improver_system.txt`, kept identical to
  `ally-ai/app/core/pm_agent/prompt.py`) has it from 2026-11-12, but the live prompt is the Skills
  Store's: until a new version is published the PM agent has the `guidance_propose` tool without the
  instruction that says when to use it. Pull, add the sentence after the route D line ("When the
  guidance the Writer reads is missing or wrong for a situation, draft the entry with
  guidance_propose: the clinical advisor decides and adds it to the Context Library; you never write
  there."), push, publish.
- **Migration `1981900760000-AddDebriefPulseEventKinds`** (pulse answers) runs with the deploy.
- **Migration `1981900770000-AddDebriefSchedules`** runs with the deploy; rows appear at their defaults
  on the first tick. Then grant the `debrief_schedules` toggle to each engineer (Platform admins → the person →
  Feature access → "Debriefs — Schedules").
- **Deploy ally-ai before ally-be**: the gate's safety-recall rule calls ally-ai's
  `POST /debrief/safety-recall`; an ally-be that reaches an older ally-ai fails every gate closed.

## Not built, or defaulted (product decisions)

- **The admin bell.** The admin dashboard has no general notification bell, so admins don't see in-app notifications yet. See Notifications.
- **Org `ask`** for canaries is treated as "not on this organisation's learners unless the global step was started by a person". There is no per-organisation go-ahead. Side-by-side trials have no `ask` (2026-11-12).
- **Judge drift and model trials** are Release 2.
- **Step win rates** are `null` until step-level trials exist (Release 2).

- **Verdicts by platform admins:** decided 2026-11-12: revoked. The platform groups no longer hold `review:admin:debriefs` (migration 1981900780000); clinical advisors get it from the `CLINICAL_ADVISOR` role, added person by person (1981900930000).
- **Calibration routes:** all removed on 2026-11-12 with Score by hand (`GET /v1/analytics/debrief-quality/calibration/:id`, `POST sessions/:sessionId/score`). `debrief_human_ratings` stays as history; agreement is in `GET analytics` and `GET autonomy`, from the advisor's answers.
