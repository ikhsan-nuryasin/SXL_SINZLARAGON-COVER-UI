const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

// Only curated package IDs are accepted. Never pass package IDs or arguments from the renderer directly.
const COMPONENT_CATALOG = Object.freeze([
  { id: 'mariadb', packageId: 'MariaDB.Server', name: 'MariaDB Server', category: 'database', description: 'Server SQL kompatibel dengan ekosistem MySQL.', publisher: 'MariaDB Corporation', commands: ['mariadb.exe', 'mysql.exe', 'mysqld.exe'], website: 'https://mariadb.org/' },
  { id: 'postgresql', packageId: 'PostgreSQL.PostgreSQL', name: 'PostgreSQL', category: 'database', description: 'Database relasional dengan fitur SQL lanjutan.', publisher: 'PostgreSQL Global Development Group', commands: ['psql.exe', 'pg_ctl.exe'], website: 'https://www.postgresql.org/' },
  { id: 'mongodb', packageId: 'MongoDB.Server', name: 'MongoDB Server', category: 'database', description: 'Database dokumen untuk aplikasi NoSQL.', publisher: 'MongoDB Inc.', commands: ['mongod.exe', 'mongosh.exe'], website: 'https://www.mongodb.com/' },
  { id: 'sqlite', packageId: 'SQLite.SQLite', name: 'SQLite Tools', category: 'database', description: 'Database embedded berbasis file; tidak memerlukan server terpisah.', publisher: 'SQLite', commands: ['sqlite3.exe'], website: 'https://www.sqlite.org/' },
  { id: 'pgadmin', packageId: 'PostgreSQL.pgAdmin', name: 'pgAdmin 4', category: 'dbtool', description: 'GUI administrasi untuk PostgreSQL.', publisher: 'The pgAdmin Development Team', commands: ['pgAdmin4.exe'], website: 'https://www.pgadmin.org/' },
  { id: 'mongocompass', packageId: 'MongoDB.Compass.Full', name: 'MongoDB Compass', category: 'dbtool', description: 'GUI untuk menjelajah dan mengelola koleksi MongoDB.', publisher: 'MongoDB Inc.', commands: ['MongoDBCompass.exe'], website: 'https://www.mongodb.com/products/tools/compass' },
  { id: 'git', packageId: 'Git.Git', name: 'Git for Windows', category: 'developer', description: 'Version control untuk proyek web.', publisher: 'The Git Development Community', commands: ['git.exe'], website: 'https://git-scm.com/' },
  { id: 'node-lts', packageId: 'OpenJS.NodeJS.LTS', name: 'Node.js LTS', category: 'developer', description: 'Runtime JavaScript dan npm untuk frontend/tooling.', publisher: 'OpenJS Foundation', commands: ['node.exe', 'npm.cmd'], website: 'https://nodejs.org/' },
  { id: 'vscode', packageId: 'Microsoft.VisualStudioCode', name: 'Visual Studio Code', category: 'developer', description: 'Editor kode populer untuk web development.', publisher: 'Microsoft', commands: ['Code.exe', 'code.cmd'], website: 'https://code.visualstudio.com/' },
  { id: 'docker', packageId: 'Docker.DockerDesktop', name: 'Docker Desktop', category: 'developer', description: 'Menjalankan database dan layanan tambahan berbasis container. Memerlukan virtualisasi/WSL2.', publisher: 'Docker Inc.', commands: ['docker.exe'], website: 'https://www.docker.com/products/docker-desktop/' },
  { id: 'composer-installer', packageId: 'Composer-Setup.exe', name: 'Composer', category: 'package', description: 'Pengelola dependensi PHP. Unduh installer Windows resmi dan pilih PHP dari folder Laragon saat setup.', publisher: 'Composer Project', commands: ['composer.bat', 'composer.exe', 'composer.phar'], website: 'https://getcomposer.org/download/', installMethod: 'official-link', installUrl: 'https://getcomposer.org/Composer-Setup.exe' },
  { id: 'yarn', packageId: 'Yarn.Yarn', name: 'Yarn', category: 'package', description: 'Package manager JavaScript alternatif untuk workflow frontend.', publisher: 'Yarn Contributors', commands: ['yarn.cmd', 'yarn.exe'], website: 'https://yarnpkg.com/' },
  { id: 'pnpm', packageId: 'pnpm.pnpm', name: 'pnpm', category: 'package', description: 'Package manager JavaScript hemat ruang untuk workspace dan monorepo.', publisher: 'pnpm Contributors', commands: ['pnpm.cmd', 'pnpm.exe'], website: 'https://pnpm.io/' },
  { id: 'bun', packageId: 'Oven-sh.Bun', name: 'Bun', category: 'developer', description: 'Runtime JavaScript/TypeScript, package manager, bundler, dan test runner.', publisher: 'Oven', commands: ['bun.exe', 'bun.cmd'], website: 'https://bun.sh/' },
  { id: 'heidisql', packageId: 'HeidiSQL.HeidiSQL', name: 'HeidiSQL', category: 'dbtool', description: 'GUI untuk administrasi MySQL, MariaDB, PostgreSQL, dan beberapa backend lain.', publisher: 'HeidiSQL', commands: ['heidisql.exe'], website: 'https://www.heidisql.com/' },
  { id: 'sqlitebrowser', packageId: 'DBBrowserForSQLite.DBBrowserForSQLite', name: 'DB Browser for SQLite', category: 'dbtool', description: 'GUI untuk melihat, mengedit, dan memeriksa file database SQLite.', publisher: 'DB Browser project', commands: ['DB Browser for SQLite.exe'], website: 'https://sqlitebrowser.org/' },
  { id: 'dbeaver', packageId: 'dbeaver.dbeaver', name: 'DBeaver Community', category: 'dbtool', description: 'GUI database multi-engine untuk koneksi relasional dan SQL.', publisher: 'DBeaver Corp', commands: ['dbeaver.exe'], website: 'https://dbeaver.io/' },
  { id: 'beekeeper', packageId: 'beekeeper-studio.beekeeper-studio', name: 'Beekeeper Studio', category: 'dbtool', description: 'Klien database desktop dengan antarmuka query yang ramah pengguna.', publisher: 'Beekeeper Studio', commands: ['beekeeper-studio.exe'], website: 'https://www.beekeeperstudio.io/' },
  { id: 'bruno', packageId: 'Bruno.Bruno', name: 'Bruno API Client', category: 'api', description: 'Mengirim dan mengelola permintaan HTTP API tanpa harus memakai browser.', publisher: 'Bruno', commands: ['bruno.exe', 'Bruno.exe'], website: 'https://www.usebruno.com/' },
  { id: 'windows-terminal', packageId: 'Microsoft.WindowsTerminal', name: 'Windows Terminal', category: 'developer', description: 'Terminal modern untuk PowerShell, Command Prompt, dan shell lainnya.', publisher: 'Microsoft', commands: ['wt.exe'], website: 'https://aka.ms/terminal' }
]);
const CATALOG_BY_ID = new Map(COMPONENT_CATALOG.map(item => [item.id, item]));

function executableNamesFor(component) { return Array.isArray(component.commands) ? component.commands : []; }
async function pathHasExecutable(name) {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      try { await fs.access(path.join(dir, name.endsWith(ext) ? name : `${name}${ext}`)); return true; } catch {}
    }
  }
  return false;
}
async function existsInLaragon(root, id, versions = {}) {
  if (!root) return false;
  const rootVersionMap = {
    mariadb: ['mysql', 'mariadb'], postgresql: ['postgresql'], mongodb: ['mongodb'], sqlite: ['sqlite'],
    pgadmin: ['pgadmin'], mongocompass: ['mongodbcompass'], git: ['git'], 'node-lts': ['node', 'nodejs'], vscode: ['vscode'], docker: ['docker'], yarn: ['yarn'], pnpm: ['pnpm'], bun: ['bun'], heidisql: ['heidisql'], sqlitebrowser: ['sqlitebrowser'], dbeaver: ['dbeaver'], beekeeper: ['beekeeper'], bruno: ['bruno'], 'windows-terminal': ['windowsterminal']
  };
  const keys = rootVersionMap[id] || [];
  if (keys.some(key => Array.isArray(versions[key]) && versions[key].length > 0)) return true;
  const base = path.join(root, 'bin');
  const names = {
    mariadb: ['mysql', 'mariadb'], postgresql: ['postgresql'], mongodb: ['mongodb'], sqlite: ['sqlite'],
    pgadmin: ['pgadmin'], mongocompass: ['mongodbcompass'], git: ['git'], 'node-lts': ['nodejs', 'node'], vscode: ['vscode'], docker: ['docker'], yarn: ['yarn'], pnpm: ['pnpm'], bun: ['bun'], heidisql: ['heidisql'], sqlitebrowser: ['sqlitebrowser'], dbeaver: ['dbeaver'], beekeeper: ['beekeeper'], bruno: ['bruno'], 'windows-terminal': ['windowsterminal']
  }[id] || [];
  for (const dir of names) { try { if ((await fs.stat(path.join(base, dir))).isDirectory()) return true; } catch {} }
  return false;
}

class ComponentManager {
  constructor(addLog, sendProgress = () => {}) {
    this.addLog = addLog;
    this.sendProgress = sendProgress;
    this.active = null;
    this.catalogCache = null;
    this.catalogCacheAt = 0;
    this.catalogCacheRoot = '';
  }
  async isWingetAvailable() {
    if (process.platform !== 'win32') return false;
    const possible = [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'winget.exe'),
      ...String(process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, 'winget.exe'))
    ].filter(Boolean);
    for (const candidate of possible) { try { await fs.access(candidate); return true; } catch {} }
    try { await execFileAsync('where.exe', ['winget'], { timeout: 2500, windowsHide: true }); return true; } catch { return false; }
  }
  async getCatalog(root = '', versions = {}, force = false) {
    const now = Date.now();
    if (!force && this.catalogCache && this.catalogCacheRoot === String(root || '') && now - this.catalogCacheAt < 45000) return structuredClone(this.catalogCache);
    const wingetAvailable = await this.isWingetAvailable();
    const items = await Promise.all(COMPONENT_CATALOG.map(async item => {
      let commandAvailable = false;
      for (const command of executableNamesFor(item)) {
        if (await pathHasExecutable(command)) { commandAvailable = true; break; }
      }
      const detectedInLaragon = await existsInLaragon(root, item.id, versions);
      const officialInstaller = item.installMethod === 'official-link';
      return { ...item, installed: commandAvailable || detectedInLaragon, commandAvailable, detectedInLaragon, wingetAvailable, installable: process.platform === 'win32' && (officialInstaller || wingetAvailable), requiresWinget: !officialInstaller };
    }));
    this.catalogCache = { platform: process.platform, wingetAvailable, items };
    this.catalogCacheRoot = String(root || '');
    this.catalogCacheAt = now;
    return structuredClone(this.catalogCache);
  }
  async install(componentId, mode = 'install') {
    const component = CATALOG_BY_ID.get(String(componentId));
    if (!component) throw new Error('Komponen tidak ada di katalog yang diizinkan.');
    if (component.installMethod === 'official-link') throw new Error('Komponen ini menggunakan installer resmi vendor. Gunakan tombol Unduh installer resmi di App & Database.');
    if (!['install', 'upgrade'].includes(mode)) throw new Error('Operasi komponen tidak valid.');
    if (process.platform !== 'win32') throw new Error('Instalasi dari katalog hanya didukung di Windows melalui WinGet.');
    if (this.active) throw new Error(`Instalasi ${this.active.name} masih berjalan. Tunggu hingga selesai.`);
    if (!(await this.isWingetAvailable())) throw new Error('WinGet tidak ditemukan. Pasang App Installer dari Microsoft Store atau gunakan instalasi manual dari situs resmi vendor.');
    const args = [mode, '--id', component.packageId, '--exact', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'];
    const session = { id: component.id, name: component.name, mode, startedAt: new Date().toISOString() };
    this.active = session;
    const emit = (type, message) => this.sendProgress({ componentId: component.id, componentName: component.name, type, message: String(message).slice(0, 500), time: new Date().toISOString() });
    emit('start', `${mode === 'upgrade' ? 'Memperbarui' : 'Memasang'} ${component.name} (${component.packageId})…`);
    await this.addLog('info', `${mode === 'upgrade' ? 'Pembaruan' : 'Instalasi'} dimulai: ${component.name}`, component.packageId);
    return new Promise((resolve, reject) => {
      let settled = false;
      let outputBuffer = '';
      const child = spawn('winget.exe', args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      session.child = child;
      const pushOutput = (chunk, stream) => {
        outputBuffer += chunk.toString('utf8');
        const lines = outputBuffer.split(/\r?\n/);
        outputBuffer = lines.pop() || '';
        for (const line of lines) if (line.trim()) emit(stream, line.trim());
      };
      child.stdout.on('data', chunk => pushOutput(chunk, 'stdout'));
      child.stderr.on('data', chunk => pushOutput(chunk, 'stderr'));
      const finish = async (err, code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (outputBuffer.trim()) emit('stdout', outputBuffer.trim());
        this.active = null;
        this.catalogCache = null;
        this.catalogCacheRoot = '';
        if (err || code !== 0) {
          const message = err?.message || `WinGet selesai dengan exit code ${code}. Periksa output installer di atas.`;
          emit('error', message);
          await this.addLog('error', `${mode === 'upgrade' ? 'Pembaruan' : 'Instalasi'} gagal: ${component.name}`, message);
          reject(new Error(message));
        } else {
          emit('success', `${component.name} selesai diproses. Refresh status untuk memperbarui deteksi.`);
          await this.addLog('success', `${mode === 'upgrade' ? 'Pembaruan' : 'Instalasi'} selesai: ${component.name}`, component.packageId);
          resolve({ ok: true, componentId: component.id, packageId: component.packageId, mode, exitCode: code });
        }
      };
      const timeout = setTimeout(() => { child.kill(); void finish(new Error('Waktu proses WinGet melebihi 30 menit.'), null); }, 30 * 60 * 1000);
      child.once('error', error => void finish(error, null));
      child.once('close', code => void finish(null, code));
    });
  }
  cancel() {
    if (!this.active?.child) return false;
    this.active.child.kill();
    return true;
  }
  static catalog() { return COMPONENT_CATALOG.map(({ id, packageId, name, category, description, publisher, website, installMethod, installUrl }) => ({ id, packageId, name, category, description, publisher, website, installMethod, installUrl })); }
}
module.exports = { ComponentManager, COMPONENT_CATALOG, CATALOG_BY_ID };
