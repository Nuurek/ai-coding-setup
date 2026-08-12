variable "docker_gid" {
  type        = number
  default     = 984
  description = "Host docker socket GID (stat -c '%g' /var/run/docker.sock)."
}