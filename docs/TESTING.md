# Checklist pengujian — SXL Cover v1.0.0

## Status source
- `npm run check`: 86/86 tes otomatis lulus pada lingkungan pengembangan ini.
- Ini bukan pengganti smoke test pada Windows target; build Electron, pemasangan shortcut, dan lifecycle service harus diuji pada instalasi Laragon pengguna.

## Tes regresi utama v1.0.0
- Logo/nama aplikasi SXL Cover konsisten di header/sidebar/about; ikon EXE, ikon jendela, dan installer mengarah ke aset SXL yang sama.
- Tombol header Mulai/Hentikan mengikuti snapshot service dan terkunci saat mutasi berjalan.
- Start/Stop stack hanya mengumumkan keberhasilan setelah refresh dan verifikasi status akhir.
- Restart/reload memakai antrean mutasi yang sama.
- MySQL eksternal tidak dihentikan sebagai bagian dari instance Laragon.
- Konfigurasi packaging mengecualikan `node_modules` dari app bundle.
- Skrip build/install berhenti jika packaging gagal.

---

## v1.0.0 — Cover UI / header controls

- Verify the SXL monogram is present in sidebar, mobile header, integration panel, and About page.
- Verify Start Stack and Stop Stack are disabled/enabled based on detected service state.
- Verify service buttons are locked during stack mutation.
- Verify result notifications occur after the new service state is read.
- Verify MySQL from `C:\Program Files\MySQL` is never stopped as if it were the Laragon instance.
- Build on Windows with `npm run build:laragon -- -LaragonRoot "C:\laragon"`.

## v0.9.1 — Header visual smoke test

- [ ] Header desktop menampilkan breadcrumb, label lingkungan, status Laragon, tombol tema, refresh, dan aksi utama tanpa tumpang-tindih.
- [ ] Saat berpindah halaman, label breadcrumb berubah mengikuti judul halaman yang aktif.
- [ ] Pada lebar jendela 820 px atau lebih sempit, brand mobile tampil dan tombol tema/refresh/aksi utama tetap dapat dijangkau.
- [ ] Tema gelap dan terang menjaga kontras header dan status pill.
- [ ] Fokus keyboard terlihat pada tombol di header; animasi tombol diminimalkan ketika `prefers-reduced-motion` aktif.

## v0.9.1 — UI feedback and performance smoke test

Automated source validation: run `npm run check` (81 tests passed in the source validation run used to prepare this release).

- [ ] Open `npm start`; verify the global top progress line and status pill show while an operation is running and disappear on completion/failure.
- [ ] Click a slow service action or component install; verify the clicked button is disabled/spinning while busy and cannot be double-triggered.
- [ ] Start typing in Projects, Services, App & Database, and Help search; verify the list filters after a short pause and the window remains responsive.
- [ ] Keep the app open on one page; verify background refresh does not repaint unrelated hidden pages. Hide the app window and verify polling pauses; bring it back and verify a single refresh occurs.
- [ ] Generate component install output; verify new lines append and the log stays capped at 100 entries.
- [ ] Use Windows Settings > Accessibility > Visual effects or system reduced-motion preference; verify nonessential transitions are reduced when `prefers-reduced-motion` is enabled.
- [ ] Run `npm run package`; confirm output appears under `out`. Then run `npm run build:laragon -- -LaragonRoot "C:\laragon"` to verify the installer only runs after successful packaging.
- [ ] In Services, test Start/Stop with a local and external MySQL instance; verify the UI never labels the service stopped before process verification.

Performance note: v0.9.1 reduces unnecessary DOM reconstruction and background polling; it does not change how long Windows services, WinGet downloads, or Laragon processes themselves take to start/stop. Confirm timing on the target Windows machine.

---

## v0.8.7 — MySQL shutdown credentials

- [ ] Start Laragon MySQL with the existing configuration and verify the expected port in Services.
- [ ] Click Hentikan; if `mysqladmin` is denied without a password, verify the password modal appears.
- [ ] Cancel the modal and verify MySQL remains running and the UI does not show false success.
- [ ] Enter the correct root password; verify MySQL shuts down normally and the process disappears.
- [ ] Enter an incorrect password; verify the UI gives a safe credential error, no force kill occurs, and the database remains running.
- [ ] Repeat via Hentikan Stack; verify a partial result is shown if Apache stops before the password is requested.
- [ ] Review logs and settings to confirm password was not persisted.

## Regresi v0.8.6

Tambahkan pemeriksaan untuk Apache yang berjalan sebagai proses biasa (bukan Windows service), shutdown service yang gagal menghilangkan proses, dan fallback process tree yang hanya menargetkan PID terverifikasi. Jalankan `npm run check` di Windows untuk validasi lokal.

# Checklist pengujian — SXL Cover 0.8.4

## Pemeriksaan otomatis

```powershell
npm install
npm run check
```

Pemeriksaan mencakup sintaks JavaScript, katalog paket allowlist, flow khusus Composer, penolakan ID/perintah paket sembarang, profil database, generator `.env.example`, diagnosis, path layanan Windows, template proyek, UI stylesheet, navigasi Help, tautan dokumentasi yang diizinkan, layout kartu proyek/layanan, dan ID HTML duplikat.

## Smoke test Windows

- [ ] Jalankan `npm start`; pilih folder yang berisi `laragon.exe` dan `bin`.
- [ ] Pastikan tema gelap/terang, sidebar collapse/expand, scroll terpisah dan navigasi berjalan.
- [ ] Buka Proyek: tombol Buka folder, Buka URL, Terminal, dropdown Tugas cepat, dan Jalankan tidak saling tumpang-tindih pada ukuran jendela yang biasa digunakan.
- [ ] Buka Layanan: tombol Start/Stop/Restart/Muat ulang/Terminal tetap berada di kartu, tidak meluber ke kartu sebelah.
- [ ] Buka Bantuan & panduan; cari kata `Composer`, `database`, `port`; gunakan kartu cepat dan link dokumentasi resmi.
- [ ] Periksa Services: path executable dan konfigurasi harus dikenali sebelum tindakan tersedia.
- [ ] Uji Apache/MySQL di instalasi pengembangan yang dapat dipulihkan; jangan force-kill database untuk mengatasi kegagalan shutdown.
- [ ] Pastikan proses dengan nama sama dari instalasi Laragon lain tidak dihentikan.
- [ ] Deteksi/daftarkan proyek lalu buat proyek PHP, HTML statis dan Node. Pastikan folder yang sudah ada tidak tertimpa.
- [ ] Jalankan tugas Composer/npm hanya pada proyek tepercaya.
- [ ] Buka App & Database Hub dan periksa apakah WinGet tersedia.
- [ ] Klik Composer; pastikan browser membuka installer vendor resmi. Jalankan installer secara manual dan pilih `php.exe` Laragon yang benar. Buka ulang terminal setelah instalasi.
- [ ] Uji WinGet package satu per satu terlebih dahulu, baca publisher dan lisensi. Instalasi dapat meminta hak Administrator, mengubah PATH, membuat Windows Service atau memakai port default.
- [ ] Tambah profil MySQL/MariaDB/PostgreSQL/MongoDB/SQLite, ubah nilai, lalu simpan/hapus profil uji.
- [ ] Ingat: tes koneksi server hanya memastikan port TCP dapat dijangkau; bukan login SQL. Tes SQLite memakai path absolut ke file yang telah ada.
- [ ] Buat `.env.example` pada proyek uji, pastikan password kosong dan file lama tidak tertimpa.
- [ ] Coba ekspor log dan laporan diagnosis; periksa path lokal sebelum membagikan file.
- [ ] Jalankan `npm run package`; uji hasil build di Windows sebelum digunakan harian.
- [ ] Pastikan `laragon.exe`, folder `bin`, `etc`, `data`, `usr`, dan `www` tetap tidak berubah.

## Batas verifikasi

Tes otomatis tidak menjalankan installer vendor, query SQL, atau service Windows nyata. Hasil harus diverifikasi pada komputer dan konfigurasi yang akan digunakan.


## v0.8.3 process identity fallback tests
- Verify process identity can use a full executable path extracted from command line if CIM `ExecutablePath` is blank.
- Verify MySQL identity fallback uses a real `my.ini` within a recognized Laragon MySQL location.
- Verify the last-resort MySQL fallback requires both a Laragon parent ancestor and a matching configured listening port; parent-only or port-only matches must be rejected.
- Verify MySQL graceful shutdown uses the configuration associated with a verified live process; it does not force-kill the database.
- If detection still fails on the target Windows installation, run `scripts/Diagnose-Laragon-Processes.ps1` in PowerShell as Administrator. The script is read-only; review `CommandLineSafe`, parent chain, listener ports and service path before sharing output. Ensure it does not expose secrets or private filesystem details.


## v0.8.4 external MySQL coexistence
- [ ] If `MySQL80` is an external Windows service on port 3307 and Laragon `my.ini` configures port 3306, the Services card reports the external ports and enables **Mulai** only after verifying port 3306 is free.
- [ ] Start Laragon's MySQL and verify its process uses `C:\laragon\bin\mysql\...\mysqld.exe` and port 3306. The external service must continue running and remain untouched.
- [ ] Stop from SXL Cover and verify only Laragon's MySQL stops; confirm the external MySQL80 process on 3307 remains running.
- [ ] If port 3306 is occupied, the UI blocks the start and names the owner PID when Windows makes it available.
- [ ] If Windows cannot verify port ownership, startup is blocked rather than assumed safe.
