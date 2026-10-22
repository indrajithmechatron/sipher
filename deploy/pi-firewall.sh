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

ufw default deny incoming
ufw default allow outgoing

for net in "${LAN_V4[@]}"; do
  ufw allow from "$net" to any port 22 proto tcp
done

# Dashboard + command API
ufw allow 8888/tcp

ufw --force enable
ufw reload
systemctl enable --now ssh

echo "--- ssh ---"
systemctl is-active ssh
ss -ltn | grep -E ':22\b' || true
echo "--- ufw ---"
ufw status verbose
