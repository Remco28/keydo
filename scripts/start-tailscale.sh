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
exec bun src/server.ts
