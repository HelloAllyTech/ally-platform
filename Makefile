# Default target
.PHONY: help
help:
	@echo "Available commands:"
	@echo "  make install     Install dependencies (dev included)"
	@echo "  make test        Run pytest with verbosity"
	@echo "  make lint        Run flake8, isort check, and black check"
	@echo "  make format      Run isort and black"
	@echo "  make fix         Apply automatic formatting fixes"
	@echo "  make migrate     Run Weaviate migrations"
	@echo "  make sync-prompts Sync prompts to backend"

# Install dependencies (like your GitHub Action step)
.PHONY: install
install:
	@poetry install --no-interaction --no-root --with dev

# Run tests
.PHONY: test
test:
	@poetry run pytest tests/ -v

# Lint and formatting
.PHONY: lint
lint:
	@poetry run flake8 app tests
	@poetry run isort --check-only app tests
	@poetry run black --check app tests

.PHONY: format
format:
	@poetry run isort app tests
	@poetry run black app tests

.PHONY: fix
fix: format

# Roleplay Studio v2 voice worker (registers as AGENT_NAME_V2; v1 untouched)
.PHONY: run-worker-v2
run-worker-v2:
	@poetry run python -m app.worker_v2 start

# v2 worker in LiveKit console/dev mode (local testing without a dispatcher)
.PHONY: run-worker-v2-dev
run-worker-v2-dev:
	@poetry run python -m app.worker_v2 dev
