const fs = require("fs");
const path = require("path");

// Create resources directory
const resourcesDir = path.join(__dirname, "resources");
if (!fs.existsSync(resourcesDir)) {
  fs.mkdirSync(resourcesDir, { recursive: true });
}

// Create a placeholder text file explaining how to add icons
const iconInfo = `
# Application Icons

For proper application packaging, please add your icons here:

- icon.png  - 512x512 PNG icon for Linux
- icon.icns - macOS icon file 
- icon.ico  - Windows icon file

For macOS, you can convert a PNG to ICNS using:
$ sips -s format icns icon.png --out icon.icns

Or you can use an online converter.

Once you've added icons, electron-builder will use them in your packaged application.
`;

fs.writeFileSync(path.join(resourcesDir, "README.md"), iconInfo);

// Create a very basic PNG icon (1x1 pixel) just so electron-builder has something to work with
function createBasicIcon() {
  try {
    // Create a minimal PNG file (1x1 pixel transparent)
    // This is a very basic PNG file structure - for a real app you'd want a proper icon
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
      0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    fs.writeFileSync(path.join(resourcesDir, "icon.png"), pngHeader);
    console.log("Created basic icon.png placeholder");

    return true;
  } catch (error) {
    console.error("Error creating basic icon:", error);
    return false;
  }
}

// Create a basic package.json readme if it doesn't exist
if (!fs.existsSync(path.join(__dirname, "README.md"))) {
  const readmeContent = `
# Video Transcription App

An Electron application for transcribing videos using Whisper.cpp.

## Development

- \`npm run dev\` - Start development server with hot reload
- \`npm start\` - Build and start the app
- \`npm run package\` - Package the app for distribution

## Requirements

The app requires the following system dependencies:
- git
- cmake
- make (or Visual Studio on Windows)
- python3

## License

MIT
`;
  fs.writeFileSync(path.join(__dirname, "README.md"), readmeContent);
}

// Create basic icon
createBasicIcon();

console.log("Created resources directory and README files.");
console.log("Please add proper icon files to the resources directory before packaging.");
