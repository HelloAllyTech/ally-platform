# Prompts System

**Purpose.** This document describes the prompt template system: how templates are loaded, how backend overrides work, and the mapping between backend keys and local files.

---

## Overview

The prompts system provides:

1. **Local templates** -- `.txt` files in `app/prompts/` loaded by `PromptManager`
2. **Backend overrides** -- `promptData.prompts` from scenario metadata can override templates when `SYNC_PROMPTS_TO_LOCAL` is true
3. **Template resolution** -- `resolve_template()` in `app/prompts/resolver.py` returns the appropriate template string

## Directory Structure

```
app/prompts/
├── manager.py              # PromptManager singleton, loads .txt files
├── resolver.py             # resolve_template(), backend key mapping
├── system/                 # System prompts for simulation
│   ├── default_system_prompt.txt
│   ├── context_generation_prompt.txt
│   └── language_instruction_non_english.txt
└── prosody/                # Prosody generation prompts
    ├── default_generation_prompt.txt
    ├── unified_prompt_with_enhancement.txt
    └── parameters_only_prompt.txt
```

## PromptManager

**File:** `app/prompts/manager.py`

Loads all `.txt` files from subdirectories. Expects structure: `<file_key>/<prompt_key>.txt`

- `prompt_manager.get_template(file_key, prompt_key)` returns the template content
- `prompt_manager.reload()` reloads from disk

## Template Resolver

**File:** `app/prompts/resolver.py`

`resolve_template(backend_key, backend_prompts)` returns the template string:

- **When `SYNC_PROMPTS_TO_LOCAL` is false:** Always uses local `.txt` prompts, ignores metadata
- **When `SYNC_PROMPTS_TO_LOCAL` is true:** Uses `promptData.prompts[backend_key]` when available and different from local; otherwise falls back to local

## Backend Key Mapping

| Backend Key (in promptData.prompts) | Local Template | Used By |
|-------------------------------------|----------------|---------|
| `ally_ai_learn_default` | `system/default_system_prompt` | System prompt |
| `ally_ai_learn_context_generation` | `system/context_generation_prompt` | Context generator |
| `context_generation_system_prompt` | `system/context_generation_prompt` | Context generator |
| `language_instruction_non_english` | `system/language_instruction_non_english` | Non-English language instruction |
| `ally_ai_learn_prosody_generation` | `prosody/default_generation_prompt` | Prosody default params |
| `ally_ai_learn_prosody_unified` | `prosody/unified_prompt_with_enhancement` | Prosody runtime (params + text) |
| `ally_ai_learn_prosody_parameters_only` | `prosody/parameters_only_prompt` | Prosody runtime (params only) |

## Language Instruction

When the scenario language is non-English (`language_code` not starting with `"en"`), the system injects a language instruction block into the system prompt. This is resolved via `resolve_template("language_instruction_non_english", backend_prompts)` and formatted with `{language_code}`.

**File:** `app/core/graph/prompt.py:_get_language_instruction()`

The language instruction is injected in `_get_language_block()`.

## Configuration

| Setting | Description |
|---------|-------------|
| `SYNC_PROMPTS_TO_LOCAL` | When true, use backend prompts from metadata when available; otherwise always use local |

---

## Key Source Files

- `app/prompts/manager.py` -- `PromptManager`, template loading
- `app/prompts/resolver.py` -- `resolve_template()`, `BACKEND_TO_LOCAL` mapping
- `app/core/graph/prompt.py` -- `_get_language_instruction()`, `_get_language_block()`
