/**
 * Stable human-facing ids: two-letter prefix + number (e.g. IN2001, NT5001, PL1040).
 * Reminders: **RM0008** style — RM + at least four digits (RM0036, RM12345 when longer). DB may store a
 * shorter generated `publicRef`; derive display from `reminderNumber`.
 *
 * When adding a new entity type: pick an unused two-letter prefix, add a sequence/column + GENERATED
 * `publicRef` in SQL, extend `ENTITY_PREFIX` and `parseEntityPublicRef` below, and expose on the type + API.
 */

export const ENTITY_PREFIX = {
  intake: "IN",
  reminder: "RM",
  note: "NT",
  punch_list: "PL",
} as const;

export type PublicEntityKind = keyof typeof ENTITY_PREFIX;

/** Format prefix + positive integer (no separator). */
export function formatPublicRef(kind: PublicEntityKind, num: number): string {
  if (!Number.isFinite(num) || num < 1) {
    throw new Error(`public ref number must be a positive integer, got ${num}`);
  }
  return `${ENTITY_PREFIX[kind]}${Math.floor(num)}`;
}

const PREFIX_TO_KIND: Record<string, PublicEntityKind> = {
  IN: "intake",
  RM: "reminder",
  NT: "note",
  PL: "punch_list",
};

/**
 * Parse "IN2001", "rm12", "PL 1040" → kind + number. Returns null if not a known pattern.
 */
export function parseEntityPublicRef(raw: string): { kind: PublicEntityKind; num: number } | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  const m = /^(IN|RM|NT|PL)(\d+)$/.exec(s);
  if (!m) return null;
  const kind = PREFIX_TO_KIND[m[1]!];
  if (!kind) return null;
  const num = parseInt(m[2]!, 10);
  if (!Number.isFinite(num) || num < 1) return null;
  return { kind, num };
}

/** If DB returned `publicRef`, use it; else derive from numeric id (dev / pre-migration). */
export function intakePublicRef(row: { publicRef?: string | null; itemNumber: number }): string {
  const pr = typeof row.publicRef === "string" && row.publicRef.trim() ? row.publicRef.trim() : "";
  if (pr) return pr;
  if (!Number.isFinite(row.itemNumber) || row.itemNumber < 1) return "IN0";
  return formatPublicRef("intake", row.itemNumber);
}

export function punchPublicRef(row: { publicRef?: string | null; itemNumber: number }): string {
  const pr = typeof row.publicRef === "string" && row.publicRef.trim() ? row.publicRef.trim() : "";
  if (pr) return pr;
  if (!Number.isFinite(row.itemNumber) || row.itemNumber < 1) return "PL0";
  return formatPublicRef("punch_list", row.itemNumber);
}

export function notePublicRef(row: { publicRef?: string | null; noteNumber: number }): string {
  const pr = typeof row.publicRef === "string" && row.publicRef.trim() ? row.publicRef.trim() : "";
  if (pr) return pr;
  if (!Number.isFinite(row.noteNumber) || row.noteNumber < 1) return "NT0";
  return formatPublicRef("note", row.noteNumber);
}

/**
 * Reminder ref: RM + at least four digits, no commas or spaces (RM0008, RM0036). Used for API `publicRef`,
 * badges, lists, tools, and agent context; `parseEntityPublicRef` accepts these.
 */
export function formatReminderRefDisplay(reminderNumber: number): string {
  if (!Number.isFinite(reminderNumber) || reminderNumber < 1) return "RM0";
  return `RM${String(Math.floor(reminderNumber)).padStart(4, "0")}`;
}

/**
 * Badge / list label: same as `formatReminderRefDisplay` when `reminderNumber` is known; otherwise parse
 * legacy short `publicRef` (RM8 → RM0008). Empty string when there is no usable ref.
 */
export function reminderRefUiLabel(row: {
  publicRef?: string | null;
  reminderNumber?: number | null;
}): string {
  const rn =
    typeof row.reminderNumber === "number" && Number.isFinite(row.reminderNumber)
      ? Math.floor(row.reminderNumber)
      : 0;
  if (rn >= 1) return formatReminderRefDisplay(rn);
  const pr = typeof row.publicRef === "string" && row.publicRef.trim() ? row.publicRef.trim() : "";
  if (!pr) return "";
  const p = parseEntityPublicRef(pr);
  if (p?.kind === "reminder") return formatReminderRefDisplay(p.num);
  return pr;
}

export function reminderPublicRef(row: {
  publicRef?: string | null;
  reminderNumber: number;
}): string {
  const n =
    typeof row.reminderNumber === "number" && Number.isFinite(row.reminderNumber)
      ? Math.floor(row.reminderNumber)
      : 0;
  if (n >= 1) return formatReminderRefDisplay(n);
  const pr = typeof row.publicRef === "string" && row.publicRef.trim() ? row.publicRef.trim() : "";
  return pr || "RM0";
}

const STRIP_HASH = (s: string) => s.replace(/^#/, "").trim();

/** Punch list: `#1040`, `1040`, or `PL1040` → item number. */
export function punchDigitsFromToken(raw: string): number | null {
  const s = STRIP_HASH(raw);
  const p = parseEntityPublicRef(s);
  if (p?.kind === "punch_list") return p.num;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n >= 1 ? n : null;
  }
  return null;
}

/** Intake: `IN2001` or plain `2001` / `#2001`. */
export function intakeDigitsFromToken(raw: string): number | null {
  const s = STRIP_HASH(raw);
  const p = parseEntityPublicRef(s);
  if (p?.kind === "intake") return p.num;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n >= 1 ? n : null;
  }
  return null;
}

/** Notes: `NT5001` or `5001` / `#5001`. */
export function noteDigitsFromToken(raw: string): number | null {
  const s = STRIP_HASH(raw);
  const p = parseEntityPublicRef(s);
  if (p?.kind === "note") return p.num;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n >= 1 ? n : null;
  }
  return null;
}

/** Reminders: `RM12` / `RM0012` (no legacy plain digit id). */
export function reminderDigitsFromToken(raw: string): number | null {
  const s = STRIP_HASH(raw);
  const p = parseEntityPublicRef(s);
  return p?.kind === "reminder" ? p.num : null;
}
