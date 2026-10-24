const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LaragonAdapter } = require('../src/services/laragon-adapter');

function makeAdapter() {
  const store = { getSettings: () => ({ laragonRoot: '', selectedVersions: {} }) };
  return new LaragonAdapter(store, async () => {});
}

test('diagnostics clearly report an unconfigured installation', async () => {
  const adapter = makeAdapter();
  const result = await adapter.getEnvironmentDiagnostics('', {});
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'error');
});

test('diagnostics detect required folders and PHP CLI in a test installation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sinz-diagnostics-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const directory of ['bin', 'www', 'etc', 'data', 'usr', 'bin/php/8.3']) await fs.mkdir(path.join(root, directory), { recursive: true });
  await fs.writeFile(path.join(root, 'laragon.exe'), 'fake');
  await fs.writeFile(path.join(root, 'bin/php/8.3/php.exe'), 'fake');
  const adapter = makeAdapter();
  const result = await adapter.getEnvironmentDiagnostics(root, { php: ['8.3'], node: [], apache: [], nginx: [], mysql: [] });
  assert.equal(result.find(item => item.id === 'launcher').status, 'ok');
  assert.equal(result.find(item => item.id === 'bin').status, 'ok');
  assert.equal(result.find(item => item.id === 'www').status, 'ok');
  assert.equal(result.find(item => item.id === 'php').status, 'ok');
  assert.equal(result.find(item => item.id === 'mysql-config').status, 'warning');
});
