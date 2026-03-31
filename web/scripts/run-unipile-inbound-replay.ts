/**
 * CLI: replay recent inbound LinkedIn messages through handleUnipileWebhook (Tim queue + CRM).
 * Loads web/.env.local into process.env, then runs the same logic as POST /api/dev/replay-unipile-inbound.
 *
 * Usage (from web/):
 *   npm run dev:unipile-replay-queue -- --dry-run
 *   npm run dev:unipile-seed-tim-queue          # last 10 inbound → Tim (same DB as .env.local)
 *   npm run dev:unipile-export-inbound-sample   # JSON only, no CRM writes
 *
 *   npm run dev:unipile-replay-queue -- --max-inbound 10 --max-chats 30
 *   npm run dev:unipile-replay-queue -- --export-sample tmp/unipile-inbound-last10.json
 *
 * Writes require CRM_DB_HOST=127.0.0.1 (or localhost / ::1). Tunnel/Docker host.docker.internal
 * to production is blocked unless you set UNIPILE_REPLAY_ALLOW_REMOTE_CRM=1 for that shell only.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function applyEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("Missing web/.env.local");
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    const k = m[1];
    if (process.env[k] === undefined || process.env[k] === "") {
      process.env[k] = v;
    }
  }
}

function argNum(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  const n = parseInt(process.argv[i + 1], 10);
  return Number.isFinite(n) ? n : fallback;
}

function argStr(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return null;
  return process.argv[i + 1]!.trim() || null;
}

applyEnvLocal();

const dryRun = process.argv.includes("--dry-run");
const maxInbound = argNum("--max-inbound", 10);
const maxChats = argNum("--max-chats", 30);
const messagesPerChat = argNum("--messages-per-chat", 25);
const exportSamplePath = argStr("--export-sample");

async function main() {
  const {
    gatherUnipileInboundWebhookCandidates,
    replayRecentUnipileInboundAsWebhooks,
    takeLastNInboundCandidates,
  } = await import("../lib/unipile-inbound-replay");

  if (exportSamplePath) {
    const outAbs = path.isAbsolute(exportSamplePath)
      ? exportSamplePath
      : path.join(process.cwd(), exportSamplePath);
    console.log("[replay] EXPORT SAMPLE — no CRM writes");
    console.log(`[replay] maxChats=${maxChats} messagesPerChat=${messagesPerChat} maxInbound=${maxInbound}\n`);

    const gathered = await gatherUnipileInboundWebhookCandidates({
      maxChats,
      messagesPerChat,
    });
    if (!gathered.ok) {
      console.error(gathered.error);
      process.exit(1);
    }
    const slice = takeLastNInboundCandidates(gathered.candidates, maxInbound);
    const payload = {
      generatedAt: new Date().toISOString(),
      note: "Webhook-shaped payloads; replay with dev:unipile-replay-queue (no --dry-run) to push into Tim.",
      chatsScanned: gathered.chatsListed,
      inboundCandidatesTotal: gathered.candidates.length,
      exportedCount: slice.length,
      skippedOutboundApprox: gathered.skippedOutbound,
      items: slice.map((c) => ({
        chatId: c.chatId,
        sortKey: c.sortKey,
        preview: c.preview,
        webhookPayload: c.webhookPayload,
      })),
    };
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, JSON.stringify(payload, null, 2), "utf8");
    console.log(`Wrote ${slice.length} item(s) to ${outAbs}`);
    return;
  }

  console.log(
    dryRun
      ? "[replay] DRY RUN — no CRM / queue writes"
      : "[replay] LIVE — writing CRM notes and Tim queue via handleUnipileWebhook"
  );
  console.log(
    `[replay] maxChats=${maxChats} messagesPerChat=${messagesPerChat} maxInbound=${maxInbound}\n`
  );

  const result = await replayRecentUnipileInboundAsWebhooks({
    maxChats,
    messagesPerChat,
    maxInbound,
    dryRun,
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
