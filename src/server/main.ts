import { serve } from "@hono/node-server";
import fs from "node:fs";
import path from "node:path";
import { openDb } from "./db.ts";
import { EventBus } from "./events.ts";
import { Store } from "./store.ts";
import { createApp } from "./app.ts";
import { Runner } from "../agent/runner.ts";
import { ModelSettings } from "../agent/models.ts";
import { ntfyNotifier } from "../agent/notify.ts";
import { KeepAwake } from "../agent/keepawake.ts";

const root = path.resolve(import.meta.dirname, "../..");
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.RELAY_PORT ?? 4317);
const dataDir = path.join(root, "data");
const boardDir = path.join(root, "dist", "board");

const bus = new EventBus();
const store = new Store(openDb(path.join(dataDir, "relay.db")), bus);
const models = new ModelSettings(store);
const keepAwake = new KeepAwake();
const notifier = ntfyNotifier(process.env.NTFY_TOPIC, process.env.NTFY_SERVER || undefined);
const runner = new Runner({
  store,
  models,
  notifier,
  keepAwake,
  serverUrl: `http://127.0.0.1:${port}`,
  workspacesDir: path.join(root, "workspaces"),
  runFilesDir: path.join(dataDir, "runs"),
});

const app = createApp({
  store,
  bus,
  runner,
  models,
  port,
  attachmentsDir: path.join(dataDir, "attachments"),
  boardDir: fs.existsSync(path.join(boardDir, "index.html")) ? boardDir : undefined,
});

// Localhost only: anything that can reach Relay can run Claude with full permissions.
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
  console.log(`[relay] listening on http://localhost:${port}`);
  if (!notifier.enabled) console.log("[relay] NTFY_TOPIC isn't set, so phone pushes are off");
  runner.recover();
});

const shutdown = () => {
  keepAwake.set(false);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
