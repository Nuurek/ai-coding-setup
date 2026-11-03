FROM mcr.microsoft.com/devcontainers/base:ubuntu24.04

COPY --from=oven/bun:1.3 /usr/local/bin/bun /usr/local/bin/

USER root

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        shellcheck \
    && mkdir -p \
        /home/vscode/.claude \
        /home/vscode/.cache/qmd/models \
    && chown -R vscode:vscode /home/vscode \
    && rm -rf /var/lib/apt/lists/*

USER vscode

ENV PATH="/home/vscode/.local/bin:${PATH}"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN curl -fsSL https://claude.ai/install.sh | bash -s stable \
    && claude --version
