/**
 * Punch list Kanban — fixed six columns (left → right).
 * DB stores `rank` 1–6; UI always renders all columns even when empty.
 */
export const PUNCH_LIST_COLUMNS = [
  { rank: 1, label: "Now", color: "#a67070" },
  { rank: 2, label: "Later", color: "#a68970" },
  { rank: 3, label: "Next", color: "#a6a066" },
  { rank: 4, label: "Sometime", color: "#7fa67a" },
  { rank: 5, label: "Backlog", color: "#8888a8" },
  { rank: 6, label: "Idea", color: "#8a9099" },
] as const;

export type PunchListColumnSpec = (typeof PUNCH_LIST_COLUMNS)[number];
export type PunchListRank = PunchListColumnSpec["rank"];

export const PUNCH_LIST_RANK_LABELS: Record<number, string> = Object.fromEntries(
  PUNCH_LIST_COLUMNS.map((c) => [c.rank, c.label])
) as Record<number, string>;

export const PUNCH_LIST_RANK_COLORS: Record<number, string> = Object.fromEntries(
  PUNCH_LIST_COLUMNS.map((c) => [c.rank, c.color])
) as Record<number, string>;

const MIN_RANK = PUNCH_LIST_COLUMNS[0].rank;
const MAX_RANK = PUNCH_LIST_COLUMNS[PUNCH_LIST_COLUMNS.length - 1].rank;

/** Parse rank from "3", "next", "sometime", "some time", etc. Returns null if invalid. */
export function parsePunchListRank(input: string): number | null {
  const t = input.trim().toLowerCase().replace(/_/g, " ");
  const n = parseInt(t, 10);
  if (!Number.isNaN(n) && n >= MIN_RANK && n <= MAX_RANK) return n;

  const map: Record<string, number> = {
    now: 1,
    later: 2,
    next: 3,
    "some time": 4,
    sometime: 4,
    "some-time": 4,
    backlog: 5,
    idea: 6,
  };
  const mapped = map[t];
  return mapped !== undefined ? mapped : null;
}

export function punchListColumnLabel(rank: number): string {
  return PUNCH_LIST_RANK_LABELS[rank] ?? `Column ${rank}`;
}

export function punchListColumnsSummary(): string {
  return PUNCH_LIST_COLUMNS.map((c) => `${c.rank}=${c.label}`).join(", ");
}
