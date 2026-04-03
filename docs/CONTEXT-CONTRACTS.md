# Chat context contracts (Command Central)

Interactive chat (`POST /api/chat/stream`) sends four conceptual layers to the LLM:

1. **System prompt** — persona and rules (file-backed, optionally trimmed by provider).
2. **Ephemeral work / UI** — merged `workQueueContext` + `uiContext`, prepended under “ACTIVE WORK CONTEXT” ([`appendEphemeralContext`](../web/lib/chat-stream-options.ts)). Not persisted as session JSONL.
3. **Session JSONL history** — prior user/model turns from the agent’s session file ([`getHistory`](../web/lib/session-store.ts)).
4. **Current user message** — this turn (sometimes with reply-to prefix).

## Session history cap

When a focused work surface supplies enough grounding, the client sends `sessionHistoryMaxMessages` so providers only pass the **last N** turns from layer 3. Constants live in [`chat-stream-options.ts`](../web/lib/chat-stream-options.ts):

| Scenario | Constant | Typical N | Rationale |
|----------|----------|-----------|-----------|
| Tim, work-queue row selected | `SESSION_HISTORY_FOCUS_TIM_WORK_ITEM` | 24 | Prospect + LinkedIn thread live in `workQueueContext`; long Govind↔Tim chat is usually noise. |
| Ghost, content-queue row selected | `SESSION_HISTORY_FOCUS_GHOST_WORK` | 24 | Same idea for content workflow. |
| Marni, distribution-queue row selected | `SESSION_HISTORY_FOCUS_MARNI_WORK` | 24 | Item + artifact focus live in `formatMarniWorkQueueContext`. |
| Suzi, any focused card (intake / punch / reminder / note) | `SESSION_HISTORY_FOCUS_SUZI_WORK` | 14 | Ids and copy are in `formatSuziWorkPanelContext`; prefer tools with explicit ids over replaying old chat. |

If none of the above applies, **N is omitted** and the full session history is sent (unchanged legacy behavior).

The server clamps any client value to `SESSION_HISTORY_MAX_CAP` (500).

## Tool-first rule

For Suzi punch list, reminders, intake, etc., the model should use **tools** with **ids or item numbers** from the focused block rather than inferring targets from ancient chat turns.

## Future tweaks

- Optional UI toggle “use full chat history” per agent when a row is focused.
- Tighter LinkedIn transcript tails for Tim (artifact builder) if logs stay large after this cap.
