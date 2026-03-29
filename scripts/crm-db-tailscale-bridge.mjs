#!/usr/bin/env node
/**
 * TCP bridge: local 0.0.0.0:PORT -> CRM Postgres on the tailnet (no SSH).
 * Use with Docker dev: container hits host.docker.internal:5433; this process
 * forwards to droplet CRM_DB_TAILSCALE_HOST:5432 (Tailscale must be up on PC).
 *
 * Uses explicit byte relay (not stream.pipe) so half-close/FIN handling matches
 * long-lived Postgres pooled connections — default duplex pipe can yield
 * "Connection terminated unexpectedly" on the client.
 *
 *   cd COMMAND-CENTRAL && node scripts/crm-db-tailscale-bridge.mjs
 *   # or from web/:  npm run db:bridge
 *
 * Env: CRM_TUNNEL_LOCAL_PORT | CRM_BRIDGE_LOCAL_PORT (default 5433),
 *      CRM_DB_TAILSCALE_HOST | CC_TAILSCALE_IP (default 100.74.54.12),
 *      CRM_BRIDGE_REMOTE_PORT (default 5432), CRM_BRIDGE_BIND (default 0.0.0.0)
 *
 * Droplet must expose Postgres on the tailnet:  cd /opt/agent-tim && bash tools/expose-crm-db-tailscale.sh
 */
import net from "net";

const localHost = process.env.CRM_BRIDGE_BIND || "0.0.0.0";
const localPort = parseInt(
  process.env.CRM_TUNNEL_LOCAL_PORT ||
    process.env.CRM_BRIDGE_LOCAL_PORT ||
    "5433",
  10
);
const remoteHost = (
  process.env.CRM_DB_TAILSCALE_HOST ||
  process.env.CC_TAILSCALE_IP ||
  "100.74.54.12"
).trim();
const remotePort = parseInt(process.env.CRM_BRIDGE_REMOTE_PORT || "5432", 10);

if (!remoteHost) {
  console.error("crm-db-tailscale-bridge: set CRM_DB_TAILSCALE_HOST or CC_TAILSCALE_IP");
  process.exit(1);
}

/** Relay one socket to another; end/close/error tear down both sides once. */
function relayPair(a, b) {
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    try {
      a.destroy();
    } catch {
      /* ignore */
    }
    try {
      b.destroy();
    } catch {
      /* ignore */
    }
  }

  a.on("data", (chunk) => {
    if (!b.writableEnded && !b.destroyed) {
      const ok = b.write(chunk);
      if (!ok) a.pause();
    }
  });
  b.on("drain", () => a.resume());

  b.on("data", (chunk) => {
    if (!a.writableEnded && !a.destroyed) {
      const ok = a.write(chunk);
      if (!ok) b.pause();
    }
  });
  a.on("drain", () => b.resume());

  a.on("end", () => {
    if (!b.destroyed && !b.writableEnded) b.end();
  });
  b.on("end", () => {
    if (!a.destroyed && !a.writableEnded) a.end();
  });

  a.on("error", finish);
  b.on("error", finish);
  a.on("close", finish);
  b.on("close", finish);
}

const server = net.createServer((client) => {
  const upstream = net.connect(
    { port: remotePort, host: remoteHost, keepAlive: true },
    () => {
      if (client.destroyed) {
        upstream.destroy();
        return;
      }
      client.setNoDelay(true);
      upstream.setNoDelay(true);
      client.setKeepAlive(true, 10_000);
      upstream.setKeepAlive(true, 10_000);
      relayPair(client, upstream);
    }
  );

  upstream.on("error", () => {
    try {
      client.destroy();
    } catch {
      /* ignore */
    }
  });
  client.on("error", () => {
    try {
      upstream.destroy();
    } catch {
      /* ignore */
    }
  });
});

server.on("error", (err) => {
  console.error("crm-db-tailscale-bridge listen error:", err.message);
  process.exit(1);
});

server.listen(localPort, localHost, () => {
  console.error(
    `[crm-db-tailscale-bridge] ${localHost}:${localPort} -> ${remoteHost}:${remotePort} (Ctrl+C to stop)`
  );
});
