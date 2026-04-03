"use client";

import useSWR from "swr";

const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(await r.text().catch(() => r.statusText));
  return r.json() as Promise<Record<string, unknown>>;
};

export function MobileTimReadonly() {
  const { data, error, isLoading } = useSWR(
    "/api/crm/human-tasks?ownerAgent=tim&messagingOnly=1&limit=60&linkedinInboundFeed=0",
    fetcher,
    { refreshInterval: 60_000 }
  );

  if (isLoading) {
    return <p className="text-sm text-[#8b9bab]">Loading Tim queue…</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-red-400">
        {error instanceof Error ? error.message : "Could not load queue"}
      </p>
    );
  }

  const tasks = (data?.tasks as Record<string, unknown>[]) ?? [];
  const count = typeof data?.count === "number" ? data.count : tasks.length;

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-snug text-[#8b9bab]">
        Read-only messaging queue for Tim. Open full Command Central to draft or send.
      </p>
      <p className="text-xs text-[#6b8a9e]">
        Showing {tasks.length} row(s) · queue count {count}
      </p>
      {tasks.length === 0 ? (
        <p className="text-sm text-[#8b9bab]">No tasks in this view.</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((t, i) => {
            const title =
              String(t.itemTitle ?? t.title ?? t.workflowName ?? "Task").slice(0, 200);
            const sub = [
              t.stageLabel,
              t.workflowName,
              t.packageName,
              t.humanAction,
            ]
              .map((x) => (x != null ? String(x) : ""))
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={String(t.itemId ?? t.workflowId ?? i)} className="rounded-lg border border-white/10 bg-[#0e1621] p-3">
                <p className="text-sm font-medium text-[#f5f5f5]">{title}</p>
                {t.itemSubtitle ? (
                  <p className="mt-1 text-xs text-[#9ca3af]">{String(t.itemSubtitle)}</p>
                ) : null}
                {sub ? <p className="mt-1 text-[10px] text-[#6b8a9e]">{sub}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
