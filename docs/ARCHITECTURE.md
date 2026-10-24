# Arsitektur — SXL Cover 0.8.3

```text
Desktop / Start Menu shortcut
        │ --laragon-root <path>
        ▼
Electron main process (SXL Cover)
  ├── SettingsStore: theme, runtime selection, project registrations, activity logs, database profiles
  ├── LaragonAdapter: root detection, environment diagnostics, projects, logs, settings
  ├── ServiceController: validated service plans, lifecycle, project task allowlist
  ├── ProjectManager + ProjectTemplate: discovery, registration and local scaffolding
  ├── ComponentManager: curated WinGet exact IDs + output/progress
  │     └── Composer official download URL (no automatic installer execution)
  ├── DatabaseManager: profiles, validation, connection URI, TCP/file checks, .env.example
  └── Renderer: dashboard, projects, services, App & Database Hub, tools, logs, settings, Help
              │ contextBridge / allowlisted IPC
              ▼
Existing Laragon root: bin/ etc/ data/ usr/ www/
```

## Security boundaries

1. **No binary patching:** `laragon.exe` remains intact and is not bundled.
2. **Constrained package installs:** renderer can request only a known catalog ID and `install`/`upgrade`; main process builds exact WinGet arguments and invokes with `shell: false`.
3. **Composer vendor flow:** only the fixed official installer URL in the Composer catalog entry can be opened through the dedicated IPC handler. The downloaded EXE is not auto-launched.
4. **Conservative service controls:** actions derive from recognized binaries and configs. Same-named processes outside the selected root are not stopped. Unknown configuration layouts disable the action with an explanation.
5. **No secret persistence in database profiles:** username/endpoint can be saved; passwords are not stored. Connection URI output excludes passwords.
6. **Database validation scope:** server profiles test TCP reachability only; SQLite checks a readable file. No SQL authentication/query is issued.
7. **Safe environment template:** `.env.example` is created only for a registered/discovered project and never overwrites an existing file. Password values remain blank.
8. **Project tasks:** task IDs are allowlisted and project/runtime paths checked. Composer/npm may execute project code and should be used only with trusted sources.
9. **Narrow external URL allowlist:** help links are exact, fixed HTTPS URLs checked in the main process.

## Feature boundaries

The app implements common developer workflows but does not reproduce every native Laragon feature. Online Quick Add, Auto SSL issuance, every custom profile/vhost variant, a general SQL editor, database/schema/user creation, and password-based authentication tests are not included. WinGet installs standard Windows packages; it does not automatically move external database installations into Laragon's `bin` folder.
