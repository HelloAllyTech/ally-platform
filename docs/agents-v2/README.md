# Agents v2 docs

**Where we are:** Stage 1, the POC, is built on `feat/agents-v2-chunk-12-shared-store`. CL1 (cleanup before launch) is the last chunk; then the launch checklist. Progress and order: `v2-chunks.md`.

**Start here:** `CONTEXT.md` → `v2-chunks.md` → the current chunk's brief (named in the root `CLAUDE.md`).

## The docs

| File | What it's for | Read it when |
|---|---|---|
| `CONTEXT.md` | Background, settled architecture decisions, glossary, which doc wins | Every session, first |
| `v2-chunks.md` | Every chunk, the stages, progress, release gates. The one source for order and status | Planning or picking up a chunk |
| `chunk-<id>.md` | The current chunk's brief (CL1: `chunk-cl1.md`; not yet built: `chunk-20e.md`) | Working on that chunk |
| `CHUNK-<id>-NOTES.md` | What each chunk built, its decisions, how to test it, what's left | Touching code a chunk built |
| `CHUNK-<id>-EVAL.md` | Eval reports (conversation evals, checkup rounds) | Comparing behaviour before and after a change |
| `LAUNCH-CHECKLIST.md` | Everything outside the code before Stage 1 goes live | Deploying |
| `agents-v2-spec.md` | Product and experience spec: what owners see and how it behaves | A question about scope or behaviour |
| `BUILDING-BLOCKS.md` | The seven blocks every bot is made of, and the template format | Designing anything from Stage 2 on |
| `TEMPLATE-DATA-MODEL.md` | Templates, lists and records: the data model | Stage 4–5 work |
| `SLICE-1.md` | The experience bar for website → tested assistant → link | Onboarding work |
| `DESIGN.md` | Visual design: tokens, components, screens | Any screen |
| `ONBOARDING-COPY.md` | The copy deck: every owner- and visitor-facing line, by section | Adding or changing words on a screen (tests hold the code to it) |
| `stage1-build.md` | How AI Chatbots (v1) works: modules, tables, message flow | Touching the v1 engine or WhatsApp |
| `three-stage-plan.md` | Earlier research and engineering plan, superseded in parts (see its note) | Engineering detail the spec doesn't cover |

## Folders

- `archive/`: finished chunk briefs and one-off reviews. Their notes stay at the top level.
- `evals/`: checkup suites (`sunrise-mind-checkups.yaml`, `purpose-checkups.yaml`), run with `ally-ai/scripts/checkup_eval.py`.
- `design/`: screenshots the briefs and notes refer to (`design/20d2/` holds 20d-2's before and after).
