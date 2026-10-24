const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const forge = require('../forge.config');
const packageJson = require('../package.json');
const fs = require('node:fs');

test('package metadata uses SXL Cover branding and an SXL-specific executable', () => {
  assert.equal(packageJson.productName, 'SXL Cover');
  assert.equal(packageJson.name, 'sxl-cover');
  assert.equal(packageJson.version, '1.0.0');
  assert.equal(forge.packagerConfig.executableName, 'sxl-cover');
});

test('SXL Cover icon is wired to the Windows executable, installer and window', () => {
  const iconPath = path.join(__dirname, '..', 'assets', 'sxl-cover.ico');
  const svgPath = path.join(__dirname, '..', 'assets', 'sxl-cover.svg');
  assert.equal(fs.existsSync(iconPath), true);
  assert.equal(fs.existsSync(svgPath), true);
  assert.equal(path.basename(forge.packagerConfig.icon), 'sxl-cover');
  assert.equal(path.basename(forge.makers.find(m => m.name === '@electron-forge/maker-squirrel').config.setupIcon), 'sxl-cover.ico');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /icon:\s*path\.join\(__dirname, "\.\.\/assets\/sxl-cover\.ico"\)/);
});

test('packager excludes scoped node_modules from app bundle on Windows and POSIX paths', () => {
  const patterns = Array.isArray(forge.packagerConfig.ignore)
    ? forge.packagerConfig.ignore
    : [forge.packagerConfig.ignore];
  const shouldIgnore = (candidate) => patterns.some((pattern) => pattern instanceof RegExp && pattern.test(candidate));
  assert.equal(shouldIgnore('C:\\laragon\\project\\node_modules\\@electron'), true);
  assert.equal(shouldIgnore('C:\\laragon\\project\\node_modules\\@electron\\packager\\index.js'), true);
  assert.equal(shouldIgnore('/tmp/project/node_modules/@electron/packager/index.js'), true);
  assert.equal(shouldIgnore('C:\\laragon\\project\\src\\main.js'), false);
});

test('runtime has no npm dependencies that require bundling from node_modules', () => {
  assert.deepEqual(packageJson.dependencies || {}, {});
  assert.equal(forge.packagerConfig.prune, false);
});

test('safe combined build installer checks package exit code before installation', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'Build-And-Install.ps1');
  const script = fs.readFileSync(scriptPath, 'utf8');
  assert.match(script, /\$packageExitCode\s*=\s*\$LASTEXITCODE/);
  assert.match(script, /if \(\$packageExitCode -ne 0\)/);
  assert.match(script, /Instalasi dibatalkan/);
  assert.match(script, /Install-To-Laragon\.ps1/);
});


test('Laragon installer creates shortcuts directly and does not depend on a second script parameter contract', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'Install-To-Laragon.ps1');
  const script = fs.readFileSync(scriptPath, 'utf8');
  assert.match(script, /\$installedExe\s*=\s*Join-Path\s+\$targetDirFull\s+\$builtExe\.Name/);
  assert.match(script, /sxl-cover\.exe/);
  assert.match(script, /CreateShortcut\(\$ShortcutPath\)/);
  assert.match(script, /\$KeepExistingLaragonShortcuts/);
  assert.match(script, /native-backup\.lnk/);
  assert.doesNotMatch(script, /Install-Laragon-X-Sinz-UI\.ps1/);
});
