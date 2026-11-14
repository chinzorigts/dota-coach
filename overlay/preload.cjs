// @ts-check
// Minimal bridge for the overlay page. No Node APIs reach the page.
// Note: contextBridge copies values at expose time, so anything that arrives later (hotkey labels,
// lock state) is delivered through the onMode callback rather than as an exposed object.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dotaOverlay", {
  /** @param {(mode: { locked: boolean; hotkeys: { toggle: string; lock: string; ask: string } }) => void} cb */
  onMode(cb) {
    /** @param {unknown} _e @param {any} mode */
    const listener = (_e, mode) => cb(mode);
    ipcRenderer.on("overlay:mode", listener);
    return () => ipcRenderer.removeListener("overlay:mode", listener);
  },
});
