# Prompts System

**Purpose.** This document describes the prompt template system: how templates are loaded and resolved, the path-based prompt codes, and the contracts. **To add a prompt, follow [Adding a prompt](../../ally-be/docs/adding-a-prompt.md#ally-ai-learn)** — the one recipe for all three services.

---

## Overview

The prompts system provides:

1. **Local templates** -- `.txt` files in `app/prompts/` loaded by `PromptManager`
2. **The Skills Store** -- `promptData.prompts` in the session metadata carries every prompt's live version from ally-be (with `version` and `contentHash`), and wins whenever present. The local `.txt` is a fallback, logged as `[PROMPT_SOURCE] … using fallback`.
3. **Template resolution** -- `load_template()`, `load_and_format()` in `app/prompts/resolver.py` centralize resolve + fallback + format
4. **Sync to ally-be** -- `scripts/sync_prompts.py` syncs prompts to ally-be on deployment (runs from `start.sh`)

---

## Prompt Lifecycle

```
app/prompts/<subdir>/<name>.txt  →  load_template() / load_and_format()
                                         ↓
                            resolve_template() chooses: local vs metadata
                                         ↓
                            (optional) template.format(**kwargs)
                                         ↓
                            Final prompt string used by graph/report
```

---

## API: load_template vs load_and_format

| Function | Use when | Returns |
|----------|----------|---------|
| `load_template(internal_path, prompt_data=None)` | Caller will format the template manually | Raw template string, or `""` |
| `load_and_format(internal_path, prompt_data=None, **kwargs)` | You have all format kwargs ready (e.g. `language_code`, `custom_prompt`) | Formatted string, or `""` |

`internal_path` is the file's path under `app/prompts/` without `.txt`, e.g. `"events/guardrail_system"`; `prompt_data` is the session's prompt data (`scenario.prompt_data`), which carries the Skills Store's live versions.

**Variable format.** Templates use Python `str.format()` placeholders: `{var_name}`. Example: `{language_code}`, `{custom_prompt}`, `{persona_context}`. A literal brace is doubled: an example JSON answer in a template is written `{{"label": "..."}}`.

## Directory Structure

```
app/prompts/
├── contracts.py            # one contract per prompt: code, Skills Store details, variables
├── manager.py              # PromptManager singleton, loads .txt files
├── resolver.py             # load_template(), load_and_format(), path-based lookup
├── branching/              # branching-instruction LLM calls
├── counselor/              # report, steering and reminder prompts
├── evaluation/             # transcript evaluator
├── events/                 # detectors and guardrails (system/user pairs)
├── filler/                 # backchannel, interim reply, predictive fillers
├── supervisor/             # live supervisor note
└── system/                 # main agent prompts and the guidance appended to them
```

## Prompt Codes (Prefixed, Path-Based)

Prompt codes use `ally_ai_learn_` prefix: `subdir/filename.txt` → `ally_ai_learn_subdir_filename`. ally-be fetches dynamically via `WHERE promptCode LIKE 'ally_ai_learn_%'`. <!-- docs-path-lint: ignore -->

| Prompt Code | Local Template | Used By |
|-------------|----------------|---------|
| `ally_ai_learn_system_main_agent_prompt_working_memory_split` | `system/main_agent_prompt_working_memory_split` | Main agent prompt #3 (the scenario's selected main prompt) |
| `ally_ai_learn_counselor_report_generation_prompt` | `counselor/report_generation_prompt` | Report generation |
| `ally_ai_learn_system_text_chat_guidance` | `system/text_chat_guidance` | Appended to the persona prompt in text-chat sessions only ([Text-Chat Roleplays](text-chat.md)) |

## Language Instruction (Non-English)

For non-English scenarios (`language_code` not starting with `"en"`), the system always injects a language block. The base instruction tells the LLM to generate in the target language. When `promptData.languageDialogueSamples` is present and non-empty, a "Follow the following linguistic style" section with examples is appended. When samples are missing or empty, only the base instruction is included.

**File:** `app/core/graph/prompt.py:_get_language_block()`, `_get_language_sample_block()`

## The Skills Store and contracts

The Skills Store (ally-be) is the source of truth for prompt text: every `ally_ai_learn_*` prompt's live version is sent in the session metadata, and the session records exactly that map (`metadata.promptVersions` / `promptHashes`). The exception is `ally_ai_learn_evaluation_actor_goal_system` (the actor-goal judge): only its offline endpoint uses it, so ally-be sends it with that request instead of growing the room metadata. The scenario-report judge (`ally_ai_learn_evaluation_evaluator_system`) does read the metadata and ships as usual. The `.txt` files here are defaults: they create a new prompt on its first deploy and are the fallback if the metadata lacks one. Each prompt's contract — its code, its Skills Store name, description and labelled variables, which variables the code supplies and which are required — is declared in `app/prompts/contracts.py` (one `PromptInputs` subclass per prompt; declaring it registers it); the resolver logs `[PROMPT_CONTRACT]` at ERROR when a required one isn't supplied, and `[PROMPT_FALLBACK]` when a selected variant doesn't resolve. Change a prompt's text with a new version in the Skills Store or `scripts/prompts/prompts.mjs push`, not by editing its file. Changing its variables or answer shape takes steps in a set order (code and deploy first to add a variable; text first to remove one): [Changing an existing prompt](../../ally-be/docs/adding-a-prompt.md#changing-an-existing-prompt).

## Sync to ally-be

`scripts/sync_prompts.py` scans `app/prompts/**/*.txt` and POSTs to ally-be `POST /api/v1/prompts/sync`. Runs automatically at container startup (`start.sh`). Uses `CORE_SERVICE_BASE_URL` and `CORE_SERVICE_API_KEY` (x-api-key header).

```bash
poetry run python scripts/sync_prompts.py
poetry run python scripts/sync_prompts.py --dry-run
```

Both need the service's full environment (`.env`), because the script loads the app's settings; without it, `--dry-run` fails on settings validation.

## Configuration

| Setting | Description |
|---------|-------------|
| `CORE_SERVICE_BASE_URL` | ally-be base URL (for sync and webhook) |
| `CORE_SERVICE_API_KEY` | API key for x-api-key header when calling ally-be |
| `RETRIEVED_CONTEXT_DEFER_TO_SUFFIX` | When `True`, `generate_system_message()` returns `retrieved_context` as its own trailing message instead of embedding it in the system message, so provider prompt caching can extend across conversation history (see `docs/02-graph-pipeline.md`'s "`messages_to_send` shape and provider prompt caching"). Default `True`. |

---

## Key Source Files

- `app/prompts/contracts.py` -- the prompt contracts (`PromptInfo`, `PromptInputs`, `PROMPT_CONTRACTS`)
- `app/prompts/manager.py` -- `PromptManager`, template loading
- `app/prompts/resolver.py` -- `load_template()`, `load_and_format()`, `resolve_template()`, path-based lookup
- `app/core/graph/prompt.py` -- `generate_system_message()`, `_get_language_block()`, `_get_language_sample_block()`
- `app/core/scenario_report/service.py` -- `_build_counselor_prompt()` uses `load_and_format()`
- `scripts/sync_prompts.py` -- Sync prompts to ally-be
