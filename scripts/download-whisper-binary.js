const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const os = require("os");
const { execSync } = require("child_process");
const { URL } = require("url");

// Configure paths
const vendorDir = path.join(__dirname, "..", "vendor");
const whisperDir = path.join(vendorDir, "whisper.cpp");
const modelsDir = path.join(vendorDir, "models");

// Create necessary directories
for (const dir of [vendorDir, whisperDir, modelsDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Get platform specific details
function getPlatformDetails() {
  const platform = os.platform();
  const arch = os.arch();

  // Map platform and architecture to GitHub release name conventions
  let platformName = platform;
  let archName = arch;

  if (platform === "darwin") platformName = "macos";
  if (arch === "x64") archName = "x86_64";
  if (arch === "arm64" && platform === "darwin") archName = "arm64";

  return {
    platform: platformName,
    arch: archName,
    extension: platform === "win32" ? ".exe" : "",
  };
}

// Download whisper binary based on platform
async function downloadWhisperBinary() {
  // GitHub repository details
  const repo = "ggerganov/whisper.cpp";
  const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;

  console.log("Downloading Whisper binary...");

  try {
    // Get info about latest release
    const releaseInfo = await new Promise((resolve, reject) => {
      const options = {
        headers: {
          "User-Agent": "node.js",
        },
      };

      https
        .get(apiUrl, options, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`API request failed with status code: ${res.statusCode}`));
            return;
          }

          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(JSON.parse(data)));
        })
        .on("error", reject);
    });

    // Get platform-specific details
    const { platform, arch, extension } = getPlatformDetails();

    // Find the appropriate asset from the release
    const assetPattern = new RegExp(`whisper.*${platform}.*${arch}`);
    const asset = releaseInfo.assets.find((asset) => assetPattern.test(asset.name));

    if (!asset) {
      console.warn(`No pre-built binary found for ${platform} ${arch}, will need to build from source`);
      await downloadWhisperSource();
      return;
    }

    // Download the binary
    const binaryPath = path.join(whisperDir, `main${extension}`);

    await new Promise((resolve, reject) => {
      https
        .get(asset.browser_download_url, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed with status code: ${res.statusCode}`));
            return;
          }

          const fileStream = fs.createWriteStream(binaryPath);
          res.pipe(fileStream);

          fileStream.on("finish", () => {
            fileStream.close();

            // Make binary executable on Unix systems
            if (platform !== "win32") {
              fs.chmodSync(binaryPath, 0o755);
            }

            console.log(`Downloaded Whisper binary to ${binaryPath}`);
            resolve();
          });
        })
        .on("error", reject);
    });

    // Download a model as well
    await downloadModel();
  } catch (error) {
    console.error("Error downloading Whisper binary:", error);
    console.log("Falling back to source code download...");
    await downloadWhisperSource();
  }
}

// Download whisper source code as fallback
async function downloadWhisperSource() {
  console.log("Downloading Whisper source code...");

  try {
    // Check if whisper directory already exists
    if (fs.existsSync(whisperDir)) {
      console.log("Whisper.cpp directory already exists - checking if it contains valid source code");

      // Check if it contains CMakeLists.txt which would indicate it's a valid source directory
      if (fs.existsSync(path.join(whisperDir, "CMakeLists.txt"))) {
        console.log("Found existing Whisper.cpp source code - using it instead of downloading again");

        // Try to update the existing repo
        try {
          console.log("Updating existing repository...");
          execSync(`cd "${whisperDir}" && git pull`, { stdio: "inherit" });
          console.log("Repository updated successfully");
        } catch (pullError) {
          // If git pull fails, it's not critical, we can still use the existing code
          console.log("Could not update repository, but will use existing code:", pullError.message);
        }
      } else {
        // Directory exists but doesn't seem to contain whisper source code
        console.warn("Existing directory doesn't appear to contain Whisper.cpp source code");
        console.warn("Please delete or rename the directory and try again");
        console.warn(`Directory path: ${whisperDir}`);
      }
    } else {
      // Clone the whisper.cpp repository since directory doesn't exist
      console.log(`Cloning whisper.cpp repository to ${whisperDir}`);

      // First, check if we're inside a git repository
      try {
        execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });

        // If we are, we need to handle things differently to avoid embedding a git repo inside another
        console.log("Detected we're inside a git repository");
        console.log("Using git archive to download without git metadata");

        // Create temp directory to clone into first
        const tempCloneDir = path.join(os.tmpdir(), `whisper-clone-${Date.now()}`);
        fs.mkdirSync(tempCloneDir, { recursive: true });

        // Clone to temp directory first
        execSync(`git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "${tempCloneDir}"`, {
          stdio: "inherit",
        });

        // Remove the .git directory
        const gitDir = path.join(tempCloneDir, ".git");
        if (fs.existsSync(gitDir)) {
          if (os.platform() === "win32") {
            execSync(`rmdir /s /q "${gitDir}"`);
          } else {
            execSync(`rm -rf "${gitDir}"`);
          }
          console.log("Removed .git directory to prevent repository embedding");
        }

        // Create the target directory
        fs.mkdirSync(whisperDir, { recursive: true });

        // Copy all files except .git directory to the actual destination
        if (os.platform() === "win32") {
          execSync(`xcopy "${tempCloneDir}" "${whisperDir}" /E /I /H /Y`);
        } else {
          execSync(`cp -R "${tempCloneDir}/"* "${whisperDir}/"`);
        }

        // Clean up temp directory
        try {
          fs.rmSync(tempCloneDir, { recursive: true, force: true });
        } catch (cleanupErr) {
          console.warn("Could not clean up temporary directory:", cleanupErr.message);
        }
      } catch (gitCheckError) {
        // If we're not in a git repo, we can just clone directly
        execSync(`git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "${whisperDir}"`, {
          stdio: "inherit",
        });
      }

      console.log("Downloaded Whisper source code");
    }

    // Check if source code was successfully obtained
    if (fs.existsSync(path.join(whisperDir, "CMakeLists.txt"))) {
      // Now try to build the source code
      console.log("Building Whisper from source...");

      // Create build directory
      const buildDir = path.join(whisperDir, "build");
      if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, { recursive: true });
      }

      // Configure with CMake
      console.log("Configuring CMake...");
      try {
        execSync(`cd "${buildDir}" && cmake "${whisperDir}" -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DBUILD_SHARED_LIBS=OFF`, {
          stdio: "inherit",
          env: { ...process.env, CFLAGS: "-pthread" },
        });

        // Build the project
        console.log("Building project...");
        execSync(`cd "${buildDir}" && make -j${os.cpus().length}`, {
          stdio: "inherit",
        });

        // Check for the binary in multiple locations - update this part
        const foundBinary = findWhisperBinary(buildDir);

        if (foundBinary) {
          const targetPath = path.join(whisperDir, foundBinary.name);
          console.log(`Copying binary from ${foundBinary.path} to ${targetPath}`);
          fs.copyFileSync(foundBinary.path, targetPath);

          // If we found the legacy binary but not the new one, create a copy with the new name
          if (foundBinary.name === (os.platform() === "win32" ? "whisper.exe" : "main")) {
            const newNamePath = path.join(whisperDir, os.platform() === "win32" ? "whisper-cli.exe" : "whisper-cli");
            console.log(`Creating a copy with the new name: ${newNamePath}`);
            fs.copyFileSync(foundBinary.path, newNamePath);

            if (os.platform() !== "win32") {
              fs.chmodSync(newNamePath, 0o755);
            }
          }

          if (os.platform() !== "win32") {
            fs.chmodSync(targetPath, 0o755);
          }

          console.log(`Binary successfully copied to ${targetPath}`);

          // Create a launcher script
          try {
            const scriptPath = path.join(__dirname, "create-launcher.js");
            if (fs.existsSync(scriptPath)) {
              console.log("Creating launcher script...");
              execSync(`node "${scriptPath}"`, { stdio: "inherit" });
            } else {
              console.warn("Could not find create-launcher.js script");
            }
          } catch (launcherError) {
            console.warn("Failed to create launcher script:", launcherError.message);
          }
        }

        // Deep search if binary not found in common locations
        if (!found) {
          console.log("Performing deeper search for the binary...");

          function findBinaryInDir(dir, binName) {
            if (!fs.existsSync(dir)) return null;

            try {
              const items = fs.readdirSync(dir);

              for (const item of items) {
                const itemPath = path.join(dir, item);

                try {
                  const stats = fs.statSync(itemPath);

                  if (stats.isDirectory()) {
                    const foundPath = findBinaryInDir(itemPath, binName);
                    if (foundPath) return foundPath;
                  } else if (item === binName) {
                    return itemPath;
                  }
                } catch (statErr) {
                  console.warn(`Error checking ${itemPath}:`, statErr.message);
                }
              }
            } catch (readErr) {
              console.warn(`Error reading directory ${dir}:`, readErr.message);
            }

            return null;
          }

          const foundBinary = findBinaryInDir(buildDir, binaryName);

          if (foundBinary) {
            console.log(`Found binary through deeper search at: ${foundBinary}`);

            // Copy binary to the main whisper dir
            const mainBinary = path.join(whisperDir, binaryName);
            fs.copyFileSync(foundBinary, mainBinary);

            if (os.platform() !== "win32") {
              fs.chmodSync(mainBinary, 0o755);
            }

            console.log(`Binary successfully copied to ${mainBinary}`);
          } else {
            console.error("Could not find the binary even after deeper search");
          }
        }
      } catch (buildError) {
        console.error("Build failed:", buildError);
        console.error("Please make sure you have the necessary build tools installed (cmake, make, compiler)");
      }
    }

    // Download a model
    await downloadModel();
  } catch (error) {
    console.error("Error handling Whisper source:", error);
    console.log(`If the error persists, you may need to delete the directory at ${whisperDir}`);
    console.log("and try again, or build Whisper from source manually.");
  }
}

// Find any available whisper binary in the build directory
function findWhisperBinary(buildDir) {
  // Updated binary names according to whisper.cpp Dec 20, 2024 changes
  // main is now whisper-cli, server is whisper-server, etc.
  const binaryNames = [
    os.platform() === "win32" ? "whisper-cli.exe" : "whisper-cli", // New name (preferred)
    os.platform() === "win32" ? "whisper.exe" : "main", // Legacy name
  ];

  // Look in common locations
  const locations = [buildDir, whisperDir, path.join(buildDir, "Release"), path.join(buildDir, "bin"), path.join(buildDir, "examples", "cli"), path.join(buildDir, "examples", "main"), path.join(buildDir, "examples", "whisper-cli")];

  // Try all combinations
  let foundBinary = null;
  let isLegacy = false;

  // Try new name first (preferred)
  for (const name of binaryNames) {
    if (foundBinary) break;

    for (const location of locations) {
      const binaryPath = path.join(location, name);
      if (fs.existsSync(binaryPath)) {
        console.log(`Found binary: ${binaryPath}`);
        foundBinary = {
          path: binaryPath,
          name: name,
        };
        isLegacy = name === binaryNames[1]; // Check if it's the legacy name
        break;
      }
    }
  }

  if (foundBinary && isLegacy) {
    console.log("⚠️ WARNING: Found legacy binary name. The binary 'main' is now called 'whisper-cli'.");
    console.log("Consider renaming your binary to match the new convention.");
  }

  return foundBinary;
}

// Helper function to follow redirects
function downloadWithRedirects(url, filePath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    let redirectCount = 0;

    function makeRequest(currentUrl) {
      console.log(`Downloading from: ${currentUrl}`);

      // Parse URL to determine whether to use http or https
      const parsedUrl = new URL(currentUrl);
      const requestLib = parsedUrl.protocol === "https:" ? https : http;

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

            console.log(`Following redirect to: ${nextUrl}`);
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
            console.log(`Downloaded to ${filePath}`);
            resolve();
          });

          fileStream.on("error", (err) => {
            // Clean up the file if there was an error
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

// Download a Whisper model
async function downloadModel() {
  const modelName = "ggml-base.en.bin";
  const modelPath = path.join(modelsDir, modelName);

  // Skip if model already exists
  if (fs.existsSync(modelPath)) {
    console.log(`Model ${modelName} already exists at ${modelPath}`);
    return;
  }

  console.log(`Downloading model ${modelName}...`);

  try {
    // Try direct download from Hugging Face
    const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`;

    // Use our new function that follows redirects
    await downloadWithRedirects(modelUrl, modelPath);
    console.log(`Successfully downloaded model to ${modelPath}`);
  } catch (error) {
    console.error("Error with direct download:", error);
    console.log("Trying alternative download method...");

    try {
      // Alternative method using the script in the whisper repo
      if (fs.existsSync(whisperDir)) {
        const pythonCmd = os.platform() === "win32" ? "python" : "python3";

        // Check if the download script exists first
        const downloadScriptPath = path.join(whisperDir, "models", "download-ggml-model.py");
        if (!fs.existsSync(downloadScriptPath)) {
          throw new Error(`Download script not found at ${downloadScriptPath}`);
        }

        console.log("Found download script, executing it...");
        const downloadCmd = `cd "${whisperDir}" && ${pythonCmd} models/download-ggml-model.py base.en`;

        console.log("Executing download script from whisper.cpp repository...");
        execSync(downloadCmd, { stdio: "inherit" });

        // Check if download succeeded
        const downloadedModel = path.join(whisperDir, "models", modelName);
        if (fs.existsSync(downloadedModel)) {
          // Copy the model to our models directory
          console.log(`Copying model from ${downloadedModel} to ${modelPath}`);
          fs.copyFileSync(downloadedModel, modelPath);
          return;
        }
      } else {
        throw new Error(`Whisper directory not found at ${whisperDir}`);
      }
    } catch (secondError) {
      console.error("Error with alternative download:", secondError);

      // Final fallback: direct manual steps
      console.log("\n=== MANUAL DOWNLOAD INSTRUCTIONS ===");
      console.log(`Download the model manually from: https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`);
      console.log(`and place it in: ${modelPath}`);

      // Create the models directory if it doesn't exist
      if (!fs.existsSync(modelsDir)) {
        fs.mkdirSync(modelsDir, { recursive: true });
      }
    }
  }
}

// Run the download
downloadWhisperBinary().catch((error) => {
  console.error("Download script failed:", error);
  process.exit(1);
});
