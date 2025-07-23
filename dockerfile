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

# Command to run the application
# This uses 'sh -c' to execute multiple commands:
# 1. Starts uvicorn in the background (&)
# 2. Starts the worker in the background (&)
# 3. 'wait -n' waits for any background process to exit, ensuring the container stays alive
#    as long as at least one of the main processes (uvicorn or worker) is running.
CMD ["bash", "-c", "poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 & poetry run python -m app.worker start  & wait -n"]