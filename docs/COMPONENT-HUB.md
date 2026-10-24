# App & Database Hub — v0.8.3

## Katalog aplikasi

Katalog menggunakan package ID WinGet yang ditetapkan di source, bukan nama atau perintah bebas dari renderer. Pemasangan/pembaruan menggunakan `--id`, `--exact`, dan `--source winget` setelah konfirmasi pengguna. Output instalasi disalurkan ke panel aktivitas instalasi.

| Kategori | Paket | Cara pasang / catatan |
|---|---|---|
| Database | MariaDB Server | WinGet; dapat membuat Windows Service tersendiri |
| Database | PostgreSQL | WinGet; perhatikan service dan port umum 5432 |
| Database | MongoDB Server | WinGet; perhatikan service dan port umum 27017 |
| Database | SQLite Tools | WinGet; database embedded berbasis file, bukan server |
| GUI database | pgAdmin 4 | Klien administrasi PostgreSQL |
| GUI database | MongoDB Compass | Klien administrasi MongoDB |
| GUI database | HeidiSQL | Klien database multi-engine |
| GUI database | DB Browser for SQLite | Editor/penjelajah file SQLite |
| GUI database | DBeaver Community | Klien database multi-engine |
| GUI database | Beekeeper Studio | Klien database desktop |
| PHP dependency | Composer | Membuka unduhan `Composer-Setup.exe` dari `getcomposer.org`; pengguna menjalankan installer sendiri dan memilih PHP Laragon |
| JavaScript package manager | Yarn | WinGet; cocok untuk proyek yang menggunakan Yarn |
| JavaScript package manager | pnpm | WinGet; umum untuk workspace dan monorepo |
| Runtime/toolchain | Node.js LTS | WinGet; menyertakan Node.js dan npm |
| Runtime/toolchain | Bun | WinGet; runtime, package manager, bundler, test runner |
| Developer | Git for Windows | Version control |
| Developer | Visual Studio Code | Editor kode |
| Developer | Docker Desktop | Memerlukan dukungan virtualisasi/WSL2 sesuai kebutuhan Docker |
| Developer | Windows Terminal | Terminal untuk PowerShell/CMD dan shell lain |
| API testing | Bruno API Client | Klien permintaan HTTP/API |

WinGet dan katalog paket dapat berubah dari waktu ke waktu. Baca nama paket, publisher, perjanjian, kebutuhan hak Administrator dan opsi installer sebelum meneruskan pemasangan. Pemasangan eksternal tidak otomatis memindahkan server ke `C:\laragon\bin` atau mengkonfigurasikan port/service untuk Laragon.

### Composer

Tombol Composer membuka URL installer dari domain resmi `getcomposer.org`. SXL Cover tidak menjalankan file EXE hasil unduhan otomatis. Pada wizard Composer, pilih `php.exe` yang ingin digunakan, misalnya di dalam `C:\laragon\bin\php\...`. Setelah pemasangan, tutup dan buka ulang terminal serta SXL Cover agar perubahan `PATH` terbaca. Referensi resmi: https://getcomposer.org/doc/00-intro.md dan https://getcomposer.org/download/.

## Profil database

Profil koneksi membantu menyimpan nama, engine, host, port, database/path dan username untuk dipakai saat menghasilkan template konfigurasi. Password tidak disimpan. URI yang disalin tidak menyertakan password.

- **Tes koneksi MySQL/MariaDB/PostgreSQL/MongoDB:** tes keterjangkauan TCP, bukan autentikasi database.
- **Tes SQLite:** memeriksa file absolut yang sudah ada dan bisa dibaca, tanpa menjalankan query.
- **`.env.example`:** dibuat hanya untuk proyek terdaftar/terdeteksi, tidak menimpa file yang sudah ada, dan tidak menyertakan password. Isi rahasia di `.env` lokal secara manual; jangan commit file rahasia.

Versi ini belum menyediakan SQL editor atau membuat database, schema, user, atau collection dari UI. Gunakan GUI/CLI vendor setelah server siap.
