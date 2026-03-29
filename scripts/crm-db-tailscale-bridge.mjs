#!/usr/bin/env node
/**
 * TCP bridge: local 0.0.0.0:PORT -> CRM Postgres on the tailnet (no SSH).
 * Docker dev: container uses host.docker.internal:5433.
 *
 * pauseOnConnect + resume after upstream is ready avoids losing the Postgres startup packet.
 *
 *   cd COMMAND-CENTRAL && node scripts/crm-db-tailscale-bridge.mjs
 *
 * Env: CRM_TUNNEL_LOCAL_PORT | CRM_BRIDGE_LOCAL_PORT (default 5433),
 *      CRM_DB_TAILSCALE_HOST | CC_TAILSCALE_IP (default 100.74.54.12),
 *      CRM_BRIDGE_REMOTE_PORT (default 5432), CRM_BRIDGE_BIND (default 0.0.0.0)
 *
 * Droplet:  cd /opt/agent-tim && bash tools/expose-crm-db-tailscale.sh
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

const server = net.createServer({ pauseOnConnect: true }, (client) => {
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
      client.resume();
      client.pipe(upstream);
      upstream.pipe(client);
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
