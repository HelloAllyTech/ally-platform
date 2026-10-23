---
title: Data Visualisation
tags: [product, best-practices, data-viz, charts, dashboards, analytics, metrics]
summary: DEPRECATED 2026-08-07, superseded by the Stacks MCP — kept for history. Rules for showing numbers honestly at Ally — pick the chart from the question, never hide sample size or uncertainty, and design the dashboard around a decision.
last_reconciled: 2026-07-30
---

# Data Visualisation

*Part of [Product Management Best Practices](best-practices.md).* **Maturity: Deprecated (2026-08-07) — was Adopted.**

> [!WARNING]
> **Deprecated — superseded by the Stacks MCP.** Product guidance is now retrieved from the
> external Stacks corpus at planning time; see
> [Planning with the Stacks MCP](../contributing/planning-with-stacks.md). This page is kept for
> history and because other pages cite its principles by number — do not add new principles here,
> and treat anything that conflicts with current Stacks guidance as superseded.

> [!IMPORTANT]
> **Building an actual chart or dashboard? Open [Chart & Dashboard Design Principles](chart-dashboard-principles.md).**
> That page is the craft reference — how people read a chart, required anatomy, colour and
> emphasis rules, the persuasion-vs-deception boundary, chart-type lookup tables, dashboard
> composition, a per-chart acceptance checklist and an anti-pattern list. **This** page is the
> shorter Ally-specific rule set: what we are allowed to show, to whom, with what caveats.
> Read this one first, then build against that one.

## Why this matters for Ally

Ally shows numbers to people who make consequential judgements with them: a trainer deciding
whether a learner is ready, an admin deciding where a cohort is weak, a counsellor looking at
their own performance. Several of these numbers are **LLM-derived scores over small samples** —
the easiest kind of number to over-trust. A chart that implies more precision than the data
carries is a product bug, not a styling choice.

## Principles

1. **Start with the question, then the chart.** Write the sentence the viewer should be able
   to say out loud after looking ("my Kannada sessions score lower than my English ones").
   If you can't write it, the chart has no job.
2. **Form follows question**, roughly: change over time → line; comparison across categories →
   bar; part-to-whole → stacked bar (rarely a pie, never more than ~4 slices);
   relationship → scatter; distribution → histogram/box, not an average; single tracked
   number → stat tile with a trend and a comparison basis.
3. **An average without a distribution is a half-truth.** Where variance matters — and in
   scoring it always does — show spread, or at least min/max/n.
4. **Always show n.** Small-sample scores must be labelled as such, and below a documented
   threshold should show "not enough data" instead of a confident number.
5. **Never truncate a bar-chart axis.** Bars encode magnitude by length; a non-zero baseline
   lies. Line charts may use a zoomed axis when the change, not the level, is the point —
   label it clearly.
6. **Comparison basis is part of the number.** "+12%" is meaningless without "vs. previous
   30 days" next to it.
7. **Colour carries meaning consistently, and never alone.** One palette across the product;
   the same series is the same colour on every chart; encode categories with position/label
   too, so the chart survives colour-blindness and greyscale printing/PDF export.
8. **Design the empty and thin states first.** A new tenant's dashboard is the state most
   users see first — it should teach, not show five broken axes.
9. **Every dashboard needs a decision.** If no one can name the action a panel changes, cut
   the panel. Dashboards accrete; prune them deliberately.
10. **Aggregate, don't leak.** Cross-user and cross-cohort views must respect tenant isolation
    and never expose session content or PHI through a drill-down. Small cohorts can
    de-anonymise an individual — apply a minimum-group-size rule before showing a breakdown.
11. **Label the provenance of derived scores.** If a number came from an LLM judge, say so,
    and pin the rubric/model version it came from — comparisons are only valid within one
    version.
12. **Exports must carry their context.** A CSV or PDF that leaves the app without the date
    range, filters and n attached will be misread in a meeting.
13. **Never fabricate a measurement for a period that had none.** A rate over a zero
    denominator is undefined, not zero, and an average of no observations is not zero either.
    Emit a gap. If a value is carried forward or interpolated, it must be visibly marked as
    such — an unmarked flat line is indistinguishable from a measured plateau, and reads as the
    good news it isn't. Gap-filling a COUNT or SUM with zero is fine: "nobody practised that
    week" is a fact.
14. **A panel that cannot honour an active filter must say so.** If a filter is applied and some
    aggregate cannot be scoped by it — because its source rows carry no such attribution —
    return the unscoped figure *and* label it. Silently showing a platform-wide number under a
    tenant filter is worse than not offering the filter: the reader cannot see that it did not
    apply.
15. **A definitional point is not a measurement, and must be declared where the screenshot
    carries it.** A cohort is 100% of itself at month 0; a funnel's first stage is 100% by
    construction. Anchors like these are legitimate — they give the reader a baseline — but the
    moment one is plotted next to measured points it starts reading as one. Say so in the caption,
    not in a tooltip.
16. **An in-progress period is provisional, and belongs in a table before it belongs on a line.**
    The current month/week is still accruing; its figure can only rise. In a grid, show it and
    flag it. On a line chart, leave it off — there is no way to draw "not finished yet", so an
    unfinished period renders as a fall the reader will explain to themselves.
17. **A "did none of it" band is a residual, not a measured category — declare its denominator
    and keep it out of the ramp.** In any distribution over a population (usage levels, activity
    tiers), the zero band cannot be counted from the activity table: someone who never practised
    has no row. It is `population − active`, so its size is a statement about the *denominator*
    you chose, and that choice belongs on the panel next to the chart (see 14 and 18). Colour it
    as context grey rather than as the palest step of the ordered ramp — it is the absence of a
    level, not the lowest one — and clamp it at zero, so a data anomaly cannot invert a stack
    instead of showing that something is wrong.
18. **When a metric has several defensible definitions, let the reader switch between them —
    and compute them all in one pass.** "Active user" is a choice, not a fact. Offer the
    definitions in a control on the panel, return every variant from a single query against a
    single denominator, and switch client-side. Definitions fetched separately drift apart; a
    definition buried in a spec gets argued about in the meeting instead of on the screen.
19. **A 100%-stacked chart hides its own denominator, so the denominator has to travel with it.**
    Shares are the right form for "is the mix shifting?", but every bar is the same height whether
    it is over 40 people or 4,000 — the growth of the base, which is usually the other half of the
    story, disappears. Put the population per period in the drill-down table and the latest one in
    the panel's provenance line, and keep the raw counts one click away: a share is only readable
    next to the number of people it is over.
20. **A stat tile states what it counts, on its face.** A number, a label and an arrow are not
    self-describing: "Active orgs 0 ↓ −1" cannot be read without knowing that *active* means a
    completed simulation and that the count is bounded by the range picker. Give every KPI tile a
    one-line definition — the tile's equivalent of a chart caption — and put it **below** the
    value so the number keeps the salience, and in **every state** including loading and
    thin-sample, because it describes the metric rather than the value. Not a tooltip: the strip
    is the part of a dashboard most often screenshotted on its own. Where a tile draws on rows
    that cannot be attributed to a tenant, the unscoped label (principle 14) belongs on the tile
    too, not only on the chart it summarises.
21. **A distribution over people is plotted as counts; the shares go in the takeaway and the
    table.** Bars that are numbers of learners are directly comparable at both ends of a skewed
    axis, start honestly at zero, and — unlike percentages — leak nothing, so the minimum-group-size
    rule never has to blank the chart itself (it suppresses only the shares, which live where the
    count that makes them readable is right beside them). Reach for a share chart when the question
    is "is the mix shifting?" over time (see 19); for "how are our people distributed *right now*",
    count the people.
22. **Band the quantity the question is about, and bound the bands the way the quantity reads.**
    A *count* of things done (roleplays completed, notes written) is discrete, so its bands are
    inclusive at both ends — "3–5" means 3, 4 or 5, and writing it as `[3,6)` in the API is
    technically identical and will still be misread by everyone. A *continuous* quantity (minutes,
    scores) needs the lower-inclusive/upper-exclusive convention and must say so, because something
    has to own exactly 25.0. Band fine where the decisions are — the 1-vs-2 distinction is the
    activation question and earns its own bar — and coarse where nothing would change. And band a
    **lifetime** count over all time, not the page's date range: inside a 30-day window nearly
    everyone lands in the lowest bands whatever their real depth, so the chart would be reporting
    the length of the window. A panel that cannot honour the range picker says so on its face
    (see 14) rather than accepting a filter it ignores.
23. **The window and the grain are different questions, and the grain belongs to the chart.**
    The window says *what period is covered*; the grain says *at what resolution it is read*. A
    single page-level grain forces every panel to whatever suits the noisiest of them, and the
    reader has to remember which charts it did not suit. Put a day/week/month/year control on
    each time series that has a real choice to make — and leave it off the ones that do not. A
    trailing-window metric sampled once per day (DAU/WAU/MAU) is not the same measure at a
    coarser grain but a different one; a cohort triangle needs a fixed cohort grain; a
    categorical breakdown has no time axis to re-grain. **Re-grain on the server, not the
    client:** re-binning is only sound for counts and sums — a mean of monthly means weights a
    quiet month like a busy one, and a median or p95 cannot be recovered from bucketed values at
    all. Fetch one response per grain actually on screen and keep the default grain fetched for
    whatever has no grain of its own (a KPI strip, a funnel, a ranking), so the untouched page
    costs exactly what it did before the control existed.
24. **Where re-graining changes the question rather than the resolution, say so in the caption.**
    Some splits are defined *relative to the bucket*: "new vs returning" means an account created
    in the same period as the activity, so at a yearly grain most of a year's actives read as
    returning and at a weekly grain most read as new. That is not a bug in either view, but a
    reader who moves the control and sees the mix invert will assume one of them is wrong unless
    the panel already told them the definition moves with the grain.
25. **A window with no predecessor gets no delta.** An all-time window has no equal-length period
    before it, so a comparison against "the previous period" reports growth out of an empty set —
    a fact about the windowing, not the metric. Return no basis, drop the arrow, and let each
    tile show its bare value and sample size. This is principle 6 read backwards: if the basis
    cannot be named, the change must not be shown. It also means the choice to make a surface
    all-time is a choice to give up deltas on it — worth making deliberately, and worth stating
    where the picker used to be, because a control that disappears reads as an omission.
26. **When a series has more periods than the card has pixels, scroll the plot — do not compress it.**
    A charting library given fifty categories and five hundred pixels does not overflow; it fits them,
    and the fitting is the failure. Bars go to hairlines, the tick labels rotate into a solid grey
    band, and the panel reads as "broken chart" rather than "more data than fits" — which is how a
    healthy all-time daily series ends up looking like a bug. Give every category a floor of
    horizontal room, let the plot exceed its card, and scroll the card sideways. Two costs come with
    it and both go on the surface, not in a tooltip: the value axis and the legend are drawn in the
    same SVG as the plot, so they scroll out of view with it, and part of the range starts off-screen
    — a plot cut off at the card edge with nothing said about it reads as the whole series. Say so
    below the plot, and make the scroll region keyboard-reachable, or the range is unreachable
    without a mouse. Thinning ticks to every nth label is the wrong fix: it declutters the labels
    while leaving the marks themselves too thin to compare. This applies to the axis the categories
    are actually on — a horizontal bar chart with forty orgs is crowded **vertically**, and a
    sideways scroll neither helps it nor is honest about what is missing.

27. **A machine-proposed chart is a hypothesis, and the data gets the last word.** When the chart
    form is chosen at run time — by an LLM narrating a result set it saw as text, or by any
    heuristic over shapes — it is proposing from the *question*, not from the values. Validate
    before rendering, in code: does every named column exist in the result, are there enough rows
    to be a plot rather than two points and a line, is this the whole result or the first page of
    it? Each of those fails **silently** if unchecked — a chart naming a missing column draws
    empty axes (which reads as a broken panel, not as absent data), and a plot of the first N rows
    of a larger result reads as the whole population. And treat **"no chart" as a first-class
    answer** rather than a fallback: a single number and a five-row table are better read as text,
    so a surface that must always draw something will draw something decorative. Where the plot
    ends up narrower than the table beside it, say how many rows are missing from it, under the
    chart.
28. **A number produced by a generated query has to show the query.** Where the derivation itself is
    written per-question rather than reviewed once and shipped, provenance (principle 11) is not
    enough — the model and prompt version do not tell a reader *what was counted*. Show the query,
    plus a one-line plain-English statement of what it counts and which filters it applied, and
    show it for the query that was **refused or failed** too, since that is the only way anyone can
    tell a bad question from a bad answer. Never rewrite a query to make it pass a rule and then
    display the rewritten one: the query on screen must be the query that produced the number, or
    showing it is theatre.

## Checklist

Ally-specific gates. For chart craft, also run the fuller per-chart checklist in
[Chart & Dashboard Design Principles](chart-dashboard-principles.md).

- [ ] The one-sentence takeaway is written down and the chart delivers it.
- [ ] Chart type matches the question type; axis starts at zero for bars.
- [ ] `n` shown; below-threshold cases show "not enough data".
- [ ] Comparison basis and time window labelled on the surface, not just in a tooltip.
- [ ] Consistent palette; meaning not carried by colour alone; readable in greyscale.
- [ ] Empty / thin-data / loading / error states designed.
- [ ] Units, rounding and precision are honest (no 2-decimal scores from a 5-point rubric).
- [ ] Tenant isolation + minimum group size respected in every breakdown and drill-down.
- [ ] Derived-score panels state their source and version.
- [ ] Export includes filters, range and n.
- [ ] Unmeasured periods render as gaps, not zeros; any carried-forward value is marked.
- [ ] Any panel that could not honour an active filter is labelled as unscoped.
- [ ] Any definitional 100% (cohort month 0, funnel stage 1) is labelled as a definition.
- [ ] The in-progress period is flagged in tables and omitted from lines.
- [ ] Where the metric has competing definitions, the switcher is on the panel and every
      definition shares one denominator.
- [ ] A zero / "did none" band is greyed as context, derived as a residual, and its denominator is
      named on the panel.
- [ ] A 100%-stacked panel states the population it is a share of, and its counts are reachable.
- [ ] A population distribution plots counts, with the shares in the takeaway and the table.
- [ ] Band bounds match the quantity: inclusive both ends for a discrete count, lower-inclusive /
      upper-exclusive for a continuous one — and the convention is stated in the caption.
- [ ] A lifetime-count distribution is all-time, and the panel says the range picker does not apply.
- [ ] Per-person breakdowns (cohort rows, per-org rows) respect the minimum group size: size
      shown, rate suppressed below it.
- [ ] Every KPI / stat tile carries its one-line definition below the value, in the loading and
      thin-sample states too — and its unscoped label if it cannot honour the tenant filter.
- [ ] A plot whose category count grows with the data scrolls sideways rather than compressing, says
      on its face that part of the range is off-screen, and can be scrolled from the keyboard.
- [ ] Grouping controls sit on the charts that have a real grain choice, are absent from the ones
      that do not, and re-grain server-side; the grain is named on the axis, in the provenance
      line and in the export.
- [ ] Where the grain changes the definition (new vs returning), the caption says so.
- [ ] An all-time surface shows no deltas, and says where the range picker went.
- [ ] A run-time-chosen chart is validated against the actual result (columns present, enough rows,
      not a truncated sample) before it renders, and "no chart" is an allowed outcome.
- [ ] Where a number came from a generated query, the query is on the surface — including when it
      was refused or failed — with a plain-English statement of what it counts.

## Anti-patterns

- **Truncated y-axis** turning a 2% difference into a cliff.
- **Score with no sample size** — "82%" from three sessions.
- **Dual y-axes** implying a correlation the data doesn't support.
- **Pie charts with nine slices**, or any pie where the comparison is the point.
- **Rainbow palettes** where colour ordering implies a ranking that doesn't exist.
- **Dashboard as data dump** — twelve panels, no decision.
- **Tooltip-only truth** — the caveat that only appears on hover never reaches the screenshot
  that ends up in the board deck.
- **An undefined KPI strip** — eight tiles of label, number and arrow, where "active", "completed"
  and "cost" each have two plausible readings and the tile commits to neither.
- **Comparing across rubric or model versions** as if they were the same scale.
- **A zero that means "nothing happened here"** — a 0% failure rate for a week with no sessions
  reads as a clean week, and is the most flattering possible way to be wrong.
- **A colour assigned by result-set position**, so a service changes colour when the filter
  changes.
- **A part and a whole stacked in the same bar**, making the bar's height mean different things
  in different periods.
- **A cohort triangle whose future is drawn as 0%** — the empty upper-right corner is "not yet",
  and filling it flatters nothing so much as it misleads.
- **A retention percentage over a cohort of three**, which is both noise and a name.
- **Two series of different magnitude on one axis**, which flattens whichever one the chart is
  named after.
- **A share chart whose denominator is a silent choice** — "40% of users" over a base the reader
  cannot see, and would have picked differently.
- **The dormant band coloured as the bottom of the usage ramp**, which reads as a little practice
  rather than as none.
- **A time axis compressed until it is a grey smear** — fifty dates rotated into an unreadable band
  under bars a pixel wide, because the chart was allowed to fit the data into the card instead of
  outgrowing it.
- **One page-level grain for a page of unlike charts**, which makes the reader re-scope everything
  to fix one panel.
- **Re-binning an average on the client** to serve a grouping control — the arithmetic is wrong
  and the chart looks fine.
- **A grouping control on a trailing-window metric**, which silently answers a different question
  at each setting.
- **A delta on an all-time figure**, which can only ever be "up, from nothing".
- **An unfinished period drawn as a data point**, which reads as a collapse every time the month
  turns over.

## Ally-specific notes

- Analytics surfaces span [ally-be](../repos/ally-be.md) (`analytics/`, incl. Metabase-backed
  dashboards), the web dashboards in [ally-web](../repos/ally-web.md), and charting in
  [ally-mobile](../repos/ally-mobile.md) (ECharts / chart-kit). Keep the same metric named and
  computed the same way across all three, or say explicitly why it differs.
- Product analytics (PostHog) answers *how the product is used*; platform analytics answers
  *how counsellors are performing*. Do not mix them on one dashboard — different audiences,
  different decisions.
- LLM-judge-derived quality scores follow the pinning discipline described in
  [Language-Quality Evaluation & RCA](../platform/language-quality-eval.md) — read that
  before charting any language or quality metric.
- Anything that turns a number into a reward is also a [Gamification](gamification.md)
  decision.
- Dashboard *composition* — salience across the whole screen, shared visual language,
  consistent encodings across tiles, density tiers by role — is covered in
  [Chart & Dashboard Design Principles](chart-dashboard-principles.md) §15.

## Settled decisions

These were this section's open questions. They are now decided, each with the code that
implements it — change both together.

### The leadership surface is all-time, and the grain is per chart

The super-admin **Analytics → Highlights** tab has no time-range picker. The question it answers
("how is the platform doing?") is a question about the whole history, and a page-level range made
every reader re-scope twelve panels at once to satisfy one of them. What replaces it is a
day/week/month/year control on each time series — principle 23.

The mechanics, because they are what make this affordable and honest:

- **`range=all` is measured, not assumed.** The window starts at the platform's first row
  (`LEAST(min(users.createdAt), min(scenario_sessions.createdAt))`, test orgs excluded), so no axis
  begins at a guessed epoch. An endpoint that has not measured its floor **rejects** the range with
  a 400 rather than silently answering for a different period.
- **One query per grain on screen, per endpoint.** The default grain (month) is always fetched, for
  the panels that have no grain of their own; an untouched page therefore costs exactly the two
  requests it did before, and changing one chart's grain costs one more — from that chart's endpoint
  only.
- **No deltas** on this tab (principle 25), and the missing picker is explained in the page
  subtitle.
- **The current period is omitted from every plot** and kept, flagged, in the drill-down table and
  the export (principle 16). At month or year granularity this matters far more than it did at a
  daily one: the partial bucket is a visible cliff rather than one short bar.

Implemented as `analyticsGrouping.ts` (+ `GroupingPicker` in `chartKit.tsx`) and
`ally-web/apps/ally-admin-dashboard/src/pages/Analytics/tabs/HighlightsTab.tsx` in [ally-web](../repos/ally-web.md), against `range=all` /
`bucket=day|week|month|year` on `/v1/analytics/highlights` and `/v1/analytics/overview` in
[ally-be](../repos/ally-be.md) (`ally-be/src/analytics/util/analytics-window.util.ts`,
`ally-be/src/analytics/util/data-floor.util.ts`).

### Minimum width per x-axis category: **28px**, then scroll

This replaces the old open question about tick density on a narrow viewport. Thinning the labels was
the wrong lever: the labels were only the visible symptom, and the bars underneath them were the
thing that had become unreadable. So the plot is given the width it needs instead — `28px` per
category plus a gutter for the value axis — and the card scrolls horizontally when that exceeds it.

28px is roughly what a rotated `2026-06-09` needs to stand clear of its neighbour, and enough for a
bar to read as a bar. It is one number for every chart type rather than a per-form table: line points
could sit closer together, but the tick labels are the binding constraint either way and a second
constant would only be a second thing to get wrong.

The wrapper is a no-op below the threshold — a six-bar chart is untouched and shows no scrollbar —
and overflow is **measured** rather than inferred from the count, because whether a plot fits depends
on the grid breakpoint the card is in. The two affordances (the keyboard tab stop, and the note
saying the range continues off-screen) appear only when something is genuinely out of view.

Known cost, accepted: Carbon positions its hover tooltip against the full plot width, not the visible
window, so a tooltip opened within roughly a tooltip's width of the scroll window's right edge is
clipped by it. Scrolling a little brings it back. Fixing it means reaching inside Carbon's placement
service, which is not worth it for a hover that the drill-down table already answers exactly.

Implemented as `MIN_CATEGORY_WIDTH` and the `ScrollableChart` wrapper in
[ally-web](../repos/ally-web.md), `ally-web/apps/ally-admin-dashboard/src/pages/Analytics/chartKit.tsx`
(+ `.analytics-chart-scroll` in `analytics-carbon.scss`), applied to every time-bucketed and
open-ended-categorical plot on the Analytics tabs and in their expanded views.

### Minimum sample size: **n = 20**

Below 20 observations a derived score is not shown as a number at all; the surface renders
**"Not enough data"** alongside the actual n and the threshold ("n = 4 evaluated sessions ·
need 20"). This covers any mean of LLM-judged or self-reported values — quality scores, learner
ratings, per-dimension error rates.

20 is a judgement call, not a statistical derivation: it is roughly where one outlying session
stops moving a mean by more than a rounding step. It is deliberately a single number rather than
a per-metric table, because a threshold nobody can hold in their head is a threshold nobody
applies.

Counts, sums and volumes have no minimum — they are not estimates of anything.

Implemented as `MIN_N_FOR_SCORE` in [ally-web](../repos/ally-web.md),
`ally-web/apps/ally-admin-dashboard/src/pages/Analytics/chartKit.tsx`.

### Minimum group size for a per-person breakdown: **n = 5**

Distinct from the n = 20 above, which governs whether a *derived score* is trustworthy. This one
governs whether a **rate over identifiable people** may be shown at all. A row that says "50% of
the 2 learners who joined in March" names an individual to anyone who knows the org — and under a
tenant filter, most rows are small.

The rule: below 5, show the group's **size** and suppress its **percentages**. A count is not an
estimate of anything and leaks nothing on its own; the reader can see the row exists and see why
it has no number. Do not drop the row — dropping it understates the total and hides the tail.

Deliberately the same number in every per-person breakdown so there is one floor to remember.
Implemented as `MIN_ORG_GROUP_SIZE` (per-org rows), `MIN_COHORT_SIZE` (cohort rows) and
`MIN_USAGE_POPULATION` (monthly usage-level shares, which re-exports the cohort constant rather
than redeclaring the number) in [ally-be](../repos/ally-be.md)'s `analytics/` repositories; the API
returns a `belowFloor` flag — or, where the floor applies to a denominator the client picks, the
floor itself — rather than making each client re-derive the rule.

### The approved palette

One palette per surface, with colours assigned by **meaning** rather than by position in a
result set:

- **Semantic scales** for dimensions that recur across charts — outcome (green good / red bad /
  gold pending / grey n-a), severity (gold → orange → dark red, ordered), capture method,
  provenance (live vs backfilled), percentile (one hue, three shades).
- **Grey is reserved for context** — any series that supports the point without being the point:
  a backfilled history, a cumulative total, an "all other" bucket.
- **Ordered categories get a same-hue ramp**, never a rainbow; a rainbow implies a ranking that
  isn't there.
- **Unordered categories with an unknown value set** (models, providers) take a colour from a
  capped 8-hue categorical list, keyed on a hash of the NAME — never by index into the current
  result set, which makes a colour move when the set changes. A colour that moves encodes
  nothing, and the reader cannot see that it moved.
- **Never colour-by-identity on a single-measure chart.** If the category is already on the
  axis, a second encoding of it is noise.
- **Eight distinguishable hues is the ceiling.** Past that, group the tail into "Other".
- **Two different dimensions must not share a colour** on the same surface, or the reader builds
  a relationship that does not exist.

**Greyscale and colour-blindness:** meaning is never carried by colour alone. Every good/bad
signal is paired with a sign, an arrow or a word — a delta renders "↓ −1.5", not a red number.
**Dark mode:** the analytics surface renders in Carbon's White theme regardless of the app theme,
so these hexes are chosen against a light background only; a chart placed on a dark surface needs
its own review. **PDF and print** are covered by the greyscale answer.

Implemented as `chartScales.ts` in the same directory.

### A candidate panel is staged on its own tab, not trialled on the leadership surface

Analytics → **Testing** (super-admin, reserved to the elevated tier) is where a panel proves it
changes a decision before it appears anywhere a reader relies on. The rule it settles: **you do not
find out whether a chart is worth having by putting it in front of the people who act on the
dashboard.** Principle 9 says every panel must name the decision it changes or be cut — and the only
honest way to test that claim is against real production data, which a mock cannot supply and a
staging seed cannot either.

What staging does and does not license:

- **Nothing on the production surface is altered to make room.** Highlights keeps every panel and
  every KPI tile it had. Where a candidate measures the same thing differently — a median with its
  interquartile range against a mean line, a rating-band mix against a mean rating — the two are
  deliberately readable side by side, because that comparison on live data is the argument for
  retiring the original.
- **Staged is not exempt.** A candidate honours every rule on this page from the first commit: null
  over a zero denominator, sample floors travelling with the data, residuals in context grey, the
  accruing period off the plot, the same all-time window and per-chart grain as Highlights. A panel
  that graduates should need no rework, and a panel that is allowed to cut corners while "only in
  testing" is a panel whose numbers nobody can judge.
- **Endpoints are named for what they measure, never for the tab.** `/v1/analytics/skill-growth`,
  not `/v1/analytics/testing/*` — the first chart to graduate would otherwise drag a rename across
  two repos.
- **The tab is a queue, not a home.** Panels leave it in one of two directions. A candidate nobody
  has moved or cut is a decision that has not been made.

Implemented as the former Testing tab (its charts now live in `ally-web/apps/ally-admin-dashboard/src/pages/Analytics/tabs/HighlightsTab.tsx`) + `ally-web/apps/ally-admin-dashboard/src/pages/Analytics/testingChart.ts` + `ally-web/apps/ally-admin-dashboard/src/pages/Analytics/OrgHealthCard.tsx` in
[ally-web](../repos/ally-web.md) (gated by `isSuperDuperAdminRole` in the tab registry, so the tab is
absent rather than present-and-refusing), against ten read-only endpoints in
[ally-be](../repos/ally-be.md)'s `analytics/` module.

**Under review at time of writing:** weekly practising learners as a north-star candidate, the
signup→first-session activation funnel, time to first practice, score by Nth completed session,
quality and satisfaction as distributions, competency volume against proficiency, track drop-off by
item format, the coaching loop, language mix, Scribe adoption breadth, and a per-org health table.
Which of these earn a place on Highlights — and what they replace — is open.

### Metric parity across surfaces

Not yet reconciled — but scoped rather than open. The headline learner metrics (practice minutes,
completed simulations, quality score) are computed in [ally-be](../repos/ally-be.md)'s
`analytics/` module for the web dashboards and separately in
[ally-mobile](../repos/ally-mobile.md). The definitions have not been diffed. Until they are,
**do not present a web figure and a mobile figure as the same metric.** This is a follow-up, not
a rule.

## Open questions

- Should the minimum-n threshold differ for a metric one user acts on (their own score) versus a
  cohort aggregate? The single threshold is deliberately blunt.
- A horizontal bar chart over an open-ended category set (orgs, models) crowds **vertically**, and
  the scroll answer below does not apply to it. Growing the card's height with the category count is
  the obvious fix and nobody has decided how far it may grow before the list belongs in a table.
- **A chart drawn because a chart was expected** — axes rendered over a column that is not in the
  result, or over the first page of a larger one, because the surface had a chart slot to fill.
- **A generated number with a hidden derivation** — an answer written per-question whose query is
  not shown, so a reader who doubts it has nowhere to look and no way to tell a misread question
  from a wrong query.

