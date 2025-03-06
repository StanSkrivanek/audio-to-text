
# Application Icons

For proper application packaging, please add your icons here:

- icon.png  - 512x512 PNG icon for Linux
- icon.icns - macOS icon file 
- icon.ico  - Windows icon file

For macOS, you can convert a PNG to ICNS using:
$ sips -s format icns icon.png --out icon.icns

Or you can use an online converter.

Once you've added icons, electron-builder will use them in your packaged application.
