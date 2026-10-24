const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DATABASE_ENGINES = Object.freeze({
  mysql: { label: 'MySQL', port: 3306, defaultDatabase: 'app_db' },
  mariadb: { label: 'MariaDB', port: 3306, defaultDatabase: 'app_db' },
  postgresql: { label: 'PostgreSQL', port: 5432, defaultDatabase: 'app_db' },
  mongodb: { label: 'MongoDB', port: 27017, defaultDatabase: 'app_db' },
  sqlite: { label: 'SQLite', port: 0, defaultDatabase: 'database/database.sqlite' }
});
function cleanText(value, label, max = 128, allowEmpty = false) {
  const text = String(value ?? '').trim();
  if (!text && allowEmpty) return '';
  if (!text || text.length > max || /[\r\n\0]/.test(text)) throw new Error(`${label} wajib diisi dan maksimal ${max} karakter.`);
  return text;
}
function normalizeProfile(input = {}, existing = []) {
  const engine = String(input.engine || 'mysql').toLowerCase();
  if (!Object.hasOwn(DATABASE_ENGINES, engine)) throw new Error('Jenis database tidak didukung.');
  const preset = DATABASE_ENGINES[engine];
  const name = cleanText(input.name, 'Nama profil', 60);
  const host = engine === 'sqlite' ? '' : cleanText(input.host || '127.0.0.1', 'Host', 253);
  if (host && !/^[a-zA-Z0-9._:\-[\]]+$/.test(host)) throw new Error('Format host tidak valid. Gunakan hostname/IP tanpa skema URL.');
  const port = engine === 'sqlite' ? 0 : Number(input.port || preset.port);
  if (engine !== 'sqlite' && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Port harus angka 1–65535.');
  const database = cleanText(input.database || preset.defaultDatabase, engine === 'sqlite' ? 'Path file SQLite' : 'Nama database', 255);
  if (engine !== 'sqlite' && !/^[a-zA-Z0-9_$.-]+$/.test(database)) throw new Error('Nama database hanya boleh berisi huruf, angka, titik, garis bawah, tanda hubung, dan $.');
  if (engine === 'sqlite' && (path.isAbsolute(database) ? false : database.split(/[\\/]/).includes('..'))) throw new Error('Path relatif SQLite tidak boleh naik keluar folder proyek.');
  const username = engine === 'sqlite' ? '' : cleanText(input.username || (engine === 'mongodb' ? '' : 'root'), 'Username', 128, engine === 'mongodb');
  const id = typeof input.id === 'string' && /^[a-f0-9-]{20,40}$/i.test(input.id) ? input.id : crypto.randomUUID();
  const duplicate = existing.find(item => item.id !== id && item.name.toLowerCase() === name.toLowerCase());
  if (duplicate) throw new Error('Nama profil database sudah digunakan.');
  return { id, name, engine, host, port, database, username, updatedAt: new Date().toISOString() };
}
function encodeEnv(value) {
  const text = String(value ?? '');
  if (/^[a-zA-Z0-9_./:@+-]+$/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}
function envForProfile(profile) {
  const p = normalizeProfile(profile, []);
  const lines = [`# Dibuat oleh SXL Cover; isi DB_PASSWORD secara manual bila diperlukan.`];
  if (p.engine === 'sqlite') {
    lines.push('DB_CONNECTION=sqlite', `DB_DATABASE=${encodeEnv(p.database)}`);
  } else {
    const connection = p.engine === 'postgresql' ? 'pgsql' : p.engine === 'mongodb' ? 'mongodb' : 'mysql';
    lines.push(`DB_CONNECTION=${connection}`, `DB_HOST=${encodeEnv(p.host)}`, `DB_PORT=${p.port}`, `DB_DATABASE=${encodeEnv(p.database)}`, `DB_USERNAME=${encodeEnv(p.username)}`, 'DB_PASSWORD=');
    if (p.engine === 'mongodb') lines.push('', '# Jika framework menggunakan driver MongoDB pihak ketiga:', `MONGODB_URI=mongodb://${p.username ? encodeURIComponent(p.username) + '@' : ''}${formatUriHost(p.host)}:${p.port}/${encodeURIComponent(p.database)}`);
  }
  return `${lines.join('\n')}\n`;
}
function formatUriHost(host) { return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host; }
function connectionUri(profile) {
  const p = normalizeProfile(profile, []);
  if (p.engine === 'sqlite') return `sqlite:${p.database}`;
  const protocol = p.engine === 'postgresql' ? 'postgresql' : p.engine === 'mongodb' ? 'mongodb' : 'mysql';
  const auth = p.username ? `${encodeURIComponent(p.username)}@` : '';
  return `${protocol}://${auth}${formatUriHost(p.host)}:${p.port}/${encodeURIComponent(p.database)}`;
}
function testTcp(host, port, timeoutMs = 2500) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;
    const finish = result => { if (settled) return; settled = true; socket.destroy(); resolve(result); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, detail: `Port ${port} di ${host} dapat dijangkau. Tes ini tidak memverifikasi username/password.` }));
    socket.once('timeout', () => finish({ ok: false, detail: `Timeout saat mencoba ${host}:${port}.` }));
    socket.once('error', error => finish({ ok: false, detail: `${error.code || 'ERROR'}: ${error.message}` }));
    socket.connect({ host, port });
  });
}
async function testDatabaseProfile(profile) {
  const p = normalizeProfile(profile, []);
  if (p.engine === 'sqlite') {
    if (!path.isAbsolute(p.database)) return { ok: false, detail: 'Tes SQLite memerlukan path file absolut. Untuk aplikasi Laravel, gunakan database/database.sqlite pada template .env.example.' };
    const absolute = path.resolve(p.database);
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat?.isFile()) return { ok: false, detail: 'File database SQLite tidak ditemukan. Gunakan path file yang sudah ada untuk tes ini.' };
    await fs.access(absolute).catch(() => { throw new Error('File SQLite tidak dapat dibaca.'); });
    return { ok: true, detail: 'File SQLite tersedia dan dapat dibaca. Tes ini belum menjalankan query SQL.' };
  }
  return testTcp(p.host, p.port);
}
module.exports = { DATABASE_ENGINES, normalizeProfile, envForProfile, connectionUri, testDatabaseProfile, testTcp };
