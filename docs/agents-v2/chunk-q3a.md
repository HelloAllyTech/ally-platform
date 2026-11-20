# Chunk Q3a — Answers that use what it knows

> Brief for Claude Code. Read `CONTEXT.md`, `FIXES-17NOV.md` (causes C1–C6, C15), the two reports in `docs/agents-v2/evals/prod-17nov/`, `CHUNK-03A-NOTES.md` (retrieval, the decline gate, grounding), `CHUNK-20A-NOTES.md` (how the site reader stores facts and pages), `CHUNK-08A-NOTES.md` (memory), `CHUNK-06B-NOTES.md` (the latency tracing), then this file. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-q3a` from master after Q3b is merged. Tag commits `[Q3a]`. Repos: ally-ai mainly; ally-be (indexing, memory); ally-web only for the "What it knows" view if needed.
> **Stops:** (1) **the diagnosis**, before fixing anything: for every failed case, why it failed, with evidence; (2) every prompt text, before → after. About 2–3 days.
> **Being built now through `EPIC-Q3-FAST.md`:** build only the items that epic keeps; use this brief for their detail. The rest stays here for later.


## Why

On The Souled Store, 11 of 20 real questions failed; Cloudnine 7 of 14; Scripbox 3 of 9. The 30-day return policy is on the site seven times and the assistant said there's no time window. The phone number is there four times and it said it had none. Replies start "The provided passages do not…". This is the biggest gap between what's built and what a business will accept.

## 0. The eval suite and the diagnosis (the first stop)

- **Suite:** every answer case from both reports into `docs/agents-v2/evals/prod-17nov/answers.yaml`, against the three round-3 assistants and Mpower, Indian Accent, Honer, Neemrana (local copies of their knowledge: export from production with Shehbaz's help if needed, never their customers' chats). Each case names the expected fact and its source page. <!-- docs-path-lint: planned -->
- **For every failed case, find the step that lost it,** and show the evidence in `docs/agents-v2/Q3A-DIAGNOSIS.md`: <!-- docs-path-lint: planned -->
  1. **Is the fact in the index at all?** (The site reader's facts versus the pages it chunked; owner notes; "Describe your business" answers.)
  2. **What query was searched?** (After translation and rewriting; did it keep "Batman high top", "return", "phone"?)
  3. **Where did the right passage rank,** with scores, top 10? Was it cut by the decline gate's threshold, by top-k, or by a reranker?
  4. **Did the model have it and still say no?** (Then it's the prompt or the check.)
  5. **In multi-turn cases,** did the search use the conversation (S12's budget and brother, C8b's "Apartment")?
- **Count the causes** across all cases, then propose the fixes in order of how many cases each fixes. **Stop** with the diagnosis and the proposals.

## 1. The fixes the diagnosis is expected to point to (confirm or replace)

- **Search:** facts from the site reader and owner notes indexed as their own short passages next to page chunks; hybrid search (keywords with vectors) so exact names, numbers and policies match ("Batman high top", "phone", "return"); top-k and the decline threshold tuned on the suite; queries that keep the person's key terms and add context from earlier turns.
- **Chunking:** product, pricing and policy pages split so a name stays with its price and a policy with its window; repeated boilerplate (footers, payment logos) stripped before indexing; page titles cleaned.
- **Grounding picks the right fact (C15):** when two numbers are close (RIA versus PMS registration), cite the one whose passage answers the question; a source label is a page title, never a phone number.

## 2. The customer-facing voice (C2)

- **No internal words reach a customer:** "provided material", "passages", "materials", "sources say", "context", "If I don't know the answer…". Find where the model picks them up (system prompt, decline instruction, send-back notes) and change the wording there; plus a check that rewrites or removes any that slip through, with a test listing them.
- **When it truly doesn't know:** one honest line in the business's voice, then what it *can* do: the contact details from its sources, or (with a leads tool) the offer to take their details (6b item 29).

## 3. Honest offers (C3)

The base prompt says to offer only what the assistant's tools and sources make possible; and a check trims offers of actions no offered tool does ("add to cart", "check a delivery estimate", "send shipping updates", "can explain guarantee policies" when none exist). Tested on S2, S10, S17, P5.

## 4. Speed (C4)

From 6b's tracing of plain turns: remove the steps that don't change the answer (a forced second search, send-backs that rarely help, sequential calls that can run together, prompt size). Target on the suite: **median under 12 s, worst under 20 s** for plain questions. Report before and after per step.

## 5. Hand-over and leads in conversation (C5)

- **S12:** find why turn 2 handed over automatically; a hand-over happens only when the person asks for a person, when the owner's rules say so, or after repeated failure the person is unhappy about. Test.
- **C8c:** "Can someone call me tomorrow evening? I'm Asha, 9000000001" on an assistant with a leads or callback list is taken and confirmed (6b item 29's variant); without one, the reply gives the business's real number from its sources, never an unsourced one ("08069524603").

## 6. Memory on the live page (C6)

Diagnose M1 and M2 on a production-like setup: memory switched on? the same visitor across New chat? Then:
- "Please remember…" is an explicit request: remember it (within the rules), confirm in one line, and show it in the Inbox.
- A new chat from the same visitor gets the memory block; test on the bot page (cookie) and a verified email.
- If memory is off, the reply to "please remember" says plainly it can't remember between chats, without the decline voice.

## Tests

- **The suite (§0) before and after, 3 runs.** Target: **at least 85% pass** on in-data cases, every not-in-data case honest with real contact details, **zero internal-voice replies**, zero unbacked offers, latency as in §4.
- The 3a conversation eval, the onboarding eval, the Sunrise and fixture checkups, 6b's booking cases and 8a's memory cases: no new hard fails.
- Unit tests for each change; a retrieval test that fails if the expected passage for each suite case drops out of the top results.

## Done when

- [ ] `Q3A-DIAGNOSIS.md` reviewed at the stop; the chosen fixes made
- [ ] The suite at 85%+ in-data, 3 runs; no internal voice; no false offers; latency targets met
- [ ] Memory works on the live page across New chat
- [ ] `CHUNK-Q3A-NOTES.md`, `PR-Q3A.md`, the Progress row; re-index steps for production in `LAUNCH-CHECKLIST.md` <!-- docs-path-lint: planned -->
