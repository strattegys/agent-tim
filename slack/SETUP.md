# Strattegys Slack Gateway — Setup Guide

## Step 1: Create a Slack App (repeat for each agent)

1. Go to https://api.slack.com/apps
2. Click **"Create New App"** → **"From scratch"**
3. Enter the agent name (Tim, Scout, Suzi, Rainbow) and select the Strattegys workspace

## Step 2: Enable Socket Mode

1. In the app settings sidebar, click **"Socket Mode"**
2. Toggle **Enable Socket Mode** to ON
3. Give the token a name (e.g., `tim-socket`)
4. Copy the `xapp-...` token — this is the **App Token**

## Step 3: Add Bot Token Scopes

1. Go to **"OAuth & Permissions"** in the sidebar
2. Scroll to **"Bot Token Scopes"**
3. Click **"Add an OAuth Scope"** and add each of these one at a time:
   - `chat:write` — Send messages
   - `app_mentions:read` — Read @mentions
   - `im:history` — Read DM history
   - `im:read` — View DMs
   - `im:write` — Send DMs
   - `channels:history` — Read channel messages
   - `reactions:write` — Add emoji reactions
   - `reminders:write` — Create reminders
   - `reminders:read` — List reminders

## Step 4: Subscribe to Events

1. Go to **"Event Subscriptions"** in the sidebar
2. Toggle **Enable Events** to ON
3. Under **"Subscribe to bot events"**, click **"Add Bot User Event"** and add:
   - `app_mention` — When someone @mentions the bot
   - `message.im` — When someone DMs the bot
4. Click **"Save Changes"**

## Step 5: Install the App

1. Go back to **"OAuth & Permissions"**
2. Click **"Install to Workspace"** at the top
3. Click **"Allow"**
4. Copy the `xoxb-...` token — this is the **Bot Token**

## Step 6: Set Display Info (optional)

1. Go to **"Basic Information"** in the sidebar
2. Scroll to **"Display Information"**
3. Set the app icon/avatar and description

## Step 7: Create Channels

In Slack, create these channels:
- `#general` — Team chat with all agents
- `#tim-ops` — Tim's CRM/LinkedIn operations
- `#research` — Scout's research output
- `#alerts` — Heartbeat notifications

Then invite each bot to its channels:
- Type `/invite @Tim` (or @Scout, etc.) in each relevant channel

## Step 8: Collect Channel IDs

For each channel, right-click → "Copy link". The channel ID is the last segment:
`https://app.slack.com/client/TXXXXXX/C0XXXXXXXXX` → `C0XXXXXXXXX`

## Step 9: Configure Environment

Create `slack/.env` with all tokens:

```
# Gemini
GEMINI_API_KEY=your-gemini-key

# CRM & Tools
TWENTY_CRM_API_KEY=your-crm-key
TWENTY_CRM_URL=http://localhost:3000
CONNECTSAFELY_API_KEY=your-connectsafely-key
BRAVE_SEARCH_API_KEY=your-brave-key
TOOL_SCRIPTS_PATH=/root/.nanobot/tools

# Slack — Tim
SLACK_TIM_BOT_TOKEN=xoxb-...
SLACK_TIM_APP_TOKEN=xapp-...

# Slack — Scout
SLACK_SCOUT_BOT_TOKEN=xoxb-...
SLACK_SCOUT_APP_TOKEN=xapp-...

# Slack — Suzi
SLACK_SUZI_BOT_TOKEN=xoxb-...
SLACK_SUZI_APP_TOKEN=xapp-...

# Slack — Rainbow
SLACK_RAINBOW_BOT_TOKEN=xoxb-...
SLACK_RAINBOW_APP_TOKEN=xapp-...

# Channel IDs
SLACK_ALERTS_CHANNEL=C0XXXXXXXXX
SLACK_OPS_CHANNEL=C0XXXXXXXXX
SLACK_RESEARCH_CHANNEL=C0XXXXXXXXX
```

## Step 10: Run

```bash
cd slack
npm install
npm run dev     # development (watch mode)
npm start       # production
```

Or with PM2:
```bash
pm2 start "npx tsx src/app.ts" --name slack-gateway
```

## Slash Commands (Optional)

To enable `/inspect`, `/memory`, `/heartbeat`:
1. Go to Tim's app settings → **"Slash Commands"**
2. Click **"Create New Command"** for each:
   - Command: `/inspect` → Description: "Inspect an agent's config and memory"
   - Command: `/memory` → Description: "View an agent's memory"
   - Command: `/heartbeat` → Description: "Run heartbeat check"
3. Request URL is not needed (Socket Mode handles it)

## Tokens Collected So Far

| Agent | Bot Token | App Token |
|-------|-----------|-----------|
| Tim | `xoxb-1069...FtFxd` | `xapp-1-A0AL...1959` |
| Scout | | |
| Suzi | | |
| Rainbow | | |
