#!/usr/bin/env node
// MCP server for Ticket Graph: lets Claude read and change the user's projects.
// A project is a folder of markdown ticket files (see src/store.js); this server and the desktop app share them,
// and the open app reloads when files change. Run: node mcp/server.mjs   (TG_HOME overrides the app data folder)
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const require = createRequire(import.meta.url);
const { openProject, registry, summarize, knownProjects, REPO_PROJECTS } = require("../src/store.js");
const { uniqueDir } = require("../src/migrate.js");

const HOME = process.env.TG_HOME || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Ticket Graph");
const reg = registry(path.join(HOME, "projects.json"));
const defaultRoot = () => reg.root() || REPO_PROJECTS;

const TYPES = ["Content", "Discipline"];
const DEFAULT_COLS = { status: ["To do", "In progress", "Done"] };

/* ---------- helpers (same rules as the app) ---------- */
const band = (s) => s >= 10 ? "blue (done)" : s >= 8 ? "green" : s >= 4 ? "yellow" : "red";
const prefixFor = (s) => (s || "TKT").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase().padEnd(3, "X");
class UserError extends Error {}

function findProjectDir(ref) {
  const r = String(ref).trim();
  const list = knownProjects(reg).map(summarize).filter(p => !p.missing);
  const lower = r.toLowerCase();
  const hit = list.find(p => path.resolve(p.path).toLowerCase() === path.resolve(r).toLowerCase())
    || list.find(p => p.name.toLowerCase() === lower)
    || (list.filter(p => p.name.toLowerCase().includes(lower)).length === 1 ? list.find(p => p.name.toLowerCase().includes(lower)) : null);
  if (!hit) throw new UserError(`No project matches "${ref}". Projects: ${list.map(p => p.name).join(", ") || "none"}.`);
  return hit.path;
}
function loadProject(ref) {
  const store = openProject(findProjectDir(ref));
  const d = store.load();
  return { store, project: d.project, tickets: new Map(d.tickets), links: new Map(d.links), settings: d.settings, problems: d.problems };
}
function findTicket(P, ref, { allowLinks = false } = {}) {
  const r = String(ref).trim(), lower = r.toLowerCase();
  const pool = allowLinks ? [...P.tickets, ...P.links] : [...P.tickets];
  const byKey = pool.find(([k]) => k.toLowerCase() === lower);
  if (byKey) return byKey[0];
  const exact = pool.filter(([, t]) => t.title.toLowerCase() === lower);
  if (exact.length === 1) return exact[0][0];
  const partial = pool.filter(([, t]) => t.title.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0][0];
  if (exact.length || partial.length)
    throw new UserError(`"${ref}" matches several tickets: ${(exact.length ? exact : partial).slice(0, 8).map(([k, t]) => `${k} ${t.title}`).join(", ")}. Use the key.`);
  throw new UserError(`No ticket matches "${ref}" in ${P.project.name}.`);
}
function nextKey(P, basis) {
  const p = prefixFor(basis); let max = 0;
  for (const t of [...P.tickets.values(), ...P.links.values()]) if (t.key?.startsWith(p + "-")) max = Math.max(max, +t.key.split("-")[1] || 0);
  return `${p}-${max + 1}`;
}
const otherEnd = (l, id) => (l.a === id ? l.b : l.a);
const linksOf = (P, id) => [...P.links].filter(([, l]) => (l.a === id || l.b === id) && P.tickets.has(otherEnd(l, id)));
const findLink = (P, a, b) => [...P.links].find(([, l]) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
function progress(P, id) {
  let done = 0, total = 0;
  for (const [, l] of linksOf(P, id)) { done += l.strength; total += 10; }
  return total ? Math.round(done / total * 100) : null;
}
const columnsFor = (P, prop) => P.settings.board?.columns?.[prop] ?? DEFAULT_COLS[prop] ?? null;
function checkColumns(P, props) {
  for (const [k, v] of Object.entries(props)) {
    const cols = columnsFor(P, k);
    if (cols && v !== null && v !== "" && !cols.includes(v))
      throw new UserError(`"${v}" isn't a ${k} column. Columns: ${cols.join(", ")}. Add it with set_board_columns first, or use one of these.`);
  }
}
function ticketSummary(P, id) {
  const t = P.tickets.get(id), pct = progress(P, id);
  return { key: id, title: t.title, type: t.type, category: t.props?.category ?? null, status: t.props?.status ?? null,
    progress: pct === null ? "no links" : `${pct}% done`, links: linksOf(P, id).length };
}
function linkSummary(P, lid) {
  const l = P.links.get(lid), A = P.tickets.get(l.a), B = P.tickets.get(l.b);
  return { key: lid, title: l.title, type: "Link", between: [`${l.a} ${A?.title ?? "(missing)"}`, `${l.b} ${B?.title ?? "(missing)"}`],
    strength: l.strength, band: band(l.strength), status: l.props?.status ?? null, notes: l.comment || null };
}
function mergeProps(cur, patch) {
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch || {})) { if (v === null) delete next[k]; else next[k] = v; }
  return next;
}

const ok = (data) => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const tool = (fn) => async (args) => {
  try { return ok(await fn(args)); }
  catch (e) { return { isError: true, content: [{ type: "text", text: e instanceof UserError ? e.message : `Error: ${e.message}` }] }; }
};
const propsSchema = z.record(z.string(), z.string().nullable());

/* ---------- server ---------- */
const server = new McpServer({ name: "ticket-graph", version: "2.0.0" }, {
  instructions: `Ticket Graph is the user's local project tracker. Each project is a folder; every ticket is a markdown file (YAML front matter + notes) in its tickets/ folder. The desktop app reloads on its own when these change.
Ticket types: "Content" (a thing in the game, e.g. a unit or building), "Discipline" (a kind of work many things rely on, e.g. Sound, 3D Model, Mechanic) and "Link". The specific kind of Content/Discipline is the "category" property.
A Link is itself a ticket (key LNK-n) between two tickets: it is the actual piece of work, e.g. "Tesla Trooper · 3D Model". It has a strength 0-10 (0 = no work done, 10 = all done; bands 0-3 red, 4-7 yellow, 8-9 green, 10 blue/done), properties such as status, and markdown notes.
A ticket's progress = sum of its links' strengths / (10 x number of links). Board columns come from a property (status by default); status must be one of the project's status columns.
Refer to projects by name and tickets by key (e.g. UNI-8, LNK-37) or title. Read before you write, and confirm with the user before deleting anything.`,
});

server.registerTool("list_projects", {
  title: "List projects", description: "List the projects the app knows about, with folder, counts and overall progress.", inputSchema: {},
}, tool(() => knownProjects(reg).map(summarize).map(p => p.missing ? { name: p.name, folder: p.path, missing: true } : {
  name: p.name, folder: p.path, description: p.description, tickets: p.ticketCount, links: p.linkCount,
  progress: p.linkCount ? `${Math.round(p.strengthSum / (p.linkCount * 10) * 100)}% done` : "no links",
  ...(p.problems ? { unreadable_files: p.problems } : {}),
})));

server.registerTool("create_project", {
  title: "Create project", description: "Create a new project folder and add it to the app's project list.",
  inputSchema: { name: z.string().min(1), description: z.string().optional(), parent_folder: z.string().optional().describe("Where to create the project folder. Defaults to the app's projects folder.") },
}, tool(({ name, description, parent_folder }) => {
  if (knownProjects(reg).map(summarize).some(p => p.name?.toLowerCase() === name.trim().toLowerCase())) throw new UserError(`A project named "${name}" already exists.`);
  const dir = uniqueDir(parent_folder || defaultRoot(), name);
  openProject(dir).init({ name: name.trim(), description: description?.trim() || "" });
  reg.add(dir);
  return { created: name, folder: dir };
}));

server.registerTool("add_project_folder", {
  title: "Add existing project folder", description: "Add an existing Ticket Graph project folder (e.g. one inside a game repo) to the app's project list.",
  inputSchema: { folder: z.string() },
}, tool(({ folder }) => {
  const p = openProject(folder);
  if (!p.exists()) throw new UserError("That folder isn't a Ticket Graph project (no project.yaml or tickets folder).");
  reg.add(p.dir); return { added: p.load().project.name, folder: p.dir };
}));

server.registerTool("update_project", {
  title: "Rename project", description: "Change a project's name or description.",
  inputSchema: { project: z.string(), name: z.string().optional(), description: z.string().optional() },
}, tool(({ project, name, description }) => { openProject(findProjectDir(project)).update({ name, description }); return "Updated."; }));

server.registerTool("remove_project_from_list", {
  title: "Remove project from list", description: "Remove a project from the app's list. Its folder and files are NOT deleted. Confirm with the user first.",
  inputSchema: { project: z.string() },
}, tool(({ project }) => { const dir = findProjectDir(project); reg.remove(dir); return `Removed from the list. Files are still in ${dir}.`; }));

server.registerTool("get_project", {
  title: "Project overview", description: "Overview of one project: link counts per band, progress per discipline and per category, board columns, and any unreadable files.",
  inputSchema: { project: z.string() },
}, tool(({ project }) => {
  const P = loadProject(project);
  const bands = { red: 0, yellow: 0, green: 0, "blue (done)": 0 }; let done = 0, total = 0;
  for (const l of P.links.values()) if (P.tickets.has(l.a) && P.tickets.has(l.b)) { bands[band(l.strength)]++; done += l.strength; total += 10; }
  const byCat = {};
  for (const [id, t] of P.tickets) {
    const c = `${t.type} / ${t.props?.category || "no category"}`; byCat[c] ??= { tickets: 0, done: 0, total: 0 };
    byCat[c].tickets++; for (const [, l] of linksOf(P, id)) { byCat[c].done += l.strength; byCat[c].total += 10; }
  }
  return {
    name: P.project.name, folder: P.project.path, description: P.project.description, tickets: P.tickets.size, links: P.links.size,
    overall: total ? `${Math.round(done / total * 100)}% done` : "no links", links_by_band: bands,
    disciplines: [...P.tickets].filter(([, t]) => t.type === "Discipline").map(([id]) => ticketSummary(P, id)),
    by_category: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, { tickets: v.tickets, progress: v.total ? `${Math.round(v.done / v.total * 100)}% done` : "no links" }])),
    board_columns: { status: columnsFor(P, "status"), ...(P.settings.board?.columns || {}) },
    ...(P.problems.length ? { unreadable_files: P.problems } : {}),
  };
}));

server.registerTool("list_tickets", {
  title: "List tickets", description: "List tickets in a project, optionally filtered. type \"Link\" lists links (the pieces of work between tickets).",
  inputSchema: {
    project: z.string(),
    type: z.enum([...TYPES, "Link"]).optional(), category: z.string().optional(), status: z.string().optional(),
    search: z.string().optional().describe("Text to find in title, key, properties or notes"),
    linked_to: z.string().optional().describe("Only links (type Link) or tickets connected to this ticket"),
    band: z.enum(["red", "yellow", "green", "blue"]).optional().describe("Only links in this strength band (implies links)"),
  },
}, tool(({ project, type, category, status, search, linked_to, band: wantBand }) => {
  const P = loadProject(project);
  const s = search?.toLowerCase();
  const textHit = (t) => !s || [t.title, t.key, t.notes, t.comment, ...Object.values(t.props || {})].some(v => v && String(v).toLowerCase().includes(s));
  const propHit = (t) => (!category || (t.props?.category || "").toLowerCase() === category.toLowerCase())
    && (!status || (t.props?.status || "").toLowerCase() === status.toLowerCase());
  const byKey = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  const hub = linked_to ? findTicket(P, linked_to) : null;
  if (type === "Link" || wantBand) {
    return [...P.links].filter(([, l]) => (!hub || l.a === hub || l.b === hub) && (!wantBand || band(l.strength).startsWith(wantBand)) && propHit(l) && textHit(l))
      .map(([k]) => k).sort(byKey).map(k => linkSummary(P, k));
  }
  let ids = [...P.tickets.keys()];
  if (hub) ids = linksOf(P, hub).map(([, l]) => otherEnd(l, hub));
  return ids.filter(id => { const t = P.tickets.get(id); return (!type || t.type === type) && propHit(t) && textHit(t); })
    .sort(byKey).map(id => ticketSummary(P, id));
}));

server.registerTool("get_ticket", {
  title: "Get ticket", description: "One ticket (Content, Discipline or Link) with its properties, notes, file, and — for Content/Discipline — every link with strength and notes.",
  inputSchema: { project: z.string(), ticket: z.string().describe("Key (e.g. UNI-8, LNK-37) or title") },
}, tool(({ project, ticket }) => {
  const P = loadProject(project), id = findTicket(P, ticket, { allowLinks: true });
  if (P.links.has(id)) { const l = P.links.get(id); return { ...linkSummary(P, id), props: l.props || {} }; }
  const t = P.tickets.get(id);
  return { ...ticketSummary(P, id), props: t.props || {}, notes: t.notes || null,
    links: linksOf(P, id).map(([lid, l]) => ({ key: lid, to: `${otherEnd(l, id)} ${P.tickets.get(otherEnd(l, id)).title}`,
      strength: l.strength, band: band(l.strength), status: l.props?.status ?? null, notes: l.comment || null })) };
}));

server.registerTool("create_ticket", {
  title: "Create ticket", description: "Create a Content or Discipline ticket. Status defaults to the first status column. Optionally create links to existing tickets in the same call.",
  inputSchema: {
    project: z.string(), title: z.string().min(1), type: z.enum(TYPES),
    category: z.string().optional().describe("e.g. Unit, Building, Sound. Reuse existing spellings; it also sets the key prefix."),
    status: z.string().optional(), props: z.record(z.string(), z.string()).optional().describe("Other properties"),
    notes: z.string().optional().describe("Markdown notes"),
    link_to: z.array(z.object({ ticket: z.string(), strength: z.number().int().min(0).max(10).default(0), notes: z.string().optional() })).optional(),
  },
}, tool(({ project, title, type, category, status, props = {}, notes = "", link_to = [] }) => {
  const P = loadProject(project);
  const allProps = { ...props };
  if (category) allProps.category = category;
  const firstStatus = (columnsFor(P, "status") || [])[0];
  if (status) allProps.status = status; else if (firstStatus && !allProps.status) allProps.status = firstStatus;
  checkColumns(P, allProps);
  const targets = link_to.map(l => ({ ...l, id: findTicket(P, l.ticket) }));
  const key = nextKey(P, category || type), now = Date.now();
  const body = { key, title: title.trim(), type, props: allProps, notes: notes.trim(), created: now };
  P.store.put("tickets", key, body); P.tickets.set(key, body);
  const made = targets.map(l => createLink(P, key, l.id, l.strength, l.notes));
  return { created: `${key} ${title}`, links: made };
}));

function createLink(P, a, b, strength = 0, notes = "", title, props = {}) {
  if (a === b) throw new UserError("A ticket can't link to itself.");
  if (findLink(P, a, b)) throw new UserError(`${a} and ${b} are already linked (${findLink(P, a, b)[0]}).`);
  // Content side first, so the title reads "Tesla Trooper · 3D Model".
  if (P.tickets.get(a).type === "Discipline" && P.tickets.get(b).type !== "Discipline") [a, b] = [b, a];
  const key = nextKey(P, "LNK"), first = (columnsFor(P, "status") || [])[0];
  const allProps = { ...(first ? { status: first } : {}), ...props };
  checkColumns(P, allProps);
  const body = { key, title: title || `${P.tickets.get(a).title} · ${P.tickets.get(b).title}`, a, b, strength, comment: (notes || "").trim(), props: allProps, created: Date.now() };
  P.store.put("links", key, body); P.links.set(key, body);
  return `${key} ${body.title} (${strength}/10)`;
}

server.registerTool("update_ticket", {
  title: "Update ticket", description: "Change any ticket's title, type, properties or notes. Works for Link tickets too (and their strength). Properties merge; null removes one.",
  inputSchema: {
    project: z.string(), ticket: z.string(), title: z.string().optional(), type: z.enum(TYPES).optional(),
    props: propsSchema.optional().describe("e.g. {\"status\": \"Done\", \"note\": null}"),
    notes: z.string().optional().describe("Replaces the markdown notes; empty string clears them"),
    strength: z.number().int().min(0).max(10).optional().describe("Links only"),
  },
}, tool(({ project, ticket, title, type, props, notes, strength }) => {
  const P = loadProject(project), id = findTicket(P, ticket, { allowLinks: true });
  if (props) checkColumns(P, Object.fromEntries(Object.entries(props).filter(([, v]) => v !== null)));
  if (P.links.has(id)) {
    if (type) throw new UserError("A Link's type can't change.");
    const l = P.links.get(id);
    const next = { ...l, ...(title ? { title: title.trim() } : {}), ...(strength !== undefined ? { strength } : {}),
      ...(notes !== undefined ? { comment: notes.trim() } : {}), props: mergeProps(l.props, props) };
    P.store.put("links", id, next);
    return { updated: linkSummary({ ...P, links: new Map([...P.links, [id, next]]) }, id), props: next.props };
  }
  if (strength !== undefined) throw new UserError("Strength belongs to links. Use set_link or update the LNK ticket.");
  const t = P.tickets.get(id);
  const next = { ...t, ...(title ? { title: title.trim() } : {}), ...(type ? { type } : {}), ...(notes !== undefined ? { notes: notes.trim() } : {}), props: mergeProps(t.props, props) };
  P.store.put("tickets", id, next);
  // Links still titled "<A> · <B>" follow a renamed ticket.
  if (title && title.trim() !== t.title) for (const [lid, l] of linksOf(P, id)) {
    const A = P.tickets.get(l.a), B = P.tickets.get(l.b);
    const old = `${l.a === id ? t.title : A.title} · ${l.b === id ? t.title : B.title}`;
    if (l.title === old) P.store.put("links", lid, { ...l, title: `${l.a === id ? next.title : A.title} · ${l.b === id ? next.title : B.title}` });
  }
  return { updated: `${id} ${next.title}`, props: next.props };
}));

server.registerTool("delete_ticket", {
  title: "Delete ticket", description: "Delete a ticket's file. Deleting a Content/Discipline ticket also deletes its Link tickets. Only after the user confirms.",
  inputSchema: { project: z.string(), ticket: z.string() },
}, tool(({ project, ticket }) => {
  const P = loadProject(project), id = findTicket(P, ticket, { allowLinks: true });
  if (P.links.has(id)) { P.store.del("links", id); return `Deleted link ${id} ${P.links.get(id).title}.`; }
  const ls = [...P.links].filter(([, l]) => l.a === id || l.b === id);
  for (const [lid] of ls) P.store.del("links", lid);
  P.store.del("tickets", id);
  return `Deleted ${id} ${P.tickets.get(id).title} and ${ls.length} links.`;
}));

server.registerTool("set_link", {
  title: "Link tickets / update link", description: "Create the Link ticket between two tickets, or update the existing one (strength, notes, title, properties). Omitted fields keep their value.",
  inputSchema: {
    project: z.string(), a: z.string(), b: z.string(),
    strength: z.number().int().min(0).max(10).optional(), notes: z.string().optional().describe("Replaces the link's notes; empty string clears them"),
    title: z.string().optional(), props: propsSchema.optional().describe("e.g. {\"status\": \"In progress\"}"),
  },
}, tool(({ project, a, b, strength, notes, title, props }) => {
  const P = loadProject(project), ia = findTicket(P, a), ib = findTicket(P, b);
  const hit = findLink(P, ia, ib);
  if (!hit) return { created: createLink(P, ia, ib, strength ?? 0, notes, title, Object.fromEntries(Object.entries(props || {}).filter(([, v]) => v !== null))) };
  const [lid, l] = hit;
  if (props) checkColumns(P, Object.fromEntries(Object.entries(props).filter(([, v]) => v !== null)));
  const next = { ...l, ...(strength !== undefined ? { strength } : {}), ...(notes !== undefined ? { comment: notes.trim() } : {}),
    ...(title ? { title: title.trim() } : {}), props: mergeProps(l.props, props) };
  P.store.put("links", lid, next);
  return { updated: linkSummary({ ...P, links: new Map([...P.links, [lid, next]]) }, lid) };
}));

server.registerTool("remove_link", {
  title: "Remove link", description: "Delete the Link ticket between two tickets. Confirm with the user first.",
  inputSchema: { project: z.string(), a: z.string(), b: z.string() },
}, tool(({ project, a, b }) => {
  const P = loadProject(project), hit = findLink(P, findTicket(P, a), findTicket(P, b));
  if (!hit) throw new UserError("Those tickets aren't linked.");
  P.store.del("links", hit[0]); return `Deleted ${hit[0]} ${hit[1].title}.`;
}));

server.registerTool("set_board_columns", {
  title: "Set board columns", description: "Set the ordered column list for a property (e.g. status). Renames apply to every ticket and link with the old value; values no longer in the list are cleared.",
  inputSchema: {
    project: z.string(), property: z.string().default("status"), columns: z.array(z.string().min(1)).min(1),
    renames: z.record(z.string(), z.string()).optional().describe("Old name -> new name"),
  },
}, tool(({ project, property, columns, renames = {} }) => {
  const P = loadProject(project);
  const board = { columns: {}, ...(P.settings.board || {}) };
  board.columns = { ...board.columns, [property]: columns };
  P.store.setSetting("board", board);
  let changed = 0;
  for (const [kind, map] of [["tickets", P.tickets], ["links", P.links]]) for (const [id, t] of map) {
    const v = t.props?.[property]; if (v === undefined) continue;
    const props = { ...t.props };
    if (renames[v]) props[property] = renames[v]; else if (!columns.includes(v)) delete props[property]; else continue;
    P.store.put(kind, id, { ...t, props }); changed++;
  }
  return { property, columns, items_changed: changed };
}));

await server.connect(new StdioServerTransport());
