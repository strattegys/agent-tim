/**
 * Lightweight HTTP server for receiving Unipile webhooks.
 * Runs alongside the Slack Gateway's Socket Mode connections.
 */
import http from "http";
import { handleUnipileWebhook } from "./linkedin-inbound.js";

const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || "18800", 10);
const WEBHOOK_SECRET = process.env.UNIPILE_WEBHOOK_SECRET || "";

export function startWebhookServer(): void {
  const server = http.createServer(async (req, res) => {
    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // Unipile webhook endpoint
    if (req.method === "POST" && req.url === "/webhooks/unipile") {
      // Validate secret if configured
      if (WEBHOOK_SECRET && req.headers["unipile-auth"] !== WEBHOOK_SECRET) {
        console.warn("[webhook] Invalid Unipile-Auth header");
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }

      // Read body
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        // Respond 200 immediately — Unipile retries on timeout
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));

        // Process async
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          handleUnipileWebhook(body).catch((err) =>
            console.error("[webhook] Processing error:", err)
          );
        } catch (err) {
          console.error("[webhook] JSON parse error:", err);
        }
      });
      return;
    }

    // 404 for anything else
    res.writeHead(404);
    res.end("Not Found");
  });

  server.listen(WEBHOOK_PORT, () => {
    console.log(`[webhook] Listening on port ${WEBHOOK_PORT}`);
  });
}
