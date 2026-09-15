# Running ally-ai-learn Locally With Other Services

This guide explains how to run ally-ai-learn alongside ally-be and ally-web using `docker-compose.local.yml`. It reuses ally-be's LocalStack and connects to ally-be's API—no port conflicts.

## Prerequisites

1. **Start ally-be first** (includes LocalStack, Postgres, Redis, SQS queues):
   ```bash
   cd ally-be
   docker compose up -d
   # Wait for healthy: migrations, seed, health check
   ```

2. **Start ally-web** (optional, for full UI):
   ```bash
   cd ally-web
   docker compose up -d
   ```

3. **Create ally-ai-learn .env** from `env_sample`:
   ```bash
   cd ally-ai-learn
   cp env_sample .env
   # Edit .env - fill all required variables
   ```

## Key .env Values for Local

| Variable | Value for Local |
|----------|-----------------|
| `ENV` | `DEV` (not LOCAL - worker needs agent_name=Agent for metadata to reach it) |
| `CORE_SERVICE_BASE_URL` | `http://localhost:8001` (when running **outside** Docker) or overridden by compose when inside |
| `CORE_SERVICE_API_KEY` | Must match ally-be's `AI_SERVICE_API_KEY` (in ally-be/.env or docker.env) |
| `SQS_MESSAGE_EVENT_QUEUE_NAME` | Full LocalStack queue URL (avoids QueueDoesNotExist) |
| `AWS_ENDPOINT_URL` | Overridden to `http://host.docker.internal:4566` in compose |

## Start ally-ai-learn

```bash
cd ally-ai-learn
docker compose -f docker-compose.local.yml up -d
# Or without -d to see logs: docker compose -f docker-compose.local.yml up
```

## Access

- **ally-ai-learn API**: http://localhost:8002
- **ally-ai-learn health**: http://localhost:8002/api/health

## Running without an OpenAI key

`OPENAI_API_KEY` is optional (see [`docs/07-llm-providers.md`](07-llm-providers.md)).
Leave it commented out in `.env` and install Ollama instead:

```bash
brew install ollama && ollama serve && ollama pull llama3.2
```

The worker automatically falls back to Ollama for the conversation LLM. Only
semantic-similarity/paraphrase-detection events are disabled in this mode — a
basic simulation session runs end-to-end with zero API key.

## Notes

- **host.docker.internal**: Works on Mac and Windows. On Linux, `extra_hosts: host-gateway` in the compose adds it.
- **Hot reload**: `Dockerfile.dev` uses `start-dev.sh` with `uvicorn --reload` so code changes are picked up.
- **Prompt sync**: On startup, ally-ai-learn syncs prompts to ally-be. Ensure ally-be is up and `CORE_SERVICE_API_KEY` matches `AI_SERVICE_API_KEY`.
