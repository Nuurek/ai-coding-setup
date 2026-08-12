# Coder template: Docker workspace that builds any repo's Dev Container, with GPU.
#
# The workspace is a thin outer container (Coder agent + Docker CLI +
# @devcontainers/cli) that mounts the host Docker socket, so the target repo's
# ./.devcontainer is built as a *sibling* container on the host (not DinD) — which
# is what lets `--gpus all` reach the GPU. Sibling bind-mount sources are resolved
# by the host daemon, so the repo lives on a host bind mount at a path identical on
# the host and in the outer container (workspace_root below). /home/coder is a
# separate persistent volume for tool state across idle autostop/restart.
#
# Not CI-validated: run `terraform init && terraform validate` and a test
# `coder templates push`, and pin provider versions to your Coder server.

terraform {
  required_providers {
    coder  = { source = "coder/coder" }
    docker = { source = "kreuzwerker/docker" }
  }
}

data "coder_provisioner" "me" {}
data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

provider "docker" {}

# GitHub credentials for cloning private repos. Configure a "github" external auth
# provider on the server (CODER_EXTERNAL_AUTH_0_*); Coder then installs a git
# credential helper in the agent.
data "coder_external_auth" "github" {
  id = "github"
}

data "coder_parameter" "repo_url" {
  name         = "repo_url"
  display_name = "Repository"
  description  = "Git URL to clone; its .devcontainer is built."
  mutable      = true
}

locals {
  repo_name   = trimsuffix(basename(data.coder_parameter.repo_url.value), ".git")
  home        = "/home/coder"
  # Repo tree on a host bind mount at a path identical on host and in the outer
  # container, so the sibling Dev Container's bind-mount source resolves.
  workspace_root = "/var/lib/coder/workspaces/${data.coder_workspace.me.id}"
  repo_folder    = "${local.workspace_root}/${local.repo_name}"
}

resource "coder_agent" "main" {
  arch           = data.coder_provisioner.me.arch
  os             = "linux"
  startup_script = <<-EOT
    set -eux
    # Docker creates the bind-mount dir as root; take ownership before cloning.
    sudo mkdir -p "${local.repo_folder}"
    sudo chown -R coder:coder "${local.workspace_root}"
    if [ ! -d "${local.repo_folder}/.git" ]; then
      git clone "${data.coder_parameter.repo_url.value}" "${local.repo_folder}"
    else
      # Pull so devcontainer changes on the default branch land on restart.
      git -C "${local.repo_folder}" pull --ff-only || true
    fi
  EOT

  metadata {
    display_name = "GPU"
    key          = "gpu"
    script       = "nvidia-smi --query-gpu=name,utilization.gpu,memory.used --format=csv,noheader || echo 'no GPU'"
    interval     = 30
    timeout      = 5
  }
  metadata {
    display_name = "CPU"
    key          = "cpu"
    script       = "coder stat cpu"
    interval     = 10
    timeout      = 1
  }
  metadata {
    display_name = "Memory"
    key          = "mem"
    script       = "coder stat mem"
    interval     = 10
    timeout      = 1
  }
}

# Coder's native Dev Containers integration builds ${local.repo_folder}/.devcontainer.
resource "coder_devcontainer" "project" {
  count            = data.coder_workspace.me.start_count
  agent_id         = coder_agent.main.id
  workspace_folder = local.repo_folder
}

resource "docker_volume" "home" {
  name = "coder-${data.coder_workspace.me.id}-home"
  lifecycle {
    ignore_changes = all
  }
}

# Outer image: Coder agent runtime + Docker CLI + Node + @devcontainers/cli.
resource "docker_image" "outer" {
  name = "coder-devcontainer-outer:latest"
  build {
    context    = path.module
    dockerfile = "outer.Dockerfile"
  }
  triggers = {
    dockerfile = filesha1("${path.module}/outer.Dockerfile")
  }
}

resource "docker_container" "workspace" {
  count = data.coder_workspace.me.start_count
  image = docker_image.outer.image_id
  name  = "coder-${data.coder_workspace_owner.me.name}-${data.coder_workspace.me.name}"

  # Requires the NVIDIA Container Toolkit on the host.
  gpus = "all"

  entrypoint = ["sh", "-c", replace(coder_agent.main.init_script, "/localhost|127\\.0\\.0\\.1/", "host.docker.internal")]
  env        = ["CODER_AGENT_TOKEN=${coder_agent.main.token}"]
  host {
    host = "host.docker.internal"
    ip   = "host-gateway"
  }

  group_add = [tostring(var.docker_gid)]

  # Host Docker socket -> Dev Containers run as host siblings (so GPU passes through).
  volumes {
    host_path      = "/var/run/docker.sock"
    container_path = "/var/run/docker.sock"
  }
  # Repo tree on a host bind mount at an identical path on both sides, so the
  # sibling Dev Container's bind-mount source exists for the host daemon.
  volumes {
    host_path      = local.workspace_root
    container_path = local.workspace_root
    read_only      = false
  }
  # Persistent home across autostop/restart.
  volumes {
    volume_name    = docker_volume.home.name
    container_path = local.home
    read_only      = false
  }
}
