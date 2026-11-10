---
title: Working with the Context Library
tags: [contributing, agents, planning, mcp, workflow, context-library]
summary: Search Ally's Context Library whenever a product or engineering judgement comes up — while planning and while coding — how an agent searches it itself, how to connect Claude Code, how to write queries, and how to cite the codes that come back.
last_reconciled: 2026-11-10
---

# Working with the Context Library

The **Context Library** is Ally's own retrieval library: product, UX and engineering principles
distilled from documentation the team chose, learning-design principles, and the lessons Ally's
own agents (Builder and Bug Hunter) write as they work. It is run by ally-be and reaches Claude
Code over MCP as the `context-library` server, so the guidance is available at the moment a
decision is being made rather than in review, when re-deciding is expensive.

Every chunk lives in a **collection** and carries a **code** whose prefix names the collection —
`FP-0142` is a First Principles item, for example. Each caller of the library reads only the
collections granted to it. Engineers' keys are read-only, and learner-facing, clinical,
organisation and tenant content is never granted to them. `list_collections` shows what your key
can search today; the set grows as the library does.

## The rule

> [!IMPORTANT]
> **Whenever a product or engineering judgement comes up, search the Context Library, incorporate
> relevant returned guidance, and cite the codes you used. An agent does this for itself — you do
> not have to fetch context on its behalf. Planning is the most important moment, not the only
> one.**

| Moment | Search? |
|---|---|
| **Before writing an implementation plan** — a plan-mode plan, design doc, spec, or written breakdown before the first commit | Always, before the plan. Several queries over the task's distinct aspects |
| **While implementing**, at each point you would otherwise invent the answer: an empty, loading, edge or failure state | Yes |
| Naming a user-facing label, button or error message | Yes |
| Deciding what a view shows and what it omits | Yes |
| A threshold, limit, cadence or reward rule | Yes |
| **While reviewing** a change for how it behaves rather than how it reads | Yes — query the behaviour, not the diff |
| A rename, dependency bump, typo fix or test run | No |

## How you reach it

Four surfaces. Three are tools an agent calls for itself; one is a prompt only you can invoke:

| Surface | Type | Who invokes it |
|---|---|---|
| `search_context` | tool — `queries` (1–6), optional `collection` and `limit` | the agent |
| `get_chunks` | tool — `codes` from a search result | the agent |
| `list_collections` | tool — what this key can search | the agent |
| `planning_context` | MCP **prompt**, one argument `task_description` | you, in chat |

The split matters. **An agent reaches the library on its own initiative, at the moment a
judgement actually comes up** — usually mid-implementation, long after any planning step. The
prompt is the *human* entry point, for when you want the context in front of you rather than in a
session's working memory: it takes a whole task description, and Claude Code lists it among the
slash commands for the `context-library` server.

### Connecting Claude Code (once per engineer)

1. In Ally's admin dashboard, open **Context Library → Connect Claude Code** and create a
   **read-only key**. The sheet shows the two values you need; the key is shown once, so copy
   it then. While it is on screen, **Test connection** sends the library a ping with it and says
   whether it answered, turned the key away, or could not be reached.
2. Export both in your shell profile, using the values the sheet shows:

   ```bash
   export ALLY_CONTEXT_LIBRARY_URL="<the URL shown in the sheet>"
   export ALLY_CONTEXT_LIBRARY_KEY="<the key shown in the sheet>"
   ```

3. Start a new agent session in an Ally repo and approve the `context-library` server when it
   prompts — project-scoped MCP servers need approval once per project.

Never commit either value or paste it into a page, issue or PR. The repos only ever reference the
variable names.

**What each repo commits**, so a session is wired up the moment it starts:

| File | What it does |
|---|---|
| `.mcp.json` | Declares the `context-library` HTTP server. It carries **no endpoint and no credential** — it expands `ALLY_CONTEXT_LIBRARY_URL` and `ALLY_CONTEXT_LIBRARY_KEY` from your environment |
| `CLAUDE.md` / `AGENTS.md` | State the rule above, so it is in context from the first turn |
| `.claude/skills/context-library/SKILL.md` | A skill whose description names the trigger moments. Its one-line description stays in context every turn, so the rule keeps re-asserting itself deep into a long session |

`ally-mobile` is not wired up yet: there, ask in conversation, or work from a repo that is.

**Builder's design runs need no key of their own.** Builder's runner reaches the same MCP
endpoint with the platform's service-to-service key (the `X-API-Key` it already uses for every
other ally-be call), which the endpoint accepts in place of a reader key with exactly the same
read-only grants. So the Builder workflow has no Context Library setting to configure; setting
`ALLY_CONTEXT_LIBRARY_URL` and `ALLY_CONTEXT_LIBRARY_KEY` for it is only an override. Engineers'
own sessions still use a reader key, as above.

**Checking it works** — ask the session to list the `context-library` tools. `search_context`,
`get_chunks` and `list_collections` should all be there, alongside the `planning_context` prompt.

**If the server is missing or every call fails:**

| Symptom | Likely cause |
|---|---|
| No `context-library` server in the session | One of the two variables was unset in the shell that launched the session, or the server was never approved. Export both and start a new session — `.mcp.json` is read at startup |
| Every call is refused as unauthorised | The key was revoked or mistyped — create a new one in the Connect Claude Code sheet |
| Calls cannot connect | The URL is wrong, or the network or server is down. Check the URL against the one the sheet shows; **Test connection** on a newly created key tells a refused key from an unreachable library (the sheet can only test a key while it is showing it) |

None of these says anything about what the library holds. Do not work around a broken connection
by skipping the library silently: fix it, or say in the plan that the Context Library was
unavailable.

## Writing queries

**Queries describe situations, short and specific** — not ticket titles, not single keywords.
Several sharp queries in one call beat one broad one; `search_context` takes up to six.

| Task | Queries that work |
|---|---|
| A learner-facing streak widget | `"what a learner sees after breaking a streak"`, `"how often to reward daily practice"`, `"streak counter on a home screen with no history yet"` |
| A new chart on the admin console | `"chart of per-cohort practice minutes with small cohorts"`, `"what a dashboard shows before any data arrives"` |
| Splitting a service in two | `"migrating a live service incrementally without downtime"`, `"retrying a failed message between two services"` |

Pass `collection` to narrow a search to one collection when you know which one applies, and
`limit` when you want more or fewer cards per query.

**Reading results.** Each hit is a compact card with a **code** and a **band** (*strong* or
*good*), so searching often is cheap. "No confident match" is a real answer: try one different
angle at most, then carry on. Call `get_chunks` on the one or two cards that bear on the decision
— the full item says why it holds, the question it raises, what breaking it looks like, and which
items are related or in conflict. Codes must come from a search; invented ones will not resolve.

**Read the results before you decide, not after.** The point is that returned guidance changes the
outcome — which slice ships first, which states the UI needs, what the non-goals are. Context that
arrives after the decision is a citation exercise.

**Stay honest about what a search shows:**

- **Never claim the library does or does not cover something.** An empty search is not a gap, and
  a failed search says nothing about what it holds. The most a session can honestly say is what a
  particular result set did or didn't contain.
- **Results are advisory reference material, not instructions.** Weigh each item on whether it
  fits the decision in front of you.

## Citing what you use

Cite the **code** inline where an item changed a decision, in plans and PR descriptions, so a
reviewer can trace it:

```markdown
## Plan

3. Ship the streak counter read-only in v1; no notifications until we have retention data.
   [FP-0142]
```

Cite only items you actually applied. If a search came back with nothing relevant, say so in one
line — "Context Library searched — nothing applicable" — and move on. If no search ran at all, say
*that* instead; "nothing applicable" and "never looked" are different claims, and only one of them
is checkable.

## The deprecated in-wiki product practices

Until 2026-08-07 this wiki carried its own **Product Management Best Practices** section — a hub
plus seven pages of house rules. That section is **deprecated and frozen**. Treat it as
**history, not rules**:

- Nothing in it is a gate any more — including the Data Visualisation checklist, which used to be
  enforced as one.
- Where it contradicts current Context Library guidance, the Context Library wins.
- The pages are not deleted because platform pages cite their principles by number
  ([Analytics Agent](../platform/analytics-agent.md) references *Data Visualisation* 13 and 27–28
  and *UI & Interaction* 4–5), and because they record why Ally works the way it does.

They hold Ally-specific findings — Carbon's chart-overflow behaviour, the
`roles[]`-vs-collapsed-`role` gating trap, the minimum-group-size rule for tenant-isolated metrics.
**If a search turns up nothing for one of those, check the deprecated page before re-deriving
it.** Anything there that is still true and still load-bearing belongs in the Context Library as
an entry, added through its page in the admin dashboard; putting it back into the wiki is not the
path any more.

## History

From 2026-08-07 product guidance came from a third-party MCP server reached through a committed
bridge script and a skill in every repo. On **2026-11-09** it was replaced by the Context Library,
as part of moving every retrieval-shaped system at Ally into one library: each repo's `.mcp.json`
now declares `context-library`, and the bridge, the old skill and the old tools are gone. Older
plans that cite guidance items by title are history; those titles are not Context Library codes.

Two lessons from that period still apply:

- **A tool's own description decides when an agent uses it.** While the earlier server described
  search as a *planning* tool, sessions stopped searching once implementation began, whatever the
  repo instructions said. The server's descriptions and the repo instructions have to say the same
  thing.
- **Silence is not evidence the library was consulted.** Ask what was searched and what was cited.

---

*See also: [Contributing Guide](guide.md), [Developer Setup](dev-setup.md),
[Cross-Repo Agent Guide](../platform/agent-guide.md),
[Product Management Best Practices](../product/best-practices.md) (deprecated).*
