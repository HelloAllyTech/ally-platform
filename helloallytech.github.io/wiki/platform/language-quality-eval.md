---
title: Language-Quality Evaluation & RCA
tags: [platform, evaluation, language-quality, voice, llm-judge, rca]
summary: How we evaluate and fix the language quality of voice roleplay agents — categorized error annotation by LLM judge, two objective speech metrics, and single-variable root-cause analysis.
last_reconciled: 2026-10-21
---

# Language-Quality Evaluation & RCA

This page describes the framework we use to evaluate and *fix* the **language quality** of Ally's voice roleplay agents (the AI plays a distressed client; the human trainee is the counselor). It covers what industry practice recommends, the layered framework, the measurement toolkit, and the controlled-experiment methodology for root-cause analysis.

The detailed engineering specs live with the code — see [ally-ai](../repos/ally-ai.md) (the offline eval/judge service; the typology and weights are defined in `ally-ai/app/core/language_quality/schemas.py`) and [ally-be](../repos/ally-be.md) (orchestration, storage, dashboards; see `ally-be/docs/weak-metrics-backfill.md` and `ally-be/docs/weak-metrics-queries.md`). This page is the conceptual overview.

---

## 1. The problem: our current signals can't drive fixes

- **Per-session observations are anecdotes** — they can't distinguish a systemic problem from a one-off, and carry no denominator.
- **Scalar scores (1–5 / 0–100) and raw issue counts** blend comprehension, generation, and speech into one number that can't localize a cause. Industry experience calls this the **metric mirage**: healthy-looking dashboards coexisting with a failing product.

The standard alternative (from machine-translation and dialogue-evaluation practice) is **categorized error annotation** — every issue gets a *dimension, error category, and severity*, reported as a **weighted error rate per 100 turns** (severity weights minor = 1, major = 5, critical = 10). Structured, denominated, and comparable across runs. This is the MQM error-typology idea, executed entirely by an **LLM judge over session transcripts — no human text annotation, no hand-labeled calibration sets.**

## 2. The framework: four layers, gated bottom-up

Language capability decomposes into layers that map onto pipeline components — which is what makes failures *attributable*:

| Layer | Question | Dimensions | Measured by | Implicates |
|---|---|---|---|---|
| **Comprehension** | Did it understand the trainee? | understanding | LLM judge (conditioned on STT — §5) | LLM |
| **Content** | Is what it said correct, well-formed, consistent? | adequacy, fluency, coherence | LLM judge + **script fidelity** (objective) | LLM + prompt |
| **Appropriateness** | Is *how* it said it right? | register, dialect-lexicon, colloquialness, persona/social, code-switching | LLM judge | **Mostly prompt/persona design**; LLM as fallback |
| **Speech realization** | Does it *sound* right? | intelligibility, naturalness, prosody, affect, accent | **Round-trip WER** (objective) + manual listening | TTS provider / voice |

**Gate rule:** intelligibility (round-trip WER) gates the layers above it in audio — you can't judge the naturalness of unintelligible speech. A failed gate means those judgments are *unmeasured*, not "fine". The dashboard applies it by greying out the speech-realization rung when round-trip WER is past the critical threshold or was never measured; the text layers are judged from transcripts and are never masked.

**Priority tiers** (for the distressed-persona training use case): Tier 1 = intelligibility; Tier 2 = adequacy + register + dialect-lexicon + colloquialness (these break the training purpose); Tier 3 = naturalness / prosody / affect / accent; Tier 4 = fluency / coherence floor checks. The tiers are a prioritisation guide, not something the dashboard encodes — it is organised by layer and dimension.

## 3. The measurement toolkit

**Objective, automatable (these carry their own attribution):**

- **Round-trip WER**: `WER(T, ASR(TTS(T)))` where `T` is the LLM's own output text — re-synthesize it, transcribe it back with a strong ASR, and compare. Isolates TTS pronunciation; no human transcript needed. The re-synthesis uses a reference voice, not the session's own: ally-ai honours the session's TTS provider only when it is Sarvam or OpenAI, and otherwise picks a default (Sarvam for the Indic languages it covers, OpenAI elsewhere), always with that provider's default voice and the same provider's ASR. So the metric ranks TTS models, not configured voices, and the by-voice chart only labels each row with the voice its session used. Per session it samples the five longest AI turns and averages them; a turn that fails is skipped, and a session with nothing measurable reads as *not measured*, never 0. It is filled in by a separate top-up pass rather than inline with judging, because a vendor timeout used to hold a judge worker for minutes. Thresholds: ≤ 20 % good / 20–30 % warn / > 30 % critical. A language's eval config can switch the unit to **CER** for scripts with unreliable word segmentation; every seeded language is on WER today. There is no per-language ASR declaration — declaring a reliable ASR per language was planned and is not built.
- **Script fidelity**: percentage of AI turns rendered cleanly in the target script — no replacement or control characters, and nearly all letters in the target script or Latin. Latin is always tolerated, so this catches encoding / glyph failures, not an off-language reply. Pure code, no LLM.

**LLM-as-judge (all text layers):** one call per session over the whole transcript → per-turn error annotations against a **frozen typology** (currently v2):

| Dimension | Error categories |
|---|---|
| understanding | misinterpreted_intent, ignored_context |
| adequacy | off_topic, hallucination, omission |
| fluency | grammar, script_error, disfluency, truncation |
| coherence | contradiction, non_sequitur |
| register | too_formal_diglossia, too_casual |
| dialect_lexicon | wrong_regional_variety, nonexistent_word, wrong_sense |
| colloquialness | literal_translation_stilt |
| persona_social | too_blunt, persona_break |
| codeswitch | foreign_token_leak, unnatural_switch |

v2 widened `dialect_lexicon`: it had covered regional variety only, so the lexical complaints partners actually report — a word that does not exist, a real word with the wrong sense — had nowhere to land. Judgments from the earlier typology are kept but never averaged with v2.

Each annotation carries a severity, a short evidence quote, a one-sentence reason, and an **isolation basis** — `input_clean`, `input_garbled`, `persona_specified`, `persona_unspecified` or `pattern_systemic`. `persona_specified` vs `persona_unspecified` encodes *"did the prompt even ask for it?"* directly into every error (see §6). Judge reliability comes from **pinning** (judge model + rubric version stamped on every row; comparisons valid only within one version — the stamp is a version constant in ally-ai, so editing the rubric text in prompt management alone does not move it), temperature-0 structured output with no model fallback, reading **deltas** rather than absolute levels, and spot-checks via the error-log drill-down.

Critical rubric **carve-outs** (learned from earlier conversation-drift work — these prevent false positives): in-character distress ≠ incoherence; natural code-switching with the configured partner language is *correct*; configured fillers ≠ disfluency; intentional withholding of secrets (disclosure design) ≠ omission; counselor-led topic changes ≠ off-topic; matching a casual counselor's register ≠ too casual unless it breaks persona.

**Conditioning:** some real errors are not the actor's fault, so they are kept, flagged, and left out of the rates — understanding and adequacy errors after garbled counselor input (STT), and `truncation` on a turn the learner talked over.

**How judging runs:** it is background work, not on-demand. A scheduled catch-up judges recently ended sessions, a backlog drainer works through older ones in bounded chunks, and a backfill can re-judge history; preview and seed rooms are excluded.

**Audio beyond intelligibility:** no formal listening-test tooling for now. Human listening happens via the session-logs audio player; the dashboard marks naturalness / prosody / affect / accent as "manual listening only."

## 4. This is not a greenfield build

The framework generalizes an existing **conversation-drift evaluation system** rather than rebuilding from scratch — that system already provides roughly 60 % of the architecture:

- **A working LLM-judge seam**: a stateless judge in the AI service (structured output, rubric resolved through prompt management with an inline default) → orchestration and persistence in the backend → a Carbon dashboard tab in the web admin. The language judge is a sibling of this, on the same seam, as are the filler-quality, feedback-groundedness, RAG-quality and recall-quality judges.
- **Experiment-config capture on every session**: prompt versions + scenario version on the session; LLM provider / model on per-turn metrics (generation parameters ride in their metadata). "Did config X reduce errors vs config Y?" is already answerable by a grouped query.
- **Versioning**: scenario configs are fully versioned (diffable against their parent — this is how we auto-derive *which element changed* between experiments, at the level of top-level config keys); prompt templates are versioned per code.
- **Session-logs dashboard**: per-session drill-down with transcript, audio playback, models used, latency, and cost — and the home of the per-turn error badges.
- **Session audio in object storage** (one mixed room recording per session) plus batch STT with multi-provider fallback in the AI service — they serve transcripts and playback; round-trip WER uses neither, making its own fresh TTS and ASR calls.
- **Test harnesses**: a voice-to-voice tester exists, but as a manually started AI-vs-AI session that is off by default; nothing yet ties it to an experiment. Its sessions are not excluded from the Language tab.

**What's genuinely new:** the language-quality error typology + judge, the two objective metrics, per-language eval config, pinned-reference / delta readouts with changed-element derivation, the Language dashboard tab, and per-turn annotations in session logs.

## 5. Corrections established against the codebase

So the framework doesn't fight reality:

1. **The persona prompt and the role instructions are one field** — the scenario's persona prompt is delivered to the agent verbatim as role instructions, and it is also the judge's persona input. They cannot be varied independently. Character backstory used to be part of that field; it is now separate (the character profile) and the judge does not see it, so hallucination is judged against the role instruction alone.
2. **"Prompt metadata" spans two surfaces** — scenario config (persona, per-language style fields) and prompt templates (the system-prompt skeletons). Both are versioned and captured per session; attribution should name `surface:element`, though the dashboard today prints raw config keys, and a prompt-template edit does not appear in the changed-from-parent diff.
3. **STT conditioning** — the judge flags garbled counselor input per turn, and those turns are excluded from the understanding / adequacy denominators, so STT failures aren't mis-billed to the LLM. (STT attribution itself stays with the conversation-drift system.)
4. **Per-turn TTS audio isn't stored** (one mixed room recording) — round-trip WER re-synthesizes from the LLM's own text, with a reference voice rather than the session's (§3). It measures the TTS model's pronunciation of that text, which is what the metric's definition specifies anyway.
5. **A versioning gap for per-language opening statements** was found and fixed so changes there become attributable.
6. **Existing 0–100 report metrics stay** as trainee-facing product features and never appear on the Language tab or the session-log panel. The one composite is the Roleplay Quality Index on Highlights, which folds the language error rate in with drift, latency and the actor-goal score and is versioned so a step in the line can be told from a step in the product.

## 6. The fixing methodology: RCA by controlled experiment

1. **One variable at a time.** A "prompt" is a bundle of independently versionable elements; "we rewrote the prompt" is not one variable. The per-language levers are concrete scenario fields: **language characteristics** (a free-text style directive per language), **linguistic style samples** (few-shot exemplars per language), **allowed filler words**, and **per-language opening statements** — plus the persona prompt, the main-prompt template, and the model / voice axes. For non-English sessions there is also the **language glossary** and a register line derived from the language's target variety, both injected by default (a tenant's variety profile can override them).
2. **Prompt-before-model.** For register / dialect / colloquialness failures the decision rule is: *is the colloquial directive configured for this language? are style exemplars present?* If either is missing → populate it (a cheap metadata fix, one variable). If both are present and the error persists → a model-capability limit → escalate to the LLM axis. The judge's `persona_specified` / `persona_unspecified` label pre-sorts every error onto one side of this rule, and the dashboard shows the split; the rule is applied by reading it, and nothing escalates automatically. The two flags look only at the scenario's own fields, so a glossary or register line the agent still received is not counted as "specified".
3. **Read deltas vs a pinned reference**, with the judge version held constant. Slice per language — and by scenario version, prompt version or model — rather than reading a pooled rate; the all-languages view's single rate is an overview, and there is no dialect or variety slice yet.
4. **Isolation check**: a one-variable change should move only its layer; cross-layer movement is a leak to investigate. The tab shows weekly per-layer trends and warns when more than one element changed since the parent version; judging a leak is still a visual reading.
5. **Failures → test cases** → re-run through the voice-to-voice harness before deployment. This is a manual step today: no code path turns an annotation into a test case.

## 7. Applying it per language (worked example: Kannada)

The framework is per-language by design. Kannada illustrates why the appropriateness layer matters:

- **Diglossia applies** — literary vs spoken Kannada differ sharply; "textbook-ish" output is the *expected default failure* of an LLM prompted without an explicit spoken-register directive and exemplars. The first experiment is to check what the actor was told: are the Kannada language-characteristics + colloquial style samples configured on the scenario, and what do the register line and glossary say? If the scenario fields are empty → populate them (one variable) and re-measure the `register` error rate.
- **Regional variety must be chosen explicitly** — it affects lexicon (text, judge-checkable) and accent (audio, TTS-voice-dependent); different failure modes, different fixes. The language's eval config names a target variety; Kannada's names "colloquial spoken Kannada", with no region.
- **Kannada–English code-mixing** is normal spoken behavior; the judge treats natural mixing as correct and flags only leakage or unnatural switches.
- **Round-trip WER feasibility** depends on how well the reference ASR reads Kannada. Sarvam's covers it, but no ASR is declared per language: Kannada's eval config stores a "low" judge-reliability tier, and nothing reads it yet.

## 8. What success looks like

- A failure narrows to a layer / component + error category well enough to design a **single-variable experiment** — and the experiment confirms it.
- One-variable changes move only their layer; leaks get surfaced.
- Tier-1 / Tier-2 weighted error rates fall across successive experiments, per language and variety.
- The team reads improvement / regression / staleness off the dashboard without re-reading transcripts.

Today the dashboard shows improvement and regression as deltas against the pinned reference; it does not yet cut rates by tier or by variety, and staleness shows only as a flat delta.
