const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");

// Configure paths
const appRoot = path.join(__dirname, "..");
const vendorDir = path.join(appRoot, "vendor");
const whisperDir = path.join(vendorDir, "whisper.cpp");
const modelsDir = path.join(vendorDir, "models");
const modelPath = path.join(modelsDir, "ggml-base.en.bin");

console.log("=== Whisper Transcription Test ===");
console.log(`Model path: ${modelPath}`);

// Check if paths exist
if (!fs.existsSync(modelPath)) {
  console.error(`ERROR: Model not found at: ${modelPath}`);
  process.exit(1);
}

// Create a temporary directory for the test
const tempDir = path.join(os.tmpdir(), "whisper-test");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Create a simple audio file for testing
const testAudioPath = path.join(tempDir, "test-audio.wav");

try {
  console.log(`Creating test audio file at: ${testAudioPath}`);

  // Check if ffmpeg is available
  try {
    execSync("ffmpeg -version");
    console.log("ffmpeg is installed.");
  } catch (err) {
    console.error("ffmpeg is not available in PATH. Using Node.js to create a simple WAV file.");

    // Create a very simple WAV file
    const header = Buffer.from([
      0x52,
      0x49,
      0x46,
      0x46, // "RIFF"
      0x24,
      0x00,
      0x00,
      0x00, // chunk size
      0x57,
      0x41,
      0x56,
      0x45, // "WAVE"
      0x66,
      0x6d,
      0x74,
      0x20, // "fmt "
      0x10,
      0x00,
      0x00,
      0x00, // subchunk size
      0x01,
      0x00, // PCM
      0x01,
      0x00, // mono
      0x80,
      0x3e,
      0x00,
      0x00, // sample rate (16000)
      0x00,
      0x7d,
      0x00,
      0x00, // byte rate
      0x02,
      0x00, // block align
      0x10,
      0x00, // bits per sample
      0x64,
      0x61,
      0x74,
      0x61, // "data"
      0x00,
      0x00,
      0x00,
      0x00, // data size
    ]);

    // Add 1 second of silence (16000 samples * 2 bytes)
    const dataSizeBytes = 32000;
    const silence = Buffer.alloc(dataSizeBytes);

    // Update chunk sizes
    const fileSize = header.length + dataSizeBytes - 8;
    header.writeUInt32LE(fileSize, 4);
    header.writeUInt32LE(dataSizeBytes, 40);

    // Write the file
    const fd = fs.openSync(testAudioPath, "w");
    fs.writeSync(fd, header);
    fs.writeSync(fd, silence);
    fs.closeSync(fd);
  }

  if (!fs.existsSync(testAudioPath)) {
    // If all else fails, use a different approach
    console.log("Using alternative method to create test audio");
    try {
      const ffmpegPath = require("ffmpeg-static");
      execSync(`"${ffmpegPath}" -f lavfi -i sine=frequency=440:duration=1 -ar 16000 -ac 1 "${testAudioPath}"`);
    } catch (ffmpegError) {
      console.error("Failed to create test audio:", ffmpegError.message);
      process.exit(1);
    }
  }

  console.log("Test audio file created successfully");

  // Find the appropriate binary to use
  function findBinary(dir) {
    // Updated binary names according to Dec 20, 2024 changes
    // main is now whisper-cli, server is whisper-server, etc.
    const binaryNames = [
      { name: os.platform() === "win32" ? "whisper-cli.exe" : "whisper-cli", isNew: true },
      { name: os.platform() === "win32" ? "whisper.exe" : "main", isNew: false },
    ];

    // First check for direct existence
    for (const { name, isNew } of binaryNames) {
      const binaryPath = path.join(dir, name);
      if (fs.existsSync(binaryPath)) {
        if (isNew) {
          console.log(`Found current binary: ${binaryPath}`);
        } else {
          console.log(`Found legacy binary: ${binaryPath}`);
          console.log("⚠️ NOTE: The 'main' binary is now deprecated and renamed to 'whisper-cli'");
        }
        return binaryPath;
      }
    }

    // Use launcher script if it exists
    const launcherPath = path.join(dir, os.platform() === "win32" ? "run-whisper.bat" : "run-whisper.sh");
    if (fs.existsSync(launcherPath)) {
      console.log(`Found launcher script: ${launcherPath}`);
      return launcherPath;
    }

    // If nothing found, default to the newer binary name
    return path.join(dir, os.platform() === "win32" ? "whisper-cli.exe" : "whisper-cli");
  }

  // Get the actual binary to use
  const binaryPath = findBinary(whisperDir);

  // Ensure the binary is executable - MOVED AFTER binaryPath is defined
  if (os.platform() !== "win32" && fs.existsSync(binaryPath) && !binaryPath.endsWith(".sh")) {
    try {
      fs.chmodSync(binaryPath, 0o755);
      console.log(`Made binary executable: ${binaryPath}`);
    } catch (err) {
      console.warn(`Could not set executable permission: ${err.message}`);
    }
  }

  const isLauncherScript = binaryPath.endsWith(".sh") || binaryPath.endsWith(".bat");

  // Try multiple methods to transcribe - update this part
  const methods = [
    {
      name: "Using launcher script with explicit output file",
      condition: isLauncherScript,
      command:
        os.platform() === "win32"
          ? `cd "${whisperDir}" && .\\${path.basename(binaryPath)} -m "${modelPath}" -f "${testAudioPath}" -of "${path.join(tempDir, "test-output")}" -otxt`
          : `cd "${whisperDir}" && ./${path.basename(binaryPath)} -m "${modelPath}" -f "${testAudioPath}" -of "${path.join(tempDir, "test-output")}" -otxt`,
    },
    {
      name: "Direct binary execution with explicit output file",
      condition: !isLauncherScript,
      command: `"${binaryPath}" -m "${modelPath}" -f "${testAudioPath}" -of "${path.join(tempDir, "test-output")}" -otxt`,
    },
    {
      name: "Change directory and execute with explicit output",
      condition: !isLauncherScript,
      command: `cd "${whisperDir}" && ./${path.basename(binaryPath)} -m "${modelPath}" -f "${testAudioPath}" -of "${path.join(tempDir, "test-output")}" -otxt`,
    },
    {
      name: "Environment variables adjustment",
      condition: true,
      command: `cd "${whisperDir}" && bash -c 'export DYLD_LIBRARY_PATH="${whisperDir}:$DYLD_LIBRARY_PATH" && ${isLauncherScript ? `./${path.basename(binaryPath)}` : binaryPath} -m "${modelPath}" -f "${testAudioPath}" -of "${path.join(
        tempDir,
        "test-output"
      )}" -otxt'`,
    },
  ];

  // Only try methods that meet their condition
  let success = false;
  for (const method of methods) {
    if (!method.condition) continue;

    try {
      console.log(`\nTrying method: ${method.name}`);
      console.log(`Command: ${method.command}`);

      const result = execSync(method.command, {
        encoding: "utf8",
        shell: true,
        env: {
          ...process.env,
          PATH: `${whisperDir}:${process.env.PATH}`,
          LD_LIBRARY_PATH: `${whisperDir}:${process.env.LD_LIBRARY_PATH || ""}`,
          DYLD_LIBRARY_PATH: os.platform() === "darwin" ? `${whisperDir}:${process.env.DYLD_LIBRARY_PATH || ""}` : undefined,
        },
        timeout: 30000, // 30 second timeout
      });

      console.log("Command output:");
      console.log(result);

      success = true;

      // Check for output file - updated to use both explicit and default output paths
      const outputPaths = [path.join(tempDir, "test-output.txt"), path.join(tempDir, `${path.basename(testAudioPath)}.txt`)];

      let outputContent = null;
      let foundPath = null;

      for (const checkPath of outputPaths) {
        if (fs.existsSync(checkPath)) {
          console.log(`Found output file at: ${checkPath}`);
          outputContent = fs.readFileSync(checkPath, "utf8");
          foundPath = checkPath;
          break;
        }
      }

      if (outputContent) {
        console.log("\nTranscription result:");
        console.log(outputContent);

        console.log("\n✅ SUCCESS! Use this method in your application:");
        console.log(method.command);
        success = true;
        break;
      } else {
        console.log("Command executed successfully but output file not found");
        console.log("Files in temp directory:");
        try {
          console.log(fs.readdirSync(tempDir));
        } catch (e) {
          console.error("Error listing temp directory:", e);
        }
      }
    } catch (error) {
      console.error(`Method failed: ${error.message}`);
      // Continue to the next method
    }
  }

  if (!success) {
    console.error("\n❌ All transcription methods failed");
    // Check if the model might be corrupted
    console.log("\nChecking model file integrity...");
    const modelSize = fs.statSync(modelPath).size;
    console.log(`Model size: ${modelSize} bytes`);
    if (modelSize < 1000000) {
      // Less than 1MB
      console.error("Model file appears to be too small and may be corrupted");
    }

    // Try downloading the model again as a last resort
    console.log("\nTrying to redownload the model...");
    const downloadScriptPath = path.join(__dirname, "download-whisper-binary.js");
    if (fs.existsSync(downloadScriptPath)) {
      try {
        console.log("Running download script...");
        execSync(`node "${downloadScriptPath}"`, { stdio: "inherit" });
        console.log("Model redownloaded. Please try transcription again.");
      } catch (downloadErr) {
        console.error("Failed to redownload model:", downloadErr.message);
      }
    }
  }

  // Clean up
  try {
    fs.unlinkSync(testAudioPath);
    console.log("Test completed and test file cleaned up");
  } catch (err) {
    console.warn("Could not clean up test file:", err.message);
  }
} catch (error) {
  console.error("Test transcription failed:", error);
  process.exit(1);
}
