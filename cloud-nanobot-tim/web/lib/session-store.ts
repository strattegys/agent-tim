export interface ChatMessage {
  role: "user" | "model";
  text: string;
  timestamp: number;
}

const sessions = new Map<string, ChatMessage[]>();
const MEMORY_WINDOW = 50;

export function getHistory(userId: string): ChatMessage[] {
  return sessions.get(userId) ?? [];
}

export function addMessage(userId: string, msg: ChatMessage): void {
  const history = sessions.get(userId) ?? [];
  history.push(msg);
  while (history.length > MEMORY_WINDOW) {
    history.shift();
  }
  sessions.set(userId, history);
}

export function clearHistory(userId: string): void {
  sessions.delete(userId);
}
