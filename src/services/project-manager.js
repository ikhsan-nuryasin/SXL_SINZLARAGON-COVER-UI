const path = require("node:path");
const fs = require("node:fs/promises");

class ProjectManager {
  constructor(store, adapter) { this.store = store; this.adapter = adapter; }

  async list() {
    const root = await this.adapter.getRoot();
    if (!root) return [];
    const discovered = await this.adapter.listProjects(root);
    const settings = this.store.getSettings();
    const registered = [];
    for (const item of settings.registeredProjects || []) {
      const projectPath = path.resolve(item.path);
      const present = await fs.stat(projectPath).then(stat => stat.isDirectory()).catch(() => false);
      if (!present) continue;
      if (discovered.some(p => p.path.toLowerCase() === projectPath.toLowerCase())) continue;
      const hostname = item.hostname || "";
      registered.push({
        id: item.id, name: item.name, path: projectPath, hostname,
        url: hostname ? (/^https?:\/\//i.test(hostname) ? hostname : `http://${hostname}`) : "",
        type: "Folder terdaftar", source: "registered", removable: true, status: "registered"
      });
    }
    return [...discovered, ...registered].sort((a, b) => a.name.localeCompare(b.name));
  }
}

module.exports = { ProjectManager };
