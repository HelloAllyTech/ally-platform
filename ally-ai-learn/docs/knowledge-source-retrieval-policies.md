# Design: Retrieval Policies for Knowledge Sources

**Status:** Proposal
**Scope:** `ally-ai-learn` (context assembly / prompt building)
**Author:** (draft)
**Reconciled with:** [`client-working-memory-design.md`](client-working-memory-design.md)
§9.2 — that document retires `state.retrieved_context`; this one proposed restructuring
it. §5 step 5 and §9 below carry the agreed resolution, which is that neither happens:
the composer returns buckets as a return value and the state field goes away.

## 1. Problem

Creators are force-feeding **language-specific instructions** into shared
simulation fields (`role_instructions`, per-state examples) to make a
non-English language behave well. Because those fields are shared across
languages, adding metadata for one language **breaks the others**.

The natural home for this content *feels* like knowledge sources — "the
model retrieves how to speak Tamil the same way a person recalls a
language." That instinct is correct, but the current knowledge-source
mechanism cannot serve it, because it has exactly **one** retrieval
policy: an LLM that matches source *titles* against *what is currently
being discussed*. Language is not topically relevant to the dialogue —
it is a **session attribute** that must apply on every turn. So language
guidance either never gets retrieved, or fires non-deterministically.

The root cause is **under-abstraction**: a "knowledge source" is welded
to a single retrieval trigger. Different kinds of knowledge need
different triggers.

## 2. Goals / Non-goals

**Goals**
- Let a knowledge source declare *how/when* it is retrieved.
- Make language guidance an ordinary knowledge source (one per language),
  retrieved deterministically by the session's language — no bleed across
  languages, no force-feeding into shared fields.
- Subsume the current topical-RAG behavior as *one* policy among several
  (zero behavior change for existing sources).
- Keep deterministic content off the LLM selector (no added latency /
  non-determinism for always-on content).

**Non-goals**
- Replacing the LLM selector with embeddings (worthwhile later for scale;
  see §7 — orthogonal to this change).
- Cross-session episodic memory (`previous_memory`) — separate concern.

## 3. Current architecture (as-is)

Data:
- `knowledge_sources: List[{title, content}]` on `PromptData`
  — `app/core/scenario/base.py:171`.

Retrieval (runs every turn, in a streaming-isolated subgraph):
- `retrieve_knowledge` node — `app/core/graph/nodes.py:1630`
  - reads `scenario.prompt_data.knowledge_sources`
  - builds a `title → content` map (`build_knowledge_map`)
  - **per-state gate**: if the active state has `ragEnabled=false`, skips
    (`nodes.py:1696`)
  - calls `retrieve_relevant_knowledge` with an 8s timeout
- `retrieve_relevant_knowledge` — `app/core/graph/knowledge_retrieval.py:166`
  - **the only policy**: a structured-output LLM call whose system prompt
    (`knowledge_retrieval.py:200`) says *"identify which knowledge topics
    are relevant to what is being discussed"*, given the last 10 messages
    + the list of titles
  - formats matched content with caps: 1500 chars/match, 8000 total
    (`knowledge_retrieval.py:26`), arbitrary first-come truncation
  - result written to `state.retrieved_context` (reducer `state.py:214`)

Consumption:
- `generate_response` reads `state.retrieved_context` + `language_code`
  (`nodes.py:1214`) → `generate_system_message` → `_build_behavior_prompt`
  / `_build_branching_prompt` (`prompt.py:347`, `:246`)
- lands in the `## Additional Context` → `{retrieved_context}` slot of
  `app/prompts/system/main_agent_prompt.txt:34`.

Language today is a **separate, parallel** pipeline (the thing we want to
fold in): `language_config.language_code` (`base.py:331`),
`languageCharacteristics`, `languageDialogueSamples` →
`_resolve_effective_language_label` / `_format_language_samples`
(`prompt.py:97`, `:70`), rendered near the top of the same template
(`main_agent_prompt.txt:13-31`).

So there are **three** ways language/knowledge content reaches the prompt
today — topical RAG, the special-cased language fields, and manual
force-feeding into `role_instructions`. This design collapses them into
one.

## 4. Proposed abstraction: retrieval policy per source

A knowledge source gains an optional `retrieval` descriptor. Absent it,
behavior is identical to today (`semantic`).

```jsonc
KnowledgeSource {
  "title": "How to speak in Tamil",
  "content": "...register, code-switching, honorifics, sample phrasing...",
  "retrieval": {
    "policy": "attribute",          // "always" | "attribute" | "semantic" | "state"
    "when":   { "language": "ta-IN" },
    "priority": 100                  // higher = pinned first under budget
  }
}
```

Policies:

| policy      | trigger                                                        | LLM call? | use case                                  |
|-------------|---------------------------------------------------------------|-----------|-------------------------------------------|
| `always`    | every turn                                                     | no        | global persona/style, safety rails        |
| `attribute` | a session attribute matches `when` (e.g. `language==ta-IN`)    | no        | **language guidance**, region, modality   |
| `state`     | active state / score band matches `when.stateScore`           | no        | state-specific guidance (folds `ragEnabled`)|
| `semantic`  | LLM (or later, embeddings) judges topical relevance           | yes       | genuine domain knowledge (current behavior)|

`when` for `attribute` is a small equality map evaluated against a
**session-attribute bag** (see §5). v1 supports `language`; the shape
allows `region`, `modality`, etc. later without schema churn.

Why this is the right cut: it separates the **store** (a named unit of
content) from the **retrieval condition** (when it enters the prompt).
"Multiple instruction sets" = multiple conditions over one store.

## 5. Composer node (resolution order)

Rename/extend `retrieve_knowledge` into a **context composer**. It already
has everything it needs from `config["configurable"]`: `scenario`
(hence `scenario.language_config.language_code`, `prompt_data`,
`states`), `score_keeper`, and `llm_client`.

Per turn:

1. **Partition** `knowledge_sources` by `policy` (default `semantic`).
2. **Build the session-attribute bag** — v1: `{ "language":
   scenario.language_config.language_code }`.
3. **Resolve deterministic policies (no LLM):**
   - `always` → include.
   - `attribute` → include iff every key in `when` equals the bag value.
     (Language card selected here — deterministic, always-on, cold-start
     safe.)
   - `state` → resolve active state via the existing helpers
     (`_resolve_state_for_retrieval`, `nodes.py`); include if `when`
     matches. This subsumes today's `ragEnabled` gate — a state that
     wants no domain RAG simply has no `state`/`semantic` sources active,
     while its language `attribute` card still fires.
4. **Resolve `semantic` policy (LLM):** exactly today's
   `retrieve_relevant_knowledge`, but scoped to `semantic` sources only.
   Keeps the 8s timeout and cache. If none are `semantic`, skip the LLM
   call entirely (removes a per-turn LLM call from language-only
   scenarios — a latency win).
5. **Merge + budget** (§6) → **return** the resolved buckets. Not a write to
   `state.retrieved_context`: `always` and `attribute` are session-invariant and are
   resolved once at session start into the static prefix, `state` renders with
   `{state_x_guidelines}`, and only the `semantic` bucket is per-turn — it goes to the
   worker-owned store the working-memory design uses. The state field is retired rather
   than restructured (that doc's §9.2).

Determinism is preserved where it matters: language/persona/state never
depend on the LLM selector.

## 6. Budget & priority

Replace first-come truncation (`knowledge_retrieval.py:87`) with
**priority ordering**:

- Sort merged sections by `priority` desc (attribute/always default to a
  high priority; semantic defaults low).
- Fill up to `_MAX_TOTAL_CONTEXT_CHARS`; **pinned** (high-priority)
  sections are never dropped — if pinned content alone exceeds budget,
  raise the cap for pinned or log a hard warning rather than silently
  trimming language rules.
- Keep the per-match cap for `semantic`; consider exempting `attribute`
  language cards (they're authored, bounded, and must not be clipped
  mid-rule).
- Keep the existing `[RAG_TRUNC]` observability; add which policy a
  dropped section came from.

## 7. Placement in the prompt

Two options:
- **Minimal:** everything still flows through `{retrieved_context}` /
  `## Additional Context`. Simplest; but language guidance sits under a
  "supplementary context" heading (weaker adherence).
- **Preferred:** the composer returns *sectioned* output and the template
  gets policy-aware slots — language/`attribute` content renders in the
  existing authoritative language block (`main_agent_prompt.txt:13-18`),
  `always`/persona high, `semantic` under `## Additional Context`. This is
  where the special-cased `languageCharacteristics`/`languageDialogueSamples`
  plumbing gets **retired**: those become `attribute` sources feeding the
  same slot.

Recommend shipping Minimal first (behavior-safe), then moving to
Preferred as part of retiring the language fields.

**Reconciliation note.** Preferred is smaller than it looks here. Once `always` and
`attribute` are resolved once per session into the static prefix, only the `semantic`
bucket is volatile, so the sectioning required is one slot rather than four. And the
placement mechanism already exists: register the slot in the prompt's
`availableVariables` and render it at a placeholder, falling back to a cache-friendly
append — the contract `_ensure_language_glossary` and `_append_retrieved_context` already
implement, described in the working-memory design's §2.3. Both proposals should use it
rather than inventing separate plumbing. Note also that this document's line references
point at `main_agent_prompt.txt`, while production runs `main_agent_prompt_full` v6 as a
dashboard override — the file map needs re-pointing before implementation.

## 8. Backward compatibility & migration

- **Existing sources:** no `retrieval` field → treated as `semantic`.
  Byte-for-byte identical behavior. Safe to deploy before any authoring
  changes.
- **`ragEnabled` (per-state):** keep honoring it for `semantic` sources
  during transition; new `state` policy is the forward path.
- **Language fields:** migration is additive —
  1. Ship policies (semantic-only default). No visible change.
  2. Studio: let authors create `attribute`/`language` knowledge sources.
  3. Backfill: convert each scenario's
     `languageCharacteristics`/`languageDialogueSamples` into `attribute`
     sources keyed to its `language_code`.
  4. Once parity is verified, deprecate the special-cased language fields
     and the force-feeding pattern.

## 9. File-by-file change map

| File | Change |
|------|--------|
| `app/core/scenario/base.py:171` | Extend `knowledge_sources` item schema with optional `retrieval {policy, when, priority}`; load from `knowledgeSources` (`:660`). |
| `app/core/graph/knowledge_retrieval.py` | Split into: deterministic resolvers (`always`/`attribute`/`state`) + existing `semantic` selector scoped to semantic sources; priority-based `_format_retrieved_context`. |
| `app/core/graph/nodes.py:1630` | `retrieve_knowledge` → composer: partition sources, build attribute bag from `scenario.language_config.language_code`, run resolvers, merge. Reuse `_resolve_state_for_retrieval` for `state` policy. |
| `app/core/graph/prompt.py:347/246` | (Preferred option) accept sectioned context; route policy buckets to slots; begin retiring `languageCharacteristics`/`languageDialogueSamples` handling. |
| `app/prompts/system/main_agent_prompt.txt` | (Preferred) policy-aware slots; language `attribute` content into the language block. |
| `app/core/graph/state.py` | `retrieved_context` and `turns_until_knowledge_refresh` are **removed**, not restructured. Session-invariant buckets never enter state; the `semantic` bucket lives in the worker-owned store. Safe because the checkpointer is in-process and per-session. |

## 10. Risks / open questions

- **Attribute matching semantics:** exact locale match vs. language-family
  fallback (`ta-IN` vs `ta`)? Reuse `normalize_language_code_for_providers`
  (`base.py:13`) so composer and provider agree on the key.
- **Author confusion:** four policies is more surface. Mitigate in studio
  with sensible defaults (new source = `semantic`; a "language" source
  type preset that sets `attribute`+`when.language`+high priority).
- **Budget starvation:** many high-priority `attribute`/`always` sources
  could crowd out `semantic`. Priority tiers + logging, not silent drops.
- **State-policy vs `ragEnabled` overlap** during transition — keep both,
  document precedence (gate wins → skip semantic; attribute still fires).
- **Ranking within the `semantic` bucket** is deliberately out of scope here. This
  document decides *eligibility*; what a client currently has in mind among the eligible
  set is the salience function in the working-memory design (§7.4). Policy gates, salience
  ranks — the two compose and neither subsumes the other.
- **Scale:** `semantic` still ships all semantic titles to an LLM each
  turn. Fine for tens of sources; swap to embedding retrieval when the
  library grows. Isolated to the `semantic` resolver by this design.

## 11. Phasing

1. **P1 (behavior-safe):** schema + composer with `semantic` default +
   `attribute(language)` + priority budgeting. Ship; author language
   cards; validate against current language fields on a few scenarios.
2. **P2:** policy-aware prompt slots (Preferred placement); backfill +
   deprecate `languageCharacteristics`/`languageDialogueSamples`.
3. **P3:** `state` policy replaces `ragEnabled`; optional embeddings for
   `semantic`.
