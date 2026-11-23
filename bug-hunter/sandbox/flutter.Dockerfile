# ally-mobile test image: Flutter 3.47.7 stable, the version test-ally-mobile.yml pins.
# No public image ships 3.47.7, so the SDK is cloned at that tag, as the CI action does.
# Only `flutter test` / `flutter analyze` run here: no Android SDK, no iOS toolchain.
FROM ubuntu:22.04
ARG FLUTTER_VERSION=3.47.7
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl unzip xz-utils zip ca-certificates libglu1-mesa \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${FLUTTER_VERSION} https://github.com/flutter/flutter.git /opt/flutter
ENV PATH=/opt/flutter/bin:$PATH CI=true PUB_CACHE=/root/.pub-cache
RUN git config --global --add safe.directory /opt/flutter \
    && flutter config --no-analytics \
    && flutter --version \
    && flutter precache --universal
WORKDIR /work
