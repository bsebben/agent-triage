// Ping/pong liveness sweep for the dashboard's websocket clients.
//
// A browser tab that goes away without a clean close (laptop sleep, network
// drop, crashed renderer) leaves a half-open socket the server still counts as
// connected: broadcasts write into a void and the connection keeps holding a
// slot on both ends. Pinging every client and terminating the ones that missed
// the previous round-trip is the only way to notice.

export const HEARTBEAT_INTERVAL_MS = 30000;

export function sweepClients(wss) {
  let terminated = 0;
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      terminated++;
      continue;
    }
    client.isAlive = false;
    try {
      client.ping();
    } catch {}
  }
  return terminated;
}

export function startHeartbeat(wss, { intervalMs = HEARTBEAT_INTERVAL_MS } = {}) {
  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
  });

  const timer = setInterval(() => sweepClients(wss), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
