/**
 * Shared constants and helpers used across tool modules.
 */
import { join } from "path";

export const TOOL_SCRIPTS_PATH =
  process.env.TOOL_SCRIPTS_PATH || join(process.cwd(), "..", ".nanobot", "tools");

export const TOOL_TIMEOUT = 15000;
export const LINKEDIN_TIMEOUT = 60000;

export const APPROVAL_PHRASES = [
  "send it now",
  "send it now:",
  "schedule it now",
  "go ahead and send",
  "go ahead and schedule",
  "approve package",
  "approve it now",
  /** Explicit outbound intent (avoid phrases that match inside "don't want you to send …") */
  "i want you to send",
  "send them this",
  "send this message",
];

export function hasUserApproval(lastUserMessage: string): boolean {
  const lower = lastUserMessage.toLowerCase();
  if (APPROVAL_PHRASES.some((phrase) => lower.includes(phrase))) return true;
  // "send a message to <name>" when the user is clearly instructing (not negated)
  if (/\bsend a message to\b/.test(lower) && !/\b(don't|do not|never|stop)\b[^.]{0,40}\bsend\b/.test(lower))
    return true;
  return false;
}

export function getToolEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TWENTY_CRM_API_KEY: process.env.TWENTY_CRM_API_KEY,
    TWENTY_CRM_URL: process.env.TWENTY_CRM_URL || "http://localhost:3000",
    CONNECTSAFELY_API_KEY: process.env.CONNECTSAFELY_API_KEY,
    CONNECTSAFELY_ACCOUNT_ID: process.env.CONNECTSAFELY_ACCOUNT_ID,
    BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
  };
}
