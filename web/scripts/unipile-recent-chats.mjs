/**
 * Dev helper: list recent LinkedIn chats and last N messages per chat (Unipile API).
 * Run from web/: npm run dev:unipile-recent
 *
 * Requires in .env.local (or process env): UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_ACCOUNT_ID
 *
 * Optional args: node scripts/unipile-recent-chats.mjs [chatLimit] [messagesPerChat]
 * Defaults: 5 chats, 10 messages each.
 */
import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");

function parseEnvLocal(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const file = parseEnvLocal(envPath);
const pick = (k, def = "") => {
  const v = process.env[k]?.trim();
  if (v) return v;
  return file[k]?.trim() || def;
};

function normalizeDsn(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/^https?:\/\//i, "");
  return s.split("/")[0]?.trim() ?? "";
}

function httpsGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: "GET", headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode || 0, body: data, raw: true });
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

const apiKey = pick("UNIPILE_API_KEY");
const dsn = normalizeDsn(pick("UNIPILE_DSN"));
const accountId = pick("UNIPILE_ACCOUNT_ID");
const chatLimit = Math.min(50, Math.max(1, parseInt(process.argv[2] || "5", 10) || 5));
const msgLimit = Math.min(50, Math.max(1, parseInt(process.argv[3] || "10", 10) || 10));

if (!apiKey || !dsn || !accountId) {
  console.error("Missing UNIPILE_API_KEY, UNIPILE_DSN, or UNIPILE_ACCOUNT_ID (.env.local or env).");
  process.exit(1);
}

const base = `https://${dsn}`;
const headers = {
  "X-API-KEY": apiKey,
  accept: "application/json",
};

const listUrl = `${base}/api/v1/chats?account_id=${encodeURIComponent(accountId)}&account_type=LINKEDIN&limit=${chatLimit}`;

console.log("GET", listUrl.replace(apiKey, "***"));
const listRes = await httpsGetJson(listUrl, headers);
if (listRes.status !== 200) {
  console.error("List chats failed:", listRes.status, listRes.body);
  process.exit(1);
}

const items = listRes.body?.items || listRes.body?.data || [];
const chats = Array.isArray(items) ? items : [];
console.log("\nChats:", chats.length, `(limit ${chatLimit})\n`);

for (let i = 0; i < chats.length; i++) {
  const c = chats[i];
  const chatId = c.id || c.chat_id;
  const name = c.name || c.subject || c.title || "(no name)";
  console.log(`--- [${i + 1}] ${name}`);
  console.log("    id:", chatId);
  if (!chatId) continue;
  const msgUrl = `${base}/api/v1/chats/${encodeURIComponent(chatId)}/messages?limit=${msgLimit}`;
  const msgRes = await httpsGetJson(msgUrl, headers);
  if (msgRes.status !== 200) {
    console.log("    messages: HTTP", msgRes.status);
    continue;
  }
  const msgs = msgRes.body?.items || msgRes.body?.data || [];
  const arr = Array.isArray(msgs) ? msgs : [];
  console.log(`    last ${arr.length} message(s):`);
  for (const m of arr.slice(-msgLimit)) {
    const text = (m.text || m.message || m.body || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const ts = m.timestamp || m.created_at || "";
    const dir = m.is_sender === 1 || m.from_me ? "out" : "in";
    console.log(`      [${dir}] ${ts} ${text}${text.length >= 120 ? "…" : ""}`);
  }
}

console.log("\nDone. Adjust chat/message limits: node scripts/unipile-recent-chats.mjs 10 15");
console.log(
  "Tim queue from real DMs: npm run dev:unipile-seed-tim-queue  (last 10 inbound → same path as webhooks; needs CRM + UNIPILE_REPLAY_ALLOW_REMOTE_CRM if not loopback)."
);
console.log(
  "JSON sample only: npm run dev:unipile-export-inbound-sample  → tmp/unipile-inbound-last10.json"
);
