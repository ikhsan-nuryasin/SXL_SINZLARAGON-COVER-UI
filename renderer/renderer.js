const $ = (id) => document.getElementById(id);
const PAGE_TITLES = { dashboard: "Beranda", projects: "Proyek", services: "Layanan", hub: "App & Database", tools: "Alat developer", logs: "Log & aktivitas", settings: "Pengaturan", help: "Bantuan & panduan" };
const SERVICE_ICONS = { apache: "A", nginx: "N", mysql: "✣", postgresql: "P", redis: "R", memcached: "M", mailpit: "✉" };
const TYPE_ICONS = { Laravel: "L", "PHP / Composer": "P", PHP: "P", "Node.js": "N", "Static site": "◇", "Folder proyek": "▤", "Folder terdaftar": "▤" };
let state = null;
let currentPage = "dashboard";
let projectFilter = "all";
let projectQuery = "";
let projectListMode = "grid";
let serviceQuery = "";
let serviceFilter = "all";
let currentLogSource = "activity";
let currentLogContent = "";
let currentLogLabel = "Aktivitas aplikasi";
let currentLogTruncated = false;
let logFilter = "all";
let isRefreshing = false;
let refreshPromise = null;
let operationSequence = 0;
const activeOperations = new Map();
let toastCounter = 0;
let componentCategory = "all";
let componentQuery = "";
let componentBusy = false;
let dbEditingId = "";
let activeHubTab = "components";
let componentOutputLines = [];
let serviceMutationInFlight = false;

function escapeText(value) { return String(value ?? ""); }
function formatTime(value, withDate = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("id-ID", withDate
    ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}
function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(date);
}
function shortPath(value, max = 38) {
  const string = String(value || "");
  if (string.length <= max) return string;
  return `${string.slice(0, Math.max(6, max - 18))}…${string.slice(-15)}`;
}
function titleCase(value) { return String(value || "").replace(/\b\w/g, (m) => m.toUpperCase()); }
function setText(id, value) { const element = $(id); if (element) element.textContent = escapeText(value); }
function focusedActionButton() {
  const active = document.activeElement;
  return active && active.tagName === "BUTTON" && active.isConnected ? active : null;
}
function operationLabelFromButton(button) {
  if (!button) return "Memproses permintaan";
  const label = String(button.dataset.operationLabel || button.getAttribute("aria-label") || button.textContent || "Memproses permintaan")
    .replace(/\s+/g, " ").trim();
  return label.length > 64 ? `${label.slice(0, 61)}…` : label;
}
function updateOperationFeedback() {
  const track = $("globalProgressTrack");
  const status = $("operationStatus");
  const active = activeOperations.size > 0;
  if (track) track.classList.toggle("active", active);
  if (status) {
    status.hidden = !active;
    if (active) {
      const latest = [...activeOperations.values()].at(-1);
      setText("operationTitle", latest?.label || "Memproses permintaan");
      setText("operationDescription", activeOperations.size > 1 ? `${activeOperations.size} pekerjaan sedang berjalan` : "Sedang diproses · kontrol terkait dikunci sementara");
      status.classList.toggle("multiple-operations", activeOperations.size > 1);
    }
  }
  document.body.classList.toggle("has-active-operation", active);
}
function beginOperation(label = "Memproses permintaan", button = focusedActionButton()) {
  const id = ++operationSequence;
  const title = String(label || operationLabelFromButton(button) || "Memproses permintaan");
  let buttonSnapshot = null;
  if (button && button.isConnected && !button.disabled && !button.dataset.uiOperationId) {
    buttonSnapshot = { disabled: button.disabled, ariaBusy: button.getAttribute("aria-busy"), id };
    button.dataset.uiOperationId = String(id);
    button.disabled = true;
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
    const spinner = document.createElement("span");
    spinner.className = "button-inline-spinner";
    spinner.setAttribute("aria-hidden", "true");
    button.prepend(spinner);
  }
  activeOperations.set(id, { label: title, startedAt: Date.now() });
  updateOperationFeedback();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeOperations.delete(id);
    if (buttonSnapshot && button?.isConnected && button.dataset.uiOperationId === String(id)) {
      button.querySelector(":scope > .button-inline-spinner")?.remove();
      button.classList.remove("is-loading");
      button.disabled = buttonSnapshot.disabled;
      if (buttonSnapshot.ariaBusy === null) button.removeAttribute("aria-busy");
      else button.setAttribute("aria-busy", buttonSnapshot.ariaBusy);
      delete button.dataset.uiOperationId;
    }
    updateOperationFeedback();
  };
}
async function withOperation(label, task, button = focusedActionButton()) {
  const finish = beginOperation(label || operationLabelFromButton(button), button);
  try { return await task(); }
  finally { finish(); }
}
function debounce(callback, delay = 120) {
  let timer = null;
  return function debounced(...args) {
    const receiver = this;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback.apply(receiver, args), delay);
  };
}
function showToast(title, message = "", type = "success") {
  const stack = $("toastStack");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const symbol = document.createElement("span"); symbol.className = "toast-symbol"; symbol.textContent = type === "error" ? "!" : type === "warning" ? "i" : "✓";
  const body = document.createElement("div");
  const heading = document.createElement("strong"); heading.textContent = title;
  const detail = document.createElement("p"); detail.textContent = message;
  body.append(heading);
  if (message) body.append(detail);
  toast.append(symbol, body);
  stack.append(toast);
  const id = ++toastCounter;
  window.setTimeout(() => { if (toast.isConnected && id <= toastCounter) toast.remove(); }, 5200);
}
async function action(fn, successMessage = "", successTitle = "Berhasil", options = {}) {
  const button = options.button || focusedActionButton();
  const finish = beginOperation(options.label || operationLabelFromButton(button), button);
  try {
    const result = await fn();
    if (result?.requiresPassword) throw new Error("Tindakan memerlukan password MySQL. Buka kembali tindakan dan masukkan password saat diminta.");
    if (result?.ok === false) throw new Error(result.detail || "Operasi tidak berhasil.");
    if (options.refresh && result !== null) await refreshState(true);
    if (successMessage && result !== null && result !== false) showToast(successTitle, successMessage, "success");
    return result;
  } catch (error) {
    showToast("Terjadi kendala", error?.message || String(error), "error");
    return null;
  } finally {
    finish();
  }
}

let mysqlPasswordResolver = null;
function requestMysqlPassword(description = "Masukkan password root MySQL/MariaDB Laragon untuk shutdown secara normal.") {
  return new Promise(resolve => {
    mysqlPasswordResolver = resolve;
    const backdrop = $("mysqlStopPasswordModal");
    const input = $("mysqlStopPasswordInput");
    setText("mysqlStopPasswordDescription", description);
    input.value = "";
    backdrop.hidden = false;
    window.setTimeout(() => input.focus(), 0);
  });
}
function finishMysqlPasswordPrompt(password) {
  const backdrop = $("mysqlStopPasswordModal");
  if (backdrop.hidden) return;
  backdrop.hidden = true;
  $("mysqlStopPasswordInput").value = "";
  const resolve = mysqlPasswordResolver;
  mysqlPasswordResolver = null;
  if (resolve) resolve(password);
}
$("mysqlStopPasswordForm").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  finishMysqlPasswordPrompt($("mysqlStopPasswordInput").value);
});
$("cancelMysqlStopPassword").addEventListener("click", () => finishMysqlPasswordPrompt(null));
$("closeMysqlStopPasswordModal").addEventListener("click", () => finishMysqlPasswordPrompt(null));
$("mysqlStopPasswordModal").addEventListener("click", event => {
  if (event.target === event.currentTarget) finishMysqlPasswordPrompt(null);
});
async function stopServiceWithPassword(serviceId) {
  let result = await window.studio.stopService(serviceId);
  if (result?.requiresPassword) {
    const password = await requestMysqlPassword(result.detail);
    if (password === null) return null;
    result = await window.studio.stopService(serviceId, { password });
  }
  if (result?.requiresPassword || result?.ok === false) throw new Error(result.detail || "Shutdown MySQL tidak berhasil.");
  return result;
}
async function restartServiceWithPassword(serviceId) {
  let result = await window.studio.restartService(serviceId);
  if (result?.requiresPassword) {
    const password = await requestMysqlPassword(result.detail);
    if (password === null) return null;
    result = await window.studio.restartService(serviceId, { password });
  }
  if (result?.requiresPassword || result?.ok === false) throw new Error(result.detail || "Restart layanan tidak berhasil.");
  return result;
}

function changePage(page) {
  if (!PAGE_TITLES[page]) return;
  currentPage = page;
  document.querySelectorAll(".page").forEach((item) => item.classList.toggle("active", item.id === `page-${page}`));
  document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
    const active = item.dataset.page === page;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  // Keep the sidebar independent; reset only the scrollable content pane on navigation.
  const contentWrap = document.querySelector(".content-wrap");
  if (contentWrap) contentWrap.scrollTop = 0;
  setText("breadcrumbCurrent", PAGE_TITLES[page]);
  if (page === "dashboard") renderDashboard();
  if (page === "logs") renderLogs();
  if (page === "projects") renderProjects();
  if (page === "services") renderServices();
  if (page === "tools") renderDeveloperTools();
  if (page === "settings") { renderVersionInventory(); renderRuntimeSelectors(); }
  if (page === "hub") renderAppHub();
}
function setTheme(theme, persist = true) {
  const validTheme = theme === "light" ? "light" : "dark";
  document.body.dataset.theme = validTheme;
  document.documentElement.style.colorScheme = validTheme;
  setText("themeGlyph", validTheme === "dark" ? "☼" : "☾");
  document.querySelectorAll(".theme-option").forEach((option) => option.classList.toggle("active", option.dataset.themeChoice === validTheme));
  if (persist) action(() => window.studio.setTheme(validTheme), `Tema ${validTheme === "dark" ? "gelap" : "terang"} diterapkan.`, "Tema diperbarui");
}
function getStackServiceIds() {
  const webServer = state?.settings?.preferredWebServer === "nginx" ? "nginx" : "apache";
  return [webServer, "mysql"];
}
function updateHeaderControls() {
  const start = $("headerStartStack");
  const stop = $("headerStopStack");
  const pill = $("overallStatus");
  const label = $("overallStatusLabel");
  const startLabel = $("headerStartLabel");
  const stopLabel = $("headerStopLabel");
  const ids = getStackServiceIds();
  const services = ids.map(id => (state?.services || []).find(item => item.id === id)).filter(Boolean);
  const runningServices = services.filter(item => item.running);
  const stoppableServices = runningServices.filter(item => item.stopSupported);
  const startableServices = services.filter(item => item.startSupported && !item.running && !item.unverifiedRunning && (!item.externalRunning || item.canStartAlongsideExternal));
  const blocked = services.find(item => !item.running && (item.unverifiedRunning || (item.externalRunning && !item.canStartAlongsideExternal)));
  const detected = Boolean(state?.detected);
  const allRunning = services.length > 0 && runningServices.length === services.length;
  const partiallyRunning = runningServices.length > 0 && !allRunning;

  if (start) {
    start.disabled = !detected || serviceMutationInFlight || startableServices.length === 0;
    start.setAttribute("aria-disabled", String(start.disabled));
    start.setAttribute("aria-busy", String(serviceMutationInFlight));
    start.title = !detected ? "Hubungkan folder Laragon terlebih dahulu." : serviceMutationInFlight ? "Tunggu operasi layanan selesai." : !startableServices.length ? (blocked?.controlReason || (allRunning ? "Stack sudah berjalan." : "Tidak ada layanan stack yang dapat dimulai. Periksa konfigurasi dan konflik port.")) : partiallyRunning ? "Mulai layanan stack yang masih berhenti." : "Mulai web server pilihan dan MySQL Laragon.";
    if (startLabel) startLabel.textContent = partiallyRunning ? "Lengkapi stack" : "Mulai stack";
  }
  if (stop) {
    stop.disabled = !detected || serviceMutationInFlight || stoppableServices.length === 0;
    stop.setAttribute("aria-disabled", String(stop.disabled));
    stop.setAttribute("aria-busy", String(serviceMutationInFlight));
    stop.title = !detected ? "Hubungkan folder Laragon terlebih dahulu." : serviceMutationInFlight ? "Tunggu operasi layanan selesai." : stoppableServices.length === 0 ? (runningServices.length ? "Layanan berjalan, tetapi kontrol stop belum bisa diverifikasi aman." : "Tidak ada layanan Laragon terverifikasi yang sedang berjalan.") : "Hentikan layanan Laragon yang terverifikasi secara tertib.";
    if (stopLabel) stopLabel.textContent = "Hentikan stack";
  }

  const startAll = $("startAllServices");
  if (startAll) startAll.dataset.baseDisabled = String(!detected || startableServices.length === 0);
  const stopAll = $("stopAllServices");
  if (stopAll) stopAll.dataset.baseDisabled = String(!detected || stoppableServices.length === 0);

  document.querySelectorAll("[data-stack-mutation='true']").forEach(button => {
    if (button.id === "headerStartStack" || button.id === "headerStopStack") return;
    button.disabled = serviceMutationInFlight || button.dataset.baseDisabled === "true";
    button.setAttribute("aria-disabled", String(button.disabled));
  });
  document.querySelectorAll("[data-service-mutation='true']").forEach(button => {
    button.disabled = serviceMutationInFlight || button.dataset.baseDisabled === "true";
    button.setAttribute("aria-disabled", String(button.disabled));
  });

  if (pill && label) {
    pill.classList.toggle("connected", allRunning);
    pill.classList.toggle("partial", partiallyRunning);
    pill.classList.toggle("idle", detected && runningServices.length === 0 && !blocked);
    pill.classList.toggle("conflict", detected && Boolean(blocked));
    if (!detected) label.textContent = "Laragon belum terhubung";
    else if (serviceMutationInFlight) label.textContent = "Mengelola stack…";
    else if (services.length === 0) label.textContent = "Layanan tidak ditemukan";
    else if (allRunning) label.textContent = `Stack aktif · ${runningServices.length}/${services.length}`;
    else if (partiallyRunning && blocked) label.textContent = `Sebagian aktif · konflik`;
    else if (partiallyRunning) label.textContent = `Stack sebagian · ${runningServices.length}/${services.length}`;
    else if (blocked) label.textContent = "Konflik layanan";
    else label.textContent = "Stack berhenti";
    pill.title = blocked?.controlReason || (allRunning ? "Semua layanan utama stack terdeteksi berjalan." : partiallyRunning ? "Sebagian layanan utama berjalan." : "Status layanan utama Laragon.");
  }
}

function setConnection(connected, root) {
  $("connectionStatus").classList.toggle("connected", connected);
  setText("connectionTitle", connected ? "Laragon terhubung" : "Laragon belum terhubung");
  setText("connectionSubtitle", connected ? shortPath(root, 27) : "Pilih folder instalasi");
  $("connectionStatus").title = connected ? "Instalasi terdeteksi" : "Instalasi belum terdeteksi";
  $("setupNotice").hidden = connected;
  setText("workspaceName", connected ? shortPath(root, 24) : "Ruang kerja lokal");
  setText("settingsWwwPath", state?.www || "Belum tersedia");
  setText("integrationStatusTitle", connected ? "Instalasi Laragon ditemukan" : "Laragon belum terhubung");
  setText("integrationStatusDescription", connected ? "Folder instalasi berhasil dideteksi." : "Pilih folder yang berisi laragon.exe.");
  setText("integrationRootPath", root || "Lokasi belum diatur");
  setText("integrationStateBadge", connected ? "TERHUBUNG" : "BELUM TERHUBUNG");
  $("integrationStateBadge").classList.toggle("connected", connected);
  setText("statRootValue", connected ? shortPath(root, 29) : "Belum terhubung");
  setText("statRootHint", connected ? "Folder instalasi terdeteksi" : "Atur lokasi folder Laragon");
  updateHeaderControls();
}
function serviceIconClass(id) { return id === "apache" || id === "nginx" || id === "mysql" || id === "postgresql" || id === "redis" || id === "memcached" || id === "mailpit" ? id : ""; }
function createStatusPip(running) { const pip = document.createElement("span"); pip.className = `status-pip${running ? " success-pip" : ""}`; return pip; }
function renderVersionInventory() {
  const container = $("versionInventory");
  if (!container) return;
  container.replaceChildren();
  const versions = state?.versions || {};
  for (const tool of ["php", "apache", "nginx"]) {
    const card = document.createElement("div"); card.className = "version-inventory-card";
    const top = document.createElement("div"); top.className = "version-inventory-top";
    const title = document.createElement("strong"); title.textContent = tool === "php" ? "PHP" : titleCase(tool);
    const count = document.createElement("span"); count.textContent = String((versions[tool] || []).length);
    top.append(title, count);
    const list = document.createElement("div"); list.className = "version-chip-list";
    const entries = (versions[tool] || []).slice(0, 8);
    if (!entries.length) {
      const none = document.createElement("span"); none.className = "version-none"; none.textContent = "Tidak ada folder versi yang terdeteksi"; list.append(none);
    } else {
      for (const version of entries) { const chip = document.createElement("span"); chip.className = "version-chip"; chip.textContent = version; chip.title = version; list.append(chip); }
      if ((versions[tool] || []).length > 8) { const more = document.createElement("span"); more.className = "version-chip more"; more.textContent = `+${versions[tool].length - 8}`; list.append(more); }
    }
    card.append(top, list); container.append(card);
  }
}

function renderRuntimeSelectors() {
  const container = $("runtimeSelectors");
  if (!container) return;
  container.replaceChildren();
  const versions = state?.versions || {};
  const saved = state?.settings?.selectedVersions || {};
  const tools = [
    ["php", "PHP CLI", "Digunakan untuk terminal SXL Cover"],
    ["node", "Node.js", "Digunakan untuk terminal SXL Cover"],
    ["apache", "Apache", "Versi yang dipakai saat layanan dijalankan"],
    ["nginx", "Nginx", "Versi yang dipakai saat layanan dijalankan"],
    ["mysql", "MySQL / MariaDB", "Versi yang dipakai saat layanan dijalankan"],
    ["postgresql", "PostgreSQL", "Versi yang dipakai saat layanan dijalankan"],
    ["redis", "Redis", "Versi yang dipakai saat layanan dijalankan"],
    ["memcached", "Memcached", "Versi yang dipakai saat layanan dijalankan"],
    ["mailpit", "Mailpit", "Versi yang dipakai saat layanan dijalankan"]
  ];
  for (const [tool, label, hint] of tools) {
    const available = versions[tool] || [];
    const row = document.createElement("div"); row.className = "runtime-selector";
    const copy = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = label;
    const desc = document.createElement("small"); desc.textContent = hint;
    copy.append(name, desc);
    const select = document.createElement("select"); select.setAttribute("aria-label", `Versi ${label}`);
    const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = available.length ? "Pilih versi…" : "Tidak terpasang"; placeholder.disabled = available.length > 0; placeholder.selected = !available.length; select.append(placeholder);
    for (const version of available) {
      const option = document.createElement("option"); option.value = version; option.textContent = version;
      select.append(option);
    }
    const selected = saved[tool] || state?.serviceCapabilities?.[tool]?.selectedVersion || available.at(-1) || "";
    if (selected && available.includes(selected)) select.value = selected;
    select.disabled = !state?.detected || available.length === 0;
    select.addEventListener("change", async () => {
      if (!select.value) return;
      await action(() => window.studio.selectRuntime(tool, select.value), `${label} disetel ke ${select.value}. Pengaturan berlaku untuk start berikutnya/terminal baru.`, "Runtime diperbarui", { refresh: true });
    });
    row.append(copy, select); container.append(row);
  }
}

function renderServicePreview(services) {
  const container = $("dashboardServices"); container.replaceChildren();
  const selected = services.slice(0, 4);
  for (const service of selected) {
    const card = document.createElement("article"); card.className = "service-preview";
    const symbol = document.createElement("div"); symbol.className = `service-symbol ${serviceIconClass(service.id)}`; symbol.textContent = SERVICE_ICONS[service.id] || "•";
    const copy = document.createElement("div"); copy.className = "service-preview-copy";
    const name = document.createElement("strong"); name.textContent = service.label;
    const status = document.createElement("small"); status.className = service.running ? "running" : "";
    status.append(createStatusPip(service.running));
    const text = document.createElement("span"); text.textContent = !service.supported ? "Status tidak diketahui" : service.running ? "Proses terdeteksi" : service.supported ? "Siap dijalankan" : "Belum dikonfigurasi";
    status.append(text); copy.append(name, status);
    const arrow = document.createElement("span"); arrow.className = "preview-open"; arrow.textContent = "↗";
    card.append(symbol, copy, arrow); card.title = "Lihat detail layanan"; card.tabIndex = 0;
    card.addEventListener("click", () => changePage("services"));
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") changePage("services"); });
    container.append(card);
  }
  if (!selected.length) {
    const empty = document.createElement("div"); empty.className = "empty-small"; empty.textContent = "Informasi layanan akan ditampilkan di sini."; container.append(empty);
  }
}
function createActivityRow(entry, compact = false) {
  const row = document.createElement("div"); row.className = "activity-row";
  const marker = document.createElement("span"); marker.className = `activity-marker ${entry.level || "info"}`;
  marker.textContent = entry.level === "success" ? "✓" : entry.level === "error" ? "!" : entry.level === "warning" ? "△" : "·";
  const body = document.createElement("div"); body.className = "activity-main";
  const message = document.createElement("strong"); message.textContent = entry.message || "Aktivitas";
  const detail = document.createElement("small"); detail.textContent = entry.detail || (entry.time ? formatTime(entry.time, true) : "Aktivitas lokal");
  body.append(message, detail);
  const time = document.createElement("span"); time.className = "activity-time"; time.textContent = formatTime(entry.time);
  row.append(marker, body, time);
  if (compact) row.classList.add("compact");
  return row;
}
function renderRecentProjects(projects) {
  const container = $("recentProjects"); container.replaceChildren();
  const recent = projects.slice(0, 4);
  $("recentProjectsEmpty").hidden = recent.length > 0;
  for (const project of recent) {
    const row = document.createElement("div"); row.className = "recent-project";
    const icon = document.createElement("div"); icon.className = "project-file-icon"; icon.textContent = TYPE_ICONS[project.type] || "▤";
    const main = document.createElement("div"); main.className = "project-main";
    const name = document.createElement("strong"); name.textContent = project.name;
    const path = document.createElement("small"); path.textContent = shortPath(project.path, 48);
    main.append(name, path);
    if (project.url) { const url = document.createElement("span"); url.className = "project-url"; url.textContent = project.url.replace(/^https?:\/\//, ""); row.append(icon, main, url); }
    else row.append(icon, main);
    const open = document.createElement("button"); open.className = "mini-action"; open.textContent = "↗"; open.title = project.url ? "Buka di browser" : "Buka folder";
    open.addEventListener("click", () => project.url ? action(() => window.studio.openProjectUrl(project.url)) : action(() => window.studio.openProjectFolder(project.path)));
    row.append(open); container.append(row);
  }
}
function renderDashboard() {
  if (!state) return;
  const services = state.services || [];
  const projects = state.projects || [];
  const running = services.filter(service => service.running).length;
  setText("statProjects", projects.length);
  setText("statRunning", running);
  setText("statPhp", (state.versions?.php || []).length);
  setText("statProjectHint", state.detected ? `Proyek ditemukan di ${shortPath(state.www, 27)}` : "Hubungkan Laragon untuk memindai folder www");
  setText("statServiceHint", state.detected ? `${running} dari ${services.length} proses yang dikenal terdeteksi` : "Hubungkan Laragon untuk memeriksa layanan");
  renderServicePreview(services);
  renderVersionInventory();
  renderRecentProjects(projects);
  const entries = state.activityLogs || [];
  const activity = $("dashboardActivity"); activity.replaceChildren();
  $("activityEmpty").hidden = entries.length > 0;
  for (const entry of entries.slice(0, 4)) activity.append(createActivityRow(entry, true));
  setText("navProjectCount", projects.length);
  setText("currentDate", formatDate());
  setText("currentTime", formatTime(new Date()));
}
function visibleProjects() {
  const projects = state?.projects || [];
  return projects.filter((project) => {
    if (projectFilter === "www" && project.source !== "www") return false;
    if (projectFilter === "registered" && project.source === "www") return false;
    if (projectQuery) {
      const needle = projectQuery.toLowerCase();
      if (![project.name, project.path, project.type, project.hostname, project.url].some(value => String(value || "").toLowerCase().includes(needle))) return false;
    }
    return true;
  });
}
function makeProjectCard(project) {
  const card = document.createElement("article"); card.className = "project-card";
  const top = document.createElement("div"); top.className = "project-card-top";
  const icon = document.createElement("div"); icon.className = "project-card-icon"; icon.textContent = TYPE_ICONS[project.type] || "▤";
  const badge = document.createElement("span"); badge.className = "project-card-badge"; badge.textContent = project.source === "www" ? "FOLDER WWW" : project.source === "legacy" ? "DIMIGRASIKAN" : "TERDAFTAR";
  top.append(icon, badge);
  const body = document.createElement("div"); body.className = "project-card-body";
  const title = document.createElement("h3"); title.className = "project-card-name"; title.textContent = project.name;
  const path = document.createElement("div"); path.className = "project-card-path"; path.textContent = project.path; path.title = project.path;
  const typeRow = document.createElement("div"); typeRow.className = "project-type-row";
  const projectType = String(project.type || "");
  const typePip = document.createElement("i"); typePip.className = `type-pip ${projectType === "Node.js" ? "node" : projectType === "Laravel" ? "laravel" : projectType.includes("PHP") ? "php" : ""}`;
  const typeText = document.createElement("span"); typeText.textContent = projectType || "Folder proyek"; typeRow.append(typePip, typeText);
  body.append(title, path, typeRow);
  if (project.url) {
    const url = document.createElement("div"); url.className = "project-card-url";
    const globe = document.createElement("span"); globe.textContent = "◎";
    const address = document.createElement("span"); address.textContent = project.url; address.title = project.url;
    url.append(globe, address); body.append(url);
  } else {
    const noUrl = document.createElement("div"); noUrl.className = "project-card-url";
    const globe = document.createElement("span"); globe.textContent = "◎";
    const address = document.createElement("span"); address.textContent = "URL belum dikonfigurasi";
    noUrl.append(globe, address); body.append(noUrl);
  }
  const foot = document.createElement("div"); foot.className = "project-card-foot";
  const actions = document.createElement("div"); actions.className = "project-card-actions";
  const folder = document.createElement("button"); folder.className = "button button-secondary"; folder.textContent = "↗ Buka folder"; folder.addEventListener("click", () => action(() => window.studio.openProjectFolder(project.path), "Folder proyek dibuka."));
  const open = document.createElement("button"); open.className = `button ${project.url ? "button-primary" : "button-secondary"}`; open.textContent = "Buka URL ↗"; open.disabled = !project.url; open.title = project.url ? "Buka URL proyek" : "Daftarkan hostname terlebih dahulu";
  open.addEventListener("click", () => project.url && action(() => window.studio.openProjectUrl(project.url), "URL proyek dibuka. Pastikan web server di SXL Cover berjalan."));
  const terminal = document.createElement("button"); terminal.className = "button button-secondary"; terminal.textContent = "⌘ Terminal"; terminal.addEventListener("click", () => action(() => window.studio.openTerminal(project.path), "Terminal dibuka di folder proyek."));
  actions.append(folder, open, terminal); foot.append(actions);
  const taskOptions = project.type === "Laravel"
    ? [["composer-install", "Composer install"], ["artisan-serve", "Laravel serve"], ["artisan-optimize-clear", "Laravel optimize:clear"]]
    : project.type === "Node.js"
      ? [["npm-install", "npm install"], ["npm-dev", "npm run dev"], ["npm-build", "npm run build"]]
      : project.type === "PHP / Composer"
        ? [["composer-install", "Composer install"], ["composer-update", "Composer update"], ["php-server", "PHP server :8080"]]
        : project.type === "PHP" ? [["php-server", "PHP server :8080"]] : [];
  if (taskOptions.length) {
    const taskWrap = document.createElement("div"); taskWrap.className = "project-task-row";
    const taskSelect = document.createElement("select"); taskSelect.className = "project-task-select"; taskSelect.setAttribute("aria-label", `Tugas cepat untuk ${project.name}`);
    const taskPlaceholder = document.createElement("option"); taskPlaceholder.value = ""; taskPlaceholder.textContent = "Tugas cepat…"; taskPlaceholder.selected = true; taskSelect.append(taskPlaceholder);
    for (const [taskId, taskLabel] of taskOptions) { const option = document.createElement("option"); option.value = taskId; option.textContent = taskLabel; taskSelect.append(option); }
    const runTask = document.createElement("button"); runTask.className = "button button-secondary button-small"; runTask.textContent = "Jalankan";
    runTask.addEventListener("click", async () => {
      const taskId = taskSelect.value;
      const selectedOption = taskOptions.find(item => item[0] === taskId);
      if (!selectedOption) { showToast("Pilih tugas", "Pilih salah satu tugas proyek terlebih dahulu.", "warning"); return; }
      const caution = ["composer-install", "composer-update", "npm-install", "npm-dev", "npm-build"].includes(taskId)
        ? "\n\nPerintah dapat mengunduh paket atau menjalankan skrip proyek. Lanjutkan hanya jika proyek dipercaya."
        : "";
      if (!window.confirm(`Buka terminal dan jalankan '${selectedOption[1]}' pada ${project.name}?${caution}`)) return;
      await action(() => window.studio.runProjectTask(project.path, taskId), `Terminal dibuka untuk tugas ${selectedOption[1]}.`, "Tugas dibuka");
    });
    taskWrap.append(taskSelect, runTask); foot.append(taskWrap);
  }
  if (project.removable) {
    const remove = document.createElement("button"); remove.className = "button button-secondary icon-action"; remove.textContent = "×"; remove.title = "Hapus dari daftar";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Lepaskan ${project.name} dari daftar? File folder tidak akan dihapus.`)) return;
      await action(() => window.studio.removeProject(project.id), "Proyek dilepas dari daftar.", "Berhasil", { refresh: true });
    });
    const manage = document.createElement("div"); manage.className = "project-card-manage"; manage.append(remove); foot.append(manage);
  }
  card.append(top, body, foot); return card;
}
function renderProjects() {
  if (!state) return;
  const all = state.projects || [];
  const filtered = visibleProjects();
  setText("filterAllCount", all.length);
  const container = $("projectsGrid"); container.replaceChildren();
  container.classList.toggle("list-view", projectListMode === "list");
  for (const project of filtered) container.append(makeProjectCard(project));
  $("projectsEmpty").hidden = filtered.length > 0;
  setText("navProjectCount", all.length);
}
function renderServices() {
  if (!state) return;
  const container = $("servicesGrid"); container.replaceChildren();
  const preferred = state.settings?.preferredWebServer === "nginx" ? "nginx" : "apache";
  if ($("preferredWebServerSelect")) $("preferredWebServerSelect").value = preferred;
  const allServices = state.services || [];
  const services = allServices.filter(service => {
    if (serviceQuery && !`${service.label} ${service.category} ${service.id}`.toLowerCase().includes(serviceQuery.toLowerCase())) return false;
    const blocked = Boolean(!service.running && (service.unverifiedRunning || (service.externalRunning && !service.canStartAlongsideExternal)));
    if (serviceFilter === "running" && !service.running) return false;
    if (serviceFilter === "stopped" && (service.running || blocked)) return false;
    if (serviceFilter === "problem" && !blocked && service.supported) return false;
    return true;
  });
  setText("serviceResultCount", `${services.length} dari ${allServices.length} layanan`);
  for (const service of services) {
    const card = document.createElement("article"); card.className = "service-card";
    const head = document.createElement("div"); head.className = "service-card-head";
    const symbol = document.createElement("div"); symbol.className = `service-symbol ${serviceIconClass(service.id)}`; symbol.textContent = SERVICE_ICONS[service.id] || "•";
    const title = document.createElement("div"); title.className = "service-card-title";
    const name = document.createElement("h3"); name.textContent = service.label;
    const category = document.createElement("p"); category.textContent = service.category || "Layanan";
    title.append(name, category);
    const processBlocked = !service.running && (service.unverifiedRunning || (service.externalRunning && !service.canStartAlongsideExternal));
    const statePip = document.createElement("span"); statePip.className = `service-state${service.running ? " running" : processBlocked ? " conflict" : ""}`;
    head.append(symbol, title, statePip);
    const metadata = document.createElement("div"); metadata.className = "service-metadata";
    const statusBlock = document.createElement("div"); const statusLabel = document.createElement("small"); statusLabel.textContent = "Status proses"; const status = document.createElement("strong");
    status.textContent = service.running ? "Berjalan di Laragon" : service.externalRunning ? `Eksternal aktif${service.externalPorts?.length ? ` · port ${service.externalPorts.join(", ")}` : ""}` : service.unverifiedRunning ? "Jalur tidak terverifikasi" : service.supported ? "Berhenti" : "Belum dikonfigurasi";
    statusBlock.append(statusLabel, status);
    const pidBlock = document.createElement("div"); const pidLabel = document.createElement("small"); pidLabel.textContent = "PID terdeteksi"; const pidValue = document.createElement("strong"); pidValue.textContent = service.pids?.length ? service.pids.join(", ") : "—"; pidBlock.append(pidLabel, pidValue);
    metadata.append(statusBlock, pidBlock);
    if (service.controlReason && (!service.supported || processBlocked || service.canStartAlongsideExternal)) { const reason = document.createElement("p"); reason.className = "service-card-reason"; reason.textContent = service.controlReason; card.append(head, metadata, reason); }
    else card.append(head, metadata);
    const actions = document.createElement("div"); actions.className = "service-card-actions";
    const canStartStop = service.running ? service.stopSupported : service.startSupported;
    const toggle = document.createElement("button"); toggle.className = `button ${service.running ? "button-secondary" : "button-primary"}`; toggle.textContent = processBlocked ? "Tidak tersedia" : service.running ? "■ Hentikan" : "▶ Mulai"; toggle.dataset.serviceMutation = "true"; toggle.dataset.baseDisabled = String(!state.detected || !canStartStop || processBlocked); toggle.disabled = serviceMutationInFlight || toggle.dataset.baseDisabled === "true"; toggle.title = service.controlReason || "Kontrol layanan langsung dari SXL Cover";
    toggle.addEventListener("click", async event => {
      if (service.running && service.id === "mysql" && !window.confirm("Shutdown MySQL secara tertib? Pastikan tidak ada proses impor/ekspor atau transaksi yang sedang berjalan.")) return;
      const fn = service.running ? () => stopServiceWithPassword(service.id) : () => window.studio.startService(service.id);
      await runServiceMutation(event.currentTarget, `${service.running ? "Menghentikan" : "Menjalankan"} ${service.label}`, fn, service.running ? "Layanan dihentikan" : "Layanan dimulai", `${service.label}: status akhir berhasil diverifikasi.`, { serviceId: service.id, expectedRunning: !service.running });
    });
    actions.append(toggle);
    const restart = document.createElement("button"); restart.className = "button button-secondary"; restart.textContent = "↻ Restart";
    restart.dataset.serviceMutation = "true"; restart.dataset.baseDisabled = String(!state.detected || !service.startSupported || processBlocked || (!service.running && service.externalRunning)); restart.disabled = serviceMutationInFlight || restart.dataset.baseDisabled === "true";
    restart.title = (!service.running && service.externalRunning) ? "Proses yang terdeteksi berasal dari instalasi lain. Mulai dulu MySQL Laragon; SXL Cover tidak akan me-restart layanan eksternal." : (service.controlReason || "Hentikan secara tertib, lalu jalankan kembali layanan ini.");
    restart.addEventListener("click", async event => {
      const warning = service.id === "mysql" || service.id === "postgresql" ? "\nPastikan tidak ada impor, ekspor, atau transaksi database yang sedang berjalan." : "";
      if (!window.confirm(`Restart ${service.label}? Proses aktif dapat terputus.${warning}`)) return;
      await runServiceMutation(event.currentTarget, `Restart ${service.label}`, () => restartServiceWithPassword(service.id), "Layanan di-restart", `${service.label}: status berjalan berhasil diverifikasi.`, { serviceId: service.id, expectedRunning: true });
    });
    actions.append(restart);
    if (service.reloadable) {
      const reload = document.createElement("button"); reload.className = "button button-secondary"; reload.textContent = "↻ Muat ulang"; reload.dataset.serviceMutation = "true"; reload.dataset.baseDisabled = String(!state.detected || !service.running || !service.reloadable); reload.disabled = serviceMutationInFlight || reload.dataset.baseDisabled === "true";
      reload.addEventListener("click", async event => {
        if (!window.confirm(`Reload konfigurasi ${service.label}? Koneksi aktif mungkin terdampak.`)) return;
        await runServiceMutation(event.currentTarget, `Memuat ulang ${service.label}`, () => window.studio.reloadService(service.id), "Perintah reload dikirim", `${service.label}: perintah berhasil dikirim; status layanan diperiksa kembali.`, { serviceId: service.id, expectedRunning: true });
      });
      actions.append(reload);
    }
    const terminal = document.createElement("button"); terminal.className = "button button-secondary"; terminal.textContent = "Buka terminal"; terminal.title = "Buka terminal dengan lingkungan Laragon";
    terminal.addEventListener("click", () => action(() => window.studio.openTerminal(state.www), "Terminal dibuka dari SXL Cover."));
    actions.append(terminal);
    card.append(actions); container.append(card);
  }
  renderRuntimeSelectors();
}

function renderDeveloperTools() {
  if (!state) return;
  const list = $("diagnosticsList");
  if (list) {
    list.replaceChildren();
    const checks = state.environmentDiagnostics || [];
    const counts = { ok: 0, warning: 0, error: 0, info: 0 };
    const labels = { ok: "Siap", warning: "Periksa", error: "Masalah", info: "Info" };
    for (const check of checks) {
      counts[check.status] = (counts[check.status] || 0) + 1;
      const row = document.createElement("div"); row.className = `diagnostic-row diagnostic-${check.status}`;
      const icon = document.createElement("span"); icon.className = "diagnostic-icon";
      icon.textContent = check.status === "ok" ? "✓" : check.status === "error" ? "!" : check.status === "warning" ? "△" : "i";
      const copy = document.createElement("div"); copy.className = "diagnostic-copy";
      const title = document.createElement("strong"); title.textContent = check.label;
      const detail = document.createElement("small"); detail.textContent = check.detail;
      copy.append(title, detail);
      if (check.path) { const pathLine = document.createElement("code"); pathLine.textContent = check.path; pathLine.title = check.path; copy.append(pathLine); }
      const badge = document.createElement("span"); badge.className = `diagnostic-badge ${check.status}`; badge.textContent = labels[check.status] || "Info";
      row.append(icon, copy, badge); list.append(row);
    }
    setText("diagnosticSummary", counts.error ? `${counts.error} masalah` : counts.warning ? `${counts.warning} perlu dicek` : `${counts.ok} siap`);
    $("diagnosticSummary").className = `diagnostic-summary ${counts.error ? "error" : counts.warning ? "warning" : "ok"}`;
    if (!checks.length) { const empty = document.createElement("p"); empty.className = "empty-small"; empty.textContent = "Belum ada data diagnosis."; list.append(empty); }
  }
  const overview = $("toolsVersionOverview");
  if (overview) {
    overview.replaceChildren();
    const versions = state.versions || {};
    const selected = state.settings?.selectedVersions || {};
    const runtimeMeta = [
      ["php", "PHP", "php"], ["node", "Node.js", "node"], ["composer", "Composer", "composer"],
      ["apache", "Apache", "apache"], ["nginx", "Nginx", "nginx"], ["mysql", "MySQL / MariaDB", "mysql"],
      ["postgresql", "PostgreSQL", "postgresql"], ["redis", "Redis", "redis"], ["memcached", "Memcached", "memcached"], ["mailpit", "Mailpit", "mailpit"]
    ];
    for (const [key, label, versionKey] of runtimeMeta) {
      if (key === "composer") {
        const check = (state.environmentDiagnostics || []).find(item => item.id === "composer");
        const row = document.createElement("div"); row.className = "tool-version-row";
        const left = document.createElement("span"); left.textContent = label;
        const right = document.createElement("strong"); right.textContent = check?.status === "ok" ? "Terdeteksi" : "Belum terdeteksi";
        row.append(left, right); overview.append(row); continue;
      }
      const available = versions[versionKey] || [];
      const row = document.createElement("div"); row.className = "tool-version-row";
      const left = document.createElement("span"); left.textContent = label;
      const right = document.createElement("strong"); right.textContent = available.length ? `${selected[key] || available.at(-1)} · ${available.length} versi` : "Tidak terdeteksi";
      row.append(left, right); overview.append(row);
    }
  }
  const hasRoot = Boolean(state.detected);
  for (const id of ["openRootTerminal", "openWwwTerminal", "openLaragonConfig", "exportDiagnostics", "refreshDiagnostics"]) {
    const button = $(id); if (button) button.disabled = !hasRoot && id !== "exportDiagnostics" && id !== "refreshDiagnostics";
  }
  document.querySelectorAll("[data-local-tool]").forEach(button => {
    const id = button.dataset.localTool;
    let enabled = hasRoot;
    if (id === "phpmyadmin") enabled = hasRoot && (state.environmentDiagnostics || []).some(check => check.id === "phpmyadmin" && check.status === "ok");
    if (id === "adminer") enabled = hasRoot && (state.environmentDiagnostics || []).some(check => check.id === "adminer" && check.status === "ok");
    if (id === "mailpit") enabled = hasRoot && Boolean((state.versions?.mailpit || []).length || (state.services || []).some(service => service.id === "mailpit" && service.running));
    button.disabled = !enabled;
    if (!enabled && id !== "webroot") button.title = "Komponen belum terdeteksi di instalasi yang dipilih.";
  });
}


const COMPONENT_CATEGORY_LABELS = { database: "Database server", dbtool: "Database GUI", developer: "Developer tools", package: "Package manager", api: "API testing" };
function setHubTab(tab) {
  activeHubTab = tab === "databases" ? "databases" : "components";
  document.querySelectorAll("[data-hub-tab]").forEach(button => {
    const active = button.dataset.hubTab === activeHubTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-hub-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.hubPanel === activeHubTab));
  if (activeHubTab === "databases") renderDatabaseProfiles(); else renderComponentCatalog();
}
function appendComponentOutput(entry) {
  const time = entry?.time ? formatTime(entry.time) : formatTime(new Date());
  const line = { time, type: entry?.type || "info", message: String(entry?.message || "") };
  componentOutputLines.push(line);
  if (componentOutputLines.length > 100) componentOutputLines.splice(0, componentOutputLines.length - 100);
  const container = $("componentInstallOutput");
  if (!container) return;
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 36;
  container.querySelector(".install-output-empty")?.remove();
  const row = document.createElement("div"); row.className = `install-output-line ${line.type}`;
  const stamp = document.createElement("time"); stamp.textContent = line.time;
  const level = document.createElement("span"); level.className = "install-output-level"; level.textContent = line.type.toUpperCase();
  const message = document.createElement("span"); message.textContent = line.message;
  row.append(stamp, level, message); container.append(row);
  while (container.querySelectorAll(".install-output-line").length > 100) container.querySelector(".install-output-line")?.remove();
  if (nearBottom) container.scrollTop = container.scrollHeight;
}
function renderComponentCatalog() {
  const grid = $("componentGrid");
  if (!grid || !state) return;
  const hub = state.componentHub || { items: [], wingetAvailable: false, platform: "unknown" };
  setText("wingetStatus", hub.wingetAvailable ? "WinGet tersedia" : "WinGet tidak ditemukan");
  $("wingetStatus").classList.toggle("available", Boolean(hub.wingetAvailable));
  $("wingetHelp").hidden = Boolean(hub.wingetAvailable);
  const items = (hub.items || []).filter(item => {
    const matchesCategory = componentCategory === "all" || item.category === componentCategory;
    const q = componentQuery.toLowerCase();
    const matchesQuery = !q || `${item.name} ${item.packageId} ${item.description} ${item.publisher}`.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });
  setText("catalogCount", (hub.items || []).length);
  setText("componentResultCount", `${items.length} paket`);
  grid.replaceChildren();
  for (const item of items) {
    const card = document.createElement("article"); card.className = "component-card";
    const head = document.createElement("div"); head.className = "component-card-head";
    const icon = document.createElement("div"); icon.className = `component-icon ${item.category}`;
    icon.textContent = item.category === "database" ? "DB" : item.category === "dbtool" ? "▦" : item.category === "package" ? "PKG" : item.category === "api" ? "API" : "⌘";
    const status = document.createElement("span"); status.className = `component-status${item.installed ? " detected" : ""}`; status.textContent = item.installed ? (item.detectedInLaragon ? "Ada di Laragon" : "Terdeteksi") : "Belum terdeteksi";
    head.append(icon, status);
    const title = document.createElement("h3"); title.textContent = item.name;
    const description = document.createElement("p"); description.className = "component-description"; description.textContent = item.description;
    const publisher = document.createElement("div"); publisher.className = "component-publisher"; publisher.textContent = item.publisher;
    const packageId = document.createElement("code"); packageId.className = "component-package-id"; packageId.textContent = item.packageId;
    const category = document.createElement("span"); category.className = "component-category"; category.textContent = COMPONENT_CATEGORY_LABELS[item.category] || "Tools";
    const foot = document.createElement("div"); foot.className = "component-card-foot";
    const website = document.createElement("button"); website.className = "button button-secondary button-small"; website.textContent = "Situs resmi ↗";
    website.addEventListener("click", () => action(() => window.studio.openComponentWebsite(item.id), "Situs vendor dibuka di browser."));
    const install = document.createElement("button"); install.className = "button button-primary button-small";
    if (item.installMethod === "official-link") {
      install.textContent = item.commandAvailable ? "Composer terdeteksi" : "Unduh installer resmi";
      install.disabled = Boolean(item.commandAvailable || componentBusy || !item.installable);
      install.title = item.commandAvailable ? "Composer sudah terdeteksi di PATH. Buka ulang terminal setelah perubahan PATH." : "Membuka unduhan Composer-Setup.exe dari getcomposer.org; installer tidak akan dijalankan otomatis.";
    } else if (!item.installable) { install.textContent = "WinGet tidak tersedia"; install.disabled = true; install.title = "Pasang atau aktifkan App Installer/WinGet di Windows."; }
    else if (componentBusy) { install.textContent = "Sedang diproses…"; install.disabled = true; }
    else if (item.detectedInLaragon && !item.commandAvailable) { install.textContent = "Ada di Laragon"; install.disabled = true; install.title = "Komponen ditemukan di folder Laragon. UI tidak akan mengubah instalasi portabel tersebut."; }
    else { install.textContent = item.commandAvailable ? "Perbarui via WinGet" : "Pasang via WinGet"; install.disabled = false; }
    install.addEventListener("click", () => {
      if (item.installMethod === "official-link") {
        if (!window.confirm("Browser akan membuka unduhan Composer-Setup.exe dari situs resmi getcomposer.org. SXL Cover tidak menjalankan installer secara otomatis. Lanjutkan?")) return;
        action(() => window.studio.openComponentInstaller(item.id), "Unduhan Composer dibuka. Jalankan wizard, pilih PHP Laragon yang sesuai, lalu buka ulang terminal dan SXL Cover.", "Unduhan dibuka");
      } else installComponent(item, item.commandAvailable ? "upgrade" : "install");
    });
    foot.append(website, install);
    card.append(head, title, description, publisher, packageId, category, foot); grid.append(card);
  }
  if (!items.length) { const empty = document.createElement("div"); empty.className = "hub-no-results"; empty.textContent = "Tidak ada komponen yang cocok. Ubah kata kunci atau kategori."; grid.append(empty); }
  if (componentBusy) grid.classList.add("busy"); else grid.classList.remove("busy");
}
async function installComponent(item, mode) {
  const taskLabel = mode === "upgrade" ? "memperbarui" : "memasang";
  const consent = `Kamu akan ${taskLabel} ${item.name}.\n\nPaket: ${item.packageId}\nPenerbit: ${item.publisher}\nSumber: WinGet community repository\n\nSXL Cover akan menjalankan WinGet dengan ID paket yang persis dan menyetujui perjanjian sumber/paket melalui opsi WinGet. Installer dapat meminta izin Administrator atau membuka wizard tambahan. Lanjutkan hanya jika kamu mempercayai penerbit dan persyaratan paket.`;
  if (!window.confirm(consent)) return;
  componentBusy = true;
  const finishOperation = beginOperation(`${mode === "upgrade" ? "Memperbarui" : "Memasang"} ${item.name}`, focusedActionButton());
  $("componentInstallOutput")?.setAttribute("aria-busy", "true");
  appendComponentOutput({ type: "start", message: `${taskLabel} ${item.name} (${item.packageId})…` });
  renderComponentCatalog();
  try {
    const result = await window.studio.installComponent(item.id, mode);
    appendComponentOutput({ type: "success", message: `${item.name}: operasi selesai (exit ${result.exitCode}).` });
    showToast("Operasi komponen selesai", `${item.name} selesai diproses. Periksa output installer dan refresh status.`, "success");
  } catch (error) {
    appendComponentOutput({ type: "error", message: error?.message || String(error) });
    showToast("Instalasi komponen gagal", error?.message || String(error), "error");
  } finally {
    componentBusy = false;
    try { state.componentHub = await window.studio.refreshComponents(); } catch {}
    await refreshState(true);
    $("componentInstallOutput")?.removeAttribute("aria-busy");
    finishOperation();
  }
}
function renderDatabaseProfiles() {
  const grid = $("databaseProfileList"); if (!grid || !state) return;
  const profiles = state.databaseProfiles || state.settings?.databaseProfiles || [];
  setText("databaseProfileCount", profiles.length);
  $("databaseProfilesEmpty").hidden = profiles.length > 0;
  grid.replaceChildren();
  const labels = { mysql: "MySQL", mariadb: "MariaDB", postgresql: "PostgreSQL", mongodb: "MongoDB", sqlite: "SQLite" };
  for (const profile of profiles) {
    const card = document.createElement("article"); card.className = "database-profile-card";
    const head = document.createElement("div"); head.className = "database-profile-head";
    const icon = document.createElement("div"); icon.className = `database-engine-icon ${profile.engine}`; icon.textContent = profile.engine === "sqlite" ? "▧" : profile.engine === "mongodb" ? "M" : "DB";
    const copy = document.createElement("div"); copy.className = "database-profile-title";
    const title = document.createElement("h3"); title.textContent = profile.name;
    const engine = document.createElement("span"); engine.textContent = labels[profile.engine] || profile.engine;
    copy.append(title, engine);
    const edit = document.createElement("button"); edit.className = "icon-button small-icon-button"; edit.textContent = "✎"; edit.title = "Edit profil"; edit.setAttribute("aria-label", `Edit ${profile.name}`); edit.addEventListener("click", () => openDatabaseProfileModal(profile));
    head.append(icon, copy, edit);
    const endpoint = document.createElement("div"); endpoint.className = "database-endpoint";
    endpoint.textContent = profile.engine === "sqlite" ? profile.database : `${profile.host}:${profile.port}`;
    const database = document.createElement("div"); database.className = "database-profile-db"; database.textContent = profile.engine === "sqlite" ? "File database" : `Database: ${profile.database}`;
    const user = document.createElement("div"); user.className = "database-profile-user"; user.textContent = profile.username ? `User: ${profile.username}` : "Autentikasi belum diatur";
    const actions = document.createElement("div"); actions.className = "database-profile-actions";
    const test = document.createElement("button"); test.className = "button button-secondary button-small"; test.textContent = "Uji koneksi"; test.addEventListener("click", async () => {
      await withOperation(`Menguji koneksi · ${profile.name}`, async () => {
        try {
          const result = await window.studio.testDatabaseProfile(profile.id);
          showToast(result.ok ? "Tes berhasil" : "Tes belum berhasil", result.detail, result.ok ? "success" : "warning");
        } catch (error) { showToast("Tes koneksi gagal", error?.message || String(error), "error"); }
      }, test);
    });
    const uri = document.createElement("button"); uri.className = "button button-secondary button-small"; uri.textContent = "Salin URI"; uri.addEventListener("click", () => action(() => window.studio.copyDatabaseUri(profile.id), "URI koneksi tanpa password disalin."));
    const env = document.createElement("button"); env.className = "button button-primary button-small"; env.textContent = ".env.example"; env.addEventListener("click", () => openDatabaseEnvModal(profile.id));
    const remove = document.createElement("button"); remove.className = "button button-quiet button-small"; remove.textContent = "Hapus"; remove.addEventListener("click", async () => {
      if (!window.confirm(`Hapus profil ${profile.name}? Tidak ada file proyek atau database yang akan dihapus.`)) return;
      await action(() => window.studio.removeDatabaseProfile(profile.id), "Profil koneksi dihapus.", "Profil dihapus", { refresh: true });
    });
    actions.append(test, uri, env, remove);
    const note = document.createElement("p"); note.className = "database-profile-note"; note.textContent = profile.engine === "sqlite" ? "Tes file tidak mengeksekusi query SQL." : "Tes koneksi hanya memeriksa port; belum memvalidasi kredensial.";
    card.append(head, endpoint, database, user, actions, note); grid.append(card);
  }
}
function renderAppHub() {
  if (!state) return;
  // Render only the active hub tab; rebuilding both catalogs on each refresh was unnecessary DOM work.
  if (activeHubTab === "databases") renderDatabaseProfiles();
  else renderComponentCatalog();
}
function openDatabaseProfileModal(profile = null) {
  dbEditingId = profile?.id || "";
  $("databaseProfileForm").reset();
  setText("databaseModalTitle", profile ? "Edit profil database" : "Profil database baru");
  $("dbProfileName").value = profile?.name || "";
  $("dbProfileEngine").value = profile?.engine || "mysql";
  $("dbProfileHost").value = profile?.host || "127.0.0.1";
  $("dbProfilePort").value = profile?.port || 3306;
  $("dbProfileDatabase").value = profile?.database || "app_db";
  $("dbProfileUsername").value = profile?.username || "root";
  updateDatabaseEngineFields(false);
  $("databaseProfileModal").hidden = false;
  window.setTimeout(() => $("dbProfileName").focus(), 20);
}
function closeDatabaseProfileModal() { $("databaseProfileModal").hidden = true; }
function updateDatabaseEngineFields(resetValues = true) {
  const engine = $("dbProfileEngine").value;
  const isSqlite = engine === "sqlite";
  const presets = { mysql: 3306, mariadb: 3306, postgresql: 5432, mongodb: 27017, sqlite: 0 };
  $("databaseNetworkFields").hidden = isSqlite;
  $("dbProfileHost").required = !isSqlite;
  $("dbProfilePort").required = !isSqlite;
  $("dbProfileHost").disabled = isSqlite;
  $("dbProfilePort").disabled = isSqlite;
  $("dbProfileUsername").disabled = isSqlite;
  $("databaseUsernameField").hidden = isSqlite;
  $("dbProfileDatabaseLabel").textContent = isSqlite ? "Path file SQLite" : "Nama database";
  if (resetValues) {
    $("dbProfilePort").value = presets[engine];
    $("dbProfileDatabase").value = isSqlite ? "database/database.sqlite" : "app_db";
    $("dbProfileHost").value = "127.0.0.1";
    $("dbProfileUsername").value = engine === "mongodb" ? "" : "root";
  }
}
function openDatabaseEnvModal(profileId) {
  const projects = state?.projects || [];
  if (!projects.length) { showToast("Proyek belum tersedia", "Hubungkan Laragon dan pastikan ada proyek terdeteksi/terdaftar terlebih dahulu.", "warning"); return; }
  $("databaseEnvProject").replaceChildren();
  for (const project of projects) {
    const option = document.createElement("option"); option.value = project.path; option.textContent = `${project.name} — ${shortPath(project.path, 56)}`; $("databaseEnvProject").append(option);
  }
  $("databaseEnvProfileId").value = profileId;
  $("databaseEnvModal").hidden = false;
}
function closeDatabaseEnvModal() { $("databaseEnvModal").hidden = true; }

function renderLogSources() {
  const container = $("logSourceList"); container.replaceChildren();
  const files = state?.logFiles || [];
  setText("logFileCount", files.length);
  for (const file of files) {
    const button = document.createElement("button"); button.className = `log-source${currentLogSource === file.id ? " active" : ""}`; button.dataset.logSource = file.id;
    const icon = document.createElement("span"); icon.className = "log-source-icon file"; icon.textContent = "▧";
    const copy = document.createElement("span"); const strong = document.createElement("strong"); strong.textContent = file.label.split(" · ")[0];
    const small = document.createElement("small"); small.textContent = file.label.split(" · ").slice(1).join(" · "); copy.append(strong, small);
    const arrow = document.createElement("span"); arrow.className = "source-chevron"; arrow.textContent = "›";
    button.append(icon, copy, arrow); button.addEventListener("click", () => selectLogSource(file.id)); container.append(button);
  }
}
function activityToText(entry) {
  const timestamp = formatTime(entry.time);
  const level = String(entry.level || "info").toUpperCase().padEnd(7, " ");
  return `${timestamp}  ${level}  ${entry.message || ""}${entry.detail ? `\n                 ${entry.detail}` : ""}`;
}
function renderLogs() {
  if (!state) return;
  renderLogSources();
  if (currentLogSource === "activity") {
    const entries = (state.activityLogs || []).filter(entry => logFilter === "all" || entry.level === logFilter);
    currentLogContent = entries.map(activityToText).join("\n\n") || "Tidak ada aktivitas yang sesuai dengan filter ini.";
    currentLogLabel = "Aktivitas aplikasi";
    setText("logCurrentKicker", "AKTIVITAS APLIKASI");
    setText("logCurrentTitle", currentLogLabel);
    setText("logLineCount", `${entries.length} aktivitas`);
    setText("logFooterInfo", "Aktivitas disimpan secara lokal di perangkat ini.");
    setText("logTruncated", "");
    $("logConsole").textContent = currentLogContent;
  } else {
    setText("logCurrentKicker", "LOG FILE LARAGON");
    setText("logCurrentTitle", currentLogLabel);
    const rawLines = currentLogContent.split(/\r?\n/);
    let lines = rawLines;
    if (logFilter === "error") lines = rawLines.filter(line => /error|fatal|exception|failed|denied/i.test(line));
    if (logFilter === "warning") lines = rawLines.filter(line => /warn|warning|deprecated/i.test(line));
    $("logConsole").textContent = lines.join("\n") || (logFilter === "all" ? "File log ini kosong." : "Tidak ada baris yang cocok.");
    setText("logLineCount", `${lines.length} baris`);
    setText("logFooterInfo", "Pratinjau read-only dari file log Laragon.");
    setText("logTruncated", currentLogTruncated ? "Menampilkan bagian terakhir sebesar 160 KB" : "");
  }
  document.querySelectorAll(".log-source").forEach(item => item.classList.toggle("active", item.dataset.logSource === currentLogSource));
  document.querySelectorAll(".log-filter").forEach(item => item.classList.toggle("active", item.dataset.logFilter === logFilter));
}
async function selectLogSource(sourceId) {
  const file = (state?.logFiles || []).find(item => item.id === sourceId);
  const load = async () => {
    currentLogSource = sourceId;
    logFilter = "all";
    if (sourceId === "activity") { currentLogContent = ""; currentLogLabel = "Aktivitas aplikasi"; renderLogs(); return; }
    currentLogLabel = file?.label || "Log Laragon";
    $("logConsole").textContent = "Membaca file log…";
    $("logConsole").setAttribute("aria-busy", "true");
    renderLogSources();
    try {
      const result = await window.studio.getLogContent(sourceId);
      currentLogContent = result.content || "";
      currentLogLabel = result.label || currentLogLabel;
      currentLogTruncated = Boolean(result.truncated);
    } catch (error) {
      currentLogTruncated = false;
      currentLogContent = `Tidak dapat membaca log yang dipilih.\n${error.message || String(error)}`;
      showToast("Log tidak dapat dibaca", error.message || String(error), "error");
    } finally {
      $("logConsole").removeAttribute("aria-busy");
    }
    renderLogs();
  };
  if (sourceId === "activity") return load();
  return withOperation(`Membaca log · ${file?.label || "Laragon"}`, load);
}
async function refreshState(quiet = false) {
  if (refreshPromise) return refreshPromise;
  isRefreshing = true;
  const pending = (async () => {
    state = await window.studio.getState();
    setConnection(Boolean(state.detected), state.root || "");
    updateHeaderControls();
    // Dashboard badges remain fresh while expensive hidden page catalogs are not rebuilt.
    renderDashboard();
    updateHeaderControls();
    if (currentPage === "projects") renderProjects();
    else if (currentPage === "services") renderServices();
    else if (currentPage === "tools") renderDeveloperTools();
    else if (currentPage === "settings") renderRuntimeSelectors();
    else if (currentPage === "hub") renderAppHub();
    else if (currentPage === "logs") {
      renderLogSources();
      if (currentLogSource === "activity") renderLogs();
      else if (!(state.logFiles || []).some(file => file.id === currentLogSource)) {
        currentLogSource = "activity";
        renderLogs();
      }
    }
    return state;
  })();
  refreshPromise = pending;
  try {
    return await pending;
  } catch (error) {
    if (!quiet) showToast("Tidak dapat membaca status", error.message || String(error), "error");
    return null;
  } finally {
    if (refreshPromise === pending) refreshPromise = null;
    isRefreshing = false;
  }
}
function openProjectModal() {
  $("projectForm").reset();
  $("projectModal").hidden = false;
  window.setTimeout(() => $("projectNameInput").focus(), 30);
}
function closeProjectModal() { $("projectModal").hidden = true; }

// Primary navigation and cross-page links.
document.querySelectorAll(".nav-item[data-page]").forEach(button => button.addEventListener("click", () => changePage(button.dataset.page)));
document.querySelectorAll("[data-goto]").forEach(button => button.addEventListener("click", () => changePage(button.dataset.goto)));
function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  const toggle = $("sidebarCollapse");
  const icon = toggle?.querySelector("span");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Perluas sidebar" : "Ringkas sidebar");
    toggle.title = collapsed ? "Perluas sidebar" : "Ringkas sidebar";
  }
  if (icon) icon.textContent = collapsed ? "›" : "‹";
}
$("sidebarCollapse").addEventListener("click", () => setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed")));
$("themeToggle").addEventListener("click", () => setTheme(document.body.dataset.theme === "dark" ? "light" : "dark"));
document.querySelectorAll(".theme-option").forEach(button => button.addEventListener("click", () => setTheme(button.dataset.themeChoice)));
$("refreshButton").addEventListener("click", () => action(async () => { await refreshState(true); return true; }, "Data ruang kerja diperbarui.", "Pembaruan selesai", { label: "Memperbarui data ruang kerja", refresh: false }));
async function controlStack(mode, options = {}, sourceButton = focusedActionButton()) {
  if (serviceMutationInFlight) {
    showToast("Operasi sedang berjalan", "Tunggu hingga tindakan layanan yang aktif selesai.", "warning");
    return null;
  }
  if (mode === "stop" && !options.confirmed && !window.confirm("Hentikan stack Laragon secara tertib? Pastikan tidak ada impor/ekspor atau transaksi database yang sedang berjalan.")) return null;

  serviceMutationInFlight = true;
  const finishOperation = beginOperation(mode === "start" ? "Menjalankan stack Laragon" : "Menghentikan stack Laragon", sourceButton);
  updateHeaderControls();
  let result = null;
  let refreshAttempted = false;
  try {
    result = mode === "start" ? await window.studio.startStack() : await window.studio.stopStack(options);
    const needsPassword = mode === "stop" && !Object.prototype.hasOwnProperty.call(options, "mysqlPassword")
      ? (result?.results || []).find(item => item.id === "mysql" && item.requiresPassword)
      : null;
    if (needsPassword) {
      const password = await requestMysqlPassword(needsPassword.detail);
      if (password === null) {
        showToast("Shutdown dibatalkan", "Password tidak dimasukkan. Layanan yang sudah berhasil berhenti tetap berhenti; MySQL tetap berjalan.", "warning");
        return null;
      }
      result = await window.studio.stopStack({ mysqlPassword: password });
    }
    const results = result?.results || [];
    const failed = results.filter(item => !item.ok && !item.skipped);
    const skipped = results.filter(item => item.skipped);
    let verificationError = "";
    try {
      await refreshState(true);
      refreshAttempted = true;
    } catch (error) {
      refreshAttempted = true;
      verificationError = `Status akhir tidak dapat diperiksa: ${error?.message || String(error)}`;
    }
    const ids = getStackServiceIds();
    const actualStack = ids.map(id => (state?.services || []).find(item => item.id === id)).filter(Boolean);
    const unconfirmed = actualStack.filter(item => item.found !== false && item.supported && (mode === "start" ? !item.running && !item.externalRunning : item.running && item.stopSupported));
    if (failed.length || verificationError || unconfirmed.length) {
      const pieces = [];
      if (failed.length) pieces.push(failed.map(item => `${item.id}: ${item.detail || "gagal"}`).join("\n"));
      if (unconfirmed.length) pieces.push(`Status akhir belum sesuai: ${unconfirmed.map(item => `${item.id} ${mode === "start" ? "belum berjalan" : "masih berjalan"}`).join(", ")}. Periksa log layanan.`);
      if (verificationError) pieces.push(verificationError);
      showToast(`${mode === "start" ? "Mulai" : "Hentikan"} stack belum terkonfirmasi`, pieces.join("\n"), "warning");
    } else {
      const detail = results.map(item => `${item.id}: ${item.skipped ? "dilewati" : "OK"}`).join(" · ") || "Tidak ada layanan yang dipilih.";
      showToast(mode === "start" ? "Stack berhasil dijalankan" : "Stack berhasil dihentikan", skipped.length ? `${detail}. Komponen yang tidak terpasang dilewati.` : detail, "success");
    }
    return result;
  } catch (error) {
    showToast("Kontrol stack gagal", error?.message || String(error), "error");
    return null;
  } finally {
    serviceMutationInFlight = false;
    finishOperation();
    if (!refreshAttempted) await refreshState(true).catch(() => null);
    updateHeaderControls();
    if (currentPage === "services") renderServices();
  }
}

async function runServiceMutation(button, label, task, successTitle, successMessage, verification = {}) {
  if (serviceMutationInFlight) {
    showToast("Operasi sedang berjalan", "Tunggu hingga tindakan layanan yang aktif selesai.", "warning");
    return null;
  }
  serviceMutationInFlight = true;
  const finishOperation = beginOperation(label, button);
  updateHeaderControls();
  let result = null;
  let refreshAttempted = false;
  try {
    result = await task();
    if (result === null) return null;
    if (result?.requiresPassword || result?.ok === false) throw new Error(result.detail || "Tindakan layanan tidak berhasil.");
    try {
      await refreshState(true);
      refreshAttempted = true;
    } catch (refreshError) {
      refreshAttempted = true;
      throw new Error(`Perintah telah dijalankan, tetapi status layanan tidak dapat diverifikasi: ${refreshError?.message || String(refreshError)}`);
    }
    if (verification.serviceId) {
      const actual = (state?.services || []).find(item => item.id === verification.serviceId);
      if (!actual) throw new Error(`${verification.serviceId}: status setelah tindakan tidak tersedia. Periksa halaman log.`);
      if (typeof verification.expectedRunning === "boolean" && actual.running !== verification.expectedRunning) {
        const actualLabel = actual.running ? "masih berjalan" : "belum terdeteksi berjalan";
        throw new Error(`${actual.label || actual.id}: perintah selesai tetapi status akhir belum sesuai; layanan ${actualLabel}. Periksa log dan port layanan.`);
      }
    }
    showToast(successTitle, successMessage, "success");
    return result;
  } catch (error) {
    showToast("Kontrol layanan gagal atau belum terverifikasi", error?.message || String(error), "error");
    return null;
  } finally {
    serviceMutationInFlight = false;
    finishOperation();
    if (!refreshAttempted) await refreshState(true).catch(() => null);
    updateHeaderControls();
    if (currentPage === "services") renderServices();
  }
}

$("headerStartStack").addEventListener("click", event => controlStack("start", {}, event.currentTarget));
$("headerStopStack").addEventListener("click", event => controlStack("stop", {}, event.currentTarget));
$("sidebarServicesShortcut").addEventListener("click", () => changePage("services"));
$("startAllServices").addEventListener("click", event => controlStack("start", {}, event.currentTarget));
$("stopAllServices").addEventListener("click", event => controlStack("stop", {}, event.currentTarget));
$("preferredWebServerSelect").addEventListener("change", event => action(() => window.studio.setPreferredWebServer(event.target.value), `Web server utama: ${event.target.value}.`, "Preferensi diperbarui", { refresh: true }));
$("serviceSearch").addEventListener("input", debounce(event => { serviceQuery = event.target.value.trim(); renderServices(); }, 100));
$("serviceStatusFilter").addEventListener("change", event => { serviceFilter = event.target.value; renderServices(); });
$("syncVirtualHosts").addEventListener("click", () => action(() => window.studio.syncVirtualHosts(), "Perintah reload/sinkronisasi Laragon dikirim. Periksa log jika host belum aktif.", "Perintah sinkronisasi dikirim", { refresh: true }));
$("setupChooseRoot").addEventListener("click", () => action(async () => { const root = await window.studio.chooseLaragonRoot(); if (!root) return null; return root; }, "Lokasi Laragon terhubung.", "Integrasi diperbarui", { refresh: true }));
$("changeLaragonRoot").addEventListener("click", () => action(async () => { const root = await window.studio.chooseLaragonRoot(); if (!root) return null; return root; }, "Lokasi Laragon terhubung.", "Integrasi diperbarui", { refresh: true }));
$("openWwwFolder").addEventListener("click", () => action(() => window.studio.openFolder("www")));
$("openLogFolder").addEventListener("click", () => action(() => window.studio.openFolder("logs")));
$("readCliDocs").addEventListener("click", () => action(() => window.studio.openExternalUrl("https://laragon.org/docs/cli")));
$("integrationCliDocs").addEventListener("click", () => action(() => window.studio.openExternalUrl("https://laragon.org/docs/cli")));
$("aboutDocs").addEventListener("click", () => action(() => window.studio.openExternalUrl("https://laragon.org/docs")));

// Developer tools and environment reporting.
$("openRootTerminal").addEventListener("click", () => action(() => window.studio.openTerminal(state?.root), "Terminal dibuka di root Laragon."));
$("openWwwTerminal").addEventListener("click", () => action(() => window.studio.openTerminal(state?.www), "Terminal dibuka di folder www."));
$("openLaragonConfig").addEventListener("click", () => action(() => window.studio.openFolder("etc"), "Folder konfigurasi dibuka."));
$("refreshDiagnostics").addEventListener("click", () => action(async () => { await refreshState(true); return true; }, "Pemeriksaan lingkungan diperbarui.", "Diagnosis diperbarui", { label: "Memperbarui diagnosis", refresh: false }));
$("exportDiagnostics").addEventListener("click", async () => {
  const result = await action(() => window.studio.exportDiagnostics(), "Laporan diagnosis disimpan. Periksa path di notifikasi atau dialog sistem.", "Laporan diekspor");
  if (result?.path) showToast("Laporan berhasil disimpan", result.path, "success");
});
document.querySelectorAll("[data-local-tool]").forEach(button => button.addEventListener("click", () => action(() => window.studio.openLocalTool(button.dataset.localTool), "Alamat lokal dibuka di browser default. Pastikan layanan terkait berjalan.", "Membuka alat lokal")));

// Project creation templates (safe, local scaffolding only; no packages are downloaded).
function openCreateProjectModal() {
  $("createProjectForm").reset();
  updateTemplatePreview();
  $("createProjectModal").hidden = false;
  window.setTimeout(() => $("createProjectName").focus(), 30);
}
function closeCreateProjectModal() { $("createProjectModal").hidden = true; }
function updateTemplatePreview() {
  const templates = {
    php: ["PHP sederhana", "Membuat index.php dan README. Tidak memasang paket dari internet."],
    html: ["HTML statis + CSS", "Membuat index.html, style.css, dan README untuk situs statis."],
    node: ["Node.js dasar", "Membuat package.json dan server HTTP bawaan Node.js tanpa dependensi eksternal."]
  };
  const selected = templates[$("createProjectTemplate").value] || templates.php;
  $("templatePreview").replaceChildren();
  const title = document.createElement("strong"); title.textContent = selected[0];
  const detail = document.createElement("span"); detail.textContent = selected[1];
  $("templatePreview").append(title, detail);
}
$("createProjectButton").addEventListener("click", openCreateProjectModal);
$("closeCreateProjectModal").addEventListener("click", closeCreateProjectModal);
$("cancelCreateProject").addEventListener("click", closeCreateProjectModal);
$("createProjectModal").addEventListener("click", event => { if (event.target === $("createProjectModal")) closeCreateProjectModal(); });
$("createProjectTemplate").addEventListener("change", updateTemplatePreview);
$("createProjectForm").addEventListener("submit", async event => {
  event.preventDefault();
  const data = { name: $("createProjectName").value.trim(), template: $("createProjectTemplate").value };
  const result = await action(() => window.studio.createProjectTemplate(data), "Folder dan file starter berhasil dibuat di Laragon www.", "Proyek dibuat", { refresh: true, label: "Membuat proyek" });
  if (result) { closeCreateProjectModal(); changePage("projects"); }
});

// Project management.
$("addProjectButton").addEventListener("click", openProjectModal);
$("emptyAddProject").addEventListener("click", openProjectModal);
$("closeProjectModal").addEventListener("click", closeProjectModal);
$("cancelProjectModal").addEventListener("click", closeProjectModal);
$("projectModal").addEventListener("click", event => { if (event.target === $("projectModal")) closeProjectModal(); });
$("browseProjectFolder").addEventListener("click", async () => {
  try {
    const folder = await window.studio.pickProjectFolder();
    if (!folder) return;
    $("projectPathInput").value = folder;
    if (!$("projectNameInput").value.trim()) $("projectNameInput").value = folder.split(/[\\/]/).filter(Boolean).pop() || "my-project";
  } catch (error) { showToast("Tidak dapat memilih folder", error.message || String(error), "error"); }
});
$("projectForm").addEventListener("submit", async event => {
  event.preventDefault();
  const data = {
    name: $("projectNameInput").value.trim(),
    path: $("projectPathInput").value.trim(),
    hostname: $("projectHostInput").value.trim()
  };
  if (!data.path) { showToast("Folder proyek wajib dipilih", "Pilih folder terlebih dahulu.", "warning"); return; }
  const result = await action(() => window.studio.addProject(data), "Proyek ditambahkan ke daftar quick access.", "Project registered", { refresh: true, label: "Mendaftarkan proyek" });
  if (result) { closeProjectModal(); changePage("projects"); }
});
$("projectSearch").addEventListener("input", debounce(event => { projectQuery = event.target.value.trim(); renderProjects(); }, 100));
document.querySelectorAll(".filter-tab").forEach(button => button.addEventListener("click", () => {
  projectFilter = button.dataset.filter;
  document.querySelectorAll(".filter-tab").forEach(item => item.classList.toggle("active", item === button));
  renderProjects();
}));
$("projectViewToggle").addEventListener("click", () => {
  projectListMode = projectListMode === "grid" ? "list" : "grid";
  $("projectViewToggle").textContent = projectListMode === "grid" ? "▦" : "☷";
  renderProjects();
});

// Log viewer.
document.addEventListener("click", event => {
  const sourceButton = event.target.closest("[data-log-source]");
  if (sourceButton) selectLogSource(sourceButton.dataset.logSource);
});
document.querySelectorAll(".log-filter").forEach(button => button.addEventListener("click", () => {
  logFilter = button.dataset.logFilter;
  renderLogs();
}));
$("logsRefresh").addEventListener("click", async () => {
  await withOperation("Memperbarui log", async () => {
    await refreshState(true);
    if (currentLogSource !== "activity") await selectLogSource(currentLogSource);
    else renderLogs();
    showToast("Log diperbarui", "Sumber log terbaru dimuat.", "success");
  }, $("logsRefresh"));
});
$("exportLogs").addEventListener("click", async () => {
  const label = String(currentLogLabel || "laragon-log").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 48) || "laragon-log";
  const content = $("logConsole").textContent || "";
  const result = await action(() => window.studio.exportTextFile({ suggestedName: `${label}.txt`, content }), "Konten log diekspor sebagai file teks.", "Ekspor log");
  if (result?.path) showToast("Log berhasil disimpan", result.path, "success");
});
$("copyLogs").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("logConsole").textContent);
    showToast("Log disalin", "Konten log telah disalin ke clipboard.", "success");
  } catch { showToast("Tidak dapat menyalin log", "Clipboard tidak tersedia pada sesi ini.", "warning"); }
});

document.querySelectorAll(".settings-nav-item").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll(".settings-nav-item").forEach(item => item.classList.toggle("active", item === button));
  document.querySelectorAll(".settings-section").forEach(section => section.classList.toggle("active", section.dataset.settingsPanel === button.dataset.settingsSection));
}));


// App & Database Hub: guarded package installs and database profile helpers.
document.querySelectorAll("[data-hub-tab]").forEach(button => button.addEventListener("click", () => setHubTab(button.dataset.hubTab)));
$("componentSearch").addEventListener("input", debounce(event => { componentQuery = event.target.value.trim(); renderComponentCatalog(); }, 110));
$("componentCategory").addEventListener("change", event => { componentCategory = event.target.value; renderComponentCatalog(); });
$("wingetHelp").addEventListener("click", () => action(() => window.studio.openExternalUrl("https://learn.microsoft.com/en-us/windows/package-manager/winget/"), "Dokumentasi WinGet dibuka."));
$("refreshHubButton").addEventListener("click", async () => {
  await withOperation("Memeriksa katalog aplikasi dan database", async () => {
    try {
      state.componentHub = await window.studio.refreshComponents();
      renderAppHub();
      showToast("Katalog diperiksa", "Status komponen dan WinGet diperbarui.", "success");
    } catch (error) { showToast("Pemeriksaan gagal", error?.message || String(error), "error"); }
  }, $("refreshHubButton"));
});
$("clearInstallOutput").addEventListener("click", () => { componentOutputLines = []; $("componentInstallOutput").replaceChildren(); const empty = document.createElement("p"); empty.className = "install-output-empty"; empty.textContent = "Output WinGet akan ditampilkan saat instalasi dimulai."; $("componentInstallOutput").append(empty); });
window.studio.onComponentInstallProgress(entry => appendComponentOutput(entry));
$("newDatabaseProfile").addEventListener("click", () => openDatabaseProfileModal());
$("emptyNewDatabaseProfile").addEventListener("click", () => openDatabaseProfileModal());
$("closeDatabaseProfileModal").addEventListener("click", closeDatabaseProfileModal);
$("cancelDatabaseProfileModal").addEventListener("click", closeDatabaseProfileModal);
$("databaseProfileModal").addEventListener("click", event => { if (event.target === $("databaseProfileModal")) closeDatabaseProfileModal(); });
$("dbProfileEngine").addEventListener("change", () => updateDatabaseEngineFields(true));
$("databaseProfileForm").addEventListener("submit", async event => {
  event.preventDefault();
  const profile = {
    ...(dbEditingId ? { id: dbEditingId } : {}), name: $("dbProfileName").value.trim(), engine: $("dbProfileEngine").value,
    host: $("dbProfileHost").value.trim(), port: Number($("dbProfilePort").value), database: $("dbProfileDatabase").value.trim(), username: $("dbProfileUsername").value.trim()
  };
  const saved = await action(() => window.studio.saveDatabaseProfile(profile), "Profil tersimpan. Password tidak disimpan.", "Profil disimpan", { refresh: true, label: "Menyimpan profil database" });
  if (saved) { closeDatabaseProfileModal(); setHubTab("databases"); }
});
$("closeDatabaseEnvModal").addEventListener("click", closeDatabaseEnvModal);
$("cancelDatabaseEnvModal").addEventListener("click", closeDatabaseEnvModal);
$("databaseEnvModal").addEventListener("click", event => { if (event.target === $("databaseEnvModal")) closeDatabaseEnvModal(); });
$("databaseEnvForm").addEventListener("submit", async event => {
  event.preventDefault();
  const profileId = $("databaseEnvProfileId").value;
  const projectPath = $("databaseEnvProject").value;
  const result = await action(() => window.studio.writeEnvExample(profileId, projectPath), "Template berhasil dibuat tanpa menimpa file lama.", "Konfigurasi dibuat", { label: "Membuat .env.example" });
  if (result?.path) { closeDatabaseEnvModal(); showToast("File dibuat", result.path, "success"); }
});

// Built-in help center: searchable articles and fixed official documentation links.
const helpSearch = $("helpSearch");
if (helpSearch) helpSearch.addEventListener("input", debounce(() => {
  const query = helpSearch.value.trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll(".help-article").forEach(article => {
    const haystack = `${article.textContent || ""} ${article.dataset.keywords || ""}`.toLowerCase();
    const match = !query || haystack.includes(query);
    article.hidden = !match;
    if (match) visible += 1;
  });
  $("helpNoResults").hidden = visible > 0;
}, 90));
document.querySelectorAll("[data-help-jump]").forEach(button => button.addEventListener("click", () => {
  const target = document.getElementById(button.dataset.helpJump);
  if (!target) return;
  if (target.hidden && helpSearch) {
    helpSearch.value = "";
    helpSearch.dispatchEvent(new Event("input", { bubbles: true }));
  }
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  const heading = target.querySelector("h2"); if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
}));
document.querySelectorAll("[data-help-goto]").forEach(button => button.addEventListener("click", () => changePage(button.dataset.helpGoto)));
document.addEventListener("click", event => {
  const link = event.target.closest("[data-help-url]");
  if (!link) return;
  const url = link.dataset.helpUrl;
  action(() => window.studio.openExternalUrl(url), "Dokumentasi resmi dibuka di browser default.", "Dokumentasi dibuka");
});

// Escape closes the project registration modal.
document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("projectModal").hidden) closeProjectModal(); if (event.key === "Escape" && !$("createProjectModal").hidden) closeCreateProjectModal(); if (event.key === "Escape" && !$("databaseProfileModal").hidden) closeDatabaseProfileModal(); if (event.key === "Escape" && !$("databaseEnvModal").hidden) closeDatabaseEnvModal(); });

(async function init() {
  const finishInitialization = beginOperation("Memuat lingkungan Laragon", null);
  try {
    state = await window.studio.getState();
    setTheme(state.settings?.theme || "dark", false);
    setConnection(Boolean(state.detected), state.root || "");
    renderDashboard(); renderProjects(); renderServices(); renderDeveloperTools(); renderLogs(); renderAppHub();
    document.body.classList.add("app-ready");
  } catch (error) {
    document.body.classList.add("app-ready");
    showToast("Inisialisasi gagal", error.message || String(error), "error");
  } finally { finishInitialization(); }
  // Idle refreshes are intentionally less frequent and skip hidden windows / active tasks.
  window.setInterval(() => {
    if (document.visibilityState === "visible" && activeOperations.size === 0 && !componentBusy && !isRefreshing) refreshState(true);
  }, 18000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && activeOperations.size === 0 && !isRefreshing) refreshState(true);
  });
  window.setInterval(() => setText("currentTime", formatTime(new Date())), 1000);
})();
