# Outer container for the Coder workspace: NOT the dev environment, just the shell
# that runs the Coder agent and its own Docker daemon, which builds the target repo's
# Dev Container. Keep minimal.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl git gnupg sudo \
        docker.io \
        nodejs npm \
    && npm install -g @devcontainers/cli \
    && rm -rf /var/lib/apt/lists/*

# NVIDIA runtime for the inner daemon, so Dev Containers can use --gpus.
RUN curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
        | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg \
    && curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
        | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
        > /etc/apt/sources.list.d/nvidia-container-toolkit.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nvidia-container-toolkit \
    && nvidia-ctk runtime configure --runtime=docker \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN useradd -m -s /bin/bash -G sudo,docker coder \
    && echo "coder ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/coder

USER coder
WORKDIR /home/coder
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
