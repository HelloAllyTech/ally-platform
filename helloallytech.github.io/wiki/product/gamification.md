---
title: Gamification
tags: [product, best-practices, gamification, badges, leaderboards, motivation]
summary: DEPRECATED 2026-08-07, superseded by the Stacks MCP — kept for history. When and how to use badges, streaks, progress and leaderboards in a clinical-adjacent training product — and the cases where gamifying actively harms the outcome.
last_reconciled: 2026-07-28
---

# Gamification

*Part of [Product Management Best Practices](best-practices.md).* **Maturity: Deprecated (2026-08-07) — was Draft.**

> [!WARNING]
> **Deprecated — superseded by the Stacks MCP.** Product guidance is now retrieved from the
> external Stacks corpus at planning time; see
> [Planning with the Stacks MCP](../contributing/planning-with-stacks.md). This page is kept for
> history and because other pages cite its principles by number — do not add new principles here,
> and treat anything that conflicts with current Stacks guidance as superseded.

## Why this matters for Ally

Ally already ships gamification: badges, community leaderboards, achievements and progress
surfaces exist in [ally-be](../repos/ally-be.md) (`badge/`, `community/`) and are consumed by
[ally-mobile](../repos/ally-mobile.md) (`AchievementsScreen`, `LeaderboardScreen`,
`CommunityScreen`). That means the interesting question is no longer *whether* to gamify — it
is **what deserves to be rewarded**, given that the people being scored are counsellors
practising emotionally heavy conversations.

Gamification is a strong instrument. It reliably increases the behaviour it measures — which
is exactly the risk when the measurable proxy isn't the thing you actually want.

## Principles

1. **Reward the behaviour you'd defend in a supervision session.** Practice completed, hard
   scenarios attempted, feedback acted on, peer reviews given thoughtfully. Not raw volume,
   not speed.
2. **Never gamify the client's outcome.** Counselling quality is judged, contextual and
   sometimes unknowable. Points attached to a distressed persona's "result" teach performance,
   not care.
3. **Effort and improvement over rank.** Prefer personal-best, progress-to-goal and mastery
   framing to head-to-head comparison. Where a leaderboard exists, prefer opt-in, cohort- or
   team-scoped, and reset-on-a-cycle over a permanent global ranking.
4. **Make it impossible to lose ground you earned.** Streaks that break on one missed day
   punish exactly the people having a hard week. Prefer freezes, grace periods, or
   "sessions this month" over fragile consecutive-day counters.
5. **Every reward must be explainable in one sentence.** If a learner can't tell why they got
   a badge, it is noise. If they can't tell how to get the next one, it isn't motivating.
6. **Celebrate proportionally.** Confetti after a first completed simulation: good. Confetti
   after a roleplay about self-harm: harmful. Tie celebration intensity to scenario tone, and
   let it be muted.
7. **Extrinsic rewards should scaffold intrinsic motivation, then get out of the way.** Heaviest
   in onboarding, lighter for experienced users. A power user shouldn't still be collecting
   stickers.
8. **Privacy first in anything social.** Leaderboards and community surfaces must respect
   tenant isolation and never expose session content, client detail, or PHI — only aggregate,
   consented signals. Individual scores are visible to the individual and their trainer, not
   to peers, unless explicitly opted into.
9. **Give trainers and tenants a switch.** Some organisations will not want competitive
   surfaces at all. Treat gamification as a per-tenant, permission-gated capability.
10. **Instrument for gaming.** Before launching a reward, write down how you'd cheat it, then
    check whether anyone does.

## Checklist

- [ ] The measured behaviour is the behaviour we want — not a convenient proxy.
- [ ] Written down: the one-sentence "why you earned this" and "how to get the next one".
- [ ] Failure/regression path is humane (no punishment, no lost progress).
- [ ] Celebration intensity matches the emotional weight of the scenario.
- [ ] Social surfaces are tenant-scoped, permission-gated, PHI-free, and opt-out-able.
- [ ] Trainer view answers "is this learner improving?", not just "who's winning?".
- [ ] Gaming vectors listed; a metric exists to detect them.
- [ ] Localised copy for badge names/descriptions — these are user-facing strings.

## Anti-patterns

- **Vanity volume.** Rewarding number of sessions started, which produces abandoned sessions.
- **Permanent global leaderboards** in a training context — demotivating for the bottom half,
  who are precisely the people who most need to keep practising.
- **Fragile streaks** that reset to zero and quietly drive people away after one break.
- **Mystery badges** with no stated criteria.
- **Reward inflation** — everyone gets everything, so nothing means anything.
- **Celebration mismatch** — playful animation on a heavy clinical scenario.
- **Cross-tenant comparison**, ever.

## Ally-specific notes

- Badges, community and leaderboard endpoints live in [ally-be](../repos/ally-be.md); the
  mobile app gates the leaderboard on a `VIEW_COMMUNITY_LEADERBOARD` permission — follow that
  pattern (permission-gated, per the [hub house rules](best-practices.md))
  for any new social surface.
- Simulation scoring already exists via the event/score pipeline in
  [ally-ai-learn](../repos/ally-ai-learn.md); before inventing a new score, check whether the
  existing signal is the right one to surface.
- Any new reward that shows a number to a user is also a
  [Data Visualisation](data-visualisation.md) decision — read the honesty rules there.

## Open questions

- Should leaderboards be cohort-scoped by default rather than tenant-wide?
- Do we have evidence that current badges change practice behaviour, or only that they're seen?
- What's the policy on gamifying peer review — quality is hard to measure, quantity is easy
  and wrong.
