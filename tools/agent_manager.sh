#!/bin/bash
# agent_manager.sh — Manages agents in Strattegys Command Central
# Used by Friday (Agent Architect) to create and manage other agents.
#
# Usage: agent_manager.sh <command> [arg1] [arg2]
#
# Commands:
#   list-agents                        — List all agents and their status
#   get-agent-config <agent_id>        — Read agent config details
#   read-prompt <agent_id>             — Read agent's system prompt
#   update-prompt <agent_id> <text>    — Update agent's system prompt (backs up old)
#   create-agent <agent_id> <text>     — Create new agent dirs + system prompt
#   restart-agent <agent_id>           — Restart agent's service
#   agent-status <agent_id>            — Check agent service status

set -euo pipefail

COMMAND="${1:-}"
ARG1="${2:-}"
ARG2="${3:-}"

# Map agent IDs to their directory names and service names
get_agent_dir() {
  local agent_id="$1"
  case "$agent_id" in
    tim)     echo "/root/.nanobot" ;;
    scout)   echo "/root/.scoutbot" ;;
    suzi)    echo "/root/.suzibot" ;;
    rainbow) echo "/root/.avabot" ;;
    friday)  echo "/root/.fridaybot" ;;
    *)       echo "/root/.${agent_id}bot" ;;
  esac
}

get_service_name() {
  local agent_id="$1"
  case "$agent_id" in
    tim)     echo "nanobot" ;;
    suzi)    echo "suzibot" ;;
    rainbow) echo "avabot" ;;
    *)       echo "" ;;  # No standalone service — runs through Slack gateway
  esac
}

# Known agent IDs
KNOWN_AGENTS="tim scout suzi rainbow friday"

# Safe write helper using Python for proper escaping
safe_write_file() {
  local filepath="$1"
  local content="$2"
  python3 -c "
import sys, os
filepath = sys.argv[1]
content = sys.stdin.read()
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print(f'Written {len(content)} chars to {filepath}')
" "$filepath" <<'PYEOF'
$content
PYEOF
}

case "$COMMAND" in

  list-agents)
    echo "=== Strattegys Command Central — Agent Registry ==="
    echo ""

    for agent_id in $KNOWN_AGENTS; do
      dir=$(get_agent_dir "$agent_id")
      service=$(get_service_name "$agent_id")

      echo "--- $agent_id ---"

      # Directory exists?
      if [ -d "$dir" ]; then
        echo "  Directory: $dir (exists)"
      else
        echo "  Directory: $dir (MISSING)"
      fi

      # System prompt exists?
      if [ -f "$dir/system-prompt.md" ]; then
        prompt_lines=$(wc -l < "$dir/system-prompt.md")
        echo "  System prompt: ${prompt_lines} lines"
      else
        echo "  System prompt: MISSING"
      fi

      # Sessions dir?
      if [ -d "$dir/sessions" ]; then
        session_count=$(find "$dir/sessions" -name "*.jsonl" 2>/dev/null | wc -l)
        echo "  Sessions: ${session_count} file(s)"
      else
        echo "  Sessions: no sessions dir"
      fi

      # Memory dir?
      if [ -d "$dir/memory" ]; then
        echo "  Memory: exists"
      else
        echo "  Memory: no memory dir"
      fi

      # Service status
      if [ -n "$service" ]; then
        if systemctl is-active --quiet "$service" 2>/dev/null; then
          echo "  Service: $service (running)"
        else
          echo "  Service: $service (stopped)"
        fi
      else
        echo "  Service: Slack gateway (shared)"
      fi

      echo ""
    done

    # Also check for any unknown agent dirs
    echo "--- Discovered directories ---"
    for d in /root/.*bot; do
      if [ -d "$d" ] && [ -f "$d/system-prompt.md" ]; then
        basename=$(basename "$d")
        # Check if it's a known agent
        is_known=false
        for agent_id in $KNOWN_AGENTS; do
          known_dir=$(get_agent_dir "$agent_id")
          if [ "$d" = "$known_dir" ]; then
            is_known=true
            break
          fi
        done
        if [ "$is_known" = "false" ]; then
          echo "  $d (unregistered — has system-prompt.md)"
        fi
      fi
    done
    ;;

  get-agent-config)
    if [ -z "$ARG1" ]; then
      echo "Error: agent_id required. Usage: get-agent-config <agent_id>"
      exit 1
    fi

    agent_id="$ARG1"
    dir=$(get_agent_dir "$agent_id")
    service=$(get_service_name "$agent_id")

    echo "=== Agent: $agent_id ==="

    if [ ! -d "$dir" ]; then
      echo "Directory $dir does not exist. Agent not provisioned."
      exit 0
    fi

    echo "Directory: $dir"

    # System prompt preview
    if [ -f "$dir/system-prompt.md" ]; then
      prompt_lines=$(wc -l < "$dir/system-prompt.md")
      echo "System prompt: ${prompt_lines} lines"
      echo ""
      echo "--- Prompt preview (first 20 lines) ---"
      head -20 "$dir/system-prompt.md"
      if [ "$prompt_lines" -gt 20 ]; then
        echo "... (${prompt_lines} lines total)"
      fi
    else
      echo "System prompt: MISSING"
    fi

    echo ""

    # Memory contents
    if [ -d "$dir/memory" ]; then
      echo "--- Memory ---"
      if [ -f "$dir/memory/MEMORY.md" ]; then
        cat "$dir/memory/MEMORY.md"
      else
        echo "(empty)"
      fi
    fi

    echo ""

    # Service status
    if [ -n "$service" ]; then
      echo "--- Service: $service ---"
      systemctl status "$service" --no-pager 2>&1 | head -10 || echo "(service not found)"
    else
      echo "Service: runs through Slack gateway (no standalone service)"
    fi
    ;;

  read-prompt)
    if [ -z "$ARG1" ]; then
      echo "Error: agent_id required. Usage: read-prompt <agent_id>"
      exit 1
    fi

    dir=$(get_agent_dir "$ARG1")
    prompt_file="$dir/system-prompt.md"

    if [ ! -f "$prompt_file" ]; then
      echo "Error: No system prompt found at $prompt_file"
      exit 1
    fi

    cat "$prompt_file"
    ;;

  update-prompt)
    if [ -z "$ARG1" ] || [ -z "$ARG2" ]; then
      echo "Error: agent_id and prompt text required. Usage: update-prompt <agent_id> <prompt_text>"
      exit 1
    fi

    agent_id="$ARG1"
    dir=$(get_agent_dir "$agent_id")
    prompt_file="$dir/system-prompt.md"

    if [ ! -d "$dir" ]; then
      echo "Error: Agent directory $dir does not exist. Create the agent first."
      exit 1
    fi

    # Backup existing prompt
    if [ -f "$prompt_file" ]; then
      backup="$prompt_file.bak.$(date +%Y%m%d_%H%M%S)"
      cp "$prompt_file" "$backup"
      echo "Backed up existing prompt to: $backup"
    fi

    # Write new prompt using Python for safe handling
    python3 -c "
import sys
filepath = sys.argv[1]
content = sys.argv[2]
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print(f'Updated system prompt ({len(content)} chars) at {filepath}')
" "$prompt_file" "$ARG2"
    ;;

  create-agent)
    if [ -z "$ARG1" ]; then
      echo "Error: agent_id required. Usage: create-agent <agent_id> [prompt_text]"
      exit 1
    fi

    agent_id="$ARG1"
    dir=$(get_agent_dir "$agent_id")

    if [ -d "$dir" ]; then
      echo "Warning: Directory $dir already exists. Checking contents..."
      if [ -f "$dir/system-prompt.md" ]; then
        echo "System prompt already exists. Use update-prompt to modify it."
        exit 1
      fi
    fi

    # Create directory structure
    mkdir -p "$dir/sessions" "$dir/memory"
    echo "Created directories:"
    echo "  $dir/"
    echo "  $dir/sessions/"
    echo "  $dir/memory/"

    # Write system prompt if provided
    if [ -n "$ARG2" ]; then
      python3 -c "
import sys
filepath = sys.argv[1]
content = sys.argv[2]
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print(f'Written system prompt ({len(content)} chars) to {filepath}')
" "$dir/system-prompt.md" "$ARG2"
    else
      echo "No system prompt provided. Create one with: update-prompt $agent_id <prompt_text>"
    fi

    echo ""
    echo "=== Agent '$agent_id' provisioned ==="
    echo ""
    echo "Next steps (manual):"
    echo "1. Register in codebase: add to agent-config.ts, config.ts, commands.ts"
    echo "2. Create Slack app at api.slack.com/apps (Socket Mode, add scopes, subscribe events)"
    echo "3. Add SLACK_${agent_id^^}_BOT_TOKEN and SLACK_${agent_id^^}_APP_TOKEN to server .env"
    echo "4. Push code + restart Slack gateway"
    ;;

  restart-agent)
    if [ -z "$ARG1" ]; then
      echo "Error: agent_id required. Usage: restart-agent <agent_id>"
      exit 1
    fi

    agent_id="$ARG1"
    service=$(get_service_name "$agent_id")

    if [ -n "$service" ]; then
      echo "Restarting systemd service: $service"
      systemctl restart "$service"
      sleep 2
      systemctl status "$service" --no-pager | head -10
    else
      # For Slack-gateway-only agents, restart the gateway
      echo "Agent '$agent_id' runs through the Slack gateway."
      echo "Restarting PM2 process: slack-gateway"
      pm2 restart slack-gateway 2>/dev/null || pm2 restart all 2>/dev/null || echo "Warning: could not restart PM2 process. May need manual restart."
      sleep 2
      pm2 status 2>/dev/null | head -10 || echo "(pm2 status unavailable)"
    fi
    ;;

  agent-status)
    if [ -z "$ARG1" ]; then
      echo "Error: agent_id required. Usage: agent-status <agent_id>"
      exit 1
    fi

    agent_id="$ARG1"
    dir=$(get_agent_dir "$agent_id")
    service=$(get_service_name "$agent_id")

    echo "=== Status: $agent_id ==="

    # Directory
    if [ -d "$dir" ]; then
      echo "Directory: $dir (exists)"
    else
      echo "Directory: $dir (MISSING — agent not provisioned)"
      exit 0
    fi

    # Prompt
    if [ -f "$dir/system-prompt.md" ]; then
      lines=$(wc -l < "$dir/system-prompt.md")
      echo "System prompt: $lines lines"
    else
      echo "System prompt: MISSING"
    fi

    # Sessions
    if [ -d "$dir/sessions" ]; then
      count=$(find "$dir/sessions" -name "*.jsonl" 2>/dev/null | wc -l)
      echo "Session files: $count"
    fi

    # Service
    if [ -n "$service" ]; then
      if systemctl is-active --quiet "$service" 2>/dev/null; then
        echo "Service: $service (RUNNING)"
        uptime=$(systemctl show "$service" --property=ActiveEnterTimestamp 2>/dev/null | cut -d= -f2)
        echo "  Since: $uptime"
      else
        echo "Service: $service (STOPPED)"
      fi
    else
      echo "Service: Slack gateway (shared process)"
    fi
    ;;

  *)
    echo "Unknown command: $COMMAND"
    echo ""
    echo "Usage: agent_manager.sh <command> [arg1] [arg2]"
    echo ""
    echo "Commands:"
    echo "  list-agents                     — List all agents and status"
    echo "  get-agent-config <agent_id>     — Read agent config details"
    echo "  read-prompt <agent_id>          — Read system prompt"
    echo "  update-prompt <agent_id> <text> — Update system prompt (backs up old)"
    echo "  create-agent <agent_id> [text]  — Create new agent dirs + prompt"
    echo "  restart-agent <agent_id>        — Restart agent service"
    echo "  agent-status <agent_id>         — Check service status"
    exit 1
    ;;
esac
