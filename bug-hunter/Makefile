# Default target
.PHONY: help
help:
	@echo "Available commands:"
	@echo "  make install     Install dependencies (dev included)"
	@echo "  make test        Run pytest with verbosity"
	@echo "  make lint        Run flake8, isort check, and black check"
	@echo "  make format      Run isort and black"
	@echo "  make check       Validate config and app paths (bug-hunter config check)"
	@echo "  make test-docker Integration: run one test file per app in the real sandbox"

# Install dependencies (same flags as the CI step for the Python apps)
.PHONY: install
install:
	@poetry install --no-interaction --with dev

# Run tests
.PHONY: test
test:
	@poetry run pytest tests/ -v

# Lint and formatting
.PHONY: lint
lint:
	@poetry run flake8 src tests
	@poetry run isort --check-only src tests
	@poetry run black --check src tests

.PHONY: format
format:
	@poetry run isort src tests
	@poetry run black src tests

# Real sandbox against every app (needs Docker; slow). BUGHUNTER_IT_APPS=ally-ai,ally-be to limit.
.PHONY: test-docker
test-docker:
	@poetry run pytest tests/integration -m docker -v -s

.PHONY: check
check:
	@poetry run bug-hunter config check
