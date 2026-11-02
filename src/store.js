// File-based storage. A project is a folder:
//   project.yaml          name, description, board columns
//   tickets/<KEY>-<slug>.md  one file per ticket: YAML front matter + markdown notes
// Tickets of type "Link" connect two other tickets (`between`) and carry a 0-10 `strength`.
// Used by the desktop app's main process and by the MCP server, so it has no Electron dependencies.
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const TICKETS_DIR = "tickets";
const PROJECT_FILE = "project.yaml";
// Front-matter fields with a fixed meaning; every other field is a free-form property.
const RESERVED = ["key", "title", "type", "between", "strength", "created"];

function slug(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim()
    .replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 48).replace(/-$/, "") || "ticket";
}
const fileNameFor = (key, title) => `${key}-${slug(title)}.md`;

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/* ---------- ticket files ---------- */
function parseTicket(text) {
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/);
  if (!m) throw new Error("no front matter: the file must start with a --- block");
  const fm = YAML.parse(m[1]) || {};
  if (typeof fm !== "object" || Array.isArray(fm)) throw new Error("front matter must be key: value pairs");
  if (!fm.key || !fm.title) throw new Error("front matter needs key and title");
  const notes = (m[2] || "").replace(/^\s*\n/, "").replace(/\s+$/, "");
  const props = {};
  for (const [k, v] of Object.entries(fm)) {
    if (RESERVED.includes(k) || v === null || v === undefined) continue;
    props[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  const created = fm.created ? (Date.parse(fm.created) || null) : null;
  const key = String(fm.key), title = String(fm.title);
  if (fm.type === "Link") {
    if (!Array.isArray(fm.between) || fm.between.length !== 2) throw new Error("a Link needs between: [KEY-A, KEY-B]");
    const s = Number(fm.strength ?? 0);
    if (!Number.isFinite(s)) throw new Error("strength must be a number from 0 to 10");
    return { kind: "links", id: key, body: { key, title, a: String(fm.between[0]), b: String(fm.between[1]),
      strength: Math.max(0, Math.min(10, Math.round(s))), comment: notes, props, created } };
  }
  return { kind: "tickets", id: key, body: { key, title, type: fm.type ? String(fm.type) : "Content", props, notes, created } };
}

function serializeTicket(kind, body) {
  const fm = { key: body.key, title: body.title, type: kind === "links" ? "Link" : body.type };
  if (kind === "links") { fm.between = [body.a, body.b]; fm.strength = body.strength; }
  for (const [k, v] of Object.entries(body.props || {})) if (!RESERVED.includes(k)) fm[k] = v;
  if (body.created) fm.created = new Date(body.created).toISOString();
  const notes = (kind === "links" ? body.comment : body.notes) || "";
  const doc = new YAML.Document(fm);
  doc.get("between", true) && (doc.get("between", true).flow = true);
  return `---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n${notes.trim() ? "\n" + notes.trim() + "\n" : ""}`;
}

/* ---------- a project folder ---------- */
function openProject(dir) {
  dir = path.resolve(dir);
  const tdir = path.join(dir, TICKETS_DIR);
  const pfile = path.join(dir, PROJECT_FILE);

  const readMeta = () => {
    if (!fs.existsSync(pfile)) return { name: path.basename(dir), description: "" };
    return YAML.parse(fs.readFileSync(pfile, "utf8")) || {};
  };
  const writeMeta = (meta) => writeAtomic(pfile, YAML.stringify(meta, { lineWidth: 0 }));
  const mdFiles = () => fs.existsSync(tdir) ? fs.readdirSync(tdir).filter(f => f.toLowerCase().endsWith(".md")) : [];

  // The file holding a key: usually "<KEY>-…md"; falls back to reading every file (hand-renamed files).
  function findFile(key) {
    const files = mdFiles();
    for (const f of files.filter(f => f === `${key}.md` || f.startsWith(`${key}-`))) {
      try { if (parseTicket(fs.readFileSync(path.join(tdir, f), "utf8")).id === key) return f; } catch {}
    }
    for (const f of files) {
      try { if (parseTicket(fs.readFileSync(path.join(tdir, f), "utf8")).id === key) return f; } catch {}
    }
    return null;
  }

  return {
    dir,
    exists: () => fs.existsSync(pfile) || fs.existsSync(tdir),
    init({ name, description = "" }) {
      fs.mkdirSync(tdir, { recursive: true });
      if (!fs.existsSync(pfile)) writeMeta({ name, description, board: { columns: { status: ["To do", "In progress", "Done"] } } });
    },
    load() {
      const meta = readMeta();
      const tickets = [], links = [], problems = [], seen = new Map();
      for (const f of mdFiles()) {
        try {
          const r = parseTicket(fs.readFileSync(path.join(tdir, f), "utf8"));
          if (seen.has(r.id)) { problems.push({ file: f, error: `key ${r.id} is also used by ${seen.get(r.id)}` }); continue; }
          seen.set(r.id, f);
          (r.kind === "links" ? links : tickets).push([r.id, r.body]);
        } catch (e) { problems.push({ file: f, error: e.message }); }
      }
      const known = new Set(tickets.map(([id]) => id));
      for (const [id, l] of links) {
        for (const end of [l.a, l.b]) if (!known.has(end)) problems.push({ file: seen.get(id), error: `links to ${end}, which doesn't exist` });
      }
      return {
        project: { id: dir, path: dir, name: meta.name || path.basename(dir), description: meta.description || "" },
        tickets, links, problems, settings: { board: meta.board || { columns: {} } },
      };
    },
    put(kind, id, body) {
      fs.mkdirSync(tdir, { recursive: true });
      const old = findFile(id);
      const name = fileNameFor(body.key || id, body.title);
      writeAtomic(path.join(tdir, name), serializeTicket(kind, { ...body, key: body.key || id }));
      if (old && old !== name) fs.rmSync(path.join(tdir, old), { force: true });
    },
    del(_kind, id) {
      const f = findFile(id);
      if (f) fs.rmSync(path.join(tdir, f), { force: true });
    },
    setSetting(key, value) { const meta = readMeta(); meta[key] = value; writeMeta(meta); },
    update({ name, description }) {
      const meta = readMeta();
      if (name?.trim()) meta.name = name.trim();
      if (description !== undefined) meta.description = description;
      writeMeta(meta);
    },
    // Changes whenever any project file changes; used to tell our own writes from outside edits.
    signature() {
      const parts = [];
      for (const f of [pfile, ...mdFiles().map(f => path.join(tdir, f))]) {
        try { const s = fs.statSync(f); parts.push(`${path.basename(f)}:${s.mtimeMs}:${s.size}`); } catch {}
      }
      return parts.sort().join("|");
    },
  };
}

/* ---------- the list of known projects ---------- */
// projects.json: { root: <where new projects go>, projects: [{ path }] }, most recently used first.
function registry(file) {
  const readAll = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };
  const read = () => readAll().projects || [];
  const write = (projects) => { fs.mkdirSync(path.dirname(file), { recursive: true }); writeAtomic(file, JSON.stringify({ ...readAll(), projects }, null, 2)); };
  return {
    file,
    exists: () => fs.existsSync(file),
    root: () => readAll().root || null,
    setRoot(root) { if (readAll().root !== root) { fs.mkdirSync(path.dirname(file), { recursive: true }); writeAtomic(file, JSON.stringify({ ...readAll(), root, projects: read() }, null, 2)); } },
    paths: () => read().map(p => p.path),
    add(dir) { const ps = read().filter(p => path.resolve(p.path) !== path.resolve(dir)); ps.unshift({ path: path.resolve(dir) }); write(ps); },
    remove(dir) { write(read().filter(p => path.resolve(p.path) !== path.resolve(dir))); },
    touch(dir) { this.add(dir); },
  };
}

// Project folders inside a directory (default: this repo's projects/ folder, or TG_PROJECTS), so a cloned
// repo works without any app setup.
const REPO_PROJECTS = process.env.TG_PROJECTS || path.join(__dirname, "..", "projects");
function discover(dir = REPO_PROJECTS) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())
    .map(d => path.join(dir, d.name)).filter(p => fs.existsSync(path.join(p, PROJECT_FILE)));
}
// Every project to show: the app's list first, then any repo project not on it.
function knownProjects(reg) {
  const seen = new Set(), out = [];
  for (const p of [...reg.paths(), ...discover()]) { const k = path.resolve(p).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(path.resolve(p)); } }
  return out;
}

// Summary used by the project picker and the MCP server.
function summarize(dir) {
  const p = openProject(dir);
  if (!p.exists()) return { path: p.dir, name: path.basename(p.dir), missing: true };
  const d = p.load();
  const ids = new Set(d.tickets.map(([id]) => id));
  const live = d.links.filter(([, l]) => ids.has(l.a) && ids.has(l.b));
  const strengthSum = live.reduce((s, [, l]) => s + l.strength, 0);
  let updated = 0;
  try { updated = Math.max(...[path.join(p.dir, PROJECT_FILE), path.join(p.dir, TICKETS_DIR)].map(f => fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0)); } catch {}
  return { path: p.dir, id: p.dir, name: d.project.name, description: d.project.description, ticketCount: d.tickets.length,
    linkCount: live.length, strengthSum, problems: d.problems.length, updated };
}

const projectFolderName = (name) => name.replace(/[\\/:*?"<>|]/g, "_").trim() || "Untitled project";

module.exports = { openProject, registry, summarize, discover, knownProjects, REPO_PROJECTS, parseTicket, serializeTicket, fileNameFor, projectFolderName };
