import "server-only";

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import path from "path";

const PAUSE_FILENAME = "cron-pause.json";

function pauseFilePath(): string {
  return path.join(process.cwd(), "data", PAUSE_FILENAME);
}

type PauseFileShape = { pausedIds: string[] };

let fileCache: { mtimeMs: number; ids: string[] } | null = null;

function readPauseFileIdsUncached(): string[] {
  const file = pauseFilePath();
  try {
    if (!existsSync(file)) return [];
    const raw = readFileSync(file, "utf-8");
    const j = JSON.parse(raw) as PauseFileShape;
    return Array.isArray(j.pausedIds)
      ? j.pausedIds.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
  } catch {
    return [];
  }
}

function readPauseFileIds(): string[] {
  const file = pauseFilePath();
  try {
    const mtimeMs = existsSync(file) ? statSync(file).mtimeMs : 0;
    if (fileCache && fileCache.mtimeMs === mtimeMs) {
      return fileCache.ids;
    }
    const ids = readPauseFileIdsUncached();
    fileCache = { mtimeMs, ids };
    return ids;
  } catch {
    return readPauseFileIdsUncached();
  }
}

function invalidatePauseFileCache(): void {
  fileCache = null;
}

export function pausedCronJobIdsFromEnv(): string[] {
  const v = process.env.CC_CRON_PAUSED_IDS?.trim();
  if (!v) return [];
  return v
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isCronJobPaused(jobId: string): boolean {
  const env = pausedCronJobIdsFromEnv();
  if (env.includes(jobId)) return true;
  return readPauseFileIds().includes(jobId);
}

export type CronPauseDetails = {
  paused: boolean;
  fromEnv: boolean;
  fromFile: boolean;
};

export function getCronPauseDetailsForJob(jobId: string): CronPauseDetails {
  const fromEnv = pausedCronJobIdsFromEnv().includes(jobId);
  const fromFile = readPauseFileIds().includes(jobId);
  return {
    paused: fromEnv || fromFile,
    fromEnv,
    fromFile,
  };
}

/** File-backed pauses only (UI toggle); env pauses are separate. */
export function getFilePausedCronJobIds(): string[] {
  return readPauseFileIds();
}

export function setCronJobFilePaused(jobId: string, paused: boolean): string[] {
  const next = new Set(readPauseFileIdsUncached());
  if (paused) next.add(jobId);
  else next.delete(jobId);
  const sorted = [...next].sort();
  const dir = path.dirname(pauseFilePath());
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(
    pauseFilePath(),
    JSON.stringify({ pausedIds: sorted } satisfies PauseFileShape, null, 2) + "\n",
    "utf-8"
  );
  invalidatePauseFileCache();
  return sorted;
}
