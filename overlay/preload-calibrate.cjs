// @ts-check
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("calib", {
  /** @param {(dataUrl: string) => void} cb */
  onImage(cb) {
    ipcRenderer.on("calib:image", (_e, dataUrl) => cb(dataUrl));
  },
  /** @param {unknown} rects */
  save(rects) {
    ipcRenderer.send("calib:save", rects);
  },
  cancel() {
    ipcRenderer.send("calib:cancel");
  },
});
