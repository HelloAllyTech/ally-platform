# Chunk 3r — Review and refactor of chunks 1, 2 and 3a

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md`, `CHUNK-01-NOTES.md`, `CHUNK-02-NOTES.md`, `CHUNK-03A-NOTES.md`, then this file.
> Branch: the current Agents v2 branch (before its PR). Repos: all three, but **only code added or changed by chunks 1, 2 and 3a**.

## Why

Chunks 1–3a work and are well tested. They were built fast and revised several times (3a was redesigned once after Preview feedback). Before this becomes the base every later chunk builds on, make it **clear, consistent and idiomatic**, so chunks 3b–25 are easy to add. This is a quality pass, not a feature: **behaviour must not change.**

## Two passes, with a stop in between

### Pass 1: review (read-only)

Run it in a **fresh session** that didn't write the code. Use parallel reviewers if that helps: one each for ally-ai `agent_runtime` + `knowledge_agent`, the ally-be chatbot engine + WhatsApp inbound, ally-web, and tests + scripts.

List the files in scope with `git diff --stat master...HEAD` and review every one against this rubric.

**1. Structure.**
- Each module has one job.
- No god functions: flag anything over about 60 lines or with deep nesting.
- Clear boundaries: graph and nodes / tools / check / prompt / schemas / API.
- No circular or lazy imports used as workarounds.

**2. Naming and readability.**
- Names say what things are.
- No leftovers from the 3a redesign: dead code, unused state keys, stale comments, settings nothing reads, `contextualize` remnants.

**3. Types and contracts.**
- Python 3.12 typing throughout: `X | None`, `list[...]`, `TypedDict`, `Literal`/`StrEnum`, `Protocol` where it helps.
- Pydantic v2 idioms.
- In TypeScript, discriminated unions for decisions and runtimes, and no `any`.
- One source of truth for shared shapes, such as the request and response fields that exist in both repos.

**4. LangGraph idioms (version 1.x as installed).**
- State reducers and run-scoped resets.
- Whether services and bot config would be cleaner passed as runtime context (`context_schema` / `Runtime`) than as closures and state.
- Conditional edges and routing at `START`.
- Checkpointer lifecycle.
- Whether the `lru_cache`'d graph can capture the wrong checkpointer.

**5. The check layer** (`agent_check`, `looks_factual`, the organisation-name rules, contact-detail rules, markdown stripping, the rewrite loop).
- Are the rules expressed as a readable, ordered list of small pure checks with clear names and reasons?
- Is each heuristic isolated and tested?
- Flag anything fragile for businesses other than Ally. **Report only**: the organisation name becomes explicit in chunk 4.

**6. ally-be.**
- Has `chatbot-engine.service.ts` grown too large?
- Are effective runtime, agent mode, the keyword skip, fallback, shadow events and the alert throttle in well-named units?
- The request builder.
- The events used for shadow and fallback.
- The Slack opt-out flag.
- Settings overrides.
- Consistency with NestJS conventions already used in the repo.

**7. ally-web.** Component size; the Engine card and Preview `RunDetails`; types; copy in constants; consistency with neighbouring components.

**8. Tests.**
- Readable, with shared fixtures rather than copy-paste.
- Test names state behaviour.
- No brittle assertions on wording that's meant to vary.
- No slow or flaky patterns.

**9. Scripts and docs.**
- The parity and eval scripts share helpers instead of duplicating them.
- Clear CLI and output.
- NOTES files accurate after the redesign.

**10. Safety and ops.**
- No PHI in logs, traces or trace summaries.
- Timeouts and error mapping are consistent.
- Settings have sensible defaults and are documented in `env_sample`.

**Output:** `docs/agents-v2/REVIEW-1-3A.md`, containing:

- **A scorecard:** each rubric area rated 1–5, with one line of why.
- **Findings, numbered,** each with: area, file:line, what's wrong, the proposed change, **value** (high/med/low), **effort** (S/M/L), **risk** of behaviour change (low/med/high), and whether it's **must** (fix before merge), **should** (fix now if cheap) or **later** (note for a future chunk).
- **What's already good:** keep it short.

Respect each repo's existing conventions over fashion. "Modern" means idiomatic for the versions installed, not new libraries. No new dependencies are proposed without a strong reason, marked as needing approval.

**STOP after pass 1.** Shehbaz picks which findings to do.

### Pass 2: refactor (only the approved findings)

Rules:

- **No behaviour change:**
  - Every existing test passes with its assertions intact. A test may be moved or reorganised, but not weakened.
  - The v1 request snapshot is unchanged.
  - The `/agent/run` and `/knowledge-agent/answer` request and response shapes are unchanged.
  - The dashboard looks and behaves the same.
- **Prompt text unchanged,** unless a finding is explicitly about it and approved.
- **One commit per finding or small group,** titled `refactor(<area>): …` and referencing the finding number, so each can be reviewed or reverted alone.
- **No new dependencies or upgrades** without approval.

**Verification after the last commit:**

- Full suites and lint in all three apps: ally-ai `pytest` + `flake8`; ally-be `test`, `lint`, `typecheck`, `build`; ally-web `test` (admin), `lint` and the CI typecheck.
- **Parity:** `scripts/agent_parity.py` with the master baseline → 0 must-match failures.
- **Conversation eval** → 0 hard fails, run **twice**, with the judge mean within 0.3 of the last 3a run.
- p50 latency not worse than the last 3a run by more than 10%.
- Update the NOTES files where code locations changed, and add a short "Refactor summary" to `REVIEW-1-3A.md`: what was done, what was deferred, and the before/after line counts for the biggest files.

## How Shehbaz tests it

1. Read `REVIEW-1-3A.md` and pick findings: all "must", the cheap "should" ones, "later" left alone.
2. After pass 2, check the verification numbers in the refactor summary.
3. Quick smoke test in Preview (Agent mode on, New thread): who are you? → how do I get access? → and after that, how do I sign in? → what's your refund policy? → thanks. The replies should read as well as before.
4. Then the PR: a fresh review, open it and merge.
