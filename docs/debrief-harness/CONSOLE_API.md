# Debrief console API (redesign)

The contract between ally-be and the redesigned Debrief console pages in ally-web. Every
route is under `/api/v1/debriefs/console` unless it says otherwise. The old console routes still
work. Their response shapes are unchanged, but their **permissions changed** (see Roles).

Build notes: debrief-console-redesign-notes.md (outside the repo). Code:
`ally-be/src/debrief/controller/debrief-console.controller.ts`,
`ally-be/src/debrief/service/debrief-console-view.service.ts`,
`ally-be/src/debrief/service/debrief-autonomy.service.ts`,
`ally-be/src/debrief/util/debrief-console-roles.util.ts`,
`ally-be/src/debrief/util/debrief-console-view.util.ts`.

**No redaction.** The console shows real names and the real transcript. This also applies to the
old Expert review screen, whose transcript is no longer redacted.

## Roles and who can act

No new roles were created. The console uses the existing groups and adds one new permission.

| Role | Held as | Notes |
|---|---|---|
| Ally team | `system:access` (PLATFORM_ADMIN, SUPER_ADMIN, SUPER_DUPER_ADMIN) | The platform tier that already reaches the console |
| Clinical advisor | `review:admin:debriefs` | Granted person by person (migration 1981900710000 also gave it to the platform groups) |
| Owner | `manage:admin:debrief-settings` (**new**, migration 1981900730000) | SUPER_DUPER_ADMIN, or granted person by person |

To read the console you need the Analytics toggle (or the "Debriefs — Clinical advisor" toggle)
**and** one of the three permissions. Each action below requires one of its permissions, and the
server returns **403** otherwise. Every payload carries `viewer.can`, so the UI can hide a button
rather than disable it.

| `can.<action>` | Ally team | Advisor | Owner | Routes |
|---|---|---|---|---|
| `comment` | yes | yes | yes | console `runs/:id/comments`, `comments/:id` (PATCH, DELETE, resolve, reopen); expert-review comment routes |
| `flagDecision` | yes | escalated flags only (checked per flag, 403) | yes | `flags/:id/resolve` |
| `heldDebrief` | yes | no | yes | `runs/:id/publish`, `runs/:id/todays-debrief`, `runs/:id/reviewed`, `runs/:id/correct` |
| `escalate` | yes | no | yes | `flags/:id/escalate`, `runs/:id/escalate` |
| `verdict` | no* | yes | no* | expert-review `runs/:id/verdict` |
| `score` | in the scoring sample only (403 otherwise) | yes | no | `sessions/:sessionId/score` |
| `pmAgent` | yes | no | yes | `pm-agent/analyse`, `ideas/:id/screen`, `approve`, `reject`, `questions`, `start-step`; `pinned-rules/proposals` |
| `approvePinnedRule` | no* | yes | yes | `pm-agent/ideas/:id/approve-pinned-rule` |
| `testSets` | yes | no | yes | `test-sets/build` |
| `releases` | yes | no | yes | `models` (POST), `releases/orchestrator-challenger`, `releases/:id/rollback`, `sessions/:sessionId/run` |
| `switchOrgOn` | no | no | yes | `tenants/:id/live` with `live: true` (403 for the Ally team), `tenants/:id/region` |
| `emergencyStop` | yes | no | yes | `tenants/:id/live` with `live: false`, `tenants/:id/emergency-stop` |
| `ownerSettings` | no | no | yes | `settings` (PUT), `settings/accept`, `settings/baseline`, `budgets`, `autonomy/matrix`, `autonomy/orgs/:id` |

\* Platform admins also hold `review:admin:debriefs` today, so by default they can give a verdict
and sign off pinned rules. Revoke it from the groups if that is not wanted (product decision).

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
`to_score` | `all`; `tenantId`; `language`; `recipe` (`standard`|`short`|`case`|`assessment`);
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
  }>;
  filterOptions: { tenants: {id,name}[]; languages: string[]; recipes: string[]; fallback; riskCue; cost; modes };
  viewer: Viewer;
}
```

`toScore` and `inMyScoringSample` come from the calibration sample (the same seeded sample as
`/v1/analytics/debrief-quality/calibration/sample`). They are only computed when `can.score` is true.

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
                       replacedReply: { reply; fails: string[] } | null; costUsd: number|null; model; tools: unknown[] }>;
    totalCostUsd: number|null;
    distressItems: Flag[];               // the Ask Ally distress queue items
  };                                     // read-only
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
  verdict: { verdict; hardFails; updatedAt } | null;  // the viewer's own
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
`POST comments/:id/resolve`, `POST comments/:id/reopen`. All of them need `can.comment`. Viewers without review rights
can read comments in the session payload but get 403 on writes. Comments feed the PM agent's
evidence, never the queue. You cannot comment on a session from your own practice (403).

## Score by hand

`POST sessions/:sessionId/score` takes `{ scores: Record<dimension, 0..10>, hardFails: string[], note? }`. It is stored
as the calibration rating and feeds the κ gate. The Ally team can only score sessions in the scoring sample (403
otherwise). It returns 404 when the judge has not scored the session.

## PM agent: approvals (plan §11.7)

### `GET pm-agent` (changed, additive)
Each `ideas[]` row keeps its old fields and adds these:
```ts
{ decidedBy; decidedAt; kind: string|null; changeKind: 'settings'|'guidance'|'prompts'|'models'|'pinned_rules'|null;
  approval: null | { wait: 'pinned_rule'|'handoff'|'start_gate'|'start_trial'|'start_canary'|'promote';
                     since; expiresAt; expiresInDays; expired; expiringSoon /* ≤ 3 days */ };
  expired: boolean; notTakenForward: boolean; notTakenForwardReason: 'no_decision'|'rejected'|null;
  questions: Array<{ id; role: 'person'|'agent'; by; at; text }>;
  can: { approve; reject; tryIt; askQuestion; startStep } }
```
The top level adds `viewer: { roles, can }`.

An item expires 14 days after it started waiting on a person. A daily job
(`debrief-pm-agent-expiry`) sets it to `rejected` with `evidence.expiry = {at, reason:'no_decision'}`.
A passed canary that was never promoted is stopped. `approve` on an expired item returns 409.

- `POST pm-agent/ideas/:id/questions {text}` returns `{id, at}`. The question is added to the PM agent's next run context as `open_questions`. Asking does not stop the clock. The agent cannot answer in the thread yet (see Not built).
- `POST pm-agent/ideas/:id/start-step {step: 'gate_test'|'paired_trial'}` starts a step the policy left waiting.
- `POST pm-agent/ideas/:id/approve` (unchanged). It returns 400 for a pinned-rule idea.

### Pinned rules
- `POST pinned-rules/proposals {promptCode, find, replace, why}` (`pmAgent`) returns `{id}`. `promptCode` is one of `debrief_safety_reader_system`, `debrief_quality_rubric` or `debrief_quality_judge_system`. `find` must appear exactly once in the live text.
- `POST pm-agent/ideas/:id/approve-pinned-rule {reason?}` (`approvePinnedRule`) returns `{releaseId, version, promptVersion}`. It creates a new Skills Store version and, when the live release pins that prompt, a **DRAFT** release. Nothing reaches learners until someone makes that release live. The sign-off is stored as `evidence.signoff = {by, at, promptVersion, releaseId}`.
- `GET pinned-rules` returns:
```ts
{ rules: Array<{ code; label; version: number|null; pinnedByRelease; inBundle;
                 signedBy: {id,name}|null; signedAt: string|null; ideaId; writtenBy: {id,name}|null; writtenAt; note }>;
  proposals: Idea[] }   // signedBy is null until a console sign-off exists for that version
```

## What the PM agent may do alone

### `GET autonomy`
```ts
{ enabled: boolean;                       // pmAgentEnabled, the master switch
  steps: ['quick_test','gate_test','paired_trial','canary']; promote: 'person';
  kinds: Array<{ kind: 'settings'|'guidance'|'prompts'|'models'|'pinned_rules'; configurable: boolean;
                 cells: Record<Step, 'auto'|'ask'|'off'>; eligible: boolean; reason: string;
                 relockedAt: string|null; relockReason: string|null }>;
  orgs: Array<{ tenantId; tenantName; live: boolean;
                overrides: { paired_trial; canary; guidance: 'default'|'ask'|'never' } }>;
  facts: { gate: { met; failing: {measure,kappa}[] }; reverts: Partial<Record<Kind, number>>;
           failedBaseline: { failed; detail }; judgeDrift: boolean|null };
  relocks: Array<{ kind; at; reason }>;
  can: { change: boolean } }
```
- `PUT autonomy/matrix {changes: [{kind, step, value}]}` (owner) is all or nothing. It returns 400 when `auto` is set on an ineligible kind, when `pinned_rules` is changed, or when the step is unknown (promote is always a person). It returns the view.
- `PUT autonomy/orgs/:tenantId {changes: {paired_trial?|canary?|guidance?: 'default'|'ask'|'never'}}` (owner) returns the view. The effective value is the stricter of the global setting and the org's, so an org can only tighten.

A kind is eligible when κ ≥ 0.6 on the gated measures and its track record is clean. A kind
re-locks by itself (its `auto` cells become `ask`, and the reason is recorded) after 2 canary
reverts in 4 weeks, a failed monthly sealed baseline (median down by more than 0.5, or more hard
fails), or judge drift. Judge drift is not measured yet and is always null. This is checked daily
and on every `GET autonomy`. Defaults keep today's behaviour: the quick test follows the old
`pmAgentStartsQuickTests` switch (migration 1981900740000), the gate test and paired trial run
on their own, and the canary asks first. Changing `pmAgentStartsQuickTests` through `PUT settings`
mirrors into the quick-test column, and only eligible kinds can go to `auto`. Promoting, Builder
hand-offs and bug reports always wait for a person.

## Settings

- `GET settings` (unchanged). It now includes `pmAgentEnabled` and `pmAgentStartsQuickTests`. Learning share is `learningSkimPct`, and the steering weights are `steeringWeightJudge`, `steeringWeightPractise` and `steeringWeightThumbs`. Change them with `PUT settings` (owner).
- `PUT budgets {runCeilingUsd?, monthlyCapUsd?, note?}` (owner) returns `{releaseId, version, changed}`. Both values live in the release, so a change creates a new live release. Undo it with Roll back.
- `POST tenants/:tenantId/emergency-stop {reason}` (Ally team or owner) returns `{tenantId, live:false, learnersSee:'not_available', reason}`. The organisation's learners see "not available", not today's debrief. Switching on (`PUT tenants/:id/live {live:true}`) is owner-only. It still requires a support line outside India.

## Attention

### `GET attention`
```ts
{ banners: Array<{ kind: 'urgent'|'held'|'escalated'|'canary_reverted'|'approval_expiring'|'agent_off'|'cap'|'provider_down'|'language_not_recorded';
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
- held turns red once overdue (`flagReviewSlaHours`).

`pmAgentNeedsYou` counts idea approvals for `can.pmAgent` plus pinned-rule proposals for
`can.approvePinnedRule`. Banners link to the item and never act.

## Analytics › Debriefs

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

## Not built, or defaulted (product decisions)

- **Team channel notification** for approvals (plan §11.7) is not built, because ally-be has no team-channel integration. Escalations still use in-app notifications.
- **Answers in the "Ask a question" thread.** The PM agent receives open questions in its run context (`open_questions`), but it has no tool to write an answer back into the thread. That needs an ally-ai change plus a gateway tool.
- **Org `ask`** for paired trials and canaries is treated as "not on this organisation's learners unless the global step was started by a person". There is no per-organisation go-ahead flow.
- **The guidance and models kinds** have matrix cells and org overrides, but no PM agent idea kind changes guidance or models yet, so nothing reads them.
- **Judge drift** is not measured anywhere yet, so it is always null.
- **Verdicts by platform admins:** platform groups hold `review:admin:debriefs`, so they also count as clinical advisors for verdicts and pinned-rule sign-off.
- **The old Calibration route** `POST /v1/analytics/debrief-quality/calibration/:id` is unchanged (Analytics toggle only). The sample rule applies only to the new console route.
