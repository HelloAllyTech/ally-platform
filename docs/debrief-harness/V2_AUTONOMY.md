# Debrief v2: autonomy by default

Agreed with Gopi on 2026-11-16, after a discussion with Sandeep. Design: the console canvas, row F
(F1–F9), artifact "Debrief console redesign". This file is the build checklist: every item below
must be built, tested and ticked before release.

## The model (Sandeep's nine points)

1. The product is debrief sessions.
2. Each session has a maximum $ budget. **Done** (be-v1.197.0): `sessionBudgetUsd` covers the run
   and every Ask Ally reply.
3. Ask Ally is limited gracefully when the budget is spent. **Done** (be-v1.197.0).
4. A multi-agent system writes the debrief. Exists (orchestrator on).
5. The system works from the quality metrics in Analytics: the **cumulative score** below.
6. Learners and experts comment. Exists.
7. Feedback improves future sessions **without waiting for a person**.
8. The PM agent improves the product on its own, observes the result and undoes what hurts.
9. People can observe and intervene; **nothing waits for them**, except the kinds on the
   "Always asks a person" list.

## Rules that every surface and service follows

- Nothing is held: a debrief with a draft is always shown (**done**, ai-v1.42.0 / be-v1.198.0).
- No review queue. Nobody is expected to watch sessions. Signals go to the PM agent.
- Safety is the one alert to people: a debrief shown with a missed **clear** risk cue, and a
  learner in distress, go to a named person on Slack.
- One PM agent conversation is how a person intervenes. Only **Undo now** (live change) and
  **Stop now** (change being tried) stay as instant buttons that need no model.
- Before acting on an always-ask kind, the PM agent repeats back exactly what it will do and
  waits for "yes".
- Everything the PM agent does is logged with what the person said and what it did.
- Screens: answer first (Minto: the headline is the conclusion; group headings are insights;
  one kind of thing per group), accordions for detail, plain words (no "independent check",
  "Safety reader", "below the bar" jargon in headings; quotes instead of turn numbers where
  possible), rows never wrap, minimal information.

## Checklist

### Score (point 5)
- [x] S1 Cumulative score per run and per slice (week × language × recipe × release):
      Quality score (judge overall/10) 40%, pass rate 25%, learner helpful rate 20%,
      card flag rate (lower is better) 15%. Weights are owner settings.
- [x] S2 Two gates, never traded off: no new missed **clear** risk cue; cost per session within
      the session budget.
- [x] S3 `GET metrics/score`: current, previous, by week (with change markers), measures with
      weight / value / trend, gates, by language.

### Autonomy (points 7–9)
- [x] A1 "Always asks a person" owner setting: Safety reader text, crisis lines and support copy,
      pinned rules (rubric, judge and Evaluator instructions), budget increases (all locked on);
      low-confidence changes (on by default, switchable); new models or providers (off by
      default). Model changes within budget never wait; an organisation's provider allowlist is
      always applied.
- [x] A2 The PM agent states a confidence (high / low) and why on every change; low waits when
      A1 says so.
- [x] A3 Every other change runs the ladder on its own: tests → tried on a share of learners →
      live for everyone, with no person step. The canary starts and promotes itself.
- [x] A4 Rollout settings: share while tried (10%), debriefs and days before going live (40, 3),
      undo margin (0.3 score), watch period (14 days).
- [x] A5 Watch after going live: undo automatically (roll back to the release before) when the
      score falls by more than the margin against the release before, within the same
      language and recipe and with enough debriefs, or when a gate trips. Post to Slack.
- [x] A6 Judge agreement (κ) is information only: no longer a gate or a re-lock.
- [x] A7 Approvals for always-ask kinds wait (no 14-day auto-expiry needed for anything else).
- [x] A8 Builder and Bug Hunter hand-offs start on their own; a Builder pull request still needs
      an engineer to merge ("Being built"). Delivery then runs the ladder.
- [x] A9 Per-language scope: a change can be held, undone or retried for one language
      (release pinned per language).
- [x] A10 Test settings (Settings › Tests) are tuned by the PM agent as ordinary setting
      changes; a person no longer accepts proposals.
- [x] A11 "Live for everyone" per organisation (Settings › Organisations) stays a person's switch.

### Slack (points 8, safety)
- [x] K1 Owner settings: Slack channel for drops and undos; named safety contact.
- [x] K2 Post when a change is undone, when a measure falls past its limit, and a weekly
      summary of what changed.
- [x] K3 Safety posts: debrief shown with a missed clear risk cue; learner distress in Ask Ally.

### PM agent conversation (intervening)
- [x] C1 One thread per console (shared), stored in ally-be; each message notes what it was
      about (a change, a session, a page).
- [x] C2 `POST pm-agent/conversation` runs the PM agent in ally-ai with the message, the context
      and tools; it replies and acts: approve or turn down an always-ask change (after an
      explicit yes), stop, undo, retry (optionally for one language), hold a language, pause a
      kind of change until a date, propose a change, explain with evidence.
- [x] C3 Each agent message carries the action it took (`done` / `awaiting_yes`).
- [x] C4 Permissions as today (`DEBRIEF_ACTIONS`): the Ally team and the owner read and post; the
      clinical advisor sees and posts only about pinned-rule changes. A "yes" to a pinned-rule
      change needs the advisor or the owner; to a budget increase, the owner. Otherwise the agent
      does not act, says who can, and notifies them. Every message shows its author.
- [x] C5 (revised 2026-11-16: "Needs you as a notification icon… take it to the right place only")
      Nothing is decided on Home. Home lists Needs you one line per change (title and why it
      waits); each row opens the change on the PM agent page. This week (score, trend, went
      live, undone) sits under the PM agent page's headline; Home has no PM agent conversation (`/debriefs/changes?change=<id>`; the old `/debriefs/pm-agent` link redirects), which shows the whole change
      (the whole rule for a pinned rule, the wording before and after), the decision buttons
      outside the conversation, and that change's own conversation (All messages toggles the
      whole thread). Notifications and old `/debriefs?change=` links go there too. The clinical
      advisor reaches the same page with only pinned-rule changes (the API filters `changes` and
      `changes/:id`), no Reports or Test sets, and their own conversation thread.

### Learner flags (point 7)
- [x] F1 The Debrief agent answers every learner flag within a minute: re-reads the roleplay,
      keeps / corrects / removes the card, and tells the learner why. Card versions are kept.
- [x] F2 Every answer, correction and replaced Ask Ally reply goes to the PM agent as evidence.
- [x] F4 What learners and experts say reaches both agents (Gopi, 2026-11-16):
      PM agent: each flag with the learner's note and Ally's decision and reason, notes on
      not-helpful answers, recent Ask Ally questions (`DebriefFeedbackService.signals`).
      Debrief agent (progress reader → Writer): this learner's earlier flags with their note and
      Ally's decision (kept = explain better, never drop; corrected/removed = never repeat), and
      experts' comments on the learner's roleplay (comments on cards go to the PM agent only).
- [x] F3 A person may still change a card ("Change it") and comment; that also goes to the
      PM agent.

### Console UI (canvas row F)
- [x] U1 Home (F1): headline sentence; "Needs you" only for always-ask changes; "This week"
      accordion; PM agent conversation accordion; all debriefs by day, no status pills,
      "⚑ Flagged by the learner" only; Quality score only.
- [x] U2 Session (F2): what the learner saw (roleplay, The debrief, Ask Ally); flag marker on the
      card with the learner's note and Ally's answer; no queue, scores or banners;
      Review = the clinical expert's review (escalations, verdict, hard fails, comments);
      Agent logs button.
- [x] U3 Changes (F3): groups Waits for you / On some learners / Being built / Live / Undone;
      detail with result headline, measures, steps; the conversation beside it; Undo now /
      Stop now; Reports and Test sets tabs.
- [x] U4 Settings (F4): Autonomy = always-ask list + rollout rules + per organisation;
      Score = weights, gates, Slack; Tests = values in force + last change; Budgets copy.
- [x] U5 Analytics (F5): score first with its measures and change markers.
- [x] U6 Reports (F6), Nightly check (F7), Models (F8), Analytics › agents (F9) as drawn.
- [x] U7 Comment popup closes on an outside click unless a comment is half-written (built).

### Already released today
- Session budget covering Ask Ally (be-v1.197.0); nothing held (ai-v1.42.0, be-v1.198.0);
  held drafts shown by the stuck sweep; missed-risk-cue runs urgent (to be replaced by K3).

### How the backend core was built (S, A1/A3–A7/A10, K)
- Score: `ally-be/src/debrief/util/debrief-score.util.ts` (per run, per slice, gates, the undo decision) and
  `ally-be/src/debrief/service/debrief-score.service.ts` (`GET metrics/score`). Live debriefs only; a missed clear risk
  cue is `workspace.decision.reviewReason = 'missed_risk_cue'`; session cost is the run plus
  `askAllySpentUsd`, against the live release's `sessionBudgetUsd` (90th percentile). The score is
  0–10, so `undoMargin` 0.3 is in score points. The old steering weights stay for the old metrics
  page; the score reads `scoreWeight*`.
- Always ask: `ally-be/src/debrief/util/debrief-always-ask.util.ts`. The ladder waits once, before a change reaches
  learners (`evidence.ask`); the person's yes is `evidence.approval`, after which the try-out and
  going live run by themselves. Confidence is read from `evidence.confidence` (`'low'`/`'high'` or
  `{level, why}`); missing reads as high.
- Ladder: `DebriefPmAgentService.advance` (trial passed → try-out or live; try-out passed → live),
  called by `decideTrial`, `watchCanaries` and the `debrief-change-watch` job. Going live writes
  `evidence.watch = {status, releaseId, previousReleaseId, liveAt, until, last}`.
- Watch and undo: `DebriefChangesService.watch` (`debrief-change-watch`, hourly): same language
  and recipe, at least 30 debriefs each side (`UNDO_MIN_RUNS`), against the release before over the
  `watchDays` before going live; a tripped gate undoes at once. Undo writes `evidence.undo`, sets
  the idea `retired` and posts to Slack.
- Slack: `ally-be/src/debrief/service/debrief-slack.service.ts`; the weekly summary is `debrief-weekly-summary`
  (Monday 07:30 IST). No bot token or no channel: nothing is posted.
- Not filled: `languages` is `evidence.languages` when A9 writes it, else null; `confidence` is
  null until A2 writes it.

## API contract (ally-be, under `v1/debriefs/console`)

Types are TypeScript as the admin's `@types` will declare them. Money in USD numbers; dates ISO.

```ts
// GET home
interface DebriefHomeV2 {
  headline: { score: number | null; lastWeekScore: number | null; debriefs: number; needsYou: number };
  needsYou: Array<{ changeId: string; title: string; why: string }>;          // always-ask changes only
  thisWeek: { score: number | null; wentLive: number; undone: number;
              changes: Array<{ id: string; title: string; state: ChangeState; result: string }> };
}

type ChangeState = 'waits' | 'trying' | 'building' | 'testing' | 'live' | 'undone' | 'stopped' | 'turned_down';

// GET changes?state=   GET changes/:id
interface DebriefChange {
  id: string;                    // the idea id
  title: string;                 // what changes, in one sentence
  kind: string;                  // "Prompt · Writer", "Pinned rule · Safety reader", "Model · Writer", "Code · Builder"
  state: ChangeState;
  result: string;                // the headline: what it did, or where it is
  why: string;                   // why the PM agent made it
  when: string;                  // "live since 12 Nov"
  waitsBecause: string | null;   // only for state 'waits'
  confidence: 'high' | 'low' | null;
  languages: string[] | null;    // null = every language; else the languages it applies to
  measures: Array<{ name: string; value: string; tone: 'up' | 'down' | 'flat' }>;
  steps: Array<{ name: string; state: string; detail: string; tone: 'pass' | 'wait' | 'fail' }>;
  basedOn: string;               // evidence in one line
  canUndo: boolean;              // live: Undo now
  canStop: boolean;              // trying / testing: Stop now
}
// POST changes/:id/undo   POST changes/:id/stop      → DebriefChange

// GET pm-agent/conversation?before=<id>&limit=50   → { messages: PmMessage[]; more: boolean }
// POST pm-agent/conversation { text: string; about?: PmAbout } → { messages: PmMessage[] }
//   (returns the person's message and the agent's reply; the reply may take ~10–30 s)
interface PmAbout { kind: 'change' | 'session' | 'page'; id?: string; label: string }
interface PmMessage {
  id: string; at: string; who: 'person' | 'agent'; author: string | null;   // person's name
  text: string; about: PmAbout | null;
  action: { label: string; status: 'done' | 'awaiting_yes' | 'failed' } | null;
}

// GET metrics/score?days=56
interface DebriefScoreView {
  current: number | null; previous: number | null; debriefs: number;
  byWeek: Array<{ week: string; score: number | null; n: number }>;
  markers: Array<{ week: string; kind: 'live' | 'undone'; changeId: string; title: string }>;
  measures: Array<{ key: 'quality' | 'pass' | 'helpful' | 'flags'; label: string; weight: number;
                    value: number | null; display: string; trend: string; tone: 'up' | 'down' | 'flat' }>;
  gates: Array<{ key: 'risk' | 'cost'; label: string; ok: boolean; display: string }>;
  byLanguage: Array<{ language: string; score: number | null; n: number }>;
}

// Owner settings (GET/PUT settings, existing): new keys
//   scoreWeightQuality .40, scoreWeightPass .25, scoreWeightHelpful .20, scoreWeightFlags .15
//   undoMargin 0.3, watchDays 14, canaryShare 0.10, canaryMinRuns 40, canaryMinDays 3
//   askLowConfidence true, askModels false      (the four locked always-ask kinds are not settings)
//   slackChannel "", safetyContact ""          (text)
// Settings › Tests rows gain { lastChangedBy: 'PM agent' | string; lastChangedAt; why; changeId }

// Session (GET sessions/runs/:id, existing) — each learner flag gains:
//   answer: { action: 'kept' | 'corrected' | 'removed'; reply: string; at: string } | null
```

## Local end-to-end check (2026-11-16)

Merged on `debrief-progress`, migrations applied, ally-ai, ally-be and the admin run locally.
- Home: headline, Needs you expanding in place with the conversation (`?change=` opens it). ✔
- PM agent conversation: real turn through ally-ai. Found and fixed: it described a rule it had not
  read; `change_read` now carries the wording / rule text and the prompt forbids writing rules. ✔
- Changes page (fixed: list read as `{changes}`), Settings › Autonomy (fixed: row layout),
  Analytics score (fixed: rows wrapped), Session page with the flag marker. ✔
- Learner flags: four answered by the Debrief agent through the sweep (kept with reasons, one
  corrected, one in Hindi); a learner's claim not in the transcript was checked and the card kept. ✔
- Models page (U6) is not built: the admin has no Models page and no registry endpoint yet.
- Not exercised locally: Slack (no token), an automatic undo (needs 14 days of live data), the
  advisor-only view (no advisor account locally); covered by unit tests.
