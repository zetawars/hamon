// SQLite storage for Ticket Graph. One database file holds every project.
const Database = require("better-sqlite3");
const crypto = require("node:crypto");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created     INTEGER NOT NULL,
  updated     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  body       TEXT NOT NULL,           -- JSON: {key, title, type, props, created}
  PRIMARY KEY (project_id, id)
);
CREATE TABLE IF NOT EXISTS links (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,           -- "<a>__<b>", ids sorted
  body       TEXT NOT NULL,           -- JSON: {a, b, strength, comment, commentAt, created}
  PRIMARY KEY (project_id, id)
);
CREATE TABLE IF NOT EXISTS settings (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,           -- JSON
  PRIMARY KEY (project_id, key)
);
`;

const TABLES = { tickets: "tickets", links: "links" };

function open(file) {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  const touch = db.prepare("UPDATE projects SET updated = ? WHERE id = ?");
  const now = () => Date.now();

  const api = {
    listProjects() {
      return db.prepare(`
        SELECT p.*,
          (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id) AS ticketCount,
          (SELECT COUNT(*) FROM links l WHERE l.project_id = p.id) AS linkCount,
          (SELECT COALESCE(SUM(json_extract(l.body, '$.strength')), 0) FROM links l WHERE l.project_id = p.id) AS strengthSum
        FROM projects p ORDER BY p.updated DESC`).all();
    },
    createProject({ name, description = "" }) {
      const id = crypto.randomUUID(), t = now();
      db.prepare("INSERT INTO projects (id, name, description, created, updated) VALUES (?, ?, ?, ?, ?)")
        .run(id, name.trim() || "Untitled project", description.trim(), t, t);
      return id;
    },
    updateProject(id, { name, description }) {
      const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
      if (!p) return;
      db.prepare("UPDATE projects SET name = ?, description = ?, updated = ? WHERE id = ?")
        .run(name?.trim() || p.name, description ?? p.description, now(), id);
    },
    deleteProject(id) { db.prepare("DELETE FROM projects WHERE id = ?").run(id); },

    load(projectId) {
      const rows = (table) => db.prepare(`SELECT id, body FROM ${table} WHERE project_id = ?`).all(projectId)
        .map(r => [r.id, JSON.parse(r.body)]);
      const settings = Object.fromEntries(db.prepare("SELECT key, value FROM settings WHERE project_id = ?").all(projectId)
        .map(r => [r.key, JSON.parse(r.value)]));
      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
      return { project, tickets: rows("tickets"), links: rows("links"), settings };
    },
    put(kind, projectId, id, body) {
      const table = TABLES[kind]; if (!table) throw new Error("Unknown kind " + kind);
      db.prepare(`INSERT INTO ${table} (project_id, id, body) VALUES (?, ?, ?)
        ON CONFLICT(project_id, id) DO UPDATE SET body = excluded.body`).run(projectId, id, JSON.stringify(body));
      touch.run(now(), projectId);
    },
    del(kind, projectId, id) {
      const table = TABLES[kind]; if (!table) throw new Error("Unknown kind " + kind);
      db.prepare(`DELETE FROM ${table} WHERE project_id = ? AND id = ?`).run(projectId, id);
      touch.run(now(), projectId);
    },
    setSetting(projectId, key, value) {
      db.prepare(`INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
        ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`).run(projectId, key, JSON.stringify(value));
      touch.run(now(), projectId);
    },

    // Portable JSON: { format, name, description, tickets: {id: body}, links: {id: body}, settings: {key: value} }
    exportProject(projectId) {
      const { project, tickets, links, settings } = api.load(projectId);
      return { format: "ticket-graph/1", name: project.name, description: project.description,
        tickets: Object.fromEntries(tickets), links: Object.fromEntries(links), settings };
    },
    importProject(data, nameOverride) {
      if (!data || typeof data.tickets !== "object") throw new Error("This file isn't a Ticket Graph export.");
      const id = api.createProject({ name: nameOverride || data.name || "Imported project", description: data.description || "" });
      db.transaction(() => {
        for (const [tid, body] of Object.entries(data.tickets || {})) api.put("tickets", id, tid, body);
        for (const [lid, body] of Object.entries(data.links || {})) api.put("links", id, lid, body);
        for (const [k, v] of Object.entries(data.settings || {})) api.setSetting(id, k, v);
      })();
      return id;
    },
    // Changes when another connection (e.g. the MCP server) commits; our own writes don't move it.
    dataVersion() { return db.pragma("data_version", { simple: true }); },
    close() { db.close(); },
  };
  return api;
}

module.exports = { open };
