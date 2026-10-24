const path = require("node:path");

// This app uses only Electron and Node.js built-in modules at runtime.
// Do not copy the development dependency tree into the packaged app. Excluding
// the whole source node_modules tree avoids Windows ENOENT/chmod races when
// Electron Packager prunes scoped development packages such as node_modules/@electron.
module.exports = {
  packagerConfig: {
    asar: true,
    name: "SXL Cover",
    executableName: "sxl-cover",
    icon: path.join(__dirname, "assets", "sxl-cover"),
    prune: false,
    ignore: [/[\\/]node_modules(?:[\\/]|$)/i]
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "SxlCover",
        setupExe: "SxlCover-Setup.exe",
        setupIcon: path.join(__dirname, "assets", "sxl-cover.ico")
      }
    }
  ]
};
