# ally-be test image: mirrors test-ally-be.yml (Node 24) plus the native-module build
# deps from ally-be/Dockerfile.dev (bcrypt needs python3/make/g++).
FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git python3 make g++ ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV CI=true NODE_OPTIONS=--max-old-space-size=4096
WORKDIR /work
