// File-based storage. A project is a folder:
//   project.yaml          name, description, board columns
//   tickets/<KEY>-<slug>.md  one file per ticket: YAML front matter + markdown notes
// Tickets of type "Link" connect two other tickets (`between`) and carry a 0-10 `strength`.
// Used by the desktop app's main process and by the MCP server, so it has no Electron dependencies.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const YAML = require("yaml");

const TICKETS_DIR = "tickets";
const PASSES_DIR = "passes";   // passes/<LINK-KEY>/<NNN>.md: one file per iteration on a link
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

/* ---------- passes: the iteration history of a link ---------- */
// A pass records one attempt at the work a link stands for: the strength it reached (and came from),
// the tool and who ran it, and references to what it produced. Assets and code are references only
// (paths, URLs, commit hashes); nothing is copied into the project.
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
const isUrl = (ref) => /^https?:\/\//i.test(ref);
const isCommit = (ref) => /^[0-9a-f]{7,40}$/i.test(ref);
const isImageRef = (ref) => IMAGE_EXT.test(String(ref).split(/[?#]/)[0]);

function parsePass(text) {
  const m = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/);
  if (!m) throw new Error("no front matter");
  const fm = YAML.parse(m[1]) || {};
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(x => typeof x === "object" ? String(Object.values(x)[0]) : String(x));
  const num = (v) => Math.max(0, Math.min(10, Math.round(Number(v) || 0)));
  return {
    pass: Number(fm.pass) || 0, date: fm.date ? String(fm.date).slice(0, 10) : "", from: fm.from === undefined ? null : num(fm.from),
    strength: num(fm.strength), tool: fm.tool ? String(fm.tool) : "", by: fm.by ? String(fm.by) : "",
    assets: list(fm.assets), code: list(fm.code), notes: (m[2] || "").replace(/^\s*\n/, "").replace(/\s+$/, ""),
  };
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

  const pdir = (link) => path.join(dir, PASSES_DIR, link);
  function passes(link) {
    const d = pdir(link);
    if (!fs.existsSync(d)) return [];
    const out = [];
    for (const f of fs.readdirSync(d).filter(f => f.toLowerCase().endsWith(".md"))) {
      try { out.push({ ...parsePass(fs.readFileSync(path.join(d, f), "utf8")), file: `${PASSES_DIR}/${link}/${f}` }); } catch {}
    }
    return out.sort((a, b) => a.pass - b.pass);
  }
  // Relative asset paths resolve against project.yaml's asset_root (e.g. your game repo), else the project folder.
  function assetBase() { const r = readMeta().asset_root; return r ? path.resolve(dir, String(r)) : dir; }

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
      // Light pass summaries per link (no notes or assets), for trend arrows and "stuck" badges.
      const passSummary = {};
      for (const [id] of links) {
        const ps = passes(id);
        if (ps.length) passSummary[id] = ps.map(p => ({ pass: p.pass, date: p.date, from: p.from, strength: p.strength }));
      }
      return {
        project: { id: dir, path: dir, name: meta.name || path.basename(dir), description: meta.description || "", asset_root: meta.asset_root || "" },
        tickets, links, problems, passes: passSummary, settings: { board: meta.board || { columns: {} } },
      };
    },
    put(kind, id, body) {
      fs.mkdirSync(tdir, { recursive: true });
      const old = findFile(id);
      const name = fileNameFor(body.key || id, body.title);
      writeAtomic(path.join(tdir, name), serializeTicket(kind, { ...body, key: body.key || id }));
      if (old && old !== name) fs.rmSync(path.join(tdir, old), { force: true });
    },
    del(kind, id) {
      const f = findFile(id);
      if (f) fs.rmSync(path.join(tdir, f), { force: true });
      if (kind === "links") fs.rmSync(pdir(id), { recursive: true, force: true });
    },
    passes,
    // Records a new pass on a link and sets the link's strength to it. Returns the pass.
    addPass(link, { strength, tool = "", by = "", assets = [], code = [], notes = "", date } = {}) {
      const lf = findFile(link);
      if (!lf) throw new Error(`No link ${link}.`);
      const rec = parseTicket(fs.readFileSync(path.join(tdir, lf), "utf8"));
      if (rec.kind !== "links") throw new Error(`${link} isn't a Link.`);
      const s = Math.max(0, Math.min(10, Math.round(Number(strength))));
      if (!Number.isFinite(s)) throw new Error("strength must be a number from 0 to 10");
      const n = (passes(link).at(-1)?.pass || 0) + 1;
      const fm = { pass: n, date: date || new Date().toISOString().slice(0, 10), from: rec.body.strength, strength: s };
      if (tool.trim()) fm.tool = tool.trim();
      if (by.trim()) fm.by = by.trim();
      const clean = (xs) => xs.map(x => String(x).trim()).filter(Boolean);
      if (clean(assets).length) fm.assets = clean(assets);
      if (clean(code).length) fm.code = clean(code);
      fs.mkdirSync(pdir(link), { recursive: true });
      writeAtomic(path.join(pdir(link), `${String(n).padStart(3, "0")}.md`),
        `---\n${YAML.stringify(fm, { lineWidth: 0 }).trimEnd()}\n---\n${notes.trim() ? "\n" + notes.trim() + "\n" : ""}`);
      if (rec.body.strength !== s) this.put("links", link, { ...rec.body, strength: s });
      return { ...fm, assets: fm.assets || [], code: fm.code || [], tool: fm.tool || "", by: fm.by || "", notes: notes.trim() };
    },
    // Where a referenced asset lives: { url } for web links, { file } for a local path (which may not exist).
    resolveAsset(ref) {
      if (isUrl(ref)) return { url: ref };
      return { file: path.isAbsolute(ref) ? ref : path.resolve(assetBase(), ref) };
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
      const passFiles = [];
      const pd = path.join(dir, PASSES_DIR);
      if (fs.existsSync(pd)) for (const l of fs.readdirSync(pd)) {
        try { for (const f of fs.readdirSync(path.join(pd, l))) passFiles.push(path.join(pd, l, f)); } catch {}
      }
      for (const f of [pfile, ...mdFiles().map(f => path.join(tdir, f)), ...passFiles]) {
        try { const s = fs.statSync(f); parts.push(`${path.relative(dir, f)}:${s.mtimeMs}:${s.size}`); } catch {}
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

// The app data folder holding projects.json (HAMON_HOME overrides it). Before the rename the app was called
// Ticket Graph; the first run copies that folder's project list over. Project folders themselves stay where they are.
function appHome() {
  if (process.env.HAMON_HOME) return process.env.HAMON_HOME;
  const base = process.env.APPDATA || path.join(os.homedir(), ".config");
  const home = path.join(base, "Hamon"), old = path.join(base, "Ticket Graph");
  if (!fs.existsSync(path.join(home, "projects.json"))) {
    for (const f of ["projects.json", "ticket-graph.db"]) {
      try { if (fs.existsSync(path.join(old, f))) { fs.mkdirSync(home, { recursive: true }); fs.copyFileSync(path.join(old, f), path.join(home, f)); } }
      catch (e) { console.error(`Couldn't copy ${f} from ${old}:`, e.message); }
    }
  }
  return home;
}

// Project folders inside a directory (default: this repo's projects/ folder, or HAMON_PROJECTS), so a cloned
// repo works without any app setup.
const REPO_PROJECTS = process.env.HAMON_PROJECTS || path.join(__dirname, "..", "projects");
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

module.exports = { appHome, openProject, registry, summarize, parsePass, isImageRef, isUrl, isCommit, discover, knownProjects, REPO_PROJECTS, parseTicket, serializeTicket, fileNameFor, projectFolderName };
