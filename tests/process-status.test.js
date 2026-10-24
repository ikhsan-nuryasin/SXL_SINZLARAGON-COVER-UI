const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { LaragonAdapter } = require("../src/services/laragon-adapter");

test("service snapshot marks same-named process from another Laragon as a conflict, not as running here", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-process-status-"));
  try {
    await fs.mkdir(path.join(root, "bin"), { recursive: true });
    await fs.mkdir(path.join(root, "www"), { recursive: true });
    await fs.writeFile(path.join(root, "laragon.exe"), "test executable placeholder");
    const settings = {
      laragonRoot: root,
      preferredWebServer: "apache",
      selectedVersions: {},
      registeredProjects: []
    };
    const adapter = new LaragonAdapter({
      getSettings: () => settings,
      setLaragonRoot: async value => { settings.laragonRoot = value; },
      setSelectedVersion: async () => {},
      setPreferredWebServer: async () => {}
    }, async () => {});
    adapter.getProcesses = async () => [{ name: "httpd.exe", pid: 1234 }];
    adapter.controller.getProcessesByName = async () => [{
      name: "httpd.exe", pid: 1234,
      path: "D:\\OtherLaragon\\bin\\apache\\httpd-2.4\\bin\\httpd.exe"
    }];

    const snapshot = await adapter.getSnapshot();
    const apache = snapshot.services.find(service => service.id === "apache");
    assert.equal(apache.running, false);
    assert.equal(apache.externalRunning, true);
    assert.deepEqual(apache.pids, [1234]);
    assert.match(apache.controlReason, /di luar folder Laragon yang dipilih/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test("service snapshot recognizes Laragon MySQL when executable path is hidden but defaults-file is readable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinz-process-status-mysql-config-"));
  try {
    const versionDir = path.join(root, "bin", "mysql", "mysql-8.0.36");
    const config = path.join(versionDir, "my.ini");
    await fs.mkdir(versionDir, { recursive: true });
    await fs.mkdir(path.join(root, "www"), { recursive: true });
    await fs.writeFile(path.join(root, "laragon.exe"), "test executable placeholder");
    await fs.writeFile(path.join(versionDir, "mysqld.exe"), "test binary placeholder");
    await fs.writeFile(config, "[mysqld]\ndatadir=../../../../data/mysql\nport=3306\n");
    const settings = {
      laragonRoot: root,
      preferredWebServer: "apache",
      selectedVersions: { mysql: "mysql-8.0.36" },
      registeredProjects: []
    };
    const adapter = new LaragonAdapter({
      getSettings: () => settings,
      setLaragonRoot: async value => { settings.laragonRoot = value; },
      setSelectedVersion: async () => {},
      setPreferredWebServer: async () => {}
    }, async () => {});
    adapter.root = root;
    adapter.getProcesses = async () => [{ name: "mysqld.exe", pid: 4760 }];
    adapter.controller.getProcessesByName = async names => names.includes("mysqld.exe") ? [{
      name: "mysqld.exe", pid: 4760, path: "", command: `mysqld.exe --defaults-file="${config}"`
    }] : [];

    const snapshot = await adapter.getSnapshot();
    const mysql = snapshot.services.find(service => service.id === "mysql");
    assert.equal(mysql.running, true);
    assert.deepEqual(mysql.pids, [4760]);
    assert.equal(mysql.unverifiedRunning, false);
    assert.equal(mysql.externalRunning, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('service snapshot allows Laragon MySQL to start on its free configured port beside external MySQL80 on another port', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sinz-process-status-mysql-external-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const version = 'mysql-8.0.30-winx64';
  const versionDir = path.join(root, 'bin', 'mysql', version);
  await fs.mkdir(path.join(versionDir, 'bin'), { recursive: true });
  await fs.mkdir(path.join(root, 'www'), { recursive: true });
  await fs.writeFile(path.join(root, 'laragon.exe'), 'test executable placeholder');
  await fs.writeFile(path.join(versionDir, 'bin', 'mysqld.exe'), 'test binary placeholder');
  const config = path.join(versionDir, 'my.ini');
  await fs.writeFile(config, '[mysqld]\ndatadir=C:/laragon/data/mysql-8\nport=3306\n');
  const settings = {
    laragonRoot: root,
    preferredWebServer: 'apache',
    selectedVersions: { mysql: version },
    registeredProjects: []
  };
  const adapter = new LaragonAdapter({
    getSettings: () => settings,
    setLaragonRoot: async value => { settings.laragonRoot = value; },
    setSelectedVersion: async () => {},
    setPreferredWebServer: async () => {}
  }, async () => {});
  adapter.root = root;
  adapter.getProcesses = async () => [
    { name: 'mysqld.exe', pid: 4760 },
    { name: 'mysqld.exe', pid: 5580 }
  ];
  adapter.controller.getProcessesByName = async names => names.includes('mysqld.exe') ? [
    { name: 'mysqld.exe', pid: 4760, path: 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe', command: '"C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe" --defaults-file="C:\\ProgramData\\MySQL\\MySQL Server 8.0\\my.ini" MySQL80', listeningPorts: [] },
    { name: 'mysqld.exe', pid: 5580, parentPid: 4760, path: 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe', command: '"C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe" "--defaults-file=C:\\ProgramData\\MySQL\\MySQL Server 8.0\\my.ini" MySQL80', listeningPorts: [3307, 33060] }
  ] : [];
  adapter.controller.getListeningPortState = async port => ({ available: true, port, owners: [] });
  const snapshot = await adapter.getSnapshot();
  const mysql = snapshot.services.find(service => service.id === 'mysql');
  assert.equal(mysql.running, false);
  assert.equal(mysql.externalRunning, true);
  assert.equal(mysql.canStartAlongsideExternal, true);
  assert.deepEqual(mysql.externalPorts, [3307, 33060]);
  assert.match(mysql.controlReason, /port 3306.*kosong/i);
});
