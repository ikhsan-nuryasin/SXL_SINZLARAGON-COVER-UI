const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { ServiceController } = require("./service-controller");
const execFileAsync = promisify(execFile);

const SERVICE_DEFINITIONS = [
  { id: "apache", label: "Apache", category: "Web server", processes: ["httpd.exe"], reloadable: true, logs: ["error.log", "access.log"] },
  { id: "nginx", label: "Nginx", category: "Web server", processes: ["nginx.exe"], reloadable: true, logs: ["error.log", "access.log"] },
  { id: "mysql", label: "MySQL / MariaDB", category: "Database", processes: ["mysqld.exe", "mariadbd.exe"], reloadable: false, logs: ["mysql.log", "mysql.err", "mariadb.log"] },
  { id: "postgresql", label: "PostgreSQL", category: "Database", processes: ["postgres.exe"], reloadable: false, logs: ["postgresql.log"] },
  { id: "redis", label: "Redis", category: "Cache", processes: ["redis-server.exe"], reloadable: false, logs: ["redis.log"] },
  { id: "memcached", label: "Memcached", category: "Cache", processes: ["memcached.exe"], reloadable: false, logs: ["memcached.log"] },
  { id: "mailpit", label: "Mailpit", category: "Email testing", processes: ["mailpit.exe"], reloadable: false, logs: ["mailpit.log"] }
];

async function isFile(filePath) {
  try { return (await fs.stat(filePath)).isFile(); } catch { return false; }
}
async function isDirectory(dirPath) {
  try { return (await fs.stat(dirPath)).isDirectory(); } catch { return false; }
}
async function firstFile(candidates) {
  for (const candidate of candidates) if (candidate && await isFile(candidate)) return path.resolve(candidate);
  return "";
}
async function firstDirectory(candidates) {
  for (const candidate of candidates) if (candidate && await isDirectory(candidate)) return path.resolve(candidate);
  return "";
}

class LaragonAdapter {
  constructor(settingsStore, addLog) {
    this.store = settingsStore;
    this.addLog = addLog;
    this.root = "";
    this.processSnapshot = [];
    this.snapshotAt = 0;
    this.controller = new ServiceController(this, addLog);
  }

  getConfiguredRoot() { return this.store.getSettings().laragonRoot || ""; }

  applyRootEnvironment(root) {
    if (!root) return;
    process.env.LARAGON_ROOT = root;
    process.env.LARAGON_DIR = root;
    process.env.DOCUMENT_ROOT = path.join(root, "www");
    process.env.LARAGON_DATA = path.join(root, "data");
    process.env.LARAGON_TMP = path.join(root, "tmp");
  }

  async validateRoot(root) {
    const normalized = path.resolve(root);
    const launcher = path.join(normalized, "laragon.exe");
    if (!(await isFile(launcher))) throw new Error("Folder ini tidak berisi laragon.exe. Pilih folder instalasi Laragon yang benar.");
    if (!(await isDirectory(path.join(normalized, "bin")))) {
      throw new Error("Folder ini hanya berisi laragon.exe, bukan instalasi Laragon lengkap. Pilih folder yang juga berisi bin, etc, data, usr, dan www.");
    }
    return normalized;
  }

  async detectRoot() {
    const configured = this.getConfiguredRoot();
    const candidates = [
      process.env.LARAGON_ROOT,
      configured,
      "C:\\laragon", "D:\\laragon", "E:\\laragon",
      "C:\\Program Files\\Laragon", "C:\\Program Files (x86)\\Laragon"
    ].filter(Boolean);
    for (const candidate of [...new Set(candidates)]) {
      if (await isFile(path.join(candidate, "laragon.exe")) && await isDirectory(path.join(candidate, "bin"))) {
        this.root = path.resolve(candidate);
        this.applyRootEnvironment(this.root);
        if (this.root !== configured) await this.store.setLaragonRoot(this.root);
        return this.root;
      }
    }
    this.root = "";
    return "";
  }

  async setRoot(root) {
    this.root = await this.validateRoot(root);
    this.applyRootEnvironment(this.root);
    await this.store.setLaragonRoot(this.root);
    await this.addLog("success", "Lokasi Laragon diperbarui", this.root);
    return this.root;
  }

  async getRoot() {
    if (this.root && await isFile(path.join(this.root, "laragon.exe")) && await isDirectory(path.join(this.root, "bin"))) {
      this.applyRootEnvironment(this.root);
      return this.root;
    }
    return this.detectRoot();
  }

  async getProcesses(force = false) {
    if (process.platform !== "win32") return [];
    if (!force && Date.now() - this.snapshotAt < 2000) return this.processSnapshot;
    try {
      const { stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"], { windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
      this.processSnapshot = stdout.split(/\r?\n/).map(line => {
        const match = line.match(/^"([^"]+)"\s*,\s*"?(\d+)/);
        return match ? { name: match[1].toLowerCase(), pid: Number(match[2]) } : null;
      }).filter(Boolean);
      this.snapshotAt = Date.now();
    } catch {
      this.processSnapshot = [];
      this.snapshotAt = Date.now();
    }
    return this.processSnapshot;
  }

  async scanVersions(root, tool) {
    const directory = path.join(root, "bin", tool);
    let entries = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return []; }
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  async listProjects(root) {
    const www = path.join(root, "www");
    let entries = [];
    try { entries = await fs.readdir(www, { withFileTypes: true }); } catch { return []; }
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const projectPath = path.join(www, entry.name);
      let signals = [];
      for (const file of ["index.php", "index.html", "composer.json", "package.json", "artisan", "public", ".git"]) {
        if (await fs.access(path.join(projectPath, file)).then(() => true).catch(() => false)) signals.push(file);
      }
      if (!signals.length) continue;
      let type = "Folder proyek";
      if (signals.includes("artisan")) type = "Laravel";
      else if (signals.includes("composer.json")) type = "PHP / Composer";
      else if (signals.includes("package.json")) type = "Node.js";
      else if (signals.includes("index.php")) type = "PHP";
      else if (signals.includes("index.html")) type = "Static site";
      const hasDnsSafeName = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(entry.name);
      const hostname = hasDnsSafeName ? `${entry.name}.test`.toLowerCase() : "";
      projects.push({
        id: `www:${entry.name.toLowerCase()}`,
        name: entry.name,
        path: projectPath,
        hostname,
        url: hostname ? `http://${hostname}` : "",
        type,
        source: "www",
        removable: false,
        status: "discovered"
      });
    }
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getEnvironmentDiagnostics(root, versions = {}) {
    if (!root) return [{ id: "root", label: "Instalasi Laragon", status: "error", detail: "Belum terhubung. Pilih folder instalasi yang berisi laragon.exe dan bin." }];
    const checks = [];
    const push = (id, label, status, detail, pathValue = "") => checks.push({ id, label, status, detail, path: pathValue });
    const checkDir = async (id, label, rel, required = false) => {
      const target = path.join(root, rel);
      const exists = await isDirectory(target);
      push(id, label, exists ? "ok" : required ? "error" : "warning", exists ? "Folder ditemukan." : required ? "Folder wajib tidak ditemukan." : "Folder tidak ditemukan; beberapa fitur mungkin tidak tersedia.", target);
    };
    const checkFile = async (id, label, candidates, required = false, help = "") => {
      for (const candidate of candidates) if (candidate && await isFile(candidate)) {
        push(id, label, "ok", "File ditemukan.", candidate);
        return candidate;
      }
      push(id, label, required ? "error" : "warning", help || (required ? "File wajib tidak ditemukan." : "File tidak ditemukan; fitur terkait mungkin tidak tersedia."), candidates.find(Boolean) || "");
      return "";
    };
    await checkFile("launcher", "Laragon executable", [path.join(root, "laragon.exe")], true, "laragon.exe tidak ditemukan.");
    await checkDir("bin", "Folder bin", "bin", true);
    await checkDir("www", "Workspace www", "www", true);
    await checkDir("etc", "Konfigurasi etc", "etc");
    await checkDir("data", "Folder data", "data");
    await checkDir("usr", "Pengaturan usr", "usr");

    const settings = this.store.getSettings();
    const selectedVersion = (tool, fallbackList = []) => {
      const saved = settings.selectedVersions?.[tool];
      return saved && fallbackList.includes(saved) ? saved : fallbackList.at(-1) || "";
    };
    const phpVers = versions.php || [];
    const phpVersion = selectedVersion("php", phpVers);
    const phpDir = phpVersion ? path.join(root, "bin", "php", phpVersion) : path.join(root, "bin", "php");
    await checkFile("php", "PHP CLI", [path.join(phpDir, "php.exe")], false, phpVers.length ? "Versi PHP terdeteksi, tetapi php.exe tidak ditemukan pada versi terpilih." : "Folder versi PHP tidak ditemukan di bin\\php.");

    const nodeVers = versions.node || [];
    const nodeVersion = selectedVersion("node", nodeVers);
    const nodeDir = nodeVersion ? path.join(root, "bin", "nodejs", nodeVersion) : path.join(root, "bin", "nodejs");
    await checkFile("node", "Node.js CLI", [path.join(nodeDir, "node.exe")], false, nodeVers.length ? "Folder versi Node terdeteksi, tetapi node.exe tidak ditemukan." : "Folder versi Node.js tidak ditemukan di bin\\nodejs.");
    const composerDir = path.join(root, "bin", "composer");
    await checkFile("composer", "Composer", [path.join(composerDir, "composer.bat"), path.join(composerDir, "composer.cmd"), path.join(composerDir, "composer.exe"), path.join(composerDir, "composer.phar")], false, "Composer tidak terdeteksi di bin\\composer.");
    await checkFile("git", "Git", [path.join(root, "bin", "git", "cmd", "git.exe"), path.join(root, "bin", "git", "bin", "git.exe"), path.join(root, "bin", "git", "mingw64", "bin", "git.exe")], false, "Git tidak ditemukan di bin\\git.");

    const apacheVers = versions.apache || [];
    const apacheVersion = selectedVersion("apache", apacheVers);
    const apacheDir = apacheVersion ? path.join(root, "bin", "apache", apacheVersion) : path.join(root, "bin", "apache");
    const apacheConfig = await firstFile([path.join(apacheDir, "conf", "httpd.conf"), path.join(root, "etc", "apache2", "httpd.conf")]);
    push("apache-config", "Konfigurasi Apache", apacheConfig ? "ok" : "warning", apacheConfig ? "File konfigurasi ditemukan." : "Konfigurasi Apache tidak ditemukan pada jalur standar.", apacheConfig || path.join(root, "etc", "apache2", "httpd.conf"));
    const nginxVers = versions.nginx || [];
    const nginxVersion = selectedVersion("nginx", nginxVers);
    const nginxDir = nginxVersion ? path.join(root, "bin", "nginx", nginxVersion) : path.join(root, "bin", "nginx");
    const nginxConfig = await firstFile([path.join(root, "etc", "nginx", "nginx.conf"), path.join(nginxDir, "conf", "nginx.conf"), path.join(nginxDir, "nginx.conf")]);
    push("nginx-config", "Konfigurasi Nginx", nginxConfig ? "ok" : "warning", nginxConfig ? "File konfigurasi ditemukan." : "Konfigurasi Nginx tidak ditemukan pada jalur standar.", nginxConfig || path.join(root, "etc", "nginx", "nginx.conf"));
    const mysqlVers = versions.mysql || [];
    const mysqlVersion = selectedVersion("mysql", mysqlVers);
    const mysqlDir = mysqlVersion ? path.join(root, "bin", "mysql", mysqlVersion) : path.join(root, "bin", "mysql");
    const mysqlConfig = await firstFile([path.join(mysqlDir, "my.ini"), path.join(mysqlDir, "bin", "my.ini"), path.join(root, "etc", "mysql", "my.ini"), path.join(root, "etc", "my.ini"), path.join(root, "usr", "my.ini")]);
    push("mysql-config", "Konfigurasi MySQL/MariaDB", mysqlConfig ? "ok" : "warning", mysqlConfig ? "File my.ini ditemukan." : "my.ini tidak ditemukan pada jalur standar; start database akan diblokir.", mysqlConfig || path.join(root, "etc", "mysql", "my.ini"));

    const adminCandidates = [
      ["phpmyadmin", "phpMyAdmin", [path.join(root, "etc", "apps", "phpMyAdmin"), path.join(root, "etc", "apps", "phpmyadmin"), path.join(root, "usr", "tpl", "phpmyadmin"), path.join(root, "www", "phpmyadmin")]],
      ["adminer", "Adminer", [path.join(root, "etc", "apps", "adminer"), path.join(root, "usr", "tpl", "adminer"), path.join(root, "www", "adminer")]]
    ];
    for (const [id, label, candidates] of adminCandidates) {
      const found = await firstDirectory(candidates);
      push(id, label, found ? "ok" : "info", found ? "Folder aplikasi terdeteksi. URL lokal dapat dicoba saat web server berjalan." : "Tidak terdeteksi di jalur umum; gunakan jika aplikasi sudah dipasang di web root.", found || candidates[0]);
    }
    push("versions", "Inventaris runtime", (phpVers.length || nodeVers.length || apacheVers.length || nginxVers.length) ? "ok" : "warning", `PHP ${phpVers.length} · Node.js ${nodeVers.length} · Apache ${apacheVers.length} · Nginx ${nginxVers.length} versi terdeteksi.`);
    return checks;
  }

  async getLogFiles(root) {
    const locations = [
      { dir: path.join(root, "bin", "apache"), depth: 4 },
      { dir: path.join(root, "bin", "nginx"), depth: 4 },
      // Keep the broad data-directory scan shallow: database tables can number in the thousands.
      { dir: path.join(root, "data"), depth: 1 },
      { dir: path.join(root, "usr", "log"), depth: 2 },
      { dir: path.join(root, "logs"), depth: 2 },
      { dir: path.join(root, "etc"), depth: 2 }
    ];
    const result = [];
    const seen = new Set();
    const expected = /(^error\.log$|^access\.log$|\.err$|mysql.*\.log$|mariadb.*\.log$|postgres.*\.log$|redis.*\.log$|mailpit.*\.log$|laragon.*\.log$)/i;
    const walk = async (dir, depth) => {
      if (depth < 0 || result.length >= 100) return;
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (result.length >= 100) return;
        const target = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".")) await walk(target, depth - 1);
        else if (entry.isFile() && expected.test(entry.name) && !seen.has(target.toLowerCase())) {
          seen.add(target.toLowerCase());
          result.push({ id: Buffer.from(target).toString("base64url"), label: `${entry.name} · ${path.relative(root, target)}`, path: target });
        }
      }
    };
    for (const location of locations) await walk(location.dir, location.depth);
    return result.sort((a, b) => a.label.localeCompare(b.label));
  }

  async readLog(sourceId) {
    const root = await this.getRoot();
    if (!root) throw new Error("Lokasi Laragon belum diatur.");
    const files = await this.getLogFiles(root);
    const file = files.find(item => item.id === sourceId);
    if (!file) throw new Error("File log tidak ditemukan atau sudah berubah.");
    const stat = await fs.stat(file.path);
    if (!stat.isFile()) throw new Error("Sumber log bukan file.");
    const maxBytes = 160 * 1024;
    const handle = await fs.open(file.path, "r");
    try {
      const start = Math.max(0, stat.size - maxBytes);
      const buffer = Buffer.alloc(Math.min(maxBytes, stat.size));
      await handle.read(buffer, 0, buffer.length, start);
      return { label: file.label, content: buffer.toString("utf8"), truncated: start > 0 };
    } finally { await handle.close(); }
  }

  async getSnapshot() {
    const root = await this.getRoot();
    const settings = this.store.getSettings();
    if (!root) {
      return {
        detected: false, root: "", www: "", versionFolders: {},
        services: SERVICE_DEFINITIONS.map(s => ({ ...s, running: false, pids: [], supported: false, startSupported: false, stopSupported: false, controlReason: "Hubungkan instalasi Laragon terlebih dahulu." })),
        projects: [], logFiles: [], phpVersions: [], versions: {}, serviceCapabilities: {}, environmentDiagnostics: await this.getEnvironmentDiagnostics("", {}), settings
      };
    }
    const procs = await this.getProcesses(true);
    const processNames = [...new Set(SERVICE_DEFINITIONS.flatMap(service => service.processes))];
    const [projects, logFiles, versions, capabilities, processDetails] = await Promise.all([
      this.listProjects(root),
      this.getLogFiles(root),
      this.controller.getVersionCatalog(root),
      this.controller.getServiceCapabilities(root),
      this.controller.getProcessesByName(processNames)
    ]);
    const environmentDiagnostics = await this.getEnvironmentDiagnostics(root, versions);
    // Resolve once so the MySQL identity fallback can compare an otherwise
    // opaque PID against Laragon's selected my.ini and configured TCP port.
    const mysqlPlan = await this.controller.resolvePlan("mysql").catch(() => null);
    const services = await Promise.all(SERVICE_DEFINITIONS.map(async service => {
      const matches = procs.filter(item => service.processes.includes(item.name));
      const records = processDetails.filter(item => service.processes.includes(String(item.name || "").toLowerCase()));
      const capability = capabilities[service.id] || { startSupported: false, stopSupported: false, reason: "Kontrol langsung tidak tersedia." };
      const verified = [];
      const external = [];
      const unknown = [];
      for (const record of records) {
        const identity = await this.controller.verifyProcessForService(root, service.id, record, service.id === "mysql" ? mysqlPlan : null);
        if (identity.status === "verified") verified.push({ ...record, ...identity });
        else if (identity.status === "external") external.push({ ...record, ...identity });
        else unknown.push({ ...record, ...identity });
      }
      const recordsByPid = new Map(records.map(record => [record.pid, record]));
      const tasklistUnknown = matches.filter(item => !recordsByPid.has(item.pid));
      const running = verified.length > 0;
      const externalRunning = external.length > 0;
      const unverifiedRunning = unknown.length > 0 || tasklistUnknown.length > 0;
      const externalPorts = [...new Set(external.flatMap(item => Array.isArray(item.listeningPorts) ? item.listeningPorts.map(Number).filter(port => Number.isInteger(port) && port > 0) : []))].sort((a, b) => a - b);
      let canStartAlongsideExternal = false;
      let mysqlConfiguredPort = 0;
      let mysqlPortState = null;
      if (!running && externalRunning && service.id === "mysql" && mysqlPlan?.supported && mysqlPlan.config) {
        mysqlConfiguredPort = await this.controller.getMysqlPort(mysqlPlan.config);
        mysqlPortState = await this.controller.getListeningPortState(mysqlConfiguredPort);
        canStartAlongsideExternal = mysqlPortState.available && mysqlPortState.owners.length === 0;
      }
      let controlReason = capability.reason || "";
      if (!running && externalRunning && canStartAlongsideExternal) {
        const pids = external.map(item => item.pid).join(", ");
        const example = external.find(item => item.path)?.path || "jalur luar Laragon";
        const portsText = externalPorts.length ? ` Port eksternal terdeteksi: ${externalPorts.join(", ")}.` : "";
        controlReason = `Instalasi database eksternal terdeteksi (PID ${pids}) di ${example}.${portsText} MySQL Laragon dikonfigurasi pada port ${mysqlConfiguredPort}, dan pemeriksaan Windows memastikan port itu sedang kosong. Tombol Mulai akan menjalankan MySQL Laragon secara terpisah; layanan MySQL80 eksternal tidak dihentikan atau diubah.`;
      } else if (!running && externalRunning) {
        const pids = external.map(item => item.pid).join(", ");
        const example = external.find(item => item.path)?.path || "jalur di luar Laragon";
        if (service.id === "mysql" && mysqlPortState?.available && mysqlPortState.owners.length) {
          const owners = mysqlPortState.owners.map(owner => `${owner.name || "proses tidak diketahui"} PID ${owner.pid}`).join(", ");
          controlReason = `Instalasi database eksternal terdeteksi (PID ${pids}) di ${example}. Port MySQL Laragon ${mysqlConfiguredPort} sedang digunakan oleh ${owners}. SXL Cover tidak menghentikan proses eksternal. Kosongkan port tersebut atau ubah port pada my.ini Laragon.`;
        } else {
          const probeDetail = mysqlPortState && !mysqlPortState.available
            ? ` Pemeriksaan port ${mysqlConfiguredPort} gagal: ${mysqlPortState.error || "Windows tidak mengembalikan hasil yang valid"}.`
            : !mysqlPlan?.config
              ? " File my.ini Laragon tidak berhasil diidentifikasi untuk menentukan port aktif."
              : " Belum ada hasil pemeriksaan port yang dapat dipercaya.";
          controlReason = `Proses ${service.label} dengan PID ${pids} berjalan di luar folder Laragon yang dipilih (${root}). Jalur terdeteksi: ${example}.${probeDetail} Proses eksternal tidak akan dihentikan. Setelah perbaikan pemeriksaan port, gunakan Muat Ulang untuk memperbarui status.`;
        }
      } else if (!running && unverifiedRunning) {
        const pids = [...new Set([...unknown.map(item => item.pid), ...tasklistUnknown.map(item => item.pid)])].join(", ") || "tidak diketahui";
        const details = unknown.map(item => `PID ${item.pid}: parent ${item.parentPid || "?"}, port listen ${(Array.isArray(item.listeningPorts) && item.listeningPorts.length) ? item.listeningPorts.join(",") : "tidak terbaca"}`).join("; ");
        const methods = service.id === "mysql"
          ? "Metode verifikasi: ExecutablePath, CommandLine, ImagePath layanan, --defaults-file, dan bila diperlukan parent Laragon.exe + port yang cocok dengan my.ini."
          : "Metode verifikasi: ExecutablePath, CommandLine, dan ImagePath layanan Windows.";
        controlReason = `Windows mendeteksi proses ${service.label} (PID ${pids}), tetapi belum cukup bukti untuk mengaitkannya ke ${root}. ${details ? `${details}. ` : ""}${methods} Tidak ada proses yang dihentikan. Tekan Muat Ulang setelah status proses berubah. Hak Administrator saja tidak menjamin CommandLine/ExecutablePath selalu tersedia.`;
      }
      const displayProcesses = running ? verified : externalRunning ? external : unknown.concat(tasklistUnknown);
      return {
        id: service.id, label: service.label, category: service.category,
        running, pids: displayProcesses.map(item => item.pid), reloadable: service.reloadable,
        supported: Boolean(capability.startSupported), startSupported: Boolean(capability.startSupported),
        stopSupported: Boolean(capability.stopSupported), controlReason,
        externalRunning: !running && externalRunning,
        externalPorts,
        canStartAlongsideExternal: !running && externalRunning && canStartAlongsideExternal,
        externalPort: mysqlConfiguredPort || null,
        unverifiedRunning: !running && unverifiedRunning,
        selectedVersion: capability.selectedVersion || ""
      };
    }));
    const phpVersions = versions.php || [];
    const apacheVersions = versions.apache || [];
    const nginxVersions = versions.nginx || [];
    return {
      detected: true, root, www: path.join(root, "www"),
      versionFolders: { php: phpVersions.length, apache: apacheVersions.length, nginx: nginxVersions.length },
      versions, services, projects, logFiles, phpVersions, serviceCapabilities: capabilities, environmentDiagnostics, settings
    };
  }

  async reloadWebServer(service) {
    const root = await this.getRoot();
    if (!root) throw new Error("Lokasi Laragon belum diatur.");
    if (!new Set(["apache", "nginx"]).has(service)) throw new Error("Layanan reload tidak didukung.");
    const cliCandidates = [path.join(root, "laragon.exe"), path.join(root, "laragon")];
    let command = "";
    for (const candidate of cliCandidates) if (await isFile(candidate)) { command = candidate; break; }
    if (!command) throw new Error("CLI Laragon tidak ditemukan.");
    try {
      const { stdout, stderr } = await execFileAsync(command, ["reload", service], {
        cwd: root, windowsHide: true, timeout: 15000, maxBuffer: 512 * 1024
      });
      const detail = [stdout, stderr].filter(Boolean).join("\n").trim() || "Perintah CLI selesai tanpa output.";
      await this.addLog("success", `Perintah reload ${service} dikirim ke Laragon`, detail);
      return { ok: true, detail };
    } catch (error) {
      const detail = [error.message, error.stdout, error.stderr].filter(Boolean).join("\n").slice(0, 1500);
      await this.addLog("error", `Reload ${service} gagal atau tidak terkonfirmasi`, detail);
      throw new Error(`Laragon tidak mengonfirmasi reload ${service}. ${detail}`);
    }
  }

  async startService(service) { return this.controller.startService(service); }
  async stopService(service, options = {}) { return this.controller.stopService(service, options); }
  async restartService(service, options = {}) { return this.controller.restartService(service, options); }
  async startStack() { return this.controller.startStack(); }
  async stopStack(options = {}) { return this.controller.stopStack(options); }
  async runProjectTask(directory, taskId) { return this.controller.runProjectTask(directory, taskId); }
  async selectRuntime(tool, version) { return this.controller.selectRuntime(tool, version); }
  async setPreferredWebServer(service) {
    const result = await this.store.setPreferredWebServer(service);
    await this.addLog("success", "Web server utama diperbarui", service);
    return result;
  }
  async syncVirtualHosts() {
    const root = await this.getRoot();
    if (!root) throw new Error("Lokasi Laragon belum diatur.");
    const command = path.join(root, "laragon.exe");
    if (!(await isFile(command))) throw new Error("laragon.exe tidak ditemukan. Sinkronisasi host memerlukan CLI Laragon.");
    try {
      const { stdout, stderr } = await execFileAsync(command, ["reload"], { cwd: root, windowsHide: true, timeout: 20000, maxBuffer: 512 * 1024 });
      const detail = [stdout, stderr].filter(Boolean).join("\n").trim() || "Perintah reload Laragon selesai tanpa output.";
      await this.addLog("success", "Sinkronisasi konfigurasi/virtual host diminta", detail);
      return { ok: true, detail };
    } catch (error) {
      const detail = [error.message, error.stdout, error.stderr].filter(Boolean).join("\n").slice(0, 1500);
      await this.addLog("error", "Sinkronisasi virtual host gagal atau tidak terkonfirmasi", detail);
      throw new Error(`Laragon gagal menjalankan reload. ${detail}`);
    }
  }
  async openTerminal(directory, allowExternalProject = false) { return this.controller.openTerminal(directory, allowExternalProject); }

  async isKnownProjectPath(projectPath) {
    const resolved = path.resolve(projectPath).toLowerCase();
    const registered = this.store.getSettings().registeredProjects || [];
    if (registered.some(project => path.resolve(project.path).toLowerCase() === resolved)) return true;
    const root = await this.getRoot();
    if (!root) return false;
    const projects = await this.listProjects(root);
    return projects.some(project => path.resolve(project.path).toLowerCase() === resolved);
  }

  async openFolder(kind) {
    const root = await this.getRoot();
    if (!root) throw new Error("Lokasi Laragon belum diatur.");
    const allowed = {
      root,
      www: path.join(root, "www"),
      logs: path.join(root, "bin"),
      bin: path.join(root, "bin"),
      etc: path.join(root, "etc"),
      data: path.join(root, "data"),
      usr: path.join(root, "usr")
    };
    const target = allowed[kind];
    if (!target) throw new Error("Folder yang diminta tidak diizinkan.");
    const { shell } = require("electron");
    const error = await shell.openPath(target);
    if (error) throw new Error(`Tidak dapat membuka folder: ${error}`);
    return true;
  }
}

module.exports = { LaragonAdapter, SERVICE_DEFINITIONS };
