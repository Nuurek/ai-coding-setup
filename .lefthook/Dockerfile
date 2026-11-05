# Lint image for the lefthook hooks, shared by git hooks and CI (see run.sh).
FROM node:22-slim

ARG BIOME_VERSION
ARG LEFTHOOK_VERSION=2.2.2

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=koalaman/shellcheck:v0.11.0 /bin/shellcheck /usr/local/bin/
COPY --from=hashicorp/terraform:1.17.1 /bin/terraform /usr/local/bin/

RUN npm install -g --ignore-scripts "@biomejs/biome@${BIOME_VERSION}" "lefthook@${LEFTHOOK_VERSION}"
