const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // File operations
  selectVideo: () => ipcRenderer.invoke("select-video"),

  // Transcription operations
  transcribeVideo: (filePath) => ipcRenderer.invoke("transcribe-video", filePath),

  // Whisper operations
  checkWhisperStatus: () => ipcRenderer.invoke("check-whisper-status"),
  initializeWhisperWithOptions: (options) => ipcRenderer.invoke("initialize-whisper-with-options", options),

  // System information
  getSystemInfo: () => ipcRenderer.invoke("get-system-info"),

  // Event listeners
  onWhisperStatus: (callback) => ipcRenderer.on("whisper-status", (_, data) => callback(data)),
  onTranscriptionProgress: (callback) => ipcRenderer.on("transcription-progress", (_, data) => callback(data)),

  // Add an explicit quit function
  quitApp: () => {
    ipcRenderer.send("app-quit");
  },
});
