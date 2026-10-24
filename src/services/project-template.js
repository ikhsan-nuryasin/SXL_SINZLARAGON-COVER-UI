const fs = require('node:fs/promises');
const path = require('node:path');

const TEMPLATE_FILES = {
  php: {
    label: 'PHP sederhana',
    files: {
      'index.php': `<?php\n/**\n * Proyek PHP awal yang dibuat oleh SXL Cover.\n */\n$date = date('Y-m-d H:i:s');\n?>\n<!doctype html>\n<html lang="id">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Proyek PHP</title>\n  <style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:10vh auto;padding:0 24px;color:#20202a}code{background:#f1eff8;padding:3px 7px;border-radius:6px}</style>\n</head>\n<body>\n  <h1>Proyek PHP siap digunakan</h1>\n  <p>PHP berjalan dengan versi <code><?= htmlspecialchars(PHP_VERSION, ENT_QUOTES, 'UTF-8') ?></code>.</p>\n  <p>Waktu server: <?= htmlspecialchars($date, ENT_QUOTES, 'UTF-8') ?></p>\n</body>\n</html>\n`,
      'README.md': '# Proyek PHP\n\nFolder proyek dibuat oleh SXL Cover.\n\n- Buka terminal dari kartu proyek untuk menjalankan perintah PHP atau Composer.\n- Tempatkan file aplikasi di folder ini.\n'
    }
  },
  html: {
    label: 'HTML statis',
    files: {
      'index.html': `<!doctype html>\n<html lang="id">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Proyek Baru</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main class="card">\n    <p class="eyebrow">PROYEK BARU</p>\n    <h1>Halo, dunia.</h1>\n    <p>Ini adalah starter HTML statis. Ubah <code>index.html</code> dan <code>style.css</code> untuk mulai membangun situsmu.</p>\n  </main>\n</body>\n</html>\n`,
      'style.css': `:root{font-family:Inter,system-ui,sans-serif;color:#242333;background:#f5f3fb}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{max-width:680px;padding:clamp(28px,6vw,64px);background:white;border:1px solid #e8e3f4;border-radius:24px;box-shadow:0 24px 70px #29205212}.eyebrow{color:#7655cf;font-weight:750;letter-spacing:.14em;font-size:12px}h1{font-size:clamp(36px,7vw,58px);letter-spacing:-.04em;margin:12px 0}p{line-height:1.7;color:#5c5a69}code{background:#f1edf9;padding:3px 6px;border-radius:5px}\n`,
      'README.md': '# Proyek HTML statis\n\nBuka `index.html` melalui web server lokal atau browser.\n'
    }
  },
  node: {
    label: 'Node.js dasar',
    files: {
      'package.json': JSON.stringify({ name: 'node-starter', version: '1.0.0', private: true, description: 'Starter Node.js lokal', scripts: { start: 'node server.js', dev: 'node server.js' } }, null, 2) + '\n',
      'server.js': `const http = require('node:http');\nconst port = Number(process.env.PORT || 3000);\nconst server = http.createServer((request, response) => {\n  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });\n  response.end('<!doctype html><html lang="id"><meta charset="utf-8"><title>Node.js Starter</title><body style="font:16px system-ui;max-width:720px;margin:10vh auto;padding:24px"><h1>Node.js berjalan</h1><p>Starter server HTTP bawaan Node.js.</p></body></html>');\n});\nserver.listen(port, '127.0.0.1', () => console.log('Server berjalan di http://127.0.0.1:' + port));\n`,
      'README.md': '# Proyek Node.js\n\nJalankan `npm start` di terminal proyek. Server mendengarkan pada `127.0.0.1:3000` secara default.\n'
    }
  }
};

function validateProjectName(input) {
  const name = String(input || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name) || name === '.' || name === '..') {
    throw new Error('Nama proyek harus 1–64 karakter dan hanya berisi huruf, angka, titik, garis bawah, atau tanda hubung.');
  }
  return name;
}

async function createProjectTemplate(root, input) {
  if (!root) throw new Error('Hubungkan instalasi Laragon terlebih dahulu.');
  const name = validateProjectName(input?.name);
  const templateId = String(input?.template || 'php');
  const template = TEMPLATE_FILES[templateId];
  if (!template) throw new Error('Template proyek tidak dikenal.');
  const www = path.resolve(root, 'www');
  const target = path.resolve(www, name);
  const relative = path.relative(www, target);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !relative) throw new Error('Lokasi proyek tidak valid.');
  await fs.mkdir(www, { recursive: true });
  try {
    await fs.mkdir(target, { recursive: false });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Folder ${name} sudah ada. Gunakan nama lain agar file lama tidak tertimpa.`);
    throw error;
  }
  const createdFiles = [];
  try {
    for (const [fileName, content] of Object.entries(template.files)) {
      const filePath = path.join(target, fileName);
      await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
      createdFiles.push(filePath);
    }
  } catch (error) {
    // Roll back only files created by this operation. Never recursively remove
    // a directory that could have received unrelated files concurrently.
    for (const filePath of createdFiles.reverse()) await fs.unlink(filePath).catch(() => {});
    await fs.rmdir(target).catch(() => {});
    throw new Error(`Gagal membuat template proyek: ${error.message}`);
  }
  return { name, path: target, template: templateId, templateLabel: template.label };
}

module.exports = { createProjectTemplate, validateProjectName, TEMPLATE_FILES };
