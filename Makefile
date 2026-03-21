# Default target
.PHONY: help
help:
	@echo "Available commands:"
	@echo "  make install     Install dependencies (dev included)"
	@echo "  make test        Run pytest with verbosity"
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
