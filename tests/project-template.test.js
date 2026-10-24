const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectTemplate, validateProjectName } = require('../src/services/project-template');

async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sinz-template-test-'));
  return root;
}

test('project names are restricted to safe folder tokens', () => {
  assert.equal(validateProjectName('my-app_01.test'), 'my-app_01.test');
  for (const name of ['../escape', 'two words', 'C:\\Windows', '..', '', 'bad/name']) {
    assert.throws(() => validateProjectName(name), /Nama proyek harus/);
  }
});

test('PHP template creates local starter files in www', async t => {
  const root = await tempRoot(); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = await createProjectTemplate(root, { name: 'php-demo', template: 'php' });
  assert.equal(project.path, path.join(root, 'www', 'php-demo'));
  assert.match(await fs.readFile(path.join(project.path, 'index.php'), 'utf8'), /PHP_VERSION/);
  assert.ok((await fs.readFile(path.join(project.path, 'README.md'), 'utf8')).includes('Proyek PHP'));
});

test('HTML and Node templates create only expected starter files', async t => {
  const root = await tempRoot(); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const htmlProject = await createProjectTemplate(root, { name: 'static-demo', template: 'html' });
  assert.ok(await fs.stat(path.join(htmlProject.path, 'index.html')));
  assert.ok(await fs.stat(path.join(htmlProject.path, 'style.css')));
  const nodeProject = await createProjectTemplate(root, { name: 'node-demo', template: 'node' });
  const pkg = JSON.parse(await fs.readFile(path.join(nodeProject.path, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node server.js');
  assert.match(await fs.readFile(path.join(nodeProject.path, 'server.js'), 'utf8'), /127\.0\.0\.1/);
});

test('existing folders are never overwritten by template generation', async t => {
  const root = await tempRoot(); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'www', 'existing');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'important.txt'), 'keep');
  await assert.rejects(createProjectTemplate(root, { name: 'existing', template: 'php' }), /sudah ada/);
  assert.equal(await fs.readFile(path.join(dir, 'important.txt'), 'utf8'), 'keep');
});

test('unknown project templates are rejected', async t => {
  const root = await tempRoot(); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(createProjectTemplate(root, { name: 'bad-template', template: 'unknown' }), /tidak dikenal/);
});


test('template rollback removes only files created by this operation', async t => {
  const root = await tempRoot(); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { TEMPLATE_FILES } = require('../src/services/project-template');
  TEMPLATE_FILES.php.files['missing-subfolder/should-fail.txt'] = 'trigger failure';
  try {
    await assert.rejects(createProjectTemplate(root, { name: 'rollback-demo', template: 'php' }), /Gagal membuat template proyek/);
    await assert.rejects(fs.stat(path.join(root, 'www', 'rollback-demo')));
  } finally {
    delete TEMPLATE_FILES.php.files['missing-subfolder/should-fail.txt'];
  }
});
