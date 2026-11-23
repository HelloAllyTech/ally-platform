# ally-ai / ally-ai-learn test image: Python 3.12 + Poetry as in test-ally-ai*.yml, plus
# ffmpeg and a compiler as in each app's Dockerfile.
FROM python:3.12-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ffmpeg build-essential ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir poetry
ENV CI=true POETRY_VIRTUALENVS_IN_PROJECT=true POETRY_NO_INTERACTION=1 PIP_NO_CACHE_DIR=1
WORKDIR /work
