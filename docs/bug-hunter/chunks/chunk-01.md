# Chunk 01: Scaffold, config, model factory

**Read first:** `CONTEXT.md`, `spec.md` §3, §9, §10; root `CLAUDE.md` (Verified commands); `ally-ai/pyproject.toml` (versions and tooling to match).

## Goal
A `bug-hunter/` Python package that installs, lints and tests cleanly, loads validated config, and returns a chat model for any role from config alone.

## Build
1. `bug-hunter/` with Poetry (`python = ">=3.12,<3.14"`), Black/isort/flake8 settings matching `ally-ai`, pytest + pytest-asyncio, and a `Makefile` with `install`, `test`, `lint`, `format`.
2. `bug-hunter/AGENTS.md` and `CLAUDE.md` (mirrored): what the package is, how to run it, pointer to `docs/bug-hunter/CONTEXT.md`.
3. `config/apps.yaml`, `config/models.yaml`, `config/limits.yaml` as in the spec. **Verify every path and command against the real repo**; fix any that are wrong and note the change.
4. `config.py`: Pydantic models for all three files; fail fast with a clear message on invalid config; env-var overrides (`BUGHUNTER_MODEL_<ROLE>=provider:model`).
5. `models.py`: `get_model(role)` via `init_chat_model`, with temperature, timeout, retries and fallbacks from config. Add only the provider packages the config uses (`langchain-openai`, `langchain-google-genai`).
6. `cli.py` with Typer or argparse: `bug-hunter config check` prints the resolved config (no secrets) and verifies each app path exists.

## Done when
- `make install && make lint && make test` pass.
- Tests cover: valid and invalid config, env override, unknown role error, every `apps.yaml` path exists in the repo.
- `bug-hunter config check` runs and passes.
- `docs/bug-hunter/notes/CHUNK-01-NOTES.md` written.

## Not in this chunk
Tools, graph, memory, any network call. No real model is called in tests (assert the factory builds the right class with the right params).
