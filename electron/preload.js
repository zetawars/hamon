const { contextBridge, ipcRenderer } = require("electron");

// The page uses the web API (src/renderer/api.js); the desktop app only adds native folder dialogs.
contextBridge.exposeInMainWorld("tgNative", {
  chooseFolder: (title) => ipcRenderer.invoke("dialog:folder", title),
});
