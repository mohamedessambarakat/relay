# Relay

Minimal local task board (Jira/Linear-style) for one person. Moving a ticket to **Agent Ready** makes a coding agent work on it end to end in the background, using the user's own subscription: Claude Code via headless `claude -p`, or Codex via `codex exec`. Not an API key. Meant to be shared publicly, so nothing may assume this machine's user or paths.

## Stack
- Node + TypeScript (strict), Hono server, SQLite (built-in `node:sqlite`, no native module), React + Vite + Tailwind board
- Tests: Vitest
- Package manager: pnpm (lockfile decides)

## Commands
- Dev: `pnpm dev` (server on :8000 with reload, board on :5173 proxying /api)
- Build: `pnpm build` (board into `dist/board`); run: `pnpm start` (tsx, serves the built board)
- Test: `pnpm test`
- Lint/typecheck: `pnpm lint`, `pnpm typecheck`
- Auto-start: `scripts/install-autostart.ps1` / `uninstall-autostart.ps1` (Startup-folder shortcut); stop a running Relay: `scripts/stop.ps1`; desktop shortcut: `scripts/install-desktop-shortcut.ps1` (runs `open-relay.ps1`)
- Port: fixed at 8000 (`RELAY_PORT` overrides); Relay exits with a clear error if the port is taken

## Structure
- `src/server/`: API, database, ticket rules
- `src/agent/`: runs the agent CLIs, queue, live log. `providers.ts` holds everything CLI-specific (launch args, output parsing); add a new agent CLI there
- `src/mcp/`: Relay MCP server (tools Claude uses to talk to Relay)
- `src/board/`: the web board (React). Shared components in `src/board/components/`, color tokens in the Tailwind v4 `@theme` block in `src/board/index.css`
- `src/shared/`: types used by server and board
- `data/`: SQLite DB + attachments (gitignored)
- `workspaces/`: one folder or git worktree per ticket (gitignored)
- `scripts/`: auto-start at Windows login setup

## Project rules
- **Statuses are fixed:** Backlog → Todo → Agent Ready → In Progress → Blocked → Review → Done. Only the user moves tickets to Done.
- **Agent Ready vs In Progress:** Agent Ready means waiting for a slot. The runner moves a ticket to In Progress when its run starts (users can't), and back to Agent Ready for a retry or a usage-limit wait. Moving a ticket out of In Progress kills the run.
- **Ticket fields:** title, description (markdown), status, priority, labels, due date, optional linked folder/repo, comments, attachments, and authorization toggles: Send, Push, Publish, Merge, Deploy (on by default) and Spend (off by default).
- **Spend limits:** when Spend is on, the agent reads the task first and lists the paid services it will need (service, unit, what for), e.g. Anthropic API in USD, ElevenLabs in credits. It pre-fills each max with its own estimate of what the task needs, so the run isn't blocked waiting for one. Service and unit are read-only to the user; the user can change any max. The agent tracks spend per service, reports it in comments, and moves to Blocked before it would pass a max. Relay can't meter third-party usage itself, so these caps rely on the agent's own tracking.
- **Providers:** Claude Code and Codex. Settings sets the default; a ticket can override it. A session is only resumed by the provider that created it (`session_provider`). Claude is persistent (one process per run, comments over stdin). Codex is one-shot (one `codex exec` per turn): `@agent` comments on a running Codex ticket are held and sent by resuming the session when the turn ends; a turn that ends without a status gets one nudge, then counts as a failure.
- **Models:** a Settings page sets the Codex model (free text, empty = Codex's own config) and the Claude model per role: the main agent (passed as `--model`) and each of the user's own agents in `~/.claude/agents` (re-declared through `--agents` with the same prompt and the chosen model). Built-in subagents (Explore, Plan, general-purpose) aren't listed: overriding them through `--agents` would replace their built-in prompts. A ticket can override only the main agent's model; "Default" uses Settings.
- **Board UI:** Console look (dark, monospace chrome, split screen with the live log first in the ticket panel) with Jira-style column cards.
- **Agent API:** the Relay MCP server (`src/mcp/server.ts`) calls `/api/agent/*` with a per-run bearer token that only works for that run's ticket. `set_status` is refused until the agent has commented during the run.
- **Queue:** up to 3 tickets run in parallel. Extra Agent Ready tickets wait, ordered by highest priority, then oldest.
- **Run:** `claude -p` with prompts skipped (`--dangerously-skip-permissions`), or `codex exec --dangerously-bypass-approvals-and-sandbox`, with the user's normal setup (global instructions, skills, MCP servers) plus the Relay MCP.
- **Agent behavior follows `~/.claude/skills/afk`:**
  - Start straight away with no intake pass, and never ask.
  - When something is unclear, take the option that changes least and is easiest to undo, and record it in a comment.
  - Anything that fails twice goes to Blocked.
  - Do an outward or irreversible action only when its toggle on the ticket is on.
- **Workspace:** each ticket gets `workspaces/<id>`. If the ticket links a git repo, use a git worktree on branch `relay/<id>`. Push only if Push is on. Never merge into or touch main.
- **Result:** always post a final comment (done and where it is, blocked items and what the user must do, decisions taken, confidence) and attachments when there are files. Then move the ticket to Review or Blocked.
- **Rework:** resume the same Claude session (`--resume`). If the session is gone, start a fresh run that reads the comment history.
- **Comments mentioning `@agent`:**
  - On a running ticket, inject the comment into the live session.
  - In Review or Blocked, move the ticket to Agent Ready and resume.
  - Anywhere else, or without `@agent`, a comment is just a note.
- **Live log and Stop:** stream the run log to the ticket. The Stop button kills the run and moves the ticket to Blocked.
- **Usage limit:** when a run hits the subscription limit, the ticket shows "waiting for limit reset" and resumes after the reset. Start no new tickets until then.
- **Notifications:** send a ntfy push on Review or Blocked, with the ticket title and status only, never ticket content.
- **Keep awake and auto-start:** keep the PC awake while tickets are running or queued, and auto-start Relay at Windows login.

## Security
- Listen on localhost only. Anything that can reach Relay can run an agent with full permissions.
- Reject requests whose Origin/Host isn't Relay's own page. This blocks cross-site requests from triggering runs.
- Validate every request body. Store attachments with generated file names and a ~25 MB cap per file.

## Environments & data
- Env vars: see `.env.example`. `NTFY_TOPIC` should be a long random topic name.
- Local only for now. No deploy.

## Gotchas
Checked by spike on 2026-11-08 (Claude Code 2.1.319):
- claude.ai connectors work headless: Gmail showed as connected and `list_labels` succeeded.
- `--resume <session-id>` works headless and keeps the earlier conversation.
- Comment injection works: with `--input-format stream-json`, a user message written to stdin mid-run is handled in the same session, as the next turn.
- A run emits several `result` messages (one per turn, more when background tasks finish). The process ends only when stdin closes, so the runner keeps stdin open until the agent sets Review/Blocked. Plain `-p` text input exits at the first result and drops background work.
- Usage limit: the stream carries `rate_limit_event` messages with `rate_limit_info.status` (`allowed`, …) and `resetsAt` (unix seconds) per window. The runner treats any status other than `allowed`/`allowed_warning`, or a result with `api_error_status` 429, as hitting the limit. The rejected case itself wasn't triggered, so this part is inferred.
- `--agents '{"researcher":{…,"model":"sonnet"}}'` overrides the user's `researcher` agent: the run's `modelUsage` showed Sonnet while the main model was Haiku.
- Spawn `claude` directly (`C:\Users\<user>\.local\bin\claude.exe`, found by `claudeBin()`), not through a shell.
- In PowerShell scripts, check Relay via `127.0.0.1`: Windows PowerShell tries IPv6 for `localhost` first and stalls, since Relay listens on IPv4 only.
- Start scripts call `node` directly: at login the Windows PATH may not include pnpm.

Codex, checked by spike on 2026-11-10 (Codex CLI 0.154.0):
- `codex exec --json` prints JSONL: `thread.started` (`thread_id` = session), `turn.started`, `item.started`/`item.completed` (`agent_message`, `command_execution`, `mcp_tool_call`, `file_change`, `error` = warning), `turn.completed`, `turn.failed`, `error`. The process exits after one turn.
- `codex exec resume <thread_id> -` keeps the earlier conversation. An unknown id exits 1 with no `thread.started`.
- The Relay MCP server and Relay's instructions are passed per run with `-c mcp_servers.relay.*=...` and `-c developer_instructions=...`, so the user's `~/.codex/config.toml` is never edited.
- `codex queue --thread <id>` accepts a message, but a running `codex exec` never receives it, so Relay doesn't use it.
- npm installs Codex as a `.cmd` shim on Windows; spawn `node <npm>/node_modules/@openai/codex/bin/codex.js` instead (`codexBin()`).
- A model the account can't use fails the turn with HTTP 400 `model_not_found`. `codex debug models` lists the catalog.
- Usage limit: not triggered. The runner treats `error`/`turn.failed` text matching "usage limit", "rate limit", "too many requests" or 429 as the limit and waits an hour. Inferred.
