#!/bin/bash
# Idempotent firewall baseline for the Sipher Pi.
# Run as root after a re-image (or from first-boot provisioning):
#   sudo /home/sipher/sipher/deploy/pi-firewall.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "error: run as root (sudo $0)" >&2
  exit 1
fi

LAN_V4=("192.168.1.0/24" "192.168.137.0/24" "169.254.0.0/16")
# Tailscale hands out addresses from the CGNAT range.
TAILNET_V4="100.64.0.0/10"

ufw default deny incoming
ufw default allow outgoing

for net in "${LAN_V4[@]}"; do
  ufw allow from "$net" to any port 22 proto tcp
done

# Dashboard + command API: LAN and tailnet only. Never the public internet --
# /command and /api/rag/ingest are not safe to expose to arbitrary hosts.
ufw delete allow 8888/tcp >/dev/null 2>&1 || true   # drop any blanket rule from older runs
for net in "${LAN_V4[@]}"; do
  ufw allow from "$net" to any port 8888 proto tcp
done
ufw allow from "$TAILNET_V4" to any port 8888 proto tcp
# Also match on the interface, so the rule survives a changed tailnet range.
ufw allow in on tailscale0 to any port 8888 proto tcp \
  || echo "note: tailscale0 rule skipped (interface not present yet)"

ufw --force enable
ufw reload
systemctl enable --now ssh

echo "--- ssh ---"
systemctl is-active ssh
ss -ltn | grep -E ':22\b' || true
echo "--- ufw ---"
ufw status verbose
echo "--- 8888 scope ---"
if ufw status | grep -qE '^8888/tcp[[:space:]]+ALLOW[[:space:]]+Anywhere'; then
  echo "error: 8888 is open to Anywhere; remove that rule" >&2
  exit 1
fi
echo "8888 restricted to LAN + tailnet"
