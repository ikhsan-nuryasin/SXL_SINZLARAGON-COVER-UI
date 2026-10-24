const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeHostname, isAllowedWebUrl } = require("../src/services/validation");

test("hostname normalization strips protocol and trailing slash", () => {
  assert.equal(normalizeHostname("https://My-App.test/"), "my-app.test");
});

test("empty hostname is optional", () => {
  assert.equal(normalizeHostname("  "), "");
});

test("hostname rejects path traversal and scheme injection", () => {
  assert.throws(() => normalizeHostname("app.test/path"), /Hostname tidak valid/);
  assert.throws(() => normalizeHostname(".app.test"), /Hostname tidak valid/);
  assert.throws(() => normalizeHostname("bad..test"), /Hostname tidak valid/);
  assert.throws(() => normalizeHostname("app.test:8080"), /Hostname tidak valid/);
});

test("opening project URLs only accepts HTTP and HTTPS", () => {
  assert.equal(isAllowedWebUrl("http://shop.test"), true);
  assert.equal(isAllowedWebUrl("https://localhost:9443/admin"), true);
  assert.equal(isAllowedWebUrl("file:///C:/Windows/win.ini"), false);
  assert.equal(isAllowedWebUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedWebUrl("not a url"), false);
});
