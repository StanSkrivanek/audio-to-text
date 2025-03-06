const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Configure paths
const vendorDir = path.join(__dirname, "..", "vendor");
const whisperDir = path.join(vendorDir, "whisper.cpp");

console.log("Checking whisper.cpp source code status...");

// Check if the directory exists and contains source code
if (fs.existsSync(whisperDir)) {
  if (fs.existsSync(path.join(whisperDir, "CMakeLists.txt"))) {
    console.log("✅ Whisper.cpp source code found");

    // Check if it's a git repository
    const gitDir = path.join(whisperDir, ".git");
    if (fs.existsSync(gitDir)) {
      console.log("⚠️ WARNING: Git metadata (.git directory) found in whisper.cpp directory");
      console.log("This can cause issues with the main git repository");

      const answerYes = process.argv.includes("--fix") || process.argv.includes("-f");

      if (answerYes || askUser("Do you want to remove the .git directory to fix this? (y/n)")) {
        console.log("Removing .git directory...");
        try {
          if (process.platform === "win32") {
            execSync(`rmdir /s /q "${gitDir}"`);
          } else {
            execSync(`rm -rf "${gitDir}"`);
          }
          console.log("✅ Removed .git directory successfully");
        } catch (error) {
          console.error("❌ Failed to remove .git directory:", error.message);
          console.log(`Manual fix: Delete this folder: ${gitDir}`);
        }
      } else {
        console.log("Keeping .git directory. This may cause issues with the main git repository.");
      }
    } else {
      console.log("✅ No git metadata found, whisper.cpp is properly included");
    }
  } else {
    console.warn("⚠️ Whisper.cpp directory exists but does not contain source code (no CMakeLists.txt found)");
  }
} else {
  console.log("❌ Whisper.cpp directory not found");
  console.log("Run npm run download-whisper to download whisper.cpp");
}

function askUser(question) {
  // Only works in synchronous console environments
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    readline.question(`${question} `, (answer) => {
      readline.close();
      resolve(answer.toLowerCase().startsWith("y"));
    });
  });
}

// Auto-execute if called directly
if (require.main === module) {
  checkWhisperSource().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}

async function checkWhisperSource() {
  // For future support of async operations
}
