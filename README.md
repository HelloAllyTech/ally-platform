# Ally Learn Core

A FastAPI-based backend service for the Ally Learn platform.

## Getting Started

### Prerequisites

- Python 3.12+
- Poetry (for dependency management)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ally-learn-core
```

2. Install dependencies using Poetry:
```bash
poetry install
```

3. Set up environment variables:
```bash
cp env_sample .env
```
Edit the `.env` file with your configuration.

### Running the Service

```bash
poetry run uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000`.

API documentation is available at:
- Swagger UI: `http://localhost:8000/api/v1/docs`
- ReDoc: `http://localhost:8000/api/v1/redoc`

## Project Structure

```
.
├── app/                    # Main application package
│   ├── api/                # API routes
│   │   └── v1/             # API version 1
│   │       └── endpoints/  # API endpoints
│   ├── core/               # Core application logic
│   ├── exceptions/         # Custom exceptions
│   ├── schemas/            # Pydantic models
│   └── utils/              # Utility functions
├── Dockerfile              # Docker configuration
├── docker-compose.yml      # Docker Compose configuration
└── pyproject.toml          # Poetry configuration
```
