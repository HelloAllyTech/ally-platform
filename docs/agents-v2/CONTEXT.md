# Agents v2 — context for Claude Code

Read this first, every session. It's the background you need to work on any chunk without the conversation it came from.

## What we're building

Ally already runs **AI Chatbots** (Stage 1): configurable bots that answer from knowledge-library documents over WhatsApp. The goal is a **generic agent workspace that any business can set up**, starting with clinics and mental-health practices. It takes the best of three products:

- **Wati Astra's ease.** An owner describes their business and gets a working WhatsApp agent in about 10 minutes.
- **Hermes Agent's memory and learning.** The agent remembers each person, keeps notes, reflects every night and improves.
- **Botpress's customisation.** Templates, abilities, rules and flows the owner can shape.

What makes it different: **everything the agent knows, does and learns is visible and needs the owner's say-so.** Memory is readable as files. Every reply has a "Why?". Every risky action has Do it / Ask me first / Never. Every lesson waits for approval.

## Stages

| Stage | Status | What's in it |
|---|---|---|
| Stage 1 | **Live** | Chatbots, WhatsApp connector, channel-agnostic engine in ally-be, knowledge answers in ally-ai, admin page at `/chatbots`. See `stage1-build.md`. |
| **v2 (Stage 2)** | **Building now** | LangGraph runtime, layered context files, facts, contact profiles and files, history and "Why?", eight built-in abilities with approvals, scheduler, flows, onboarding, sandbox number, website widget, self-learning loop, owner on WhatsApp, home and insights. |
| v3 (Stage 3) | Later | Connectors, MCP, any API as a tool, skills store and skill creator, forms and WhatsApp Flows, more channels. **Don't build any of this in v2.** |

## Documents in this folder, and which one wins

| File | What it is | Use it for |
|---|---|---|
| `CONTEXT.md` | This file | Background, decisions, glossary |
| `agents-v2-spec.md` | Product and experience spec for v2 | **The source of truth for scope and user experience.** What the owner sees and how it behaves |
| `v2-chunks.md` | v2 split into 25 chunks, with rules for every chunk | Build order, and what "done" means per chunk |
| `chunk-NN.md` | The brief for the current chunk | **The current task.** Do only this |
| `three-stage-plan.md` | Earlier research and three-stage engineering plan | Engineering detail: graph nodes, state, `/agent/run` contract, gateway, data model, rollout, risks |
| `stage1-build.md` | How Stage 1 is built today | Real module names, tables, message flow, engine order |
| `CHUNK-NN-NOTES.md` | Written by you at the end of each chunk | What was built, how to test, open questions |

**When documents disagree:**

1. The current `chunk-NN.md` wins for the current task.
2. `agents-v2-spec.md` wins on scope and behaviour.
3. `three-stage-plan.md` wins on engineering detail only where the spec is silent.
4. The code wins over every document on facts about the existing system. Write down every mismatch in the notes file.

**Known differences in `three-stage-plan.md`:** its Stage 2 includes a form creator and an 8-step order. Both are superseded. **Forms are v3**, and the order is `v2-chunks.md`. Its `/agent/run` request shape is the **target** contract. Chunk 1 starts smaller (today's request plus `conversation_id`), and the contract grows toward the target in chunks 2–3.

## Architecture decisions (settled; don't revisit without asking)

- **ally-be goes first, unchanged.** Quick replies, access, kill switches, consent, STOP/START and crisis keywords run in ally-be before any AI call. The AI crisis check keeps running in parallel as a separate call.
- **Switchable runtime.** Per bot, `runtime: v1 | v2` plus `features` flags (`context_files`, `tools`, `memory`, `schedules`, `flows`, …). Rollback is a settings change, not a deploy.
- **One LangGraph graph serves every bot.** Flags switch nodes on, so parity mode is the same graph with everything new off.
- **Thread id = conversation id.** The LangGraph Postgres checkpointer stores each run's state. That state feeds "Why?", approvals (`interrupt`) and resume.
- **Graph decides, ally-be executes.** ally-ai never writes to ally-be's database, never sends messages and never holds channel or third-party credentials. Tools call the ally-be gateway (`/internal/agent/context`, `/internal/agent/tools/:name`, `/internal/agent/contacts/:id/memory`) with a service secret plus a short-lived per-run `run_token` naming the bot, contact, conversation and allowed tools.
- **Idempotency everywhere.** Each tool call is keyed by run id plus step, and each send and scheduled job has a key. A retry never books or messages twice. ally-be's existing rule holds: throw only before sending, and after a send record failures and return.
- **Deterministic where it matters.** The decline gate and citation mapping stay in code.
- **Layered context files.** These are Markdown layers merged in order: `/platform/SAFETY.md` > `/org/ORG.md` > `/agent/AGENT.md` > `/roles/<role>.md` > `/contacts/<id>/USER.md`, plus `/scratch/`. Higher layers win, and safety only tightens. The agent writes only to the contact and scratch layers. Agent edits to higher layers arrive as proposals the owner approves.
- **Facts stay in data tables, not in Markdown** (prices, hours, slots), so the same question always gets the same answer.
- **WhatsApp rules are enforced in ally-be at send time:** the 24-hour window and approved templates, quiet hours, and opt-out checked at send.
- **Prompts live in the Skills Store** (Manage Prompts). The `.txt` files only seed new environments. Never edit prompt text as part of a chunk. If a chunk needs a new prompt, add a new seed file and say so in the notes.
- **New business data lives in ally-be's Postgres** as normal migrations keyed by `chatbot_id`. Only LangGraph's checkpoint tables live on the ally-ai side, in their own schema.

## Glossary

| Term | Meaning |
|---|---|
| Owner | The business owner or admin who sets up and supervises the agent |
| Contact | A person who chats with the agent (customer, patient, staff) |
| Run | One pass of the graph for one incoming message or scheduled wake-up; has a `run_id` |
| Profile / USER.md | What the agent knows about one contact, with a source for every field |
| Notebook | The agent's own working notes about the business, visible to the owner |
| Ability | A built-in action (search knowledge, look up facts, remember, recall history, schedule, hand over, notify team, save/read files), each set to Do it, Ask me first or Never |
| Never list | Things the agent must never say or do; checked before every send |
| Lesson | A proposed improvement from the nightly reflection; the owner applies or rejects it |
| Flow | A repeatable background process (collect reviews, product updates, reminders) built from trigger, rules, steps and exit |
| Needs you | The owner's to-do list: approvals, handovers, failed sends, flow problems |
| Sandbox number | An Ally-owned WhatsApp number; join codes let anyone try a draft bot |
| Parity | v2 answers the way v1 does on the same questions before anything new is switched on |

## Always

- Work only on the current chunk. If you notice something for a later chunk, write it in the notes; don't build it.
- Read the real code before you design. Match each repo's existing conventions.
- Keep v1 behaviour and the existing tests unchanged. If an existing test fails, stop and report it.
- Don't upgrade existing dependencies without asking.
- Run tests and lint before saying anything is done. Commit after each milestone.
- End each chunk with `CHUNK-NN-NOTES.md`: code map, decisions, how to test, open questions.
