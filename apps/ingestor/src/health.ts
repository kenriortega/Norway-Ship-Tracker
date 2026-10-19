import { createServer, type Server } from "node:http";

export interface IngestorHealth {
  provider: "barentswatch";
  authenticated: boolean;
  streamConnected: boolean;
  startedAt: string;
  lastMessageAt: string | null;
  lastSourceTimestamp: string | null;
  processedMessages: number;
  invalidMessages: number;
  persistenceFailures: number;
  reconnects: number;
  lastError: string | null;
  lastMaintenanceAt: string | null;
  lastMaintenanceError: string | null;
  partitionsCreated: number;
  partitionsDropped: number;
}

export function initialHealth(): IngestorHealth {
  return {
    provider: "barentswatch",
    authenticated: false,
    streamConnected: false,
    startedAt: new Date().toISOString(),
    lastMessageAt: null,
    lastSourceTimestamp: null,
    processedMessages: 0,
    invalidMessages: 0,
    persistenceFailures: 0,
    reconnects: 0,
    lastError: null,
    lastMaintenanceAt: null,
    lastMaintenanceError: null,
    partitionsCreated: 0,
    partitionsDropped: 0,
  };
}

export function startHealthServer(port: number, health: IngestorHealth): Server {
  const server = createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(health.streamConnected ? 200 : 503, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(health));
  });

  server.listen(port, "0.0.0.0", () => {
    console.info(JSON.stringify({ event: "health_server_started", port }));
  });
  return server;
}
