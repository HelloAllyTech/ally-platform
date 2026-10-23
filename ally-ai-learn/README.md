# Ally Learn Core

A LiveKit-based AI agent service for mental health counselor training. This service simulates realistic client conversations using AI, with real-time event detection and scoring to help counselors practice and improve their skills.

## Overview

Ally Learn Core is an intelligent conversation simulation platform that:
- **Simulates realistic client conversations** using LiveKit's voice agents
- **Detects counseling events** in real-time (both positive skills and areas for improvement)
- **Provides immediate feedback** through a scoring system
- **Sends events to AWS SQS** for downstream processing and analytics
- **Supports multiple TTS providers** (ElevenLabs, Deepgram, Sarvam, Google Cloud TTS) with voice customization

## Architecture

The system uses a **LangGraph-based agent** that processes conversations through:

1. **Event Detection** - Analyzes conversation for counseling skills and techniques
2. **Event Processing** - Calculates cumulative scores and selects appropriate feedback
3. **UI Event Delivery** - Sends real-time feedback to the frontend via LiveKit data channels
4. **Core Event Logging** - Publishes events to AWS SQS for analytics and storage

### Key Components

- **FastAPI Server** (`app/main.py`) - Health check endpoints and middleware
- **LiveKit Worker** (`app/worker.py`) - AI agent that handles voice conversations
- **LangGraph Workflow** (`app/core/graph/`) - Conversation flow and event processing
- **Event System** (`app/core/events/`) - Event detection, processing, and delivery
- **Scenario Engine** (`app/core/scenario/`) - Client persona and scenario management
- **Queue System** (`app/core/queue/`) - AWS SQS integration for event publishing

## Prerequisites

- **Python 3.12+**
- **Poetry** (for dependency management)
- **LiveKit** account with API credentials
- **OpenAI** API key (for LLM responses)
- **AWS** credentials (for SQS event publishing)
- **TTS Provider** API keys (ElevenLabs, Deepgram, Sarvam, or Google Cloud TTS)

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd ally-learn-core
```

### 2. Install Dependencies

```bash
poetry install
```

### 3. Configure Environment Variables

```bash
cp env_sample .env
```

Edit `.env` with your configuration:

**Required Settings:**
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` - LiveKit credentials
- `OPENAI_API_KEY` - OpenAI API key for LLM (used as default if not specified in metadata)
- `DEEPGRAM_API_KEY` - Deepgram API key (legacy provider; the default STT is Google chirp_2 via Google Cloud credentials)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` - AWS credentials
- `SQS_MESSAGE_EVENT_QUEUE_NAME` - SQS queue name for event publishing

**Optional Settings:**
- `ELEVEN_API_KEY` - ElevenLabs TTS (if using ElevenLabs voices)
- `SARVAM_API_KEY` - Sarvam TTS/STT (if using Sarvam voices or speech-to-text)
- `GOOGLE_APPLICATION_CREDENTIALS` - Google Cloud TTS/STT credentials file path (optional, uses Application Default Credentials if not set)
- `GOOGLE_API_KEY` - Google API key for Gemini LLM (alternative to `GOOGLE_APPLICATION_CREDENTIALS`)
- `SLACK_ALERTS_ENABLED`, `SLACK_ALERTS_API_TOKEN` - Slack notifications
- `LLM_TEMPERATURE` - LLM temperature (default: 0.7)
- `DEFAULT_MALE_VOICE_MODEL`, `DEFAULT_FEMALE_VOICE_MODEL`, `DEFAULT_NON_BINARY_VOICE_MODEL` - Fallback voice models

## Running the Service

### Local Development

**Option 1: Run both services manually**

Terminal 1 - Start the LiveKit worker:
```bash
poetry run python -m app.worker dev
```

Terminal 2 - Start the FastAPI server:
```bash
poetry run uvicorn app.main:app --reload --port 8000
```

**Option 2: Use the startup script**

```bash
./start.sh
```

This will start both the LiveKit worker and FastAPI server in parallel.

### Docker Deployment

```bash
docker build -t ally-learn-core .
docker run -p 8000:8000 --env-file .env ally-learn-core
```

### LocalStack (Local AWS Testing)

For local development with AWS services:

```bash
docker-compose up -d
```

This starts LocalStack with SES, S3, Lambda, CloudWatch Logs, and SQS.

### Full Dev Stack with Compose

Spin up the application along with LocalStack:

```bash
docker compose -f docker-compose.full.yml up --build
```

Before running:
- copy `env_sample` to `.env` and fill in required secrets.
- ensure AWS entries target LocalStack (`AWS_ACCESS_KEY_ID=test`, `AWS_ENDPOINT_URL=http://localhost:4566`, etc.).

Within the compose network the app reaches LocalStack at `http://localstack:4566`; when running the app outside compose, switch back to `http://localhost:4566`.
The service is exposed on host port `8002` (`http://localhost:8002`) to avoid clashing with other Ally services.

### Run Alongside ally-be and ally-web

Use `docker-compose.local.yml` when ally-be and ally-web are already running. This reuses ally-be's LocalStack (no port conflicts):

```bash
# 1. Start ally-be first (manually or via docker compose)
# 2. Start ally-web (optional)
# 3. Start ally-ai-learn
cd ally-ai-learn
docker compose -f docker-compose.local.yml up -d
```

See [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md) for details. Ensure `CORE_SERVICE_API_KEY` matches ally-be's `AI_SERVICE_API_KEY`.

## API Endpoints

- **Health Check**: `GET /api/health` - Service health status
- **API v1** (prefix `/api/v1`): Scenario report generation (see `app/api/`)

## Project Structure

```
ally-learn-core/
├── app/
│   ├── api/                             # FastAPI routers
│   │   ├── scenario_report.py           # Scenario report generation
│   │   └── dependencies.py              # Auth, token verification
│   ├── core/
│   │   ├── agent/                       # Agent setup and utilities
│   │   │   └── factory.py               # parse_room_metadata, client config, agent creation
│   │   ├── branching_instructions/      # Branching instruction parsing and resolution
│   │   ├── config.py                    # Application configuration
│   │   ├── constants.py                 # Constants and enums
│   │   ├── embeddings/                 # Embedding clients (OpenAI)
│   │   ├── events/                      # Event detection and processing
│   │   │   ├── base.py                  # Base event class
│   │   │   ├── event_processor.py       # Event processing logic
│   │   │   ├── factory.py               # Event factory
│   │   │   ├── handlers.py              # Conversation event handlers, send_event_to_ui
│   │   │   ├── schedulers.py            # Event scheduling utilities
│   │   │   ├── schemas.py               # Event schemas
│   │   │   ├── utils.py                 # Event utilities
│   │   │   ├── event_orchestrator/      # Orchestrator, sender, score evaluator
│   │   │   └── event_types/             # Event implementations (10 types)
│   │   ├── graph/                       # LangGraph workflow
│   │   │   ├── checkpointer.py          # Graph state checkpointing
│   │   │   ├── graph_builder.py         # build_simulation_graph, build_report_graph
│   │   │   ├── knowledge_retrieval.py   # Knowledge retrieval for context
│   │   │   ├── nodes.py                 # Graph nodes
│   │   │   ├── state.py                 # SimulationState
│   │   │   ├── utils.py                 # Graph utilities
│   │   │   └── prompt.py               # System prompt generation
│   │   ├── livekit/                     # LiveKit models
│   │   ├── queue/                       # AWS SQS integration
│   │   ├── scenario/                    # Scenario and persona models
│   │   │   ├── base.py                  # Scenario, PromptData
│   │   │   └── simulation_instructions.py  # Behavior and state instructions
│   │   ├── scenario_report/             # Report generation service
│   │   └── scoring/                    # ScoreKeeper for behavior scores
│   ├── evaluation/                      # Evaluation logging
│   ├── prompts/                         # Prompt templates
│   │   ├── manager.py                  # Template loading
│   │   ├── resolver.py                  # Backend override resolution
│   │   └── system/                     # System prompts
│   ├── tts/                             # TTS provider implementations
│   ├── stt/                             # STT provider implementations
│   ├── llms/                            # LLM provider implementations
│   ├── main.py                          # FastAPI application
│   ├── middleware.py                    # Request logging and CORS
│   └── worker.py                        # LiveKit agent worker
├── docs/                                # Developer documentation
├── scenario_sample.py                   # Sample scenario data
├── dockerfile
├── docker-compose.yml
├── start.sh
├── pyproject.toml
└── README.md
```

## How It Works

### Conversation Flow

1. **Agent Initialization**
   - LiveKit worker receives room connection request
   - Parses scenario metadata (client persona, events, voice config, STT/LLM config)
   - Initializes LangGraph state with scenario data
   - Configures STT (via factory from metadata or defaults), TTS (via factory based on scenario voice config), and VAD (Silero)
   - TTS/STT/LLM providers are instantiated using factory pattern - can be configured per scenario via metadata or fallback to environment defaults

2. **Conversation Loop**
   - User (counselor) speaks → STT (configured from metadata or default) → Text
   - LangGraph processes (8 nodes with 3 parallel paths from start):
     - **Event Detection + Behavior Detection + Knowledge Retrieval** (parallel): Analyzes conversation for counseling events, classifies behavior instructions, and retrieves relevant knowledge context
     - **Sync**: Convergence point for all three parallel paths
     - **Branching Resolution**: Resolves branching instructions (LLM tags, dynamic variables)
     - **Response + UI Feedback** (parallel): LLM generates client response; event and behavior scores/feedback are sent to frontend
   - Client response → TTS → Audio → Played to user

3. **Event System**
   - **ACTIVE Events**: Visible to UI with emoji and message
   - **PASSIVE Events**: Logged for analytics only
   - **Guardrail Events**: Detect boundary violations in counselor utterances using binary classification; PASSIVE visibility, trigger agent redirect via `actorDialogue` branching instruction
   - **Scoring**: Cumulative score calculation with polarity-based event selection
   - **Publishing**: All events sent to SQS for downstream processing
   - **Termination**: Events can trigger automatic session termination (see [Event Termination](docs/13-event-termination.md))

### Scenario Configuration

Scenarios define the client persona and are passed as LiveKit room metadata:

```json
{
  "version": "1.0",
  "scenario": {
    "title": "Scenario Name",
    "description": "Learning objective",
    "promptData": {
      "name": "Client Name",
      "age": 25,
      "gender": "female",
      "context": "Situation context",
      "lifeHistory": "Background",
      "openingStatements": ["Hello...", "Hi..."]
    },
    "voice": {
      "provider": "elevenlabs",
      "name": "Voice Name",
      "config": {
        "model": "eleven_turbo_v2_5",
        "voice_id": "voice_id_here"
      }
    },
    "languageCode": "en-US",
    "stt": {
      "provider": "deepgram",
      "config": {
        "model": "nova-3"
      }
    },
    "llm": {
      "provider": "openai",
      "config": {
        "model": "gpt-4o-mini",
        "temperature": 0.7
      }
    },
    "events": [...]
  }
}
```

**Google TTS Example:**
```json
{
  "voice": {
    "provider": "google",
    "name": "google-female-chirp3",
    "config": {
      "voice_name": "en-US-Chirp3-HD-Aoede",
      "gender": "female"
    }
  },
  "languageCode": "en-US"
}
```

**Note:** For Google TTS streaming synthesis, use Chirp 3 HD voices (format: `{language}-Chirp3-HD-{Name}`). See [Google Cloud TTS documentation](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types) for available voices.
```

**STT and LLM Configuration:**

STT (Speech-to-Text) and LLM (Language Model) providers can be configured per scenario via metadata. If not specified, the system uses default providers from environment configuration.

```json
{
  "languageCode": "hi-IN",
  "stt": {
    "provider": "deepgram",
    "config": {
      "model": "nova-3"
    }
  },
  "llm": {
    "provider": "openai",
    "config": {
      "model": "gpt-4o-mini",
      "temperature": 0.7
    }
  }
}
```

## Configuration

### TTS Providers

Configure voice providers in `.env`:

**ElevenLabs:**
```env
ELEVEN_API_KEY=your_key
# Use in scenario: {"provider": "elevenlabs", "config": {"model": "eleven_turbo_v2_5", "voice_id": "..."}}
```

**Deepgram:**
```env
DEEPGRAM_API_KEY=your_key
# Use in scenario: {"provider": "deepgram", "config": {"model": "aura-asteria-en"}}
```

**Sarvam:**
```env
SARVAM_API_KEY=your_key
# Use in scenario: {"provider": "sarvam", "config": {"model": "bulbul:v2", "speaker": "anushka"}}
```

**Google Cloud TTS:**
```env
# Option 1: Use Application Default Credentials (recommended)
# Run: gcloud auth application-default login

# Option 2: Use credentials file
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json

# Use in scenario: {"provider": "google", "config": {"voice_name": "en-US-Chirp3-HD-Aoede", "gender": "female"}}
# Note: For streaming synthesis, use Chirp 3 HD voices (e.g., en-US-Chirp3-HD-*, hi-IN-Chirp3-HD-*)
# See: https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types
```

**Hume.ai TTS:**
```env
HUME_API_KEY=your_key
# Use in scenario: {"provider": "hume", "config": {"model": "octave-2", "voice_id": "..."}}
# Note: Supports multiple languages including English (en-IN) and Hindi (hi-IN)
# See: https://docs.livekit.io/agents/integrations/tts/hume/
```

### STT Providers

STT (Speech-to-Text) providers can be configured per scenario via metadata or fallback to environment defaults.

**Deepgram (legacy, unfunded):**
```env
DEEPGRAM_API_KEY=your_key
# Use in scenario metadata:
# {
#   "stt": {
#     "provider": "deepgram",
#     "config": {
#       "model": "nova-3"
#     }
#   }
# }
```

If not specified in metadata, the system uses the default Google configuration (`DEFAULT_STT_CONFIG` in `app/core/constants.py`: chirp_2 in asia-southeast1).

**Google Cloud STT:**
```env
# Option 1: Use Application Default Credentials (recommended)
# Run: gcloud auth application-default login

# Option 2: Use credentials file
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json

# Use in scenario metadata:
# {
#   "stt": {
#     "provider": "google",
#     "config": {
#       "model": "chirp"
#     }
#   }
# }
# Supported models: "chirp" (default, recommended), "chirp_2", "chirp_3",
# "latest_long", "latest_short", "long", "short"
```

**Sarvam STT (Indian languages):**
```env
SARVAM_API_KEY=your_key
# Use in scenario metadata:
# {
#   "stt": {
#     "provider": "sarvam",
#     "config": {
#       "model": "saarika:v2.5"
#     }
#   }
# }
# Note: Sarvam supports Indian languages (hi-IN, ta-IN, etc.)
# and maps language codes to its own format automatically.
```

### LLM Providers

LLM (Language Model) providers can be configured per scenario via metadata or fallback to environment defaults.

**OpenAI (Default):**
```env
OPENAI_API_KEY=your_key
LLM_TEMPERATURE=0.7  # Optional, defaults to 0.7
# Use in scenario metadata:
# {
#   "llm": {
#     "provider": "openai",
#     "config": {
#       "model": "gpt-4o-mini",
#       "temperature": 0.7
#     }
#   }
# }
```

If not specified in metadata, the system uses the default OpenAI configuration from environment settings (model and temperature from `OPENAI_API_KEY` and `LLM_TEMPERATURE`).

**Roleplay-level temperature override:**

Temperature can also be set per-scenario at the roleplay level via `promptData.temperature`. When present, it overrides both `llm.config.temperature` and the global `LLM_TEMPERATURE` for that simulation's conversation responses. Lower values keep the persona tightly consistent with the brief; higher values add variety. Values are clamped to `0.0`–`2.0`.

```json
{
  "promptData": {
    "name": "Client Name",
    "temperature": 0.3
  }
}
```

Resolution order (highest priority first): `promptData.temperature` → `llm.config.temperature` → `LLM_TEMPERATURE` (default `0.7`).

**Open-Source Models (Ollama / vLLM):**

For local development or dev server testing, you can use open-source models (Llama, Mistral, etc.) via Ollama or vLLM. Both expose OpenAI-compatible APIs.

**Important:** `OPENAI_API_KEY` is still required even when using Ollama/vLLM, because binary classifiers and embeddings always run on OpenAI regardless of the conversation LLM provider.

*Ollama (local):*

Ollama must be installed and running separately on your host machine. It is not bundled with the app or started automatically by docker-compose.

```bash
# 1. Install Ollama (https://ollama.com)
# macOS:
brew install ollama

# 2. Start Ollama and pull a model
ollama serve
ollama pull llama3.2
```

Set environment variables in your `.env` file:
```env
# If running the app in Docker (use host.docker.internal to reach host Ollama):
OLLAMA_BASE_URL=http://host.docker.internal:11434/v1

# If running the app without Docker (locally):
# OLLAMA_BASE_URL=http://localhost:11434/v1

# Optional: default model fallback if not specified in scenario metadata
LOCAL_LLM_MODEL=llama3.2
```

Configure the scenario metadata to use Ollama:
```json
{
  "llm": {
    "provider": "ollama",
    "config": {
      "model": "llama3.2"
    }
  }
}
```

*vLLM (GPU server):*

vLLM runs on a separate GPU server and exposes an OpenAI-compatible API.

```env
VLLM_BASE_URL=http://your-gpu-server:8000/v1
LOCAL_LLM_MODEL=meta-llama/Llama-3.2-8B-Instruct
```

Configure the scenario metadata to use vLLM:
```json
{
  "llm": {
    "provider": "vllm",
    "config": {
      "model": "meta-llama/Llama-3.2-8B-Instruct"
    }
  }
}
```

Scenarios that do not specify `"provider": "ollama"` or `"provider": "vllm"` in their metadata will continue to use OpenAI as the LLM provider.

**Google Gemini:**
```env
# Option 1: Use Google API key
GOOGLE_API_KEY=your_google_api_key

# Option 2: Use Application Default Credentials
# Run: gcloud auth application-default login
# (GOOGLE_APPLICATION_CREDENTIALS also accepted)

# Use in scenario metadata:
# {
#   "llm": {
#     "provider": "gemini",
#     "config": {
#       "model": "gemini-2.0-flash-exp",
#       "temperature": 0.7
#     }
#   }
# }
```

Note: `"google"` is also accepted as a provider name (alias for `"gemini"`).
`OPENAI_API_KEY` is still required even when using Gemini, because binary classifiers and embeddings always run on OpenAI.

### Logging

Configure logging levels:
```env
LOG_LEVEL=INFO                    # Application log level
LIVEKIT_LOG_LEVEL=WARNING         # LiveKit SDK log level
LIVEKIT_LOG_DEV_MODE=False        # Development mode logging
SLACK_ALERTS_ENABLED=False        # Slack error notifications
```

## Deployment

### Docker

Build and run with Docker:
```bash
docker build -t ally-learn-core .
docker run -p 8000:8000 --env-file .env ally-learn-core
```

The container runs both the FastAPI server (port 8000) and LiveKit worker simultaneously.

## Development

### Adding New Events

1. Create event class in `app/core/events/event_types/`
2. Extend `BaseEvent` with custom detection logic
3. Register in event factory (`app/core/events/factory.py`)

### Event Termination

Events can automatically terminate sessions when they occur. Configure via `autoTerminationEvents` in scenario metadata, mapping event IDs to termination messages. Supported by all event types.

See [Event Termination Documentation](docs/13-event-termination.md) for detailed guide and examples.

### Customizing Agent Behavior

- **System Prompt**: Edit `app/core/graph/prompt.py`
- **Graph Workflow**: Modify `app/core/graph/graph_builder.py`
- **Event Processing**: Adjust `app/core/events/event_processor.py`

## Troubleshooting

### Worker not starting
- Verify LiveKit credentials in `.env`
- Check `poetry run python -m app.download_files` completed successfully

### No audio output
- Verify TTS API key is valid (or Google Cloud credentials are configured)
- Check voice configuration in scenario metadata
- For Google TTS: Ensure you're using Chirp 3 HD voices for streaming (e.g., `en-US-Chirp3-HD-Aoede`)
- Ensure fallback voice models are set in `.env`
- For Google TTS: Verify Application Default Credentials are set up (`gcloud auth application-default login`)

### Events not sending
- Verify AWS credentials and SQS queue name
- Check LocalStack is running for local development
- Review logs for SQS connection errors

## Contributing

Please see the CONTRIBUTING.md to get started.
