/**
 * Preload bridge — launcher page talks to main via window.lolhelp
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lolhelp", {
  getState: () => ipcRenderer.invoke("launcher:getState"),
  setOverlayVisible: (visible) => ipcRenderer.invoke("launcher:setOverlayVisible", visible),
  setClickThrough: (clickThrough) => ipcRenderer.invoke("launcher:setClickThrough", clickThrough),
  setModule: (key, enabled) => ipcRenderer.invoke("launcher:setModule", key, enabled),
  openDashboard: () => ipcRenderer.invoke("launcher:openDashboard"),
  restartServer: () => ipcRenderer.invoke("launcher:restartServer"),
  checkUpdates: () => ipcRenderer.invoke("launcher:checkUpdates"),
  applyUpdate: () => ipcRenderer.invoke("launcher:applyUpdate"),
  quitApp: () => ipcRenderer.invoke("launcher:quit"),
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on("launcher:state", handler);
    return () => ipcRenderer.removeListener("launcher:state", handler);
  },
});
