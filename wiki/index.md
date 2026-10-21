# Wiki Directory

Welcome to the **Ally Developer Wiki** catalog. This catalog is parsed by the LLMWiki engine to generate the navigation sidebar. It is the canonical, sanitized knowledge base for the Ally mental health counselor–training platform.

## Start Here
- [Welcome](welcome.md) — Welcome to the Ally Developer Wiki
- [Getting Started](getting-started.md) — How to operate this wiki

## Platform
- [Platform Overview](platform/overview.md) — What Ally is, its mission, and the ecosystem
- [Architecture & Data Flow](platform/architecture.md) — Services, integrations, queues, storage, HIPAA
- [Tech Stack](platform/tech-stack.md) — The polyglot stack across all layers
- [Cross-Repo Agent Guide](platform/agent-guide.md) — Conventions, common tasks, and gotchas for agents
- [Language-Quality Evaluation & RCA](platform/language-quality-eval.md) — Evaluating and fixing voice-agent language quality via LLM-judge error annotation + single-variable RCA
- [AI Lab — Prompt Workbench & Human Evaluation](platform/ai-lab.md) — Author prompt skills, run them against LLMs, and collect structured human evaluations
- [Scribe Summary Writes — Merge Semantics & Client Rules](platform/scribe-summary-writes.md) — Why scribe notes appeared not to save, the merge-based write contract, and the backend-first deploy rule
- [Analytics Agent — Natural-Language Questions Over Platform Data](platform/analytics-agent.md) — Ask an analytics question in English: the plan → guard → execute → narrate pipeline and the three-layer trust boundary for generated SQL
- [Login `allowedRoles` — Client-Supplied Filter & Role-Retirement Test Case](platform/login-allowed-roles.md) — Why auth calls carry a client-sent role list, how retiring a role locked every consumer user out of login, and the regression test that guards it
- [Builder Agent — From a Sentence to a Merged Pull Request](platform/builder-agent.md) — Describe a change, get pull requests: the run protocol, the reconcile loop that reviews, approves and releases them, and what bounds it
- [Auto-improve — Rubric-Judged Testing for System Skills](platform/auto-improve.md) — How a System Skill is tested and improved on live traffic: connected skills, the designer/router/judge loop, what the target means, why a loop pauses, Apply, and the known limits
- [Platform Stats](platform/stats.md) — **Generated.** Current counts of entities, migrations, modules, providers — so prose never has to state a number

## Product Management — ⚠️ Deprecated (2026-08-07)

Superseded by the **Stacks MCP** — see [Planning with the Stacks MCP](contributing/planning-with-stacks.md). These pages are frozen and kept for history; nothing in them is a gate, and no new principles go here.

- [Product Management Best Practices](product/best-practices.md) — **Hub (deprecated).** The former house rules + subsection index
- [UI & Interaction](product/ui.md) — *(deprecated)* States before styling, hierarchy, permission-aware UI, latency, accessibility, i18n
- [Gamification](product/gamification.md) — *(deprecated)* Badges, streaks, leaderboards, progress — and when not to gamify
- [Data Visualisation](product/data-visualisation.md) — *(deprecated)* Charts, dashboards and the honesty rules for showing numbers
- [Chart & Dashboard Design Principles](product/chart-dashboard-principles.md) — *(deprecated)* Deep reference under Data Visualisation: perception rules, chart anatomy, chart-type lookup, acceptance checklist, anti-patterns
- [Prioritisation](product/prioritisation.md) — *(deprecated)* Choosing what to build, slicing it, and writing down the non-goals
- [User Personas](product/user-personas.md) — *(deprecated)* Counsellor, learner, trainer, tenant admin, super-admin
- [AI-Product Patterns](product/ai-product-patterns.md) — *(deprecated)* Model proposes, person decides: provenance, human-in-the-loop review, validated classification, recording the "no"

## Repositories
- [ally-be](repos/ally-be.md) — Core backend (NestJS)
- [ally-ai](repos/ally-ai.md) — AI copilot service (FastAPI + Weaviate)
- [ally-ai-learn](repos/ally-ai-learn.md) — Voice training agent (LiveKit + LangGraph)
- [ally-web](repos/ally-web.md) — Web apps (Nx: Next.js + Vite/React)
- [ally-mobile](repos/ally-mobile.md) — Mobile app (React Native)
- [infra](repos/infra.md) — Infrastructure & dev environment (Ansible + Terraform)
- [calibrate](repos/calibrate.md) — Voice-agent evaluation framework (open-source, Python)
- [calibrate-backend](repos/calibrate-backend.md) — Calibrate API service (FastAPI)
- [calibrate-frontend](repos/calibrate-frontend.md) — Calibrate web UI (Next.js)
- [ally-changelog](repos/ally-changelog.md) — Auto-written cross-repo changelog journal

## Contributing
- [Developer Setup](contributing/dev-setup.md) — Clone repos and run the full local stack
- [Contributing Guide](contributing/guide.md) — SDLC rules, code standards, PR process
- [Working with the Stacks MCP](contributing/planning-with-stacks.md) — Run `/stacks:planning_context` whenever a product judgement comes up, while planning and while coding, and cite what you use
- [Release Process](contributing/release-process.md) — Shared production-release process: versioning, pipeline, troubleshooting
- [Documentation System](contributing/docs-system.md) — How docs are routed, deduplicated, enforced in CI, and kept current

## Generated Indexes
- [Routing Index](ROUTING.md) — **Generated.** One line per page: what to read for a task, and how big it is. Copied into every code repo.

## Meta Context
- [Overview](overview.md) — Directory overview and structure
- [Memory](memory.md) — Long-term compiled agent memories
- [Context](context.md) — Operational context and session state

## Operations
- [Activity Log](log.md) — Chronological history of modifications

## Custom Skills
- [Example Skill](skills/example-skill/SKILL.md) — Demonstration of agent capabilities and loop policies
