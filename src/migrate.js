// One-time move from the SQLite database (app v1) to project folders (v2).
// Every link becomes a Link ticket (LNK-n) that keeps its strength, with its comment as the notes.
const fs = require("node:fs");
const path = require("node:path");
const { openProject, projectFolderName } = require("./store");

function linkStatus(strength, statusCols) {
  const want = strength >= 10 ? "Done" : strength > 0 ? "In progress" : "To do";
  return statusCols?.includes(want) ? want : undefined;
}

// Writes one exported v1 project ({name, description, tickets, links, settings}) into `dir`.
function writeV1Project(data, dir) {
  const proj = openProject(dir);
  if (proj.exists()) throw new Error(`${dir} already holds a project`);
  proj.init({ name: data.name, description: data.description || "" });
  const board = { columns: {}, ...(data.settings?.board || {}) };
  if (!board.columns.status) board.columns.status = ["To do", "In progress", "Done"];
  proj.setSetting("board", board);

  const keyOf = new Map();
  for (const [oldId, t] of Object.entries(data.tickets || {})) {
    if (!t?.key || !t?.title) continue;
    keyOf.set(oldId, t.key);
    proj.put("tickets", t.key, { key: t.key, title: t.title, type: t.type || "Content", props: t.props || {}, notes: t.notes || "", created: t.created || null });
  }
  const typeOf = new Map(Object.values(data.tickets || {}).map(t => [t.key, t.type]));
  const titleOf = new Map(Object.values(data.tickets || {}).map(t => [t.key, t.title]));
  const links = Object.values(data.links || {})
    .filter(l => keyOf.has(l.a) && keyOf.has(l.b))
    .map(l => {
      // Put the Content side first, so the title reads "Tesla Trooper · 3D Model".
      let a = keyOf.get(l.a), b = keyOf.get(l.b);
      if (typeOf.get(a) === "Discipline" && typeOf.get(b) !== "Discipline") [a, b] = [b, a];
      return { ...l, a, b };
    })
    .sort((x, y) => (x.a + x.b).localeCompare(y.a + y.b, undefined, { numeric: true }));
  links.forEach((l, i) => {
    const key = `LNK-${i + 1}`;
    const status = linkStatus(l.strength, board.columns.status);
    proj.put("links", key, { key, title: `${titleOf.get(l.a)} · ${titleOf.get(l.b)}`, a: l.a, b: l.b, strength: l.strength ?? 0,
      comment: l.comment || "", props: status ? { status } : {}, created: l.created || null });
  });
  return { tickets: keyOf.size, links: links.length };
}

function uniqueDir(root, name) {
  let dir = path.join(root, projectFolderName(name)), n = 2;
  while (fs.existsSync(dir)) dir = path.join(root, `${projectFolderName(name)} (${n++})`);
  return dir;
}

// Moves every project in the v1 SQLite file into folders under `root`. Returns the new folders.
function migrateDatabase(dbFile, root) {
  const db = require("./db").open(dbFile);
  try {
    return db.listProjects().map(p => {
      const dir = uniqueDir(root, p.name);
      writeV1Project(db.exportProject(p.id), dir);
      return dir;
    });
  } finally { db.close(); }
}

module.exports = { migrateDatabase, writeV1Project, uniqueDir };
