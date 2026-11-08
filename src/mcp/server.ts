/**
 * Relay MCP server: the tools Claude uses to talk to Relay during a run.
 * Started by Claude (stdio) with RELAY_URL and a per-run RELAY_TOKEN that only works for one ticket.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const url = process.env.RELAY_URL;
const token = process.env.RELAY_TOKEN;
if (!url || !token) {
  console.error("RELAY_URL and RELAY_TOKEN must be set");
  process.exit(1);
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<ToolResult> {
  try {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
      } catch {
        /* keep raw text */
      }
      return { content: [{ type: "text", text: `Relay refused (${res.status}): ${message}` }], isError: true };
    }
    return { content: [{ type: "text", text: text || "ok" }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Couldn't reach Relay: ${(err as Error).message}` }], isError: true };
  }
}

const server = new McpServer({ name: "relay", version: "0.1.0" });

server.registerTool(
  "get_ticket",
  { description: "Get this ticket: description, toggles, comments, attachments and spend limits." },
  () => call("GET", "/api/agent/ticket"),
);

server.registerTool(
  "add_comment",
  {
    description: "Post a comment on this ticket (markdown). Use it for decisions, progress, and the final report.",
    inputSchema: { body: z.string().min(1).max(20000) },
  },
  ({ body }) => call("POST", "/api/agent/comments", { body }),
);

server.registerTool(
  "add_attachment",
  {
    description: "Attach a file to this ticket for the user. Give an absolute path. Max 25 MB.",
    inputSchema: { path: z.string().min(1), name: z.string().optional().describe("Display name; defaults to the file name") },
  },
  (args) => call("POST", "/api/agent/attachments", args),
);

server.registerTool(
  "set_status",
  {
    description: "Last step of a run: move the ticket to review (done) or blocked (needs the user). Post the final comment first. This ends the run.",
    inputSchema: { status: z.enum(["review", "blocked"]) },
  },
  ({ status }) => call("POST", "/api/agent/status", { status }),
);

server.registerTool(
  "set_spend_plan",
  {
    description:
      "Before any paid work: declare each paid service you'll use, its unit (USD, credits, …), what it's for, and your estimate of what the task needs. The estimate becomes the max unless the user changes it.",
    inputSchema: {
      items: z.array(
        z.object({ service: z.string(), unit: z.string(), reason: z.string(), estimate: z.number().min(0) }),
      ),
    },
  },
  ({ items }) => call("POST", "/api/agent/spend-plan", { items }),
);

server.registerTool(
  "report_spend",
  {
    description: "Record an amount you're about to spend (or just spent) on a declared service. Refused if it would pass the max.",
    inputSchema: { service: z.string(), amount: z.number().positive() },
  },
  (args) => call("POST", "/api/agent/spend", args),
);

await server.connect(new StdioServerTransport());
