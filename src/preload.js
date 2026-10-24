const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studio", Object.freeze({
  getState: () => ipcRenderer.invoke("app:get-state"),
  setTheme: theme => ipcRenderer.invoke("app:set-theme", theme),
  chooseLaragonRoot: () => ipcRenderer.invoke("app:choose-laragon-root"),
  reloadService: service => ipcRenderer.invoke("app:reload-service", service),
  startService: service => ipcRenderer.invoke("service:start", service),
  stopService: (service, options) => ipcRenderer.invoke("service:stop", service, options),
  restartService: (service, options) => ipcRenderer.invoke("service:restart", service, options),
  startStack: () => ipcRenderer.invoke("service:start-stack"),
  stopStack: options => ipcRenderer.invoke("service:stop-stack", options),
  runProjectTask: (projectPath, taskId) => ipcRenderer.invoke("service:run-project-task", projectPath, taskId),
  selectRuntime: (tool, version) => ipcRenderer.invoke("service:select-runtime", tool, version),
  setPreferredWebServer: service => ipcRenderer.invoke("service:set-webserver", service),
  syncVirtualHosts: () => ipcRenderer.invoke("service:sync-virtual-hosts"),
  openTerminal: directory => ipcRenderer.invoke("service:open-terminal", directory),
  openFolder: kind => ipcRenderer.invoke("app:open-folder", kind),
  pickProjectFolder: () => ipcRenderer.invoke("project:pick-folder"),
  addProject: data => ipcRenderer.invoke("project:add", data),
  removeProject: id => ipcRenderer.invoke("project:remove", id),
  createProjectTemplate: data => ipcRenderer.invoke("project:create-template", data),
  openProjectFolder: projectPath => ipcRenderer.invoke("project:open-folder", projectPath),
  openProjectUrl: url => ipcRenderer.invoke("project:open-url", url),
  getLogContent: sourceId => ipcRenderer.invoke("logs:get-content", sourceId),
  openExternalUrl: url => ipcRenderer.invoke("app:open-external-url", url),
  openLocalTool: toolId => ipcRenderer.invoke("tools:open-local-tool", toolId),
  exportDiagnostics: () => ipcRenderer.invoke("reports:export-diagnostics"),
  exportTextFile: payload => ipcRenderer.invoke("reports:export-text", payload),
  installComponent: (componentId, mode) => ipcRenderer.invoke("components:install", componentId, mode),
  refreshComponents: () => ipcRenderer.invoke("components:refresh"),
  openComponentWebsite: componentId => ipcRenderer.invoke("components:open-website", componentId),
  openComponentInstaller: componentId => ipcRenderer.invoke("components:open-installer", componentId),
  saveDatabaseProfile: profile => ipcRenderer.invoke("database:save-profile", profile),
  removeDatabaseProfile: id => ipcRenderer.invoke("database:remove-profile", id),
  testDatabaseProfile: id => ipcRenderer.invoke("database:test-profile", id),
  copyDatabaseUri: id => ipcRenderer.invoke("database:copy-uri", id),
  writeEnvExample: (profileId, projectPath) => ipcRenderer.invoke("database:write-env-example", profileId, projectPath),
  onComponentInstallProgress: callback => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("components:install-progress", listener);
    return () => ipcRenderer.removeListener("components:install-progress", listener);
  }
}));
