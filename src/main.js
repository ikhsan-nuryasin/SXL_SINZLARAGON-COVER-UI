const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs/promises");
const { SettingsStore } = require("./services/settings-store");
const { LaragonAdapter } = require("./services/laragon-adapter");
const { ProjectManager } = require("./services/project-manager");
const { isAllowedWebUrl } = require("./services/validation");
const { createProjectTemplate } = require("./services/project-template");
const { ComponentManager } = require("./services/component-manager");
const { normalizeProfile, envForProfile, connectionUri, testDatabaseProfile } = require("./services/database-manager");

// Keep the same settings location as the Electron starter so existing preferences
// and project registrations can be migrated rather than silently stranded.
app.setPath("userData", path.join(app.getPath("appData"), "localhost-studio"));
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow;
let store;
let adapter;
let projectManager;
let componentManager;

function readArg(name) {
  const prefix = `--${name}=`;
  const equalsArg = process.argv.find(arg => arg.startsWith(prefix));
  if (equalsArg) return equalsArg.slice(prefix.length).replace(/^['"]|['"]$/g, "");
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && typeof process.argv[index + 1] === "string" && !process.argv[index + 1].startsWith("--")
    ? process.argv[index + 1].replace(/^['"]|['"]$/g, "") : "";
}
const launcherRootArgument = readArg("laragon-root");

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function assertTrusted(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("IPC tidak tepercaya.");
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => { assertTrusted(event); return fn(...args); });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 640,
    backgroundColor: "#0b0d12", show: false,
    title: "SXL Cover — Laragon Workspace",
    icon: path.join(__dirname, "../assets/sxl-cover.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const expected = pathToFileURL(path.join(__dirname, "../renderer/index.html")).href;
    if (url !== expected) event.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  app.setAppUserModelId("com.sinz.sxl-cover");
  store = new SettingsStore();
  await store.load();
  const addLog = (level, message, detail) => store.appendLog(level, message, detail);
  adapter = new LaragonAdapter(store, addLog);
  projectManager = new ProjectManager(store, adapter);
  componentManager = new ComponentManager(
    (level, message, detail) => store.appendLog(level, message, detail),
    progress => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("components:install-progress", progress); }
  );
  if (launcherRootArgument) {
    try { await adapter.setRoot(launcherRootArgument); }
    catch (error) {
      await store.appendLog("warning", "Path dari shortcut launcher tidak valid", error.message);
      await adapter.detectRoot();
    }
  } else {
    await adapter.detectRoot();
  }
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

handle("app:get-state", async () => {
  const snapshot = await adapter.getSnapshot();
  snapshot.projects = await projectManager.list();
  snapshot.settings = store.getSettings();
  snapshot.activityLogs = [...snapshot.settings.activityLogs].reverse().slice(0, 120);
  snapshot.componentHub = await componentManager.getCatalog(snapshot.root || "", snapshot.versions || {});
  snapshot.databaseProfiles = snapshot.settings.databaseProfiles || [];
  return snapshot;
});
handle("app:set-theme", theme => store.setTheme(theme));
handle("app:choose-laragon-root", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: "Pilih folder instalasi Laragon", properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  return adapter.setRoot(result.filePaths[0]);
});
handle("app:reload-service", service => adapter.reloadWebServer(service));
function validateMysqlStopOptions(options, property = "password") {
  if (!options || typeof options !== "object" || Array.isArray(options)) return {};
  const value = options[property];
  if (value === undefined) return {};
  // An explicitly submitted empty string is allowed: some Laragon databases
  // were initialized with --initialize-insecure. It is distinct from undefined,
  // which means the UI has not supplied credentials and should trigger a prompt.
  if (typeof value !== "string" || value.length > 1024 || /[\0\r\n\t]/.test(value)) {
    throw new Error("Password MySQL tidak valid. Password tidak disimpan.");
  }
  return property === "mysqlPassword" ? { mysqlPassword: value } : { password: value };
}
handle("service:start", service => adapter.startService(String(service)));
handle("service:stop", (service, options) => adapter.stopService(String(service), validateMysqlStopOptions(options)));
handle("service:restart", (service, options) => adapter.restartService(String(service), validateMysqlStopOptions(options)));
handle("service:start-stack", () => adapter.startStack());
handle("service:stop-stack", options => adapter.stopStack(validateMysqlStopOptions(options, "mysqlPassword")));
handle("service:run-project-task", async (projectPath, taskId) => {
  const result = await adapter.runProjectTask(String(projectPath), String(taskId));
  await store.appendLog("success", `Terminal task dibuka: ${result.label}`, result.directory);
  return result;
});
handle("service:select-runtime", (tool, version) => adapter.selectRuntime(String(tool), String(version)));
handle("service:set-webserver", service => adapter.setPreferredWebServer(String(service)));
handle("service:sync-virtual-hosts", () => adapter.syncVirtualHosts());
handle("service:open-terminal", async directory => {
  const target = typeof directory === "string" && directory.trim() ? path.resolve(directory) : path.join(await adapter.getRoot(), "www");
  const root = await adapter.getRoot();
  if (!root) throw new Error("Lokasi Laragon belum diatur.");
  const relative = path.relative(path.resolve(root), target);
  const insideRoot = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  const knownProjects = await projectManager.list();
  const known = knownProjects.some(project => path.resolve(project.path).toLowerCase() === target.toLowerCase());
  if (!insideRoot && !known) throw new Error("Terminal hanya boleh dibuka di root Laragon atau folder proyek terdaftar.");
  return adapter.openTerminal(target, known);
});
handle("app:open-folder", kind => adapter.openFolder(kind));
handle("project:pick-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: "Pilih folder proyek", properties: ["openDirectory"] });
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
});
handle("project:create-template", async input => {
  const root = await adapter.getRoot();
  if (!root) throw new Error("Hubungkan instalasi Laragon terlebih dahulu.");
  const result = await createProjectTemplate(root, input);
  await store.appendLog("success", `Template proyek ${result.name} dibuat`, `${result.templateLabel} · ${result.path}`);
  return result;
});
handle("project:add", async input => {
  if (!input || typeof input.path !== "string") throw new Error("Data proyek tidak valid.");
  const root = await adapter.getRoot();
  if (root) {
    const www = path.resolve(root, "www");
    const selected = path.resolve(input.path);
    const relative = path.relative(www, selected);
    const insideWww = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    if (insideWww) throw new Error("Folder ini sudah berada di Laragon\\www. Proyek akan terdeteksi otomatis di halaman Projects.");
  }
  const result = await store.addProject(input);
  await store.appendLog("success", `Proyek ${result.name} ditambahkan`, result.path);
  return result;
});
handle("project:remove", async id => {
  const removed = await store.removeProject(String(id));
  if (removed) await store.appendLog("info", "Proyek dilepas dari daftar", String(id));
  return removed;
});
handle("project:open-folder", async projectPath => {
  if (typeof projectPath !== "string") throw new Error("Path proyek tidak valid.");
  const resolved = path.resolve(projectPath);
  const knownProjects = await projectManager.list();
  const isKnownProject = knownProjects.some(project => path.resolve(project.path).toLowerCase() === resolved.toLowerCase());
  if (!isKnownProject) throw new Error("Folder ini bukan proyek yang terdaftar di workspace.");
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("Folder proyek tidak ditemukan.");
  const error = await shell.openPath(resolved);
  if (error) throw new Error(`Tidak dapat membuka folder proyek: ${error}`);
  return true;
});
handle("project:open-url", async url => {
  if (typeof url !== "string") throw new Error("URL tidak valid.");
  if (!isAllowedWebUrl(url)) throw new Error("Hanya URL HTTP/HTTPS yang valid yang diizinkan.");
  const normalizedUrl = new URL(url).toString();
  const knownProjects = await projectManager.list();
  const isKnownUrl = knownProjects.some(project => project.url && new URL(project.url).toString() === normalizedUrl);
  if (!isKnownUrl) throw new Error("URL ini tidak terkait dengan proyek yang terdaftar di workspace.");
  await shell.openExternal(normalizedUrl);
  return true;
});
handle("logs:get-content", sourceId => adapter.readLog(String(sourceId)));
handle("app:open-external-url", async rawUrl => {
  const allowed = new Set([
    "https://laragon.org/docs", "https://laragon.org/docs/cli", "https://laragon.org/docs/pretty-urls",
    "https://learn.microsoft.com/en-us/windows/package-manager/winget/",
    "https://getcomposer.org/download/", "https://getcomposer.org/doc/00-intro.md",
    "https://laravel.com/docs", "https://nodejs.org/en/download", "https://git-scm.com/doc",
    "https://mariadb.com/kb/en/documentation/", "https://www.postgresql.org/docs/",
    "https://www.mongodb.com/docs/", "https://sqlite.org/docs.html",
    "https://docs.docker.com/desktop/setup/install/windows-install/",
    "https://yarnpkg.com/getting-started/install", "https://pnpm.io/installation",
    "https://bun.sh/docs/installation", "https://www.heidisql.com/help.php",
    "https://dbeaver.com/docs/dbeaver/", "https://docs.usebruno.com/"
  ]);
  if (!allowed.has(rawUrl)) throw new Error("URL tidak diizinkan.");
  await shell.openExternal(rawUrl);
  return true;
});


handle("tools:open-local-tool", async toolId => {
  const urls = {
    webroot: "http://localhost/",
    phpmyadmin: "http://localhost/phpmyadmin/",
    adminer: "http://localhost/adminer/",
    mailpit: "http://127.0.0.1:8025/"
  };
  const url = urls[String(toolId)];
  if (!url) throw new Error("Alat lokal tidak dikenal.");
  await shell.openExternal(url);
  await store.appendLog("info", "Alamat alat lokal dibuka", url);
  return { ok: true, url };
});
handle("components:install", async (componentId, mode) => {
  if (typeof componentId !== "string") throw new Error("Komponen tidak valid.");
  return componentManager.install(componentId, String(mode || "install"));
});
handle("components:refresh", async () => {
  componentManager.catalogCache = null;
  const root = await adapter.getRoot();
  const snapshot = await adapter.getSnapshot();
  return componentManager.getCatalog(root || "", snapshot.versions || {}, true);
});
handle("components:open-website", async componentId => {
  const item = ComponentManager.catalog().find(component => component.id === String(componentId));
  if (!item || !/^https:\/\//.test(item.website)) throw new Error("Website komponen tidak dikenal.");
  await shell.openExternal(item.website);
  return true;
});
handle("components:open-installer", async componentId => {
  const item = ComponentManager.catalog().find(component => component.id === String(componentId));
  if (!item || item.installMethod !== "official-link" || item.installUrl !== "https://getcomposer.org/Composer-Setup.exe") {
    throw new Error("Installer resmi tidak dikenal atau tidak diizinkan.");
  }
  await shell.openExternal(item.installUrl);
  await store.appendLog("info", "Unduhan installer resmi dibuka", item.name);
  return { ok: true, componentId: item.id };
});
handle("database:save-profile", async input => {
  const current = store.getSettings().databaseProfiles || [];
  const profile = normalizeProfile(input, current);
  const saved = await store.saveDatabaseProfile(profile);
  await store.appendLog("success", `Profil database disimpan: ${saved.name}`, `${saved.engine} · ${saved.host || saved.database}:${saved.port || "file"}`);
  return saved;
});
handle("database:remove-profile", async id => {
  const removed = await store.removeDatabaseProfile(String(id));
  if (removed) await store.appendLog("info", "Profil database dihapus", String(id));
  return removed;
});
handle("database:test-profile", async id => {
  const profile = (store.getSettings().databaseProfiles || []).find(item => item.id === String(id));
  if (!profile) throw new Error("Profil database tidak ditemukan.");
  const result = await testDatabaseProfile(profile);
  await store.appendLog(result.ok ? "success" : "warning", `Tes koneksi database: ${profile.name}`, result.detail);
  return result;
});
handle("database:copy-uri", async id => {
  const profile = (store.getSettings().databaseProfiles || []).find(item => item.id === String(id));
  if (!profile) throw new Error("Profil database tidak ditemukan.");
  const uri = connectionUri(profile);
  clipboard.writeText(uri);
  await store.appendLog("info", `URI koneksi disalin: ${profile.name}`, "URI tidak menyertakan password.");
  return { ok: true };
});
handle("database:write-env-example", async (profileId, projectPath) => {
  const profile = (store.getSettings().databaseProfiles || []).find(item => item.id === String(profileId));
  if (!profile) throw new Error("Profil database tidak ditemukan.");
  if (typeof projectPath !== "string" || !projectPath.trim()) throw new Error("Folder proyek wajib dipilih.");
  const resolved = path.resolve(projectPath);
  const projects = await projectManager.list();
  if (!projects.some(project => path.resolve(project.path).toLowerCase() === resolved.toLowerCase())) throw new Error("Tujuan harus merupakan proyek yang terdaftar atau terdeteksi di workspace.");
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("Folder proyek tidak ditemukan.");
  const target = path.join(resolved, ".env.example");
  try { await fs.writeFile(target, envForProfile(profile), { encoding: "utf8", flag: "wx" }); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error(".env.example sudah ada. File lama tidak ditimpa; buat cadangan atau pilih proyek lain.");
    throw error;
  }
  await store.appendLog("success", `Template .env.example dibuat untuk ${profile.name}`, target);
  return { ok: true, path: target };
});

handle("reports:export-diagnostics", async () => {
  const snapshot = await adapter.getSnapshot();
  const report = {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    application: { name: "SXL Cover", version: app.getVersion(), electron: process.versions.electron, node: process.versions.node },
    system: { platform: process.platform, release: require("node:os").release(), architecture: process.arch },
    laragon: { detected: Boolean(snapshot.detected), root: snapshot.root || "", versionFolders: snapshot.versions || {}, environmentDiagnostics: snapshot.environmentDiagnostics || [] },
    services: (snapshot.services || []).map(item => ({ id: item.id, label: item.label, running: Boolean(item.running), supported: Boolean(item.supported), externalRunning: Boolean(item.externalRunning), unverifiedRunning: Boolean(item.unverifiedRunning), pids: item.pids || [], controlReason: item.controlReason || "" })),
    projects: { count: (snapshot.projects || []).length, types: (snapshot.projects || []).reduce((acc, project) => { const key = project.type || "Folder proyek"; acc[key] = (acc[key] || 0) + 1; return acc; }, {}) }
  };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Ekspor laporan diagnosis",
    defaultPath: `laragon-sinz-diagnostics-${new Date().toISOString().slice(0,10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, JSON.stringify(report, null, 2), "utf8");
  await store.appendLog("success", "Laporan diagnosis diekspor", result.filePath);
  return { ok: true, path: result.filePath };
});
handle("reports:export-text", async payload => {
  if (!payload || typeof payload.content !== "string") throw new Error("Konten ekspor tidak valid.");
  if (payload.content.length > 1024 * 1024) throw new Error("Ekspor dibatasi hingga 1 MB per file.");
  const suggested = String(payload.suggestedName || "laragon-sinz-log.txt").replace(/[\\/:*?"<>|]/g, "-").slice(0, 100);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Ekspor log",
    defaultPath: suggested.endsWith(".txt") ? suggested : `${suggested}.txt`,
    filters: [{ name: "Text", extensions: ["txt"] }]
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, payload.content, "utf8");
  await store.appendLog("success", "Log diekspor", result.filePath);
  return { ok: true, path: result.filePath };
});
