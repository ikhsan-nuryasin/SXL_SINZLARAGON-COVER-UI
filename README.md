# SXL Cover

**SXL Cover** adalah aplikasi desktop berbasis Electron untuk membantu mengelola lingkungan pengembangan web pada instalasi Laragon yang sudah ada. Aplikasi ini merupakan antarmuka alternatif, bukan pengganti penuh Laragon.

> SXL Cover tidak menyertakan binary Laragon. Aplikasi tidak mengganti `laragon.exe` atau menimpa direktori inti Laragon seperti `bin`, `etc`, `data`, `usr`, dan `www` saat proses instalasi aplikasi.

## Status proyek

- **Versi source:** `1.0.0`
- **Platform utama:** Windows
- **Teknologi:** Electron, JavaScript, HTML, CSS, dan Node.js
- **Validasi source:** `npm run check` lulus dengan 86 tes otomatis pada pemeriksaan v1.0.0. Build Electron dan kontrol layanan tetap perlu diuji pada komputer target.

## Fitur

- **Dashboard dan kontrol layanan** — melihat kondisi stack serta memulai atau menghentikan layanan yang dapat diidentifikasi dengan cukup aman.
- **Pemeriksaan identitas proses** — menghindari tindakan terhadap proses bernama sama yang berasal dari instalasi Laragon atau MySQL eksternal.
- **Project Workspace** — mendeteksi dan mendaftarkan proyek, membuat template PHP/HTML/Node dasar, serta membuka folder, URL, terminal, dan tugas terkurasi.
- **App & Database Hub** — katalog aplikasi terkurasi melalui WinGet dan alur khusus Composer yang membuka installer resmi untuk dijalankan sendiri oleh pengguna.
- **Profil database** — menyimpan metadata koneksi tanpa menyimpan password, menguji jangkauan TCP, dan membuat `.env.example` tanpa menimpa file yang sudah ada.
- **Diagnostik dan log** — membantu memeriksa konfigurasi dan aktivitas aplikasi.
- **Antarmuka** — tema terang/gelap, navigasi proyek dan layanan, serta halaman Bantuan & panduan yang dapat dicari.

## Batasan penting

SXL Cover tidak mengimplementasikan seluruh fitur native Laragon. Di antaranya, aplikasi ini bukan pengganti penuh menu Laragon, Quick Add, penerbitan Auto SSL, seluruh variasi custom profile/virtual host, editor SQL umum, atau pembuatan database/schema/user/collection langsung dari UI.

Tes koneksi untuk MySQL, MariaDB, PostgreSQL, dan MongoDB hanya memeriksa keterjangkauan port TCP; tes tersebut **bukan** autentikasi atau pengujian query SQL. Tes SQLite memeriksa file yang sudah ada dan dapat dibaca. Paket yang dipasang melalui WinGet tidak otomatis dipindahkan ke `laragon/bin` atau dikonfigurasi sebagai layanan Laragon.

Kontrol Start/Stop layanan berusaha bertindak konservatif. Jika identitas proses atau konfigurasi tidak dapat diverifikasi, tindakan dapat dinonaktifkan. Jangan menghentikan PID yang tidak dikenal secara paksa dan jangan mengirim file `.env`, password, token, atau dump database saat meminta bantuan.

## Persyaratan

- Windows untuk kontrol layanan, pemasangan paket WinGet, dan integrasi shortcut.
- Node.js dan npm; CI proyek menggunakan Node.js 22.
- Instalasi Laragon yang sudah ada untuk menggunakan fitur integrasi Laragon.
- WinGet / Windows App Installer untuk fitur katalog aplikasi tertentu.

## Mulai dari source

Buka PowerShell di direktori source yang berisi `package.json`, lalu jalankan:

```powershell
npm install
npm run check
npm start
```

`npm run check` memeriksa sintaks JavaScript dan menjalankan tes otomatis.

## Membuat paket aplikasi

Untuk membangun paket Electron tanpa memasangnya ke Laragon:

```powershell
npm run package
```

Hasil build dibuat di direktori `out/`.

## Build dan pasang ke Laragon

Pastikan path Laragon sesuai dengan komputer yang digunakan. Untuk contoh instalasi di `C:\laragon`, jalankan:

```powershell
npm run build:laragon -- -LaragonRoot "C:\laragon" -KeepExistingLaragonShortcuts
```

Perintah ini membangun paket lebih dahulu dan membatalkan instalasi jika proses packaging gagal. Aplikasi dipasang ke subfolder `C:\laragon\sinz-ui`; file inti dan data Laragon tidak diganti.

Opsi `-KeepExistingLaragonShortcuts` menjaga shortcut Laragon yang sudah ada. Tanpa opsi itu, installer secara default dapat mengalihkan shortcut Laragon yang ditemukan di Desktop atau Start Menu ke SXL Cover. Shortcut asli yang dialihkan dicadangkan dengan akhiran `.native-backup.lnk`.

Untuk memakai tahap build dan install secara terpisah:

```powershell
npm run package
npm run install:laragon -- -LaragonRoot "C:\laragon" -KeepExistingLaragonShortcuts
```

Sesuaikan path untuk instalasi Laragon di lokasi lain. Jangan mengekstrak seluruh source atau paket Electron langsung ke root Laragon.

## Keamanan dan data

- Password profil database tidak disimpan. URI koneksi yang disalin tidak berisi password.
- Password untuk penghentian MySQL, jika diperlukan, digunakan untuk satu tindakan melalui file opsi klien sementara yang dihapus setelah proses; password tidak disimpan ke pengaturan aplikasi.
- `.env.example` tidak berisi password dan tidak menimpa file yang sudah ada. Jangan commit `.env` atau rahasia lain.
- Tugas Composer/npm dapat menjalankan kode proyek. Gunakan tugas hanya pada proyek yang dipercaya.
- Installer Composer dibuka dari domain resmi `getcomposer.org`; SXL Cover tidak menjalankan file hasil unduhan secara otomatis.
- Periksa publisher, lisensi, kebutuhan administrator, service, dan port sebelum memasang paket eksternal.

## Struktur source

```text
assets/      Ikon dan aset visual SXL Cover
src/         Electron main process, preload, dan layanan aplikasi
renderer/    Antarmuka HTML, JavaScript, dan stylesheet
scripts/     Skrip build, instalasi, pemulihan shortcut, dan diagnostik
tests/       Tes otomatis
docs/        Dokumentasi arsitektur, fitur, instalasi, status, dan pengujian
```

## Dokumentasi lain

- [Arsitektur](docs/ARCHITECTURE.md)
- [App & Database Hub](docs/COMPONENT-HUB.md)
- [Panduan instalasi ke Laragon](docs/INSTALL-TO-LARAGON.md)
- [Status implementasi dan batasan](docs/STATUS.md)
- [Checklist pengujian](docs/TESTING.md)
- [Panduan upgrade source](PATCH-INSTRUCTIONS.md)
- [Panduan publikasi source ke GitHub](PUSH-TO-GITHUB.md)

## Pemeriksaan sebelum penggunaan harian

1. Jalankan `npm run check` dan pastikan tes lulus.
2. Jalankan `npm start` dan periksa tampilan serta navigasi.
3. Uji build, pemasangan shortcut, dan kontrol layanan pada instalasi Laragon yang dapat dipulihkan.
4. Pastikan instance MySQL eksternal tidak disentuh ketika mengoperasikan MySQL Laragon.
5. Cadangkan data penting sebelum mengubah konfigurasi layanan atau memasang paket pihak ketiga.

Tes otomatis yang lulus bukan pengganti pengujian langsung pada Windows dan instalasi Laragon yang akan digunakan.

## Lisensi

Lihat [LICENSE](LICENSE).
