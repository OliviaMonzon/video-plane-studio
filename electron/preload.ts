import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("studioShell", {
  broadcastMidi: (data: number[]) => ipcRenderer.send("grid-midi-message", data),
  platform: process.platform,
});
