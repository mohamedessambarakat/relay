# Relay

Minimal local task board (Jira/Linear-style) for one person. Moving a ticket to **Agent Ready** makes Claude work on it end to end in the background, using the user's Claude subscription via headless `claude -p`. Not an API key.

## Stack
- Node + TypeScript (strict), Hono server, SQLite, React + Vite + Tailwind board
- Tests: Vitest
- Package manager: pnpm (lockfile decides)

## Commands
Planned, not created yet. Update once scaffolded.
- Dev: `pnpm dev`
- Build: `pnpm build`
- Test: `pnpm test`
- Lint/typecheck: `pnpm lint`, `pnpm typecheck`

## Structure
- `src/server/`: API, database, ticket rules
- `src/agent/`: runs Claude, queue, live log
- `src/mcp/`: Relay MCP server (tools Claude uses to talk to Relay)
- `src/board/`: the web board (React). Shared components in `src/board/components/`, color tokens in the Tailwind config
- `src/shared/`: types used by server and board
- `data/`: SQLite DB + attachments (gitignored)
- `workspaces/`: one folder or git worktree per ticket (gitignored)
- `scripts/`: auto-start at Windows login setup

## Project rules
- **Statuses are fixed:** Backlog → Todo → Agent Ready → Blocked → Review → Done. Only the user moves tickets to Done.
- **Ticket fields:** title, description (markdown), status, priority, labels, due date, optional linked folder/repo, comments, attachments, and authorization toggles: Send, Push, Publish, Merge, Deploy (on by default) and Spend (off by default).
- **Queue:** up to 3 tickets run in parallel. Extra Agent Ready tickets wait, ordered by highest priority, then oldest.
- **Run:** `claude -p` with prompts skipped (`--dangerously-skip-permissions`) and the user's normal Claude setup (global CLAUDE.md, skills, MCP servers) plus the Relay MCP.
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
- Listen on localhost only. Anything that can reach Relay can run Claude with full permissions.
- Reject requests whose Origin/Host isn't Relay's own page. This blocks cross-site requests from triggering runs.
- Validate every request body. Store attachments with generated file names and a ~25 MB cap per file.

## Environments & data
- Env vars: see `.env.example`. `NTFY_TOPIC` should be a long random topic name.
- Local only for now. No deploy.

## Gotchas
- Unverified until the first build step checks them:
  - Do claude.ai connectors (Gmail) work in headless `claude -p`?
  - Does mid-run comment injection work via `--input-format stream-json`?
  - Does `--resume` work in headless mode?
  - How does a headless run report hitting the usage limit and its reset time?
