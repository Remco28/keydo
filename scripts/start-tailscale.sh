#!/usr/bin/env bash
set -euo pipefail

if ! tailscale_ip="$(tailscale ip -4)"; then
  printf 'Unable to read the Tailscale IPv4 address. Is Tailscale installed and running?\n' >&2
  exit 1
fi
if [[ -z "$tailscale_ip" ]]; then
  printf 'Tailscale did not return an IPv4 address. Is Tailscale running?\n' >&2
  exit 1
fi
export HOST="$tailscale_ip"
exec bun src/server.ts
