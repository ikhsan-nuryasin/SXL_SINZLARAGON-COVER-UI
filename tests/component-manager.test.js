const test = require('node:test');
const assert = require('node:assert/strict');
const { COMPONENT_CATALOG, ComponentManager } = require('../src/services/component-manager');

test('catalog only exposes well-defined package IDs and safe categories', () => {
  assert.ok(COMPONENT_CATALOG.length >= 10);
  for (const item of COMPONENT_CATALOG) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    if (item.installMethod === 'official-link') {
      assert.equal(item.id, 'composer-installer');
      assert.equal(item.installUrl, 'https://getcomposer.org/Composer-Setup.exe');
      assert.equal(item.website, 'https://getcomposer.org/download/');
    } else assert.match(item.packageId, /^[A-Za-z0-9][A-Za-z0-9.-]+$/);
    assert.ok(['database', 'dbtool', 'developer', 'package', 'api'].includes(item.category));
    assert.match(item.website, /^https:\/\//);
  }
  assert.equal(new Set(COMPONENT_CATALOG.map(item => item.id)).size, COMPONENT_CATALOG.length);
});

test('curated developer catalog includes Composer, package managers, database clients, and API tools', () => {
  const ids = new Set(COMPONENT_CATALOG.map(item => item.id));
  for (const id of ['composer-installer', 'yarn', 'pnpm', 'bun', 'heidisql', 'sqlitebrowser', 'dbeaver', 'beekeeper', 'bruno', 'windows-terminal']) assert.ok(ids.has(id), `Missing catalog item: ${id}`);
});

test('Composer must go through the dedicated official-installer flow, never WinGet', async () => {
  const manager = new ComponentManager(async () => {}, () => {});
  await assert.rejects(() => manager.install('composer-installer', 'install'), /installer resmi vendor/i);
});

test('component installer rejects unknown IDs before attempting any process', async () => {
  const manager = new ComponentManager(async () => {}, () => {});
  await assert.rejects(() => manager.install('powershell -Command whoami'), /tidak ada di katalog/i);
});

test('component installer rejects arbitrary operation names', async () => {
  const manager = new ComponentManager(async () => {}, () => {});
  await assert.rejects(() => manager.install('git', 'uninstall'), /tidak valid/i);
});
