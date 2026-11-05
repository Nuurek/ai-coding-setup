# Coder template: Docker workspace that builds any repo's Dev Container, with GPU.
#
# The workspace is a thin, privileged outer container (Coder agent, its own Docker
# daemon, @devcontainers/cli) that builds the target repo's ./.devcontainer inside it
# (Docker-in-Docker), so each workspace only sees and owns its own Dev Containers.
# The GPU is passed to the outer container and on to the Dev Container through the
# NVIDIA runtime. /home/coder (repo, tool state) and /var/lib/docker (images, Dev
# Containers, their volumes) are per-workspace volumes, removed with the workspace;
# /shared is one volume for all workspaces.

terraform {
  required_version = "~> 1.17"
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
  repo_urls   = try(jsondecode(data.coder_parameter.repo_urls.value), [])
  repo_url    = try(local.repo_urls[0], "")
  repo_name   = trimsuffix(basename(local.repo_url), ".git")
  home        = "/home/coder"
  repo_folder = "${local.home}/${local.repo_name}"

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
    repo_url     = local.repo_url
    repo_folder  = local.repo_folder
    ignored_urls = slice(local.repo_urls, min(1, length(local.repo_urls)), length(local.repo_urls))
  })

  # VS Code belongs on the Dev Container's agent; the outer container has no dev tooling.
  display_apps {
    vscode          = false
    vscode_insiders = false
  }

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
resource "coder_script" "devcontainer_git" {
  count        = length(coder_devcontainer.project)
  agent_id     = coder_devcontainer.project[0].subagent_id
  display_name = "git identity"
  script = templatefile("${path.module}/scripts/git-identity.sh.tftpl", {
    name  = local.git_name
    email = local.git_email
  })
  run_on_start = true
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

# The inner daemon's storage. Must be a volume: overlayfs can't run on the container's
# own overlay root.
resource "docker_volume" "docker" {
  name = "coder-${data.coder_workspace.me.id}-docker"
  lifecycle {
    ignore_changes = all
  }
}

# Outer image: Docker, NVIDIA Container Toolkit, Node, @devcontainers/cli.
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
    entrypoint = filesha1("${path.module}/scripts/entrypoint.sh")
  }
}

resource "docker_container" "workspace" {
  count = data.coder_workspace.me.start_count
  image = docker_image.outer.image_id
  name  = "coder-${data.coder_workspace_owner.me.name}-${data.coder_workspace.me.name}"

  # Requires the NVIDIA Container Toolkit on the host.
  gpus = "all"
  # Needed by the inner Docker daemon.
  privileged = true

  command = [replace(coder_agent.main.init_script, "/localhost|127\\.0\\.0\\.1/", "host.docker.internal")]
  env     = ["CODER_AGENT_TOKEN=${coder_agent.main.token}"]
  host {
    host = "host.docker.internal"
    ip   = "host-gateway"
  }

  # Persistent home across autostop/restart.
  volumes {
    volume_name    = docker_volume.home.name
    container_path = local.home
    read_only      = false
  }
  volumes {
    volume_name    = docker_volume.docker.name
    container_path = "/var/lib/docker"
    read_only      = false
  }
  # Shared by all workspaces and kept when one is deleted (not managed by Terraform).
  # Dev Containers bind-mount folders under /shared for state that should outlive a
  # workspace, like ~/.claude.
  volumes {
    volume_name    = "coder-shared"
    container_path = "/shared"
    read_only      = false
  }
}
