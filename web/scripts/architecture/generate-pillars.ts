/**
 * Generates nine McKinsey-style architecture views under public/architecture/pillars/
 * (Platform / Interfaces / Domain). Run from web/: npx tsx scripts/architecture/generate-pillars.ts
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_REGISTRY } from "../../lib/agent-registry";
import { getCronJobSeedMetadata } from "../../lib/cron-job-catalog";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, "..", "..");
const REPO_ROOT = join(WEB_ROOT, "..");
const OUT_DIR = join(WEB_ROOT, "public", "architecture", "pillars");

function banner(title: string, lines: string[]): string {
  return [
    "%% Auto-generated — npm run architecture:generate (web/)",
    `%% ${title}`,
    ...lines,
  ].join("\n");
}

function mermaidId(raw: string): string {
  const s = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(s) ? `T_${s}` : s;
}

/** Minimal docker-compose service + depends_on parser (sufficient for root compose). */
function parseComposeServices(composePath: string): {
  name: string;
  dependsOn: string[];
}[] {
  const text = readFileSync(composePath, "utf8");
  const lines = text.split(/\r?\n/);
  const services: { name: string; dependsOn: string[] }[] = [];
  let inServices = false;
  let current: { name: string; dependsOn: string[] } | null = null;
  let inDepends = false;
  let dependsBaseIndent = 0;

  for (const line of lines) {
    if (!inServices) {
      if (line.trim() === "services:") inServices = true;
      continue;
    }
    if (/^[a-zA-Z_][a-zA-Z0-9_]*:\s*$/.test(line) && !line.startsWith(" ")) {
      break;
    }
    const svcLine = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (svcLine && !line.startsWith("    ")) {
      current = { name: svcLine[1], dependsOn: [] };
      services.push(current);
      inDepends = false;
      continue;
    }
    if (!current) continue;
    const t = line.trim();
    if (t.startsWith("depends_on:")) {
      inDepends = true;
      dependsBaseIndent = line.length - line.trimStart().length;
      continue;
    }
    if (inDepends) {
      const indent = line.length - line.trimStart().length;
      if (t === "" || t.startsWith("#")) continue;
      if (indent <= dependsBaseIndent && !t.startsWith("-")) {
        inDepends = false;
        continue;
      }
      const listM = line.match(/^\s+-\s+([a-zA-Z0-9_-]+)\s*$/);
      if (listM) {
        current.dependsOn.push(listM[1]);
        continue;
      }
      const keyM = line.match(/^\s{4,}([a-zA-Z0-9_-]+):\s*$/);
      if (keyM && indent > dependsBaseIndent) {
        current.dependsOn.push(keyM[1]);
        continue;
      }
    }
  }
  return services;
}

function generate1a(): string {
  const composePath = join(REPO_ROOT, "docker-compose.yml");
  const services = parseComposeServices(composePath);
  const nodes = services.map((s) => `    ${mermaidId(s.name)}["${s.name}"]`);
  const edges: string[] = [];
  for (const s of services) {
    for (const d of s.dependsOn) {
      edges.push(`    ${mermaidId(s.name)} --> ${mermaidId(d)}`);
    }
  }
  const note =
    "Derived from root docker-compose.yml (services + depends_on). Ports/volumes: see compose file.";
  return banner("1a Platform — runtime topology", [
    "flowchart TB",
    `    subgraph svc["Docker Compose services"]`,
    ...nodes,
    ...edges,
    "    end",
    `    N["${note.replace(/"/g, "'")}"]`,
    "    style N fill:#fff,stroke:#94a3b8",
  ]);
}

function extractPublicPathPatterns(middlewarePath: string): string[] {
  const text = readFileSync(middlewarePath, "utf8");
  const patterns: string[] = [];
  const re =
    /pathname\s*(?:===|\.startsWith)\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    patterns.push(m[1]);
  }
  return [...new Set(patterns)].sort();
}

function generate1b(): string {
  const mw = join(WEB_ROOT, "middleware.ts");
  const paths = extractPublicPathPatterns(mw);
  const pathLines = paths.map((p) => `    P_${mermaidId(p)}["${p}"]`);
  return banner("1b Platform — edge & session boundary", [
    "flowchart LR",
    "    subgraph edge[\"Edge / middleware\"] ",
    '    MW["Next.js middleware + Auth.js"]',
    "    end",
    "    subgraph pub[\"Public path patterns (isPublicPath)\"] ",
    ...pathLines,
    "    end",
    "    MW --> pub",
    '    NOTE["Session required elsewhere; INTERNAL_API_KEY + Unipile resolve bypass documented in middleware.ts"]',
    "    style NOTE fill:#fff8e1,stroke:#ca8a04",
  ]);
}

function parseEnvExample(envPath: string): { key: string; commented: boolean }[] {
  if (!existsSync(envPath)) return [];
  const text = readFileSync(envPath, "utf8");
  const rows: { key: string; commented: boolean }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("# ---")) continue;
    let commented = false;
    let rest = t;
    if (rest.startsWith("#")) {
      commented = true;
      rest = rest.slice(1).trim();
    }
    const km = rest.match(/^([A-Z][A-Z0-9_]*)\s*=/);
    if (km) rows.push({ key: km[1], commented });
  }
  return rows;
}

function generate1c(): string {
  const rows = parseEnvExample(join(WEB_ROOT, ".env.local.example"));
  const byPrefix = new Map<string, { key: string; commented: boolean }[]>();
  for (const r of rows) {
    const prefix = r.key.split("_")[0] || "OTHER";
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix)!.push(r);
  }
  const subgraphs: string[] = [];
  let idx = 0;
  for (const [prefix, list] of [...byPrefix.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    idx += 1;
    const sg = `subgraph G${idx}["${prefix}… (${list.length})"]`;
    const nodes = list.slice(0, 24).map((r) => {
      const id = `E_${mermaidId(r.key)}`;
      return `        ${id}["${r.key}"]`;
    });
    subgraphs.push(`    ${sg}`, ...nodes, "    end");
    if (list.length > 24) {
      subgraphs.push(`    MORE${idx}["… +${list.length - 24} more in .env.local.example"]`);
    }
  }
  return banner("1c Platform — configuration surface (.env.local.example)", [
    "flowchart TB",
    ...subgraphs,
    '    SRC["Source: web/.env.local.example — commented keys shown dashed in legend only; see file for docs"]',
    "    style SRC fill:#f1f5f9,stroke:#64748b",
  ]);
}

function walkFiles(dir: string, pred: (p: string) => boolean): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      out.push(...walkFiles(p, pred));
    } else if (pred(p)) out.push(p);
  }
  return out;
}

function endsWithPath(file: string, suffix: string): boolean {
  const norm = file.replace(/\\/g, "/");
  return norm.endsWith(suffix);
}

function extractRouteExports(ts: string): string[] {
  const methods: string[] = [];
  for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`).test(ts)) {
      methods.push(m);
    }
  }
  return methods;
}

function generate2a(): string {
  const apiRoot = join(WEB_ROOT, "app", "api");
  const routes = walkFiles(apiRoot, (p) => endsWithPath(p, "route.ts"));
  const bySeg = new Map<string, { rel: string; methods: string[] }[]>();
  for (const file of routes.sort()) {
    const rel = relative(apiRoot, file).replace(/\\/g, "/");
    const dir = dirname(rel);
    const seg = dir.split("/")[0] || "api";
    const text = readFileSync(file, "utf8");
    const methods = extractRouteExports(text);
    if (!bySeg.has(seg)) bySeg.set(seg, []);
    bySeg.get(seg)!.push({ rel: `/${dir}`, methods });
  }
  const lines: string[] = ["flowchart TB"];
  let g = 0;
  for (const [seg, entries] of [...bySeg.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    g += 1;
    lines.push(`    subgraph A${g}["/api/${seg}"]`);
    const slice = entries.slice(0, 40);
    for (const e of slice) {
      const methods = e.methods.length ? e.methods.join(",") : "?";
      const id = mermaidId(e.rel.replace(/\//g, "_"));
      lines.push(`        R_${id}["${e.rel}<br/><small>${methods}</small>"]`);
    }
    if (entries.length > 40) {
      lines.push(`        MORE_A${g}["… ${entries.length - 40} more routes"]`);
    }
    lines.push("    end");
  }
  lines.push(
    '    LEG["Derived from app/api/**/route.ts exports (GET/POST/…)."]',
    "    style LEG fill:#eef2ff,stroke:#6366f1"
  );
  return banner("2a Interfaces — HTTP API surface", lines);
}

function generate2b(): string {
  const apiRoot = join(WEB_ROOT, "app", "api");
  const allRoutes = walkFiles(apiRoot, (p) => endsWithPath(p, "route.ts"));
  const wh = allRoutes.filter((p) => {
    const r = relative(apiRoot, p).replace(/\\/g, "/");
    return r.startsWith("webhooks/");
  });
  const crApi = allRoutes.filter((p) => {
    const r = relative(apiRoot, p).replace(/\\/g, "/");
    return r.startsWith("cron/");
  });
  const devApi = allRoutes.filter((p) => {
    const r = relative(apiRoot, p).replace(/\\/g, "/");
    return r.startsWith("dev/");
  });
  const seeds = getCronJobSeedMetadata();
  const lines: string[] = ["flowchart TB", '    subgraph WH["/api/webhooks"]'];
  for (const f of wh.sort()) {
    const rel = relative(apiRoot, f).replace(/\\/g, "/");
    const dir = dirname(rel);
    lines.push(`        W_${mermaidId(dir)}["/${dir}"]`);
  }
  if (wh.length === 0) lines.push('        W0["(none)"]');
  lines.push("    end");
  lines.push('    subgraph CRAPI["/api/cron (HTTP control plane)"]');
  for (const f of crApi.sort()) {
    const rel = relative(apiRoot, f).replace(/\\/g, "/");
    const dir = dirname(rel);
    lines.push(`        CP_${mermaidId(dir)}["/${dir}"]`);
  }
  if (crApi.length === 0) lines.push('        CP0["(none)"]');
  lines.push("    end");
  lines.push('    subgraph DEVAPI["/api/dev (operator routes)"]');
  for (const f of devApi.sort().slice(0, 25)) {
    const rel = relative(apiRoot, f).replace(/\\/g, "/");
    const dir = dirname(rel);
    lines.push(`        D_${mermaidId(dir)}["/${dir}"]`);
  }
  if (devApi.length > 25) {
    lines.push(`        DMORE["… +${devApi.length - 25} dev routes"]`);
  }
  if (devApi.length === 0) lines.push('        D0["(none)"]');
  lines.push("    end");
  lines.push('    subgraph CR["node-cron jobs (catalog)"]');
  for (const j of seeds) {
    const label = `${j.id}<br/><small>${j.schedule} · ${j.agentId}</small>`;
    lines.push(`        C_${mermaidId(j.id)}["${label}"]`);
  }
  lines.push("    end");
  lines.push(
    '    N["Catalog: web/lib/cron-job-catalog.ts · handlers: web/lib/cron.ts"]',
    "    style N fill:#fef3c7,stroke:#d97706"
  );
  return banner("2b Interfaces — async, webhooks, crons", lines);
}

function generate2c(): string {
  const appRoot = join(WEB_ROOT, "app");
  const pages = walkFiles(appRoot, (p) => {
    if (!endsWithPath(p, "page.tsx")) return false;
    const r = relative(appRoot, p).replace(/\\/g, "/");
    return !r.startsWith("api/");
  });
  const paths = pages
    .map((p) => {
      const r = relative(appRoot, dirname(p)).replace(/\\/g, "/");
      return r === "." ? "/" : `/${r}`;
    })
    .filter((p, i, a) => a.indexOf(p) === i)
    .sort();
  const lines: string[] = ["flowchart TB", '    subgraph PG["App Router pages (page.tsx)"]'];
  for (const path of paths.slice(0, 60)) {
    lines.push(`        P_${mermaidId(path)}["${path}"]`);
  }
  if (paths.length > 60) {
    lines.push(`        MORE_P["… +${paths.length - 60} paths"]`);
  }
  lines.push("    end");
  lines.push(
    '    LEG["Command Central shell lives in app/CommandCentralClient.tsx — not every page is linked from nav."]',
    "    style LEG fill:#ecfdf5,stroke:#059669"
  );
  return banner("2c Interfaces — client routes / pages", lines);
}

function generate3a(): string {
  const scriptsDir = join(WEB_ROOT, "scripts");
  const sqlFiles = walkFiles(scriptsDir, (p) =>
    /migrate.*\.sql$/i.test(p)
  ).sort();
  const createTableRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))/gi;
  const tables = new Set<string>();
  for (const f of sqlFiles) {
    const text = readFileSync(f, "utf8");
    let m: RegExpExecArray | null;
    const re = new RegExp(createTableRe.source, "gi");
    while ((m = re.exec(text)) !== null) {
      const name = (m[1] || m[2] || "").trim();
      if (name) tables.add(name);
    }
  }
  const sorted = [...tables].sort();
  const lines: string[] = ["flowchart LR", '    subgraph TBL["Tables from web/scripts/migrate*.sql"]'];
  for (const t of sorted) {
    lines.push(`        TB_${mermaidId(t)}["${t}"]`);
  }
  lines.push("    end");
  lines.push(
    '    N["No inferred FK graph — add FKs or a schema manifest later for ER edges."]',
    "    style N fill:#fff7ed,stroke:#ea580c"
  );
  return banner("3a Domain — persisted tables (SQL migrations)", lines);
}

function generate3b(): string {
  const lines: string[] = ["flowchart TB"];
  const agents = Object.values(AGENT_REGISTRY).sort((a, b) => a.id.localeCompare(b.id));
  for (const a of agents) {
    const tools = (a.tools ?? []).join(", ");
    const delegates = a.delegation?.canDelegateTo?.join(", ") ?? "—";
    const id = mermaidId(a.id);
    lines.push(`    subgraph AG_${id}["${a.name} (${a.id})"]`);
    lines.push(`        T_${id}["tools: ${tools.slice(0, 200)}${tools.length > 200 ? "…" : ""}"]`);
    lines.push(`        D_${id}["delegates → ${delegates}"]`);
    lines.push("    end");
  }
  lines.push(
    '    SRC["Source: web/lib/agent-registry.ts"]',
    "    style SRC fill:#ede9fe,stroke:#7c3aed"
  );
  return banner("3b Domain — agents, tools, delegation", lines);
}

function runDepcruise(): void {
  const depDir = join(WEB_ROOT, "public", "architecture", "depcruise");
  mkdirSync(depDir, { recursive: true });
  const cfg = join(WEB_ROOT, ".dependency-cruiser.cjs");
  const bin = join(WEB_ROOT, "node_modules", ".bin", "depcruise");
  if (!existsSync(bin)) {
    console.warn("[architecture] dependency-cruiser not installed; skip 3c");
    return;
  }
  const run = (out: string, ...targets: string[]) => {
    execFileSync(
      bin,
      [
        "--config",
        cfg,
        "--output-type",
        "mermaid",
        "--output-to",
        out,
        "--collapse",
        "2",
        ...targets,
      ],
      { cwd: WEB_ROOT, stdio: "inherit" }
    );
  };
  run(join(depDir, "graph.mmd"), "app", "components", "lib");
  run(join(depDir, "graph-lib.mmd"), "lib");
}

function finalize3c(): void {
  const src = join(WEB_ROOT, "public", "architecture", "depcruise", "graph.mmd");
  const dest = join(OUT_DIR, "3c-module-boundaries.mmd");
  if (!existsSync(src)) {
    writeFileSync(
      dest,
      banner("3c Domain — module boundaries", [
        "flowchart TB",
        '    X["Run npm run architecture:generate (from web/) to produce dependency-cruiser output."]',
      ])
    );
    return;
  }
  const body = readFileSync(src, "utf8");
  writeFileSync(
    dest,
    [
      "%% Auto-generated — npm run architecture:generate (web/)",
      "%% 3c Domain — module boundaries (dependency-cruiser, collapse 2: app + components + lib)",
      body,
    ].join("\n")
  );
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "1a-runtime-topology.mmd"), generate1a());
  writeFileSync(join(OUT_DIR, "1b-edge-trust.mmd"), generate1b());
  writeFileSync(join(OUT_DIR, "1c-config-env.mmd"), generate1c());
  writeFileSync(join(OUT_DIR, "2a-api-surface.mmd"), generate2a());
  writeFileSync(join(OUT_DIR, "2b-async-webhooks-cron.mmd"), generate2b());
  writeFileSync(join(OUT_DIR, "2c-client-navigation.mmd"), generate2c());
  writeFileSync(join(OUT_DIR, "3a-data-model.mmd"), generate3a());
  writeFileSync(join(OUT_DIR, "3b-agents-tools.mmd"), generate3b());
  runDepcruise();
  finalize3c();
  console.log(`[architecture] Wrote pillar diagrams to ${relative(WEB_ROOT, OUT_DIR)}/`);
}

main();
