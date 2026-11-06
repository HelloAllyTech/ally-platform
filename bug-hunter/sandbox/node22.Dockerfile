# ally-web test image: mirrors test-ally-web.yml (Node 22). ally-web/Dockerfile.deps still
# says node:20; CI is 22, so CI wins.
FROM node:22-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV CI=true NX_NO_CLOUD=true NX_DAEMON=false
WORKDIR /work
