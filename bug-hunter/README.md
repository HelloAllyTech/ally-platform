# Bug Hunter v2

A LangGraph agent that finds and fixes bugs in the five ally-platform apps
(`ally-be`, `ally-web`, `ally-ai`, `ally-ai-learn`, `ally-mobile`). Design and rules:
[`docs/bug-hunter/CONTEXT.md`](../docs/bug-hunter/CONTEXT.md) and
[`docs/bug-hunter/spec.md`](../docs/bug-hunter/spec.md).

## Run

Python 3.12 + Poetry, like `ally-ai`:

```bash
cd bug-hunter
poetry env use "$(uv python find 3.12)"   # once; the host Python may be newer
make install
make test
make lint
poetry run bug-hunter config check        # resolved config, no secrets; verifies app paths
```

Override a role's model for evals: `BUGHUNTER_MODEL_FIX=openai:gpt-5-mini`.
Point at another checkout: `BUGHUNTER_REPO_ROOT=/path/to/ally-platform`.

## Layout

```
config/        apps.yaml (apps, commands, risk paths), models.yaml (model per role), limits.yaml
src/bug_hunter/
  config.py    loads + validates the YAML (Pydantic); env overrides
  models.py    get_model(role) / get_embeddings() via init_chat_model, with fallbacks
  cli.py       `bug-hunter config check`
tests/         offline unit tests; never call a real model
```

Later chunks add `graph/`, `tools/`, `context/`, `memory/`, `safety/`, `signals/`,
`output/`, `prompts/` and `evals/` (spec §3).
