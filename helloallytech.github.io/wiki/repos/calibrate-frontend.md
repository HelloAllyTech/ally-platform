---
title: calibrate-frontend — Calibrate Web UI
tags: [repo, calibrate, frontend, nextjs, evaluation]
summary: Next.js UI for the hosted Calibrate product — datasets, personas, scenarios, simulations, and evaluation results.
last_reconciled: 2026-08-14
---

# calibrate-frontend — Calibrate Web UI

## Purpose

`calibrate-frontend` is the Next.js web app for the hosted Calibrate voice-agent
evaluation product. It is the UI on top of [`calibrate-backend`](calibrate-backend.md),
which in turn drives the [`calibrate`](calibrate.md) evaluation engine — this is where a
user configures datasets/personas/scenarios, kicks off STT/TTS/LLM benchmarks or agent
simulations, and reviews results (metrics, charts, per-test detail).

## Repo shape

- `src/app/` — Next.js App Router pages: `agents/`, `datasets/`, `personas/`,
  `scenarios/`, `simulations/`, `stt/`, `tts/`, `metrics/`, `tools/`, `tests/`,
  `login/`, `signup/`, `about/`, `debug-client/`.
- `src/components/` — `evaluations/`, `eval-details/`, `simulation-tabs/`,
  `agent-tabs/`, `test-results/`, `charts/`, `ui/`, `providers/`.
- `src/hooks/`, `src/lib/`, `src/constants/`.

## Tech stack

Next.js, React, `next-auth`, Recharts (charts), Sentry (`@sentry/nextjs`), Vercel
Analytics, `papaparse`/`jszip` for dataset import/export. Deployed via Vercel
(`vercel.json`).

## Commands

```bash
npm install
cp env.example .env.local   # fill in values
npm run dev                  # http://localhost:3000
npm run build && npm start   # production build
```

## Gotchas that change what you write

- **Externally-licensed (CC BY-SA 4.0), same as `calibrate`** — not on the internal
  `.docs-map.yml`/Stacks/wiki-PR machinery the six core Ally repos use.
- Building a chart or dashboard here should follow the same design discipline as any
  Ally chart work — check the `dataviz` guidance before adding a new chart type,
  independent of whether Stacks itself has an entry for this repo.

## Canonical docs

- Product docs: [calibrate.artpark.ai](https://calibrate.artpark.ai)
- Sibling repos: [`calibrate`](calibrate.md) (evaluation engine/CLI), [`calibrate-backend`](calibrate-backend.md) (API)
