# Hamon

A project tracker where every ticket, and every link between two tickets, is its own markdown file. Web app first (`npm run web`), desktop app second (Electron wraps the same web server, `npm start`), plus an MCP server so Claude can use it (`mcp/server.mjs`).

This repo holds the tool only. Project data lives in project folders outside the repo (by default `Documents\Hamon\<project>`; `projects/` here is gitignored).

## Layout

- `src/store.js`: the file format. It parses and writes ticket files and `project.yaml`, keeps the project list and finds projects. The server and the MCP server both use it, so change the format only here.
- `src/server.js`: HTTP server (Node built-ins only). It serves the static app plus a JSON API under `/api/*`, and pushes live updates over Server-Sent Events (`/api/events`) when project files change, whether through the API or outside it. It listens on localhost only and rejects other Host headers.
- `src/renderer/`: the page. `api.js` is the only code that talks to the server (`window.tg`); `app.js` is the UI (d3 graph, board, link popup, project picker).
- `electron/`: the desktop wrapper. `main.js` starts `src/server.js` on a free port and loads it in a window; `preload.js` adds native folder dialogs (`window.tgNative`). Keep app logic out of `electron/`, so the web version stays the real one.
- `mcp/server.mjs`: MCP tools over `src/store.js`.
- `src/migrate.js`, `src/db.js`: one-time move from the old SQLite version. `better-sqlite3` is an optional dependency used only there.
- `examples/ember-outpost`: the sample project used by the README. `scripts/example-project.js` (`npm run docs:example`) rebuilds it, and `scripts/screenshots.js` (`npm run docs:screenshots`) recaptures `docs/images/` from it without writing anything. Re-run both when the UI or format changes.
- `test/mcp-test.mjs` (`npm test`): MCP end to end in a throwaway folder. `test/smoke.js`: desktop screenshots, run with `HAMON_HOME=.smoke/home HAMON_PROJECTS=<folder of test projects> HAMON_SMOKE=.smoke npx electron .`. Always point tests at copies, never at real project folders.

## Data format (summary)

A project folder holds `project.yaml` (name, description, `board.columns`) and `tickets/<KEY>-<slug>.md`. Each ticket file has YAML front matter (`key`, `title`, `type`, `created`, plus free-form properties) followed by markdown notes.

- `type` is `Content` (things in the game; the kind goes in `category`), `Discipline` (work many things rely on: Sound, 3D Model…) or `Link`.
- A Link (`LNK-n`) is the piece of work between two tickets. It has `between: [ KEY-A, KEY-B ]` (Content side first) and `strength` 0-10. Bands: 0-3 red, 4-7 yellow, 8-9 green, 10 blue.
- Keys never change. The file name follows the title. `status` must be one of `board.columns.status`.
- Passes: `passes/<LINK-KEY>/<NNN>.md`, one file per iteration on a link. Front matter is `pass`, `date`, `from`, `strength`, `tool`, `by`, `assets` and `code`; the body holds notes. Assets and code are references (paths, URLs, commit hashes), never copies; relative paths resolve against `asset_root` in `project.yaml`, else the project folder. Recording a pass sets the link's strength (`store.addPass`), but editing strength directly does not create a pass. "Stuck" means three passes in a row without getting stronger; that logic exists in both `app.js` (`trendOf`) and `mcp/server.mjs` (`stuckOf`). The server only serves images that a pass file references (`/api/asset`).

The `hamon` skill (`.claude/skills/hamon/SKILL.md`) explains how to manage a project's tickets through the MCP tools. `.mcp.json` registers the server for sessions in this repo; run `npm install` first.

## Commands

```bash
npm install          # everything (Electron included)
npm install --omit=dev   # web server + MCP server only
npm run web          # http://localhost:4387 (PORT to change; HAMON_HOME / HAMON_PROJECTS for test data)
npm start            # desktop app
npm test             # MCP tests
npm run dist         # Windows installer in dist/
```

The app was called Ticket Graph before 1.2.0. `store.appHome()` copies the old `%APPDATA%\Ticket Graph\projects.json` into `%APPDATA%\Hamon` on first run; existing project folders (for example `Documents\Ticket Graph\...`) are left where they are and stay on the list.
