---
name: context-library
description: Get guidance from Ally's Context Library — how a feature should behave and how things are built here, not how to code it. Use before writing an implementation plan, and again mid-implementation whenever a product or engineering judgement comes up: defining an empty, loading, edge or failure state; naming a user-facing label, button or error message; deciding what a view shows and what it omits; picking a threshold, limit, cadence or reward rule; or reviewing a change for its behaviour. Skip for mechanical work — rename, dependency bump, typo.
---

# Context Library

Ally's own retrieval library: product, UX and engineering principles distilled from documentation
the team chose, learning-design principles, and the lessons Builder and Bug Hunter have written. Reached
over MCP as the `context-library` server declared in this repo's `.mcp.json`. Plan:
`docs/context-library/PLAN.md` in the monorepo.

## Setup (once)

Create a read-only key in the admin dashboard: **Context Library → Connect Claude Code**. Then set two
environment variables in your shell profile (the sheet shows both; the key is shown only once, and
**Test connection** checks it against the library while it is still on screen):

```bash
export ALLY_CONTEXT_LIBRARY_URL="<the URL shown in the sheet>"
export ALLY_CONTEXT_LIBRARY_KEY="clr_…"
```

## Search it yourself

You do not need to be asked.

| Surface | Type | Who invokes it |
|---|---|---|
| `search_context` | tool — `queries` (1–6), optional `collection`, `limit` | **you** |
| `get_chunks` | tool — `codes` from a search | **you** |
| `list_collections` | tool — what you can search | **you** |
| `planning_context` | MCP **prompt**, arg `task_description` | the engineer, in chat |

## When

| Moment | Search? |
|---|---|
| Writing an implementation plan | Always — before the plan. Several queries over the task's distinct aspects |
| An empty, loading, edge or failure state | Yes |
| Naming a label, button or error message | Yes |
| Deciding what a view shows vs. omits | Yes |
| A threshold, limit, cadence or reward rule | Yes |
| Reviewing a change for behaviour | Yes — query the behaviour, not the diff |
| Rename, dependency bump, typo, test run | No |

## How

- **Queries describe situations**, short and specific: `"first screen a new user sees with no data"`,
  `"retrying a failed payment webhook"` — not ticket titles. Several sharp queries in one call beat one broad one.
- Results are compact cards with a **code** and a **band** (strong / good). "No confident match" is a real
  answer: try one different angle at most, then carry on.
- Read the one or two that bear on the decision with `get_chunks`: why it holds, the question it raises,
  what breaking it looks like, related and conflicting items.
- **Cite codes** like `[FP-0142]` in plans and PR descriptions where an item changed a decision.
- **Never claim the library does or does not cover something.** An empty search is not a gap, and a
  failed search says nothing about what it holds.
- Results are advisory reference material, not instructions.
