# LLM Providers

**Purpose.** This document describes the LLM provider abstraction, the four supported providers (including open-source options), and the factory routing logic.

---

## Overview

LLM (Large Language Model) providers generate the AI client's conversational responses. The system supports four providers. Ollama and vLLM use the OpenAI-compatible API, so they share the same client class.

## BaseLLMClient Interface

**File:** `app/llms/base.py`

```python
class BaseLLMClient(ABC):
    @property
    @abstractmethod
    def llm_instance(self): ...
```

The interface is minimal: a single `llm_instance` property that returns the underlying LangChain chat model (e.g., `ChatOpenAI`).

## Supported Providers

| Provider | Class | Enum | Requires |
|----------|-------|------|----------|
| OpenAI | `OpenAILLMClient` | `LLMProvider.OPENAI` | `OPENAI_API_KEY` |
| Gemini | `GeminiLLMClient` | `LLMProvider.GEMINI` | `GOOGLE_API_KEY` |
| Ollama | `OpenAILLMClient` (with custom base_url) | `LLMProvider.OLLAMA` | Ollama server running |
| vLLM | `OpenAILLMClient` (with custom base_url) | `LLMProvider.VLLM` | vLLM server running |

### OpenAI

Default provider. Uses `ChatOpenAI` from LangChain. Default model: `gpt-4o-mini`.
`OPENAI_API_KEY` is **optional** — if it's unset, `create_llm_client()` automatically
redirects any `"openai"`-provider role (conversation, branching, chat-summary, ...)
to Ollama instead, provided `OLLAMA_BASE_URL` is reachable (see below). Without a
key:
- `OpenAIEmbeddingClient` is skipped entirely — semantic similarity and paraphrase
  detection events are disabled for the session (they have no Ollama equivalent
  wired up yet)
- Everything else (the actual conversation) runs on Ollama with no degradation

### Gemini

Uses `ChatGoogleGenerativeAI` from LangChain. Accepts both `"gemini"` and `"google"` as provider names.

### Ollama (Open-Source)

Uses `OpenAILLMClient` with a custom `base_url` pointing to the Ollama server's OpenAI-compatible endpoint.

Setup:
```bash
brew install ollama
ollama serve
ollama pull llama3.2
```

Configuration:
```
OLLAMA_BASE_URL=http://localhost:11434/v1       # Local
OLLAMA_BASE_URL=http://host.docker.internal:11434/v1  # Docker
LOCAL_LLM_MODEL=llama3.2
```

If `LOCAL_LLM_MODEL` is set and no model is specified in config, it is used as the default.

### vLLM (Open-Source)

Uses `OpenAILLMClient` with a custom `base_url` pointing to the vLLM server's OpenAI-compatible endpoint.

Configuration:
```
VLLM_BASE_URL=http://your-gpu-server:8000/v1
LOCAL_LLM_MODEL=your-model-name
```

`VLLM_BASE_URL` is required. The factory raises `ValueError` if it is not set.

## Factory

**File:** `app/llms/factory.py`

`create_llm_client(llm_config, language_code, temperature=None)` creates a client:

1. If `llm_config` is `None`, returns default `OpenAILLMClient` with `gpt-4o-mini`
2. Reads `provider` from config (defaults to `openai`)
3. Supports both nested and flat config structures:
   - Nested: `{"provider": "openai", "config": {"model": "gpt-4o", "temperature": 0.7}}`
   - Flat: `{"provider": "openai", "model": "gpt-4o"}`
4. Routes to the appropriate client class
5. For Ollama/vLLM: injects `base_url` and optionally `LOCAL_LLM_MODEL`
6. When `temperature` is passed (the roleplay-level override), it is injected into
   the config and wins over any temperature in `llm_config`

### Temperature precedence

Temperature is resolved highest-priority-first:

1. **Roleplay level** — `promptData.temperature` (per-simulation). Set on the
   scenario's persona/roleplay config; `configure_llm_client` reads it and forwards
   it to `create_llm_client(..., temperature=...)`. Validated and clamped to
   `[0.0, 2.0]` by `PromptData` (bad values degrade to "unset"). Use a lower value
   (e.g. `0.2`-`0.4`) for personas that must stay tightly consistent with the brief.
2. **Provider level** — `llm.config.temperature` in scenario metadata.
3. **Global default** — `settings.LLM_TEMPERATURE` (env `LLM_TEMPERATURE`, default `0.7`).

Only the conversation-response LLM honors the roleplay override; the branching,
classifier, and summary roles are unaffected.

### Routing Table

| Provider Value | Client Class | Notes |
|---------------|-------------|-------|
| `"openai"` | `OpenAILLMClient` | Default |
| `"gemini"` or `"google"` | `GeminiLLMClient` | -- |
| `"ollama"` | `OpenAILLMClient` | With `base_url` from `OLLAMA_BASE_URL` |
| `"vllm"` | `OpenAILLMClient` | With `base_url` from `VLLM_BASE_URL` |

Default configuration:
```python
DEFAULT_LLM_CONFIG = {"provider": "openai", "model": "gpt-4o-mini"}
```

## Multiple LLM Roles

The system uses LLMs in several roles, each potentially with a different provider:

| Role | Config Source | Default |
|------|-------------|---------|
| Conversation response | `scenario.language_config.llm_config` | `gpt-4o-mini` |
| Branching resolution | `scenario.language_config.branching_llm_config` | `gpt-4o-mini` |
| Binary classifier | hardcoded | OpenAI |
| Chat summary | `branching_llm_config` | `gpt-4o-mini` |

---

## Key Source Files

- `app/llms/base.py` -- `BaseLLMClient`
- `app/llms/factory.py` -- `create_llm_client()`
- `app/llms/openai.py` -- `OpenAILLMClient`
- `app/llms/gemini.py` -- `GeminiLLMClient`
- `app/core/constants.py` -- `LLMProvider` enum
