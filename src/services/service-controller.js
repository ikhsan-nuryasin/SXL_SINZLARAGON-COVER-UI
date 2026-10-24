const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

const CONTROLLABLE = new Set(["apache", "nginx", "mysql", "postgresql", "redis", "memcached", "mailpit"]);
const PROCESS_NAMES = {
  apache: ["httpd.exe"], nginx: ["nginx.exe"], mysql: ["mysqld.exe", "mariadbd.exe"],
  postgresql: ["postgres.exe"], redis: ["redis-server.exe"], memcached: ["memcached.exe"], mailpit: ["mailpit.exe"]
};
const TOOL_FOLDERS = { apache: "apache", nginx: "nginx", mysql: "mysql", postgresql: "postgresql", redis: "redis", memcached: "memcached", mailpit: "mailpit", php: "php", node: "nodejs" };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function isFile(filePath) {
  try { return (await fs.stat(filePath)).isFile(); } catch { return false; }
}
async function isDir(dirPath) {
  try { return (await fs.stat(dirPath)).isDirectory(); } catch { return false; }
}
async function firstFile(candidates) {
  for (const candidate of candidates) if (candidate && await isFile(candidate)) return path.resolve(candidate);
  return "";
}
async function firstDirectory(candidates) {
  for (const candidate of candidates) if (candidate && await isDir(candidate)) return path.resolve(candidate);
  return "";
}
function psQuote(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function parseIni(text) {
  const result = {};
  let section = "";
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) { section = sectionMatch[1].trim().toLowerCase(); result[section] ||= {}; continue; }
    const match = line.match(/^([^=]+?)\s*=\s*(.*?)\s*$/);
    if (match && section) result[section][match[1].trim().toLowerCase()] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return result;
}
function cleanProcessPath(value) {
  let result = String(value || "").trim().replace(/^"(.*)"$/, "$1");
  // Windows may return extended-length paths from CIM/Win32_Process.
  if (result.startsWith("\\\\?\\UNC\\")) result = "\\\\" + result.slice(8);
  else if (result.startsWith("\\\\?\\")) result = result.slice(4);
  return result;
}

function pathApiFor(...values) {
  return values.some(value => {
    const candidate = cleanProcessPath(value);
    return /^[a-z]:[\\/]/i.test(candidate) || candidate.startsWith("\\\\");
  }) ? path.win32 : path;
}

function normalizedAbsolutePath(value, api = pathApiFor(value)) {
  const clean = cleanProcessPath(value);
  if (!clean) return "";
  const normalized = api.normalize(api.resolve(clean));
  const root = api.parse(normalized).root;
  return normalized.length > root.length ? normalized.replace(/[\\/]+$/, "") : normalized;
}

function normalizedPathForCompare(value, api = pathApiFor(value)) {
  return normalizedAbsolutePath(value, api).toLowerCase();
}

function pathIsWithin(root, candidate) {
  if (!root || !candidate) return false;
  const api = pathApiFor(root, candidate);
  const normalizedRoot = normalizedPathForCompare(root, api);
  const normalizedCandidate = normalizedPathForCompare(candidate, api);
  if (!normalizedRoot || !normalizedCandidate) return false;
  const rel = api.relative(normalizedRoot, normalizedCandidate);
  return rel === "" || (!rel.startsWith(`..${api.sep}`) && rel !== ".." && !api.isAbsolute(rel));
}

function relativePath(root, candidate) {
  const api = pathApiFor(root, candidate);
  // Preserve the actual path casing in the returned relative path because
  // Laragon version-directory names may contain mixed case (for example VS16).
  return api.relative(normalizedAbsolutePath(root, api), normalizedAbsolutePath(candidate, api));
}

function extractOptionPath(commandLine, optionName) {
  const command = String(commandLine || "");
  const escaped = String(optionName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return "";
  const patterns = [
    new RegExp(`[\"']${escaped}\\s*=\\s*([^\"']+)[\"']`, "i"),
    new RegExp(`${escaped}\\s*=\\s*\"([^\"]+)\"`, "i"),
    new RegExp(`${escaped}\\s*=\\s*'([^']+)'`, "i"),
    new RegExp(`${escaped}\\s*=\\s*([^\\s\"']+)`, "i"),
    new RegExp(`${escaped}\\s+\"([^\"]+)\"`, "i"),
    new RegExp(`${escaped}\\s+'([^']+)'`, "i"),
    new RegExp(`${escaped}\\s+([^\\s\"']+)`, "i")
  ];
  for (const pattern of patterns) {
    const match = command.match(pattern);
    const value = match && (match[1] || match[2] || match[3]);
    if (value) return cleanProcessPath(value.trim());
  }
  return "";
}

function extractExecutableFromCommandLine(commandLine) {
  const command = String(commandLine || "").trim();
  if (!command) return "";
  if (command[0] === '"' || command[0] === "'") {
    const end = command.indexOf(command[0], 1);
    if (end > 1) return cleanProcessPath(command.slice(1, end));
  }
  const match = command.match(/^(.+?\.exe)(?:\s|$)/i);
  return match ? cleanProcessPath(match[1]) : "";
}

function normalizePortProbeResult(targetPort, result) {
  const ownersRaw = result && result.owners;
  const owners = Array.isArray(ownersRaw)
    ? ownersRaw
    : ownersRaw && Number.isInteger(ownersRaw.pid) ? [ownersRaw] : [];
  const querySucceeded = result?.querySucceeded === true;
  return {
    available: querySucceeded,
    port: targetPort,
    owners: owners.filter(owner => owner && Number.isInteger(owner.pid)),
    error: querySucceeded ? "" : String(result?.error || "Pemeriksaan port Windows gagal.").slice(0, 400),
    method: String(result?.method || "")
  };
}

function buildListeningPortProbeScript(targetPort) {
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$targetPort = ${Number(targetPort)}
try {
  $method = 'Get-NetTCPConnection'
  try {
    # Do not filter by LocalPort at the cmdlet stage. A free target port can
    # produce a non-terminating/no-object error on some Windows builds when
    # -ErrorAction Stop is used. Enumerate LISTEN sockets and filter in memory.
    $allConnections = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
    $connections = @($allConnections | Where-Object { [int]$_.LocalPort -eq $targetPort })
  } catch {
    $netError = [string]$_.Exception.Message
    $method = 'netstat'
    $lines = @(& netstat.exe -ano -p tcp 2>$null)
    if ($LASTEXITCODE -ne 0) { throw "Get-NetTCPConnection gagal ($netError); netstat.exe juga gagal." }
    $connections = @()
    foreach ($line in $lines) {
      if ($line -match '^\\s*TCP\\s+(\\S+)\\s+(\\S+)\\s+LISTENING\\s+(\\d+)\\s*$') {
        $localEndpoint = [string]$Matches[1]
        $ownerId = [int]$Matches[3]
        if ($localEndpoint -match ':(\\d+)$') {
          $localPort = [int]$Matches[1]
          if ($localPort -eq $targetPort) {
            $localAddress = $localEndpoint.Substring(0, $localEndpoint.LastIndexOf(':'))
            $connections += [PSCustomObject]@{ LocalPort = $localPort; OwningProcess = $ownerId; LocalAddress = $localAddress }
          }
        }
      }
    }
  }
  $ownerIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { [int]$_ -gt 0 })
  $owners = @()
  foreach ($ownerId in $ownerIds) {
    $proc = Get-CimInstance Win32_Process -Filter (\"ProcessId = \" + [int]$ownerId) -ErrorAction SilentlyContinue
    $procName = ''
    $procPath = ''
    $procCommand = ''
    if ($proc) {
      $procName = [string]$proc.Name
      $procPath = [string]$proc.ExecutablePath
      $procCommand = [string]$proc.CommandLine
    }
    $addresses = @($connections | Where-Object { [int]$_.OwningProcess -eq [int]$ownerId } | Select-Object -ExpandProperty LocalAddress -Unique)
    $owners += [PSCustomObject]@{
      pid = [int]$ownerId
      name = $procName
      path = $procPath
      command = $procCommand
      localAddresses = $addresses
    }
  }
  [PSCustomObject]@{ querySucceeded = $true; available = $true; port = $targetPort; owners = @($owners); error = ''; method = $method } | ConvertTo-Json -Compress -Depth 5
} catch {
  [PSCustomObject]@{ querySucceeded = $false; available = $false; port = $targetPort; owners = @(); error = [string]$_.Exception.Message; method = '' } | ConvertTo-Json -Compress -Depth 4
}
`;
}

function escapeMysqlOptionFileValue(value) {
  const text = String(value ?? "");
  if (/[\0\r\n\t]/.test(text)) {
    throw new Error("Password MySQL mengandung karakter kontrol yang tidak dapat ditulis ke file kredensial sementara.");
  }
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isMysqlAccessDenied(errorText) {
  return /access denied for user/i.test(String(errorText || ""));
}

function sameWindowsPath(first, second) {
  if (!first || !second) return false;
  const api = pathApiFor(first, second);
  return normalizedPathForCompare(first, api) === normalizedPathForCompare(second, api);
}

class ServiceController {
  constructor(adapter, addLog) {
    this.adapter = adapter;
    this.addLog = addLog;
    this.ownedPids = new Map();
  }

  async getIni(root) {
    const file = path.join(root, "usr", "laragon.ini");
    try { return parseIni(await fs.readFile(file, "utf8")); } catch { return {}; }
  }

  async listVersionFolders(root, tool) {
    const folder = TOOL_FOLDERS[tool] || tool;
    const base = path.join(root, "bin", folder);
    let entries = [];
    try { entries = await fs.readdir(base, { withFileTypes: true }); } catch { return []; }
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  async getSelectedVersion(root, tool, folders) {
    const settings = this.adapter.store.getSettings();
    const saved = settings.selectedVersions && settings.selectedVersions[tool];
    if (saved && folders.includes(saved)) return saved;
    const ini = await this.getIni(root);
    const section = ini[tool] || {};
    const configured = section.version || section.activeversion || section.selectedversion || "";
    if (configured && folders.includes(configured)) return configured;
    return folders.length ? folders[folders.length - 1] : "";
  }

  async getVersionCatalog(root) {
    const catalog = {};
    for (const tool of ["php", "apache", "nginx", "mysql", "postgresql", "redis", "memcached", "mailpit", "node"]) {
      catalog[tool] = await this.listVersionFolders(root, tool);
    }
    return catalog;
  }

  async resolvePlan(serviceId, requestedVersion = "") {
    if (!CONTROLLABLE.has(serviceId)) throw new Error(`Layanan ${serviceId} belum didukung oleh pengelola langsung.`);
    const root = await this.adapter.getRoot();
    if (!root) throw new Error("Folder instalasi Laragon belum diatur.");
    const toolFolder = TOOL_FOLDERS[serviceId] || serviceId;
    const base = path.join(root, "bin", toolFolder);
    const folders = await this.listVersionFolders(root, serviceId);
    const selectedVersion = requestedVersion && folders.includes(requestedVersion) ? requestedVersion : await this.getSelectedVersion(root, serviceId, folders);
    const ordered = selectedVersion ? [selectedVersion, ...folders.filter(name => name !== selectedVersion)] : folders;
    const versionDirs = ordered.map(name => path.join(base, name));
    const binaryNames = {
      apache: [path.join("bin", "httpd.exe"), "httpd.exe"],
      nginx: ["nginx.exe"],
      mysql: [path.join("bin", "mysqld.exe"), "mysqld.exe", path.join("bin", "mariadbd.exe"), "mariadbd.exe"],
      postgresql: [path.join("bin", "pg_ctl.exe"), "pg_ctl.exe"],
      redis: ["redis-server.exe", path.join("bin", "redis-server.exe")],
      memcached: ["memcached.exe", path.join("bin", "memcached.exe")],
      mailpit: ["mailpit.exe", path.join("bin", "mailpit.exe")]
    }[serviceId];
    let versionDir = "";
    let executable = "";
    for (const folder of versionDirs) {
      const candidate = await firstFile(binaryNames.map(name => path.join(folder, name)));
      if (candidate) { versionDir = folder; executable = candidate; break; }
    }
    // Some installations put an executable directly under bin/<tool>.
    if (!executable) {
      executable = await firstFile(binaryNames.map(name => path.join(base, name)));
      if (executable) versionDir = base;
    }
    if (!executable) {
      return { id: serviceId, root, found: false, supported: false, reason: `Binary ${binaryNames[0]} tidak ditemukan di ${base}.`, versionDir: "", executable: "", config: "", dataDir: "" };
    }

    const plan = { id: serviceId, root, found: true, supported: true, reason: "", selectedVersion, versionDir, executable, config: "", dataDir: "", args: [], cwd: versionDir };
    if (serviceId === "apache") {
      plan.config = await firstFile([
        path.join(versionDir, "conf", "httpd.conf"),
        path.join(root, "etc", "apache2", "httpd.conf")
      ]);
      if (!plan.config) return { ...plan, supported: false, reason: "httpd.exe ditemukan tetapi file konfigurasi Apache tidak ditemukan." };
      plan.args = ["-f", plan.config, "-d", versionDir];
    } else if (serviceId === "nginx") {
      plan.config = await firstFile([
        path.join(root, "etc", "nginx", "nginx.conf"),
        path.join(versionDir, "conf", "nginx.conf"),
        path.join(versionDir, "nginx.conf")
      ]);
      if (!plan.config) return { ...plan, supported: false, reason: "nginx.exe ditemukan tetapi nginx.conf tidak ditemukan." };
      plan.args = ["-p", `${root}${path.sep}`, "-c", plan.config];
    } else if (serviceId === "mysql") {
      plan.config = await firstFile([
        path.join(versionDir, "my.ini"), path.join(versionDir, "bin", "my.ini"),
        path.join(root, "etc", "mysql", "my.ini"), path.join(root, "etc", "my.ini"),
        path.join(root, "usr", "my.ini")
      ]);
      if (!plan.config) return { ...plan, supported: false, reason: "mysqld.exe ditemukan tetapi my.ini tidak ditemukan. Startup diblokir demi keamanan data." };
      plan.args = [`--defaults-file=${plan.config}`];
    } else if (serviceId === "postgresql") {
      plan.dataDir = await firstDirectory([
        path.join(root, "data", "postgresql"), path.join(root, "data", "postgres"),
        path.join(root, "data", "postgresql-data")
      ]);
      if (!plan.dataDir || !(await isFile(path.join(plan.dataDir, "PG_VERSION")))) {
        return { ...plan, supported: false, reason: "Folder PostgreSQL tidak berisi PG_VERSION. Aplikasi tidak akan menginisialisasi database secara otomatis." };
      }
      plan.args = ["-D", plan.dataDir];
    } else if (serviceId === "redis") {
      plan.config = await firstFile([
        path.join(root, "etc", "redis", "redis.conf"), path.join(versionDir, "redis.conf"), path.join(versionDir, "conf", "redis.conf")
      ]);
      plan.dataDir = path.join(root, "data", "redis");
      await fs.mkdir(plan.dataDir, { recursive: true });
      plan.args = plan.config ? [plan.config] : ["--bind", "127.0.0.1", "--port", "6379", "--dir", plan.dataDir, "--dbfilename", "dump.rdb"];
    } else if (serviceId === "memcached") {
      plan.args = ["-m", "64", "-p", "11211", "-U", "0", "-l", "127.0.0.1"];
    } else if (serviceId === "mailpit") {
      plan.args = ["--listen", "127.0.0.1:8025", "--smtp", "127.0.0.1:1025"];
    }
    return plan;
  }

  async runCommand(file, args, cwd, timeout = 12000) {
    try {
      const result = await execFileAsync(file, args, { cwd, windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
      return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    } catch (error) {
      const detail = [error.message, error.stdout, error.stderr].filter(Boolean).join("\n").trim();
      throw new Error(detail.slice(0, 1800) || `Perintah gagal: ${path.basename(file)}`);
    }
  }

  async testPlan(plan) {
    if (plan.id === "apache") {
      const result = await this.runCommand(plan.executable, ["-t", "-f", plan.config, "-d", plan.versionDir], plan.cwd, 15000);
      if (!/syntax ok/i.test(result)) throw new Error(result || "Validasi konfigurasi Apache tidak mengembalikan Syntax OK.");
    }
    if (plan.id === "nginx") {
      const result = await this.runCommand(plan.executable, [...plan.args, "-t"], plan.cwd, 15000);
      if (!/successful|test is successful|syntax is ok/i.test(result)) throw new Error(result || "Validasi konfigurasi Nginx tidak terkonfirmasi.");
    }
  }

  async launch(plan) {
    if (plan.id === "postgresql") {
      await fs.mkdir(path.join(plan.root, "tmp"), { recursive: true });
      const logFile = path.join(plan.root, "tmp", "sinz-postgresql.log");
      const output = await this.runCommand(plan.executable, [...plan.args, "-l", logFile, "-w", "start"], plan.cwd, 25000);
      await sleep(900);
      const processes = await this.getRootProcesses(plan);
      if (!processes.length) throw new Error(output || "pg_ctl selesai, tetapi proses PostgreSQL tidak terdeteksi. Periksa log PostgreSQL.");
      return { pid: processes[0].pid, detail: output || `PostgreSQL started with PID ${processes[0].pid}.` };
    }
    if (plan.id === "mysql") {
      // mysqld reads the configured datadir from my.ini. Refuse to start if data path is missing in an explicit config.
      const ini = await fs.readFile(plan.config, "utf8").catch(() => "");
      const hasDataDir = /^\s*datadir\s*=/im.test(ini);
      if (!hasDataDir) throw new Error("my.ini tidak menentukan datadir. Demi mencegah pembuatan database di folder yang salah, startup diblokir.");
    }
    if (plan.id === "apache" || plan.id === "nginx") await this.testPlan(plan);
    const args = plan.args;
    const env = { ...process.env };
    env.LARAGON_ROOT = plan.root;
    env.LARAGON_DIR = plan.root;
    env.DOCUMENT_ROOT = path.join(plan.root, "www");
    env.LARAGON_DATA = path.join(plan.root, "data");
    env.LARAGON_TMP = path.join(plan.root, "tmp");
    const phpVersions = await this.listVersionFolders(plan.root, "php");
    const selectedPhp = await this.getSelectedVersion(plan.root, "php", phpVersions);
    const phpFolder = selectedPhp ? path.join(plan.root, "bin", "php", selectedPhp) : path.join(plan.root, "bin", "php");
    const binFolders = [path.dirname(plan.executable), phpFolder, path.join(plan.root, "bin", "composer"), path.join(plan.root, "bin", "nodejs")];
    env.PATH = [...binFolders, env.PATH || ""].filter(Boolean).join(path.delimiter);
    const child = spawn(plan.executable, args, { cwd: plan.cwd || plan.root, env, detached: true, windowsHide: true, stdio: "ignore" });
    const spawnResult = await new Promise((resolve, reject) => {
      child.once("spawn", () => resolve({ pid: child.pid }));
      child.once("error", reject);
    }).catch(error => { throw new Error(`Tidak dapat menjalankan ${path.basename(plan.executable)}: ${error.message}`); });
    // Catch immediate exits (invalid config, missing DLL, port already bound) without waiting indefinitely.
    await sleep(900);
    if (child.exitCode !== null) throw new Error(`${path.basename(plan.executable)} langsung berhenti (exit code ${child.exitCode}). Periksa file log layanan.`);
    child.unref();
    this.ownedPids.set(plan.id, { pid: spawnResult.pid, executable: plan.executable });
    return { pid: spawnResult.pid, detail: `Started ${path.basename(plan.executable)} using ${plan.selectedVersion || path.basename(plan.versionDir)}.` };
  }

  async getProcessesByName(names) {
    if (process.platform !== "win32") return [];
    // Query the process list once so we can inspect parent lineage even when
    // Win32_Process.ExecutablePath is hidden for the service process itself.
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$names = @(${names.map(psQuote).join(",")})
$serviceByPid = @{}
Get-CimInstance Win32_Service | Where-Object { $_.ProcessId -gt 0 } | ForEach-Object {
  $serviceByPid[[string]$_.ProcessId] = $_
}
$all = @(Get-CimInstance Win32_Process)
$processByPid = @{}
foreach ($p in $all) { $processByPid[[string]$p.ProcessId] = $p }
$listenByPid = @{}
try {
  Get-NetTCPConnection -State Listen | ForEach-Object {
    $key = [string]$_.OwningProcess
    if (-not $listenByPid.ContainsKey($key)) { $listenByPid[$key] = @() }
    $listenByPid[$key] += [int]$_.LocalPort
  }
} catch {}
$rows = @($all | Where-Object { $names -contains $_.Name } | ForEach-Object {
  $proc = $_
  $svc = $serviceByPid[[string]$proc.ProcessId]
  $ancestors = @()
  $seen = @{}
  $cursor = [int]$proc.ParentProcessId
  for ($i = 0; $i -lt 10 -and $cursor -gt 0; $i++) {
    $key = [string]$cursor
    if ($seen.ContainsKey($key)) { break }
    $seen[$key] = $true
    $parent = $processByPid[$key]
    if (-not $parent) { break }
    $ancestors += [PSCustomObject]@{
      name=[string]$parent.Name
      pid=[int]$parent.ProcessId
      path=[string]$parent.ExecutablePath
      command=[string]$parent.CommandLine
      parentPid=[int]$parent.ParentProcessId
    }
    $cursor = [int]$parent.ParentProcessId
  }
  $ports = @()
  $keyPid = [string]$proc.ProcessId
  if ($listenByPid.ContainsKey($keyPid)) { $ports = @($listenByPid[$keyPid] | Select-Object -Unique) }
  $row = [PSCustomObject]@{
    name=[string]$proc.Name
    pid=[int]$proc.ProcessId
    path=[string]$proc.ExecutablePath
    command=[string]$proc.CommandLine
    parentPid=[int]$proc.ParentProcessId
    ancestors=@($ancestors)
    listeningPorts=@($ports)
    serviceName=''
    servicePath=''
  }
  if ($svc) {
    $row.serviceName = [string]$svc.Name
    $row.servicePath = [string]$svc.PathName
  }
  $row
})
ConvertTo-Json -InputObject $rows -Compress -Depth 7
`;
    try {
      const encoded = Buffer.from(script, "utf16le").toString("base64");
      const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
      if (!stdout.trim()) return [];
      const parsed = JSON.parse(stdout.trim());
      return (Array.isArray(parsed) ? parsed : [parsed]).filter(row => row && Number.isInteger(row.pid));
    } catch { return []; }
  }

  async executableBelongsToRoot(root, executablePath) {
    if (!root || !executablePath || typeof executablePath !== "string") return false;
    // First compare the paths as Windows reported them (case-insensitive and
    // tolerant of the \\?\ extended-path prefix). This is the fast path.
    if (pathIsWithin(root, executablePath)) return true;
    // Laragon folders are sometimes junctions/symlinks. Compare their physical
    // paths too, but only if Windows lets this process resolve both paths.
    try {
      const [realRoot, realExecutable] = await Promise.all([
        fs.realpath(cleanProcessPath(root)),
        fs.realpath(cleanProcessPath(executablePath))
      ]);
      return pathIsWithin(realRoot, realExecutable);
    } catch {
      return false;
    }
  }

  async isRecognizedMysqlConfig(root, configPath) {
    if (!root || !configPath || !(await isFile(configPath))) return false;
    const withinRoot = await this.executableBelongsToRoot(root, configPath);
    if (!withinRoot) return false;
    const rel = relativePath(root, configPath).replace(/\//g, "\\").toLowerCase();
    // Accept only usual Laragon MySQL/MariaDB configuration locations, not an
    // arbitrary ini file that happens to be somewhere under the workspace.
    return rel === "etc\\mysql\\my.ini" || rel === "etc\\my.ini" || rel === "usr\\my.ini" ||
      /^bin\\mysql\\[^\\]+(?:\\[^\\]+)*\\my\.ini$/.test(rel) ||
      rel === "bin\\mysql\\my.ini";
  }

  async inferMysqlConfigFromExecutable(root, executablePath) {
    if (!root || !executablePath || !(await this.executableBelongsToRoot(root, executablePath))) return "";
    const rel = await this.relativePathForVerifiedRoot(root, executablePath);
    const pieces = rel.split(/[\\/]+/);
    if (pieces.length >= 3 && pieces[0].toLowerCase() === "bin" && pieces[1].toLowerCase() === "mysql") {
      const versionRoot = path.join(root, pieces[0], pieces[1], pieces[2]);
      const candidate = await firstFile([
        path.join(versionRoot, "my.ini"),
        path.join(versionRoot, "bin", "my.ini")
      ]);
      if (candidate && await this.isRecognizedMysqlConfig(root, candidate)) return candidate;
    }
    return "";
  }

  async getMysqlPort(configPath) {
    if (!configPath) return 3306;
    const content = await fs.readFile(configPath, "utf8").catch(() => "");
    const parsed = parseIni(content);
    const raw = parsed.mysqld?.port || parsed.mariadb?.port || parsed.server?.port || "3306";
    const port = Number.parseInt(raw, 10);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 3306;
  }

  async getListeningPortState(port) {
    const targetPort = Number(port);
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      return { available: false, port: targetPort, owners: [], error: "Port tidak valid." };
    }
    if (process.platform !== "win32") {
      return { available: false, port: targetPort, owners: [], error: "Pemeriksaan port khusus Windows." };
    }
    // Important Windows PowerShell edge case:
    // `Get-NetTCPConnection -LocalPort <free-port> -ErrorAction Stop` can throw
    // when there are no matching objects. That means the port is free, not that
    // the port-check failed. Enumerate listeners first, then filter the target.
    // If Get-NetTCPConnection itself is unavailable, fall back to read-only
    // `netstat -ano`. Only report an unverified state if both probes fail.
    const script = buildListeningPortProbeScript(targetPort);
    try {
      const encoded = Buffer.from(script, "utf16le").toString("base64");
      const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024 });
      const result = JSON.parse(String(stdout || "").trim());
      return normalizePortProbeResult(targetPort, result);
    } catch (error) {
      return { available: false, port: targetPort, owners: [], error: String(error.message || error).slice(0, 400) };
    }
  }

  async hasLaragonAncestor(root, record) {
    const ancestors = Array.isArray(record?.ancestors) ? record.ancestors : (record?.ancestors ? [record.ancestors] : []);
    const expected = path.join(root, "laragon.exe");
    for (const ancestor of ancestors) {
      const name = String(ancestor?.name || "").toLowerCase();
      const commandPath = ancestor?.path || extractExecutableFromCommandLine(ancestor?.command);
      const baseName = pathApiFor(commandPath).basename(cleanProcessPath(commandPath)).toLowerCase();
      if (name !== "laragon.exe" && baseName !== "laragon.exe") continue;
      if (commandPath && sameWindowsPath(commandPath, expected)) return true;
      if (commandPath && baseName === "laragon.exe" && await this.executableBelongsToRoot(root, commandPath)) return true;
    }
    return false;
  }

  async resolveMysqlConfigForRecord(root, record, executablePath, plan = null) {
    const argConfig = extractOptionPath(record?.command, "--defaults-file") || extractOptionPath(record?.servicePath, "--defaults-file");
    if (argConfig) {
      if (await this.isRecognizedMysqlConfig(root, argConfig)) return { configPath: argConfig, invalidConfig: false };
      return { configPath: argConfig, invalidConfig: true };
    }
    const inferred = await this.inferMysqlConfigFromExecutable(root, executablePath);
    if (inferred) return { configPath: inferred, invalidConfig: false };
    if (plan?.config && await this.isRecognizedMysqlConfig(root, plan.config) && executablePath && plan.versionDir && await this.executableBelongsToRoot(plan.versionDir, executablePath)) {
      return { configPath: plan.config, invalidConfig: false };
    }
    return { configPath: "", invalidConfig: false };
  }

  async verifyProcessForService(root, serviceId, record, plan = null) {
    const processPath = typeof record?.path === "string" ? record.path.trim() : "";
    const commandExecutable = extractExecutableFromCommandLine(record?.command);
    const serviceExecutable = extractExecutableFromCommandLine(record?.servicePath);

    if (processPath) {
      const belongs = await this.executableBelongsToRoot(root, processPath);
      if (!belongs) return { status: "external", method: "executable-path", path: processPath, configPath: "" };
      if (serviceId === "mysql") {
        const config = await this.resolveMysqlConfigForRecord(root, record, processPath, plan);
        if (config.invalidConfig) return { status: "external", method: "mysql-external-config", path: processPath, configPath: config.configPath };
        return { status: "verified", method: "executable-path", path: processPath, configPath: config.configPath };
      }
      return { status: "verified", method: "executable-path", path: processPath, configPath: "" };
    }

    // If ExecutablePath is unavailable but the process command line is readable,
    // its leading executable path is another concrete identity source. Older
    // Laragon versions often use a full path here even when CIM hides ExecutablePath.
    if (commandExecutable && (/^[a-z]:[\\/]/i.test(commandExecutable) || commandExecutable.startsWith("\\\\"))) {
      const belongs = await this.executableBelongsToRoot(root, commandExecutable);
      if (!belongs) return { status: "external", method: "command-line-executable", path: commandExecutable, configPath: "" };
      if (serviceId === "mysql") {
        const config = await this.resolveMysqlConfigForRecord(root, record, commandExecutable, plan);
        if (config.invalidConfig) return { status: "external", method: "mysql-external-config", path: commandExecutable, configPath: config.configPath };
        return { status: "verified", method: "command-line-executable", path: commandExecutable, configPath: config.configPath };
      }
      return { status: "verified", method: "command-line-executable", path: commandExecutable, configPath: "" };
    }

    // Some Windows security contexts hide Win32_Process.ExecutablePath. If the
    // process is installed as a Windows service, its registered ImagePath is a
    // second independent source for the executable location.
    if (serviceExecutable && (/^[a-z]:[\\/]/i.test(serviceExecutable) || serviceExecutable.startsWith("\\\\"))) {
      const belongs = await this.executableBelongsToRoot(root, serviceExecutable);
      if (!belongs) return { status: "external", method: "windows-service-path", path: serviceExecutable, configPath: "" };
      if (serviceId === "mysql") {
        const config = await this.resolveMysqlConfigForRecord(root, record, serviceExecutable, plan);
        if (config.invalidConfig) return { status: "external", method: "mysql-external-config", path: serviceExecutable, configPath: config.configPath };
        return { status: "verified", method: "windows-service-path", path: serviceExecutable, configPath: config.configPath };
      }
      return { status: "verified", method: "windows-service-path", path: serviceExecutable, configPath: "" };
    }

    // When both executable path and command line are hidden, a MySQL instance can
    // still be identified only with two independent signals: a Laragon.exe parent
    // in the selected root and ownership of the port configured by Laragon's my.ini.
    if (serviceId === "mysql") {
      const configPath = extractOptionPath(record?.command, "--defaults-file") || extractOptionPath(record?.servicePath, "--defaults-file");
      if (configPath && await this.isRecognizedMysqlConfig(root, configPath)) {
        return { status: "verified", method: "mysql-defaults-file", path: "", configPath };
      }
      if (plan?.config && await this.isRecognizedMysqlConfig(root, plan.config) && await this.hasLaragonAncestor(root, record)) {
        const expectedPort = await this.getMysqlPort(plan.config);
        const ports = Array.isArray(record?.listeningPorts) ? record.listeningPorts.map(Number) : [Number(record?.listeningPorts)];
        if (ports.includes(expectedPort)) {
          return { status: "verified", method: "laragon-ancestor-and-port", path: "", configPath: plan.config };
        }
      }
    }

    return { status: "unknown", method: "unavailable", path: "", configPath: "" };
  }

  async relativePathForVerifiedRoot(root, candidate) {
    const direct = relativePath(root, candidate);
    if (direct === "" || (!direct.startsWith("..\\") && direct !== ".." && !pathApiFor(root, candidate).isAbsolute(direct))) return direct;
    // If the configured folder is a junction, use physical paths to identify
    // which Laragon version directory owns the running executable.
    try {
      const [realRoot, realCandidate] = await Promise.all([
        fs.realpath(cleanProcessPath(root)),
        fs.realpath(cleanProcessPath(candidate))
      ]);
      if (pathIsWithin(realRoot, realCandidate)) return relativePath(realRoot, realCandidate);
    } catch {}
    return direct;
  }

  async getRootProcesses(plan) {
    const names = PROCESS_NAMES[plan.id] || [path.basename(plan.executable)];
    const records = await this.getProcessesByName(names);
    const checked = await Promise.all(records.map(async row => ({
      row,
      verification: await this.verifyProcessForService(plan.root, plan.id, row, plan)
    })));
    return checked.filter(item => item.verification.status === "verified").map(item => ({
      ...item.row,
      path: item.row.path || item.verification.path || "",
      configPath: item.verification.configPath || "",
      verificationMethod: item.verification.method
    }));
  }

  async taskkillProcessTree(pid, force = false) {
    if (process.platform !== "win32") throw new Error("taskkill hanya tersedia di Windows.");
    const args = ["/PID", String(pid), "/T"];
    if (force) args.push("/F");
    try {
      const result = await execFileAsync("taskkill.exe", args, {
        windowsHide: true,
        timeout: 12000,
        maxBuffer: 512 * 1024
      });
      return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    } catch (error) {
      const detail = [error.message, error.stdout, error.stderr].filter(Boolean).join("\n").trim();
      throw new Error(detail.slice(0, 1200) || `taskkill gagal untuk PID ${pid}.`);
    }
  }

  async getVerifiedApacheWindowsService(plan, rootProcesses) {
    for (const processInfo of rootProcesses) {
      const serviceName = String(processInfo.serviceName || "").trim();
      const servicePath = String(processInfo.servicePath || "").trim();
      const serviceExecutable = extractExecutableFromCommandLine(servicePath);
      if (!serviceName || !serviceExecutable) continue;
      if (!(await this.executableBelongsToRoot(plan.root, serviceExecutable))) continue;
      const processExecutable = processInfo.path || extractExecutableFromCommandLine(processInfo.command) || plan.executable;
      if (!sameWindowsPath(serviceExecutable, processExecutable)) continue;
      return { name: serviceName, executable: serviceExecutable, pid: processInfo.pid };
    }
    return null;
  }

  async stopApacheProcessTree(plan, rootProcesses) {
    const verified = rootProcesses.filter(item => Number.isInteger(Number(item.pid)) && Number(item.pid) > 0);
    if (!verified.length) return { detail: "Apache sudah berhenti atau tidak ditemukan di instalasi ini." };

    // Only target process trees rooted in PIDs already verified to be inside the
    // selected Laragon installation. Apache run directly by Laragon is not
    // necessarily installed as a Windows service, so `httpd.exe -k shutdown`
    // would fail with AH00436. `taskkill /T` first requests normal termination;
    // `/F` is a re-verified fallback if the process tree remains alive.
    const verifiedPids = new Set(verified.map(item => Number(item.pid)));
    const roots = verified.filter(item => !verifiedPids.has(Number(item.parentPid)));
    const targets = roots.length ? roots : verified;
    const targetPids = [...new Set(targets.map(item => Number(item.pid)))];
    const initialErrors = [];
    for (const pid of targetPids) {
      try { await this.taskkillProcessTree(pid, false); }
      catch (error) { initialErrors.push(`PID ${pid}: ${error.message}`); }
    }

    await sleep(this.processStopGraceMs ?? 1200);
    let remaining = await this.getRootProcesses(plan);
    let forced = false;
    const forceErrors = [];
    if (remaining.length) {
      // Re-enumerate and re-verify before force termination. getRootProcesses
      // includes only executable identities already verified for this root.
      const remainingPids = new Set(remaining.map(item => Number(item.pid)));
      const remainingRoots = remaining.filter(item => !remainingPids.has(Number(item.parentPid)));
      const forceTargets = remainingRoots.length ? remainingRoots : remaining;
      for (const item of forceTargets) {
        const pid = Number(item.pid);
        if (!Number.isInteger(pid) || pid <= 0) continue;
        try { await this.taskkillProcessTree(pid, true); forced = true; }
        catch (error) { forceErrors.push(`PID ${pid}: ${error.message}`); }
      }
      await sleep(this.processStopForceWaitMs ?? 800);
      remaining = await this.getRootProcesses(plan);
    }

    if (remaining.length) {
      const pids = remaining.map(item => item.pid).join(", ");
      const extra = [...initialErrors, ...forceErrors].join("; ");
      throw new Error(`Apache masih berjalan setelah perintah stop (PID ${pids}). ${extra ? `Detail: ${extra}. ` : ""}Tidak ada proses di luar instalasi Laragon yang dihentikan.`);
    }

    if (forced) {
      const detail = `Apache berhenti; penghentian normal tidak cukup sehingga process tree terverifikasi dihentikan paksa (PID awal ${targetPids.join(", ")}).`;
      await this.addLog("warning", "Apache memerlukan penghentian paksa", detail);
      return { detail };
    }
    return { detail: `Apache berhenti melalui process tree Laragon terverifikasi (PID ${targetPids.join(", ")}).` };
  }

  async stop(plan, options = {}) {
    const rootProcesses = await this.getRootProcesses(plan);
    if (!rootProcesses.length) {
      const names = PROCESS_NAMES[plan.id] || [path.basename(plan.executable).toLowerCase()];
      const [tasklistRows, processRows] = await Promise.all([
        this.adapter.getProcesses(true),
        this.getProcessesByName(names)
      ]);
      const tasklistMatches = tasklistRows.filter(item => names.includes(String(item.name || "").toLowerCase()));
      const candidates = processRows.filter(item => names.includes(String(item.name || "").toLowerCase()));
      if (candidates.length || tasklistMatches.length) {
        const identities = await Promise.all(candidates.map(async record => ({
          record,
          identity: await this.verifyProcessForService(plan.root, plan.id, record, plan)
        })));
        const outside = identities.filter(item => item.identity.status === "external");
        if (outside.length) {
          const examples = outside.slice(0, 3).map(item => `${item.record.name} (PID ${item.record.pid}): ${item.identity.path || item.identity.configPath || "lokasi luar Laragon"}`).join("; ");
          throw new Error(`Proses ${plan.id} terdeteksi di luar instalasi Laragon yang dipilih (${plan.root}). Tidak ada proses yang dihentikan. Bukti jalur/konfigurasi: ${examples}. Periksa Settings > Lokasi Laragon.`);
        }
        const unknown = identities.filter(item => item.identity.status === "unknown");
        const missingFromCim = tasklistMatches.filter(item => !candidates.some(row => row.pid === item.pid));
        if (unknown.length || missingFromCim.length) {
          const details = [
            ...unknown.map(({ record }) => `PID ${record.pid} (parent ${record.parentPid || "?"}; port listen ${(Array.isArray(record.listeningPorts) && record.listeningPorts.length) ? record.listeningPorts.join(",") : "tidak terbaca"})`),
            ...missingFromCim.map(record => `PID ${record.pid} (detail CIM tidak tersedia)`)
          ].join("; ");
          const checks = plan.id === "mysql"
            ? "SXL Cover memeriksa ExecutablePath, CommandLine, ImagePath layanan Windows, --defaults-file, serta kombinasi parent Laragon.exe dan port listen dari my.ini."
            : "SXL Cover memeriksa ExecutablePath, CommandLine dan ImagePath layanan Windows.";
          throw new Error(`Windows mendeteksi proses ${plan.id}, tetapi identitas instalasinya belum dapat dipastikan: ${details}. ${checks} Tidak ada proses yang dihentikan. Periksa detail proses dengan perintah diagnosis PowerShell atau pastikan Laragon dan SXL Cover berjalan dengan akun serta tingkat hak yang sama.`);
        }
        throw new Error(`Proses ${plan.id} terdeteksi, tetapi belum ada proses yang dapat dipastikan berasal dari instalasi Laragon ini. Tidak ada proses yang dihentikan.`);
      }
      return { detail: "Layanan sudah berhenti atau tidak ditemukan di instalasi ini." };
    }

    let stopDetail = "";
    if (plan.id === "apache") {
      // Only use httpd.exe -k shutdown if a matching Windows service is actually
      // registered. For normal Laragon process mode, AH00436 is expected because
      // Apache is not installed as service "Apache2.4"; stop its verified tree.
      const registeredService = await this.getVerifiedApacheWindowsService(plan, rootProcesses);
      if (registeredService) {
        try {
          await this.runCommand(plan.executable, ["-k", "shutdown", "-n", registeredService.name, "-f", plan.config, "-d", plan.versionDir], plan.cwd, 15000);
          await sleep(700);
          const afterServiceStop = await this.getRootProcesses(plan);
          if (afterServiceStop.length) {
            const stillPids = afterServiceStop.map(item => item.pid).join(", ");
            await this.addLog("warning", "Apache service tidak berhenti setelah perintah shutdown", `PID masih terdeteksi: ${stillPids}. Beralih ke process tree Laragon yang sudah diverifikasi.`);
            const fallback = await this.stopApacheProcessTree(plan, afterServiceStop);
            stopDetail = `Apache dihentikan melalui process tree setelah service '${registeredService.name}' tidak berhenti. ${fallback.detail}`;
          } else {
            stopDetail = `Apache berhenti melalui service Windows terverifikasi '${registeredService.name}'.`;
          }
        } catch (error) {
          await this.addLog("warning", "Kontrol Apache sebagai service gagal", `${registeredService.name}: ${error.message}. Beralih ke process tree Laragon yang sudah diverifikasi.`);
          const fallback = await this.stopApacheProcessTree(plan, rootProcesses);
          stopDetail = `Apache dihentikan lewat process tree setelah kontrol service gagal. ${fallback.detail}`;
        }
      } else {
        const fallback = await this.stopApacheProcessTree(plan, rootProcesses);
        stopDetail = fallback.detail;
      }
    } else if (plan.id === "nginx") {
      await this.runCommand(plan.executable, [...plan.args, "-s", "quit"], plan.cwd, 15000);
    } else if (plan.id === "mysql") {
      // Use the my.ini tied to each verified process, not blindly the currently
      // selected version. This matters when Laragon's selected version changed
      // after a service was started or Windows hides ExecutablePath.
      const targets = new Map();
      for (const processInfo of rootProcesses) {
        const configPath = processInfo.configPath || plan.config;
        if (!configPath || !(await this.isRecognizedMysqlConfig(plan.root, configPath))) {
          throw new Error(`MySQL/MariaDB PID ${processInfo.pid} terdeteksi di instalasi Laragon, tetapi my.ini aktifnya belum dapat diverifikasi. Database tidak dihentikan.`);
        }
        targets.set(normalizedPathForCompare(configPath), { processInfo, configPath });
      }
      if (!targets.size) targets.set(normalizedPathForCompare(plan.config), { processInfo: {}, configPath: plan.config });
      for (const { processInfo, configPath } of targets.values()) {
        const processExecutable = processInfo.path || "";
        const configFolder = path.dirname(configPath);
        const admin = await firstFile([
          processExecutable ? path.join(path.dirname(processExecutable), "mysqladmin.exe") : "",
          path.join(configFolder, "bin", "mysqladmin.exe"),
          path.join(configFolder, "mysqladmin.exe"),
          path.join(path.dirname(path.dirname(configFolder)), "bin", "mysqladmin.exe"),
          path.join(path.dirname(plan.executable), "mysqladmin.exe"),
          path.join(path.dirname(path.dirname(plan.executable)), "bin", "mysqladmin.exe"),
          path.join(plan.versionDir, "bin", "mysqladmin.exe"),
          path.join(plan.versionDir, "mysqladmin.exe")
        ]);
        if (!admin) throw new Error(`mysqladmin.exe tidak ditemukan untuk konfigurasi ${path.basename(configPath)}. Database tidak dihentikan secara paksa.`);

        // `undefined` means the UI has not supplied credentials yet and should
        // try the server-configured client defaults / request the user to decide.
        // An explicitly supplied empty string is different: allow a deliberate
        // retry for instances initialized with --initialize-insecure.
        const passwordProvided = typeof options.password === "string";
        if (options.password !== undefined && !passwordProvided) {
          throw new Error("Format password MySQL tidak didukung. Password tidak disimpan.");
        }
        if (passwordProvided && (options.password.length > 1024 || /[\0\r\n\t]/.test(options.password))) {
          throw new Error("Format password MySQL tidak didukung. Password tidak disimpan.");
        }

        if (passwordProvided) {
          // Never place the password in process arguments or application logs. The
          // temporary client option file lives only for the duration of shutdown.
          // On Windows, os.tmpdir() is normally the current user's private Temp folder.
          const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-mysql-stop-"));
          const tempConfig = path.join(tempDir, "client.ini");
          const port = await this.getMysqlPort(configPath);
          try {
            const clientIni = [
              "[client]",
              "user=root",
              `password=${escapeMysqlOptionFileValue(options.password)}`,
              "host=127.0.0.1",
              `port=${port}`,
              "protocol=tcp",
              ""
            ].join("\r\n");
            await fs.writeFile(tempConfig, clientIni, { encoding: "utf8", mode: 0o600, flag: "wx" });
            try {
              await this.runCommand(admin, [`--defaults-file=${tempConfig}`, "--connect-timeout=5", "shutdown"], path.dirname(admin), 15000);
            } catch (error) {
              if (isMysqlAccessDenied(error.message)) {
                const attemptedEmpty = options.password.length === 0;
                throw new Error(attemptedEmpty
                  ? "MySQL/MariaDB menolak autentikasi tanpa password. Log lama yang menyebut root dibuat tanpa password hanya berlaku saat inisialisasi; password akun mungkin sudah berubah. Masukkan password root yang sekarang atau batalkan."
                  : "Password MySQL ditolak oleh server. Password hanya digunakan sementara dan tidak disimpan; periksa password root lalu coba lagi.");
              }
              throw error;
            }
          } finally {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
          }
        } else {
          try {
            await this.runCommand(admin, [`--defaults-file=${configPath}`, "-h", "127.0.0.1", "-u", "root", "shutdown"], path.dirname(admin), 15000);
          } catch (error) {
            if (isMysqlAccessDenied(error.message)) {
              return {
                ok: false,
                requiresPassword: true,
                detail: "MySQL/MariaDB Laragon menolak shutdown tanpa password. Masukkan password root saat ini. Jika kamu yakin akun root masih tanpa password, kamu boleh membiarkan kolom kosong untuk mencoba autentikasi kosong secara eksplisit. Log inisialisasi lama tidak membuktikan password akun masih kosong. Password tidak disimpan dan file opsi sementara dihapus setelah perintah selesai."
              };
            }
            throw error;
          }
        }
      }
    } else if (plan.id === "postgresql") {
      const ctl = plan.executable;
      await this.runCommand(ctl, ["-D", plan.dataDir, "-m", "fast", "-w", "stop"], plan.cwd, 20000);
    } else if (plan.id === "redis") {
      const cli = await firstFile([
        path.join(plan.versionDir, "redis-cli.exe"), path.join(plan.versionDir, "bin", "redis-cli.exe"),
        path.join(path.dirname(plan.executable), "redis-cli.exe")
      ]);
      if (!cli) throw new Error("redis-cli.exe tidak ditemukan. Redis tidak dihentikan secara paksa.");
      let port = "6379";
      if (plan.config) {
        const configText = await fs.readFile(plan.config, "utf8").catch(() => "");
        const m = configText.match(/^\s*port\s+(\d+)/mi); if (m) port = m[1];
        if (/^\s*requirepass\s+\S+/mi.test(configText)) throw new Error("Redis memakai requirepass. Atur autentikasi di UI sebelum menghentikan Redis.");
      }
      await this.runCommand(cli, ["-h", "127.0.0.1", "-p", port, "SHUTDOWN"], plan.cwd, 12000).catch(error => {
        // Redis often closes the socket before redis-cli receives a final response; verify the result below.
        if (!/connection reset|connection closed|could not connect|no route/i.test(error.message)) throw error;
      });
    } else {
      // Stateless helper daemons (Memcached/Mailpit) are safe to stop only by a PID
      // whose executable path is verified to be inside the selected Laragon root.
      for (const processInfo of rootProcesses) {
        try {
          await execFileAsync("taskkill.exe", ["/PID", String(processInfo.pid), "/T", "/F"], { windowsHide: true, timeout: 10000 });
        } catch (error) {
          throw new Error(`Gagal menghentikan PID ${processInfo.pid}: ${error.message}`);
        }
      }
    }

    await sleep(600);
    const stillRunning = await this.getRootProcesses(plan);
    if (stillRunning.length) throw new Error(`Perintah stop selesai tetapi proses masih terdeteksi (PID ${stillRunning.map(p => p.pid).join(", ")}). Periksa log layanan.`);
    this.ownedPids.delete(plan.id);
    return { detail: stopDetail || `${plan.id} stopped.` };
  }

  async startService(serviceId) {
    const plan = await this.resolvePlan(serviceId);
    if (!plan.supported) throw new Error(plan.reason || `Kontrol ${serviceId} belum tersedia.`);
    const running = await this.getRootProcesses(plan);
    if (running.length) return { ok: true, alreadyRunning: true, detail: `${serviceId} sudah berjalan (PID ${running.map(p => p.pid).join(", ")}).` };
    const all = await this.adapter.getProcesses(true);
    const processNames = PROCESS_NAMES[serviceId] || [];
    const conflicting = all.filter(item => processNames.includes(String(item.name || "").toLowerCase()));
    let externalMysqlNote = "";
    if (conflicting.length && serviceId === "mysql") {
      const port = await this.getMysqlPort(plan.config);
      const portState = await this.getListeningPortState(port);
      if (!portState.available) {
        const probeDetail = portState.error ? ` Detail pemeriksaan: ${portState.error}` : "";
        throw new Error(`MySQL/MariaDB dari instalasi lain terdeteksi (PID ${conflicting.map(p => p.pid).join(", ")}). Port Laragon ${port} belum bisa diverifikasi dengan Get-NetTCPConnection maupun netstat; SXL Cover tidak akan menjalankan instance kedua sebelum port dipastikan bebas.${probeDetail}`);
      }
      if (portState.owners.length) {
        const ownerDetails = portState.owners.map(owner => `${owner.name || "proses tidak diketahui"} PID ${owner.pid}${owner.path ? ` (${owner.path})` : ""}`).join("; ");
        throw new Error(`Port ${port} untuk MySQL Laragon sudah dipakai: ${ownerDetails}. Proses MySQL eksternal (PID ${conflicting.map(p => p.pid).join(", ")}) tetap tidak akan dihentikan oleh SXL Cover. Kosongkan port ${port} atau ubah port di my.ini Laragon terlebih dahulu.`);
      }
      const details = conflicting.map(p => `PID ${p.pid}`).join(", ");
      externalMysqlNote = `MySQL eksternal terdeteksi (${details}), tetapi port Laragon ${port} terbukti kosong. SXL Cover menjalankan MySQL Laragon secara terpisah; layanan eksternal tidak diubah.`;
      await this.addLog("warning", "MySQL eksternal tidak menghalangi port Laragon", externalMysqlNote);
    } else if (conflicting.length) {
      throw new Error(`Proses ${serviceId} lain terdeteksi (PID ${conflicting.map(p => p.pid).join(", ")}). Tidak dijalankan untuk menghindari konflik port.`);
    }
    const result = await this.launch(plan);
    const detail = externalMysqlNote ? `${result.detail} ${externalMysqlNote}` : result.detail;
    await this.addLog("success", `Layanan ${serviceId} dimulai dari SXL Cover`, detail);
    return { ok: true, ...result, detail };
  }

  async stopService(serviceId, options = {}) {
    let plan = await this.resolvePlan(serviceId);
    if (!plan.supported) throw new Error(plan.reason || `Kontrol ${serviceId} belum tersedia.`);
    // If a service was started earlier with a different version, derive its version
    // from the verified executable path before constructing the graceful stop command.
    const live = await this.getRootProcesses(plan);
    if (live.length) {
      const toolRoot = path.join(plan.root, "bin", TOOL_FOLDERS[serviceId] || serviceId);
      // When Windows hides mysqld.exe's path, the command line may still expose
      // the exact my.ini used by that instance. Prefer that config for graceful
      // shutdown and switch to its installed version where it can be identified.
      const activeConfig = serviceId === "mysql" ? live.find(item => item.configPath)?.configPath : "";
      if (activeConfig) {
        const available = await this.listVersionFolders(plan.root, serviceId);
        if (pathIsWithin(toolRoot, activeConfig)) {
          const relConfig = await this.relativePathForVerifiedRoot(toolRoot, activeConfig);
          const versionFolder = relConfig.split(/[\\/]/)[0];
          if (available.includes(versionFolder)) {
            const activePlan = await this.resolvePlan(serviceId, versionFolder);
            if (activePlan.supported) plan = activePlan;
          }
        }
        plan = { ...plan, config: activeConfig };
      } else {
        for (const processInfo of live) {
          if (!processInfo.path) continue;
          const rel = await this.relativePathForVerifiedRoot(toolRoot, processInfo.path);
          const versionFolder = rel.split(/[\\/]/)[0];
          const available = await this.listVersionFolders(plan.root, serviceId);
          if (available.includes(versionFolder) && versionFolder !== plan.selectedVersion) {
            const activePlan = await this.resolvePlan(serviceId, versionFolder);
            if (activePlan.supported) { plan = activePlan; break; }
          }
        }
      }
    }
    const result = await this.stop(plan, options);
    if (result?.requiresPassword) {
      await this.addLog("warning", `Autentikasi dibutuhkan untuk menghentikan ${serviceId}`, "Shutdown tanpa kredensial ditolak oleh MySQL/MariaDB. Password tidak disimpan.");
      return result;
    }
    if (result?.ok === false) return result;
    await this.addLog("success", `Layanan ${serviceId} berhenti dari SXL Cover`, result.detail);
    return { ok: true, ...result };
  }

  async restartService(serviceId, options = {}) {
    if (!CONTROLLABLE.has(serviceId)) throw new Error(`Layanan ${serviceId} belum didukung.`);
    const stopped = await this.stopService(serviceId, options);
    if (stopped?.requiresPassword || stopped?.ok === false) return stopped;
    await sleep(900);
    const result = await this.startService(serviceId);
    await this.addLog("success", `Layanan ${serviceId} di-restart dari SXL Cover`, result.detail || "Restart dikonfirmasi.");
    return { ok: true, ...result };
  }

  async startStack() {
    const root = await this.adapter.getRoot();
    if (!root) throw new Error("Folder instalasi Laragon belum diatur.");
    const settings = this.adapter.store.getSettings();
    const webServer = settings.preferredWebServer === "nginx" ? "nginx" : "apache";
    const candidates = ["mysql", webServer];
    const results = [];
    for (const id of candidates) {
      const plan = await this.resolvePlan(id);
      if (!plan.found) { results.push({ id, ok: true, skipped: true, detail: "Tidak terpasang; dilewati." }); continue; }
      if (!plan.supported) { results.push({ id, ok: false, detail: plan.reason || "Tidak tersedia" }); continue; }
      try { results.push({ id, ok: true, ...(await this.startService(id)) }); }
      catch (error) { results.push({ id, ok: false, detail: error.message }); }
    }
    const failed = results.filter(result => !result.ok);
    await this.addLog(failed.length ? "warning" : "success", "Start Stack selesai", results.map(item => `${item.id}: ${item.ok ? "OK" : item.detail}`).join("\n"));
    return { ok: failed.length === 0, results };
  }

  async stopStack(options = {}) {
    const root = await this.adapter.getRoot();
    if (!root) throw new Error("Folder instalasi Laragon belum diatur.");
    const settings = this.adapter.store.getSettings();
    const webServer = settings.preferredWebServer === "nginx" ? "nginx" : "apache";
    const results = [];
    for (const id of [webServer, "mysql"]) {
      const plan = await this.resolvePlan(id);
      if (!plan.found) { results.push({ id, ok: true, skipped: true, detail: "Tidak terpasang; dilewati." }); continue; }
      if (!plan.supported) { results.push({ id, ok: false, detail: plan.reason || "Tidak tersedia" }); continue; }
      try {
        const stopOptions = id === "mysql" && typeof options.mysqlPassword === "string" ? { password: options.mysqlPassword } : {};
        const stopped = await this.stopService(id, stopOptions);
        results.push({ id, ok: stopped?.ok !== false, ...stopped });
      } catch (error) { results.push({ id, ok: false, detail: error.message }); }
    }
    const failed = results.filter(result => !result.ok);
    await this.addLog(failed.length ? "warning" : "success", "Stop Stack selesai", results.map(item => `${item.id}: ${item.ok ? "OK" : item.detail}`).join("\n"));
    return { ok: failed.length === 0, results };
  }

  async getServiceCapabilities(root) {
    const result = {};
    for (const id of CONTROLLABLE) {
      const plan = await this.resolvePlan(id).catch(error => ({ supported: false, reason: error.message }));
      result[id] = { startSupported: Boolean(plan.supported), stopSupported: Boolean(plan.supported), reason: plan.reason || "", selectedVersion: plan.selectedVersion || "", executable: plan.executable || "" };
    }
    return result;
  }

  async selectRuntime(tool, version) {
    const root = await this.adapter.getRoot();
    if (!root) throw new Error("Folder instalasi Laragon belum diatur.");
    if (!new Set(["php", "apache", "nginx", "mysql", "postgresql", "redis", "memcached", "mailpit", "node"]).has(tool)) throw new Error("Runtime tidak dikenal.");
    const folders = await this.listVersionFolders(root, tool);
    if (!folders.includes(version)) throw new Error("Versi tidak ditemukan di folder bin Laragon.");
    await this.adapter.store.setSelectedVersion(tool, version);
    await this.addLog("success", `Runtime ${tool} dipilih`, version);
    return { ok: true, tool, version };
  }

  async runProjectTask(directory, taskId) {
    const root = await this.adapter.getRoot();
    if (!root) throw new Error("Folder instalasi Laragon belum diatur.");
    const safeDir = path.resolve(directory || "");
    const known = await this.adapter.isKnownProjectPath(safeDir);
    if (!pathIsWithin(root, safeDir) && !known) throw new Error("Tugas hanya dapat dijalankan pada proyek yang dikenal di workspace.");
    const stat = await fs.stat(safeDir).catch(() => null);
    if (!stat?.isDirectory()) throw new Error("Folder proyek tidak ditemukan.");

    const taskMap = {
      "composer-install": { command: "composer install", file: "composer.json", label: "Composer install", needsComposer: true },
      "composer-update": { command: "composer update", file: "composer.json", label: "Composer update", needsComposer: true },
      "npm-install": { command: "npm install", file: "package.json", label: "npm install", needsNode: true },
      "npm-dev": { command: "npm run dev", file: "package.json", script: "dev", label: "npm run dev", needsNode: true },
      "npm-build": { command: "npm run build", file: "package.json", script: "build", label: "npm run build", needsNode: true },
      "artisan-serve": { command: "php artisan serve --host=127.0.0.1", file: "artisan", label: "Laravel serve", needsPhp: true },
      "artisan-optimize-clear": { command: "php artisan optimize:clear", file: "artisan", label: "Laravel optimize:clear", needsPhp: true },
      "php-server": { command: "php -S 127.0.0.1:8080", file: "index.php", label: "PHP built-in server", needsPhp: true }
    };
    const task = taskMap[String(taskId)];
    if (!task) throw new Error("Tugas proyek tidak diizinkan.");
    const markerPath = path.join(safeDir, task.file);
    if (!(await isFile(markerPath))) throw new Error(`Tugas ${task.label} memerlukan file ${task.file}.`);
    if (task.script) {
      const packageJson = JSON.parse(await fs.readFile(path.join(safeDir, "package.json"), "utf8"));
      if (!packageJson.scripts || typeof packageJson.scripts[task.script] !== "string") throw new Error(`Script '${task.script}' tidak ada di package.json proyek ini.`);
    }

    const versions = await this.getVersionCatalog(root);
    const phpVersion = await this.getSelectedVersion(root, "php", versions.php || []);
    const nodeVersion = await this.getSelectedVersion(root, "node", versions.node || []);
    const phpPath = phpVersion ? path.join(root, "bin", "php", phpVersion) : "";
    const nodePath = nodeVersion ? path.join(root, "bin", "nodejs", nodeVersion) : "";
    if (task.needsPhp && (!phpPath || !(await isFile(path.join(phpPath, "php.exe"))))) throw new Error("php.exe tidak ditemukan pada versi PHP yang dipilih di Pengaturan > Integrasi Laragon.");
    if (task.needsNode && (!nodePath || !(await isFile(path.join(nodePath, "node.exe"))))) throw new Error("node.exe tidak ditemukan pada versi Node.js yang dipilih.");
    if (["npm-install", "npm-dev", "npm-build"].includes(taskId) && !(await firstFile([path.join(nodePath, "npm.cmd"), path.join(nodePath, "npm.ps1")]))) {
      throw new Error("npm tidak ditemukan di folder Node.js yang dipilih.");
    }
    const composerDir = path.join(root, "bin", "composer");
    const composerEntry = task.needsComposer ? await firstFile([
      path.join(composerDir, "composer.bat"), path.join(composerDir, "composer.cmd"),
      path.join(composerDir, "composer.exe"), path.join(composerDir, "composer.phar")
    ]) : "";
    if (task.needsComposer && !composerEntry) throw new Error("Composer tidak ditemukan di bin\\composer. Buka terminal proyek untuk mengonfigurasi Composer.");
    if (task.needsComposer && composerEntry.toLowerCase().endsWith(".phar")) {
      const composerAction = taskId === "composer-update" ? "update" : "install";
      task.command = `php ${psQuote(composerEntry)} ${composerAction}`;
    }
    if (taskId === "php-server" && (await isFile(path.join(safeDir, "public", "index.php")))) {
      task.command = "php -S 127.0.0.1:8080 -t public";
    }

    if (process.platform !== "win32") throw new Error("Jalankan tugas proyek saat ini hanya didukung di Windows.");
    const pathList = [phpPath, nodePath, composerDir, path.join(root, "bin", "git"), process.env.PATH || ""].filter(Boolean);
    const envCommands = [
      `$env:LARAGON_ROOT=${psQuote(root)}`,
      `$env:DOCUMENT_ROOT=${psQuote(path.join(root, "www"))}`,
      `$env:PATH=${psQuote(pathList.join(path.delimiter))}`,
      `Set-Location -LiteralPath ${psQuote(safeDir)}`,
      `Write-Host ${psQuote(`SXL Cover · ${task.label}`)} -ForegroundColor Cyan`,
      task.command
    ].join("; ");
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", envCommands], {
      cwd: safeDir, detached: true, windowsHide: false, stdio: "ignore"
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    }).catch(error => { throw new Error(`Tidak dapat membuka terminal untuk ${task.label}: ${error.message}`); });
    child.unref();
    await this.addLog("info", `Tugas proyek dijalankan: ${task.label}`, safeDir);
    return { ok: true, label: task.label, directory: safeDir };
  }

  async openTerminal(directory, allowExternalProject = false) {
    const root = await this.adapter.getRoot();
    if (!root) throw new Error("Folder instalasi Laragon belum diatur.");
    const safeDir = path.resolve(directory || path.join(root, "www"));
    if (!pathIsWithin(root, safeDir) && !allowExternalProject && !(await this.adapter.isKnownProjectPath(safeDir))) {
      throw new Error("Terminal hanya dapat dibuka pada root Laragon atau folder proyek yang terdaftar.");
    }
    if (process.platform !== "win32") throw new Error("Terminal environment saat ini hanya didukung di Windows.");
    const phpVersions = await this.listVersionFolders(root, "php");
    const selectedPhp = await this.getSelectedVersion(root, "php", phpVersions);
    const phpPath = selectedPhp ? path.join(root, "bin", "php", selectedPhp) : "";
    const nodeVersions = await this.listVersionFolders(root, "node");
    const selectedNode = await this.getSelectedVersion(root, "node", nodeVersions);
    const nodePath = selectedNode ? path.join(root, "bin", "nodejs", selectedNode) : "";
    const pathList = [phpPath, nodePath, path.join(root, "bin", "composer"), path.join(root, "bin", "git"), process.env.PATH || ""].filter(Boolean);
    const args = ["-NoExit", "-ExecutionPolicy", "Bypass", "-Command", `Set-Location -LiteralPath ${psQuote(safeDir)}; $env:LARAGON_ROOT=${psQuote(root)}; $env:DOCUMENT_ROOT=${psQuote(path.join(root, "www"))}; $env:PATH=${psQuote(pathList.join(path.delimiter))}; Write-Host 'SXL Cover terminal' -ForegroundColor Cyan`];
    const child = spawn("powershell.exe", args, { cwd: safeDir, detached: true, windowsHide: false, stdio: "ignore" });
    child.once("error", error => this.addLog("error", "Terminal gagal dibuka", error.message).catch(() => {}));
    child.unref();
    await this.addLog("info", "Terminal dibuka dari SXL Cover", safeDir);
    return true;
  }
}

module.exports = { ServiceController, CONTROLLABLE, parseIni, pathIsWithin, relativePath, cleanProcessPath, extractOptionPath, extractExecutableFromCommandLine, sameWindowsPath, normalizePortProbeResult, buildListeningPortProbeScript };
