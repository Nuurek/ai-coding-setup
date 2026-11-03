# Coder template: Docker workspace that builds any repo's Dev Container, with GPU.
#
# The workspace is a thin outer container (Coder agent + Docker CLI +
# @devcontainers/cli) that mounts the host Docker socket, so the target repo's
# ./.devcontainer is built as a *sibling* container on the host (not DinD) — which
# is what lets `--gpus all` reach the GPU. Sibling bind-mount sources are resolved
# by the host daemon, so the repo lives on a host bind mount at a path identical on
# the host and in the outer container (workspace_root below). /home/coder is a
# separate persistent volume for tool state across idle autostop/restart.

terraform {
  required_providers {
    coder  = { source = "coder/coder", version = "2.18.0" }
    docker = { source = "kreuzwerker/docker", version = "4.5.0" }
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

data "coder_parameter" "repo_urls" {
  name         = "repo_urls"
  display_name = "Repositories"
  description  = "Git URLs to clone. Only the first is used for now; its .devcontainer is built."
  type         = "list(string)"
  form_type    = "tag-select"
  # No default, so creating a workspace asks for it. Coder allows no regex
  # validation on list types; an empty list is handled in the startup script.
  mutable = true
}

locals {
  # Multi-repo is future-proofing: only the first URL is cloned and built today.
  # try(): template import plans with value "" (no default).
  repo_urls = try(jsondecode(data.coder_parameter.repo_urls.value), [])
  repo_url  = try(local.repo_urls[0], "")
  repo_name = trimsuffix(basename(local.repo_url), ".git")
  home      = "/home/coder"
  # Repo tree on a host bind mount at a path identical on host and in the outer
  # container, so the sibling Dev Container's bind-mount source resolves.
  workspace_root = "/var/lib/coder/workspaces/${data.coder_workspace.me.id}"
  repo_folder    = "${local.workspace_root}/${local.repo_name}"

  git_name  = coalesce(data.coder_workspace_owner.me.full_name, data.coder_workspace_owner.me.name)
  git_email = data.coder_workspace_owner.me.email
  git_env = {
    GIT_AUTHOR_NAME     = local.git_name
    GIT_AUTHOR_EMAIL    = local.git_email
    GIT_COMMITTER_NAME  = local.git_name
    GIT_COMMITTER_EMAIL = local.git_email
  }
}

resource "coder_agent" "main" {
  arch = data.coder_provisioner.me.arch
  os   = "linux"
  env  = local.git_env
  startup_script = templatefile("${path.module}/scripts/startup.sh.tftpl", {
    repo_url       = local.repo_url
    repo_folder    = local.repo_folder
    workspace_root = local.workspace_root
    ignored_urls   = slice(local.repo_urls, min(1, length(local.repo_urls)), length(local.repo_urls))
  })

  metadata {
    display_name = "GPU"
    key          = "gpu"
    script       = file("${path.module}/scripts/gpu-metadata.sh")
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
  count            = local.repo_url == "" ? 0 : data.coder_workspace.me.start_count
  agent_id         = coder_agent.main.id
  workspace_folder = local.repo_folder
}

# The Dev Container runs its own sub-agent, which doesn't inherit coder_agent.main's env.
resource "coder_env" "devcontainer_git" {
  for_each = length(coder_devcontainer.project) > 0 ? local.git_env : {}
  agent_id = coder_devcontainer.project[0].subagent_id
  name     = each.key
  value    = each.value
}

resource "coder_script" "devcontainer_gh" {
  count        = length(coder_devcontainer.project)
  agent_id     = coder_devcontainer.project[0].subagent_id
  display_name = "gh auth"
  script       = file("${path.module}/scripts/gh-wrapper.sh")
  run_on_start = true
}

resource "docker_volume" "home" {
  name = "coder-${data.coder_workspace.me.id}-home"
  lifecycle {
    ignore_changes = all
  }
}

# Outer image: Coder agent runtime + Docker CLI + Node + @devcontainers/cli.
# Shared across workspaces (same tag), so deleting one workspace must not remove it.
resource "docker_image" "outer" {
  name         = "coder-devcontainer-outer:latest"
  keep_locally = true
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
