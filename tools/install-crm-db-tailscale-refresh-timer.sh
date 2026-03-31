#!/usr/bin/env bash
# One-time on the Command Central droplet: systemd timer re-runs expose-crm-db-tailscale.sh
# after boot and every 6h so tailnet :5432 comes back even if someone ran plain docker compose.
#
#   sudo bash /opt/agent-tim/tools/install-crm-db-tailscale-refresh-timer.sh
#
set -euo pipefail
ROOT="${ROOT:-/opt/agent-tim}"
if [[ ! -d "$ROOT/tools/systemd" ]]; then
  echo "ERROR: Expected $ROOT/tools/systemd (clone/pull repo first)." >&2
  exit 1
fi
install -m 0644 "$ROOT/tools/systemd/crm-db-tailscale-refresh.service" /etc/systemd/system/
install -m 0644 "$ROOT/tools/systemd/crm-db-tailscale-refresh.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now crm-db-tailscale-refresh.timer
echo "OK: timer enabled — status: systemctl status crm-db-tailscale-refresh.timer"
echo "    logs: journalctl -u crm-db-tailscale-refresh.service -n 20 --no-pager"
