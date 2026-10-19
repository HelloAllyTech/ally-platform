# Getting Started

**Purpose.** This document covers everything you need to set up a local development environment, run the service, and execute tests.

---

## Prerequisites

- **Python 3.12+**
- **Poetry** for dependency management
- **LiveKit** account with API credentials
- **OpenAI** API key (always required -- see [Architecture](architecture.md) for why)
- **AWS** credentials or LocalStack for SQS
- Google Cloud credentials (the default STT and the fallback TTS are Google) and at least one other **TTS provider** API key

## Environment Setup

### 1. Clone and install

```bash
git clone <repository-url>
cd ally-learn-core
poetry install
```

### 2. Configure environment

```bash
cp env_sample .env
```

Edit `.env` with your credentials. Required variables:

| Variable | Description |
|----------|-------------|
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `LIVEKIT_URL` | LiveKit WebSocket URL |
| `OPENAI_API_KEY` | OpenAI API key |
| `DEEPGRAM_API_KEY` | Deepgram API key (legacy STT/TTS; unfunded, only needed to read old rows) |
| `AWS_ACCESS_KEY_ID` | AWS access key (or `test` for LocalStack) |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key (or `test` for LocalStack) |
| `AWS_REGION` | AWS region (e.g., `us-east-1`) |
| `SQS_MESSAGE_EVENT_QUEUE_NAME` | SQS queue name |

Optional variables for additional providers:

| Variable | Description |
|----------|-------------|
| `ELEVEN_API_KEY` | ElevenLabs TTS |
| `SARVAM_API_KEY` | Sarvam TTS/STT |
| `HUME_API_KEY` | Hume TTS |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google Cloud TTS/STT |
| `OLLAMA_BASE_URL` | Ollama endpoint (e.g., `http://localhost:11434/v1`) |
| `VLLM_BASE_URL` | vLLM endpoint |
| `LOCAL_LLM_MODEL` | Model name for Ollama/vLLM |

## Running Locally

### Option 1: Two terminals

Terminal 1 -- LiveKit worker:
```bash
poetry run python -m app.worker dev
```

Terminal 2 -- FastAPI server:
```bash
poetry run uvicorn app.main:app --reload --port 8000
```

### Option 2: Startup script

```bash
./start.sh
```

This starts both the LiveKit worker and FastAPI server in parallel.

## Running with Docker

### Build and run

```bash
docker build -t ally-learn-core .
docker run -p 8000:8000 --env-file .env ally-learn-core
```

### LocalStack for local AWS

Start LocalStack to emulate SQS locally:

```bash
docker-compose up -d
```

This starts LocalStack with SES, S3, Lambda, CloudWatch Logs, and SQS on port `4566`.

Set these in your `.env`:
```
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_ENDPOINT_URL=http://localhost:4566
```

### Full dev stack

```bash
docker compose -f docker-compose.full.yml up --build
```

The app is exposed on host port `8002` to avoid clashing with other Ally services. Within the compose network, the app reaches LocalStack at `http://localstack:4566`.

## Running Tests

```bash
# All tests
poetry run pytest

# Unit tests only
poetry run pytest tests/unit/

# Integration tests only
poetry run pytest tests/integration/

# With coverage
poetry run pytest --cov=app
```

## Health Check

Once running, verify the service is healthy:

```bash
curl http://localhost:8000/api/health
```

## Open-Source LLM Setup (Ollama)

To use Ollama instead of OpenAI for conversation LLM:

```bash
# Install Ollama
brew install ollama

# Start server and pull a model
ollama serve
ollama pull llama3.2
```

Add to `.env`:
```
OLLAMA_BASE_URL=http://localhost:11434/v1
LOCAL_LLM_MODEL=llama3.2
```

Note: OpenAI is still required for embeddings and branching resolution even when using Ollama.

---

## Key Source Files

- `env_sample` -- sample environment variables
- `dockerfile` -- Docker build configuration
- `docker-compose.yml` -- LocalStack setup
- `docker-compose.full.yml` -- Full stack with app
- `start.sh` -- startup script
- `pyproject.toml` -- Poetry dependencies
