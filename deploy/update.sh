#!/bin/bash
# Sipher auto-deploy: git pull + restart services
# Runs as sipher user. Expects: git repo at /home/sipher/sipher
set -euo pipefail

REPO_DIR="/home/sipher/sipher"
BRANCH="main"
LOG="/home/sipher/deploy/pull.log"
RESTART_SERVICES=("sipher-bridge" "sipher-command-endpoint" "sipher-logger" "sipher-instincts" "sipher-voice")

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }

log "--- START ---"

if [ ! -d "$REPO_DIR/.git" ]; then
    log "ERROR: no git repo at $REPO_DIR"
    exit 1
fi

cd "$REPO_DIR"

# Fetch
git fetch origin "$BRANCH" 2>&1 | while read -r line; do log "fetch: $line"; done

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
    log "up to date ($(git rev-parse --short HEAD))"
    exit 0
fi

# Pull
if git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
    log "pulling..."
    git pull --ff-only origin "$BRANCH" 2>&1 | while read -r line; do log "pull: $line"; done
else
    # Local history is not an ancestor of origin (e.g. upstream was rewritten).
    # This box is a deploy target, so follow origin rather than merging.
    log "local history diverged from origin/$BRANCH - resetting to $REMOTE"
    git reset --hard "$REMOTE" 2>&1 | while read -r line; do log "reset: $line"; done
fi
NEW=$(git rev-parse --short HEAD)
log "deployed $NEW"

# Restart services that may have changed
for svc in "${RESTART_SERVICES[@]}"; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        log "restarting $svc"
        if sudo -n systemctl restart "$svc" 2>&1 | while read -r line; do log "svc[$svc]: $line"; done; then
            log "restarted $svc"
        else
            log "ERROR: restart failed: $svc"
        fi
    fi
done

log "--- DONE ---"
