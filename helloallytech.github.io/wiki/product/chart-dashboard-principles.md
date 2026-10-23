---
title: Chart & Dashboard Design Principles
tags: [product, best-practices, data-viz, charts, dashboards, reference, agents]
summary: DEPRECATED 2026-08-07, superseded by the Stacks MCP — kept for history. A constraints-file reference for building charts and dashboards — perception rules, chart anatomy, clarity/simplicity/colour rules, persuasion-vs-deception boundaries, a chart-type lookup, an acceptance checklist, and an anti-pattern list.
last_reconciled: 2026-07-29
---

# Chart & Dashboard Design Principles

> [!WARNING]
> **Deprecated — 2026-08-07, superseded by the Stacks MCP.** Product and design guidance is now
> retrieved from the external Stacks corpus at planning time; see
> [Planning with the Stacks MCP](../contributing/planning-with-stacks.md). Kept for history — do
> not add to it, and treat anything conflicting with current Stacks guidance as superseded.

**Status:** Deprecated (was: a working spec, structured for engineering use). Sections marked `[EXTRAPOLATION]` extend the per-chart rules to dashboards and multi-chart surfaces, which the rules themselves do not cover.

**Where this sits:** it is the deep reference behind the
[Data Visualisation](data-visualisation.md) subsection of
[Product Management Best Practices](best-practices.md). Read the subsection first — it carries
the Ally-specific rules (sample size, tenant isolation and minimum group size, provenance of
LLM-derived scores, which surfaces own which metric). This page carries the chart craft. They
are written to agree; if they ever conflict, the subsection wins on *what Ally may show* and
this page wins on *how to draw it*.

---

## 0. How to use this document

If you are a coding agent building a dashboard, treat this as a **constraints file**, not background reading.

- Sections 1–10 are **rules**. Follow them unless the user overrides.
- Section 11 covers interaction behaviour.
- Sections 12–14 are **lookup tables** for chart selection and conceptual diagrams.
- Section 15 covers dashboard-level composition.
- Section 16 is the **acceptance checklist**. Run it against every chart before declaring the work done.
- Section 17 is the fast **anti-pattern list**. If any item appears in your output, fix it.

When a rule conflicts with a user instruction, the user wins — but say which rule is being broken and why it matters.

---

## 1. Prime directive

Two independent axes determine whether a chart is good:

1. **Contextual awareness** — does it convey the right idea, to the right audience, in the right setting?
2. **Design execution** — is it well constructed?

Both must be high. A relevant chart with imperfect execution beats a beautifully executed chart carrying the wrong message. Software can help with execution; it cannot supply context. Context has to come from a human decision about what the chart is *for*.

**Corollary for agents:** never pick a chart type from the data's shape alone. Ask (or infer and state) what the viewer is supposed to conclude. Software renders data; people render ideas.

---

## 2. How people actually read a chart

Five perceptual facts drive every rule that follows.

### 2.1 Reading order is not guaranteed
Prose is consumed in a fixed sequence at a steady pace. Charts are not. The eye lands somewhere in the visual field first, jumps around, and may reach the title late or never. Pacing is bursty, not even.

**Implication:** compose outward from the visual, not top-down from the title. Every supporting element exists to explain whatever the eye has already landed on.

### 2.2 Whatever stands out gets seen first
Attention goes automatically to change and difference: spikes, crossovers, outliers, dense regions, the one saturated colour among muted ones.

**Implication:** the most visually salient thing on the chart must be the thing that matters. If they diverge, the chart is actively fighting itself. This is a hard check, not a preference.

### 2.3 Only a few things register at once
As the number of plotted elements rises, individual values dissolve into an aggregate shape. Rough thresholds:
- Beyond roughly **5–10 discrete variables or series**, individual meaning starts to fade.
- People cannot reliably distinguish more than about **8 colours** simultaneously.

Two kinds of complexity exist:
- **Bad complexity** — too much data, no salient point and no coherent overall shape. Reads as noise.
- **Good complexity** — a very large number of points that resolves into a few readable features (a dense cluster, a directional drift, visible striation). Legitimate, but only if the reader can process it at a blurry, gestalt level.

**Implication:** if the viewer must act on individual data points, plot as few as possible. If the viewer needs the overall pattern, plotting many is fine — but verify a pattern actually emerges.

### 2.4 Viewers construct causal stories, invited or not
Anything placed together will be read as related. Salient elements get absorbed into a narrative whether or not a real relationship exists. This happens fast and partly pre-consciously.

**Implication:** co-locating unrelated series manufactures false narratives. Choosing *what to include* is therefore a correctness decision, not a layout decision. Also: extending the plotted time range can flip the story entirely — check that your window isn't accidentally implying causation.

### 2.5 Conventions and metaphors are load-bearing
Learned expectations act as cognitive shortcuts. Violating them forces conscious parsing and burns the reader's attention.

Conventions to respect:
- Time runs left to right on the x-axis. Not up, not right to left.
- Up / higher = greater. High values must not sit spatially low.
- Green reads positive, red negative — **except** in temperature-like contexts, where red is hot/active and blue is cold/inactive.
- Hierarchies descend from the top.
- Lighter, less saturated colour = lower or emptier value; darker, more saturated = higher or fuller.
- Similar colours signal items belonging to the same group.
- Ordered categories should be laid out in order, ascending or descending — including in the legend.
- Connect points with a line **only** when there is a real progression from one value to the next. Unrelated categories get bars, not a line.

**Stakes:** when meaning is hard to extract, readers do not conclude that the chart is bad — they conclude the *information* is less credible. Poor presentation damages trust in the underlying data.

---

## 3. Classify the job before building

Two questions, asked before any chart type is chosen.

**Q1 — Is the information conceptual or data-driven?**
- Conceptual: qualitative. Processes, frameworks, hierarchies, cycles. Goal is to simplify and teach.
- Data-driven: quantitative. Statistics, measurements. Goal is to inform.

**Q2 — Am I declaring or exploring?**
- **Declarative** — stating something to an audience. Finished, well designed, usually formal.
- **Confirmatory** — testing a hypothesis you already hold. Rougher, iterative, audience is yourself or a small team. Applies only to data-driven work.
- **Exploratory** — looking for patterns you cannot yet name. Roughest, most inclusive of data, often interactive; frequently needs specialist skills.

The 2×2 that results:

| | Declarative | Exploratory |
|---|---|---|
| **Conceptual** | **Idea illustration** — org charts, process and cycle diagrams, matrices. Skills: editing, restraint. Main failure mode: over-decoration and mixed metaphors. | **Idea generation** — whiteboard sketching to work through non-data problems. Skills: facilitation. |
| **Data-driven** | **Everyday dataviz** — the standard charts used in reports and presentations. Small, simple data; one clear point. Skills: design, storytelling. | **Visual discovery** — confirmation and exploration. Big, complex, sometimes live data; unconventional forms; interactivity. Skills: BI, programming. |

As you move from declarative toward exploratory: certainty falls, data complexity rises, time investment rises, and you increasingly need a team.

**Dashboard implication `[EXTRAPOLATION]`:** most dashboards are *neither* purely declarative nor purely exploratory — they are everyday dataviz that must degrade gracefully into visual discovery. Resolve this by layering: the default view is declarative (few elements, one point per chart, self-explanatory), and exploration is reached through interaction (filters, drill-down, toggles). Do not ship an exploratory-density default view to a declarative audience.

---

## 4. Required anatomy of every chart

Every chart intended for others must contain:

1. **Title**
2. **Subtitle**
3. **Visual field** — the plot itself, plus axes, labels, and where needed captions and legend
4. **Source line**

Why this is non-negotiable:
- **Self-sufficiency.** A missing element derails the conversation into questions about the chart instead of the idea. The less you have to explain the chart, the more you can discuss what it means.
- **Portability.** Complete charts can be reused, shared, and revisited without their provenance being in doubt.

**Benchmark for the target: a chart should work with no verbal explanation at all.** If it needs narration to be understood, it has failed — like a joke whose punchline requires a footnote.

---

## 5. Structure and hierarchy

Produces the impression of "clean" versus "messy."

### 5.1 Weighting
Approximate share of the chart's visual weight:

| Element | Share |
|---|---|
| Title | ~12% |
| Subtitle | ~8% |
| Visual field | ~75% |
| Source line | ~5% |

The visual field dominates; everything else serves it. An over-weighted title competes with the plot. An under-weighted one wastes an opportunity to orient the reader. These are guidelines, not measurements — deviate when there is a real reason (e.g. a dense map that needs the space), and hold the ratios otherwise. They hold across orientations: wide presentation, tall phone, square feed.

### 5.2 Alignment
Use as **few points of alignment as possible**. More alignment points make a chart feel busier.
- Left-align title, subtitle, and legend to a single reference edge.
- Avoid centre justification — it creates a second alignment axis for elements that could share one.
- Unaligned labels inside the plot read as haphazard.
- The axes are already a grid; use them as baselines for labels and other elements.

### 5.3 Minimise eye travel
- Prefer **direct labelling** over legends. Label a line at its end, next to the line.
- Where a legend is unavoidable, place it adjacent to what it describes.
- Keep pointers and leader lines short and straight. Eliminate them where alignment alone will do the job.
- Avoid elbows and curves in pointers; they pull focus away from the data.
- The farther a label is from its mark, the harder the connection is to make.

---

## 6. Clarity

Clarity is about **effective communication**: does the intended idea arrive?

### 6.1 Nothing extraneous
Remove non-essential information. Words that the labels already imply ("Year" over year labels, "States" over state labels) can usually go.

### 6.2 Every element unique and supporting
Each element should do a job no other element does. Zero redundancy. Warning signs that a chart plots data without making a point:
- The title restates the axis labels.
- The caption describes what the visual mechanically shows.
- Multiple elements say the same thing.

Supporting elements should describe the chart's **idea**, not its **structure**.

### 6.3 Titles carry the idea
The title is not a label; it is a clue that helps the reader interpret what they already saw.

Effective patterns:
- **State the finding**: rather than "Annual Health Care Spending," use "Annual Growth Is Declining."
- **Pose the question the chart answers**: "How many items make a list go viral?"
- Choose title words that guide the eye — a word implying a peak or a sweet spot directs attention to the corresponding region of the plot.

The same visual, with a different title, produces a different takeaway. Use this deliberately.

A neutral, descriptive title is legitimate when the context calls for detachment — analyst output that is meant to present rather than judge. Know which situation you are in.

### 6.4 Zero ambiguity
Every element must have one unambiguous purpose. An ambiguous label makes the reader stop and interpret the chart instead of using it — the equivalent of parsing a confusing road sign at speed. Unlabelled reference lines, legends that could be mistaken for axes, and multiple unexplained y-axes all produce this failure.

---

## 7. Simplicity

Simplicity is about **effective presentation**: are you showing only what the idea requires? Related to clarity but distinct — simple is not automatically clear, and clear need not be simple. Excessive stripping destroys clarity.

Target **relative simplicity**: the least you can show and still convey the idea clearly.

### 7.1 The keep/kill decision flow
Run this on every element:

1. **Is it necessary?** — measured against the stated purpose of the chart. If not → consider eliminating.
2. **Is it unique?** — if it duplicates another element, compare the two and drop one.
3. **Can it be simpler?** — if yes, simplify and keep.

Judge "necessary" against a written statement of what the chart is meant to say. Without that statement, the test has no anchor.

Editing your own chart is hard: you included every element because you thought it mattered. Be aggressive anyway. You can almost always remove more than feels comfortable. Test sparse versions on someone else.

### 7.2 Axes, ticks, gridlines
Airiness comes largely from reducing background structure: reference lines, tick marks, value intervals. How much to keep depends on medium and task:

| Context | Structure to keep |
|---|---|
| Prototype / personal analysis | Dense — full gridlines, many labels. The reader can dwell. |
| One-on-one or small group discussion of specifics | Moderate — enough reference points to say "look at November." |
| Broadcast in a presentation, understood in seconds | Sparse — minimal gridlines and axis labels. |

Decide by asking: **what should the viewer do with this chart?** If only the shape of the trend matters, strip reference points hard. If specific values will be discussed, keep them.

### 7.3 Value labels
Labelling every data point is a common reflex and usually wrong. A visualisation is an abstraction; labelling every value re-concretises it and the labels start to overwhelm the plot.

Ask:
- Is each individual value necessary to the idea?
- Must specific values be available for the discussion?

If either is yes, **provide a table** — that is what tables are for. Then the chart is free to be much simpler. A table plus a simple chart usually beats one over-labelled chart. If the point is the trend or the shifting share, specific values only compete with it.

### 7.4 No belt-and-suspenders design
One form of emphasis per element is enough. A title given size, bold, underline, colour, and caps at once has four redundant signals. Pick one — or at most two, which is a common and acceptable convention for titles.

Instead of giving every element unique attributes, define **classes** of information: captions, legends, and labels can share one text style. Lines, boxes, and arrows used to group or connect are frequently redundant — alignment achieves the same thing with no marks at all.

### 7.5 Simplicity requires nerve
The instinct to show everything comes from two fears: that you will omit something important, and that a sparse chart will look like insufficient work. The first fear is legitimate and is handled by knowing your purpose. The second is not. Dense charts do not demonstrate rigour; they convert spreadsheet cells into visual noise. Reviewers consistently prefer a couple of excellent charts to a barrage of adequate ones.

---

## 8. Colour

### 8.1 Reduce colour like a fraction
Find the smallest number of colours that still preserves the distinctions the idea needs. Every additional colour difference is a question the viewer must answer ("what does this one mean?").

Challenge each colour: *why do I need this distinction, and can these items be grouped under one colour instead?*

Worked pattern: eight time-of-day categories → four grouped blocks → two colour families (one warm for morning, one cool for afternoon) with paler tints for the less important sub-periods. Each reduction increased legibility.

### 8.2 Grey is a primary tool
Grey creates information hierarchy at zero cost. Grey elements read as background or secondary; coloured elements read as foreground.

Use grey for:
- Gridlines and axis lines — retains their usefulness while letting them recede.
- Contextual or comparison series that support the main point without competing.
- Any series that is not the subject of the chart.

### 8.3 Colour follows convention
- Contrasting data → contrasting colours.
- Complementary data → complementary colours.
- Grouped data → same or similar colours.
- Ranges/scales → low saturation for low values, high saturation for high values. Desaturating to near-colourless at zero exploits the "empty means none" convention and is very effective for heat maps.

### 8.4 Colour failure modes
- **Semi-transparent overlapping fills** produce a third colour that dominates and pulls attention to the overlap region rather than the lines.
- **Filling one series and not another** makes the filled area distracting and the comparison uneven.
- **Two shades of the same hue** imply two members of a group, not a contrast. Use them for grouping, not comparison.
- **Maximum-contrast pairs** (e.g. black and blue) do not necessarily make either one pop.
- **Meaningless colour coupling is actively harmful.** The visual system will subconsciously build cohesion among same-coloured items and suppress everything else. If the colour grouping is arbitrary, you have manufactured a false relationship the viewer cannot see themselves doing.
- **Every series in a bright colour** means no series stands out.
- **A ramp that runs to full saturation under printed values.** If cells carry their numbers (a heatmap, a cohort grid), a ramp reaching opaque forces a light/dark text switch somewhere in the middle — and there is a band around the switch where *neither* text colour clears 4.5:1. Stop the ramp short (roughly 0.55 alpha over a light tile) so one text colour stays legible across the whole scale. The number is the value; the colour only supports it.

---

## 9. Emphasis and focus

Three steps to make a chart land. All three are legitimate; section 10 covers where they stop being legitimate.

### 9.1 Hone the main idea
Write the sentence first. Two prompts:
- `What am I trying to say or show?` — the default, and correct for neutral or analytical work.
- `I need to convince them that…` — use when the default is producing flat charts.

The second prompt naturally recruits more consequential language and tends to produce a sharper visual. Guard against slipping into editorialising about the audience rather than the idea ("they're wrong about X" is not a usable starting statement; keep pushing with "why?" until you have a claim about the data).

### 9.2 Make it stand out
- **Emphasise**: rich colour on the focal series, muted or grey on everything else. Add pointers, markers, direct labels, or a demarcation line to say explicitly what the viewer should notice.
- **Isolate**: reduce the number of unique attributes assigned to non-focal elements. Group them, grey them out, or merge several categories into one "all other" series. Every element with a unique attribute competes with the main idea.
- **Demarcations** — a single reference line marking an event, a threshold, or an expected level — are cheap and disproportionately powerful. Without them the reader often cannot identify what caused a visible change.
- **Unit charts** (one mark per person, per item, per dollar) beat aggregate statistics when the subject is people or discrete things. Concrete units are more relatable than percentages, and they are especially good for risk and probability. Consider render cost on large screens and low-DPI displays.

### 9.3 Adjust the surroundings
The most powerful lever is changing the reference points:
- **Remove** reference points that dilute the idea (drop the middle categories when the point is a divide between extremes).
- **Add** reference points that expose hidden context (a series that looks like a dramatic recovery may look trivial once its earlier history is plotted).
- **Shift** reference points to something the audience already understands. Converting hours-per-year into workdays-per-person, or per-ounce prices into per-case prices, connects far faster because the new unit is familiar.

**Grouping order matters too:** group bars by the dimension the idea is about. If the point is an age divide, group by age, not by feature.

### 9.4 There is no neutral chart
Every chart is a set of choices about what to include, emphasise, and omit. Chart width alone changes the reading — stretching the y-axis and compressing the x-axis turns a gentle rise into a steep climb, with identical data at identical scale. There is no objectively correct aspect ratio. Since a responsive layout can change this without anyone deciding to, **check how your charts read at each breakpoint** `[EXTRAPOLATION]`.

Accepting that no chart is neutral is what makes section 10 necessary.

---

## 10. Persuasion versus deception

Persuasion techniques become deception when pushed too far. The four failure modes: **falsification, exaggeration, omission, equivocation.** One person's isolation is another's omission; emphasis applied hard enough becomes exaggeration. The boundary is genuinely blurred and shifts with context — the same chart can be fine in one setting and misleading in another.

### 10.1 Self-test before shipping
Ask, honestly:
- Does this chart make the idea easier to see, or does it **change** the idea?
- If it changes the idea, does the new idea contradict what the plainer version showed?
- Does removing data hide something that would legitimately challenge the point?
- Would I feel deceived if someone showed me this?

Also: could you defend the chart against a hostile question, with evidence? The right focus is not whether a technique is permitted, but whether the idea it produces is **defensible**.

### 10.2 Falsification — never
Do not misrepresent the data. The clearest example: plotting cumulative totals as discrete bars, so that year 1's revenue is counted five times across five bars, producing a fake growth trend. Continuous data disguised as categorical is a lie, because readers expect each bar to be a distinct value. Plot the annual values.

### 10.3 Truncated y-axis — conditional
**What it is:** removing valid ranges from the y-axis; most commonly not starting at zero. Lopping off the *top* of a range does the same thing and is noticed less.

**Why it's used:** it magnifies change, revealing texture that a full axis flattens. When data sits consistently far from zero, a full axis leaves most of the chart empty, and compensating by resizing produces awkward, distracting proportions.

**Why it deceives:**
- The visual descent no longer corresponds to the numeric change: a line can traverse 100% of the plot height to represent a 25-point decline.
- It destroys representative space. In a percentage chart, the area above and below a line no longer reflects the actual proportions at any point. Verify this by pulling three points into stacked bars — under truncation, a 67/33 split will render as roughly 50/50, which is simply wrong.
- It fights a strong convention. Readers treat the bottom of a chart as zero and the top as the ceiling. A line approaching the floor reads as approaching nothing, producing a false sense of termination and a distorted conclusion ("almost nobody does this any more" when in fact a majority still do).

**Rules:**
- **Never truncate with categorical or proportional data.** There is no honest use.
- Bar charts encode value by length; a truncated baseline invalidates the encoding. Start bar axes at zero.
- Line charts of a bounded range (percentages, ratings on a fixed scale) should default to the full range. If you truncate, the truncation must be visible and stated.
- If you truncate, be prepared to justify why the change matters — ideally with supporting evidence that the magnitude is meaningful.

### 10.4 Double y-axis — conditional, default to avoiding
**What it is:** two vertical scales for different datasets in one plot area.

**Why it's used:** it forces a comparison. It does not argue that a relationship exists; it asserts one by placement.

**Why it deceives:** the relationship is an artefact of scale selection. Crossovers, convergences, matching slopes, and gaps are all meaningless. Two series on independent scales can be made to cross, track, or diverge almost at will. It gets worse when the axes carry different units — a line at a third of the height of a bar might represent 3% of its value. When the two measures are unrelated, the chart shows events in space (a crossover between seconds and page views) that cannot mean anything at all.

**Rules:**
- Default: **do not use a secondary y-axis.**
- Prefer, in order: (a) two charts side by side; (b) small multiples; (c) indexing both series to a common baseline and plotting relative change on a single axis.
- Note the trade-off with indexing: it shifts the subject from level to change. Absolute values become unreadable. Choose deliberately.
- Never combine a secondary axis with truncation. Closeness between lines then becomes doubly artificial.

### 10.5 Choropleth maps — conditional
**What it is:** geographic regions colour-coded by value.

**Why it's used:** geography is an extremely efficient lookup convention. Comparing many locations is far faster on a map than in a sorted bar chart, and regional patterns are visible almost without effort — something no other form provides.

**Why it deceives:** region area rarely corresponds to the encoded value. A sparsely populated region can occupy thousands of times the area of a denser one with more people, so colouring by area systematically over- or under-weights. A result that looks geographically overwhelming may be far closer than it appears.

**Mitigations, each with costs:**
- **Bar chart** — accurate, but destroys fast location lookup and regional pattern recognition.
- **Cartogram** (area distorted to match value) — accurate, but heavy distortion makes the geography hard to recognise.
- **Grid map** (equal-size cells placed approximately where regions belong) — reduces area bias, but breaks the learned shape of the map and relies on colour gradation, which limits how many distinct values are legible.

**Rules:** normalise by population or another appropriate denominator; state the denominator in the subtitle; consider pairing the map with a sorted bar chart or table so magnitude is recoverable; use no more colour steps than are actually distinguishable.

---

## 11. Interaction and progressive disclosure

Interactivity resolves several decisions that static charts must commit to up front.

- **Hover states** solve the labelling dilemma — the trend stays clean, exact values are available on demand.
- **Toggles** manage complexity by showing and hiding series.
- **Sequential controls** (next / step) let the reader control the pace at which information is added or removed.
- **Filters and re-query** turn a presentation into a conversation: a question like "what does this look like excluding the newest cohort?" becomes a new chart immediately.

The governing principle: **make everything available, but not everything visible.** Depth and complexity become on-demand rather than pre-committed.

### 11.1 Design for the time the viewer has
A useful practice: build the same information at multiple depths matched to how long each audience will spend with it — roughly **20 seconds** for executives, **2 minutes** for managers, **20 minutes** for analysts.

Related rule: **show something simple, leave behind something detailed.** The at-a-glance version and the explorable version are different artefacts serving different needs, and a dashboard can carry both.

### 11.2 When the categories outnumber the pixels `[EXTRAPOLATION]`
A charting library handed more categories than its container is wide does not overflow — it fits them
in. That is the failure mode to watch for, because it is silent: the marks shrink toward hairlines and
the tick labels rotate into a solid band, and the panel reads as broken rather than as full. Nothing
about the data was wrong.

Order of preference:

1. **Coarsen the bucket.** Days → weeks → months answers the same question at the resolution the card
   can actually draw, and is the only option that keeps the whole range in one view. Put the control
   on the panel (§11) rather than choosing for the reader.
2. **Give the plot the width it needs and scroll the container.** Set a floor of horizontal room per
   category, let the plot exceed the card, and scroll sideways. Pay for it honestly: the axis and
   legend usually live in the same drawing as the plot and leave view with it, and part of the range
   starts off-screen — say so beside the plot, and make the scroll region keyboard-reachable.
3. **Move to a table.** Past the point where even a scrolled plot is a chore to read, the reader wants
   values, not shape (§7.3).

What not to do: thin the tick labels and leave the marks compressed. That fixes the symptom you can
name and leaves the one you cannot — bars too thin to compare with each other. And check which axis is
crowded: a long horizontal bar chart is crowded vertically, so a sideways scroll neither relieves it
nor is honest about what is missing.

### 11.3 What interactivity does not fix `[EXTRAPOLATION]`
Interaction cannot rescue a default view whose salient element is the wrong one, cannot repair a misleading axis, and cannot substitute for knowing the idea. Every state reachable through interaction is itself a chart and is subject to every rule above — including states produced by filtering down to very few data points, and states at the smallest breakpoint. Audit the default view and the extremes.

---

## 12. Chart selection: keyword → candidate forms

Derived from the practice of extracting the vocabulary someone actually uses when describing what they want to show, then matching it to forms. Metaphors in the description are strong signals ("flowed into," "cascaded," "fell off a cliff," "spread out over").

| Vocabulary in the request | Candidate forms |
|---|---|
| before/after, categories, compare, contrast, over time, peaks, valleys, rank, trend, types | bars, bump chart, lines, slope chart, small multiples |
| distributed, spread, spread over, from/to, transfer, plotted, points, cluster, relative to | alluvial, bubble, histogram, Sankey, scatter |
| components, parts, pieces, portion, proportion, percentage, share, of the whole, divvied up, group, total, subsections | pie, stacked area, stacked bar, treemap, unit chart |
| connections, network, relationships, hierarchy, organise, structure, paths, routes, if/then, yes/no, complex, group, places, space | flow chart, geographic, hierarchy, 2×2, network |

**How to use this:** as an inspiration list, not a decision machine. No cheat sheet is complete; every listed type has many variants, and hybrids (bars over a map) are legitimate. Sketch **at least two genuinely different forms** before committing, even when the obvious choice seems obvious — the practice checks your assumptions and occasionally finds something better. Comparing product cost against monthly income looks like a bar chart problem until the phrase "how much of monthly income it takes up" suggests a proportional form instead.

---

## 13. Chart type reference

| Form | Best for | Failure mode |
|---|---|---|
| **Bar / column** | Comparing discrete categories on one measure. Universally understood. | Many bars start reading as a trend line rather than distinct values; multiple grouped series get hard to parse. |
| **Line** | Trends in continuous data, especially several series compared. | Focus on the trend makes individual points hard to discuss; too many lines and no single line is followable. |
| **Slope chart** | Simple before/after change; spotting values that move against the crowd. | Hides everything between the two states; crisscrossing lines obscure individual movement. |
| **Bump chart** | Change in ordinal rank over time; winners and losers at a glance. | Rank changes carry no magnitude information; many lines and levels become decorative rather than readable. |
| **Small multiples** | Same measure across many categories on a shared scale — dozens are workable. | Weak without dramatic variation; cross-series events like crossovers are lost. |
| **Scatter plot** | Relationship between two variables; correlation, clusters, outliers. | Shows correlation so persuasively that viewers make the causal leap unprompted. |
| **Bubble chart** | Scatter plus a third (size) and sometimes fourth (colour) dimension. | Area is not proportional to radius, so sizing is easily wrong; more axes means more parsing time, so poor for at-a-glance use. |
| **Histogram** | Distribution and frequency across a range; probability. | Routinely mistaken for a bar chart, which shows something entirely different. |
| **Pie / donut** | Dominant versus non-dominant share of a whole. | People estimate wedge area badly; more than a few slices becomes unreadable. |
| **Stacked bar** | Proportional breakdown of totals; often a better pie. Works in either orientation. | Too many segments, or many stacked bars side by side, makes differences and changes invisible. |
| **Stacked area** | Changing proportions over time; sense of accumulation or volume. | Many layers produce slivers too thin to track. |
| **Treemap** | Compact detailed proportional breakdown, including hierarchy. | Labelling is genuinely hard; many similar-sized rectangles lose meaning; needs a colour strategy that groups rather than differentiates everything. |
| **Unit chart / dot plot** | Tallies of concrete things — people, items, dollars. Risk and probability. | Too many unit categories obscures the point; arrangement requires real design care. |
| **Table** | Making every individual value available and comparable. | No at-a-glance trend, no quick comparison between groups. |
| **Geographic / map** | Location-based lookup; simultaneous local, regional, and global patterns. | Region size misrepresents the encoded value (see 10.5). |
| **Network diagram** | Relationships between entities; clusters and outliers; whitespace as opportunity. | Gets complex fast; can be beautiful and uninterpretable. |
| **Sankey / alluvial** | Flow and transfer of quantities through a system; dominant paths, inefficiencies. | Many components and paths produce a crisscrossed tangle. |
| **Flow chart** | Processes and decision points, using an established shared syntax. | Requires the reader to know the syntax (diamond = decision, and so on). |
| **Hierarchy / org chart** | Structure and relative rank of a set of elements. | Box-and-line form limits achievable complexity; poor at informal or dotted-line relationships. |
| **2×2 matrix** | Categorising by two variables; creating named zones. | Placing items at varying positions within quadrants implies a statistical relationship that usually does not exist. |
| **Metaphorical / conceptual** | Non-statistical ideas and processes; leverages instant recognition. | Mixed metaphors, misapplied metaphors, and over-decoration. |

---

## 14. Conceptual and metaphorical diagrams

If the dashboard includes non-data diagrams (architecture, process, funnel, hierarchy):

- Conceptual work has no axes or dataset to discipline it, so **discipline must be imposed deliberately.** Over-decoration is the standard failure.
- **Make the metaphor do real work.** If you invoke a pyramid, use height to encode the thing that varies — do not draw pyramids and then place all levels on one plane. A metaphor that is only imagery is worse than none, because it invites a reading the diagram then contradicts.
- **Literalness is a trap.** "Funnelling customers" does not require drawing a funnel.
- **Stylisation is a red flag:** 3-D extrusion, drop shadows, gradients, textures, decorative photography. These pull attention to the ornament and away from the idea.
- Use the axes, when there are axes, to carry conventions the reader already has — near-to-far, low-to-high.
- The skill required is closer to **editing** than illustration: channel the impulse toward the clearest, simplest version.

---

## 15. Dashboard-level composition `[EXTRAPOLATION]`

The rules above address individual charts. These are direct consequences applied to a multi-chart surface.

1. **One idea per chart.** A dashboard is not a place to be comprehensive per tile. If a chart has two messages, it is two charts.
2. **Salience budget across the whole screen, not per chart.** Rule 2.2 applies to the composed page. If six tiles each contain a bright focal colour, the page has no focus. Choose which tile leads; render the rest in restrained palettes.
3. **False-narrative risk scales with proximity.** Rule 2.4 means adjacency implies relatedness. Deliberately group related tiles and separate unrelated ones; do not let grid packing decide.
4. **Shared visual language.** Define classes once — one style for all titles, one for all subtitles, one for all axis labels, one for all captions. A single grey for structural elements. One accent for focal data. Consistency is the cheapest source of the "professional" impression.
5. **Consistent encodings across tiles.** If a colour or dimension means something in one chart, it must mean the same thing in every chart. Inconsistent encoding across a dashboard is the multi-chart version of meaningless colour coupling.
6. **Every tile is complete.** Title, subtitle, visual field, source. Tiles get exported, screenshotted, and pasted elsewhere; a tile without provenance becomes an unanswerable question later.
7. **Titles state findings where the finding is stable; state the metric where it is not.** A live tile whose direction changes cannot carry "Growth Is Declining" in its title. Either compute the headline from the data or use a neutral metric title plus a computed annotation.
8. **Density tiers by role.** Default view sparse; drill-down dense; export dense. Do not compromise on a single middle density that serves nobody.
9. **Prefer tables where tables belong.** If users need exact values — and on dashboards they frequently do — give them a table rather than labelling every point on a chart. Chart for shape, table for value.
10. **Audit the extremes.** Empty state, single data point, maximum expected series count, longest plausible label, smallest breakpoint. Each is a chart and each must obey the rules.

---

## 16. Acceptance checklist

Run per chart before considering it done.

**Purpose**
- [ ] A one-sentence statement of what this chart says is written down.
- [ ] The chart type was chosen from that statement, not from the shape of the data.
- [ ] At least one alternative form was considered.

**Salience**
- [ ] The first thing the eye lands on is the thing that matters.
- [ ] Nothing salient is irrelevant to the point.
- [ ] Only elements that are genuinely related appear together.

**Structure**
- [ ] Title, subtitle, visual field, and source line all present.
- [ ] Visual field dominates; weighting roughly 12 / 8 / 75 / 5.
- [ ] Elements share as few alignment lines as possible; nothing centre-justified without reason.
- [ ] Direct labels used instead of a legend wherever possible; any legend sits next to what it describes.
- [ ] Pointers short and straight, or absent.

**Clarity**
- [ ] Title expresses the idea, not the axis labels.
- [ ] No element restates another.
- [ ] Every element has one unambiguous purpose. Nothing unlabelled that needs a label.
- [ ] The chart is comprehensible with no verbal explanation.

**Simplicity**
- [ ] Keep/kill flow run on every element.
- [ ] Gridline and tick density matches how the chart will be used.
- [ ] Value labels present only where individual values matter; otherwise a table is provided.
- [ ] One emphasis treatment per element.
- [ ] A sparser version was tried, and this is the sparsest version that still works.

**Colour**
- [ ] Colour count reduced to the minimum that preserves needed distinctions.
- [ ] No more than ~8 distinguishable colours; grouped into families where possible.
- [ ] Grey used for structure and context.
- [ ] Saturation maps to magnitude; similar colours mean similar things.
- [ ] Every colour distinction is meaningful — no arbitrary grouping.

**Conventions**
- [ ] Time runs left to right; higher means greater.
- [ ] Red/green and hot/cold used consistently with the context.
- [ ] Ordered categories in order, including in the legend.
- [ ] Lines only for genuine progressions.

**Integrity**
- [ ] Bar baselines at zero. Proportional and categorical data not truncated.
- [ ] Any truncation is visible, stated, and defensible.
- [ ] No secondary y-axis, or a documented reason plus a considered alternative.
- [ ] Geographic data normalised, with the denominator stated.
- [ ] Removed data does not hide a legitimate challenge to the point.
- [ ] The chart makes the idea easier to see rather than changing it.
- [ ] It would survive a hostile question.

**Interaction**
- [ ] Exact values available on demand rather than pre-printed.
- [ ] Default state is the simple state.
- [ ] Interaction-reachable states, breakpoints, and edge states audited against this checklist.

---

## 17. Anti-pattern quick list

Reject on sight:

- Cumulative values plotted as discrete bars.
- Truncated axis on categorical or proportional data.
- Bar chart with a non-zero baseline.
- Secondary y-axis used to imply a relationship.
- Choropleth of raw counts with no population normalisation.
- 3-D anything. Drop shadows, bevels, gradients used decoratively.
- Every series in a saturated colour.
- Two shades of one hue used to signal a contrast.
- Semi-transparent overlapping fills.
- Legend far from the data, forcing sustained back-and-forth.
- Every point labelled with its value on a trend chart.
- Title that repeats the axis labels; caption that repeats the title.
- Title bold + underlined + coloured + caps + oversized.
- Unlabelled reference line.
- Line connecting unrelated categories.
- Pie chart with many slices.
- Time on the y-axis; time running right to left; high values sitting low.
- Legend listing ordered categories out of order.
- Colour coupling that encodes nothing.
- A chart that requires narration to be understood.
- Categories compressed until the marks are hairlines and the labels are a smear, rather than the plot
  being widened, the bucket coarsened, or the data moved to a table.
- A plot cut off at its container's edge with nothing saying the range continues.
- The same dimension encoded differently in two tiles of one dashboard.

---

## Appendix: process, if the agent is generating charts from a brief

A working sequence, roughly two hours for one or two charts:

1. **Prep (~5 min).** Set the data aside. Leading with the spreadsheet columns produces charts that merely transcribe tables. Write down: what it's called, who it's for, what setting it appears in, which of the four types it is. Note that stepping back from the data often reveals that the available field is the wrong field — a purchase-time chart normalised to the server's timezone rather than the buyer's local time is accurate and useless.
2. **Talk and listen (~15 min).** Describe out loud what you're trying to show, and answer "why?" repeatedly. Capture the exact vocabulary used, especially metaphors. If "why?" has no good answer, you are not ready to make a declarative chart — form hypotheses and explore first.
3. **Sketch (~20 min).** Fast, rough, messy, not to scale. Generative. The valuable output is deciding what **not** to pursue and which form to use. Try at least two different forms.
4. **Prototype (~20 min).** Iterative rather than generative. Realistic axis ranges and approximate values, real labels, initial colour decisions, on a subset of the data. Move on from sketching when the sketches converge on refinements of one idea, or when you find yourself adding real axes and labels.

**Agent adaptation `[EXTRAPOLATION]`:** steps 1–2 become explicit — state the audience, the setting, and the one-sentence purpose per chart before writing code, and ask the user if any of the three is unknown rather than guessing. Step 3 becomes proposing two candidate forms per chart in the plan. Step 4 becomes building with representative data before wiring live sources.

---

*Part of [Product Management Best Practices](best-practices.md) · the Ally-specific rules live in [Data Visualisation](data-visualisation.md).*
