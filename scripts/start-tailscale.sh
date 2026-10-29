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
if tailscale_status="$(tailscale status --json)"; then
  if ! tailscale_dns_name="$(printf '%s' "$tailscale_status" | bun -e 'const status = JSON.parse(await new Response(Bun.stdin.stream()).text()); process.stdout.write(status.Self?.DNSName ?? "");')"; then
    tailscale_dns_name=""
  fi
else
  tailscale_dns_name=""
fi
if [[ -z "$tailscale_dns_name" ]]; then
  printf 'Tailscale DNS name unavailable; the server will accept the node IP only.\n' >&2
  tailscale_allowed_hosts="$tailscale_ip"
else
  tailscale_allowed_hosts="$tailscale_ip,$tailscale_dns_name"
fi
export KEYDO_TAILSCALE_HOSTS="$tailscale_allowed_hosts"

# --https: Tailscale Serve terminates HTTPS on the tailnet and proxies to Keydo on
# loopback, so the browser gets a secure origin (needed to install Keydo as an app).
# One-time setup: tailscale serve --bg --https=7710 http://127.0.0.1:7710
if [[ "${1:-}" == "--https" ]]; then
  if [[ -z "$tailscale_dns_name" ]]; then
    printf 'HTTPS mode needs the Tailscale DNS name, which is unavailable.\n' >&2
    exit 1
  fi
  export HOST=127.0.0.1
  export KEYDO_TRUST_TAILSCALE_SERVE=true
fi
exec bun src/server.ts
