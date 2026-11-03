#!/usr/bin/env bash
# Agent metadata: GPU name, utilization and memory, or "no GPU" without one.
nvidia-smi --query-gpu=name,utilization.gpu,memory.used --format=csv,noheader || echo 'no GPU'
