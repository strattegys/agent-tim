#!/usr/bin/env bash
# Render a dotenv file from Bitwarden Secrets Manager (bws secret list … --output env).
# Usage:  export BWS_ACCESS_TOKEN='…'
#         ./scripts/bws-pull-env.sh <PROJECT_UUID> <output.env>
#
# Example:  ./scripts/bws-pull-env.sh '<uuid>' web/.env.local
# Requires: bws on PATH (https://bitwarden.com/help/secrets-manager-cli/)

set -euo pipefail
if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <PROJECT_UUID> <output.env>" >&2
  exit 1
fi
PROJECT_ID="$1"
OUT="$2"
TMP="${OUT}.tmp.$$"

if [[ -z "${BWS_ACCESS_TOKEN:-}" ]]; then
  echo "BWS_ACCESS_TOKEN is not set." >&2
  exit 1
fi

if ! command -v bws >/dev/null 2>&1; then
  echo "bws CLI not found on PATH. Install: https://bitwarden.com/help/secrets-manager-cli/" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
bws secret list "$PROJECT_ID" --output env >"$TMP"
mv -f "$TMP" "$OUT"
chmod 600 "$OUT" 2>/dev/null || true
echo "Wrote $OUT (from BWS project $PROJECT_ID)"
