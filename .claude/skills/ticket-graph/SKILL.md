---
name: ticket-graph
description: Read and change the user's Ticket Graph projects (game-dev tickets such as units, buildings and disciplines like Sound or 3D Model, connected by Link tickets with a 0-10 strength). Use when the user asks to create, find, link, update or report on tickets, links, strength, notes, board columns, project progress, or "what's red/yellow/green/blue".
---

# Ticket Graph

Ticket Graph is the tool in this repo (web app, desktop app, MCP server). Each project is a folder (outside this repo) with `project.yaml` and `tickets/*.md`: **one markdown file per ticket and per link**, with YAML front matter and markdown notes. The app's list of projects is `projects.json` in the app data folder (`%APPDATA%\Ticket Graph` on Windows).

**Prefer the `ticket-graph` MCP tools** (`mcp__ticket-graph__*`, configured in `.mcp.json`; needs `npm install` once). They apply the rules below (keys, link titles, valid statuses, cascading deletes). If they aren't loaded, look for them with ToolSearch ("ticket-graph"). Editing the files directly also works, and an open app picks it up. If you do, keep the format exactly as described below and never change a `key`.

## Model

- **Content**: a thing in the game (unit, building…). **Discipline**: a kind of work many things rely on (Sound, 3D Model, Mechanic…). The specific kind is the `category` property; a new kind is a new category, never a new type.
- **Link** (`LNK-n`): a ticket of its own, the actual piece of work between two tickets, e.g. "Tesla Trooper · 3D Model". It has `between: [KEY-A, KEY-B]` (Content side first), `strength` 0-10, properties such as `status`, and notes.
- Bands: 0-3 red, 4-7 yellow, 8-9 green, 10 blue (done). A ticket's progress = its links' strengths / (10 x links).
- `status` must be one of the project's status columns (`project.yaml` → `board.columns.status`).

File example (`tickets/LNK-123-tesla-trooper-3d-model.md`):

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

## Tools

`list_projects`, `get_project` (bands, per-discipline and per-category progress, columns, unreadable files), `list_tickets` (filters: type incl. `Link`, category, status, search, `linked_to`, `band`), `get_ticket` (any key incl. LNK; shows notes and links), `create_ticket` (can create links in the same call), `update_ticket` (title, props, notes; strength for links), `set_link` (create or update the Link between two tickets), `remove_link`, `delete_ticket`, `set_board_columns`, `create_project`, `add_project_folder`, `update_project`, `remove_project_from_list` (files stay).

## Habits

- Read before writing, so you reuse existing category spellings and keys.
- Confirm with the user before deleting tickets or links, or removing board columns (that clears the value from tickets).
- When reporting, name tickets as `KEY Title` and links as `LNK-n Title — n/10 (band)`, and quote link notes when they explain the state.
