const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { parseIni, pathIsWithin, ServiceController, extractOptionPath, extractExecutableFromCommandLine, normalizePortProbeResult, buildListeningPortProbeScript } = require("../src/services/service-controller");

test("Laragon INI parser reads sections and key values case-insensitively", () => {
  const parsed = parseIni("; comment\n[PHP]\nVersion=php-8.1.10\n[mysql]\nDataDir= C:\\laragon\\data\\mysql ");
  assert.equal(parsed.php.version, "php-8.1.10");
  assert.equal(parsed.mysql.datadir, "C:\\laragon\\data\\mysql");
});

test("path containment allows root and descendants but rejects siblings", () => {
  const root = path.resolve("/tmp/laragon-root");
  assert.equal(pathIsWithin(root, root), true);
  assert.equal(pathIsWithin(root, path.join(root, "www", "app")), true);
  assert.equal(pathIsWithin(root, path.resolve("/tmp/laragon-root-evil")), false);
});

test("Apache plan resolves an installed version and its conf file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-laragon-apache-"));
  try {
    const version = "httpd-2.4.54-win64-VS16";
    const versionRoot = path.join(root, "bin", "apache", version);
    await fs.mkdir(path.join(versionRoot, "bin"), { recursive: true });
    await fs.mkdir(path.join(versionRoot, "conf"), { recursive: true });
    await fs.mkdir(path.join(root, "usr"), { recursive: true });
    await fs.writeFile(path.join(versionRoot, "bin", "httpd.exe"), "test-binary");
    await fs.writeFile(path.join(versionRoot, "conf", "httpd.conf"), "ServerRoot .");
    await fs.writeFile(path.join(root, "usr", "laragon.ini"), `[apache]\nVersion=${version}\n`);
    const adapter = { getRoot: async () => root, store: { getSettings: () => ({ selectedVersions: {} }) } };
    const controller = new ServiceController(adapter, async () => {});
    const plan = await controller.resolvePlan("apache");
    assert.equal(plan.found, true);
    assert.equal(plan.supported, true);
    assert.equal(plan.selectedVersion, version);
    assert.equal(plan.config, path.join(versionRoot, "conf", "httpd.conf"));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("MySQL direct start is disabled when my.ini is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-laragon-mysql-"));
  try {
    const version = "mysql-8.0.30-winx64";
    const versionRoot = path.join(root, "bin", "mysql", version);
    await fs.mkdir(path.join(versionRoot, "bin"), { recursive: true });
    await fs.mkdir(path.join(root, "usr"), { recursive: true });
    await fs.writeFile(path.join(versionRoot, "bin", "mysqld.exe"), "test-binary");
    const adapter = { getRoot: async () => root, store: { getSettings: () => ({ selectedVersions: { mysql: version } }) } };
    const controller = new ServiceController(adapter, async () => {});
    const plan = await controller.resolvePlan("mysql");
    assert.equal(plan.found, true);
    assert.equal(plan.supported, false);
    assert.match(plan.reason, /my\.ini/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("Windows executable paths are compared case-insensitively", () => {
  assert.equal(pathIsWithin("C:\\Laragon", "c:\\LARAGON\\bin\\apache\\httpd.exe"), true);
  assert.equal(pathIsWithin("C:\\Laragon", "C:\\Laragon-Other\\bin\\httpd.exe"), false);
});

test("extended-length Windows executable paths are normalized before verification", () => {
  assert.equal(pathIsWithin("C:\\laragon", "\\\\?\\C:\\laragon\\bin\\mysql\\mysqld.exe"), true);
  assert.equal(pathIsWithin("\\\\?\\C:\\laragon", "C:\\laragon\\bin\\apache\\httpd.exe"), true);
});

test("relative Windows executable path keeps the active Laragon version folder", () => {
  const { relativePath } = require("../src/services/service-controller");
  assert.equal(
    relativePath("C:\\laragon\\bin\\apache", "\\\\?\\C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16\\bin\\httpd.exe"),
    "httpd-2.4.54-win64-VS16\\bin\\httpd.exe"
  );
});

test("stop refuses a same-named process outside the selected Laragon root with a useful message", async () => {
  const adapter = {
    getProcesses: async () => [{ name: "httpd.exe", pid: 9090 }]
  };
  const controller = new ServiceController(adapter, async () => {});
  controller.getProcessesByName = async () => [{
    name: "httpd.exe", pid: 9090,
    path: "D:\\OtherLaragon\\bin\\apache\\httpd-2.4\\bin\\httpd.exe"
  }];
  controller.runCommand = async () => { throw new Error("Must not stop another install"); };
  await assert.rejects(
    controller.stop({
      id: "apache", root: "C:\\laragon",
      executable: "C:\\laragon\\bin\\apache\\httpd-2.4\\bin\\httpd.exe",
      config: "C:\\laragon\\bin\\apache\\httpd-2.4\\conf\\httpd.conf",
      versionDir: "C:\\laragon\\bin\\apache\\httpd-2.4",
      cwd: "C:\\laragon\\bin\\apache\\httpd-2.4"
    }),
    /terdeteksi di luar instalasi Laragon yang dipilih.*D:\\OtherLaragon/i
  );
});


test('project task runner rejects arbitrary command text before launching a process', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sinz-task-allowlist-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const projectDir = path.join(root, 'www', 'demo');
  await fs.mkdir(projectDir, { recursive: true });
  const adapter = {
    getRoot: async () => root,
    isKnownProjectPath: async candidate => pathIsWithin(root, candidate),
    store: { getSettings: () => ({ selectedVersions: {} }) }
  };
  const controller = new ServiceController(adapter, async () => {});
  await assert.rejects(
    controller.runProjectTask(projectDir, 'npm install; Start-Sleep 30'),
    /Tugas proyek tidak diizinkan/
  );
});

test('project task runner refuses to run a task from an unregistered external folder', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sinz-task-root-'));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'sinz-task-external-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(external, { recursive: true, force: true }); });
  const adapter = { getRoot: async () => root, isKnownProjectPath: async () => false, store: { getSettings: () => ({ selectedVersions: {} }) } };
  const controller = new ServiceController(adapter, async () => {});
  await assert.rejects(controller.runProjectTask(external, 'composer-install'), /proyek yang dikenal/);
});


test("MySQL defaults-file option parser supports quoted paths with spaces", () => {
  assert.equal(
    extractOptionPath('mysqld.exe --defaults-file="C:\\Laragon Folder\\bin\\mysql\\mysql-8.0\\my.ini"', "--defaults-file"),
    "C:\\Laragon Folder\\bin\\mysql\\mysql-8.0\\my.ini"
  );
  assert.equal(
    extractOptionPath('mysqld.exe "--defaults-file=C:\\Laragon Folder\\bin\\mysql\\mysql-8.0\\my.ini"', "--defaults-file"),
    "C:\\Laragon Folder\\bin\\mysql\\mysql-8.0\\my.ini"
  );
});

test("Windows service command parsing extracts the registered executable", () => {
  assert.equal(
    extractExecutableFromCommandLine('"C:\\Laragon\\bin\\mysql\\mysqld.exe" --defaults-file=C:\\Laragon\\my.ini'),
    "C:\\Laragon\\bin\\mysql\\mysqld.exe"
  );
  assert.equal(extractExecutableFromCommandLine(""), "");
});

test("MySQL process with hidden executable path is verified by its Laragon defaults file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-mysql-config-identity-"));
  try {
    const versionDir = path.join(root, "bin", "mysql", "mysql-8.0.36");
    const config = path.join(versionDir, "my.ini");
    await fs.mkdir(versionDir, { recursive: true });
    await fs.writeFile(config, "[mysqld]\ndatadir=../../../../data/mysql\nport=3306\n");
    const adapter = { getRoot: async () => root, store: { getSettings: () => ({ selectedVersions: {} }) } };
    const controller = new ServiceController(adapter, async () => {});
    controller.getProcessesByName = async () => [{
      name: "mysqld.exe", pid: 4760, path: "", command: `mysqld.exe --defaults-file="${config}"`
    }];
    const processes = await controller.getRootProcesses({ id: "mysql", root, executable: path.join(versionDir, "mysqld.exe") });
    assert.equal(processes.length, 1);
    assert.equal(processes[0].pid, 4760);
    assert.equal(processes[0].verificationMethod, "mysql-defaults-file");
    assert.equal(processes[0].configPath, config);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("MySQL config fallback refuses config files outside Laragon or unknown ini locations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-mysql-config-reject-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-mysql-external-"));
  try {
    const versionDir = path.join(root, "bin", "mysql", "mysql-8.0.36");
    await fs.mkdir(versionDir, { recursive: true });
    const outsideConfig = path.join(outside, "my.ini");
    await fs.writeFile(outsideConfig, "[mysqld]\nport=3306\n");
    const adapter = { getRoot: async () => root, store: { getSettings: () => ({ selectedVersions: {} }) } };
    const controller = new ServiceController(adapter, async () => {});
    assert.equal(await controller.isRecognizedMysqlConfig(root, outsideConfig), false);
    const arbitrary = path.join(root, "www", "demo", "my.ini");
    await fs.mkdir(path.dirname(arbitrary), { recursive: true });
    await fs.writeFile(arbitrary, "[mysqld]\nport=3306\n");
    assert.equal(await controller.isRecognizedMysqlConfig(root, arbitrary), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});


test("MySQL stop uses the verified active defaults-file when executable path is hidden", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-mysql-stop-fallback-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const version = "mysql-8.0.36";
  const versionDir = path.join(root, "bin", "mysql", version);
  const config = path.join(versionDir, "my.ini");
  await fs.mkdir(versionDir, { recursive: true });
  await fs.writeFile(path.join(versionDir, "mysqld.exe"), "test binary placeholder");
  await fs.writeFile(path.join(versionDir, "mysqladmin.exe"), "test binary placeholder");
  await fs.writeFile(config, "[mysqld]\ndatadir=C:\\laragon\\data\\mysql\nport=3306\n");
  const adapter = {
    getRoot: async () => root,
    getProcesses: async () => [{ name: "mysqld.exe", pid: 4760 }],
    store: { getSettings: () => ({ selectedVersions: { mysql: version } }) }
  };
  const controller = new ServiceController(adapter, async () => {});
  let running = true;
  const calls = [];
  controller.getProcessesByName = async () => running ? [{
    name: "mysqld.exe", pid: 4760, path: "", command: `mysqld.exe --defaults-file="${config}"`
  }] : [];
  controller.runCommand = async (executable, args) => {
    calls.push({ executable, args });
    running = false;
    return "Shutdown complete";
  };
  const result = await controller.stopService("mysql");
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(path.basename(calls[0].executable).toLowerCase(), "mysqladmin.exe");
  assert.ok(calls[0].args.some(arg => arg === `--defaults-file=${config}`));
});

test("MySQL stop asks for credentials instead of treating access-denied as a generic service failure", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-mysql-password-required-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const version = "mysql-8.0.36";
  const versionDir = path.join(root, "bin", "mysql", version);
  const config = path.join(versionDir, "my.ini");
  await fs.mkdir(versionDir, { recursive: true });
  await fs.writeFile(path.join(versionDir, "mysqld.exe"), "test binary placeholder");
  await fs.writeFile(path.join(versionDir, "mysqladmin.exe"), "test binary placeholder");
  await fs.writeFile(config, "[client]\nuser=root\n[mysqld]\ndatadir=C:\\laragon\\data\\mysql\nport=3306\n");
  const logs = [];
  const adapter = {
    getRoot: async () => root,
    getProcesses: async () => [{ name: "mysqld.exe", pid: 4760 }],
    store: { getSettings: () => ({ selectedVersions: { mysql: version } }) }
  };
  const controller = new ServiceController(adapter, async (...args) => logs.push(args));
  controller.getProcessesByName = async () => [{
    name: "mysqld.exe", pid: 4760, path: path.join(versionDir, "mysqld.exe"), command: `"${path.join(versionDir, "mysqld.exe")}" --defaults-file="${config}"`, listeningPorts: [3306]
  }];
  controller.runCommand = async () => {
    throw new Error("Command failed: mysqladmin.exe Access denied for user 'root'@'localhost' (using password: NO)");
  };
  const result = await controller.stopService("mysql");
  assert.equal(result.ok, false);
  assert.equal(result.requiresPassword, true);
  assert.match(result.detail, /password.*root/i);
  assert.ok(logs.some(item => /Autentikasi dibutuhkan/.test(item[1])));
  assert.equal(logs.some(item => item.join(" ").includes("using password: NO")), false);
});

test("MySQL shutdown uses a temporary credential file, never puts the password in args, and deletes the file", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-mysql-password-shutdown-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const version = "mysql-8.0.36";
  const versionDir = path.join(root, "bin", "mysql", version);
  const config = path.join(versionDir, "my.ini");
  await fs.mkdir(versionDir, { recursive: true });
  await fs.writeFile(path.join(versionDir, "mysqld.exe"), "test binary placeholder");
  await fs.writeFile(path.join(versionDir, "mysqladmin.exe"), "test binary placeholder");
  await fs.writeFile(config, "[mysqld]\ndatadir=C:\\laragon\\data\\mysql\nport=3306\n");
  const adapter = {
    getRoot: async () => root,
    getProcesses: async () => [{ name: "mysqld.exe", pid: 4760 }],
    store: { getSettings: () => ({ selectedVersions: { mysql: version } }) }
  };
  const controller = new ServiceController(adapter, async () => {});
  let running = true;
  let tempConfigPath = "";
  const password = 'my\\secret"with-symbols!';
  controller.getProcessesByName = async () => running ? [{
    name: "mysqld.exe", pid: 4760, path: path.join(versionDir, "mysqld.exe"), command: `"${path.join(versionDir, "mysqld.exe")}" --defaults-file="${config}"`, listeningPorts: [3306]
  }] : [];
  controller.runCommand = async (_executable, args) => {
    assert.ok(args[0].startsWith("--defaults-file="));
    assert.equal(args.some(arg => arg.includes(password)), false, "secret must not appear in process arguments");
    tempConfigPath = args[0].slice("--defaults-file=".length);
    const credentialFile = await fs.readFile(tempConfigPath, "utf8");
    assert.match(credentialFile, /^\[client\]/);
    assert.match(credentialFile, /user=root/);
    assert.match(credentialFile, /port=3306/);
    assert.match(credentialFile, /password="my\\\\secret\\"with-symbols!"/);
    running = false;
    return "Shutdown complete";
  };
  const result = await controller.stopService("mysql", { password });
  assert.equal(result.ok, true);
  await assert.rejects(fs.stat(tempConfigPath), { code: "ENOENT" });
});

test("MySQL shutdown accepts an explicitly empty password in a temporary option file", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-mysql-empty-password-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const version = "mysql-8.0.36";
  const versionDir = path.join(root, "bin", "mysql", version);
  const config = path.join(versionDir, "my.ini");
  await fs.mkdir(versionDir, { recursive: true });
  await fs.writeFile(path.join(versionDir, "mysqld.exe"), "test binary placeholder");
  await fs.writeFile(path.join(versionDir, "mysqladmin.exe"), "test binary placeholder");
  await fs.writeFile(config, "[mysqld]\ndatadir=C:\\laragon\\data\\mysql\nport=3306\n");
  const adapter = {
    getRoot: async () => root,
    getProcesses: async () => [{ name: "mysqld.exe", pid: 4760 }],
    store: { getSettings: () => ({ selectedVersions: { mysql: version } }) }
  };
  const controller = new ServiceController(adapter, async () => {});
  let running = true;
  let tempConfigPath = "";
  controller.getProcessesByName = async () => running ? [{
    name: "mysqld.exe", pid: 4760, path: path.join(versionDir, "mysqld.exe"), command: `"${path.join(versionDir, "mysqld.exe")}" --defaults-file="${config}"`, listeningPorts: [3306]
  }] : [];
  controller.runCommand = async (_executable, args) => {
    assert.ok(args[0].startsWith("--defaults-file="));
    tempConfigPath = args[0].slice("--defaults-file=".length);
    const credentialFile = await fs.readFile(tempConfigPath, "utf8");
    assert.match(credentialFile, /^\[client\]/);
    assert.match(credentialFile, /user=root/);
    assert.match(credentialFile, /password=""/);
    running = false;
    return "Shutdown complete";
  };
  const result = await controller.stopService("mysql", { password: "" });
  assert.equal(result.ok, true);
  await assert.rejects(fs.stat(tempConfigPath), { code: "ENOENT" });
});

test("MySQL shutdown removes temporary credential file and returns a safe message when password is wrong", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-mysql-password-rejected-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const version = "mysql-8.0.36";
  const versionDir = path.join(root, "bin", "mysql", version);
  const config = path.join(versionDir, "my.ini");
  await fs.mkdir(versionDir, { recursive: true });
  await fs.writeFile(path.join(versionDir, "mysqld.exe"), "test binary placeholder");
  await fs.writeFile(path.join(versionDir, "mysqladmin.exe"), "test binary placeholder");
  await fs.writeFile(config, "[mysqld]\ndatadir=C:\\laragon\\data\\mysql\nport=3306\n");
  const adapter = {
    getRoot: async () => root,
    getProcesses: async () => [{ name: "mysqld.exe", pid: 4760 }],
    store: { getSettings: () => ({ selectedVersions: { mysql: version } }) }
  };
  const controller = new ServiceController(adapter, async () => {});
  let tempConfigPath = "";
  controller.getProcessesByName = async () => [{
    name: "mysqld.exe", pid: 4760, path: path.join(versionDir, "mysqld.exe"), command: `"${path.join(versionDir, "mysqld.exe")}" --defaults-file="${config}"`, listeningPorts: [3306]
  }];
  controller.runCommand = async (_executable, args) => {
    tempConfigPath = args[0].slice("--defaults-file=".length);
    assert.ok(await fs.readFile(tempConfigPath, "utf8"));
    throw new Error("Command failed: mysqladmin.exe Access denied for user 'root'@'localhost' (using password: YES)");
  };
  const password = "do-not-log-this-password";
  await assert.rejects(controller.stopService("mysql", { password }), error => {
    assert.match(error.message, /Password MySQL ditolak/i);
    assert.equal(error.message.includes(password), false);
    return true;
  });
  await assert.rejects(fs.stat(tempConfigPath), { code: "ENOENT" });
});

test("hidden executable path falls back to the full executable path in the process command line", async () => {
  const controller = new ServiceController({ getRoot: async () => "C:\\laragon" }, async () => {});
  const record = {
    name: "httpd.exe", pid: 9304, path: "",
    command: '"C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16\\bin\\httpd.exe" -d C:/laragon/bin/apache/httpd-2.4.54-win64-VS16',
    servicePath: ""
  };
  const result = await controller.verifyProcessForService("C:\\laragon", "apache", record);
  assert.equal(result.status, "verified");
  assert.equal(result.method, "command-line-executable");
  assert.equal(result.path, "C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16\\bin\\httpd.exe");
});

test("hidden MySQL process path can be verified only when Laragon parent and configured listening port both match", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-mysql-parent-port-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const versionDir = path.join(root, "bin", "mysql", "mysql-8.0.36");
  const config = path.join(versionDir, "my.ini");
  await fs.mkdir(versionDir, { recursive: true });
  await fs.writeFile(config, "[mysqld]\nport=3307\ndatadir=../../../../data/mysql\n");
  await fs.writeFile(path.join(root, "laragon.exe"), "test launcher marker");
  const adapter = { getRoot: async () => root, store: { getSettings: () => ({ selectedVersions: { mysql: "mysql-8.0.36" } }) } };
  const controller = new ServiceController(adapter, async () => {});
  const plan = { id: "mysql", root, config, versionDir, executable: path.join(versionDir, "bin", "mysqld.exe") };
  const record = {
    name: "mysqld.exe", pid: 4760, path: "", command: "mysqld.exe", servicePath: "",
    ancestors: [{ name: "laragon.exe", pid: 1010, path: path.join(root, "laragon.exe"), command: "" }],
    listeningPorts: [3307]
  };
  const match = await controller.verifyProcessForService(root, "mysql", record, plan);
  assert.equal(match.status, "verified");
  assert.equal(match.method, "laragon-ancestor-and-port");
  assert.equal(match.configPath, config);

  const wrongPort = await controller.verifyProcessForService(root, "mysql", { ...record, listeningPorts: [3306] }, plan);
  assert.equal(wrongPort.status, "unknown");
});

test("MySQL parent lineage alone is not sufficient without the configured listening port", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-mysql-parent-only-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const versionDir = path.join(root, "bin", "mysql", "mysql-8.0.36");
  const config = path.join(versionDir, "my.ini");
  await fs.mkdir(versionDir, { recursive: true });
  await fs.writeFile(config, "[mysqld]\nport=3307\n");
  await fs.writeFile(path.join(root, "laragon.exe"), "test launcher marker");
  const controller = new ServiceController({ getRoot: async () => root, store: { getSettings: () => ({ selectedVersions: {} }) } }, async () => {});
  const result = await controller.verifyProcessForService(root, "mysql", {
    name: "mysqld.exe", pid: 5580, path: "", command: "mysqld.exe", servicePath: "",
    ancestors: [{ name: "laragon.exe", pid: 1010, path: path.join(root, "laragon.exe"), command: "" }],
    listeningPorts: [3306]
  }, { id: "mysql", root, config, versionDir, executable: path.join(versionDir, "bin", "mysqld.exe") });
  assert.equal(result.status, "unknown");
});

test('Laragon MySQL can start beside an external MySQL service when its own configured port is verified free', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sinz-mysql-external-different-port-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const version = 'mysql-8.0.30-winx64';
  const versionDir = path.join(root, 'bin', 'mysql', version);
  await fs.mkdir(path.join(versionDir, 'bin'), { recursive: true });
  await fs.writeFile(path.join(versionDir, 'bin', 'mysqld.exe'), 'test binary placeholder');
  const config = path.join(versionDir, 'my.ini');
  await fs.writeFile(config, '[mysqld]\nport=3306\ndatadir=C:/laragon/data/mysql-8\n');
  const logs = [];
  const adapter = {
    getRoot: async () => root,
    getProcesses: async () => [{ name: 'mysqld.exe', pid: 4760 }, { name: 'mysqld.exe', pid: 5580 }],
    store: { getSettings: () => ({ selectedVersions: { mysql: version } }) }
  };
  const controller = new ServiceController(adapter, async (...args) => logs.push(args));
  controller.getProcessesByName = async () => [
    { name: 'mysqld.exe', pid: 4760, path: 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe', command: '"C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe" --defaults-file="C:\\ProgramData\\MySQL\\MySQL Server 8.0\\my.ini" MySQL80', listeningPorts: [] },
    { name: 'mysqld.exe', pid: 5580, parentPid: 4760, path: 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe', command: '"C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe" "--defaults-file=C:\\ProgramData\\MySQL\\MySQL Server 8.0\\my.ini" MySQL80', listeningPorts: [3307, 33060] }
  ];
  controller.getListeningPortState = async port => ({ available: true, port, owners: [] });
  let launchedPlan = null;
  controller.launch = async plan => { launchedPlan = plan; return { pid: 9901, detail: 'Started mysqld.exe using mysql-8.0.30-winx64.' }; };
  const result = await controller.startService('mysql');
  assert.equal(result.ok, true);
  assert.equal(launchedPlan.config, config);
  assert.ok(logs.some(entry => entry[0] === 'warning' && /port Laragon 3306 terbukti kosong/.test(entry[2])));
});

test('Laragon MySQL start is blocked when its configured port is occupied even if a separate MySQL service uses another port', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sinz-mysql-external-port-busy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const version = 'mysql-8.0.30-winx64';
  const versionDir = path.join(root, 'bin', 'mysql', version);
  await fs.mkdir(path.join(versionDir, 'bin'), { recursive: true });
  await fs.writeFile(path.join(versionDir, 'bin', 'mysqld.exe'), 'test binary placeholder');
  const config = path.join(versionDir, 'my.ini');
  await fs.writeFile(config, '[mysqld]\nport=3306\ndatadir=C:/laragon/data/mysql-8\n');
  const adapter = {
    getRoot: async () => root,
    getProcesses: async () => [{ name: 'mysqld.exe', pid: 4760 }, { name: 'mysqld.exe', pid: 5580 }],
    store: { getSettings: () => ({ selectedVersions: { mysql: version } }) }
  };
  const controller = new ServiceController(adapter, async () => {});
  controller.getProcessesByName = async () => [
    { name: 'mysqld.exe', pid: 5580, path: 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe', command: 'mysqld.exe --defaults-file="C:\\ProgramData\\MySQL\\MySQL Server 8.0\\my.ini"', listeningPorts: [3307, 33060] }
  ];
  controller.getListeningPortState = async port => ({ available: true, port, owners: [{ pid: 7777, name: 'another-service.exe', path: 'C:\\Other\\another-service.exe' }] });
  let launched = false;
  controller.launch = async () => { launched = true; return { pid: 9901 }; };
  await assert.rejects(controller.startService('mysql'), /Port 3306.*sudah dipakai.*PID 7777/i);
  assert.equal(launched, false);
});


test("a successful listener enumeration with no owner on the configured port means the port is free", () => {
  const result = normalizePortProbeResult(3306, {
    querySucceeded: true,
    available: true,
    owners: [],
    method: "Get-NetTCPConnection"
  });
  assert.equal(result.available, true);
  assert.equal(result.port, 3306);
  assert.deepEqual(result.owners, []);
  assert.equal(result.error, "");
});

test("port probe preserves owners when the configured port is occupied", () => {
  const result = normalizePortProbeResult(3306, {
    querySucceeded: true,
    available: true,
    owners: [{ pid: 1234, name: "mysqld.exe", path: "C:\\Other\\mysqld.exe" }],
    method: "Get-NetTCPConnection"
  });
  assert.equal(result.available, true);
  assert.equal(result.owners.length, 1);
  assert.equal(result.owners[0].pid, 1234);
});

test("Windows port probe enumerates listeners then filters in memory, avoiding false errors for a free target port", () => {
  const script = buildListeningPortProbeScript(3306);
  assert.match(script, /Get-NetTCPConnection -State Listen -ErrorAction Stop/);
  assert.match(script, /\$allConnections\s*=.*Get-NetTCPConnection[\s\S]*Where-Object \{ \[int\]\$_.LocalPort -eq \$targetPort \}/);
  assert.doesNotMatch(script, /^\s*\$connections\s*=.*Get-NetTCPConnection.*-LocalPort\s+\$targetPort/m);
  assert.match(script, /netstat\.exe -ano -p tcp/);
  assert.match(script, /querySucceeded = \$true/);
});

test("failed port probes remain fail-safe and expose an actionable reason", () => {
  const result = normalizePortProbeResult(3306, {
    querySucceeded: false,
    available: false,
    owners: [],
    error: "Access denied"
  });
  assert.equal(result.available, false);
  assert.match(result.error, /Access denied/);
});


test('Apache started as normal Laragon process skips service-only -k shutdown and uses verified tree', async () => {
  const controller = new ServiceController({ getProcesses: async () => [] }, async () => {});
  controller.processStopGraceMs = 0;
  controller.processStopForceWaitMs = 0;
  const root = 'C:\\laragon';
  const executable = 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16\\bin\\httpd.exe';
  const plan = { id: 'apache', root, executable, config: 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16\\conf\\httpd.conf', versionDir: 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16', cwd: 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16' };
  const processRow = { name: 'httpd.exe', pid: 9304, parentPid: 7400, path: executable, command: `"${executable}" -f "${plan.config}"`, serviceName: '', servicePath: '' };
  let reads = 0;
  controller.getRootProcesses = async () => (++reads === 1 ? [processRow] : []);
  controller.runCommand = async (_file, args) => assert.fail(`Should not call service-only Apache command: ${args.join(' ')}`);
  const killed = [];
  controller.taskkillProcessTree = async (pid, force) => { killed.push({ pid, force }); };
  const result = await controller.stop(plan);
  assert.deepEqual(killed, [{ pid: 9304, force: false }]);
  assert.match(result.detail, /process tree Laragon terverifikasi/);
});

test('Apache uses -k shutdown only when a matching registered Windows service is detected', async () => {
  const controller = new ServiceController({ getProcesses: async () => [] }, async () => {});
  const root = 'C:\\laragon';
  const executable = 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16\\bin\\httpd.exe';
  const plan = { id: 'apache', root, executable, config: 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16\\conf\\httpd.conf', versionDir: 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16', cwd: 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16' };
  const processRow = { name: 'httpd.exe', pid: 9304, parentPid: 7400, path: executable, command: `"${executable}" -k runservice`, serviceName: 'SinzApache', servicePath: `"${executable}" -k runservice` };
  let reads = 0;
  controller.getRootProcesses = async () => (++reads === 1 ? [processRow] : []);
  const calls = [];
  controller.runCommand = async (_file, args) => { calls.push(args); return 'shutdown request sent'; };
  const result = await controller.stop(plan);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('-n'));
  assert.ok(calls[0].includes('SinzApache'));
  assert.match(result.detail, /service Windows terverifikasi/);
});

test('Apache force fallback only targets verified PIDs that remain alive after normal stop', async () => {
  const controller = new ServiceController({ getProcesses: async () => [] }, async () => {});
  controller.processStopGraceMs = 0;
  controller.processStopForceWaitMs = 0;
  const root = 'C:\\laragon';
  const executable = 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16\\bin\\httpd.exe';
  const plan = { id: 'apache', root, executable, config: 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16\\conf\\httpd.conf', versionDir: 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16', cwd: 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16' };
  const processRow = { name: 'httpd.exe', pid: 9304, parentPid: 7400, path: executable, command: `"${executable}"`, serviceName: '', servicePath: '' };
  let reads = 0;
  controller.getRootProcesses = async () => { reads++; return reads <= 2 ? [processRow] : []; };
  controller.runCommand = async () => assert.fail('Apache service command should not be used');
  const killed = [];
  controller.taskkillProcessTree = async (pid, force) => { killed.push({ pid, force }); };
  const warnings = [];
  controller.addLog = async (...args) => warnings.push(args);
  const result = await controller.stop(plan);
  assert.deepEqual(killed, [{ pid: 9304, force: false }, { pid: 9304, force: true }]);
  assert.match(result.detail, /dihentikan paksa/);
  assert.ok(warnings.some(item => item[0] === 'warning' && /penghentian paksa/.test(item[1])));
});


test('Apache verifies service shutdown and falls back if the verified server remains alive', async () => {
  const controller = new ServiceController({ getProcesses: async () => [] }, async () => {});
  controller.processStopGraceMs = 0;
  controller.processStopForceWaitMs = 0;
  const root = 'C:\\laragon';
  const executable = 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16\\bin\\httpd.exe';
  const plan = { id: 'apache', root, executable, config: 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16\\conf\\httpd.conf', versionDir: 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16', cwd: 'C:\\laragon\\bin\\apache\\httpd-2.4.54-win64-VS16' };
  const processRow = { name: 'httpd.exe', pid: 9304, parentPid: 7400, path: executable, command: `"${executable}" -k runservice`, serviceName: 'SinzApache', servicePath: `"${executable}" -k runservice` };
  let reads = 0;
  controller.getRootProcesses = async () => {
    reads++;
    return reads <= 2 ? [processRow] : [];
  };
  const calls = [];
  controller.runCommand = async (_file, args) => { calls.push(args); return 'exit code 0'; };
  const kills = [];
  controller.taskkillProcessTree = async (pid, force) => { kills.push({ pid, force }); };
  const logs = [];
  controller.addLog = async (...args) => logs.push(args);
  const result = await controller.stop(plan);
  assert.equal(calls.length, 1);
  assert.deepEqual(kills, [{ pid: 9304, force: false }]);
  assert.match(result.detail, /tidak berhenti/);
  assert.ok(logs.some(item => item[0] === 'warning' && /tidak berhenti/.test(item[1])));
});
