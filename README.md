# Relay

A small local task board. Move a ticket to **Agent Ready** and Claude works on it end to end in the background, using your Claude subscription through headless `claude -p`. When it's done, the ticket lands in **Review** (or **Blocked** if it needs you), with a final comment, any result files attached, and a push to your phone.

Relay listens on `localhost` only. Anything that can reach it can run Claude with full permissions, so don't expose the port.

## Setup

Needs Node 24+, pnpm, and the Claude Code CLI signed in to your subscription.

```sh
pnpm install
cp .env.example .env   # then set NTFY_TOPIC to a long random name
pnpm build
pnpm start             # http://localhost:8000
```

Start at Windows login (adds a shortcut to your Startup folder; output goes to `data/relay.log`):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
# undo: scripts\uninstall-autostart.ps1
```

## Desktop shortcut

```powershell
powershell -ExecutionPolicy Bypass -File scriptsinstall-desktop-shortcut.ps1
```

Clicking **Relay** on the desktop starts Relay hidden in the background if it isn't running, then opens the board. Closing the browser doesn't stop it; `scriptsstop.ps1` does.

## Run it by hand

Relay already runs in the background after login. To run it in a terminal instead (to watch its output), stop the background copy first:

```powershell
powershell -ExecutionPolicy Bypass -File scriptsstop.ps1
pnpm start            # Ctrl+C to stop
```

To bring the background copy back without logging out, double-click `Relay.lnk` in `shell:startup`.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Server with reload on :8000, board with hot reload on :5173 |
| `pnpm build` | Builds the board into `dist/board` |
| `pnpm start` | Runs Relay (serves the built board) |
| `pnpm test` | Vitest |
| `pnpm lint`, `pnpm typecheck` | ESLint, TypeScript |

## How a ticket runs

- Up to 3 tickets run at once. Others wait in Agent Ready, highest priority first, then oldest.
- Each ticket works in `workspaces/R-<n>`. If you link a git repo, that's a worktree on branch `relay/R-<n>`; main is never touched.
- The toggles on the ticket (Send, Push, Publish, Merge, Deploy, Spend) decide which outward actions Claude may take. Spend is off by default. When it's on, Claude lists the paid services it needs with an estimate, which becomes the max; you can change any max.
- Comments are notes, unless they mention `@agent`: then they go into the running session, or send a Review/Blocked ticket back to work.
- Stop kills the run and moves the ticket to Blocked. A run that fails twice also goes to Blocked.
- If your usage limit is hit, the ticket waits for the reset and continues; nothing new starts until then.

## Folders

| Folder | What's in it |
|---|---|
| `src/server/` | The web server: API, database, ticket rules, security checks |
| `src/agent/` | Runs Claude: the queue, workspaces, prompts, live log, notifications, keep-awake |
| `src/mcp/` | The Relay tools Claude uses during a run (comment, attach, set status, spend) |
| `src/board/` | The board you see in the browser (React) |
| `src/shared/` | Types shared by the server and the board |
| `scripts/` | Start Relay at Windows login |
| `data/` | Database, attachments and logs (not in git) |
| `workspaces/` | One working folder per ticket (not in git) |
