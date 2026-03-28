"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parsePersonLinkedInFields } from "@/lib/linkedin-person-identity";
import TimContactInspectModal, { TimInspectContactIcon } from "./TimContactInspectModal";
import { usePersistentResizableColumns } from "./useTimCrmColumnWidths";

type CrmSubTab = "contacts" | "companies";

type ContactRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string;
  /** Comma-separated package names when the contact is on a packaged workflow. */
  packageNames?: string;
  /** Distinct stage labels only, e.g. `Messaged · Message Draft`. */
  packageStatus?: string;
  linkedinUrlRaw: string | null;
  linkedinProviderId?: string | null;
};

type CompanyRow = {
  id: string;
  name: string;
  websiteUrl: string | null;
  linkedinUrl: string | null;
};

type LiBubble = { key: string; href?: string; text: string; title: string };

const PAGE_SIZE = 50;

/** Default % widths (sum arbitrary; normalized). First column = per-row inspect. */
const CRM_CONTACTS_COL_DEFAULTS: number[] = [9, 12, 11, 12, 8, 48];
const CRM_CONTACTS_COL_KEY = "cc.timCrm.contactsColWidths.v3";
const CRM_COMPANIES_COL_DEFAULTS: number[] = [16, 20, 64];
const CRM_COMPANIES_COL_KEY = "cc.timCrm.companiesColWidths.v1";

const CRM_CONTACTS_HEADERS: { label: string; title?: string }[] = [
  {
    label: "Inspect",
    title: "Open contact card & activity history (artifacts, notes, workflows)",
  },
  { label: "Name" },
  { label: "Company" },
  { label: "Package" },
  { label: "Stage", title: "Workflow stage in linked packages" },
  { label: "LinkedIn" },
];

const CRM_COMPANIES_HEADERS: { label: string; title?: string }[] = [
  { label: "Company" },
  { label: "Web" },
  { label: "LinkedIn" },
];

function ColumnResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <span
      aria-hidden
      onMouseDown={onMouseDown}
      className="absolute right-0 top-0 z-[2] h-full w-2 -translate-x-1/2 cursor-col-resize select-none hover:bg-[var(--accent-green)]/35 active:bg-[var(--accent-green)]/50"
    />
  );
}

const bubbleLink =
  "inline-flex max-w-[min(100%,15rem)] min-h-[1.35rem] items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] leading-snug text-[var(--text-secondary)] hover:border-[var(--accent-green)] hover:text-[var(--text-primary)] transition-colors";
const bubbleMuted =
  "inline-flex max-w-[min(100%,13rem)] min-h-[1.35rem] items-center rounded-full border border-dashed border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] leading-snug text-[var(--text-tertiary)] cursor-default";

function linkedInPathDisplay(url: string): string {
  const cleaned = url.replace(/\?.*$/, "").trim();
  try {
    const u = new URL(cleaned.startsWith("http") ? cleaned : `https://${cleaned}`);
    const path = u.pathname.replace(/^\//, "");
    const host = u.hostname.replace(/^www\./, "");
    const combined = path ? `${host}/${path}` : host;
    return combined.length > 52 ? `${combined.slice(0, 49)}…` : combined;
  } catch {
    return cleaned.length > 52 ? `${cleaned.slice(0, 49)}…` : cleaned;
  }
}

function memberIdChip(id: string): string {
  const t = id.trim();
  if (t.length <= 14) return t;
  return `${t.slice(0, 8)}…${t.slice(-4)}`;
}

function contactLinkedInBubbles(
  linkedinUrlRaw: string | null | undefined,
  linkedinProviderId: string | null | undefined
): LiBubble[] {
  const parsed = parsePersonLinkedInFields(linkedinUrlRaw, linkedinProviderId);
  const out: LiBubble[] = [];

  if (parsed.publicProfileUrl) {
    const href = parsed.publicProfileUrl;
    out.push({
      key: "public",
      href,
      text: linkedInPathDisplay(href),
      title: href,
    });
  }

  if (parsed.providerMemberId) {
    const id = parsed.providerMemberId;
    out.push({
      key: "member",
      text: memberIdChip(id),
      title: `LinkedIn member id (API / Unipile): ${id}`,
    });
  }

  const raw = (linkedinUrlRaw || "").trim();
  if (out.length === 0 && raw) {
    if (/^https?:\/\//i.test(raw)) {
      const href = raw.split("?")[0];
      out.push({
        key: "raw-url",
        href,
        text: linkedInPathDisplay(raw),
        title: raw,
      });
    } else {
      out.push({
        key: "raw",
        text: raw.length > 28 ? `${raw.slice(0, 25)}…` : raw,
        title: raw,
      });
    }
  }

  return out;
}

function singleUrlBubble(url: string, key: string): LiBubble {
  const href = url.startsWith("http") ? url.split("?")[0] : `https://${url.split("?")[0]}`;
  return {
    key,
    href,
    text: linkedInPathDisplay(href),
    title: href,
  };
}

function websiteBubbles(websiteUrl: string | null): LiBubble[] {
  const w = websiteUrl?.trim();
  if (!w) return [];
  return [singleUrlBubble(w, "web")];
}

function companyLinkedInBubbles(url: string | null): LiBubble[] {
  const u = url?.trim();
  if (!u) return [];
  return [singleUrlBubble(u, "li")];
}

function LinkBubbleRow({ items }: { items: LiBubble[] }) {
  if (items.length === 0) return <span className="text-[var(--text-tertiary)]">—</span>;
  return (
    <div className="flex flex-wrap gap-1 items-center min-w-0">
      {items.map((b) =>
        b.href ? (
          <a
            key={b.key}
            href={b.href}
            target="_blank"
            rel="noopener noreferrer"
            title={b.title}
            className={`${bubbleLink} shrink-0`}
          >
            <span className="truncate">{b.text}</span>
          </a>
        ) : (
          <span key={b.key} title={b.title} className={`${bubbleMuted} shrink-0`}>
            <span className="truncate">{b.text}</span>
          </span>
        )
      )}
    </div>
  );
}

function formatPersonName(c: ContactRow): string {
  const a = (c.firstName || "").trim();
  const b = (c.lastName || "").trim();
  const full = `${a} ${b}`.trim();
  return full || "—";
}

function buildContactsUrl(q: string, offset: number): string {
  const p = new URLSearchParams();
  p.set("limit", String(PAGE_SIZE));
  p.set("offset", String(offset));
  if (q) p.set("q", q);
  return `/api/crm/directory/contacts?${p.toString()}`;
}

function buildCompaniesUrl(q: string, offset: number): string {
  const p = new URLSearchParams();
  p.set("limit", String(PAGE_SIZE));
  p.set("offset", String(offset));
  if (q) p.set("q", q);
  return `/api/crm/directory/companies?${p.toString()}`;
}

export default function TimCrmPanel() {
  const [subTab, setSubTab] = useState<CrmSubTab>("contacts");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [contactsHasMore, setContactsHasMore] = useState(false);
  const [companiesHasMore, setCompaniesHasMore] = useState(false);
  const contactsNextOffsetRef = useRef(0);
  const companiesNextOffsetRef = useRef(0);

  const [contactsInitialLoading, setContactsInitialLoading] = useState(false);
  const [companiesInitialLoading, setCompaniesInitialLoading] = useState(false);
  const [contactsLoadingMore, setContactsLoadingMore] = useState(false);
  const [companiesLoadingMore, setCompaniesLoadingMore] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [inspectPersonId, setInspectPersonId] = useState<string | null>(null);

  const contactsAbortRef = useRef<AbortController | null>(null);
  const companiesAbortRef = useRef<AbortController | null>(null);
  const contactsLoadBusyRef = useRef(false);
  const companiesLoadBusyRef = useRef(false);

  const scrollRootRef = useRef<HTMLDivElement>(null);
  const contactsSentinelRef = useRef<HTMLDivElement>(null);
  const companiesSentinelRef = useRef<HTMLDivElement>(null);

  const {
    widths: contactColWidths,
    tableRef: contactsTableRef,
    startResize: contactStartResize,
  } = usePersistentResizableColumns(CRM_CONTACTS_COL_KEY, CRM_CONTACTS_COL_DEFAULTS);

  const {
    widths: companyColWidths,
    tableRef: companiesTableRef,
    startResize: companyStartResize,
  } = usePersistentResizableColumns(CRM_COMPANIES_COL_KEY, CRM_COMPANIES_COL_DEFAULTS);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadContactsInitial = useCallback(async () => {
    contactsAbortRef.current?.abort();
    const ac = new AbortController();
    contactsAbortRef.current = ac;
    setContactsInitialLoading(true);
    setContactsError(null);
    setContacts([]);
    setContactsHasMore(false);
    contactsNextOffsetRef.current = 0;

    try {
      const r = await fetch(buildContactsUrl(debouncedQ, 0), { signal: ac.signal });
      const data = await r.json().catch(() => ({}));
      if (ac.signal.aborted) return;
      if (!r.ok) {
        setContactsError(typeof data.error === "string" ? data.error : "Could not load contacts");
        return;
      }
      const rows = Array.isArray(data.contacts) ? data.contacts : [];
      setContacts(rows);
      setContactsHasMore(data.hasMore === true);
      contactsNextOffsetRef.current = typeof data.nextOffset === "number" ? data.nextOffset : rows.length;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setContactsError("Network error loading contacts");
      setContacts([]);
    } finally {
      if (!ac.signal.aborted) setContactsInitialLoading(false);
    }
  }, [debouncedQ]);

  const loadContactsMore = useCallback(async () => {
    if (!contactsHasMore || contactsLoadBusyRef.current || contactsInitialLoading) return;
    contactsLoadBusyRef.current = true;
    setContactsLoadingMore(true);
    setContactsError(null);
    try {
      const off = contactsNextOffsetRef.current;
      const r = await fetch(buildContactsUrl(debouncedQ, off), { signal: contactsAbortRef.current?.signal });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setContactsError(typeof data.error === "string" ? data.error : "Could not load more contacts");
        return;
      }
      const rows = Array.isArray(data.contacts) ? data.contacts : [];
      setContacts((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = [...prev];
        for (const row of rows) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            merged.push(row);
          }
        }
        return merged;
      });
      setContactsHasMore(data.hasMore === true);
      contactsNextOffsetRef.current =
        typeof data.nextOffset === "number" ? data.nextOffset : off + rows.length;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setContactsError("Network error loading contacts");
    } finally {
      contactsLoadBusyRef.current = false;
      setContactsLoadingMore(false);
    }
  }, [debouncedQ, contactsHasMore, contactsInitialLoading]);

  const loadCompaniesInitial = useCallback(async () => {
    companiesAbortRef.current?.abort();
    const ac = new AbortController();
    companiesAbortRef.current = ac;
    setCompaniesInitialLoading(true);
    setCompaniesError(null);
    setCompanies([]);
    setCompaniesHasMore(false);
    companiesNextOffsetRef.current = 0;

    try {
      const r = await fetch(buildCompaniesUrl(debouncedQ, 0), { signal: ac.signal });
      const data = await r.json().catch(() => ({}));
      if (ac.signal.aborted) return;
      if (!r.ok) {
        setCompaniesError(typeof data.error === "string" ? data.error : "Could not load companies");
        return;
      }
      const rows = Array.isArray(data.companies) ? data.companies : [];
      setCompanies(rows);
      setCompaniesHasMore(data.hasMore === true);
      companiesNextOffsetRef.current = typeof data.nextOffset === "number" ? data.nextOffset : rows.length;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setCompaniesError("Network error loading companies");
      setCompanies([]);
    } finally {
      if (!ac.signal.aborted) setCompaniesInitialLoading(false);
    }
  }, [debouncedQ]);

  const loadCompaniesMore = useCallback(async () => {
    if (!companiesHasMore || companiesLoadBusyRef.current || companiesInitialLoading) return;
    companiesLoadBusyRef.current = true;
    setCompaniesLoadingMore(true);
    setCompaniesError(null);
    try {
      const off = companiesNextOffsetRef.current;
      const r = await fetch(buildCompaniesUrl(debouncedQ, off), { signal: companiesAbortRef.current?.signal });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setCompaniesError(typeof data.error === "string" ? data.error : "Could not load more companies");
        return;
      }
      const rows = Array.isArray(data.companies) ? data.companies : [];
      setCompanies((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = [...prev];
        for (const row of rows) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            merged.push(row);
          }
        }
        return merged;
      });
      setCompaniesHasMore(data.hasMore === true);
      companiesNextOffsetRef.current =
        typeof data.nextOffset === "number" ? data.nextOffset : off + rows.length;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setCompaniesError("Network error loading companies");
    } finally {
      companiesLoadBusyRef.current = false;
      setCompaniesLoadingMore(false);
    }
  }, [debouncedQ, companiesHasMore, companiesInitialLoading]);

  useEffect(() => {
    if (subTab !== "contacts") return;
    void loadContactsInitial();
  }, [subTab, debouncedQ, loadContactsInitial]);

  useEffect(() => {
    if (subTab !== "companies") return;
    void loadCompaniesInitial();
  }, [subTab, debouncedQ, loadCompaniesInitial]);

  /** Infinite scroll: observe sentinel inside scroll root. */
  useEffect(() => {
    const root = scrollRootRef.current;
    const sentinel =
      subTab === "contacts" ? contactsSentinelRef.current : companiesSentinelRef.current;
    if (!root || !sentinel) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (subTab === "contacts") void loadContactsMore();
        else void loadCompaniesMore();
      },
      { root, rootMargin: "160px", threshold: 0 }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [subTab, loadContactsMore, loadCompaniesMore, contacts.length, companies.length, contactsHasMore, companiesHasMore]);

  const tabBtn = (active: boolean) =>
    `text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
      active
        ? "font-semibold text-[var(--text-primary)]"
        : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
    }`;

  const narrowTd = "px-1.5 py-1 align-top truncate overflow-hidden";
  const narrowTh =
    "font-semibold text-[var(--text-secondary)] px-1.5 py-1.5 text-left align-bottom truncate overflow-hidden";
  /** Matches centered icon buttons in the Inspect column body cells. */
  const inspectTh =
    "font-semibold text-[var(--text-secondary)] px-1.5 py-1.5 text-center align-bottom truncate overflow-hidden";
  const linkedInTh =
    "font-semibold text-[var(--text-secondary)] px-1.5 py-1.5 text-left align-bottom min-w-0 truncate overflow-hidden";

  const contactsLoading = contactsInitialLoading;
  const companiesLoading = companiesInitialLoading;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {inspectPersonId ? (
        <TimContactInspectModal personId={inspectPersonId} onClose={() => setInspectPersonId(null)} />
      ) : null}
      <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button type="button" className={tabBtn(subTab === "contacts")} onClick={() => setSubTab("contacts")}>
            Contacts
          </button>
          <button type="button" className={tabBtn(subTab === "companies")} onClick={() => setSubTab("companies")}>
            Companies
          </button>
        </div>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={
            subTab === "contacts"
              ? "Search name, company, package, stage, LinkedIn, email…"
              : "Search name, website, LinkedIn…"
          }
          className="w-full text-xs rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] px-2 py-1.5 placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]"
          aria-label="CRM directory search"
        />
      </div>

      <div ref={scrollRootRef} className="flex-1 min-h-0 overflow-auto">
        {subTab === "contacts" ? (
          <>
            {contactsLoading && contacts.length === 0 ? (
              <p className="text-xs text-[var(--text-tertiary)] p-3">Loading…</p>
            ) : contactsError && contacts.length === 0 ? (
              <p className="text-xs text-red-500/90 p-3">{contactsError}</p>
            ) : (
              <>
                <table
                  ref={contactsTableRef}
                  className="w-full table-fixed text-left text-[11px] border-collapse"
                >
                  <colgroup>
                    {contactColWidths.map((pct, i) => (
                      <col key={i} style={{ width: `${pct}%` }} />
                    ))}
                  </colgroup>
                  <thead className="sticky top-0 z-[1] bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                    <tr>
                      {CRM_CONTACTS_HEADERS.map((h, i) => {
                        const isInspectCol = i === 0;
                        const isLinkedInCol = i === CRM_CONTACTS_HEADERS.length - 1;
                        return (
                          <th
                            key={`crm-contact-h-${i}`}
                            title={h.title}
                            className={
                              isLinkedInCol
                                ? `relative ${linkedInTh}`
                                : isInspectCol
                                  ? `relative ${inspectTh} pr-2`
                                  : `relative ${narrowTh} pr-2`
                            }
                          >
                            {h.label}
                            {i < CRM_CONTACTS_HEADERS.length - 1 ? (
                              <ColumnResizeHandle onMouseDown={contactStartResize(i)} />
                            ) : null}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-2 py-4 text-[var(--text-tertiary)]">
                          {debouncedQ ? "No contacts match this search." : "No contacts found."}
                        </td>
                      </tr>
                    ) : (
                      contacts.map((c) => {
                        const pkg = (c.packageNames || "").trim();
                        const st = (c.packageStatus || "").trim();
                        return (
                          <tr key={c.id} className="border-b border-[var(--border-color)]/60 hover:bg-[var(--bg-secondary)]/40">
                            <td className="px-1 py-1.5 align-middle text-center w-10 min-w-[2.25rem]">
                              <button
                                type="button"
                                title={`Inspect ${formatPersonName(c)} — card & activity`}
                                aria-label={`Inspect contact ${formatPersonName(c)}`}
                                onClick={() => setInspectPersonId(c.id)}
                                className="inline-flex items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)]/50 p-1.5 text-[var(--accent-green)] hover:bg-[var(--bg-secondary)] hover:border-[var(--accent-green)]/40"
                              >
                                <TimInspectContactIcon className="w-4 h-4" />
                              </button>
                            </td>
                            <td className={`${narrowTd} text-[var(--text-primary)]`} title={formatPersonName(c)}>
                              {formatPersonName(c)}
                            </td>
                            <td className={`${narrowTd} text-[var(--text-secondary)]`} title={c.companyName?.trim() || ""}>
                              {c.companyName?.trim() || "—"}
                            </td>
                            <td className={`${narrowTd} text-[var(--text-secondary)]`} title={pkg}>
                              {pkg || "—"}
                            </td>
                            <td className={`${narrowTd} text-[var(--text-secondary)]`} title={st}>
                              {st || "—"}
                            </td>
                            <td className="px-1.5 py-1 align-top min-w-0">
                              <LinkBubbleRow
                                items={contactLinkedInBubbles(c.linkedinUrlRaw, c.linkedinProviderId ?? null)}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                {contactsError && contacts.length > 0 ? (
                  <p className="text-xs text-red-500/90 px-3 py-2">{contactsError}</p>
                ) : null}
                <div ref={contactsSentinelRef} className="min-h-6 flex items-center justify-center py-2" aria-hidden>
                  {contactsLoadingMore ? (
                    <span className="text-[10px] text-[var(--text-tertiary)]">Loading more…</span>
                  ) : contactsHasMore && contacts.length > 0 ? (
                    <span className="text-[10px] text-[var(--text-tertiary)] opacity-60">Scroll for more</span>
                  ) : null}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {companiesLoading && companies.length === 0 ? (
              <p className="text-xs text-[var(--text-tertiary)] p-3">Loading…</p>
            ) : companiesError && companies.length === 0 ? (
              <p className="text-xs text-red-500/90 p-3">{companiesError}</p>
            ) : (
              <>
                <table
                  ref={companiesTableRef}
                  className="w-full table-fixed text-left text-[11px] border-collapse"
                >
                  <colgroup>
                    {companyColWidths.map((pct, i) => (
                      <col key={i} style={{ width: `${pct}%` }} />
                    ))}
                  </colgroup>
                  <thead className="sticky top-0 z-[1] bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                    <tr>
                      {CRM_COMPANIES_HEADERS.map((h, i) => (
                        <th
                          key={h.label}
                          title={h.title}
                          className={
                            i < 2
                              ? `relative ${narrowTh} pr-2`
                              : "relative font-semibold text-[var(--text-secondary)] px-1.5 py-1.5 text-left min-w-0"
                          }
                        >
                          {h.label}
                          {i < 2 ? <ColumnResizeHandle onMouseDown={companyStartResize(i)} /> : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {companies.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-2 py-4 text-[var(--text-tertiary)]">
                          {debouncedQ ? "No companies match this search." : "No companies found."}
                        </td>
                      </tr>
                    ) : (
                      companies.map((c) => (
                        <tr key={c.id} className="border-b border-[var(--border-color)]/60 hover:bg-[var(--bg-secondary)]/40">
                          <td className={`${narrowTd} text-[var(--text-primary)]`} title={c.name || ""}>
                            {c.name || "—"}
                          </td>
                          <td className="px-1.5 py-1 align-top min-w-0 overflow-hidden">
                            <LinkBubbleRow items={websiteBubbles(c.websiteUrl)} />
                          </td>
                          <td className="px-1.5 py-1 align-top min-w-0">
                            <LinkBubbleRow items={companyLinkedInBubbles(c.linkedinUrl)} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {companiesError && companies.length > 0 ? (
                  <p className="text-xs text-red-500/90 px-3 py-2">{companiesError}</p>
                ) : null}
                <div ref={companiesSentinelRef} className="min-h-6 flex items-center justify-center py-2" aria-hidden>
                  {companiesLoadingMore ? (
                    <span className="text-[10px] text-[var(--text-tertiary)]">Loading more…</span>
                  ) : companiesHasMore && companies.length > 0 ? (
                    <span className="text-[10px] text-[var(--text-tertiary)] opacity-60">Scroll for more</span>
                  ) : null}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
