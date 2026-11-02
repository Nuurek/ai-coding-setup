# Outer container for the Coder workspace: NOT the dev environment, just the shell
# that runs the Coder agent and drives the host Docker socket to build the target
# repo's Dev Container. Keep minimal.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl git sudo \
        docker.io \
        nodejs npm \
    && npm install -g @devcontainers/cli \
    && rm -rf /var/lib/apt/lists/*

# Non-root user in the docker group so it can reach the mounted host socket.
RUN useradd -m -s /bin/bash -G sudo,docker coder \
    && echo "coder ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/coder

USER coder
WORKDIR /home/coder
