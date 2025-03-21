#!/usr/bin/env node

/**
 * Comprehensive auto-setup script for the Audio-to-Text Transcription App
 * - Checks prerequisites and installs/fixes them where possible
 * - Downloads whisper binary if not building from source
 * - Sets up CMake configuration and fixes common issues
 * - Builds Whisper.cpp with OpenMP support if possible
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const platform = process.platform;
const isMac = platform === "darwin";
const isWindows = platform === "win32";
const isLinux = platform === "linux";

// Root directories
const rootDir = path.resolve(__dirname, "..");
const vendorDir = path.join(rootDir, "vendor");
const whisperSrcDir = path.join(vendorDir, "whisper.cpp");
const buildDir = path.join(vendorDir, "whisper-build");

// Enable verbose mode with command line flag
const verboseMode = process.argv.includes("--verbose");
// Set build mode: 'binary' or 'source'
const buildFromSource = process.argv.includes("--build-from-source");

console.log(`${colors.bright}${colors.blue}┌───────────────────────────────────────────┐${colors.reset}`);
console.log(`${colors.bright}${colors.blue}│  Audio-to-Text Transcription App Setup    │${colors.reset}`);
console.log(`${colors.bright}${colors.blue}└───────────────────────────────────────────┘${colors.reset}\n`);

// Make sure vendor directory exists
if (!fs.existsSync(vendorDir)) {
  fs.mkdirSync(vendorDir, { recursive: true });
}

// Function to run commands with proper error handling
function runCommand(command, cwd = null, silent = false) {
  try {
    if (!silent && verboseMode) {
      console.log(`${colors.yellow}Running: ${command}${colors.reset}`);
    }

    if (silent) {
      return execSync(command, {
        cwd: cwd || process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      });
    } else {
      return execSync(command, {
        cwd: cwd || process.cwd(),
        stdio: verboseMode ? "inherit" : ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      });
    }
  } catch (error) {
    if (verboseMode) {
      console.error(`${colors.red}Command failed: ${command}${colors.reset}`);
      if (error.stdout) console.error(`${colors.yellow}stdout: ${error.stdout}${colors.reset}`);
      if (error.stderr) console.error(`${colors.yellow}stderr: ${error.stderr}${colors.reset}`);
    }
    throw error;
  }
}

// Function to run a specific npm script
function runNpmScript(scriptName) {
  return new Promise((resolve, reject) => {
    console.log(`${colors.yellow}Running npm script: ${scriptName}${colors.reset}`);

    const npm = isWindows ? "npm.cmd" : "npm";
    const child = spawn(npm, ["run", scriptName], {
      stdio: verboseMode ? "inherit" : "pipe",
      shell: true,
      cwd: rootDir,
    });

    let stdout = "";
    let stderr = "";

    if (!verboseMode && child.stdout) {
      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }

    if (!verboseMode && child.stderr) {
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, stdout, stderr });
      } else {
        reject({ success: false, code, stdout, stderr });
      }
    });

    child.on("error", (err) => {
      reject({ success: false, error: err, stdout, stderr });
    });
  });
}

// STEP 1: Check prerequisites
async function checkPrerequisites() {
  console.log(`${colors.bright}${colors.magenta}STEP 1: Checking prerequisites...${colors.reset}`);

  try {
    // Run the prerequisites check with auto-fix enabled
    await runNpmScript("check-prereqs");
    console.log(`${colors.green}✓ All prerequisites are satisfied${colors.reset}`);
    return true;
  } catch (error) {
    // If check-prereqs failed, try with autofix
    console.log(`${colors.yellow}⚠ Some prerequisites are missing. Attempting to fix automatically...${colors.reset}`);

    try {
      await runCommand("node scripts/check-prerequisites.js --autofix", rootDir, false);
      console.log(`${colors.green}✓ Fixed prerequisites automatically${colors.reset}`);
      return true;
    } catch (fixError) {
      console.error(`${colors.red}✗ Failed to fix prerequisites automatically.${colors.reset}`);
      console.log(`${colors.yellow}Please install missing prerequisites manually and try again.${colors.reset}`);
      if (verboseMode) {
        console.error(`Error details: ${fixError.error || fixError.stderr || fixError}`);
      }
      return false;
    }
  }
}

// Add the progress bar import
const ProgressBar = require("./utils/progress-bar");

// STEP 2: Setup Whisper.cpp (either download binary or prepare for source build)
async function setupWhisperCpp() {
  console.log(`${colors.bright}${colors.magenta}STEP 2: Setting up Whisper.cpp...${colors.reset}`);

  if (buildFromSource) {
    console.log(`${colors.cyan}Building Whisper.cpp from source${colors.reset}`);

    // Check if whisper source exists, if not, clone it
    if (!fs.existsSync(whisperSrcDir)) {
      console.log(`${colors.yellow}Cloning Whisper.cpp repository...${colors.reset}`);

      // Create a spinner progress display for cloning
      const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let i = 0;
      const spinnerInterval = setInterval(() => {
        if (!process.stdout.isTTY) return;
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(`${colors.cyan}${spinner[i]} Cloning repository...${colors.reset}`);
        i = (i + 1) % spinner.length;
      }, 100);

      try {
        runCommand(`git clone https://github.com/ggerganov/whisper.cpp.git "${whisperSrcDir}"`, null, false);
        clearInterval(spinnerInterval);
        if (process.stdout.isTTY) {
          process.stdout.clearLine();
          process.stdout.cursorTo(0);
        }
        console.log(`${colors.green}✓ Successfully cloned Whisper.cpp repository${colors.reset}`);

        console.log(`${colors.yellow}Initializing submodules...${colors.reset}`);
        runCommand("git submodule update --init --recursive", whisperSrcDir, false);
      } catch (error) {
        clearInterval(spinnerInterval);
        if (process.stdout.isTTY) {
          process.stdout.clearLine();
          process.stdout.cursorTo(0);
        }
        console.error(`${colors.red}✗ Failed to clone Whisper.cpp repository${colors.reset}`);
        if (verboseMode) {
          console.error(`Error details: ${error.message || error}`);
        }
        return false;
      }
    } else {
      console.log(`${colors.green}✓ Found existing Whisper.cpp source at: ${whisperSrcDir}${colors.reset}`);
    }

    return true;
  } else {
    console.log(`${colors.cyan}Setting up Whisper binary${colors.reset}`);

    try {
      await runNpmScript("check-binary");
      console.log(`${colors.green}✓ Whisper binary is ready${colors.reset}`);
      return true;
    } catch (error) {
      console.log(`${colors.yellow}⚠ Binary check failed. Will download or build as needed...${colors.reset}`);

      // Use the download script with progress indicator
      try {
        await runCommand("node scripts/download-whisper-binary.js --retry", rootDir, true);
        console.log(`${colors.green}✓ Whisper binary is now ready${colors.reset}`);
        return true;
      } catch (dlError) {
        console.error(`${colors.red}✗ Binary download failed: ${dlError.error || dlError.stderr || "Socket error"}${colors.reset}`);
        console.log(`${colors.yellow}Falling back to building from source${colors.reset}`);

        // Set buildFromSource to true for the remainder of the setup
        process.argv.push("--build-from-source");
        return await setupWhisperCpp();
      }
    }
  }
}

// STEP 3: Fix CMake configuration issues (if building from source)
async function fixCMakeConfig() {
  if (!buildFromSource) return true;

  console.log(`${colors.bright}${colors.magenta}STEP 3: Fixing CMake configuration...${colors.reset}`);

  try {
    await runNpmScript("fix-cmake");
    console.log(`${colors.green}✓ CMake configuration fixed${colors.reset}`);
    return true;
  } catch (error) {
    console.log(`${colors.yellow}⚠ Failed to automatically fix CMake configuration${colors.reset}`);
    console.log(`${colors.yellow}Trying manual fixes...${colors.reset}`);

    // Try direct fixes to CMakeLists.txt
    try {
      const cmakeListsPath = path.join(whisperSrcDir, "CMakeLists.txt");
      if (fs.existsSync(cmakeListsPath)) {
        // Backup the file
        const backupPath = `${cmakeListsPath}.bak`;
        fs.copyFileSync(cmakeListsPath, backupPath);

        // Read and modify content
        let content = fs.readFileSync(cmakeListsPath, "utf8");

        // Add or update cmake_minimum_required
        if (content.includes("cmake_minimum_required")) {
          content = content.replace(/cmake_minimum_required\s*\(\s*VERSION\s+[0-9.]+\s*\)/, "cmake_minimum_required(VERSION 3.10)");
        } else {
          content = "cmake_minimum_required(VERSION 3.10)\n\n" + content;
        }

        fs.writeFileSync(cmakeListsPath, content);
        console.log(`${colors.green}✓ Manually fixed CMake configuration${colors.reset}`);
        return true;
      } else {
        console.error(`${colors.red}✗ Could not find CMakeLists.txt${colors.reset}`);
        return false;
      }
    } catch (manualError) {
      console.error(`${colors.red}✗ Failed to manually fix CMake configuration${colors.reset}`);
      if (verboseMode) {
        console.error(`Error details: ${manualError.message || manualError}`);
      }
      return false;
    }
  }
}

// STEP 4: Set up OpenMP support (if building from source)
async function setupOpenMP() {
  if (!buildFromSource) return true;

  console.log(`${colors.bright}${colors.magenta}STEP 4: Setting up OpenMP support...${colors.reset}`);

  // Only need special setup for macOS
  if (isMac) {
    try {
      // Check if Homebrew's LLVM is installed
      const homebrewLlvmPath = runCommand("brew --prefix llvm 2>/dev/null", null, true).trim();

      if (homebrewLlvmPath && fs.existsSync(path.join(homebrewLlvmPath, "lib", "libomp.dylib"))) {
        console.log(`${colors.green}✓ OpenMP support is available via Homebrew LLVM${colors.reset}`);

        // Create environment setup script
        const envScriptPath = path.join(rootDir, "scripts", "setup-openmp-env.sh");
        const envContent = `#!/bin/bash
# Setup environment for OpenMP with Homebrew LLVM
export PATH="${homebrewLlvmPath}/bin:$PATH"
export LDFLAGS="-L${homebrewLlvmPath}/lib"
export CPPFLAGS="-I${homebrewLlvmPath}/include"
export CC="${homebrewLlvmPath}/bin/clang"
export CXX="${homebrewLlvmPath}/bin/clang++"
echo "OpenMP environment variables set for building Whisper.cpp"
`;
        fs.writeFileSync(envScriptPath, envContent);
        fs.chmodSync(envScriptPath, 0o755);

        // Set environment variables for the current process
        process.env.PATH = `${homebrewLlvmPath}/bin:${process.env.PATH}`;
        process.env.LDFLAGS = `-L${homebrewLlvmPath}/lib`;
        process.env.CPPFLAGS = `-I${homebrewLlvmPath}/include`;
        process.env.CC = `${homebrewLlvmPath}/bin/clang`;
        process.env.CXX = `${homebrewLlvmPath}/bin/clang++`;

        return true;
      } else {
        console.log(`${colors.yellow}⚠ Homebrew LLVM not found. Installing...${colors.reset}`);

        try {
          await runNpmScript("fix-openmp");
          console.log(`${colors.green}✓ Successfully set up OpenMP support${colors.reset}`);
          return true;
        } catch (error) {
          console.log(`${colors.yellow}⚠ Could not install OpenMP support automatically${colors.reset}`);
          console.log(`${colors.yellow}Will continue with limited performance. To enable OpenMP later, run:${colors.reset}`);
          console.log(`${colors.yellow}npm run fix-openmp${colors.reset}`);
          return true; // Continue anyway
        }
      }
    } catch (error) {
      console.log(`${colors.yellow}⚠ Could not detect OpenMP support${colors.reset}`);
      console.log(`${colors.yellow}Will continue with limited performance. To enable OpenMP later, run:${colors.reset}`);
      console.log(`${colors.yellow}npm run fix-openmp${colors.reset}`);
      return true; // Continue anyway
    }
  } else {
    console.log(`${colors.green}✓ OpenMP should be available by default on this platform${colors.reset}`);
    return true;
  }
}

// STEP 5: Build Whisper.cpp from source (if needed)
async function buildWhisperCpp() {
  if (!buildFromSource) return true;

  console.log(`${colors.bright}${colors.magenta}STEP 5: Building Whisper.cpp...${colors.reset}`);

  // Make sure build directory exists
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  // Determine OpenMP flags
  let openmpFlags = [];
  let openmpLibs = [];

  if (isMac) {
    try {
      const homebrewLlvmPath = runCommand("brew --prefix llvm 2>/dev/null", null, true).trim();

      if (homebrewLlvmPath && fs.existsSync(path.join(homebrewLlvmPath, "lib", "libomp.dylib"))) {
        openmpFlags = [`-I${homebrewLlvmPath}/include`, "-Xpreprocessor", "-fopenmp"];
        openmpLibs = [`-L${homebrewLlvmPath}/lib`, "-lomp"];
      }
    } catch (error) {
      // Ignore errors, proceed without OpenMP
    }
  } else if (isWindows) {
    openmpFlags = ["/openmp"];
  } else {
    openmpFlags = ["-fopenmp"];
    openmpLibs = ["-fopenmp"];
  }

  // Build with CMake
  try {
    console.log(`${colors.cyan}Configuring with CMake...${colors.reset}`);

    // Create a progress indicator for the configuration step
    const configProgress = ProgressBar.createDownloadBar();
    configProgress.start();

    let configOutput = "";
    let configInterval;
    const updateConfigProgress = () => {
      configProgress.increment(1, `Configuring...`);
    };
    configInterval = setInterval(updateConfigProgress, 300);

    // Prepare CMake command
    let cmakeCmd = ["cmake", "-B", `"${buildDir}"`, "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=ON"];

    // Add OpenMP flags if available
    if (openmpFlags.length > 0) {
      cmakeCmd.push(`-DCMAKE_C_FLAGS="${openmpFlags.join(" ")}"`);
      cmakeCmd.push(`-DCMAKE_CXX_FLAGS="${openmpFlags.join(" ")}"`);
    }

    // Add OpenMP libs if available
    if (openmpLibs.length > 0) {
      cmakeCmd.push(`-DCMAKE_EXE_LINKER_FLAGS="${openmpLibs.join(" ")}"`);
      cmakeCmd.push(`-DCMAKE_SHARED_LINKER_FLAGS="${openmpLibs.join(" ")}"`);
    }

    // Add source directory
    cmakeCmd.push(`"${whisperSrcDir}"`);

    // Run CMake
    try {
      runCommand(cmakeCmd.join(" "), null, false);
      clearInterval(configInterval);
      configProgress.update(100, "Configuration complete");
      configProgress.stop();
    } catch (error) {
      clearInterval(configInterval);
      configProgress.stop();
      throw error;
    }

    // Build the project with progress indicator
    console.log(`${colors.cyan}Building Whisper.cpp...${colors.reset}`);
    const buildProgress = ProgressBar.createDownloadBar();
    buildProgress.start();

    let buildInterval;
    const updateBuildProgress = () => {
      buildProgress.increment(1, `Compiling...`);
    };
    buildInterval = setInterval(updateBuildProgress, 300);

    try {
      runCommand(`cmake --build "${buildDir}" --config Release --parallel ${os.cpus().length}`, null, false);
      clearInterval(buildInterval);
      buildProgress.update(100, "Build complete");
      buildProgress.stop();
    } catch (error) {
      clearInterval(buildInterval);
      buildProgress.stop();
      throw error;
    }

    console.log(`${colors.green}✓ Successfully built Whisper.cpp${colors.reset}`);
    return true;
  } catch (error) {
    console.error(`${colors.red}✗ Failed to build Whisper.cpp${colors.reset}`);

    if (verboseMode) {
      console.error(`Error details: ${error.message || error}`);
    }

    console.log(`${colors.yellow}Trying alternative build approach...${colors.reset}`);

    try {
      await runNpmScript("build-whisper-openmp");
      console.log(`${colors.green}✓ Successfully built Whisper.cpp with alternative approach${colors.reset}`);
      return true;
    } catch (altError) {
      console.error(`${colors.red}✗ All build attempts failed${colors.reset}`);
      console.log(`${colors.yellow}Please try running:${colors.reset}`);
      console.log(`${colors.yellow}npm run fix-cmake${colors.reset}`);
      console.log(`${colors.yellow}npm run build-whisper${colors.reset}`);
      return false;
    }
  }
}

// Main setup function that orchestrates all steps
async function main() {
  try {
    // Create directories if they don't exist
    if (!fs.existsSync(vendorDir)) {
      fs.mkdirSync(vendorDir, { recursive: true });
    }

    // Step 1: Check prerequisites
    const prereqsOk = await checkPrerequisites();
    if (!prereqsOk) {
      console.error(`${colors.red}✗ Failed to meet prerequisites. Setup aborted.${colors.reset}`);
      return 1;
    }

    // Step 2: Setup Whisper.cpp
    const whisperSetupOk = await setupWhisperCpp();
    if (!whisperSetupOk) {
      console.error(`${colors.red}✗ Failed to set up Whisper.cpp. Setup aborted.${colors.reset}`);
      return 1;
    }

    // If building from source, continue with build steps
    if (buildFromSource) {
      // Step 3: Fix CMake configuration
      const cmakeFixOk = await fixCMakeConfig();
      if (!cmakeFixOk) {
        console.error(`${colors.red}✗ Failed to fix CMake configuration. Setup aborted.${colors.reset}`);
        return 1;
      }

      // Step 4: Setup OpenMP
      const openmpOk = await setupOpenMP();
      // Continue even if OpenMP setup fails (it's just for performance)

      // Step 5: Build Whisper.cpp
      const buildOk = await buildWhisperCpp();
      if (!buildOk) {
        console.error(`${colors.red}✗ Failed to build Whisper.cpp. Setup aborted.${colors.reset}`);
        return 1;
      }
    }

    console.log(`\n${colors.bright}${colors.green}┌───────────────────────────────────────────┐${colors.reset}`);
    console.log(`${colors.bright}${colors.green}│  Setup completed successfully! 🎉          │${colors.reset}`);
    console.log(`${colors.bright}${colors.green}└───────────────────────────────────────────┘${colors.reset}\n`);

    console.log(`${colors.cyan}You can now run the app with:${colors.reset}`);
    console.log(`${colors.yellow}npm start${colors.reset}\n`);

    return 0;
  } catch (error) {
    console.error(`${colors.red}Unexpected error during setup:${colors.reset}`, error);
    return 1;
  }
}

// Run the main function
main()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error(`${colors.red}Fatal error:${colors.reset}`, error);
    process.exit(1);
  });
