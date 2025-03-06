const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");

// Configure paths
const vendorDir = path.join(__dirname, "..", "vendor");
const whisperDir = path.join(vendorDir, "whisper.cpp");
const launcherPath = path.join(whisperDir, "run-whisper.sh");

console.log("Creating Whisper launcher script...");

// Determine the correct binary name to use
function getBinaryName() {
  // Updated binary names according to Dec 20, 2024 changes
  // main is now whisper-cli, server is whisper-server, etc.
  const newBinaryName = os.platform() === "win32" ? "whisper-cli.exe" : "whisper-cli";
  const legacyBinaryName = os.platform() === "win32" ? "whisper.exe" : "main";

  const newBinaryPath = path.join(whisperDir, newBinaryName);
  const legacyBinaryPath = path.join(whisperDir, legacyBinaryName);

  // Return the appropriate name based on availability
  if (fs.existsSync(newBinaryPath)) {
    console.log(`Found new binary name: ${newBinaryName}`);
    return newBinaryName;
  } else if (fs.existsSync(legacyBinaryPath)) {
    console.log(`Found legacy binary name: ${legacyBinaryName}`);
    console.log(`⚠️ WARNING: Legacy binary names will be deprecated. Please update to ${newBinaryName}.`);
    return legacyBinaryName;
  }

  // Default to the newer name if we can't determine
  console.log(`Could not find existing binary, assuming new name: ${newBinaryName}`);
  return newBinaryName;
}

// Get the appropriate binary name
const actualBinaryName = getBinaryName();

// Create the launcher script for macOS
const createMacOSLauncher = () => {
  const scriptContent = `#!/bin/bash
# Launcher script for whisper.cpp on macOS
# This helps with library path issues

# Get the directory where this script is located
DIR="$(cd "$(dirname "$0")" && pwd)"

# Set environment variables for dynamic libraries
export DYLD_LIBRARY_PATH="$DIR:$DYLD_LIBRARY_PATH"
export LD_LIBRARY_PATH="$DIR:$LD_LIBRARY_PATH"

# Ensure binary has executable permissions
chmod +x "$DIR/${actualBinaryName}"

# Run the whisper binary with all arguments passed to this script
"$DIR/${actualBinaryName}" "$@"
`;

  fs.writeFileSync(launcherPath, scriptContent);
  fs.chmodSync(launcherPath, 0o755); // Make executable
  console.log(`Created launcher script at: ${launcherPath}`);
};

// Create the launcher script for Linux (similar to macOS)
const createLinuxLauncher = () => {
  const scriptContent = `#!/bin/bash
# Launcher script for whisper.cpp on Linux
# This helps with library path issues

# Get the directory where this script is located
DIR="$(cd "$(dirname "$0")" && pwd)"

# Set environment variables for dynamic libraries
export LD_LIBRARY_PATH="$DIR:$LD_LIBRARY_PATH"

# Ensure binary has executable permissions
chmod +x "$DIR/${actualBinaryName}"

# Run the whisper binary with all arguments passed to this script
"$DIR/${actualBinaryName}" "$@"
`;

  fs.writeFileSync(launcherPath, scriptContent);
  fs.chmodSync(launcherPath, 0o755); // Make executable
  console.log(`Created launcher script at: ${launcherPath}`);
};

// Create the launcher script for Windows
const createWindowsLauncher = () => {
  const batchPath = path.join(whisperDir, "run-whisper.bat");
  const scriptContent = `@echo off
:: Launcher script for whisper.cpp on Windows

:: Get the directory where this script is located
set DIR=%~dp0

:: Run the whisper binary with all arguments passed to this script
"%DIR%${actualBinaryName}" %*
`;

  fs.writeFileSync(batchPath, scriptContent);
  console.log(`Created launcher script at: ${batchPath}`);
};

// Create directory if it doesn't exist
if (!fs.existsSync(whisperDir)) {
  fs.mkdirSync(whisperDir, { recursive: true });
}

// Create platform-specific launcher
const platform = os.platform();
if (platform === "darwin") {
  createMacOSLauncher();
} else if (platform === "linux") {
  createLinuxLauncher();
} else if (platform === "win32") {
  createWindowsLauncher();
} else {
  console.error(`Unsupported platform: ${platform}`);
  process.exit(1);
}

// Testing with better error handling
console.log("Testing launcher script...");

try {
  if (platform === "win32") {
    execSync(`cd "${whisperDir}" && .\\run-whisper.bat --version`, { stdio: "inherit" });
  } else {
    execSync(`cd "${whisperDir}" && ./run-whisper.sh --version`, { stdio: "inherit" });
  }
  console.log("✅ Launcher script tested successfully!");
} catch (error) {
  console.error("❌ Launcher script test failed:", error.message);
  console.log("The script was created successfully but there might be issues with the binary.");
  console.log("The script will still be available for the application to use.");
}

console.log("Done");
