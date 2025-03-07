const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const util = require("util");
const execPromise = util.promisify(exec);
const os = require("os");
const log = require("electron-log");
const electron = require("electron");

// Get correct app paths based on environment (development vs production)
function getAppPaths() {
  let isPackaged = false;
  let resourcesPath = "";

  // Different ways to get the app, depending on context
  try {
    // In main process
    if (electron.app) {
      isPackaged = electron.app.isPackaged;
      resourcesPath = process.resourcesPath;
    }
    // In renderer process
    else if (electron.remote) {
      isPackaged = electron.remote.app.isPackaged;
      resourcesPath = electron.remote.process.resourcesPath;
    }
    // If electron is not available, we're probably in a worker or elsewhere
    else {
      isPackaged = !!process.resourcesPath;
      resourcesPath = process.resourcesPath;
    }
  } catch (error) {
    log.warn("Error detecting environment:", error);
  }

  let appRoot, vendorDir, modelsDir, whisperDir;

  if (isPackaged && resourcesPath) {
    // In production, use paths in the resources directory outside the ASAR archive
    appRoot = resourcesPath;
    vendorDir = path.join(resourcesPath, "vendor");
    modelsDir = path.join(vendorDir, "models");
    whisperDir = path.join(vendorDir, "whisper.cpp");
  } else {
    // In development, use paths relative to the script
    appRoot = path.join(__dirname, "..");
    vendorDir = path.join(appRoot, "vendor");
    modelsDir = path.join(vendorDir, "models");
    whisperDir = path.join(vendorDir, "whisper.cpp");
  }

  log.info("Environment detection results:");
  log.info(`Is packaged: ${isPackaged}`);
  log.info(`Resources path: ${resourcesPath}`);
  log.info(`App root: ${appRoot}`);
  log.info(`Vendor dir: ${vendorDir}`);
  log.info(`Models dir: ${modelsDir}`);
  log.info(`Whisper dir: ${whisperDir}`);

  return { appRoot, vendorDir, modelsDir, whisperDir };
}

// Configuration - initialize with default values
let APP_ROOT = "";
let VENDOR_DIR = "";
let MODELS_DIR = "";
let WHISPER_DIR = "";
let MODEL_NAME = "ggml-base.en.bin";
let MODEL_PATH = "";
let WHISPER_BINARY = "";

// Initialize paths - but immediately reinitialize in case process.resourcesPath became available later
function initializePaths() {
  const paths = getAppPaths();
  APP_ROOT = paths.appRoot;
  VENDOR_DIR = paths.vendorDir;
  MODELS_DIR = paths.modelsDir;
  WHISPER_DIR = paths.whisperDir;
  MODEL_PATH = path.join(MODELS_DIR, MODEL_NAME);

  // Updated binary names according to whisper.cpp Dec 20, 2024 changes
  // main is now whisper-cli, server is whisper-server, etc.
  const newBinaryName = os.platform() === "win32" ? "whisper-cli.exe" : "whisper-cli";
  const legacyBinaryName = os.platform() === "win32" ? "whisper.exe" : "main";

  const newBinaryPath = path.join(WHISPER_DIR, newBinaryName);
  const legacyBinaryPath = path.join(WHISPER_DIR, legacyBinaryName);

  // Use the binary that exists or default to new one
  if (fs.existsSync(newBinaryPath)) {
    WHISPER_BINARY = newBinaryPath;
    log.info(`Using new binary name: ${newBinaryName}`);
  } else if (fs.existsSync(legacyBinaryPath)) {
    WHISPER_BINARY = legacyBinaryPath;
    log.info(`Using legacy binary name: ${legacyBinaryName}, please note that legacy names will be deprecated`);
  } else {
    // Default to the new name if neither exists
    WHISPER_BINARY = newBinaryPath;
    log.info(`No existing binary found, using new binary name: ${newBinaryName}`);
  }

  log.info("Paths initialized:");
  log.info(`MODEL_PATH: ${MODEL_PATH}`);
  log.info(`WHISPER_BINARY: ${WHISPER_BINARY}`);
}

// Initialize paths right away
initializePaths();

// Create necessary directories
function ensureDirectories() {
  // Reinitialize paths to make sure we have the latest
  initializePaths();

  log.info("Ensuring directories exist...");

  const dirs = [VENDOR_DIR, MODELS_DIR];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      try {
        log.info(`Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        log.error(`Failed to create directory ${dir}:`, error);
        throw new Error(`Cannot create directory ${dir}: ${error.message}`);
      }
    } else {
      log.info(`Directory already exists: ${dir}`);
    }
  }
}

/**
 * Check if required build tools are installed
 */
async function checkDependencies() {
  // Custom function to check if command exists with proper error handling
  async function checkCommand(command, args = "--version") {
    try {
      const cmd = `${command} ${args}`;
      log.info(`Checking for ${command} using: ${cmd}`);
      await execPromise(cmd);
      log.info(`✅ ${command} is available`);
      return true;
    } catch (error) {
      log.error(`❌ ${command} check failed:`, error.message);
      return false;
    }
  }

  // Check common locations on macOS
  const macPaths = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/opt/local/bin", `${os.homedir()}/bin`];

  const missing = [];

  // Check for git
  if (!(await checkCommand("git"))) missing.push("git");

  // Check for cmake (try multiple ways in case PATH is not set correctly)
  let cmakeFound = false;

  // Try default command first
  if (await checkCommand("cmake")) {
    cmakeFound = true;
  } else {
    // Try common paths for macOS
    if (os.platform() === "darwin") {
      for (const basePath of macPaths) {
        const cmakePath = path.join(basePath, "cmake");
        if (await checkCommand(cmakePath)) {
          cmakeFound = true;
          process.env.PATH = `${basePath}:${process.env.PATH}`;
          log.info(`Found cmake at ${cmakePath}, updated PATH`);
          break;
        }
      }
    }

    if (!cmakeFound) {
      missing.push("cmake");

      // Log where cmake might be, to help debugging
      log.info("Searching for cmake in common locations...");
      try {
        if (os.platform() === "darwin") {
          const { stdout } = await execPromise('find /usr/local /opt/homebrew -name cmake -type f 2>/dev/null || echo "Not found"');
          log.info("Possible cmake locations:", stdout);

          // Try to use homebrew to check if installed
          const brewResult = await execPromise('brew list cmake 2>/dev/null || echo "Not installed via Homebrew"');
          log.info("Homebrew cmake info:", brewResult.stdout);
        }
      } catch (err) {
        // Ignore errors in the find command
      }
    }
  }

  // Check for make with similar approach
  let makeFound = false;
  if (os.platform() === "win32") {
    // On Windows, check for cl.exe or nmake
    if ((await checkCommand("cl", "/?")) || (await checkCommand("nmake", "/?"))) {
      makeFound = true;
    } else {
      missing.push("Visual Studio build tools");
    }
  } else {
    // On Unix systems, check for make
    if (await checkCommand("make")) {
      makeFound = true;
    } else {
      // Try common paths for macOS
      if (os.platform() === "darwin") {
        for (const basePath of macPaths) {
          const makePath = path.join(basePath, "make");
          if (await checkCommand(makePath)) {
            makeFound = true;
            process.env.PATH = `${basePath}:${process.env.PATH}`;
            log.info(`Found make at ${makePath}, updated PATH`);
            break;
          }
        }
      }

      if (!makeFound) {
        missing.push("make");
      }
    }
  }

  // Check for Python
  let pythonFound = false;
  const pythonCommands = os.platform() === "win32" ? ["python"] : ["python3", "python"];

  for (const cmd of pythonCommands) {
    if (await checkCommand(cmd)) {
      pythonFound = true;
      break;
    }
  }

  if (!pythonFound) {
    // Try common paths for macOS
    if (os.platform() === "darwin") {
      for (const basePath of macPaths) {
        const pythonPath = path.join(basePath, "python3");
        if (await checkCommand(pythonPath)) {
          pythonFound = true;
          process.env.PATH = `${basePath}:${process.env.PATH}`;
          log.info(`Found python3 at ${pythonPath}, updated PATH`);
          break;
        }
      }
    }

    if (!pythonFound) {
      missing.push("python3");
    }
  }

  if (missing.length > 0) {
    // Log environment information
    log.info(`Current PATH: ${process.env.PATH}`);
    log.info(`Platform: ${os.platform()} ${os.release()}`);
    log.info(`User home: ${os.homedir()}`);

    const instructions = {
      darwin: `
Run: brew install git cmake make python3

Alternatively, specify paths manually using the "Initialize Without Dependency Checks" button.
      `,
      linux: "Run: sudo apt-get install git cmake build-essential python3",
      win32: "Install Git, CMake, Visual Studio (with C++ workload), and Python from their official websites",
    };

    const platform = os.platform();
    const platformInstructions = instructions[platform] || instructions.linux;

    throw new Error(`Missing required dependencies: ${missing.join(", ")}. 
      \n\nInstallation instructions: 
      \n${platformInstructions}
      \n\nMake sure these tools are in your PATH environment variable.
      \n\nAfter installing dependencies, restart the application.`);
  }

  return true;
}

/**
 * Initialize Whisper.cpp - using pre-built binary or building from source if necessary
 * @param {boolean} forceDownload - Force download model even if it exists
 * @param {Object} options - Additional options
 * @returns {Promise<boolean>} - Initialization result
 */
async function initializeWhisper(forceDownload = false, options = {}) {
  try {
    // Re-initialize paths to make sure we have the latest ones
    initializePaths();

    log.info("Starting Whisper initialization...");
    log.info(`App root: ${APP_ROOT}`);
    log.info(`Vendor dir: ${VENDOR_DIR}`);
    log.info(`Models dir: ${MODELS_DIR}`);
    log.info(`Whisper dir: ${WHISPER_DIR}`);
    log.info(`Binary path: ${WHISPER_BINARY}`);
    log.info(`Model path: ${MODEL_PATH}`);

    // Make sure directories exist
    ensureDirectories();

    // Check if binary exists and usable
    if (fs.existsSync(WHISPER_BINARY)) {
      try {
        // Test run the binary to make sure it works
        await execPromise(`"${WHISPER_BINARY}" --help`);

        // If model doesn't exist or forceDownload is true, download it
        if (!fs.existsSync(MODEL_PATH) || forceDownload) {
          await downloadWhisperModel();
        }

        log.info("Using existing Whisper binary");
        return true;
      } catch (error) {
        log.warn("Existing binary failed test:", error.message);
        log.info("Will try to build from source instead");
      }
    } else {
      log.info(`No usable binary found at ${WHISPER_BINARY}`);
    }

    // We need to build from source - check if we have source code
    let hasValidSource = false;

    if (fs.existsSync(WHISPER_DIR)) {
      // Check if it has CMakeLists.txt
      if (fs.existsSync(path.join(WHISPER_DIR, "CMakeLists.txt"))) {
        log.info("Found existing Whisper.cpp source code");
        hasValidSource = true;
      } else {
        log.warn("Directory exists but doesn't appear to contain Whisper source code");
        // Try to remove the directory
        try {
          fs.rmSync(WHISPER_DIR, { recursive: true, force: true });
          log.info(`Removed invalid source directory at ${WHISPER_DIR}`);
        } catch (rmError) {
          log.error("Couldn't remove invalid source directory:", rmError);
          throw new Error(`Cannot prepare for source download. Please delete ${WHISPER_DIR} manually.`);
        }
      }
    }

    // Clone the repository if needed
    if (!hasValidSource) {
      log.info("Cloning Whisper repository...");
      await execPromise(`git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "${WHISPER_DIR}"`);
    }

    // At this point, we should have the source code, check for dependencies
    if (!options.skipDependencyCheck) {
      log.info("Checking build dependencies");
      await checkDependencies();
    } else {
      log.info("Skipping dependency checks as requested");
    }

    // Build Whisper from source
    await buildWhisper();

    // Download model if it doesn't exist
    if (!fs.existsSync(MODEL_PATH) || forceDownload) {
      await downloadWhisperModel();
    }

    log.info("Whisper initialization completed successfully");
    return true;
  } catch (error) {
    log.error("Detailed initialization error:", error);
    throw error; // Just rethrow without wrapping to preserve the detailed message
  }
}

// Extract model downloading to a separate function
async function downloadWhisperModel() {
  log.info(`Downloading model ${MODEL_NAME}...`);

  // Add retry logic
  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log.info(`Download attempt ${attempt}/${maxRetries}`);

      // Try use both methods
      if (attempt === 1) {
        // First try direct download
        await downloadModelDirect();
      } else {
        // Then try python script
        await downloadModelWithPythonScript();
      }

      // If we got here, download was successful
      log.info("Model downloaded successfully");
      return true;
    } catch (error) {
      lastError = error;
      log.error(`Download attempt ${attempt} failed:`, error.message);

      // Wait a bit before retrying (increasing delay)
      if (attempt < maxRetries) {
        const delay = attempt * 1000; // 1s, 2s, 3s...
        log.info(`Waiting ${delay}ms before next attempt...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // If we get here, all attempts failed
  throw new Error(`Failed to download model after ${maxRetries} attempts: ${lastError?.message}`);
}

// Direct download from HuggingFace
async function downloadModelDirect() {
  const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`;
  const tempPath = path.join(os.tmpdir(), `${MODEL_NAME}-${Date.now()}`);

  log.info(`Attempting direct download from ${modelUrl} to ${tempPath}`);

  // Helper function to handle redirects
  async function downloadWithRedirects(url, filePath, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
      let redirectCount = 0;

      function makeRequest(currentUrl) {
        log.info(`Downloading from: ${currentUrl}`);

        // Get the appropriate request library
        const requestLib = currentUrl.startsWith("https") ? require("https") : require("http");

        const options = {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
        };

        requestLib
          .get(currentUrl, options, (res) => {
            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
              if (redirectCount >= maxRedirects) {
                return reject(new Error(`Too many redirects (${redirectCount})`));
              }

              redirectCount++;
              const location = res.headers.location;
              if (!location) {
                return reject(new Error("Redirect with no location header"));
              }

              // Handle relative URLs
              const nextUrl = /^https?:\/\//i.test(location) ? location : new URL(location, currentUrl).toString();

              log.info(`Following redirect to: ${nextUrl}`);
              return makeRequest(nextUrl);
            }

            // Handle successful response
            if (res.statusCode !== 200) {
              return reject(new Error(`Download failed with status code: ${res.statusCode}`));
            }

            // Create write stream and pipe response to it
            const fileStream = fs.createWriteStream(filePath);
            res.pipe(fileStream);

            fileStream.on("finish", () => {
              fileStream.close();
              log.info(`Downloaded to ${filePath}`);
              resolve();
            });

            fileStream.on("error", (err) => {
              fs.unlink(filePath, () => {});
              reject(err);
            });
          })
          .on("error", reject);
      }

      // Start the first request
      makeRequest(url);
    });
  }

  // Perform the download
  await downloadWithRedirects(modelUrl, tempPath);

  // Verify download was successful
  if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size < 1000000) {
    // At least 1MB
    throw new Error("Downloaded file is too small or doesn't exist");
  }

  // Copy to final location
  fs.copyFileSync(tempPath, MODEL_PATH);
  fs.unlinkSync(tempPath); // Clean up temp file

  return true;
}

// Download using the Python script from whisper.cpp

async function downloadModelWithPythonScript() {
  log.info("Trying download via Python script method");

  if (!fs.existsSync(WHISPER_DIR)) {
    throw new Error(`Whisper directory not found at ${WHISPER_DIR}`);
  }

  const scriptPath = path.join(WHISPER_DIR, "models", "download-ggml-model.py");
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Download script not found at ${scriptPath}`);
  }

  const pythonCmd = os.platform() === "win32" ? "python" : "python3";
  const downloadCmd = `cd "${WHISPER_DIR}" && ${pythonCmd} models/download-ggml-model.py base.en`;

  const { stdout, stderr } = await execPromise(downloadCmd);
  log.info("Download script output:", stdout);
  if (stderr) log.error("Download script warnings:", stderr);

  // Check if download was successful
  const downloadedModel = path.join(WHISPER_DIR, "models", MODEL_NAME);
  if (!fs.existsSync(downloadedModel)) {
    throw new Error("Model download completed but file not found");
  }

  // Move to our models directory
  fs.copyFileSync(downloadedModel, MODEL_PATH);

  return true;
}

async function findAndCopyBinary(buildDir) {
  const binaryNames = [
    { name: os.platform() === "win32" ? "whisper-cli.exe" : "whisper-cli", isNew: true },
    { name: os.platform() === "win32" ? "whisper.exe" : "main", isNew: false },
  ];

  // Look in multiple possible locations where the binary might be built
  const possibleLocations = [
    buildDir,
    WHISPER_DIR,
    path.join(buildDir, os.platform() === "win32" ? "Release" : "."),
    path.join(buildDir, "bin"),
    path.join(buildDir, "examples", "cli"),
    path.join(buildDir, "examples", "main"),
    path.join(buildDir, "examples", "whisper-cli"),
  ];

  log.info(`Searching for binary in ${possibleLocations.length} locations...`);

  // Find any available binary, preferring the new name
  let builtBinary = null;
  let foundBinaryName = null;

  // First try the new binary names
  for (const { name, isNew } of binaryNames) {
    if (builtBinary) break; // Stop if we already found one

    for (const location of possibleLocations) {
      const binaryPath = path.join(location, name);
      log.info(`Checking ${isNew ? "new" : "legacy"} binary at: ${binaryPath}`);

      if (fs.existsSync(binaryPath)) {
        log.info(`Found binary at: ${binaryPath}`);
        builtBinary = binaryPath;
        foundBinaryName = name;
        break;
      }
    }
  }

  // Deep search if we still haven't found anything
  if (!builtBinary) {
    // ...existing deep search code...

    // Add logic to search for both binary names
    for (const { name } of binaryNames) {
      const found = findBinary(buildDir, name);
      if (found) {
        builtBinary = found;
        foundBinaryName = name;
        log.info(`Found binary through deep search at: ${builtBinary}`);
        break;
      }
    }
  }

  if (builtBinary) {
    const targetBinary = path.join(WHISPER_DIR, foundBinaryName);
    fs.copyFileSync(builtBinary, targetBinary);
    log.info(`Binary copied to: ${targetBinary}`);

    // Set the global binary path to match what we found
    WHISPER_BINARY = targetBinary;

    // Make executable
    if (os.platform() !== "win32") {
      try {
        fs.chmodSync(targetBinary, 0o755);
        log.info("Set executable permission on binary");
      } catch (chmodError) {
        log.warn("Failed to set executable permission:", chmodError.message);
      }
    }

    return true;
  }

  return false;
}

async function buildWhisper() {
  log.info("Building Whisper...");
  try {
    // Set build environment variables for better compatibility
    const env = {
      ...process.env,
      CFLAGS: "-pthread",
      CMAKE_MAKE_PROGRAM: "make",
    };

    // Create build directory
    const buildDir = path.join(WHISPER_DIR, "build");
    if (fs.existsSync(buildDir)) {
      // Clean existing build directory if it exists
      fs.rmSync(buildDir, { recursive: true, force: true });
    }
    fs.mkdirSync(buildDir, { recursive: true });

    // Configure CMake with absolute paths and specific options
    const configureCmd =
      os.platform() === "win32"
        ? `cd "${buildDir}" && cmake "${WHISPER_DIR}" -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DBUILD_SHARED_LIBS=OFF`
        : `cd "${buildDir}" && cmake "${WHISPER_DIR}" -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DBUILD_SHARED_LIBS=OFF`;

    log.info("Configuring CMake...");
    const configResult = await execPromise(configureCmd, { env });
    log.info("CMake configuration output:", configResult.stdout);
    if (configResult.stderr) log.error("CMake configuration errors:", configResult.stderr);

    // Build the project
    const buildCmd = os.platform() === "win32" ? `cd "${buildDir}" && cmake --build . --config Release` : `cd "${buildDir}" && make -j$(nproc)`;

    log.info("Building project...");
    const buildResult = await execPromise(buildCmd, { env });
    log.info("Build output:", buildResult.stdout);
    if (buildResult.stderr) log.error("Build errors:", buildResult.stderr);

    // Find and copy the binary using our new function
    const binaryFound = await findAndCopyBinary(buildDir);

    if (!binaryFound) {
      // Try to list all files in the build directory to help debugging
      try {
        const buildDirContents = fs.readdirSync(buildDir);
        log.info(`Build directory contents: ${JSON.stringify(buildDirContents)}`);

        // Check if there are subdirectories
        for (const item of buildDirContents) {
          const itemPath = path.join(buildDir, item);
          if (fs.statSync(itemPath).isDirectory()) {
            log.info(`Found subdirectory: ${item}`);
            const subDirContents = fs.readdirSync(itemPath);
            log.info(`Contents of ${item}: ${JSON.stringify(subDirContents)}`);
          }
        }
      } catch (listError) {
        log.error("Error listing build directory:", listError);
      }

      throw new Error(`Built binary not found. Checked: ${possibleBinaryLocations.join(", ")}`);
    }

    return true;
  } catch (error) {
    log.error("Detailed build error:", error);
    throw new Error(`Build failed: ${error.message}`);
  }
}

/**
 * Transcribe a media file (video or audio) using Whisper.cpp
 * @param {string} mediaPath - Path to the video or audio file
 * @returns {Promise<Object>} - Transcription result
 */
async function transcribeVideo(mediaPath) {
  try {
    const isInitialized = await initializeWhisper();
    if (!isInitialized) {
      throw new Error("Failed to initialize Whisper.cpp");
    }

    // Create a temporary directory for processing
    const tempDir = path.join(os.tmpdir(), "whisper-transcription");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Check if it's already an audio file
    const fileExt = path.extname(mediaPath).toLowerCase();
    const isAudioFile = [".mp3", ".wav", ".m4a", ".ogg", ".flac"].includes(fileExt);

    log.info(`Processing ${isAudioFile ? "audio" : "video"} file: ${mediaPath}`);

    // Generate unique filenames
    const baseName = path.basename(mediaPath, path.extname(mediaPath));
    const timestamp = Date.now();
    const audioFile = `${baseName}-${timestamp}.wav`;
    const audioPath = path.join(tempDir, audioFile);

    // Get a working ffmpeg path
    let ffmpegCommand;

    if (electron.app && electron.app.isPackaged) {
      // In packaged app, try system ffmpeg first
      try {
        await execPromise("ffmpeg -version");
        ffmpegCommand = `ffmpeg -i "${mediaPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}"`;
        log.info("Using system ffmpeg");
      } catch (e) {
        // If system ffmpeg fails, try paths in packaged app
        const possibleFfmpegPath = path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "ffmpeg-static", os.platform() === "win32" ? "ffmpeg.exe" : "ffmpeg");

        if (fs.existsSync(possibleFfmpegPath)) {
          // Make it executable on Unix systems
          if (os.platform() !== "win32") {
            try {
              fs.chmodSync(possibleFfmpegPath, 0o755);
            } catch (err) {
              log.warn("Could not set executable permission on ffmpeg:", err.message);
            }
          }

          ffmpegCommand = `"${possibleFfmpegPath}" -i "${mediaPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}"`;
          log.info(`Using ffmpeg from: ${possibleFfmpegPath}`);
        } else {
          throw new Error("Could not find a working ffmpeg binary");
        }
      }
    } else {
      // In development, use ffmpeg-static
      ffmpegCommand = `"${ffmpegPath}" -i "${mediaPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}"`;
      log.info(`Using ffmpeg-static from: ${ffmpegPath}`);
    }

    // Extract audio from video using ffmpeg
    log.info("Extracting audio from video...");
    log.info(`Running command: ${ffmpegCommand}`);

    try {
      await execPromise(ffmpegCommand);
    } catch (ffmpegErr) {
      log.error("FFmpeg extraction error:", ffmpegErr);
      throw new Error(`Failed to extract audio: ${ffmpegErr.message}`);
    }

    // Check that the audio file was created successfully
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Failed to extract audio to ${audioPath}`);
    }

    const audioStats = fs.statSync(audioPath);
    log.info(`Audio file created: ${audioPath}, size: ${audioStats.size} bytes`);

    if (audioStats.size < 1024) {
      log.warn("Audio file seems too small, may not contain proper audio data");
    }

    // Prepare paths for transcription
    const whisperBinaryDir = path.dirname(WHISPER_BINARY);
    const audioPathAbsolute = path.resolve(audioPath);
    const modelPathAbsolute = path.resolve(MODEL_PATH);
    const tempDirAbsolute = path.resolve(tempDir);

    // Create the launcher script if it doesn't exist
    const launcherScriptPath = path.join(WHISPER_DIR, os.platform() === "win32" ? "run-whisper.bat" : "run-whisper.sh");
    if (!fs.existsSync(launcherScriptPath)) {
      log.info("Creating launcher script...");
      try {
        // Execute the create-launcher script to generate the launcher
        await execPromise(`node "${path.join(APP_ROOT, "scripts", "create-launcher.js")}"`, { stdio: "inherit" });
      } catch (scriptErr) {
        log.warn("Failed to create launcher script:", scriptErr.message);
      }
    }

    // Use the launcher script if it exists
    const useLauncher = fs.existsSync(launcherScriptPath);
    log.info(`Using launcher script: ${useLauncher ? "Yes" : "No"}`);

    // We'll define the expected output filename explicitly
    const expectedOutputBasename = `${audioFile}`;
    const expectedOutputFile = path.join(tempDir, `${expectedOutputBasename}.txt`);

    log.info(`Expected output file: ${expectedOutputFile}`);

    let transcriptionCommand;
    if (useLauncher) {
      // Use launcher script
      if (os.platform() === "win32") {
        transcriptionCommand = `cd "${whisperBinaryDir}" && run-whisper.bat -m "${modelPathAbsolute}" -f "${audioPathAbsolute}" -of "${path.join(tempDirAbsolute, expectedOutputBasename)}" -otxt`;
      } else {
        transcriptionCommand = `cd "${whisperBinaryDir}" && ./run-whisper.sh -m "${modelPathAbsolute}" -f "${audioPathAbsolute}" -of "${path.join(tempDirAbsolute, expectedOutputBasename)}" -otxt`;
      }
    } else {
      // Fallback to direct execution with PATH and environment variables set
      // Use the binary name determined during initialization
      const binaryName = path.basename(WHISPER_BINARY);
      transcriptionCommand = `cd "${whisperBinaryDir}" && ./${binaryName} -m "${modelPathAbsolute}" -f "${audioPathAbsolute}" -of "${path.join(tempDirAbsolute, expectedOutputBasename)}" -otxt`;
    }

    log.info(`Executing transcription command: ${transcriptionCommand}`);

    try {
      // Execute the transcription command with enhanced environment
      const { stdout, stderr } = await execPromise(transcriptionCommand, {
        shell: true,
        env: {
          ...process.env,
          PATH: `${whisperBinaryDir}:${process.env.PATH}`,
          LD_LIBRARY_PATH: os.platform() !== "win32" ? `${whisperBinaryDir}:${process.env.LD_LIBRARY_PATH || ""}` : undefined,
          DYLD_LIBRARY_PATH: os.platform() === "darwin" ? `${whisperBinaryDir}:${process.env.DYLD_LIBRARY_PATH || ""}` : undefined,
        },
      });

      log.info("Transcription stdout:", stdout);
      if (stderr) log.info("Transcription stderr:", stderr);
    } catch (execError) {
      log.error("Transcription execution error:", execError);
      throw new Error(`Transcription process failed: ${execError.message}`);
    }

    // List all files in the temp directory to help debug
    try {
      const tempFiles = fs.readdirSync(tempDir);
      log.info(`Files in temp directory: ${JSON.stringify(tempFiles)}`);
    } catch (readErr) {
      log.warn("Could not read temp directory:", readErr.message);
    }

    // Check if the expected output file exists
    if (!fs.existsSync(expectedOutputFile)) {
      log.error(`Expected output file not found: ${expectedOutputFile}`);

      // Try alternative output paths - some whisper.cpp versions might use different naming conventions
      const possibleTranscriptionPaths = [
        path.join(tempDir, `${path.basename(audioPath)}.txt`),
        path.join(tempDir, `${baseName}-${timestamp}.wav.txt`),
        path.join(tempDir, `${baseName}.txt`),
        path.join(tempDir, `${baseName}.wav.txt`),
        path.join(tempDir, `transcript.txt`),
      ];

      log.info("Looking for alternative output files:", possibleTranscriptionPaths);

      for (const filePath of possibleTranscriptionPaths) {
        if (fs.existsSync(filePath)) {
          log.info(`Found alternative output at: ${filePath}`);
          fs.copyFileSync(filePath, expectedOutputFile); // Copy to expected location
          break;
        }
      }

      // Final check after trying alternatives
      if (!fs.existsSync(expectedOutputFile)) {
        throw new Error("Transcription completed but output file not found");
      }
    }

    // Read the transcription text
    const transcript = fs.readFileSync(expectedOutputFile, "utf8");
    log.info(`Transcription length: ${transcript.length} characters`);

    // Clean up temporary files
    try {
      fs.unlinkSync(expectedOutputFile);
      fs.unlinkSync(audioPath);
      log.info("Temporary files cleaned up");
    } catch (cleanupErr) {
      log.warn("Error cleaning up temp files:", cleanupErr.message);
    }

    return {
      transcript,
      model: MODEL_NAME,
    };
  } catch (error) {
    log.error("Error during transcription:", error);
    throw new Error(`Transcription failed: ${error.message}`);
  }
}

module.exports = {
  transcribeVideo,
  initializeWhisper,
};
