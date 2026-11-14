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
	@echo "  make eval        Golden cases vs an agent: CASES=<filter> AGENT=baseline MODE=issue|sweep (single cases locally)"
	@echo "  make eval-oracle Prove cases: oracle fails before, passes after the real fix (CASES=<filter>)"
	@echo "  make eval-mine   Mine bug/clean candidates from git history into evals/golden/candidates/"
	@echo "  make db-up       Start the local Postgres (checkpoints) from compose.yaml; make db-down stops it"

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
	@poetry run flake8 src tests evals
	@poetry run isort --check-only src tests evals
	@poetry run black --check src tests evals

.PHONY: format
format:
	@poetry run isort src tests evals
	@poetry run black src tests evals

# Real sandbox against every app (needs Docker; slow). BUGHUNTER_IT_APPS=ally-ai,ally-be to limit.
.PHONY: test-docker
test-docker:
	@poetry run pytest tests/integration -m docker -v -s

# Repo map of all five real apps + neighbourhoods of real commits; writes runs/cache/map-stats.json
.PHONY: test-slow
test-slow:
	@poetry run pytest tests/slow -m slow -v -s

# Evals (chunk 04). CASES=ally-be or CASES=bug or CASES=<id>; AGENT=baseline or module:Class
.PHONY: eval eval-mine eval-oracle
eval:
	@poetry run bug-hunter eval run $(if $(CASES),--cases $(CASES)) --agent $(or $(AGENT),baseline) --mode $(or $(MODE),issue)

eval-mine:
	@poetry run bug-hunter eval mine

eval-oracle:
	@poetry run bug-hunter eval run --oracle-check $(if $(CASES),--cases $(CASES))

.PHONY: check
check:
	@poetry run bug-hunter config check

# Local Postgres for checkpoints (compose.yaml). Data lives in the bughunter-pg-data volume.
.PHONY: db-up db-down
db-up:
	@docker compose -f compose.yaml up -d --wait
db-down:
	@docker compose -f compose.yaml down
