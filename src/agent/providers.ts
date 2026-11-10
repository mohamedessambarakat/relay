import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderId } from "../shared/types.ts";
import { parseCodexLine, parseStreamLine, type StreamEvent } from "./stream.ts";

export interface McpCommand {
  command: string;
  args: string[];
}

/** Everything a provider needs to build one CLI launch. */
export interface LaunchInput {
  model: string | null;
  systemPrompt: string;
  runFile: (name: string) => string; // path for a per-run temp file, deleted when the run ends
  mcp: McpCommand & { env: Record<string, string> };
  resumeSession: string | null;
  agentsOverride: string | null;
}

export interface Launch {
  command: string;
  args: string[];
}

export interface Provider {
  id: ProviderId;
  label: string;
  /**
   * Persistent: one process for the whole run; messages go in over stdin and closing stdin ends it.
   * One-shot: one process per turn; the message is written once, and a follow-up resumes the session.
   */
  persistent: boolean;
  launch(input: LaunchInput): Launch;
  /** The line written to stdin to send a user message. */
  encodeMessage(text: string): string;
  parseLine(line: string): StreamEvent[];
}

/**
 * Relay may start at login with the plain Windows PATH, which doesn't include the
 * Claude CLI's install folder, so look in its default location before relying on PATH.
 */
export function claudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const local = path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  return fs.existsSync(local) ? local : "claude";
}

/**
 * npm installs Codex as a `.cmd` shim on Windows, which can't be spawned without a shell,
 * so run its JS entry point with Node instead.
 */
export function codexBin(): { command: string; prefix: string[] } {
  const configured = process.env.CODEX_BIN;
  if (configured) return configured.endsWith(".js") ? { command: process.execPath, prefix: [configured] } : { command: configured, prefix: [] };
  if (process.platform === "win32" && process.env.APPDATA) {
    const entry = path.join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
    if (fs.existsSync(entry)) return { command: process.execPath, prefix: [entry] };
  }
  return { command: "codex", prefix: [] };
}

export const claudeProvider: Provider = {
  id: "claude",
  label: "Claude",
  persistent: true,
  launch(input) {
    const promptFile = input.runFile("prompt.md");
    const mcpFile = input.runFile("mcp.json");
    fs.writeFileSync(promptFile, input.systemPrompt);
    fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { relay: input.mcp } }));
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--mcp-config", mcpFile,
      "--append-system-prompt-file", promptFile,
    ];
    if (input.model) args.push("--model", input.model);
    if (input.agentsOverride) args.push("--agents", input.agentsOverride);
    if (input.resumeSession) args.push("--resume", input.resumeSession);
    return { command: claudeBin(), args };
  },
  encodeMessage: (text) => JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n",
  parseLine: parseStreamLine,
};

/** A TOML string. JSON string escapes are valid TOML basic-string escapes. */
const toml = (s: string) => JSON.stringify(s);

export const codexProvider: Provider = {
  id: "codex",
  label: "Codex",
  persistent: false,
  launch(input) {
    const { command, prefix } = codexBin();
    const env = Object.entries(input.mcp.env).map(([k, v]) => `${k}=${toml(v)}`).join(",");
    const config = [
      `developer_instructions=${toml(input.systemPrompt)}`,
      `mcp_servers.relay.command=${toml(input.mcp.command)}`,
      `mcp_servers.relay.args=[${input.mcp.args.map(toml).join(",")}]`,
      `mcp_servers.relay.env={${env}}`,
    ];
    const args = [...prefix, "exec"];
    if (input.resumeSession) args.push("resume");
    args.push("--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox");
    for (const c of config) args.push("-c", c);
    if (input.model) args.push("-m", input.model);
    if (input.resumeSession) args.push(input.resumeSession);
    args.push("-"); // read the message from stdin
    return { command, args };
  },
  encodeMessage: (text) => text,
  parseLine: parseCodexLine,
};

export const PROVIDER_IMPLS: Record<ProviderId, Provider> = { claude: claudeProvider, codex: codexProvider };
