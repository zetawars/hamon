// Hamon web server: serves the app and a JSON API over the project folders (see store.js).
// Run on its own with `npm run web`, or embedded by the Electron app (electron/main.js).
// It only listens on localhost, and rejects requests whose Host isn't localhost (DNS-rebinding guard).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { openProject, registry, summarize, knownProjects, REPO_PROJECTS, isImageRef, appHome } = require("./store");
const { uniqueDir } = require("./migrate");

const ROOT = path.join(__dirname, "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp" };
// URL prefix -> folder for static files. /vendor serves only the few browser libraries the page uses.
const STATIC = [
  ["/vendor/d3/", path.join(ROOT, "node_modules", "d3", "dist")],
  ["/vendor/fonts/", path.join(ROOT, "node_modules", "@fontsource")],
  ["/", path.join(__dirname, "renderer")],
];

function startServer({ home = appHome(), projectsRoot, port = Number(process.env.PORT) || 4387, host = "127.0.0.1" } = {}) {
  const reg = registry(path.join(home, "projects.json"));
  // Where new projects go: the user's saved choice, else the caller's default, else this repo's projects/ folder.
  const root = () => reg.root() || projectsRoot || REPO_PROJECTS;

  // First run after the SQLite version: move those projects into folders.
  const oldDb = path.join(home, "ticket-graph.db");
  if (!reg.exists() && fs.existsSync(oldDb)) {
    try { for (const dir of require("./migrate").migrateDatabase(oldDb, root()).reverse()) reg.add(dir); }
    catch (e) { console.error("Migration from SQLite failed:", e.message); }
  }

  /* ---------- live updates: watch open projects, push changes over Server-Sent Events ---------- */
  const clients = new Set();
  const watches = new Map();   // dir -> { known, watchers, timer }
  const send = (event, data) => { for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  function watch(dir) {
    if (watches.has(dir)) return;
    const proj = openProject(dir), w = { known: proj.signature(), watchers: [], timer: null };
    const check = () => {
      clearTimeout(w.timer);
      w.timer = setTimeout(() => {
        const sig = proj.signature();
        if (sig !== w.known) { w.known = sig; send("changed", { dir }); }
      }, 350);
    };
    // Recursive, so pass files (passes/<LINK>/NNN.md) are noticed too.
    try { w.watchers.push(fs.watch(dir, { recursive: true }, check)); }
    catch { for (const t of [dir, path.join(dir, "tickets")]) { try { w.watchers.push(fs.watch(t, check)); } catch {} } }
    watches.set(dir, w);
  }
  // After an API write: record the new state so the watcher doesn't report it again, and tell every
  // client; the one that made the change (by = its client id) ignores it.
  const afterWrite = (dir, by) => {
    dir = path.resolve(dir);
    const w = watches.get(dir); if (w) w.known = openProject(dir).signature();
    send("changed", { dir, by });
  };

  /* ---------- API ---------- */
  const api = {
    "GET /api/projects": () => knownProjects(reg).map(summarize),
    "GET /api/default-root": () => root(),
    "POST /api/projects": ({ name, description, parent }) => {
      if (!name?.trim()) throw Object.assign(new Error("A project needs a name."), { status: 400 });
      const dir = uniqueDir(parent || root(), name);
      openProject(dir).init({ name: name.trim(), description: (description || "").trim() });
      reg.add(dir);
      return dir;
    },
    "POST /api/projects/add": ({ path: dir }) => {
      const p = openProject(dir);
      if (!p.exists()) throw Object.assign(new Error("That folder isn't a Hamon project (no project.yaml or tickets folder)."), { status: 400 });
      reg.add(p.dir);
      return p.dir;
    },
    "POST /api/projects/remove": ({ path: dir }) => reg.remove(dir),
    "POST /api/projects/update": ({ path: dir, name, description }, by) => { openProject(dir).update({ name, description }); afterWrite(dir, by); },
    "POST /api/projects/reveal": ({ path: dir }) => {
      const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
      spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();
    },
    "POST /api/load": ({ path: dir }) => {
      const p = openProject(dir);
      if (!p.exists()) return { project: null };
      reg.touch(p.dir);
      watch(p.dir);
      return p.load();
    },
    "POST /api/put": ({ kind, path: dir, id, body }, by) => { openProject(dir).put(kind, id, body); afterWrite(dir, by); },
    "POST /api/del": ({ kind, path: dir, id }, by) => { openProject(dir).del(kind, id); afterWrite(dir, by); },
    "POST /api/passes": ({ path: dir, link }) => openProject(dir).passes(link),
    "POST /api/pass": ({ path: dir, link, pass }, by) => { const r = openProject(dir).addPass(link, pass); afterWrite(dir, by); return r; },
    "POST /api/setting": ({ path: dir, key, value }, by) => { openProject(dir).setSetting(key, value); afterWrite(dir, by); },
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 5e6) reject(Object.assign(new Error("Request too large"), { status: 413 })); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(Object.assign(new Error("Bad JSON"), { status: 400 })); } });
  });
  const json = (res, status, data) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(data ?? null)); };

  // Serves an image that a pass references, so thumbnails work. Only images named in that pass file are served,
  // never an arbitrary path.
  function serveAsset(res, q) {
    try {
      const proj = openProject(q.get("path"));
      const pass = proj.passes(q.get("link")).find(p => String(p.pass) === q.get("pass"));
      const ref = pass?.assets[Number(q.get("i"))];
      if (!ref || !isImageRef(ref)) { res.writeHead(404); return res.end("No such image"); }
      const { file } = proj.resolveAsset(ref);
      if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end("Image file not found"); }
      res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" });
      fs.createReadStream(file).pipe(res);
    } catch (e) { res.writeHead(400); res.end(e.message); }
  }

  function serveStatic(req, res, pathname) {
    for (const [prefix, dir] of STATIC) {
      if (!pathname.startsWith(prefix)) continue;
      const rel = decodeURIComponent(pathname.slice(prefix.length)) || "index.html";
      const file = path.resolve(dir, rel);
      if (!file.startsWith(dir + path.sep) && file !== dir) break;
      if (prefix === "/vendor/fonts/" && !/\.(css|woff2?)$/.test(file)) break;
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found");
  }

  const server = http.createServer(async (req, res) => {
    const hostName = (req.headers.host || "").replace(/:\d+$/, "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostName)) { res.writeHead(403); return res.end("Forbidden"); }
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    const handler = api[`${req.method} ${pathname}`];
    if (handler) {
      try { json(res, 200, await handler(req.method === "POST" ? await readBody(req) : {}, String(req.headers["x-tg-client"] || ""))); }
      catch (e) { json(res, e.status || 500, { error: e.message }); }
      return;
    }
    if (pathname === "/api/asset" && req.method === "GET") return serveAsset(res, new URL(req.url, "http://localhost").searchParams);
    if (pathname.startsWith("/api/")) return json(res, 404, { error: "Unknown API route" });
    serveStatic(req, res, pathname);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve({
      port: server.address().port, url: `http://localhost:${server.address().port}/`,
      close() { for (const w of watches.values()) w.watchers.forEach(x => x.close()); for (const c of clients) c.end(); server.close(); },
    }));
  });
}

module.exports = { startServer };

if (require.main === module) {
  startServer().then(({ url }) => console.log(`Hamon is running at ${url}`))
    .catch((e) => { console.error(e.code === "EADDRINUSE" ? `Port ${e.port} is in use. Set PORT to another number.` : e.message); process.exit(1); });
}
