/**
 * Sidebar unread uses “attention” turns: user messages and normal model replies.
 * Heartbeat / autonomous deliveries set `ambient` on saved model lines so they do not
 * increment the orange badge next to the avatar (work bell handles Suzi due reminders).
 */
export type SidebarAttentionMessage = { ambient?: boolean };

export function sidebarAttentionCount(
  messages: SidebarAttentionMessage[] | undefined
): number {
  if (!messages?.length) return 0;
  return messages.filter((m) => !m.ambient).length;
}
