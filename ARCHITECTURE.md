# NanoClaw Architecture

Technical architecture documentation for the NanoClaw deployment.

## System Overview

NanoClaw is a lightweight AI agent framework that runs AI assistants in isolated Docker containers with multi-channel messaging support.

## Component Architecture

### 1. Main Process (Node.js)

**Location**: `/opt/nanoclaw/dist/index.js`

**Responsibilities**:
- Message orchestration and routing
- Channel management (Telegram, WhatsApp, Discord, etc.)
- Database operations (SQLite)
- Container lifecycle management
- Credential proxy server
- IPC (Inter-Process Communication) handling

**Key Files**:
- `src/index.ts` - Main orchestrator
- `src/db.ts` - SQLite database operations
- `src/config.ts` - Configuration management
- `src/credential-proxy.ts` - API key proxy server

### 2. Channel Handlers

**Location**: `/opt/nanoclaw/src/channels/`

**Telegram Channel** (`telegram.ts`):
- Connects to Telegram Bot API using `grammy` library
- Receives messages via long polling
- Sends responses back to Telegram
- Handles commands like `/chatid`
- Self-registers via `registerChannel()` function

**Channel Registry** (`registry.ts`):
- Dynamic channel registration system
- Channels auto-register when their credentials are present
- Factory pattern for channel instantiation

### 3. Docker Container Runtime

**Image**: `nanoclaw-agent:latest`

**Base**: Debian 12 with Chromium (for web browsing capabilities)

**Container Lifecycle**:
1. Main process receives message
2. Spawns isolated container with mounted volumes
3. Container runs agent-runner code
4. Agent executes using Claude Code SDK
5. Results streamed back to main process
6. Container kept alive for follow-up messages (30min idle timeout)
7. Container destroyed when conversation ends or timeout

**Security Features**:
- Runs as non-root user (`node`)
- Project files mounted read-only
- No direct API key access (proxied)
- Isolated filesystem per conversation
- Network access controlled

### 4. Agent Runner

**Location**: `/opt/nanoclaw/container/agent-runner/`

**Technology**: TypeScript, Claude Code SDK (`@anthropic-ai/claude-code`)

**Responsibilities**:
- Execute AI queries using Claude Code SDK
- Handle streaming responses
- Manage conversation sessions
- Process IPC messages during execution
- Provide tools (Bash, Read, Write, Edit, WebSearch, etc.)

**Key Files**:
- `src/index.ts` - Main agent runner
- `src/ipc-mcp-stdio.ts` - MCP server for IPC communication

### 5. Credential Proxy

**Port**: 3001 (internal only)

**Purpose**: 
- Intercept Anthropic API calls from containers
- Inject real API key (never exposed to containers)
- Containers use placeholder key + proxy URL
- Prevents API key leakage in container logs/memory

**Environment in Container**:
```bash
ANTHROPIC_BASE_URL=http://host.docker.internal:3001
ANTHROPIC_API_KEY=placeholder
```

### 6. Database (SQLite)

**Location**: `/opt/nanoclaw/store/`

**Schema**:
- **Groups**: Registered chats/conversations
  - `jid` (Jabber ID, e.g., `tg:123456789`)
  - `name` (display name)
  - `folder` (data directory)
  - `channel` (telegram, whatsapp, etc.)
  - `trigger` (activation pattern)
  - `requiresTrigger` (boolean)
  - `isMain` (boolean)
  
- **Messages**: Message history
  - `groupJid`
  - `sender`
  - `text`
  - `timestamp`
  - `messageId`

- **Sessions**: Conversation sessions
  - `groupJid`
  - `sessionId` (Claude Code session ID)
  - `lastActivity`

### 7. File System Structure

```
/opt/nanoclaw/
├── groups/                      # Per-group conversation data
│   └── telegram_main/
│       ├── CLAUDE.md           # Group-specific instructions
│       ├── logs/               # Container execution logs
│       └── [user files]        # Files created by agent
│
├── data/
│   ├── env/
│   │   └── env                 # Environment vars for containers
│   ├── sessions/
│   │   └── telegram_main/
│   │       ├── .claude/        # Claude Code session data
│   │       └── agent-runner-src/  # Custom agent code (if any)
│   └── ipc/
│       └── telegram_main/
│           ├── messages/       # IPC message queue
│           ├── tasks/          # Scheduled tasks
│           └── input/          # Runtime input
│
├── store/
│   └── nanoclaw.db            # SQLite database
│
└── logs/
    └── setup.log              # Setup/registration logs
```

## Message Flow

### Inbound Message (Telegram → Agent)

```
1. Telegram Bot API
   ↓ (webhook/polling)
2. Telegram Channel Handler (telegram.ts)
   ↓ (store message)
3. SQLite Database
   ↓ (queue message)
4. Main Orchestrator (index.ts)
   ↓ (spawn container)
5. Docker Container
   ↓ (run agent)
6. Agent Runner (container/agent-runner)
   ↓ (query Claude)
7. Credential Proxy → Anthropic API
   ↓ (stream response)
8. Agent Runner
   ↓ (return result)
9. Main Orchestrator
   ↓ (send message)
10. Telegram Channel Handler
    ↓ (API call)
11. Telegram Bot API
    ↓
12. User receives message
```

### Container Execution Flow

```
┌─────────────────────────────────────┐
│  Main Process (host)                │
│                                     │
│  1. Receive message                 │
│  2. Create container input JSON     │
│  3. docker run -i nanoclaw-agent    │
└──────────────┬──────────────────────┘
               │ (stdin: JSON input)
               ▼
┌─────────────────────────────────────┐
│  Container (isolated)               │
│                                     │
│  1. Read JSON from stdin            │
│  2. Initialize Claude Code SDK      │
│  3. Load conversation session       │
│  4. Execute query with tools        │
│  5. Stream results to stdout        │
│  6. Wait for IPC messages           │
│  7. Handle follow-up queries        │
│  8. Exit on _close sentinel         │
└──────────────┬──────────────────────┘
               │ (stdout: JSON results)
               ▼
┌─────────────────────────────────────┐
│  Main Process (host)                │
│                                     │
│  1. Parse result JSON               │
│  2. Send to channel                 │
│  3. Update session ID               │
│  4. Keep container alive (30min)    │
└─────────────────────────────────────┘
```

## Security Model

### Container Isolation

**Process Isolation**:
- Each conversation runs in separate container
- No shared memory between containers
- Process namespace isolation

**Filesystem Isolation**:
- Project root mounted read-only
- Group folder mounted read-write (isolated per group)
- No access to other groups' data
- Temporary files in ephemeral container storage

**Network Isolation**:
- Containers can access internet (for web search, etc.)
- No direct access to host network
- API calls proxied through credential proxy

**User Isolation**:
- Containers run as `node` user (UID 1000)
- Not root inside container
- Limited privileges

### Credential Security

**API Key Protection**:
- Real API key only in host `.env` file
- Never passed to containers
- Credential proxy injects key at request time
- Containers use placeholder + proxy URL

**Token Security**:
- Telegram bot token only in host `.env`
- Not accessible from containers
- Channel handlers run in main process (trusted)

### Mount Security

**Allowlist System**:
- External mounts require explicit allowlist
- Default blocked patterns (e.g., `/etc`, `/root`)
- Project root always read-only
- Group folder scoped to specific group

## Performance Characteristics

### Resource Usage

**Main Process**:
- Memory: ~100-120 MB
- CPU: Low (event-driven)
- Disk I/O: Minimal (SQLite operations)

**Per Container**:
- Memory: ~200-500 MB (varies with conversation length)
- CPU: Medium during query execution
- Disk I/O: Moderate (file operations)

**Recommended Droplet**:
- 2GB RAM: 2-3 concurrent conversations
- 4GB RAM: 5-8 concurrent conversations
- 8GB RAM: 10+ concurrent conversations

### Latency

**Message Processing**:
- Telegram receive: <1 second
- Container spawn: 1-3 seconds (first message)
- Container reuse: <500ms (follow-up messages)
- Claude API: 2-10 seconds (varies with complexity)
- Response send: <1 second

**Total Response Time**:
- First message: 5-15 seconds
- Follow-up messages: 3-12 seconds

### Scalability

**Concurrent Conversations**:
- Configurable via `MAX_CONCURRENT_CONTAINERS`
- Default: 5 concurrent containers
- Queue system for overflow

**Message Queue**:
- Per-group message queue
- FIFO processing
- Automatic retry with exponential backoff

## Configuration

### Environment Variables

**Required**:
- `ANTHROPIC_API_KEY` - Anthropic API key
- `ASSISTANT_NAME` - Bot's name (e.g., "Tim")
- `TELEGRAM_BOT_TOKEN` - Telegram bot token

**Optional**:
- `CONTAINER_IMAGE` - Docker image name (default: `nanoclaw-agent:latest`)
- `CONTAINER_TIMEOUT` - Max container runtime in ms (default: 1800000 = 30min)
- `CREDENTIAL_PROXY_PORT` - Proxy port (default: 3001)
- `MAX_CONCURRENT_CONTAINERS` - Max concurrent containers (default: 5)
- `IDLE_TIMEOUT` - Container idle timeout in ms (default: 1800000 = 30min)
- `TZ` - Timezone for scheduled tasks (default: system timezone)

### Runtime Configuration

**Trigger Pattern**:
- Regex: `^@{ASSISTANT_NAME}\b` (case-insensitive)
- Main chat: No trigger required (`requiresTrigger: false`)
- Other chats: Require trigger unless configured otherwise

**Conversation Persistence**:
- Session IDs stored in database
- Conversation history in Claude Code session
- Resume from last message on container restart

## Monitoring and Observability

### Logging

**Systemd Journal**:
```bash
journalctl -u nanoclaw -f
```

**Log Levels**:
- INFO: Normal operations
- WARN: Recoverable errors
- ERROR: Failures requiring attention
- FATAL: Critical failures

**Key Log Events**:
- Channel connections/disconnections
- Message received/sent
- Container spawn/exit
- API errors
- Database operations

### Metrics

**Available via Logs**:
- Message count per group
- Container execution time
- API response time
- Error rates
- Session count

### Health Checks

**Service Status**:
```bash
systemctl status nanoclaw
```

**Channel Status**:
- Check logs for "connected" messages
- Send test message to bot

**Database Status**:
```bash
sqlite3 /opt/nanoclaw/store/nanoclaw.db "SELECT COUNT(*) FROM groups;"
```

## Deployment Patterns

### Single Instance (Current)

- One droplet, one NanoClaw instance
- All channels on same instance
- Simple, cost-effective
- Limited by single server resources

### Future: Multi-Instance

- Multiple droplets with load balancer
- Shared database (PostgreSQL)
- Distributed container execution
- Higher availability and scalability

## Technology Stack

**Runtime**:
- Node.js 20.x
- TypeScript
- Docker 29.x

**Libraries**:
- `grammy` - Telegram bot framework
- `@anthropic-ai/claude-code` - Claude Code SDK
- `better-sqlite3` - SQLite database
- `pino` - Logging

**Infrastructure**:
- Ubuntu 24.04 LTS
- Systemd (service management)
- Docker (container runtime)

## Extension Points

### Adding New Channels

1. Create channel handler in `src/channels/`
2. Implement `Channel` interface
3. Call `registerChannel()` in module
4. Add channel-specific dependencies
5. Rebuild and restart

### Custom Skills

1. Create skill in `.claude/skills/`
2. Define skill metadata (SKILL.md)
3. Implement skill logic
4. Use via Claude Code CLI or manual integration

### Custom Tools

1. Add tool to agent runner allowed tools list
2. Implement tool handler if needed
3. Rebuild container image

### MCP Servers

1. Create MCP server in `src/`
2. Register in agent runner `mcpServers` config
3. Expose via IPC or stdio

## Troubleshooting Architecture

### Container Issues

**Symptom**: Container exits immediately

**Debug**:
```bash
# Check container logs
ls -la /opt/nanoclaw/groups/telegram_main/logs/
cat /opt/nanoclaw/groups/telegram_main/logs/container-*.log

# Check Docker
docker ps -a
docker logs <container_id>
```

### Database Issues

**Symptom**: Messages not persisting

**Debug**:
```bash
# Check database
sqlite3 /opt/nanoclaw/store/nanoclaw.db
.tables
SELECT * FROM messages ORDER BY timestamp DESC LIMIT 10;
```

### Network Issues

**Symptom**: API calls failing

**Debug**:
```bash
# Test credential proxy
curl http://localhost:3001/v1/messages

# Test Anthropic API
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01"
```

## References

- [NanoClaw Source](https://github.com/qwibitai/nanoclaw)
- [Claude Code SDK](https://www.npmjs.com/package/@anthropic-ai/claude-code)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Docker Documentation](https://docs.docker.com/)
