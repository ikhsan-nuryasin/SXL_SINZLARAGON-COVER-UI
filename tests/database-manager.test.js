const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProfile, envForProfile, connectionUri, testDatabaseProfile, DATABASE_ENGINES } = require('../src/services/database-manager');

function profile(input = {}) { return normalizeProfile({ name: 'Local DB', engine: 'mysql', host: '127.0.0.1', database: 'app_db', username: 'root', ...input }, []); }

test('supports five database profile engines with sensible defaults', () => {
  assert.deepEqual(Object.keys(DATABASE_ENGINES), ['mysql', 'mariadb', 'postgresql', 'mongodb', 'sqlite']);
  assert.equal(profile().port, 3306);
  assert.equal(profile({ engine: 'postgresql', port: undefined }).port, 5432);
  assert.equal(profile({ engine: 'mongodb', port: undefined }).port, 27017);
});

test('rejects host injection, invalid ports, invalid database names, and unknown engines', () => {
  assert.throws(() => profile({ host: 'localhost; rm -rf /' }), /host/i);
  assert.throws(() => profile({ port: 70000 }), /port/i);
  assert.throws(() => profile({ database: 'app db;drop' }), /nama database/i);
  assert.throws(() => profile({ engine: 'unknown' }), /tidak didukung/i);
});

test('connection URIs never contain a password and environment output leaves password blank', () => {
  const item = profile({ username: 'app-user' });
  assert.equal(connectionUri(item), 'mysql://app-user@127.0.0.1:3306/app_db');
  const env = envForProfile(item);
  assert.match(env, /DB_CONNECTION=mysql/);
  assert.match(env, /DB_PASSWORD=$/m);
  assert.doesNotMatch(env, /secret|password123/i);
});

test('duplicate profile names are rejected case-insensitively', () => {
  const existing = profile({ id: 'existing-id-0000000000000000', name: 'Prod DB' });
  assert.throws(() => normalizeProfile({ name: 'prod db', engine: 'mysql', host: '127.0.0.1', port: 3306, database: 'app', username: 'root' }, [existing]), /sudah digunakan/i);
});

test('SQLite relative paths are allowed for env generation but not misreported as a reachable file', async () => {
  const item = profile({ engine: 'sqlite', database: 'database/database.sqlite', host: '', port: 0, username: '' });
  assert.match(envForProfile(item), /DB_CONNECTION=sqlite/);
  const result = await testDatabaseProfile(item);
  assert.equal(result.ok, false);
  assert.match(result.detail, /path file absolut/i);
});
