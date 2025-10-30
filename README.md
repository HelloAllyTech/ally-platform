# Ally Learn Core

A LiveKit-based AI agent service for mental health counselor training. This service simulates realistic client conversations using AI, with real-time event detection and scoring to help counselors practice and improve their skills.

## Overview

Ally Learn Core is an intelligent conversation simulation platform that:
- **Simulates realistic client conversations** using LiveKit's voice agents
- **Detects counseling events** in real-time (both positive skills and areas for improvement)
- **Provides immediate feedback** through a scoring system
- **Sends events to AWS SQS** for downstream processing and analytics
- **Supports multiple TTS providers** (ElevenLabs, Deepgram, Sarvam) with voice customization

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
- **TTS Provider** API keys (ElevenLabs, Deepgram, or Sarvam)

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
- `OPENAI_API_KEY` - OpenAI API key for LLM
- `DEEPGRAM_API_KEY` - Deepgram API key for STT
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` - AWS credentials
- `SQS_MESSAGE_EVENT_QUEUE_NAME` - SQS queue name for event publishing

**Optional Settings:**
- `ELEVEN_API_KEY` - ElevenLabs TTS (if using ElevenLabs voices)
- `SARVAM_API_KEY` - Sarvam TTS (if using Sarvam voices)
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

## API Endpoints

- **Health Check**: `GET /api/health` - Service health status

## Project Structure

```
ally-learn-core/
├── app/
│   ├── core/
│   │   ├── config.py                    # Application configuration
│   │   ├── constants.py                 # Constants and enums
│   │   ├── events/                      # Event detection and processing
│   │   │   ├── base.py                  # Base event class
│   │   │   ├── event_processor.py       # Event scoring and selection
│   │   │   ├── factory.py               # Event factory
│   │   │   ├── core_event_sender.py     # SQS event publishing
│   │   │   ├── ui_event_sender.py       # UI event delivery
│   │   │   └── event_list/              # Specific event implementations
│   │   ├── graph/                       # LangGraph workflow
│   │   │   ├── graph_builder.py         # Graph construction
│   │   │   ├── nodes.py                 # Graph nodes (event detection, response generation)
│   │   │   ├── state.py                 # Conversation state management
│   │   │   └── prompt.py                # System prompt generation
│   │   ├── livekit/                     # LiveKit models and types
│   │   ├── queue/                       # AWS SQS integration
│   │   │   └── sqs.py                   # SQS queue client
│   │   └── scenario/                    # Scenario and persona models
│   │       └── base.py                  # Scenario data structures
│   ├── schemas/
│   │   └── events.py                    # Event schemas
│   ├── utils/
│   │   ├── logger.py                    # Logging configuration
│   │   ├── event_handler.py             # Conversation event handlers
│   │   ├── metadata_parser.py           # Room metadata parsing
│   │   ├── tts_manager.py               # TTS provider management
│   │   ├── tts_validator.py             # TTS configuration validation
│   │   └── datetime_utils.py            # Datetime utilities
│   ├── main.py                          # FastAPI application
│   ├── middleware.py                    # Request logging and CORS
│   ├── worker.py                        # LiveKit agent worker
│   └── scenario_sample.py               # Sample scenario data
├── dockerfile                           # Docker configuration
├── docker-compose.yml                   # LocalStack setup
├── start.sh                             # Startup script
├── pyproject.toml                       # Poetry dependencies
└── README.md                            # This file
```

## How It Works

### Conversation Flow

1. **Agent Initialization**
   - LiveKit worker receives room connection request
   - Parses scenario metadata (client persona, events, voice config)
   - Initializes LangGraph state with scenario data
   - Configures STT (Deepgram), TTS (provider-specific), and VAD (Silero)

2. **Conversation Loop**
   - User (counselor) speaks → Deepgram STT → Text
   - LangGraph processes:
     - **Event Detection**: Analyzes conversation for counseling events
     - **Event Processing**: Calculates scores and selects feedback
     - **UI Event Delivery**: Sends feedback to frontend
     - **Core Event Publishing**: Publishes to SQS
     - **Response Generation**: OpenAI generates client response
   - Client response → TTS → Audio → Played to user

3. **Event System**
   - **ACTIVE Events**: Visible to UI with emoji and message
   - **PASSIVE Events**: Logged for analytics only
   - **Scoring**: Cumulative score calculation with polarity-based event selection
   - **Publishing**: All events sent to SQS for downstream processing

### Scenario Configuration

Scenarios define the client persona and are passed as LiveKit room metadata:

```json
{
  "version": "1.0",
  "scenario": {
    "title": "Scenario Name",
    "description": "Learning objective",
    "prompt": "System prompt",
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
    "events": [...]
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
# Use in scenario: {"provider": "sarvam", "config": {"speaker": "meera"}}
```

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

1. Create event class in `app/core/events/event_list/`
2. Extend `BaseEvent` with custom detection logic
3. Register in event factory (`app/core/events/factory.py`)

### Customizing Agent Behavior

- **System Prompt**: Edit `app/core/graph/prompt.py`
- **Graph Workflow**: Modify `app/core/graph/graph_builder.py`
- **Event Processing**: Adjust `app/core/events/event_processor.py`

## Troubleshooting

### Worker not starting
- Verify LiveKit credentials in `.env`
- Check `poetry run python -m app.worker download-files` completed successfully

### No audio output
- Verify TTS API key is valid
- Check voice configuration in scenario metadata
- Ensure fallback voice models are set in `.env`

### Events not sending
- Verify AWS credentials and SQS queue name
- Check LocalStack is running for local development
- Review logs for SQS connection errors
