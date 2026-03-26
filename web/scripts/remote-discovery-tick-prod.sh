#!/bin/bash
set -eu
cd /opt/agent-tim
DC="docker compose --env-file web/.env.local -f docker-compose.yml"
echo "=== GET discovery-tick (from web container) ==="
$DC exec -T web sh -c 'K=$(printenv INTERNAL_API_KEY) && wget -qO /tmp/wf.json --header="x-internal-key: $K" "http://127.0.0.1:3001/api/crm/warm-outreach/discovery-tick" && cat /tmp/wf.json'
echo ""
echo "=== POST force spawn ==="
$DC exec -T web sh -c 'K=$(printenv INTERNAL_API_KEY) && WF=$(node -e "const j=JSON.parse(require(\"fs\").readFileSync(\"/tmp/wf.json\",\"utf8\")); process.stdout.write((j.workflows&&j.workflows[0]&&j.workflows[0].workflowId)||\"\")") && test -n "$WF" && wget -qO- --header="x-internal-key: $K" --header="Content-Type: application/json" --post-data="{\"spawnWorkflowId\":\"$WF\",\"force\":true}" "http://127.0.0.1:3001/api/crm/warm-outreach/discovery-tick" && echo'
