# SXL Cover v1.0.0 — Full Source / Upgrade

Paket ini adalah rilis penuh **SXL Cover**, antarmuka desktop alternatif untuk instalasi Laragon yang sudah ada. Gunakan full source jika ingin mengganti source lama secara bersih. Pengaturan aplikasi dipertahankan di direktori data pengguna lama dan folder inti Laragon tidak ditimpa.

## Perubahan inti

- Identitas visual menjadi logo monogram **SXL** dan nama **SXL Cover**; ikon EXE, jendela aplikasi, dan installer memakai ikon SXL yang sama.
- Header menyediakan kontrol Mulai stack dan Hentikan stack dengan status yang mengikuti hasil deteksi layanan.
- Semua operasi layanan diproses melalui satu lock, dengan indikator aktivitas dan verifikasi ulang sebelum memberi notifikasi sukses.
- MySQL/MariaDB dari instalasi eksternal tidak dihentikan sebagai layanan Laragon.
- Skrip build hanya menjalankan instalasi jika packaging berhasil.

## Menjalankan source di Windows

```powershell
npm install
npm run check
npm start
```

Jika UI sudah sesuai, bangun dan instal:

```powershell
npm run build:laragon -- -LaragonRoot "C:\laragon"
```

Skrip membuat paket aplikasi pada subfolder `C:\laragon\sinz-ui`, membuat shortcut **SXL Cover**, dan—kecuali opsi `-KeepExistingLaragonShortcuts` digunakan—mencadangkan shortcut Laragon lama sebelum mengalihkannya. `laragon.exe`, `bin`, `etc`, `data`, dan `www` tidak diganti.

## Validasi rilis

Jalankan `npm run check`. Pemeriksaan yang dilakukan pada source v1.0.0: 86 tes otomatis lulus setelah perbaikan rebranding dan kontrol service. Build Electron serta interaksi service nyata tetap perlu diuji di Windows target.
