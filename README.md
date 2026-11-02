# Ticket Graph

A project tracker where **every ticket, and every link between two tickets, is a markdown file**. It runs as a web app first and as a desktop app second (Electron wraps the same server). An MCP server lets Claude read and manage projects too.

Built for game-dev work. Three ticket types:

- **Content**: something in the game (units, buildings…). The specific kind is the `category` property.
- **Discipline**: a kind of work many things rely on (Sound, 3D Model, Mechanic…).
- **Link**: the piece of work between two tickets, e.g. *Tesla Trooper · 3D Model*. It has a **strength** from 0 (no work done) to 10 (all done), properties such as `status`, and notes. Bands: 0-3 red, 4-7 yellow, 8-9 green, 10 blue.

A ticket's progress is the sum of its links' strengths out of 10 per link, so a Discipline's progress covers everything that depends on it.

Views:

- **Graph**: click a ticket to show only it and its links; click a line to open that Link.
- **Board**: columns come from any property (`status` by default; add, rename and reorder them). It shows tickets, links or both, and cards and columns have progress bars.

## Run it

Requires Node 20 or newer.

```bash
npm install --omit=dev   # web app + MCP server
npm run web              # open http://localhost:4387
```

`PORT` changes the port. The server listens on localhost only.

Desktop app:

```bash
npm install              # includes Electron
npm start                # run the desktop app
npm run dist             # build a Windows installer into dist/
```

## Project folders

A project is just a folder, so it can live anywhere, for example inside your game's repo to version it with git:

```
My Project/
  project.yaml                          # name, description, board columns
  tickets/
    UNI-8-tesla-trooper.md
    3DM-1-3d-model.md
    LNK-123-tesla-trooper-3d-model.md
```

```markdown
---
key: LNK-123
title: Tesla Trooper · 3D Model
type: Link
between: [ UNI-8, 3DM-1 ]
strength: 4
status: In progress
---

Blue gauntlets missing.
```

Fixed front-matter fields are `key`, `title`, `type`, `between` and `strength` (links only), and `created`. Any other field is a free-form property. Everything after the front matter is the ticket's notes.

Edit the files with anything: an editor, Claude, `git pull`. Open windows update within about half a second. A file the app can't read is skipped and named in a banner. Keys never change; the file name follows the title.

The app remembers its projects in `projects.json` inside the app data folder (`%APPDATA%\Ticket Graph`, or `~/.config/Ticket Graph`; override with `TG_HOME`). New projects go in `Documents\Ticket Graph` unless you choose another folder. Folders in this repo's `projects/` (gitignored) or in `TG_PROJECTS` are always listed.

## Claude (MCP)

`mcp/server.mjs` exposes the projects as MCP tools:

- **Projects:** list, create, add a folder, rename, overview (bands and per-discipline progress).
- **Tickets:** filter (e.g. "links to Sound in the red band"), get, create (optionally with links), update, delete.
- **Links:** create or update with `set_link`, or remove.
- **Board:** set the columns with `set_board_columns`.

`.mcp.json` registers it for Claude Code sessions opened in this repo. To use it everywhere, add it at user scope:

```json
"ticket-graph": { "type": "stdio", "command": "node", "args": ["<path to this repo>/mcp/server.mjs"] }
```

`.claude/skills/ticket-graph/` teaches Claude the model and the rules.

## Develop

See [CLAUDE.md](CLAUDE.md) for the code layout.

```bash
npm test                 # MCP end-to-end test in a throwaway folder
TG_HOME=.smoke/home TG_PROJECTS=<copies of projects> TG_SMOKE=.smoke npx electron .   # desktop smoke test with screenshots
```
