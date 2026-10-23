---
title: calibrate-backend — Calibrate API Service
tags: [repo, calibrate, backend, fastapi, python]
summary: FastAPI backend for the hosted Calibrate product — serves calibrate-frontend and orchestrates calibrate benchmark/simulation runs.
last_reconciled: 2026-08-14
---

# calibrate-backend — Calibrate API Service

## Purpose

`calibrate-backend` is the FastAPI service behind the hosted Calibrate product: it is
the API [`calibrate-frontend`](calibrate-frontend.md) talks to, and it drives the
evaluation engine in [`calibrate`](calibrate.md) (STT/TTS/LLM benchmarks and persona
simulations) as a hosted, multi-user service rather than a local CLI run.

## Repo shape

- `src/` — FastAPI app; `src/routers/` — one router module per API surface.
- `scripts/` — operational scripts.
- `Dockerfile`, `docker-compose.yml` — containerized local run.

## Commands

```bash
uv sync --frozen

cd src
uv run uvicorn main:app --reload   # http://localhost:8000, docs at /docs
```

## Tech stack

FastAPI, `uv` for dependency management, `boto3` (AWS), Pydantic v2. See `pyproject.toml`
for the full dependency set, including the `calibrate` evaluation library itself.

## Gotchas that change what you write

- **Externally-licensed (CC BY-SA 4.0), same as `calibrate`** — not on the internal
  `.docs-map.yml`/Stacks/wiki-PR machinery the six core Ally repos use.
- This service is a thin orchestration layer over `calibrate` — check whether a change
  belongs here (hosting/API concerns) or in `calibrate` itself (evaluation logic) before
  duplicating something the engine already does.

## Canonical docs

- Product docs: [calibrate.artpark.ai](https://calibrate.artpark.ai)
- Sibling repos: [`calibrate`](calibrate.md) (evaluation engine/CLI), [`calibrate-frontend`](calibrate-frontend.md) (UI)
