"use client";

export default function PanelSkeleton() {
  return (
    <div className="flex-1 flex flex-col gap-3 p-4 animate-pulse">
      <div className="h-4 w-1/3 rounded bg-[var(--bg-primary)]" />
      <div className="h-3 w-2/3 rounded bg-[var(--bg-primary)]" />
      <div className="h-3 w-1/2 rounded bg-[var(--bg-primary)]" />
      <div className="mt-2 flex-1 rounded-lg bg-[var(--bg-primary)] opacity-40" />
    </div>
  );
}
