#!/usr/bin/env bash
# Forward local Postgres port to CRM Postgres on the Command Central droplet.
# Leave this running while using Docker dev: web/.env.local needs CRM_DB_PASSWORD and CRM_DB_PORT (default 5433).
#
# Optional env:
#   CRM_TUNNEL_LOCAL_PORT  default 5433
#   CRM_SSH_HOST           default 137.184.187.233
#   CRM_SSH_USER           default root
#   SSH_IDENTITY_FILE      explicit key (else tries ~/.ssh/hetzner_ed25519, id_ed25519, id_rsa)

set -euo pipefail
LOCAL_PORT="${CRM_TUNNEL_LOCAL_PORT:-5433}"
REMOTE_HOST="${CRM_SSH_HOST:-137.184.187.233}"
REMOTE_USER="${CRM_SSH_USER:-root}"

IDENTITY="${SSH_IDENTITY_FILE:-}"
if [[ -z "$IDENTITY" || ! -f "$IDENTITY" ]]; then
  for name in hetzner_ed25519 id_ed25519 id_rsa; do
    p="${HOME}/.ssh/${name}"
    if [[ -f "$p" ]]; then
      IDENTITY="$p"
      break
    fi
  done
fi

SSH_OPTS=(-N -L "${LOCAL_PORT}:localhost:5432" "${REMOTE_USER}@${REMOTE_HOST}")
if [[ -n "${IDENTITY}" ]]; then
  SSH_OPTS=(-i "$IDENTITY" "${SSH_OPTS[@]}")
fi

echo "CRM DB tunnel: 127.0.0.1:${LOCAL_PORT} -> ${REMOTE_HOST}:5432 (Postgres on server)"
echo "Keep this terminal open. In web/.env.local: CRM_DB_PORT=${LOCAL_PORT}  (+ CRM_DB_PASSWORD)"
if [[ -n "${IDENTITY}" ]]; then
  echo "SSH identity: $IDENTITY"
else
  echo "SSH identity: (none — default ssh config / agent)"
fi
echo ""
exec ssh "${SSH_OPTS[@]}"
