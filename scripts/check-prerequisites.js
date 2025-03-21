/**
 * Prerequisites checker for Electron Transcription App
 * Checks if the required tools and dependencies are installed
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

const platform = process.platform;
let missingDependencies = [];

console.log(`${colors.bright}${colors.blue}Checking prerequisites for Audio-to-Text Transcription App...${colors.reset}\n`);

// Helper function to execute commands safely
function checkCommand(command, errorMessage) {
  try {
    execSync(command, { stdio: "pipe" });
    return true;
  } catch (error) {
    return false;
  }
}

// Check Node.js version
function checkNodeVersion() {
  const nodeVersion = process.version;
  const versionMatch = nodeVersion.match(/^v(\d+)\./);
  const majorVersion = versionMatch ? parseInt(versionMatch[1]) : 0;

  if (majorVersion >= 14) {
    console.log(`${colors.green}✓ Node.js ${nodeVersion} (meets minimum requirement of v14.x)${colors.reset}`);
    return true;
  } else {
    console.log(`${colors.red}✗ Node.js ${nodeVersion} is installed, but v14.x or higher is required${colors.reset}`);
    missingDependencies.push({
      name: "Node.js 14.x+",
      installGuide: "Visit https://nodejs.org/ to download and install the LTS version",
    });
    return false;
  }
}

// Check npm version
function checkNpmVersion() {
  try {
    const npmVersionOutput = execSync("npm --version", { encoding: "utf8" }).trim();
    const versionParts = npmVersionOutput.split(".");
    const majorVersion = parseInt(versionParts[0]);

    if (majorVersion >= 6) {
      console.log(`${colors.green}✓ npm ${npmVersionOutput} (meets minimum requirement of 6.x)${colors.reset}`);
      return true;
    } else {
      console.log(`${colors.red}✗ npm ${npmVersionOutput} is installed, but 6.x or higher is required${colors.reset}`);
      missingDependencies.push({
        name: "npm 6.x+",
        installGuide: 'Run "npm install -g npm@latest" to update npm',
      });
      return false;
    }
  } catch (error) {
    console.log(`${colors.red}✗ Could not determine npm version${colors.reset}`);
    missingDependencies.push({
      name: "npm 6.x+",
      installGuide: "npm should be installed with Node.js. Try reinstalling Node.js from https://nodejs.org/",
    });
    return false;
  }
}

// Check Git
function checkGit() {
  if (checkCommand("git --version", "Git is not installed")) {
    console.log(`${colors.green}✓ Git is installed${colors.reset}`);
    return true;
  } else {
    console.log(`${colors.red}✗ Git is not installed${colors.reset}`);
    let installGuide = "";

    if (platform === "darwin") {
      installGuide = 'Install with Homebrew: "brew install git" or download from https://git-scm.com/download/mac';
    } else if (platform === "win32") {
      installGuide = "Download from https://git-scm.com/download/win";
    } else {
      installGuide = 'Install with your package manager, e.g., "sudo apt-get install git" or "sudo yum install git"';
    }

    missingDependencies.push({
      name: "Git",
      installGuide,
    });
    return false;
  }
}

// Check CMake
function checkCmake() {
  if (checkCommand("cmake --version", "CMake is not installed")) {
    console.log(`${colors.green}✓ CMake is installed${colors.reset}`);
    return true;
  } else {
    console.log(`${colors.red}✗ CMake is not installed${colors.reset}`);
    let installGuide = "";

    if (platform === "darwin") {
      installGuide = 'Install with Homebrew: "brew install cmake" or download from https://cmake.org/download/';
    } else if (platform === "win32") {
      installGuide = "Download from https://cmake.org/download/ and make sure to add it to PATH during installation";
    } else {
      installGuide = 'Install with your package manager, e.g., "sudo apt-get install cmake" or "sudo yum install cmake"';
    }

    missingDependencies.push({
      name: "CMake 3.10+",
      installGuide,
    });
    return false;
  }
}

// Check C++ compiler
function checkCppCompiler() {
  let compilerFound = false;

  if (platform === "darwin") {
    // Check for clang on macOS
    if (checkCommand("clang --version", "Clang is not installed")) {
      console.log(`${colors.green}✓ C++ compiler (Clang) is installed${colors.reset}`);
      compilerFound = true;
    } else if (checkCommand("xcode-select -p", "Xcode command line tools not found")) {
      console.log(`${colors.green}✓ Xcode command line tools are installed (includes C++ compiler)${colors.reset}`);
      compilerFound = true;
    } else {
      console.log(`${colors.red}✗ C++ compiler not found${colors.reset}`);
      missingDependencies.push({
        name: "C++ compiler (Clang)",
        installGuide: 'Install Xcode command line tools with: "xcode-select --install"',
      });
    }
  } else if (platform === "win32") {
    // On Windows, check for MSVC or MinGW
    if (checkCommand("cl", "MSVC compiler not found") || checkCommand("g++ --version", "MinGW compiler not found")) {
      console.log(`${colors.green}✓ C++ compiler is installed${colors.reset}`);
      compilerFound = true;
    } else {
      console.log(`${colors.red}✗ C++ compiler not found${colors.reset}`);
      missingDependencies.push({
        name: "C++ compiler (MSVC)",
        installGuide: "Install Visual Studio with C++ development tools from https://visualstudio.microsoft.com/downloads/",
      });
    }
  } else {
    // Linux, check for GCC
    if (checkCommand("g++ --version", "GCC compiler not found")) {
      console.log(`${colors.green}✓ C++ compiler (GCC) is installed${colors.reset}`);
      compilerFound = true;
    } else {
      console.log(`${colors.red}✗ C++ compiler not found${colors.reset}`);
      missingDependencies.push({
        name: "C++ compiler (GCC)",
        installGuide: 'Install with your package manager, e.g., "sudo apt-get install build-essential" or "sudo yum groupinstall \'Development Tools\'"',
      });
    }
  }

  return compilerFound;
}

// Check Python
function checkPython() {
  // Check for Python 3.6+ (try python3 first, then python as fallback)
  let pythonCmd = null;

  if (checkCommand("python3 --version", 'Python 3 not found with "python3" command')) {
    pythonCmd = "python3";
  } else if (checkCommand("python --version", 'Python not found with "python" command')) {
    // Check if this is Python 3
    try {
      const pythonVersion = execSync("python --version", { encoding: "utf8" }).trim();
      if (pythonVersion.startsWith("Python 3")) {
        pythonCmd = "python";
      }
    } catch (error) {
      // Skip error handling, we'll report python as missing below
    }
  }

  if (pythonCmd) {
    // Check the specific Python version
    try {
      const pythonVersion = execSync(`${pythonCmd} --version`, { encoding: "utf8" }).trim();
      const versionMatch = pythonVersion.match(/Python (\d+)\.(\d+)/);

      if (versionMatch) {
        const majorVersion = parseInt(versionMatch[1]);
        const minorVersion = parseInt(versionMatch[2]);

        if (majorVersion > 3 || (majorVersion === 3 && minorVersion >= 6)) {
          console.log(`${colors.green}✓ ${pythonVersion} (meets minimum requirement of 3.6+)${colors.reset}`);
          return true;
        } else {
          console.log(`${colors.red}✗ ${pythonVersion} found, but Python 3.6+ is required${colors.reset}`);
        }
      }
    } catch (error) {
      // Skip error handling, we'll report python as missing below
    }
  } else {
    console.log(`${colors.red}✗ Python 3.6+ not found${colors.reset}`);
  }

  // If we reach here, Python is missing or the version is too old
  let installGuide = "";

  if (platform === "darwin") {
    installGuide = 'Install with Homebrew: "brew install python3" or download from https://www.python.org/downloads/';
  } else if (platform === "win32") {
    installGuide = 'Download from https://www.python.org/downloads/ and make sure to check "Add Python to PATH" during installation';
  } else {
    installGuide = 'Install with your package manager, e.g., "sudo apt-get install python3" or "sudo yum install python3"';
  }

  missingDependencies.push({
    name: "Python 3.6+",
    installGuide,
  });
  return false;
}

// Run all checks
function runAllChecks() {
  const nodeOk = checkNodeVersion();
  const npmOk = checkNpmVersion();
  const gitOk = checkGit();
  const cmakeOk = checkCmake();
  const cppOk = checkCppCompiler();
  const pythonOk = checkPython();

  const allOk = nodeOk && npmOk && gitOk && cmakeOk && cppOk && pythonOk;

  if (allOk) {
    console.log(`\n${colors.bright}${colors.green}All prerequisites are satisfied! Ready to proceed.${colors.reset}`);
    return 0;
  } else {
    console.log(`\n${colors.bright}${colors.yellow}Some prerequisites are missing or outdated:${colors.reset}`);

    missingDependencies.forEach((dep, index) => {
      console.log(`\n${colors.bright}${index + 1}. Install ${dep.name}${colors.reset}`);
      console.log(`   ${dep.installGuide}`);
    });

    console.log(`\n${colors.bright}Please install the missing dependencies and run "npm run check-prereqs" again.${colors.reset}`);
    return 1;
  }
}

// Main function
function main() {
  const exitCode = runAllChecks();
  process.exit(exitCode);
}

main();
