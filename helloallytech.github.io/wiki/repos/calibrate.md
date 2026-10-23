---
title: calibrate — Voice Agent Evaluation Framework
tags: [repo, calibrate, evaluation, voice-agents, python, cli]
summary: Open-source CLI/library for benchmarking STT, TTS and LLM providers and running persona-based voice-agent simulations.
last_reconciled: 2026-08-14
---

# calibrate — Voice Agent Evaluation Framework

## Purpose

`calibrate` (published as the `calibrate-agent` package) is an open-source evaluation
framework for voice agents, built on top of [pipecat](https://github.com/pipecat-ai/pipecat).
It is not an Ally-authored service in the sense `ally-be`/`ally-ai`/`ally-ai-learn` are —
it originates from ARTPARK-SAHAI-ORG and is developed in the open (Discord/WhatsApp
communities, public docs at `calibrate.artpark.ai`). Ally uses it to move voice-agent
testing from manual listening to automated, repeatable benchmarks across:

- **STT** — benchmark providers (Google, Sarvam, ElevenLabs, …) across 10+ Indic languages
  with metrics tuned for agentic use, not plain transcription accuracy.
- **TTS** — benchmark generated speech across providers using an audio-LLM judge.
- **LLM (text-to-text)** — evaluate response quality and tool-calling across multi-turn
  conversations to pick an LLM for an agent.
- **Simulations** — run realistic persona/scenario conversations against an agent,
  including interruptions, to surface failure modes before real learners hit them.

This is the CLI/engine half of the Calibrate product. [`calibrate-backend`](calibrate-backend.md)
and [`calibrate-frontend`](calibrate-frontend.md) are the hosted service and UI around it.

## Repo shape

- `calibrate/agent/`, `calibrate/stt/`, `calibrate/tts/`, `calibrate/llm/` — one module per
  evaluation surface.
- `calibrate/integrations/` — provider adapters (STT/TTS/LLM vendors).
- `calibrate/ui/` — terminal UI for the interactive CLI menus.
- `examples/` — runnable examples per surface (`agent`, `llm`, `stt`, `tts`).
- `docs/` — the public documentation site source (Mintlify-style: `getting-started/`,
  `core-concepts/`, `cli/`, `api-reference/`, `guides/`, `integrations/`).
- `tests/` — pytest suite.

## Commands

```bash
pip install calibrate-agent

calibrate              # interactive main menu
calibrate stt          # benchmark STT providers
calibrate tts          # benchmark TTS providers
calibrate llm          # interactive LLM evaluation
calibrate simulations  # interactive text or voice simulations
```

## Gotchas that change what you write

- **This is an externally-maintained open-source project, not an internal service.**
  Check upstream (`ARTPARK-SAHAI-ORG/calibrate`) conventions and its own docs before
  assuming an Ally-repo convention (Stacks usage, `.docs-map.yml`, wiki-PR coupling)
  applies here — none of that machinery is wired into this repo.
- **License is CC BY-SA 4.0**, not Ally's internal license posture — be deliberate about
  what gets contributed upstream versus kept as an Ally-side integration.
- Findings from a `calibrate` benchmark run feed evaluation work described in
  [`ally-ai`'s language-quality-eval doc](https://github.com/HelloAllyTech/ally-ai/blob/main/docs/language-eval-judge-schema.md)
  and [`ally-ai-learn`'s STT/TTS provider docs](https://github.com/HelloAllyTech/ally-ai-learn/blob/main/docs/06-stt-providers.md) —
  check those before re-deriving a metric calibrate already benchmarks.

## Canonical docs

- Public docs: [calibrate.artpark.ai](https://calibrate.artpark.ai)
- [CLI documentation](https://calibrate.artpark.ai/docs/cli/overview)
- Community: [Discord](https://discord.gg/9dQB4AngK2), [WhatsApp](https://chat.whatsapp.com/JygDNcZ943a3VmZDXYMg5Z)
