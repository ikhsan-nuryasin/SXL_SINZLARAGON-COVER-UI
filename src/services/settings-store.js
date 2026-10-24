const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { normalizeHostname } = require("./validation");
const { app } = require("electron");

const DEFAULTS = {
  theme: "dark",
  laragonRoot: "",
  registeredProjects: [],
  projectsRoot: "",
  phpRuntimes: [],
  selectedVersions: {},
  preferredWebServer: "apache",
  projects: [],
  activityLogs: [],
  databaseProfiles: []
};

class SettingsStore {
  constructor() {
    this.file = path.join(app.getPath("userData"), "settings.json");
    this.settings = null;
  }

  async load() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      this.settings = { ...DEFAULTS, ...JSON.parse(await fs.readFile(this.file, "utf8")) };
    } catch {
      this.settings = { ...DEFAULTS };
    }
    if (!Array.isArray(this.settings.registeredProjects)) this.settings.registeredProjects = [];
    if (!Array.isArray(this.settings.activityLogs)) this.settings.activityLogs = [];
    if (!Array.isArray(this.settings.databaseProfiles)) this.settings.databaseProfiles = [];
    if (!Array.isArray(this.settings.projects)) this.settings.projects = [];
    if (!Array.isArray(this.settings.phpRuntimes)) this.settings.phpRuntimes = [];
    if (!this.settings.selectedVersions || typeof this.settings.selectedVersions !== "object" || Array.isArray(this.settings.selectedVersions)) this.settings.selectedVersions = {};
    if (!["apache", "nginx"].includes(this.settings.preferredWebServer)) this.settings.preferredWebServer = "apache";
    if (!this.settings.theme || !["dark", "light"].includes(this.settings.theme)) this.settings.theme = "dark";

    // Preserve projects from the previous starter. They are now registered links, not
    // processes owned by this app. Nothing is deleted from the old settings array.
    const known = new Set(this.settings.registeredProjects.map(p => path.resolve(p.path || "").toLowerCase()));
    for (const old of this.settings.projects) {
      if (!old || typeof old.path !== "string") continue;
      const resolved = path.resolve(old.path);
      if (known.has(resolved.toLowerCase())) continue;
      this.settings.registeredProjects.push({
        id: old.id || crypto.randomUUID(),
        name: String(old.name || path.basename(resolved)).slice(0, 80),
        path: resolved,
        hostname: String(old.hostname || "").toLowerCase(),
        source: "legacy"
      });
      known.add(resolved.toLowerCase());
    }
    await this.save();
  }

  async save() {
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.settings, null, 2), "utf8");
    await fs.rename(temp, this.file);
  }

  getSettings() { return structuredClone(this.settings); }

  async setTheme(theme) {
    if (!new Set(["dark", "light"]).has(theme)) throw new Error("Tema tidak valid");
    this.settings.theme = theme;
    await this.save();
    return theme;
  }

  async setLaragonRoot(root) {
    this.settings.laragonRoot = path.resolve(root);
    await this.save();
    return this.settings.laragonRoot;
  }

  async setSelectedVersion(tool, version) {
    if (typeof tool !== "string" || typeof version !== "string") throw new Error("Versi runtime tidak valid.");
    this.settings.selectedVersions[tool] = version;
    await this.save();
    return { tool, version };
  }

  async setPreferredWebServer(service) {
    if (!["apache", "nginx"].includes(service)) throw new Error("Web server tidak valid.");
    this.settings.preferredWebServer = service;
    await this.save();
    return service;
  }

  async addProject(input) {
    const projectPath = path.resolve(input.path);
    const stat = await fs.stat(projectPath).catch(() => null);
    if (!stat?.isDirectory()) throw new Error("Folder proyek tidak ditemukan.");
    const name = String(input.name || path.basename(projectPath)).trim().slice(0, 80);
    if (!name) throw new Error("Nama proyek wajib diisi.");
    const existing = this.settings.registeredProjects.find(p => path.resolve(p.path).toLowerCase() === projectPath.toLowerCase());
    if (existing) throw new Error("Folder proyek ini sudah terdaftar.");
    const hostname = normalizeHostname(input.hostname);
    const project = { id: crypto.randomUUID(), name, path: projectPath, hostname, source: "registered" };
    this.settings.registeredProjects.push(project);
    await this.save();
    return project;
  }

  async removeProject(id) {
    const before = this.settings.registeredProjects.length;
    this.settings.registeredProjects = this.settings.registeredProjects.filter(p => p.id !== id);
    await this.save();
    return this.settings.registeredProjects.length !== before;
  }

  async saveDatabaseProfile(profile) {
    if (!profile || typeof profile.id !== "string" || typeof profile.name !== "string") throw new Error("Profil database tidak valid.");
    if (!Array.isArray(this.settings.databaseProfiles)) this.settings.databaseProfiles = [];
    const index = this.settings.databaseProfiles.findIndex(item => item.id === profile.id);
    const safeProfile = {
      id: profile.id, name: profile.name, engine: profile.engine, host: profile.host || "",
      port: Number(profile.port || 0), database: profile.database, username: profile.username || "",
      updatedAt: profile.updatedAt || new Date().toISOString()
    };
    if (index >= 0) this.settings.databaseProfiles[index] = safeProfile;
    else this.settings.databaseProfiles.push(safeProfile);
    await this.save();
    return safeProfile;
  }

  async removeDatabaseProfile(id) {
    const before = this.settings.databaseProfiles.length;
    this.settings.databaseProfiles = this.settings.databaseProfiles.filter(item => item.id !== id);
    await this.save();
    return this.settings.databaseProfiles.length !== before;
  }

  async appendLog(level, message, detail = "") {
    const entry = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      level: ["info", "success", "warning", "error"].includes(level) ? level : "info",
      message: String(message).slice(0, 300),
      detail: String(detail || "").slice(0, 1200)
    };
    this.settings.activityLogs.push(entry);
    if (this.settings.activityLogs.length > 500) this.settings.activityLogs.splice(0, this.settings.activityLogs.length - 500);
    await this.save();
    return entry;
  }
}

module.exports = { SettingsStore };
