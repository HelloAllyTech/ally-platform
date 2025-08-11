FROM python:3.12-slim

WORKDIR /app

# Install Poetry
RUN pip install poetry==2.1.2

# Copy poetry configuration files
COPY pyproject.toml poetry.lock* /app/

# Configure poetry to not use virtualenvs
RUN poetry config virtualenvs.create false

# Install dependencies
RUN poetry install --no-interaction --no-ansi

# Copy application code
COPY . /app/

# Run the download command to get all required files
# This runs after dependencies are installed and code is copied
RUN poetry run python -m app.worker download-files

# Expose port
EXPOSE 8000

# Command to run migrations and start the application
CMD ["make", "migrate-and-run"]