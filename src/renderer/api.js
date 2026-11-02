// Browser client for the Ticket Graph server (src/server.js). The page only talks to window.tg.
// In the desktop app, electron/preload.js adds window.tgNative for native folder dialogs.
(() => {
  const clientId = crypto.randomUUID();   // lets this tab ignore change events caused by its own writes
  async function call(method, url, body) {
    const r = await fetch(url, {
      method, headers: { "x-tg-client": clientId, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`);
    return data;
  }
  const post = (url, body) => call("POST", url, body);
  const askFolder = async (title) => window.tgNative
    ? window.tgNative.chooseFolder(title)
    : (prompt(`${title}\nPaste the full folder path:`) || "").trim() || null;

  const listeners = [];
  let events = null;
  function connect() {
    events = new EventSource("/api/events");
    events.addEventListener("changed", (e) => {
      const { dir, by } = JSON.parse(e.data);
      if (by !== clientId) listeners.forEach(f => f(dir));
    });
  }

  window.tg = {
    listProjects: () => call("GET", "/api/projects"),
    defaultRoot: () => call("GET", "/api/default-root"),
    createProject: (p) => post("/api/projects", p),
    chooseParent: () => askFolder("Where should the project folder go?"),
    openFolder: async () => { const dir = await askFolder("Open a project folder"); return dir ? post("/api/projects/add", { path: dir }) : null; },
    removeProject: (dir) => post("/api/projects/remove", { path: dir }),
    revealProject: (dir) => post("/api/projects/reveal", { path: dir }),
    updateProject: (dir, p) => post("/api/projects/update", { path: dir, ...p }),
    load: (dir) => post("/api/load", { path: dir }),
    close: async () => {},
    put: (kind, dir, id, body) => post("/api/put", { kind, path: dir, id, body }),
    del: (kind, dir, id) => post("/api/del", { kind, path: dir, id }),
    setSetting: (dir, key, value) => post("/api/setting", { path: dir, key, value }),
    onExternalChange: (cb) => { listeners.push(cb); if (!events) connect(); },
  };
})();
