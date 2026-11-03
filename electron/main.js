// Desktop wrapper: starts the same web server the browser version uses (on a free port) and shows it in a window.
// The only desktop-specific feature is native folder dialogs (see preload.js).
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require("electron");
const path = require("node:path");
const { startServer } = require("../src/server");
const { appHome } = require("../src/store");

let server;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 420, minHeight: 500,
    title: "Hamon",
    backgroundColor: "#eef1f4",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  win.loadURL(server.url);
  // Links to other sites open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(server.url)) { e.preventDefault(); shell.openExternal(url); } });
  if (process.env.HAMON_SMOKE) require("../test/smoke").run(win);
  if (process.env.HAMON_SCREENSHOTS) require("../scripts/screenshots").run(win);
}

app.whenReady().then(async () => {
  if (process.env.HAMON_THEME) nativeTheme.themeSource = process.env.HAMON_THEME;   // "light" / "dark", for screenshots
  server = await startServer({
    home: appHome(),
    projectsRoot: process.env.HAMON_HOME ? path.join(process.env.HAMON_HOME, "Projects") : path.join(app.getPath("documents"), "Hamon"),
    port: 0,
  });
  ipcMain.handle("dialog:folder", async (e, title) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title, properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { server?.close(); if (process.platform !== "darwin") app.quit(); });
