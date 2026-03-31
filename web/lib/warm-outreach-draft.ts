/**
 * Extract plain text from a MESSAGE_DRAFT / REPLY_DRAFT markdown artifact for Unipile send.
 */

/**
 * Strip markdown boilerplate from a draft artifact to get text suitable for Unipile.
 */
export function extractPlainDmFromDraftMarkdown(markdown: string): string {
  let s = markdown;

  s = s.replace(/^## Enrichment summary\n[\s\S]*?(?=\n## Why this draft\n|\n## Why this reply\n)/im, "");
  s = s.replace(/^## Why this draft\n[\s\S]*?(?=\n# |\n## Message\b)/im, "");
  s = s.replace(/^## Why this reply\n[\s\S]*?(?=\n# |\n## Reply\b)/im, "");
  s = s.replace(/^## Conversation & relationship\n[\s\S]*?(?=\n## Suggested reply angle\n|\n# )/im, "");
  s = s.replace(/^## Suggested reply angle\n[\s\S]*?(?=\n# )/im, "");

  const dmMatch = s.match(/# [^\n]+\n+([\s\S]*?)(?:\n---\s*\n|\n---$)/);
  if (dmMatch?.[1]) {
    s = dmMatch[1].trim();
  }

  s = s.replace(/^#+\s+.+$/gm, "");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/^\*Tim[^\n]*$/gm, "");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Parsed warm MESSAGE_DRAFT / REPLY_DRAFT artifact: message body vs Tim footer & preamble. */
export type WarmDmArtifactSplit = {
  prefix: string;
  titleLine: string;
  body: string;
  footer: string;
};

/**
 * Split a Tim warm DM artifact into preamble (enrichment / rationale), H1 title line, editable body, and --- footer.
 * Returns null if the markdown does not match the expected shape (caller falls back to full-document UI).
 */
export function splitWarmLinkedInDmArtifact(markdown: string): WarmDmArtifactSplit | null {
  const md = markdown.replace(/\s+$/, "");
  let sepStart = md.lastIndexOf("\n---\n");
  if (sepStart < 0) {
    if (/\n---\s*$/.test(md)) {
      sepStart = md.lastIndexOf("\n---");
      if (sepStart < 0) return null;
    } else {
      return null;
    }
  }
  const beforeFooter = md.slice(0, sepStart);
  const footer = md.slice(sepStart);

  const br = beforeFooter.lastIndexOf("\n# ");
  let titleStart: number;
  if (br >= 0) {
    titleStart = br + 1;
  } else if (beforeFooter.startsWith("# ")) {
    titleStart = 0;
  } else {
    return null;
  }
  if (beforeFooter.slice(titleStart, titleStart + 2) === "##") return null;

  const nl = beforeFooter.indexOf("\n", titleStart);
  if (nl < 0) return null;
  const titleLine = beforeFooter.slice(titleStart, nl).trimEnd();
  if (!/^#\s.+/.test(titleLine)) return null;

  const body = beforeFooter.slice(nl + 1);
  const prefix = beforeFooter.slice(0, titleStart);
  return { prefix, titleLine, body, footer };
}

/** Minimal artifact shape for thread context (same item, History rail). */
export type WarmThreadArtifact = {
  id: string;
  stage: string;
  content: string;
  createdAt: string;
};

/**
 * Inbound text from a REPLIED artifact when resolve/backfill stored **Their LinkedIn message**.
 * Returns null for legacy templates (no captured DM).
 */
export function extractWarmRepliedInboundText(content: string): string | null {
  const c = content.trim();
  if (!c) return null;
  if (/No message text was stored/i.test(c)) return null;

  const labeled = c.match(
    /\*\*Their LinkedIn message\*\*[^\n]*(?:\r?\n)+([\s\S]*?)(?=\r?\n---\s*\r?\n|\r?\n---\s*$)/i
  );
  if (labeled?.[1]) {
    const t = labeled[1].replace(/\r\n/g, "\n").trim();
    if (t.length > 0) return t;
  }

  if (
    /Govind marked\s+\*\*Replied\*\*/i.test(c) ||
    /Govind marked Replied/i.test(c) ||
    /Entering conversation mode/i.test(c)
  ) {
    return null;
  }

  return null;
}

/**
 * Plain text of the last LinkedIn send **before** this REPLIED row (MESSAGE_DRAFT / REPLY_DRAFT), or a ``` block from send artifacts.
 */
export function pickPreviousWarmOutboundPlain(
  allArtifacts: WarmThreadArtifact[],
  replied: Pick<WarmThreadArtifact, "id" | "createdAt">
): string | null {
  const repliedMs = new Date(replied.createdAt).getTime();
  if (!Number.isFinite(repliedMs)) return null;

  const older = allArtifacts.filter((a) => {
    if (a.id === replied.id) return false;
    const t = new Date(a.createdAt).getTime();
    return Number.isFinite(t) && t < repliedMs;
  });
  older.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  for (let i = older.length - 1; i >= 0; i--) {
    const a = older[i];
    const st = (a.stage || "").toUpperCase();
    if (st === "MESSAGE_DRAFT" || st === "REPLY_DRAFT") {
      const plain = extractPlainDmFromDraftMarkdown(a.content).trim();
      if (plain.length >= 8) return plain;
    }
  }

  for (let i = older.length - 1; i >= 0; i--) {
    const a = older[i];
    const st = (a.stage || "").toUpperCase();
    if (st === "MESSAGED" || st === "REPLY_SENT") {
      const m = a.content.match(/```(?:\w*)\r?\n([\s\S]*?)```/);
      const block = m?.[1]?.trim();
      if (block && block.length >= 8 && !block.startsWith("{")) return block.slice(0, 12000);
    }
  }

  return null;
}

/** Plain text stored in MESSAGED / REPLY_SENT artifacts (fenced code block). */
export function extractSentPlainFromLinkedInSendArtifact(content: string): string | null {
  const m = content.match(/```(?:\w*)\r?\n([\s\S]*?)```/);
  const block = m?.[1]?.trim();
  if (!block || block.length < 2 || block.startsWith("{")) return null;
  return block.slice(0, 12000);
}

/** One turn in the LinkedIn thread (chronological). */
export type WarmThreadTurn = {
  role: "you" | "them";
  text: string;
  createdAt: string;
};

const UNIPILE_THREAD_JSON_FENCE = "unipile-thread-json";

/**
 * Parsed turns from **Update LinkedIn** / backfill (fenced JSON on the REPLIED artifact).
 */
export function parseUnipileThreadTurnsFromRepliedArtifact(markdown: string): WarmThreadTurn[] | null {
  const re = new RegExp(
    "```\\s*" + UNIPILE_THREAD_JSON_FENCE + "\\s*\\n([\\s\\S]*?)```",
    "i"
  );
  const m = markdown.match(re);
  if (!m?.[1]) return null;
  try {
    const raw = JSON.parse(m[1].trim()) as unknown;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const out: WarmThreadTurn[] = [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const role = o.role === "you" || o.role === "them" ? o.role : null;
      const text = typeof o.text === "string" ? o.text.trim() : "";
      const createdAt = typeof o.createdAt === "string" ? o.createdAt.trim() : "";
      if (!role || !text || !createdAt) continue;
      out.push({ role, text, createdAt });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Build message history strictly before the current MESSAGE_DRAFT / REPLY_DRAFT row
 * (sent DMs from MESSAGED/REPLY_SENT, their replies from REPLIED, or earliest MESSAGE_DRAFT plain if nothing was sent yet).
 * When the latest prior **REPLIED** artifact includes a Unipile **Thread sync** block, that full thread is used and CRM
 * **you** rows **newer** than the last Unipile message are appended (sends after the sync).
 * Rows are oldest-first; callers may re-sort for display (e.g. newest at top).
 */
export function buildWarmLinkedInThreadBeforeDraft(
  allArtifacts: WarmThreadArtifact[],
  activeDraft: Pick<WarmThreadArtifact, "id" | "createdAt" | "stage">
): WarmThreadTurn[] {
  const activeMs = new Date(activeDraft.createdAt).getTime();
  if (!Number.isFinite(activeMs)) return [];

  const prior = allArtifacts.filter((a) => {
    if (a.id === activeDraft.id) return false;
    const t = new Date(a.createdAt).getTime();
    return Number.isFinite(t) && t < activeMs;
  });
  prior.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  let unipileTurns: WarmThreadTurn[] | null = null;
  let unipileSourceCreatedMs = -1;
  for (const a of prior) {
    if ((a.stage || "").toUpperCase() !== "REPLIED") continue;
    const parsed = parseUnipileThreadTurnsFromRepliedArtifact(a.content);
    if (!parsed?.length) continue;
    const ms = new Date(a.createdAt).getTime();
    if (Number.isFinite(ms) && ms >= unipileSourceCreatedMs) {
      unipileSourceCreatedMs = ms;
      unipileTurns = parsed;
    }
  }

  const crmTurns: WarmThreadTurn[] = [];
  for (const a of prior) {
    const st = (a.stage || "").toUpperCase();
    if (unipileTurns?.length && st === "REPLIED") continue;
    if (st === "REPLIED") {
      const t = extractWarmRepliedInboundText(a.content);
      if (t?.trim()) crmTurns.push({ role: "them", text: t.trim(), createdAt: a.createdAt });
    } else if (st === "MESSAGED" || st === "REPLY_SENT") {
      const sent = extractSentPlainFromLinkedInSendArtifact(a.content);
      if (sent) crmTurns.push({ role: "you", text: sent, createdAt: a.createdAt });
    }
  }

  const appendFirstYouFromMessageDraftIfMissing = (turns: WarmThreadTurn[]) => {
    if (!turns.some((x) => x.role === "you")) {
      for (const a of prior) {
        const st = (a.stage || "").toUpperCase();
        if (st === "MESSAGE_DRAFT") {
          const plain = extractPlainDmFromDraftMarkdown(a.content).trim();
          if (plain.length >= 8) {
            turns.push({ role: "you", text: plain, createdAt: a.createdAt });
            break;
          }
        }
      }
    }
    return turns;
  };

  if (unipileTurns && unipileTurns.length > 0) {
    const uniTimes = unipileTurns
      .map((x) => new Date(x.createdAt).getTime())
      .filter((n) => Number.isFinite(n));
    const maxUni = uniTimes.length > 0 ? Math.max(...uniTimes) : 0;
    const extraYou = crmTurns.filter((t) => {
      if (t.role !== "you") return false;
      const tm = new Date(t.createdAt).getTime();
      return Number.isFinite(tm) && tm > maxUni;
    });
    const merged = [...unipileTurns, ...extraYou];
    merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return appendFirstYouFromMessageDraftIfMissing(merged);
  }

  appendFirstYouFromMessageDraftIfMissing(crmTurns);
  crmTurns.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return crmTurns;
}

/** CRM artifact rows for thread reconstruction (chronological ASC). */
export type WarmThreadArtifactRow = {
  stage: string;
  content: string;
  createdAt: string;
};

/** Latest captured inbound plain text from REPLIED artifacts (chronological rows). */
export function extractLastWarmInboundFromArtifactRows(
  rows: Pick<WarmThreadArtifactRow, "stage" | "content">[]
): string {
  let last = "";
  for (const r of rows) {
    if ((r.stage || "").toUpperCase() !== "REPLIED") continue;
    const t = extractWarmRepliedInboundText(r.content);
    if (t?.trim()) last = t.trim();
  }
  return last;
}

/**
 * Human-readable transcript for the reply LLM: sent DMs, their replies, and draft rows (labeled).
 * Rows must be in chronological order (oldest first).
 */
export function buildStructuredWarmThreadTranscriptForLlm(rows: WarmThreadArtifactRow[]): string {
  const lines: string[] = [];
  for (const r of rows) {
    const st = (r.stage || "").toUpperCase();
    const ts = r.createdAt && Number.isFinite(new Date(r.createdAt).getTime())
      ? new Date(r.createdAt).toISOString()
      : "unknown-time";
    if (st === "MESSAGED" || st === "REPLY_SENT") {
      const t = extractSentPlainFromLinkedInSendArtifact(r.content);
      if (t?.trim()) lines.push(`[${ts}] GOVIND (sent on LinkedIn):\n${t.trim()}`);
    } else if (st === "REPLIED") {
      const t = extractWarmRepliedInboundText(r.content);
      if (t?.trim()) {
        lines.push(`[${ts}] CONTACT (their LinkedIn message):\n${t.trim()}`);
      } else {
        lines.push(
          `[${ts}] CONTACT: They replied on LinkedIn, but the exact text is not stored in CRM. Govind should use "Update LinkedIn" in the work panel header or read LinkedIn.`
        );
      }
    } else if (st === "MESSAGE_DRAFT" || st === "REPLY_DRAFT") {
      const t = extractPlainDmFromDraftMarkdown(r.content).trim();
      if (t.length >= 4) {
        lines.push(
          `[${ts}] DRAFT artifact (${st}) — old proposal only; do not mimic if a REPLY TARGET appears below:\n${t.slice(0, 2800)}`
        );
      }
    }
  }
  let core =
    lines.length > 0
      ? lines.join("\n\n---\n\n")
      : "(No MESSAGED / REPLY_SENT / REPLIED / draft artifacts on this item yet.)";

  const latestInbound = extractLastWarmInboundFromArtifactRows(rows).trim();
  if (latestInbound.length > 0) {
    const safe = latestInbound.slice(0, 2400);
    core +=
      "\n\n---\n\n" +
      "### REPLY TARGET (mandatory)\n" +
      "Their **latest** LinkedIn message (plain text below). The **REPLY_DRAFT** you write must answer **this** turn: acknowledge what they said, stay short and human, advance the conversation. " +
      "Do **not** recycle prior **DRAFT artifact** copy above. Do **not** re-drop links or talking points they already thanked you for.\n\n" +
      safe;
  }

  return core;
}

/** Inject inbound one-liner into REPLY_DRAFT prefix (same shape as human-tasks resolve backfill). */
export function injectInboundIntoReplyDraftMarkdown(md: string, inbound: string): string {
  const line = `- **Their latest LinkedIn message:** ${String(inbound).trim().replace(/\n+/g, " ")}\n`;
  if (md.includes("**Their latest LinkedIn message:**")) {
    return md;
  }
  if (!md.includes("## Conversation & relationship")) {
    return md;
  }
  return md.replace(/(## Conversation & relationship\s*\n+)/, `$1${line}`);
}

/** Rebuild stored artifact after Govind edits only the DM body. */
export function recomposeWarmLinkedInDmArtifact(split: WarmDmArtifactSplit, newBody: string): string {
  const pre = split.prefix.trimEnd();
  const body = newBody.trimEnd();
  const foot = split.footer.startsWith("\n") ? split.footer : `\n${split.footer}`;
  if (!pre) return `${split.titleLine}\n${body}${foot}`;
  return `${pre}\n\n${split.titleLine}\n${body}${foot}`;
}

/**
 * Tim chat often sends plain text or partial markdown. If `proposed` already matches the warm draft shape
 * (prefix + # title + body + --- footer), return it unchanged. If the previous artifact splits and proposed
 * does not, treat proposed as the new DM body only and preserve prefix + footer.
 * Returns null when no merge rule applies (caller saves proposed as-is).
 */
export function coerceWarmLinkedInDraftUpdate(
  previousMarkdown: string,
  proposedMarkdown: string
): string | null {
  if (!proposedMarkdown || !proposedMarkdown.trim()) return null;
  if (splitWarmLinkedInDmArtifact(proposedMarkdown)) {
    return proposedMarkdown;
  }
  const prevSplit = splitWarmLinkedInDmArtifact(previousMarkdown);
  if (!prevSplit) return null;
  return recomposeWarmLinkedInDmArtifact(prevSplit, proposedMarkdown.trim());
}
