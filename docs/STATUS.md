## SXL Cover v1.0.0 — Rebranding & service controls

- Replaced the visible product brand with SXL Cover and an SXL monogram.
- Added state-aware Start Stack and Stop Stack controls in the header.
- Unified service mutations and post-action status verification.
- Preserved the existing Laragon binary, data directories, and app user-data path.

## Header refresh v0.9.1

- Topbar dirapikan dengan struktur breadcrumb/konteks di kiri dan status/quick actions di kanan.
- Header sticky mempunyai lapisan blur, aksen tipis, dan feedback hover/focus yang konsisten.
- Layout responsif mempertahankan akses ke tombol tema, refresh, dan Start layanan pada lebar jendela sempit.
- CSS header dipisahkan ke `renderer/styles-header.css` untuk memudahkan pemeliharaan dan dimuat setelah stylesheet performa.

## Update v0.9.1 — UI feedback and responsive performance

- Added a thin global progress indicator, a polite live status region, and button-level spinner/disabled states while operations are in progress. Feedback clears on both success and failure.
- Added short debounce delays to project/service/catalog/help searches to avoid rebuilding result cards on every keystroke.
- Concurrent `refreshState` requests are coalesced into a single promise. Refresh now updates the dashboard and only the current page's content instead of reconstructing every hidden page.
- Background polling now runs every 18 seconds and skips hidden windows, active operations, and busy component installs. A visibility change refreshes state once the window becomes active.
- Component-install output appends incrementally (bounded to 100 lines), and read-only TCP checks no longer trigger a full workspace scan.
- Added reduced-motion support and responsive placement for operation status.
- Preserved the installer parameter hotfix: `Install-To-Laragon.ps1` creates shortcuts directly instead of calling a legacy script with a mismatched parameter contract.
- Automated validation in this source tree: `npm run check` passes 81 tests. Native Windows/Electron performance and service integration still require a smoke test on the target PC.

## Update v0.8.7 — MySQL/MariaDB shutdown authentication

- When `mysqladmin` reports access denied for root using no password, the stop operation returns a structured `requiresPassword` result instead of a generic service error.
- The UI has a one-time password prompt for Stop, Restart, and Stop Stack. Cancellation preserves the database process and reports partial stack-stop status.
- The password is never written to app settings/logs or process arguments. `mysqladmin` receives a temporary client option file in the user Temp directory, which is deleted in `finally` whether the command passes or fails.
- A wrong password returns a sanitized message; the app does not force-kill a database process.
- Added tests for required-password detection, safe temporary option file, redaction from process arguments, cleanup after success/failure, and UI/API wiring.
- Automated validation: `npm run check` passes 70 tests. Actual MySQL authentication/shutdown still needs a smoke test against the user's Windows Laragon installation.

## Update v0.8.6

- Stop Apache non-service tidak lagi memanggil `httpd.exe -k shutdown` secara otomatis.
- Shutdown service hanya digunakan bila service Windows dan executable-nya cocok dengan proses Laragon yang diverifikasi.
- Fallback process-tree mencoba terminasi normal, memeriksa proses lagi, lalu memakai `/F` hanya terhadap PID yang masih terverifikasi.
- Peringatan dicatat bila penghentian paksa diperlukan.
- Skrip PowerShell membisukan output progress agar tidak mencemari output dengan CLIXML.

# Status v0.8.5

## Implemented in source
- Dashboard and Violet Grid UI with dark/light theme, stable sidebar, independently scrolling page content, projects, services, tools, logs, settings, and a built-in searchable **Bantuan & panduan** page.
- Project card actions and service controls use independent responsive grids to prevent the text/buttons from overlapping at smaller window sizes.
- Project workspace: discovery, registration, PHP/HTML/Node starter templates, folder/URL/terminal shortcuts, allowlisted project tasks.
- Services: conservative controls based on recognized executable paths/configs, process command-line executable fallback, Windows-service `PathName`, MySQL/MariaDB `--defaults-file`, and a constrained parent-Laragon-plus-configured-port fallback; PID/process conflicts remain protected.
- Curated WinGet catalog for MariaDB, PostgreSQL, MongoDB, SQLite tools, database GUI clients, Git, Node.js LTS, editor, Docker, Yarn, pnpm, Bun, Windows Terminal and Bruno API client.
- Dedicated Composer installer action that opens `https://getcomposer.org/Composer-Setup.exe`; the downloaded installer is never executed automatically.
- Exact package-ID install/upgrade flow, one active WinGet task at a time, progress output, activity logs and WinGet availability guidance.
- MySQL, MariaDB, PostgreSQL, MongoDB and SQLite profiles, with validation and no password persistence.
- TCP reachability tests for network databases and a read-only file test for SQLite.
- Password-free connection URIs and `.env.example` generation for registered/discovered projects; existing files are not overwritten.
- Help articles for first-run setup, projects, service controls, Composer/Node/package managers, database profiles, troubleshooting, privacy, and official documentation links.

## Not yet implemented / not claimed
- Full native Laragon menu parity, Quick Add, Auto SSL issuance, and all custom profile/virtual-host variants.
- Direct creation/deletion of SQL databases, users, schemas or collections; no general SQL editor.
- SQL protocol/authentication test (TCP test is not a login test).
- Automatic integration of externally installed WinGet database packages into `C:\laragon\bin`.
- End-to-end testing of WinGet packages or real Windows services on the user's computer.

## Validation
- `npm run check`: 55 automated syntax and regression tests pass in this source validation run after the service-detection hotfix.
- Run the smoke-test checklist in `docs/TESTING.md` on the target Windows machine before relying on service controls or third-party installers.

## v0.8.3 process-identity hotfix
- Process inspection now carries parent lineage and owned listening TCP ports to support diagnostics when Windows hides executable metadata.
- A full executable path parsed from a readable process `CommandLine` can verify the running program.
- If the MySQL path and command line are hidden, a constrained fallback verifies both a `laragon.exe` ancestor in the selected installation and ownership of the configured `my.ini` TCP port.
- MySQL stop uses the verified live `my.ini` and searches for the matching `mysqladmin.exe`. The app never force-kills MySQL as a fallback.
- The read-only `scripts/Diagnose-Laragon-Processes.ps1` helper prints PID/path/parent/port/service information for troubleshooting.


## v0.8.4 external MySQL coexistence fix
- A discovered MySQL/MariaDB executable outside the Laragon root is now identified as an external instance, not as Laragon's own service.
- When the Laragon `my.ini` port is independently verified free, SXL Cover can start the Laragon-bundled MySQL without stopping the external Windows service.
- If the Laragon port is already occupied or port ownership cannot be verified, startup remains blocked and the service card explains the specific reason.
- The service card distinguishes external ports from the Laragon service state; Restart is unavailable until the Laragon-owned service itself is running.
- The normal Stop action still targets only a MySQL process verified to belong to the selected Laragon instance.

- Validation for v0.8.4 in this source run: `npm run check` passed 58 tests. Includes coverage for an external MySQL service on port 3307 with Laragon's port 3306 free, and for blocking start when port 3306 is occupied. Actual Windows service integration remains to be smoke-tested on the user's computer.


## v0.8.5 empty-port probe hotfix
- Fixed a Windows PowerShell probing issue: querying `Get-NetTCPConnection` with a specific free `-LocalPort` can fail on some systems when there are no matching objects. The probe now queries all listeners and filters the configured port in memory.
- Added a `netstat -ano -p tcp` fallback if the `Get-NetTCPConnection` query fails. Failed probes remain fail-safe and expose their diagnostic reason.
- Validation: port-probe regression tests added; run `npm run check` on Windows before service-control use.
