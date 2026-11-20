# Roadmap idea quality: what a good idea is, and how the interview holds the line

An idea reaches the board for voting only after the idea agent (the "interview" on the Roadmap v2 draft
page) has judged it good enough. This page defines "good enough", says why, and points at the code that
enforces it. It is the spec the interview prompt, the checks, the score and the filing gate all follow.

Code: `ally-be/src/product-roadmap/constants/product-roadmap.constants.ts` (the numbers),
`ally-be/src/product-roadmap/util/roadmap-quality.util.ts` (the scoring),
`ally-be/src/prompts/roadmap/opportunity_copilot.txt` (how the agent interviews),
`ally-be/src/product-roadmap/draft/roadmap-draft.util.ts` (`submitBlock`, the draft-side gate).

## 1. What a good idea is

**One problem (or one gain) for one named group, with a change we could measure, tied to a named Ally
goal, bounded, and small enough that one team can ship it and learn something from it.**

Taking that apart:

| Property               | Means                                                                                                                                               | Why it matters                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Problem-first**      | Says what hurts or what win is missing before it says what to build. A proposed solution is welcome, but strike it and the goal must still stand.   | Ranking solutions guarantees we sometimes ship the wrong one; ranking problems doesn't.              |
| **Specific audience**  | A named group ("counsellors in their first week"), plus a sense of how many and how often.                                                          | Reach is half of every prioritisation formula, and "users" cannot be sized.                          |
| **Measurable outcome** | What changes for that group, and a signal (metric, observable behaviour, direction, baseline or target if one exists) we could check after release. | An idea with no way to tell whether it worked can never be learned from or declared done.            |
| **Strategic fit**      | Names which goal or bet on the Vision & strategy page it advances, and does not contradict a stated non-goal.                                       | Almost every idea is good; the constraint is sequence. Fit is how voters weigh one against the rest. |
| **Bounded**            | What is in, and at least one thing deliberately out; main risk or assumption named.                                                                 | Unwritten non-goals come back as scope creep. A scope line is also what makes an idea sizeable.      |
| **Right-sized**        | Small enough to ship as one thing: S, M or L.                                                                                                       | Bigger ideas can't be reviewed, voted on or finished as a unit.                                      |
| **Evidenced**          | Something beyond opinion: analytics, a user quote, a ticket or bug finding, a board precedent, the code.                                            | Confidence is a first-class input. This is scored, not required (see 3).                             |

This follows widely used product practice: opportunity-solution framing and "problems before
solutions" (Torres, _Continuous Discovery Habits_), outcomes over output and risk-first thinking
(Cagan, _Inspired_), jobs-to-be-done framing of who/when/why, reach × impact × confidence ÷ effort as a
conversation tool (RICE), thin vertical slices (the INVEST criteria for stories) and measurable
success criteria set before building. Ally's own guidance (the problem-before-solution, non-goal and
thin-slice principles on the Context Library and in the older `wiki/product/prioritisation.md`) says
the same, and the Vision & strategy page is where Ally-specific fit is judged.

## 2. Size, and why one interview can end in several ideas

| Size    | One idea?                                                                                                                                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S, M, L | Yes. File it.                                                                                                                                                                                                                                 |
| XL, XXL | No. The interview proposes **slices**: two to five independently shippable, each S, M or L, each with its own group, outcome, success signal and scope line, cut vertically (the thinnest end-to-end path first, never a backend-only phase). |

The same applies to an interview that turns out to describe two or more independent ideas. The author
presses **Split** on the draft page; each slice becomes its own draft that has already been through the
interview (same checks and quality grade, its own size, goal and words), and each is submitted to the
board on its own. The original draft keeps its history but can no longer be submitted. One interview
can therefore produce several ideas on the board.

Until 2026-11-20 any size could be filed. Until 2026-10-20 only S and M could, which made people
delete broad-but-well-defined ideas; slicing replaces that with the agent doing the cutting.

System filings (the PM Agent) carry no quality score and keep the older, wider size rule.

## 3. How an idea is judged: gates, then a score

Two layers, both enforced on the server. The model grades; it never decides.

### Hard gates (all eight must be met)

Yes/no, established in the author's own words or by evidence the agent found. Ids are permanent.

| id                     | The idea …                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `pain_or_gain`         | names a real pain or a real gain, not an activity with no stated benefit                         |
| `goal_before_solution` | leads with the goal; strike any proposed build and what we are trying to achieve is still stated |
| `clear_why`            | says why it is worth doing: the cost of leaving it, or what it unlocks                           |
| `who_it_affects`       | names the user group, not "users"                                                                |
| `outcome`              | says what changes for them                                                                       |
| `strategic_fit`        | serves a named Ally goal or bet and contradicts no non-goal                                      |
| `success_signal`       | says how we would know it worked: a signal and where we would look                               |
| `scope_boundary`       | draws the scope line: what is in, and at least one thing out                                     |

### Quality score (0 to 100)

The agent grades six dimensions 0 to 4 on anchored levels (0 absent, 1 vague, 2 adequate, 3 specific,
4 specific and evidenced). `gradeQuality` turns them into the score; a missing or malformed grade is a 0.

| Dimension                              | Weight | Floor |
| -------------------------------------- | ------ | ----- |
| Problem clarity                        | 20     | 2     |
| Audience and reach                     | 15     | 2     |
| Measurable outcome                     | 20     | 2     |
| Strategic leverage (why this, why now) | 20     | 2     |
| Evidence                               | 15     | none  |
| Scope and size                         | 10     | none  |

**Pass rule: every gate met, score at least 65, no floored dimension below its floor, and a size of S, M
or L.** Calibration: "specific" everywhere is 75; "adequate" everywhere is 50 (does not pass); specific
everywhere with only the author's own observation as evidence is 67.5 (passes). Evidence has no floor so
ideas spotted internally or derived from a bug report can still file; what it does is make an idea with
no support need to be sharper everywhere else.

The score, with each dimension's note, is shown to the author while they work. It is not an average
that can hide a hole: the floors and the gates cover that.

## 4. How the interview gets the author there

The agent (prompt `roadmap_opportunity_copilot`) is a coach, not a gatekeeper:

1. Each turn it finds the **single weakest point** (an unmet gate first, then the biggest weighted gap,
   floors before anything else) and asks one question about it.
2. It asks for the **concrete case** ("the last time this happened"), says why it is asking, and shows
   the shape of a good answer.
3. It **fetches before it asks**: roadmap search for duplicates, analytics, interview notes, UX signals,
   bug findings, docs and code. It asks the author only for what only the author knows.
4. It starts from the problem, keeps the author's solution as "Possible approach", and replaces vague
   words ("easier", "improve", "all users") with a sharper version for the author to accept or correct.
5. It judges fit against the Vision & strategy page (vision, audience, bets, non-goals, metrics), says
   plainly when an idea touches a non-goal, and never invents a fit.
6. It proposes slices when the idea is too big, and does not tell the author an idea is ready until the
   server says it is.

## 5. Where it is enforced

| Layer      | What                                                                                                                                             | Where                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Interview  | Grades gates and dimensions each turn; proposes the draft or slices                                                                              | `RoadmapCopilotService.buildTurn`                              |
| Score      | Computes the total and `passed`; fails closed                                                                                                    | `gradeQuality`                                                 |
| Token      | The signed readiness token carries the score (`q`)                                                                                               | `RoadmapReadinessTokenService`                                 |
| Draft page | `canSubmit` and Submit refuse below the bar, unsized, XL/XXL or already split (`quality_below_bar`, `not_sized`, `needs_split`, `already_split`) | `submitBlock`, `RoadmapDraftService.submit`                    |
| Filing     | A scored token below the pass mark, or an XL/XXL effort, is refused whatever the client sends                                                    | `RoadmapOpportunityService.assertReady`                        |
| Split      | Creates one graded sibling draft per slice, idempotent                                                                                           | `RoadmapDraftService.split`, `POST roadmap/drafts/:code/split` |

## 6. Tuning and rollout

- **The numbers are constants.** Weights, floors, `ROADMAP_QUALITY_PASS_SCORE` (65),
  `ROADMAP_SINGLE_IDEA_EFFORTS` and `ROADMAP_SLICES` live in one file. Retune the pass mark once real
  drafts have been graded; look at the distribution of scores of ideas the Owners accept and decline.
- **Adding a gate changes the criteria fingerprint**, which invalidates readiness tokens in flight and
  re-opens the new checks on existing drafts. That is intended: open drafts need one more interview turn.
- **The prompt text is live in the Skills Store.** The `.txt` is only the default. After deploying,
  publish the new `roadmap_opportunity_copilot` text with the `prompts` CLI, or the old interview keeps
  running against the new gates (see [`prompts-api.md`](prompts-api.md)). The prompt adds no variables,
  so the deploy-before-publish ordering rule does not bite.
- **A live prompt row can pin a model** (see the note on `ROADMAP_PROMPT_CODES.OPPORTUNITY_COPILOT`); check
  the row after publishing.
