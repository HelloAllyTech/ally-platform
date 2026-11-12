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

## Roles and who can act

No new roles were created. The console uses the existing groups and adds one new permission.

| Role | Held as | Notes |
|---|---|---|
| Ally team | `system:access` (PLATFORM_ADMIN, SUPER_ADMIN, SUPER_DUPER_ADMIN) | The platform tier that already reaches the console |
| Clinical advisor | `review:admin:debriefs` | Granted person by person; no group holds it (migration 1981900780000 revoked it from the platform groups). Advisor routes need it alone, never `system:access` |
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
| `score` | in the scoring sample only (403 otherwise) | yes | no | `sessions/:sessionId/score`, `GET /v1/analytics/debrief-quality/calibration/:id` (the Score by hand item) |
| `pmAgent` | yes | no | yes | `pm-agent/analyse`, `ideas/:id/screen`, `approve` (a budgets-only change: owner), `reject`, `questions`, `start-step`, `ideas/propose` and `ideas/:id/draft` (with `settings`: owner); `pinned-rules/proposals` |
| `approvePinnedRule` | no | yes | yes | `pm-agent/ideas/:id/approve-pinned-rule` |
| `testSets` | yes | no | yes | `test-sets/build` |
| `releases` | yes | no | yes | `releases/orchestrator-challenger`, `releases/:id/rollback`, `releases/:id/promote-waiting`, `releases/:id/dismiss-waiting`, `sessions/:sessionId/run` |
| `switchOrgOn` | no | no | yes | `tenants/:id/live` with `live: true` (403 for the Ally team), `tenants/:id/region` |
| `emergencyStop` | yes | no | yes | `tenants/:id/live` with `live: false`, `tenants/:id/emergency-stop` |
| `ownerSettings` | no | no | yes | `settings` (PUT), `settings/accept`, `settings/baseline`, `budgets`, `autonomy/matrix`, `autonomy/orgs/:id` |

The clinical advisor's routes (verdict, comments, Score by hand item and save, escalated flags,
pinned-rule sign-off) accept `review:admin:debriefs` without `system:access`; the Ally team's
actions stay on `system:access`. Platform admins no longer hold `review:admin:debriefs` (migration
1981900780000), so they give no verdicts and sign off no pinned rules unless granted it by hand.

"Escalated to you" (the bar, the banner and the `escalated` count) goes only to
`roles.receivesEscalations`. That is an advisor named with the clinical-advisor toggle, or a
`review:admin:debriefs` holder who is not on the Ally team.

```ts
type Viewer = {
  roles: { allyTeam: boolean; clinicalAdvisor: boolean; owner: boolean; receivesEscalations: boolean };
  can: Record<'comment'|'flagDecision'|'heldDebrief'|'escalate'|'verdict'|'score'|'pmAgent'|
              'approvePinnedRule'|'testSets'|'releases'|'switchOrgOn'|'emergencyStop'|'ownerSettings', boolean>;
  scorer: boolean; // shows the "To score" category and "!" badge
};
```

### `GET me`
Returns `{ userId: number } & Viewer`.

## Home list

### `GET sessions`
Query: `category` = `needs` (default) | `flagged` | `below` | `published` | `escalated` |
`to_score` | `agreement_sample` | `all`; `tenantId`; `language`; `recipe` (`standard`|`short`|`case`|`assessment`);
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
  counts: { needs; urgent; flagged; below; published; escalated; toScore: number | null; all }; // same filters
  items: Array<{
    runId; sessionId; scenario: { id: string|null; title: string|null };
    tenantId; tenantName; language; recipe; mode; status; skipReason; releaseVersion;
    judgeOverall: number|null; evaluatorOverall: number|null; costUsd; ceilingUsd; seconds; fallbackRung;
    createdAt; rank: 0|1|2|3; needsPerson; urgent; flagged; flagCount; importantMomentFlagged;
    escalated; riskCue; learnerDistress; belowBar; reviewed;
    inMyScoringSample: boolean; toScore: boolean; waitingSince: string|null;
    agreementSample: boolean;            // in the weekly agreement sample, no verdict yet
  }>;
  filterOptions: { tenants: {id,name}[]; languages: string[]; recipes: string[]; fallback; riskCue; cost; modes };
  viewer: Viewer;
}
```

`agreement_sample` (counts: `agreementSample`, null unless `can.verdict`) lists the weekly random
agreement sample's runs that have no verdict yet (see "Judge agreement" below).

`toScore` and `inMyScoringSample` come from the calibration sample (the seeded, stratified sample
`DebriefCalibrationService.getSample` draws). They are only computed when `can.score` is true.

## One session

### `GET sessions/runs/:runId` (read; audited like every console view)

```ts
{
  run: { id; sessionId; mode; status; skipReason; language; languageSource; recipe; releaseVersion;
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
  scoring: { inMyScoringSample: boolean; scoredByMe: boolean };
  queue: { position: number|null; total; previousRunId: string|null; nextRunId: string|null }; // Previous/Next, j/k
  pendingActions: PendingAction[];       // the "waiting on you" bar, for THIS viewer's role
  viewer: Viewer;
  can: { comment; decideFlags; publish; showTodaysDebrief; looksFine; correct; escalate; verdict; score; runAgain };
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
`wrong_or_unsupported`, `tone`, `advice_doesnt_fit` and `good_keep_this` (plus the older `protocol`, `language`
and `too_long_or_unclear`). `PATCH comments/:id {body?, tag?}`, `DELETE comments/:id`,
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
cue No; otherwise Yes. No tag maps to Evidence today, so it starts Yes. The admin shows the source
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

## Score by hand

`POST sessions/:sessionId/score` takes `{ scores: Record<dimension, 0..10>, hardFails: string[], note? }`. It is stored
as the calibration rating (Analytics › Debriefs; since the advisor's yes/no answers it no longer feeds the canary's κ gate). The Ally team can only score sessions in the scoring sample (403
otherwise). It returns 404 when the judge has not scored the session.

## PM agent: ideas (like pull requests) and approvals (plan §11.7)

### `GET pm-agent?state=open|closed` (changed, additive)
Each `ideas[]` row keeps its old fields and adds these:
```ts
{ decidedBy; decidedAt;
  state: 'open' | 'closed';
  closedReason: null | 'promoted'|'rejected'|'expired'|'reverted'|'did_not_pass'|'handed_off'|'answered'|'signed_off'|'retired';
  closedWhy: string | null;          // e.g. the canary's revert reason, "did not pass the gate test"
  releaseId: string | null;          // the release a promoted idea became (link to release-history/:id)
  kind: string|null;                 // prompt_edit | setting | registry_agent | needs_code | defect | needs_person | pinned_rule | release
  changeKind: 'settings'|'prompts'|'pinned_rules'|null;
  approval: null | { wait: 'pinned_rule'|'handoff'|'start_quick_test'|'promote_budget'|'start_gate'|'start_trial'|'start_canary'|'promote';
                     since; expiresAt; expiresInDays; expired; expiringSoon /* ≤ 3 days */ };
  expired: boolean; notTakenForward: boolean; notTakenForwardReason: 'no_decision'|'rejected'|null;
  questions: Array<{ id; role: 'person'|'agent'; by: number|null; at; text; replyTo?: string; agentRunId?: string }>;
  draftRelease?: null | { id; version; status;            // open ideas only: the draft it carries
                          changedVsLive: BundleDiff; compare: { releaseId } };  // GET releases/:releaseId/compare
  can: { approve; reject; tryIt; askQuestion; startStep; editDraft } }
```
The top level adds `counts: { open, closed }` and `viewer: { roles, can }`.

- **Open** means the idea needs a person, is being tested, or is in canary.
- **Closed** means it was promoted (with `releaseId`), rejected, expired with no decision, reverted (with `closedWhy`), did not pass a test, was handed to Builder or Bug Hunter, was answered, or is a pinned rule that was signed off.
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
- `POST pinned-rules/proposals {promptCode, find, replace, why}` (`pmAgent`) returns `{id}` and notifies the owner. `promptCode` is one of `debrief_safety_reader_system`, `debrief_quality_rubric` or `debrief_quality_judge_system`. `find` must appear exactly once in the live text.
- `POST pm-agent/ideas/:id/approve-pinned-rule {reason?}` (`approvePinnedRule`) returns `{releaseId, version, promptVersion}`. It creates a new Skills Store version and, when the live release pins that prompt, a **DRAFT** release. The sign-off is stored as `evidence.signoff = {by, at, promptVersion, releaseId}`.
- `GET pinned-rules` returns:
```ts
{ rules: Array<{ code; label; version: number|null; pinnedByRelease; inBundle;
                 signedBy: {id,name}|null; signedAt: string|null; ideaId; writtenBy: {id,name}|null; writtenAt; note }>;
  proposals: Idea[] }
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

## What the PM agent may do alone

### `GET autonomy`
```ts
{ enabled: boolean;                       // pmAgentEnabled, the master switch
  steps: ['quick_test','gate_test','paired_trial','canary']; promote: 'person';
  kinds: Array<{ kind: 'settings'|'prompts'|'pinned_rules'; configurable: boolean;
                 cells: Record<Step, 'auto'|'ask'|'off'>;
                 eligible: boolean; reason: string;      // the canary's (the κ gate's step)
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
- `PUT autonomy/orgs/:tenantId {changes: {paired_trial?|canary?: 'default'|'ask'|'never'}}` (owner) only tightens: the stricter of the global and org settings applies.

Eligibility is per step (plan §4 "Improver autonomy": free to analyse, measure and experiment
before learners are involved). **Quick test, gate test and paired trial** never reach a learner,
so `settings` and `prompts` may be `auto` there whatever κ is, as long as the track record is
clean (still owner-set, budget-capped and behind `pmAgentEnabled`). **Canary** reaches learners:
`auto` there also needs κ ≥ 0.6 on the gated measures. Promotion is always a person; pinned rules
never. The old `pmAgentStartsQuickTests` switch mirrors into the quick-test column under the same
rule (no κ gate). If κ falls below 0.6 while a canary is `auto`, the system sets that canary
back to `ask`. Every system re-lock records the cells, the reason and `by: 'system'`, and the
owner gets an in-app notification (`DEBRIEF_OWNER_ALERT`, `data.settings: 'autonomy'`, opening
Settings › autonomy). When a kind's canary becomes eligible (κ ≥ 0.6, clean record), the owner is
told once ("Canary can now run on its own for …. Turn it on?"); it is never switched on for them.
Both run in the `debrief-autonomy-relock` schedule and whenever `GET autonomy` is read. A kind
re-locks by itself (its `auto` cells become `ask`, with the reason recorded) after 2 canary
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

- `GET settings` (unchanged). It now includes `pmAgentEnabled` and `pmAgentStartsQuickTests`. Learning share is `learningSkimPct`, and the steering weights are `steeringWeightJudge`, `steeringWeightPractise` and `steeringWeightThumbs`. Change them with `PUT settings` (owner).
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

`GET analytics` has everything the Analytics › Debriefs page needs, so the page can switch to it: the six tiles, the cost panel (spend per organisation, pool balance, learning budget, burn rate) and judge agreement (gate, κ per dimension, agreement by rubric part, debriefs rated, people rating). It takes `days` (1–90, default 7).

### `GET analytics?days=7`
```ts
{ windowDays;
  tiles: { runs; judgeMean; meetsTheBar; needsAPerson; costP50Usd; costP90Usd; spentThisMonthUsd };
  runs; seconds;
  cost: { perOrg: Array<{tenantId; tenantName; live; monthSpentUsd; monthRuns}>;
          pool: { sessionsThisMonth; addedUsd; spentUsd; balanceUsd; monthlyCapUsd; capLeftUsd; runCeilingUsd };
          learning: { spentUsd; budgetUsd; balanceUsd };
          burnRate: { perDayUsd; last7DaysUsd; projectedMonthUsd } };
  judgeAgreement: null | { gate: {met, checks}; target; debriefsRated; ratings; peopleRating;
                           dimensions: Array<{dimension; kappa; withinOnePct; meanDifference; pairs}>;
                           hardFails: Array<{code; kappa; pairs}>; humanVsHuman; expertVerdicts } }
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
- **Org `ask`** for paired trials and canaries is treated as "not on this organisation's learners unless the global step was started by a person". There is no per-organisation go-ahead.
- **Judge drift and model trials** are Release 2.
- **Step win rates** are `null` until step-level trials exist (Release 2).

- **Verdicts by platform admins:** decided 2026-11-12: revoked. The platform groups no longer hold `review:admin:debriefs` (migration 1981900780000); clinical advisors are granted it person by person.
- **Calibration routes:** only `GET /v1/analytics/debrief-quality/calibration/:id` remains (the Score by hand panel reads it). The old sample, agreement and submit routes were removed; scores are saved through `sessions/:sessionId/score`, and the agreement is in `GET analytics`.
