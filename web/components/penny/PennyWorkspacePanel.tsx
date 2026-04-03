"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { AgentConfig } from "@/lib/agent-frontend";
import { PACKAGE_TEMPLATES, PLANNER_PACKAGE_TEMPLATES } from "@/lib/package-types";
import type {
  PennyAccountDto,
  PennyAccountsResponse,
  PennyDerivedStage,
} from "@/lib/penny-accounts-types";

type PennyTab = "accounts" | "pipeline" | "products";

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(`Error ${r.status}`);
  return r.json() as Promise<T>;
}

const STAGE_ORDER: PennyDerivedStage[] = [
  "lead",
  "proposal",
  "review",
  "customer",
  "delivered",
];

function stageLabel(s: PennyDerivedStage): string {
  switch (s) {
    case "lead":
      return "Lead";
    case "proposal":
      return "Proposal";
    case "review":
      return "Review";
    case "customer":
      return "Customer";
    case "delivered":
      return "Delivered";
    default:
      return s;
  }
}

function stageBadgeClass(s: PennyDerivedStage): string {
  switch (s) {
    case "customer":
      return "bg-[#1D9E75]/15 text-[#1D9E75] border-[#1D9E75]/40";
    case "review":
      return "bg-amber-500/15 text-amber-600 border-amber-500/40";
    case "proposal":
      return "bg-[#5B8DEF]/15 text-[#5B8DEF] border-[#5B8DEF]/40";
    case "delivered":
      return "bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-color)]";
    default:
      return "bg-[var(--bg-secondary)] text-[var(--text-tertiary)] border-[var(--border-color)]";
  }
}

/**
 * Penny workspace — Accounts, Pipeline (by derived stage), Products (templates).
 */
export default function PennyWorkspacePanel({
  agent: _agent,
  onClose,
  onOpenPackageKanban,
}: {
  agent: AgentConfig;
  onClose: () => void;
  onOpenPackageKanban: () => void;
}) {
  const [tab, setTab] = useState<PennyTab>("accounts");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, error, isLoading } = useSWR<PennyAccountsResponse>(
    "/api/penny/accounts",
    fetchJson,
    { revalidateOnFocus: true, dedupingInterval: 20_000 },
  );

  const accounts = data?.accounts ?? [];
  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedId) ?? null,
    [accounts, selectedId],
  );

  const byStage = useMemo(() => {
    const m = new Map<PennyDerivedStage, PennyAccountDto[]>();
    for (const s of STAGE_ORDER) m.set(s, []);
    for (const a of accounts) {
      const list = m.get(a.derivedStage) ?? [];
      list.push(a);
      m.set(a.derivedStage, list);
    }
    return m;
  }, [accounts]);

  const productTemplates =
    PLANNER_PACKAGE_TEMPLATES.length > 0
      ? PLANNER_PACKAGE_TEMPLATES
      : Object.values(PACKAGE_TEMPLATES);

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-[var(--bg-secondary)]">
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-2 gap-1 flex-wrap">
        {(
          [
            ["accounts", "Accounts"],
            ["pipeline", "Pipeline"],
            ["products", "Products"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
              tab === key
                ? "font-semibold text-[var(--text-primary)]"
                : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={onOpenPackageKanban}
          className="text-xs px-2 py-1 rounded ml-auto text-[var(--text-tertiary)] hover:text-[#5B8DEF]"
        >
          Friday · Package Kanban
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        >
          Close
        </button>
      </div>

      {tab === "accounts" ? (
        <div className="flex-1 min-h-0 flex flex-col sm:flex-row overflow-hidden">
          <div className="sm:w-[min(100%,280px)] shrink-0 border-b sm:border-b-0 sm:border-r border-[var(--border-color)] overflow-y-auto max-h-[40vh] sm:max-h-none">
            {isLoading && !data ? (
              <p className="text-xs text-[var(--text-tertiary)] p-3">Loading…</p>
            ) : error ? (
              <p className="text-xs text-red-500 p-3">Could not load accounts.</p>
            ) : accounts.length === 0 ? (
              <p className="text-xs text-[var(--text-tertiary)] p-3">
                No accounts yet. Link packages to companies or add CRM contacts on a company.
              </p>
            ) : (
              <ul className="p-2 space-y-0.5">
                {accounts.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      className={`w-full text-left rounded-md px-2 py-1.5 text-xs border transition-colors ${
                        selectedId === a.id
                          ? "border-[#5B8DEF] bg-[#5B8DEF]/10 text-[var(--text-primary)]"
                          : "border-transparent hover:bg-[var(--bg-primary)] text-[var(--text-primary)]"
                      }`}
                    >
                      <span className="font-medium line-clamp-1">{a.name}</span>
                      <span
                        className={`mt-0.5 inline-block text-[9px] px-1.5 py-0.5 rounded border ${stageBadgeClass(a.derivedStage)}`}
                      >
                        {stageLabel(a.derivedStage)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {!selected ? (
              <p className="text-xs text-[var(--text-tertiary)]">Select an account to see detail.</p>
            ) : (
              <div className="space-y-3 max-w-lg">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{selected.name}</h3>
                <span
                  className={`inline-block text-[10px] px-2 py-0.5 rounded border ${stageBadgeClass(selected.derivedStage)}`}
                >
                  {stageLabel(selected.derivedStage)}
                </span>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                    <dt className="text-[var(--text-tertiary)]">Contacts</dt>
                    <dd className="font-semibold tabular-nums">{selected.contactCount}</dd>
                  </div>
                  <div className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                    <dt className="text-[var(--text-tertiary)]">Active pkgs</dt>
                    <dd className="font-semibold tabular-nums">{selected.activePackages}</dd>
                  </div>
                  <div className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                    <dt className="text-[var(--text-tertiary)]">Draft</dt>
                    <dd className="font-semibold tabular-nums">{selected.draftPackages}</dd>
                  </div>
                  <div className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                    <dt className="text-[var(--text-tertiary)]">Pending approval</dt>
                    <dd className="font-semibold tabular-nums">{selected.pendingPackages}</dd>
                  </div>
                  <div className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                    <dt className="text-[var(--text-tertiary)]">Completed</dt>
                    <dd className="font-semibold tabular-nums">{selected.completedPackages}</dd>
                  </div>
                  <div className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                    <dt className="text-[var(--text-tertiary)]">Total pkgs</dt>
                    <dd className="font-semibold tabular-nums">{selected.totalPackages}</dd>
                  </div>
                </dl>
                {(selected.websiteUrl || selected.linkedinUrl) && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {selected.websiteUrl ? (
                      <a
                        href={selected.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#5B8DEF] hover:underline"
                      >
                        Website
                      </a>
                    ) : null}
                    {selected.linkedinUrl ? (
                      <a
                        href={selected.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#5B8DEF] hover:underline"
                      >
                        LinkedIn
                      </a>
                    ) : null}
                  </div>
                )}
                {data?.note ? (
                  <p className="text-[10px] text-[var(--text-tertiary)] leading-snug">{data.note}</p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === "pipeline" ? (
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto p-3">
          {isLoading && !data ? (
            <p className="text-xs text-[var(--text-tertiary)]">Loading…</p>
          ) : error ? (
            <p className="text-xs text-red-500">Could not load accounts.</p>
          ) : (
            <div className="flex gap-3 min-w-min pb-2">
              {STAGE_ORDER.map((stage) => (
                <div
                  key={stage}
                  className="w-[200px] shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2 flex flex-col gap-1.5"
                >
                  <h4 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] px-1">
                    {stageLabel(stage)} · {(byStage.get(stage) ?? []).length}
                  </h4>
                  <ul className="space-y-1">
                    {(byStage.get(stage) ?? []).map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setTab("accounts");
                            setSelectedId(a.id);
                          }}
                          className="w-full text-left text-xs rounded-md border border-[var(--border-color)]/60 px-2 py-1.5 hover:border-[#5B8DEF] text-[var(--text-primary)]"
                        >
                          <span className="line-clamp-2 font-medium">{a.name}</span>
                          <span className="block text-[10px] text-[var(--text-tertiary)] tabular-nums mt-0.5">
                            {a.activePackages} act · {a.contactCount} contacts
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === "products" ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
          <p className="text-[11px] text-[var(--text-tertiary)]">
            Package templates from the registry. Catalog may be sparse until you add sellable templates — use{" "}
            <strong className="text-[var(--text-secondary)]">Custom</strong> in Friday Planner meanwhile.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {productTemplates.map((t) => (
              <article
                key={t.id}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-sm"
              >
                <p className="text-xs font-semibold text-[var(--text-primary)]">{t.label}</p>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-1 font-mono">{t.id}</p>
                <p className="text-[11px] text-[var(--text-secondary)] mt-2 leading-snug">{t.description}</p>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-2">
                  {t.deliverables.length} deliverable{t.deliverables.length !== 1 ? "s" : ""}
                </p>
              </article>
            ))}
          </div>
          {productTemplates.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)]">No planner-visible templates in registry.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
