# Makefile for Ally Learn Core Application

.PHONY: migrate run migrate-and-run

# Run database migrations
migrate:
	@echo "Running database migrations..."
	poetry run alembic upgrade head

# Start the application services
run:
	@echo "Starting application services..."
	poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
	poetry run python -m app.worker start &
	wait

# Run migrations then start services
migrate-and-run: migrate run
	@echo "Migration and services completed."
