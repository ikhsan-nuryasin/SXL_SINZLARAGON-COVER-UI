# Pasang SXL Cover langsung di folder Laragon

Contoh jika Laragon ada di `C:\laragon`:

1. Ekstrak source ZIP ke `C:\laragon\sxl-cover` (subfolder source terpisah).
2. Buka PowerShell pada folder `C:\laragon\sxl-cover`.
3. Jalankan `npm install`, `npm run check`, `npm run package`, kemudian `npm run install:laragon`.
4. Script mencari output `out\...\sxl-cover.exe`, lalu menyalin seluruh folder paket Electron ke `C:\laragon\sinz-ui`.
5. Script membuat shortcut Desktop. Secara default ia juga mengalihkan shortcut Desktop/Start Menu yang menunjuk ke `C:\laragon\laragon.exe`, dengan backup `*.native-backup.lnk`.

Untuk Laragon di drive/folder lain, jalankan:

```powershell
npm run install:laragon -- -LaragonRoot "D:\Tools\laragon"
```

Untuk tidak mengalihkan shortcut lama:

```powershell
npm run install:laragon -- -KeepExistingLaragonShortcuts
```

Jangan mengekstrak isi paket Electron tepat ke root `C:\laragon`, karena bisa menimpa file. Tempatkan aplikasi di subfolder khusus `sinz-ui`. File asli `laragon.exe`, runtime PHP, database, dan folder `www` tidak diubah oleh installer ini.
