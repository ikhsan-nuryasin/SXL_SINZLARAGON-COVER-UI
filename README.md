# SXL Cover v1.0.0

SXL Cover adalah antarmuka desktop alternatif (cover UI) untuk mengelola instalasi Laragon yang sudah ada. Aplikasi menggunakan Electron; tidak mengganti `laragon.exe`, tidak memindahkan database, dan tidak menimpa konfigurasi inti Laragon. Preferensi tetap memakai direktori data pengguna lama agar setting dan proyek terdaftar dari versi sebelumnya dapat dipertahankan.

## Perubahan v1.0.0

- Rebranding visual ke logo monogram **SXL** dan nama **SXL Cover**; tidak menggunakan logo X/Laragon sebagai identitas aplikasi.
- Header memiliki tombol terpisah **Mulai stack** dan **Hentikan stack** yang dinonaktifkan berdasarkan status service yang terdeteksi.
- Status header membedakan stack aktif, sebagian aktif, berhenti, konflik layanan, dan lokasi Laragon yang belum terhubung.
- Setiap operasi Start/Stop/Restart/Reload diberi indikator pemrosesan, mengunci kontrol yang terkait, melakukan refresh setelah tindakan, dan tidak menampilkan sukses apabila status akhir gagal diverifikasi.
- Restart/Reload di kartu layanan menggunakan satu antrean mutasi agar tidak berlomba dengan Start Stack/Stop Stack.
- Skrip instalasi menggunakan nama executable `sxl-cover.exe`, mencadangkan shortcut native jika dialihkan, dan tidak mengganti binary inti Laragon.


## UI/UX dan responsivitas v0.9.1

### Header v0.9.1
- Hierarki header diperjelas dengan breadcrumbs dua tingkat, label lingkungan, status koneksi, dan grup aksi cepat yang konsisten.
- Header tetap sticky dengan latar blur, aksen tipis, fokus keyboard yang terlihat, dan ukuran responsif.
- Pada jendela sempit, breadcrumb ringkas beralih ke brand mobile; tombol tema, refresh, dan aksi utama tetap dapat dijangkau.

Versi ini berfokus pada umpan balik saat operasi berjalan dan mengurangi pekerjaan UI yang tidak diperlukan:

- Progress bar tipis di bagian atas, indikator status proses yang dapat dibaca screen reader, dan spinner pada tombol terkait.
- Tombol yang sedang memproses dinonaktifkan sementara untuk mencegah klik ganda. Status “sedang diproses” hilang pada hasil sukses maupun gagal.
- Pencarian proyek, layanan, katalog aplikasi, dan artikel bantuan memakai debounce sehingga pemfilteran tidak membangun ulang banyak kartu pada setiap ketikan.
- Refresh status disatukan ketika beberapa permintaan datang bersamaan. Hanya dashboard dan halaman aktif yang dirender ulang; tab tersembunyi tidak dibuat ulang di setiap polling.
- Polling latar belakang berubah menjadi setiap 18 detik dan dilewati saat jendela tersembunyi atau operasi aktif. Saat jendela kembali terlihat, status diperbarui.
- Output instalasi menambahkan baris baru tanpa menggambar ulang seluruh riwayat hingga 100 baris. Tes koneksi database tidak lagi memicu pemindaian ulang seluruh instalasi karena tes itu hanya membaca status port.
- Animasi mengikuti preferensi sistem `prefers-reduced-motion`.

Optimasi ini mengurangi kerja DOM/polling yang tidak perlu; waktu start layanan, WinGet, dan pemindaian proses Windows tetap bergantung pada mesin dan instalasi Laragon yang digunakan.

## Hotfix v0.8.9 — coba kredensial MySQL kosong secara eksplisit

Beberapa log lama menunjukkan `root@localhost is created with an empty password` saat `mysqld --initialize-insecure` pertama kali dijalankan. Itu adalah kondisi pada saat inisialisasi, bukan bukti bahwa password akun masih kosong saat ini. Jika shutdown tanpa password ditolak, dialog kredensial sekarang mengizinkan pengguna mengirim password kosong secara eksplisit dengan membiarkan kolom kosong. Jika autentikasi kosong juga ditolak, UI menjelaskan bahwa kredensial saat ini kemungkinan sudah berubah atau tidak cocok dengan instance yang dipilih.

- Kredensial tidak disimpan. Password—termasuk nilai kosong yang dipilih secara eksplisit—hanya ditulis ke file opsi klien sementara yang dihapus setelah perintah selesai.
- Nilai `undefined` tetap berarti pengguna belum memasukkan kredensial dan memicu percobaan awal / dialog. Nilai `""` berarti pengguna secara sengaja mencoba autentikasi tanpa password.
- Jika percobaan kosong ditolak, masukkan password yang sedang berlaku. Jangan menganggap server log inisialisasi sebagai petunjuk pasti untuk password saat ini dan jangan reset akun tanpa backup.

## Perbaikan v0.8.7 — autentikasi shutdown MySQL/MariaDB

Jika `mysqladmin` mencoba shutdown sebagai `root` tanpa password dan server menolak dengan `Access denied (using password: NO)`, UI sekarang menampilkan dialog password hanya saat diperlukan. Password dikirim melalui IPC untuk satu tindakan, tidak disimpan pada preferensi/log/argumen proses, dan digunakan pada file opsi klien sementara di folder Temp pengguna. File sementara dihapus dalam blok `finally`, termasuk jika shutdown gagal.

Jika password salah, SXL Cover menampilkan pesan aman tanpa menampilkan atau mencatat password. Untuk `Stop Stack`, Apache dapat lebih dulu berhenti lalu UI meminta password sebelum mencoba menghentikan MySQL. Jika dialog dibatalkan, MySQL tetap berjalan dan hasilnya ditampilkan sebagai tindakan parsial, bukan sukses palsu.

Penting: ini membutuhkan password akun `root` yang benar untuk instance MySQL/MariaDB Laragon. Aplikasi tidak dapat mengetahui atau memulihkan password yang hilang. Jangan menonaktifkan autentikasi database hanya untuk membuat tombol Stop bekerja.

## Validasi v1.0.0

Pada source v1.0.0, `npm run check` lulus dengan 86/86 tes otomatis. Pemeriksaan ini mencakup sintaks JavaScript, regresi UI/header, validasi service controller, dan aturan packaging. Build Electron dan operasi service nyata harus diuji pada Windows target sebelum dipakai sehari-hari.

## Menjalankan / memperbarui

```powershell
npm install
npm run check
npm start
```

Setelah tes lolos, kemas dan instal ke folder Laragon dalam satu langkah:

```powershell
npm run build:laragon -- -LaragonRoot "C:\laragon"
```

Perintah ini menghentikan alur jika proses packaging gagal, lalu menjalankan pemasangan hanya jika EXE berhasil dibuat. Jika ingin build tanpa memasang, gunakan `npm run package`; setelah itu `npm run install:laragon -- -LaragonRoot "C:\laragon"` dapat dijalankan secara terpisah.

Jalankan `npm run install:laragon` dari folder source yang berisi `package.json`; sesuaikan `C:\laragon` dengan lokasi yang sebenarnya. Source harus disimpan di subfolder, bukan diekstrak dengan menimpa `laragon.exe`, `data`, atau `www`.

## Keamanan kredensial

- Password shutdown hanya dipakai satu kali dan tidak ditulis ke log atau argumen command line.
- Password dipakai melalui file konfigurasi klien sementara di direktori Temp pengguna; file dihapus setelah perintah. Direktori Temp harus memiliki ACL akun Windows yang sesuai.
- Password tidak pernah disimpan dalam `settings.json` atau profil database.
- Proses dihentikan secara graceful dengan `mysqladmin`; SXL Cover tidak force-kill database bila autentikasi gagal.
- Jika password tidak diketahui, periksa pengelola password atau konfigurasi yang memang kamu kendalikan. Jangan kirim password atau isi file `.env` ke chat.

---

## Perbaikan v0.8.6: Stop Stack Apache

Apache Laragon biasanya berjalan sebagai process tree, tidak selalu sebagai Windows service. SXL Cover kini hanya memakai `httpd.exe -k shutdown` bila ada service Windows yang benar-benar terdaftar dan executable-nya cocok. Jika tidak, aplikasi menghentikan process tree yang executable-nya sudah diverifikasi berada di folder Laragon terpilih. Penghentian normal dicoba lebih dahulu; penghentian paksa hanya menjadi fallback setelah proses diperiksa ulang dan akan dicatat sebagai warning.

`AH00436: No installed service named "Apache2.4"` karena itu tidak lagi menjadi metode stop default untuk Apache non-service.

## Informasi aplikasi

Aplikasi desktop Electron untuk mengelola workflow web development di instalasi Laragon yang sudah ada. Source archive ini tidak menyertakan binary Laragon.

## Fitur

- Dashboard, proyek, layanan, Alat Developer, log, pengaturan tema, dan halaman **Bantuan & panduan** yang bisa dicari.
- Project Workspace: deteksi folder di `www`, pendaftaran folder, template PHP/HTML/Node dasar, akses folder/URL/terminal, dan tugas cepat terkurasi.
- Services: kontrol langsung untuk layanan yang identitas executable-nya dapat diverifikasi lewat `ExecutablePath`, path executable pada `CommandLine`, atau path layanan Windows. Jika MySQL eksternal berjalan di port lain, SXL Cover dapat memulai MySQL Laragon hanya jika port pada `my.ini` terbukti kosong; layanan eksternal tidak disentuh. Fallback MySQL/MariaDB juga memeriksa `--defaults-file`; jika path/command line tersembunyi, identitas dapat diverifikasi lewat kombinasi parent `laragon.exe` dan port listener yang cocok dengan port pada `my.ini`.
- App & Database Hub: katalog WinGet dengan ID paket persis untuk database, GUI, package manager, runtime, editor, dan API client.
- Composer: tombol khusus membuka `Composer-Setup.exe` dari domain resmi Composer. Installer **tidak dijalankan otomatis**; pengguna menjalankan wizard dan memilih PHP Laragon.
- Database profiles: simpan metadata koneksi tanpa menyimpan password, cek port TCP, menyalin URI tanpa password, dan membuat `.env.example` tanpa menimpa file yang sudah ada.
- Log dan ekspor laporan diagnosis.

## Menjalankan dari source

Persyaratan: Windows untuk kontrol dan pemasangan WinGet, Node.js yang kompatibel dengan versi Electron pada `package.json`, npm, dan (untuk katalog WinGet) Windows App Installer/WinGet.

```powershell
npm install
npm run check
npm start
```

Untuk paket desktop dan pemasangan shortcut ke Laragon: 

```powershell
npm run package
npm run install:laragon -- -LaragonRoot "C:\laragon"
```

Sesuaikan path. Simpan source di subfolder tersendiri, jangan ekstrak ke root Laragon dan jangan menimpa `laragon.exe`, `data`, atau `www`.

## App & Database

Paket standar dipasang lewat WinGet menggunakan katalog allowlist dan argumen `--id <PackageIdentifier> --exact`. ID paket adalah bagian dari source, bukan input bebas dari renderer. Installer dapat memerlukan persetujuan atau hak Administrator. Paket-paket WinGet dipasang dengan mekanisme Windows; paket tersebut tidak otomatis dipindah ke `laragon/bin` atau diatur port/servicenya oleh UI.

Composer memakai installer vendor resmi: `https://getcomposer.org/Composer-Setup.exe`. UI hanya membuka unduhan pada browser default dan tidak menjalankan berkas yang diunduh. Sesudah instalasi, pilih `php.exe` dari Laragon pada wizard Composer. Tutup dan buka ulang terminal dan SXL Cover agar `PATH` baru terbaca. Referensi: https://getcomposer.org/doc/00-intro.md

## Database profiles: batasan yang perlu dipahami

- Port check hanya menguji keterjangkauan TCP; tidak memverifikasi kredensial SQL atau keberadaan database.
- Password tidak disimpan di profil. File `.env.example` dibuat hanya bila file belum ada; file `.env` dengan rahasia tidak ditimpa.
- Fitur ini belum menjalankan SQL untuk membuat database, schema, atau pengguna. Gunakan GUI/CLI database untuk tindakan itu.

## Halaman Bantuan

Buka sidebar **Bantuan & panduan** untuk panduan mula cepat, pengelolaan proyek, layanan, instalasi Composer/Node/package managers/database GUI, profil koneksi, pemecahan masalah, keamanan, dan tautan dokumentasi resmi. Search membantu menyaring artikel berdasarkan kata kunci.

## Tes

```powershell
npm run check
```

Tes otomatis memeriksa sintaks JavaScript, katalog paket, allowlist, komponen UI, stylesheet, navigasi, layout kartu, dan ID HTML duplikat. Lolosnya tes bukan pengganti pengujian di Windows pada instalasi Laragon nyata.

## Keamanan dan batasan

- Jalankan tugas cepat hanya untuk proyek yang kamu percaya; Composer/npm dapat menjalankan skrip proyek.
- Jangan bagikan file `.env`, token, password, atau dump database ketika mengirim log untuk diagnosis.
- Jika jalur proses layanan tidak terverifikasi atau layanan berasal dari instalasi berbeda, UI sengaja menonaktifkan tindakan yang berisiko. Untuk MySQL/MariaDB, versi ini memeriksa executable path, path di CommandLine/ImagePath, `--defaults-file`, dan dalam kondisi terbatas kombinasi parent `laragon.exe` + port listener sesuai `my.ini`. Bila masih tidak dapat diverifikasi, jalankan `scripts/Diagnose-Laragon-Processes.ps1` dari PowerShell Administrator untuk mengumpulkan informasi proses secara read-only. Jangan menghentikan PID yang tidak dikenal secara paksa.
- Pengelolaan Auto SSL, Quick Add pihak ketiga, seluruh Profiles Laragon, serta setiap konfigurasi database/service pihak ketiga bukan replika penuh semua fitur Laragon.

## Hotfix v0.8.4 — process identity and diagnostics

- Process inspection records up to 10 parent processes and TCP listening ports, in addition to process path, command line, PID and Windows-service `PathName`.
- If `ExecutablePath` is hidden but the command line contains a full path, the full path is used for identity verification.
- MySQL/MariaDB fallback can use a recognized `--defaults-file`, or—only if both the parent chain matches the selected Laragon `laragon.exe` and the process owns the configured `my.ini` listening port—the selected local instance configuration.
- Graceful MySQL shutdown prefers the `my.ini` identified for the live process and locates the corresponding `mysqladmin.exe`. It does not force-kill database PIDs.
- `scripts/Diagnose-Laragon-Processes.ps1` is a read-only helper that reports executable/command line (with common password switches redacted), parent chain, listener ports and Windows-service mapping.
- Parent ancestry or matching port alone are never enough to authorize shutdown; the fallback requires both signals.


### MySQL already installed separately on Windows

If a Windows service such as `MySQL80` uses `C:\Program Files\MySQL\...` while Laragon's own MySQL is under `C:\laragon\bin\mysql\...`, SXL Cover treats them as separate instances. It never stops the external service as if it were a Laragon service. Before starting Laragon's MySQL, the app checks whether the port configured in Laragon's `my.ini` is provably free. If that port is free, it can start Laragon's instance alongside the external one; if the port is in use or cannot be verified, it blocks startup with a diagnostic message. The external Windows service is not changed.


## Hotfix v0.8.6 — empty MySQL port probe

- Port availability detection enumerates all TCP listener sockets and filters the configured port in memory. This avoids treating an empty result for a free port as a PowerShell failure.
- If `Get-NetTCPConnection` fails, the probe falls back to read-only `netstat -ano -p tcp`; it only marks the port state unverified if both mechanisms fail.
- When both probes fail, the UI now shows the concrete probe error instead of only the generic “port not verified” message.
- Automated tests cover free-port, occupied-port, failed-probe, and probe-script regression cases. An actual Windows service smoke test is still required on the target PC.


## Build dan pasang dengan satu perintah (v0.8.9)

Paket ini tidak memiliki dependensi npm runtime selain Electron/Node built-ins. `forge.config.js` mengecualikan folder `node_modules` dari app bundle dan menonaktifkan pruning pada bundle. Ini menghindari kasus Windows ketika scoped development dependency `node_modules\@electron` menghilang di tengah proses `chmod`.

Untuk membangun dan memasang secara berurutan dengan pemeriksaan exit code, jalankan PowerShell di folder source:

```powershell
npm run check
npm run build:laragon -- -LaragonRoot "C:\laragon"
```

`build:laragon` membatalkan pemasangan jika `electron-forge package` gagal, sehingga tidak lagi mencoba memakai folder `out` yang kosong atau paket lama. Jika hanya ingin membangun tanpa memasang, jalankan `npm run package`. Jalankan `npm run install:laragon -- -LaragonRoot "C:\laragon"` hanya setelah build berhasil.

Jika error `ENOENT ... chmod ... node_modules\@electron` masih terjadi pada v0.8.9, tutup Electron/Node lain, hapus hanya folder output build `out` dan folder cache temp Electron Packager yang disebutkan di pesan error, lalu jalankan `npm run build:laragon`. Jangan menghapus `C:\laragon\data` atau folder database untuk mengatasi error packaging.


### Installer fix (0.8.9 install patch)

The Laragon installer now creates/redirects Windows shortcuts from `Install-To-Laragon.ps1` itself. It no longer depends on a second script having a matching `-LaragonRoot` parameter, which prevents the PowerShell positional-parameter error seen in installations upgraded from older source folders. Original shortcuts are backed up with `.native-backup.lnk`; `laragon.exe`, databases, and project files are not overwritten.

## Publish ke GitHub

Panduan langkah demi langkah untuk membuat repository dan mengirim source ke GitHub tersedia di [PUSH-TO-GITHUB.md](PUSH-TO-GITHUB.md). Periksa `git status --short` sebelum commit dan jangan mengunggah kredensial, `.env`, log pribadi, database lokal, atau hasil build.
