# Relay

A small local task board that hands tickets to a coding agent. Move a ticket to **Agent Ready** and Claude Code or Codex works on it end to end in the background, using your own subscription (no API key). When it's done, the ticket lands in **Review**, or **Blocked** if it needs you, with a final comment, any result files attached, and an optional push to your phone.

- Jira-style board: Backlog → Todo → Agent Ready → In Progress → Blocked → Review → Done
- Live log of the run next to the ticket, and a Stop button
- `@agent` comments steer a running ticket or send a finished one back to work
- Per-ticket permissions for outward actions (send, push, publish, merge, deploy, spend)
- Up to 3 tickets at once, queued by priority; waits out usage limits on its own

## Safety first

Relay runs the agent with **every permission prompt skipped** (`claude --dangerously-skip-permissions`, `codex --dangerously-bypass-approvals-and-sandbox`). The agent can run any command your user account can.

- Relay listens on `127.0.0.1` only and rejects requests from other sites. Never expose the port or put it behind a proxy.
- Outward actions (Send, Push, Publish, Merge, Deploy, Spend) are **off** on every new ticket. Turn on only what a ticket needs. The agent is told to respect them, but they're instructions, not a sandbox.
- Link a git repo to a ticket and the agent works in its own worktree on branch `relay/R-<n>`; it's told never to touch `main`.
- Spend caps rely on the agent's own tracking: Relay can't meter third-party usage.

## Requirements

- Windows 10/11. The core may run elsewhere, but the start/stop scripts and keep-awake are Windows-only and it's only tested on Windows.
- Node 24+ and pnpm
- At least one agent CLI, signed in:
  - [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`)
  - [Codex](https://github.com/openai/codex) (`npm i -g @openai/codex`, then `codex login`)

## Setup

```sh
git clone https://github.com/mohamedessambarakat/relay.git
cd relay
pnpm install
cp .env.example .env   # optional: set NTFY_TOPIC for phone pushes
pnpm build
pnpm start             # open http://localhost:8000
```

Then open **Settings** to pick the default agent (Claude Code or Codex) and models. Each ticket can override both.

### Phone notifications (optional)

Set `NTFY_TOPIC` in `.env` to a long random name and subscribe to it in the [ntfy](https://ntfy.sh) app. Relay sends the ticket title and status when a ticket reaches Review or Blocked, never its content. Anyone who knows the topic can read the pushes.

### Start at Windows login (optional)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
# undo: scripts\uninstall-autostart.ps1
```

This adds a shortcut to your Startup folder; output goes to `data\relay.log`.

### Desktop shortcut (optional)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-desktop-shortcut.ps1
```

Clicking **Relay** on the desktop starts Relay hidden in the background if it isn't running, then opens the board. Closing the browser doesn't stop it; `scripts\stop.ps1` does.

To run it in a terminal instead (to watch its output), stop the background copy first:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
pnpm start            # Ctrl+C to stop
```

## How a ticket runs

- Up to 3 tickets run at once. Others wait in Agent Ready, highest priority first, then oldest.
- Each ticket works in `workspaces/R-<n>`, or a git worktree on `relay/R-<n>` if you link a repo. Push only happens when Push is on.
- The agent uses your normal setup (global instructions, skills, MCP servers) plus Relay's own MCP tools to read the ticket, comment, attach files and set the status.
- It starts straight away and never asks. When something is unclear, it takes the option that's easiest to undo and says so in a comment.
- Comments are notes unless they mention `@agent`. Then they go into the running session, or send a Review/Blocked ticket back to work. Codex runs one turn at a time, so on a running Codex ticket the comment is sent when the current turn ends.
- With Spend on, the agent first lists the paid services it needs with an estimate, which becomes the max; you can change any max.
- Stop kills the run and moves the ticket to Blocked. A run that fails twice also goes to Blocked.
- If your usage limit is hit, the ticket waits for the reset and continues; nothing new starts until then.

## Configuration

`.env` (see `.env.example`):

| Variable | What it does |
|---|---|
| `RELAY_PORT` | Port to listen on (default 8000) |
| `NTFY_TOPIC`, `NTFY_SERVER` | Phone pushes via ntfy (off when empty) |
| `CLAUDE_BIN` | Path to the Claude CLI if it isn't found automatically |
| `CODEX_BIN` | Path to the Codex CLI (or its `codex.js`) if it isn't found automatically |

## Development

| Command | What it does |
|---|---|
| `pnpm dev` | Server with reload on :8000, board with hot reload on :5173 |
| `pnpm build` | Builds the board into `dist/board` |
| `pnpm start` | Runs Relay (serves the built board) |
| `pnpm test` | Vitest |
| `pnpm lint`, `pnpm typecheck` | ESLint, TypeScript |

Project rules and CLI quirks live in [CLAUDE.md](CLAUDE.md). To add another agent CLI, implement a provider in `src/agent/providers.ts`.

## Folders

| Folder | What's in it |
|---|---|
| `src/server/` | The web server: API, database, ticket rules, security checks |
| `src/agent/` | Runs the agent CLIs (Claude, Codex): the queue, workspaces, prompts, live log, notifications, keep-awake |
| `src/mcp/` | The Relay tools the agent uses during a run (comment, attach, set status, spend) |
| `src/board/` | The board you see in the browser (React) |
| `src/shared/` | Types shared by the server and the board |
| `scripts/` | Start, stop and auto-start scripts for Windows |
| `data/` | Database, attachments and logs (not in git) |
| `workspaces/` | One working folder per ticket (not in git) |

## License

[MIT](LICENSE)
