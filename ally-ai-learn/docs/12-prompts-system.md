# Prompts System

**Purpose.** This document describes the prompt template system: how templates are loaded, how backend overrides work, and the path-based prompt codes.

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
| `load_template(prompt_code, backend_prompts=None)` | Caller will format the template manually | Raw template string, or `""` |
| `load_and_format(prompt_code, backend_prompts=None, **kwargs)` | You have all format kwargs ready (e.g. `language_code`, `custom_prompt`) | Formatted string, or `""` |

**Variable format.** Templates use Python `str.format()` placeholders: `{var_name}`. Example: `{language_code}`, `{custom_prompt}`, `{persona_context}`.

## Directory Structure

```
app/prompts/
├── manager.py              # PromptManager singleton, loads .txt files
├── resolver.py             # resolve_template(), path-based lookup
├── system/                 # System prompts for simulation
│   ├── base_role_instruction.txt
│   └── multilingual_instructions.txt
└── counselor/
    └── report_generation_prompt.txt
```

## Prompt Codes (Prefixed, Path-Based)

Prompt codes use `ally_ai_learn_` prefix: `subdir/filename.txt` → `ally_ai_learn_subdir_filename`. ally-be fetches dynamically via `WHERE promptCode LIKE 'ally_ai_learn_%'`. <!-- docs-path-lint: ignore -->

| Prompt Code | Local Template | Used By |
|-------------|----------------|---------|
| `ally_ai_learn_system_base_role_instruction` | `system/base_role_instruction` | System prompt |
| `ally_ai_learn_system_multilingual_instructions` | `system/multilingual_instructions` | Language samples for non-English |
| `ally_ai_learn_counselor_report_generation_prompt` | `counselor/report_generation_prompt` | Report generation |
| `ally_ai_learn_system_text_chat_guidance` | `system/text_chat_guidance` | Appended to the persona prompt in text-chat sessions only ([Text-Chat Roleplays](text-chat.md)) |

## Language Instruction (Non-English)

For non-English scenarios (`language_code` not starting with `"en"`), the system always injects a language block. The base instruction tells the LLM to generate in the target language. When `promptData.languageDialogueSamples` is present and non-empty, a "Follow the following linguistic style" section with examples is appended. When samples are missing or empty, only the base instruction is included.

**File:** `app/core/graph/prompt.py:_get_language_block()`, `_get_language_sample_block()`

## Dashboard Override

The Skills Store (ally-be) is the source of truth for prompt text: every `ally_ai_learn_*` prompt's live version is sent in the session metadata, and the session records exactly that map (`metadata.promptVersions` / `promptHashes`). The `.txt` files here are defaults: they create a new prompt on its first deploy and are the fallback if the metadata lacks one. Each prompt's contract — the variables the code supplies, and which are required — is declared in `app/prompts/contracts.py`; the resolver logs `[PROMPT_CONTRACT]` at ERROR when a required one isn't supplied, and `[PROMPT_FALLBACK]` when a selected variant doesn't resolve. Change a prompt's text with a new version in the Skills Store or `scripts/prompts/prompts.mjs push`, not by editing its file.

## Sync to ally-be

`scripts/sync_prompts.py` scans `app/prompts/**/*.txt` and POSTs to ally-be `POST /api/v1/prompts/sync`. Runs automatically at container startup (`start.sh`). Uses `CORE_SERVICE_BASE_URL` and `CORE_SERVICE_API_KEY` (x-api-key header).

```bash
poetry run python scripts/sync_prompts.py
poetry run python scripts/sync_prompts.py --dry-run
```

## Configuration

| Setting | Description |
|---------|-------------|
| `CORE_SERVICE_BASE_URL` | ally-be base URL (for sync and webhook) |
| `CORE_SERVICE_API_KEY` | API key for x-api-key header when calling ally-be |
| `RETRIEVED_CONTEXT_DEFER_TO_SUFFIX` | When `True`, `generate_system_message()` returns `retrieved_context` as its own trailing message instead of embedding it in the system message, so provider prompt caching can extend across conversation history (see `docs/02-graph-pipeline.md`'s "`messages_to_send` shape and provider prompt caching"). Default `True`. |

---

## Key Source Files

- `app/prompts/manager.py` -- `PromptManager`, template loading
- `app/prompts/resolver.py` -- `load_template()`, `load_and_format()`, `resolve_template()`, path-based lookup
- `app/core/graph/prompt.py` -- `generate_system_message()`, `_get_language_block()`, `_get_language_sample_block()`
- `app/core/scenario_report/service.py` -- `_build_counselor_prompt()` uses `load_and_format()`
- `scripts/sync_prompts.py` -- Sync prompts to ally-be
