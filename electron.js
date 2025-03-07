// electron.js (Main Process)
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { transcribeVideo, initializeWhisper } = require("./transcription/transcribe");
const log = require("electron-log");
const fs = require("fs");

let mainWindow;
let whisperInitialized = false;

// Enhanced resource path logging for better cross-platform debugging
function logResourcePaths() {
  const paths = {
    execPath: app.getPath("exe"),
    appPath: app.getAppPath(),
    userData: app.getPath("userData"),
    temp: app.getPath("temp"),
    resourcesPath: process.resourcesPath || "Not available",
    platform: process.platform,
    arch: process.arch,
    pathSeparator: path.sep,
    // Add platform-specific path checks
    vendorPath: path.join(process.resourcesPath || app.getAppPath(), "vendor"),
    ffmpegPackagedPath: path.join(process.resourcesPath || "", "app.asar.unpacked", "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
  };

  log.info("App resource paths:", paths);

  // Check existence of critical paths for early detection of issues
  if (process.resourcesPath) {
    const criticalPaths = [paths.vendorPath, path.join(paths.vendorPath, "whisper.cpp"), path.join(paths.vendorPath, "models")];

    log.info("Checking critical paths:");
    criticalPaths.forEach((p) => {
      log.info(`${p}: ${fs.existsSync(p) ? "exists" : "missing"}`);
    });
  }
}

function createWindow() {
  // Add path logging at startup
  logResourcePaths();

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development, load the dev server
  // In production, load the bundled app
  const startUrl = process.env.NODE_ENV === "development" ? "http://localhost:5000" : `file://${path.join(__dirname, "public/index.html")}`;

  mainWindow.loadURL(startUrl);

  // Initialize Whisper in the background
  initializeWhisperInBackground();
}

async function initializeWhisperInBackground() {
  try {
    log.info("Initializing Whisper.cpp...");
    whisperInitialized = await initializeWhisper();
    log.info("Whisper initialization complete:", whisperInitialized);

    // Notify the renderer process that Whisper is ready
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("whisper-status", { initialized: whisperInitialized });
    }
  } catch (error) {
    log.error("Error initializing Whisper:", error);
    whisperInitialized = false;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("whisper-status", {
        initialized: false,
        error: error.message,
      });
    }
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Handle video file selection
ipcMain.handle("select-video", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Media Files", extensions: ["mp4", "webm", "mov", "avi", "mp3", "wav", "m4a", "ogg"] },
      { name: "Videos", extensions: ["mp4", "webm", "mov", "avi"] },
      { name: "Audio", extensions: ["mp3", "wav", "m4a", "ogg"] },
    ],
  });

  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

// Handle whisper initialization status check
ipcMain.handle("check-whisper-status", async () => {
  return { initialized: whisperInitialized };
});

// Handle manual whisper initialization
ipcMain.handle("initialize-whisper", async () => {
  try {
    whisperInitialized = await initializeWhisper();
    return { initialized: whisperInitialized };
  } catch (error) {
    log.error("Manual Whisper initialization failed:", error);
    return {
      initialized: false,
      error: error.message,
    };
  }
});

// Add the missing handler that App.svelte references
ipcMain.handle("initialize-whisper-with-options", async (event, options) => {
  try {
    // Pass options to initialization function
    whisperInitialized = await initializeWhisper(false, options);
    return { initialized: whisperInitialized };
  } catch (error) {
    log.error("Whisper initialization with options failed:", error);
    return {
      initialized: false,
      error: error.message,
    };
  }
});

// Handle transcription requests
ipcMain.handle("transcribe-video", async (event, filePath) => {
  try {
    if (!whisperInitialized) {
      // Try to initialize Whisper if not already done
      whisperInitialized = await initializeWhisper();
      if (!whisperInitialized) {
        throw new Error("Whisper.cpp is not initialized. Please check the logs.");
      }
    }

    // Update the UI to show progress
    mainWindow.webContents.send("transcription-progress", {
      status: "started",
      message: "Starting transcription process...",
    });

    // Start the transcription
    const result = await transcribeVideo(filePath);

    // Notify completion
    mainWindow.webContents.send("transcription-progress", {
      status: "completed",
    });

    return result;
  } catch (error) {
    log.error("Transcription error:", error);

    // Notify error
    mainWindow.webContents.send("transcription-progress", {
      status: "error",
      message: error.message,
    });

    return { error: error.message };
  }
});
