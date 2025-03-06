const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");

// Configure paths
const vendorDir = path.join(__dirname, "..", "vendor");
const whisperDir = path.join(vendorDir, "whisper.cpp");

// Updated binary names according to whisper.cpp Dec 20, 2024 changes
// main is now whisper-cli, server is whisper-server, etc.
const newBinaryName = os.platform() === "win32" ? "whisper-cli.exe" : "whisper-cli";
const legacyBinaryName = os.platform() === "win32" ? "whisper.exe" : "main";

// Try new name first, then legacy name as fallback
let binaryPath;
let usingLegacyName = false;

if (fs.existsSync(path.join(whisperDir, newBinaryName))) {
  binaryPath = path.join(whisperDir, newBinaryName);
  console.log(`Using current binary name: ${newBinaryName}`);
} else if (fs.existsSync(path.join(whisperDir, legacyBinaryName))) {
  binaryPath = path.join(whisperDir, legacyBinaryName);
  console.log(`Using legacy binary name: ${legacyBinaryName}`);
  console.log("⚠️ WARNING: This binary name is being deprecated. It should be renamed to 'whisper-cli'.");
  usingLegacyName = true;
} else {
  console.error("❌ No binary found. Searched for both new and legacy names.");
  console.error(`  - New name (preferred): ${path.join(whisperDir, newBinaryName)}`);
  console.error(`  - Legacy name: ${path.join(whisperDir, legacyBinaryName)}`);
  process.exit(1);
}

console.log(`Checking binary at: ${binaryPath}`);

// Check if binary exists
if (!fs.existsSync(binaryPath)) {
  console.error(`❌ Binary not found at: ${binaryPath}`);
  process.exit(1);
}

// Check file permissions
try {
  const stats = fs.statSync(binaryPath);
  const fileMode = stats.mode.toString(8);
  const isExecutable = (stats.mode & fs.constants.S_IXUSR) !== 0;

  console.log(`File size: ${stats.size} bytes`);
  console.log(`File mode: ${fileMode}`);
  console.log(`Is executable: ${isExecutable ? "Yes" : "No"}`);

  // Set executable permission if needed
  if (!isExecutable && os.platform() !== "win32") {
    console.log("Setting executable permission...");
    fs.chmodSync(binaryPath, 0o755);
    console.log("Permission set to 755");
  }
} catch (err) {
  console.error("Error checking file stats:", err);
}

// Check file type on macOS/Linux
if (os.platform() !== "win32") {
  try {
    const fileInfo = execSync(`file "${binaryPath}"`, { encoding: "utf8" });
    console.log(`File type: ${fileInfo.trim()}`);

    // Check if dynamic libraries are required
    if (os.platform() === "darwin") {
      console.log("Checking dynamic libraries (macOS):");
      const otoolOutput = execSync(`otool -L "${binaryPath}"`, { encoding: "utf8" });
      console.log(otoolOutput);
    } else if (os.platform() === "linux") {
      console.log("Checking dynamic libraries (Linux):");
      const lddOutput = execSync(`ldd "${binaryPath}"`, { encoding: "utf8" });
      console.log(lddOutput);
    }
  } catch (err) {
    console.log("Could not determine file info:", err.message);
  }
}

// Try running the binary
console.log("\nAttempting to run the binary...");

// Define all the different ways we'll try to execute the binary
const executionMethods = [
  {
    name: "Standard execution",
    command: `"${binaryPath}" --help`,
    options: { encoding: "utf8" },
  },
  {
    name: "Shell execution",
    command: `"${binaryPath}" --help`,
    options: { encoding: "utf8", shell: true },
  },
  {
    name: "With library path",
    command: `"${binaryPath}" --help`,
    options: { encoding: "utf8", env: { ...process.env, LD_LIBRARY_PATH: whisperDir } },
  },
  {
    name: "From binary directory",
    command: `./${binaryName} --help`,
    options: { encoding: "utf8", cwd: whisperDir },
  },
  {
    name: "Shell and binary directory",
    command: `./${binaryName} --help`,
    options: { encoding: "utf8", cwd: whisperDir, shell: true },
  },
];

// Try each execution method
let success = false;
for (const method of executionMethods) {
  console.log(`\nTrying ${method.name}:`);
  console.log(`Command: ${method.command}`);
  console.log(`Options: ${JSON.stringify(method.options)}`);

  try {
    const output = execSync(method.command, method.options);
    console.log("✅ Command executed successfully!");
    console.log("Output sample:");
    console.log(output.toString().split("\n").slice(0, 3).join("\n") + "...");
    success = true;

    // Record the successful method
    console.log("\n✅ SUCCESS! Use this method in your application:");
    console.log(`Command: ${method.command}`);
    console.log(`Options: ${JSON.stringify(method.options)}`);
    break;
  } catch (err) {
    console.error(`❌ Execution failed: ${err.message}`);

    // On macOS or Linux, check for dynamic library issues
    if (os.platform() !== "win32") {
      try {
        if (os.platform() === "darwin") {
          console.log("Checking dynamic library dependencies:");
          const dyldOutput = execSync(`DYLD_PRINT_LIBRARIES=1 "${binaryPath}" 2>&1 || true`, { encoding: "utf8", timeout: 1000 });
          console.log(dyldOutput);
        }
      } catch (debugErr) {
        // Ignore errors in the debug command itself
      }
    }
  }
}

// Additional check for macOS with CD command
if (!success && os.platform() === "darwin") {
  console.log("\nTrying with cd command:");
  try {
    const output = execSync(`cd "${whisperDir}" && ./main --help`, { encoding: "utf8" });
    console.log("✅ Command executed successfully!");
    console.log("Output sample:");
    console.log(output.split("\n").slice(0, 3).join("\n") + "...");
    success = true;

    console.log("\n✅ SUCCESS! Use this approach in your application:");
    console.log(`cd "${whisperDir}" && ./main [options]`);
  } catch (err) {
    console.error(`❌ Execution failed: ${err.message}`);
  }
}

if (success) {
  console.log("\n✅ Binary check completed successfully!");
  console.log("Implement the successful execution method in your application code.");
} else {
  console.log("\n⚠️ Binary is present but could not be executed directly.");
  console.log("\nTROUBLESHOOTING TIPS:");
  console.log("1. Make sure the binary is compiled for the correct architecture");
  console.log("2. Check if necessary libraries are available");
  console.log("3. Verify file permissions (chmod +x on Unix systems)");
  console.log("4. Try rebuilding whisper.cpp from source");
  console.log("\nDetailed error logs may be helpful for diagnosing the issue.");
}
