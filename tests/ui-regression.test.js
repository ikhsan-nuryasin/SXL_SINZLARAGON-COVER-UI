const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'renderer/renderer.js'), 'utf8');
const designCss = fs.readFileSync(path.join(root, 'renderer/styles-violet.css'), 'utf8');
const polish = fs.readFileSync(path.join(root, 'renderer/styles-polish.css'), 'utf8');
const baseCss = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
const uxFixes = fs.readFileSync(path.join(root, 'renderer/styles-ux-fixes.css'), 'utf8');

test('Violet Grid palettes remain available and feature stylesheet loads last', () => {
  assert.ok(fs.existsSync(path.join(root, 'renderer/styles-violet.css')));
  assert.equal((html.match(/href="styles-violet\.css"/g) || []).length, 1);
  assert.ok(html.indexOf('styles-violet.css') > html.indexOf('styles-polish.css'));
  assert.ok(html.indexOf('styles-features.css') > html.indexOf('styles-violet.css'));
  assert.ok(html.indexOf('styles-ux-fixes.css') > html.indexOf('styles-hub.css'));
  assert.ok(html.indexOf('styles-performance.css') > html.indexOf('styles-ux-fixes.css'));
  assert.ok(html.indexOf('styles-cover.css') > html.indexOf('styles-header.css'));
  assert.equal((html.match(/href="styles-features\.css"/g) || []).length, 1);
  assert.match(designCss, /--accent:\s*#b49aff/);
  assert.match(designCss, /body\[data-theme="light"\][\s\S]*?--accent:\s*#7753db/);
});

test('app viewport is fixed while only content and sidebar may scroll', () => {
  assert.match(designCss, /\.app-shell\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/s);
  assert.match(designCss, /\.sidebar\s*\{[^}]*height:\s*100vh[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s);
  assert.match(designCss, /\.main-area\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/s);
  assert.match(designCss, /\.content-wrap\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s);
});

test('collapsed sidebar keeps a visible and accessible expand control', () => {
  assert.match(baseCss, /\.sidebar-collapsed \.collapse-button[^}]*display:none/s);
  assert.match(polish, /body\.sidebar-collapsed \.collapse-button\s*\{[^}]*display:\s*inline-flex\s*!important/s);
  assert.match(designCss, /body\.sidebar-collapsed \.collapse-button\s*\{[^}]*display:\s*inline-flex\s*!important/s);
  assert.match(html, /id="sidebarCollapse"[^>]*aria-expanded="true"/);
  assert.match(js, /function setSidebarCollapsed\(collapsed\)/);
  assert.match(js, /toggle\.setAttribute\("aria-expanded", String\(!collapsed\)\)/);
});

test('page navigation clears active state and resets content scroll', () => {
  assert.match(js, /item\.removeAttribute\("aria-current"\)/);
  assert.match(js, /const contentWrap = document\.querySelector\("\.content-wrap"\)/);
  assert.match(js, /contentWrap\.scrollTop = 0/);
  assert.doesNotMatch(js, /mainArea\.scrollTop = 0/);
  assert.match(html, /data-page="dashboard" aria-current="page"/);
});

test('local SVG navigation icons are used with no external icon dependency', () => {
  assert.match(html, /class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"/);
  assert.equal((html.match(/class="nav-icon" aria-hidden="true"><svg/g) || []).length, 8);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
});

test('renderer stylesheets exist and are linked exactly once', () => {
  for (const file of ['styles.css', 'styles-polish.css', 'styles-violet.css', 'styles-features.css', 'styles-hub.css', 'styles-ux-fixes.css', 'styles-performance.css', 'styles-header.css', 'styles-cover.css']) {
    assert.ok(fs.existsSync(path.join(root, 'renderer', file)));
    assert.equal((html.match(new RegExp(`href="${file.replace('.', '\\.')}"`, 'g')) || []).length, 1);
  }
});

test('refined application header has clear hierarchy and accessible quick actions', () => {
  const headerCss = fs.readFileSync(path.join(root, 'renderer/styles-header.css'), 'utf8');
  const coverCss = fs.readFileSync(path.join(root, 'renderer/styles-cover.css'), 'utf8');
  assert.ok(html.indexOf('styles-header.css') > html.indexOf('styles-performance.css'));
  assert.match(html, /<header class="topbar" aria-label="Header aplikasi">/);
  assert.match(html, /class="topbar-left"/);
  assert.match(html, /class="topbar-context"/);
  assert.match(html, /class="topbar-caption"/);
  assert.match(html, /class="crumb-home"/);
  assert.match(html, /id="overallStatus" role="status" aria-live="polite"/);
  assert.match(html, /id="headerStartStack" class="button button-primary button-small header-stack-button"/);
  assert.match(html, /id="headerStopStack" class="button button-secondary button-small header-stack-button header-stack-stop"/);
  assert.match(html, /id="headerStartStack"[^>]*disabled aria-disabled="true"/);
  assert.match(html, /id="headerStopStack"[^>]*disabled aria-disabled="true"/);
  assert.match(coverCss, /header-stack-actions/);
  assert.match(coverCss, /header-stack-stop/);
  assert.match(headerCss, /\.topbar::before/);
  assert.match(headerCss, /backdrop-filter:\s*blur/);
  assert.match(headerCss, /@media \(max-width:\s*820px\)/);
  assert.match(headerCss, /prefers-reduced-motion:\s*reduce/);
});

test('header reflects partial-stack conflicts and disables stack actions before initial state is known', () => {
  assert.match(js, /pill\.classList\.toggle\("conflict", detected && Boolean\(blocked\)\)/);
  assert.match(js, /Sebagian aktif · konflik/);
  assert.match(html, /id="startAllServices"[^>]*disabled aria-disabled="true"/);
  assert.match(html, /id="stopAllServices"[^>]*disabled aria-disabled="true"/);
  assert.match(html, /Setiap 18 detik/);
});

test('SXL Cover rebrand uses an SXL cover mark and no X-based product identity in the visible UI', () => {
  assert.match(html, /<title>SXL Cover<\/title>/);
  assert.match(html, /class="brand-mark sxl-mark" role="img" aria-label="Logo SXL"/);
  assert.match(html, /<strong>SXL<\/strong>/);
  assert.match(html, /SXL <span>Cover<\/span>/);
  assert.match(html, /id="headerStartStack"/);
  assert.match(html, /id="headerStopStack"/);
  assert.doesNotMatch(html, /Laragon X Sinz UI/);
  assert.doesNotMatch(html, /UI tidak resmi yang dibuat oleh Sinz/);
  assert.ok(fs.existsSync(path.join(root, 'renderer/styles-cover.css')));
});

test('header Start/Stop controls follow detected state, running state, and service mutation lock', () => {
  assert.match(js, /const runningServices = services\.filter\(item => item\.running\)/);
  assert.match(js, /const stoppableServices = runningServices\.filter\(item => item\.stopSupported\)/);
  assert.match(js, /start\.disabled = !detected \|\| serviceMutationInFlight \|\| startableServices\.length === 0/);
  assert.match(js, /stop\.disabled = !detected \|\| serviceMutationInFlight \|\| stoppableServices\.length === 0/);
  assert.match(js, /pill\.classList\.toggle\("conflict"/);
  assert.match(js, /const startAll = \$\("startAllServices"\)/);
  assert.match(js, /const stopAll = \$\("stopAllServices"\)/);
  assert.match(js, /async function controlStack\(/);
  assert.match(js, /Status akhir belum sesuai/);
  assert.match(js, /async function runServiceMutation\([^)]*verification = \{\}/);
  assert.match(js, /actual\.running !== verification\.expectedRunning/);
});

test('all HTML ids are unique', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});


test('developer tools page exposes diagnostics, runtime overview, and safe fixed local tools', () => {
  assert.match(html, /id="page-tools"/);
  assert.match(html, /id="diagnosticsList"/);
  assert.match(html, /id="exportDiagnostics"/);
  assert.match(html, /data-local-tool="phpmyadmin"/);
  assert.match(html, /data-local-tool="mailpit"/);
  assert.match(js, /function renderDeveloperTools\(\)/);
  assert.match(js, /window\.studio\.exportDiagnostics\(\)/);
});

test('project template creation and project tasks are wired through preload APIs', () => {
  assert.match(html, /id="createProjectModal"/);
  assert.match(html, /id="createProjectTemplate"/);
  assert.match(js, /window\.studio\.createProjectTemplate\(data\)/);
  assert.match(js, /window\.studio\.runProjectTask\(project\.path, taskId\)/);
});


test('App & Database Hub includes curated catalog, profiles, and accessible workflows', () => {
  assert.match(html, /id="page-hub"/);
  assert.match(html, /id="componentGrid"/);
  assert.match(html, /id="databaseProfileList"/);
  assert.match(html, /id="databaseProfileModal"/);
  assert.match(html, /id="databaseEnvModal"/);
  assert.match(js, /function renderComponentCatalog\(\)/);
  assert.match(js, /function renderDatabaseProfiles\(\)/);
  assert.match(js, /window\.studio\.installComponent\(item\.id, mode\)/);
  assert.match(js, /window\.studio\.writeEnvExample\(profileId, projectPath\)/);
});


test('Help center page is navigable, searchable, and uses fixed official links', () => {
  assert.match(html, /id="page-help"/);
  assert.match(html, /data-page="help"/);
  assert.match(html, /id="helpSearch"/);
  assert.match(html, /id="help-troubleshooting"/);
  assert.match(js, /const helpSearch = \$\("helpSearch"\)/);
  assert.match(js, /window\.studio\.openExternalUrl\(url\)/);
  assert.match(html, /data-help-url="https:\/\/getcomposer\.org\/download\/"/);
});

test('project and service action layouts explicitly prevent horizontal control overflow', () => {
  assert.match(uxFixes, /\.project-card-actions\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/s);
  assert.match(uxFixes, /\.project-task-row\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/s);
  assert.match(uxFixes, /\.service-card-actions\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(js, /className = "project-card-actions"/);
});


test('Composer download can only use the fixed official installer entry', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8');
  assert.match(main, /handle\("components:open-installer"[\s\S]*?item\.installMethod !== "official-link"[\s\S]*?item\.installUrl !== "https:\/\/getcomposer\.org\/Composer-Setup\.exe"/);
  assert.match(preload, /openComponentInstaller: componentId => ipcRenderer\.invoke\("components:open-installer", componentId\)/);
});


test('MySQL shutdown prompts for password, sends it through preload only for that action, and keeps the UI flow wired', () => {
  const preload = fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'src/services/service-controller.js'), 'utf8');
  assert.match(html, /id="mysqlStopPasswordModal"/);
  assert.match(html, /id="mysqlStopPasswordInput" type="password"/);
  assert.match(js, /function requestMysqlPassword\(/);
  assert.match(js, /stopServiceWithPassword\(serviceId\)/);
  assert.match(js, /restartServiceWithPassword\(serviceId\)/);
  assert.match(js, /window\.studio\.stopStack\(\{ mysqlPassword: password \}\)/);
  assert.match(preload, /stopService: \(service, options\) => ipcRenderer\.invoke\("service:stop", service, options\)/);
  assert.match(main, /validateMysqlStopOptions\(options\)/);
  assert.match(controller, /Password MySQL ditolak oleh server/);
  assert.match(controller, /fs\.mkdtemp\(path\.join\(os\.tmpdir\(\), "sinz-mysql-stop-"\)\)/);
  assert.match(controller, /await fs\.rm\(tempDir, \{ recursive: true, force: true \}\)/);
  assert.match(controller, /password=\$\{escapeMysqlOptionFileValue\(options\.password\)\}/);
  assert.match(controller, /this\.runCommand\(admin, \[\`--defaults-file=\$\{tempConfig\}\`, "--connect-timeout=5", "shutdown"\]/);
});


test('MySQL shutdown dialog accepts an explicitly empty password and explains the old initialization log', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'src/services/service-controller.js'), 'utf8');
  const modal = html.match(/<input id="mysqlStopPasswordInput"[^>]*>/)?.[0] || '';
  assert.ok(modal, 'password input exists');
  assert.doesNotMatch(modal, /\srequired(?:\s|>)/i, 'empty password should be explicitly testable');
  assert.match(main, /An explicitly submitted empty string is allowed/);
  assert.match(controller, /const passwordProvided = typeof options\.password === "string"/);
  assert.match(controller, /password=\$\{escapeMysqlOptionFileValue\(options\.password\)\}/);
  assert.match(controller, /Log lama yang menyebut root dibuat tanpa password hanya berlaku saat inisialisasi/);
  assert.match(js, /if \(password === null\) return null/);
});


test('global processing feedback includes an accessible live status, animated progress, and button-level busy state', () => {
  const performanceCss = fs.readFileSync(path.join(root, 'renderer/styles-performance.css'), 'utf8');
  assert.match(html, /id="globalProgressTrack"/);
  assert.match(html, /id="operationStatus" role="status" aria-live="polite"/);
  assert.match(html, /id="operationTitle"/);
  assert.match(html, /id="operationDescription"/);
  assert.match(js, /function beginOperation\(/);
  assert.match(js, /function updateOperationFeedback\(/);
  assert.match(js, /button\.setAttribute\("aria-busy", "true"\)/);
  assert.match(performanceCss, /\.global-progress-track\.active\s*>\s*span\s*\{[^}]*animation:/s);
  assert.match(performanceCss, /\.button-inline-spinner\s*\{/);
  assert.match(performanceCss, /prefers-reduced-motion:\s*reduce/);
});

test('state refresh is coalesced and expensive hidden pages are not rebuilt on every refresh', () => {
  assert.match(js, /let refreshPromise = null/);
  assert.match(js, /if \(refreshPromise\) return refreshPromise/);
  assert.match(js, /if \(currentPage === "projects"\) renderProjects\(\)/);
  assert.match(js, /else if \(currentPage === "services"\) renderServices\(\)/);
  assert.match(js, /else if \(currentPage === "hub"\) renderAppHub\(\)/);
  assert.match(js, /else if \(currentPage === "settings"\) renderRuntimeSelectors\(\)/);
  assert.doesNotMatch(js, /window\.setInterval\(\(\) => refreshState\(true\), 10000\)/);
  assert.match(js, /document\.visibilityState === "visible" && activeOperations\.size === 0/);
});

test('search filtering is debounced and component output appends rows rather than rebuilding the full log each event', () => {
  assert.match(js, /function debounce\(callback, delay = 120\)/);
  assert.match(js, /\$\("projectSearch"\)\.addEventListener\("input", debounce\(/);
  assert.match(js, /\$\("serviceSearch"\)\.addEventListener\("input", debounce\(/);
  assert.match(js, /\$\("componentSearch"\)\.addEventListener\("input", debounce\(/);
  const appendFunction = js.match(/function appendComponentOutput\(entry\) \{[\s\S]*?container\.append\(row\)[\s\S]*?container\.scrollTop = container\.scrollHeight;[\s\S]*?\n\}/)?.[0] || '';
  assert.match(appendFunction, /container\.append\(row\)/);
  assert.doesNotMatch(appendFunction, /container\.replaceChildren\(\)/);
});

test('quick action wrapper refreshes state only for mutations that request it', () => {
  const actionFunction = js.match(/async function action\(fn,[\s\S]*?if \(options\.refresh && result !== null\) await refreshState\(true\)[\s\S]*?finally \{\s*finish\(\);[\s\S]*?\n\}/)?.[0] || '';
  assert.match(actionFunction, /if \(options\.refresh && result !== null\) await refreshState\(true\)/);
  assert.match(actionFunction, /const finish = beginOperation/);
  assert.match(actionFunction, /finally \{\s*finish\(\);/);
});
