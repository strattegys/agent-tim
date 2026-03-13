# Streaming & Progress Feedback Feature

## Current Implementation (Option A) ✅

**Typing Indicator**: Already implemented and working
- NanoClaw sends Telegram typing indicator when processing messages
- Indicator shows while Tim is thinking
- Automatically stops when response is sent
- This is the standard Telegram UX

**How it works:**
```typescript
// In src/index.ts
await channel.setTyping?.(chatJid, true);  // Start typing indicator
// ... process message ...
await channel.setTyping?.(chatJid, false); // Stop typing indicator
```

## Proposed Enhancement (Option B)

**Acknowledgment Message with Edit**: Send initial "🤔 Thinking..." that gets edited with final response

### Benefits
- Immediate visual feedback that message was received
- Shows progress even if typing indicator isn't visible
- Better UX for long-running queries

### Implementation Plan

**1. Modify `src/channels/telegram.ts`:**

Add pending message tracking:
```typescript
export class TelegramChannel implements Channel {
  name = 'telegram';
  private bot: Bot | null = null;
  private opts: TelegramChannelOpts;
  private botToken: string;
  private pendingMessages: Map<string, number> = new Map(); // ADD THIS
```

Add acknowledgment method:
```typescript
async sendAcknowledgment(jid: string): Promise<void> {
  if (!this.bot) return;
  try {
    const numericId = jid.replace(/^tg:/, '');
    const msg = await this.bot.api.sendMessage(numericId, '🤔 Thinking...');
    this.pendingMessages.set(jid, msg.message_id);
    logger.debug({ jid, messageId: msg.message_id }, 'Sent acknowledgment');
  } catch (err) {
    logger.debug({ jid, err }, 'Failed to send acknowledgment');
  }
}
```

Modify `sendMessage` to edit acknowledgment:
```typescript
async sendMessage(jid: string, text: string): Promise<void> {
  if (!this.bot) {
    logger.warn('Telegram bot not initialized');
    return;
  }

  try {
    const numericId = jid.replace(/^tg:/, '');

    // Check for pending acknowledgment message
    const pendingMsgId = this.pendingMessages.get(jid);
    if (pendingMsgId) {
      this.pendingMessages.delete(jid);
      try {
        // Edit the acknowledgment message with final response
        await this.bot.api.editMessageText(numericId, pendingMsgId, text, {
          parse_mode: 'Markdown'
        });
        logger.info({ jid, length: text.length }, 'Telegram message edited');
        return;
      } catch (err) {
        logger.debug({ jid, err }, 'Failed to edit, sending new message');
        // Fall through to send new message
      }
    }

    // Original send logic continues...
    const MAX_LENGTH = 4096;
    if (text.length <= MAX_LENGTH) {
      await sendTelegramMessage(this.bot.api, numericId, text);
    } else {
      // ... split logic
    }
  } catch (err) {
    logger.error({ jid, err }, 'Failed to send Telegram message');
  }
}
```

**2. Modify `src/index.ts`:**

Add acknowledgment call before processing:
```typescript
async function processMessagesForGroup(chatJid: string): Promise<boolean> {
  // ... existing code ...
  
  await channel.setTyping?.(chatJid, true);
  await channel.sendAcknowledgment?.(chatJid); // ADD THIS
  
  const output = await runAgent(group, prompt, chatJid, async (result) => {
    // ... existing streaming callback ...
  });
  
  // ... rest of function
}
```

**3. Add type definition:**

In `src/types.ts`, add to Channel interface:
```typescript
export interface Channel {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  sendAcknowledgment?(jid: string): Promise<void>; // ADD THIS
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
}
```

### Testing Steps

1. Make code changes above
2. Rebuild: `npm run build`
3. Restart service: `systemctl restart nanoclaw`
4. Send message to Tim in Telegram
5. Should see:
   - "🤔 Thinking..." appears immediately
   - Message gets edited with final response
   - No duplicate messages

### Alternative: Manual Implementation

If modifying TypeScript is complex, you can:

1. SSH into droplet: `ssh root@137.184.187.233`
2. Switch to nanoclaw user: `su - nanoclaw`
3. Edit file: `nano /opt/nanoclaw/src/channels/telegram.ts`
4. Make changes manually
5. Rebuild: `npm run build`
6. Exit and restart: `exit && systemctl restart nanoclaw`

## Current Status

- ✅ **Option A (Typing Indicator)**: Working
- ⏳ **Option B (Acknowledgment)**: Requires code modification

## Workaround

For now, the typing indicator provides visual feedback. Response times are typically:
- Simple queries: 3-8 seconds
- Complex queries: 10-20 seconds
- File operations: 15-30 seconds

The typing indicator will show during this entire time, giving you feedback that Tim is processing your request.
