# Use the official Python 3.12 slim image as the base image
FROM python:3.12-slim

# Prevent Python from writing .pyc files to disk and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install system dependencies and tools needed for building Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    ffmpeg \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Poetry from PyPI, pinned. Its installer script (install.python-poetry.org)
# started answering NOT_FOUND, which failed every image build.
RUN pip install --no-cache-dir "poetry==2.5.1"

# Set the working directory in the container
WORKDIR /app

# Copy dependency definition files to leverage Docker layer caching
COPY pyproject.toml poetry.lock* /app/

# Install only the production dependencies (adjust flags as needed)
RUN poetry install --no-root --only main

# The tokenizer LangChain's OpenAIEmbeddings loads on first use (tiktoken cl100k_base, 1.7 MB).
# Fetched here, at build time: otherwise every new container downloads it into /tmp on the first
# question it searches for, which took 4-18 s and could push that run past the agent's 20 s cap.
ENV TIKTOKEN_CACHE_DIR=/app/.tiktoken-cache
RUN poetry run python -c "import tiktoken; tiktoken.get_encoding('cl100k_base')"

# Copy the entire application code to the container
COPY . .

# Expose the port on which the app will run
EXPOSE 8000

# Run migrations and sync prompts, then start the application and worker
CMD ["bash", "-c", "poetry run python scripts/migrate.py all && poetry run python scripts/sync_prompts.py && (poetry run python -m app.main & poetry run python -m app.core.queue.transcription_request_sqs_worker & wait -n)"]
