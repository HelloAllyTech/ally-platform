FROM python:3.12-slim

WORKDIR /app

# Install Poetry
RUN pip install poetry==2.1.2

# Copy poetry configuration files
COPY pyproject.toml poetry.lock* /app/

# Configure poetry to not use virtualenvs
RUN poetry config virtualenvs.create false

# Install dependencies
RUN poetry install --no-interaction --no-ansi --no-dev

# Copy application code
COPY . /app/

# Expose port
EXPOSE 8000

# Command to run the application
CMD ["poetry", "run", "uvicorn", "ally_learn_core.main:app", "--host", "0.0.0.0", "--port", "8000"]
