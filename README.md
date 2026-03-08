# jadwal-wa — WhatsApp Schedule Bot (Baileys Edition)

Bot WhatsApp otomatis yang mengirim **jadwal adzan, imam, dan petugas Jumatan** ke grup WhatsApp setiap hari pukul 20.00 WIB, dengan data bersumber dari file Excel.
Versi ini dirancang _serverless-ready_ dan telah dimigrasikan menggunakan library WhatsApp **Baileys**, sehingga bisa berjalan otomatis sepenuhnya secara gratis di **GitHub Actions**.

## Fitur

- Kirim jadwal **harian** (adzan & imam Maghrib/Isya) ke grup
- Kirim jadwal **petugas Jumatan** secara acak setiap Kamis malam
- Auto-mention kontak yang bertugas via `@nomor`
- **Cron job** otomatis di lokal, atau terjadwal via **GitHub Actions** harian (20:00 WIB)
- **Logging terstruktur** ke file harian `./logs/YYYY-MM-DD.log`
- **Status tracking** real-time via `node status.js`
- Menggunakan kredensial yang aman berbasis `.env` dan `GitHub Secrets`

## Struktur File

```
jadwal-wa/
├── kirim_jadwal.js             # Skrip utama Baileys
├── logger.js                   # Modul logging ke file & console
├── status.js                   # CLI untuk cek status terkini
├── status.json                 # State real-time (auto-update oleh skrip)
├── jadwal.example.xlsx         # Contoh file format jadwal (silakan ganti nama)
├── jadwal.xlsx                 # Data jadwal aslimu (di-ignore git)
├── .env                        # File env lokal berisi GROUP ID
├── .github/workflows/          # Konfigurasi GitHub Actions
└── auth_info_baileys/          # Session WhatsApp autentikasi (di-ignore)
```

## Persyaratan Awal (Lokal)

1. Install Node.js (v20 ke atas disarankan)
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` ke `.env` lalu isi dengan ID Grup kamu:
   ```env
   GROUP_ID_ASRAMA=123xxxxxx@g.us
   GROUP_ID_SQUAD=987xxxxxx@g.us
   ```
4. Copy **`jadwal.example.xlsx`** ke **`jadwal.xlsx`** dan isikan nomor HP yang benar (file ini otomatis tidak di-push ke GitHub untuk keamanan).

## Cara Menjalankan (Lokal)

### 1. Menghubungkan ke WhatsApp (Generate Session)

Jalankan mode test untuk pertama kali:

```bash
node kirim_jadwal.js --test
```

Akan muncul **QR Code** di terminal. Buka WhatsApp di HP mu, pilih Tautkan Perangkat (Linked Devices), lalu scan QR tersebut.
Bila sukses, pesan test akan terkirim dan skrip akan otomatis keluar (mengembalikan _exit 0_).

_(Perhatian: Ini akan membuat folder `auth_info_baileys/` yang berisi histori perangkat WhatsApp-mu. Jangan bagikan isi folder ini kepada publik!)_

### 2. Cek status bot

```bash
node status.js
```

### 3. Jalankan Standby (Lokal dengan PM2)

Jika kamu masih mau bot berjalan di laptop/server pribadi tanpa GitHub Actions:

```bash
pm2 start kirim_jadwal.js --name jadwal-wa
pm2 save
```

---

## Panduan Migrasi ke Serverless (GitHub Actions)

Jika kamu ingin laptopmu bisa dimatikan tetapi pesan jadwal WA tetap terkirim secara ajaib setiap maghrib, gunakan GitHub Actions!

### 1. Siapkan 7 GitHub Secrets untuk Sesi Auth

Ukuran sesi Baileys terlalu besar untuk 1 rahasia Github, sehingga kita harus memecahnya.

1. Jalankan utilitas build-in dari skrip ini (di Windows PowerShell):
   ```powershell
   Compress-Archive -Path auth_info_baileys\* -DestinationPath auth.zip -Force
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("auth.zip")) | Out-File auth_base64.txt
   ```
2. Pecah file Base64 tersebut menjadi 7 file dengan utilitas Node.js:
   ```bash
   node split_b64.js
   ```
3. Buka tab **Settings > Secrets and variables > Actions** di repositori GitHub milikmu.
4. Buat **7 buah rahasia**: `WA_AUTH_1` sampai `WA_AUTH_7` (paste masing-masing ke 7 rahasia tersebut dari file _auth_secret_N.txt_ yang barusan ter-generate).

### 2. Siapkan Secret untuk File Excel (Agar Private)

Karena keamanan nomor HP teman-temanmu itu penting, file `jadwal.xlsx` **dilarang keras** di-upload langsung. Kita pakai cara rahasia juga:

1. Konversi Excel menjadi teks Base64 via PowerShell:
   ```powershell
   $pathExcel = Join-Path (Get-Location) "jadwal.xlsx"
   $pathB64 = Join-Path (Get-Location) "excel_base64.txt"
   [Convert]::ToBase64String([IO.File]::ReadAllBytes($pathExcel)) | Out-File $pathB64 -Encoding utf8
   ```
2. Buka `excel_base64.txt`, blok semua isinya lalu _copy_.
3. Di tab Github Secrets yang sama seperti tadi, buat rahasia baru bernama `JADWAL_EXCEL_B64` dan paste isinya ke situ.
4. (Jangan lupa tambahkan rahasia `GROUP_ID_ASRAMA` dan `GROUP_ID_SQUAD` juga!).

### 3. Selesai!

Setiap hari pada jam 13:00 UTC (20:00 WIB), GitHub Actions akan membangun sebuah mesin virtual cloud gratis, menyusun kembali 7 rahasia ZIP tadi menjadi sesi login WA, lalu mengirim skrip jadwalmu ke grup secara otomatis, lalu menghancurkan servernya kembali.

Kamu selalu bisa mengecek status berhasil tidaknya eksekusi bot setiap harinya di Tab **Actions** repository ini.

---

## Format Excel (`jadwal.xlsx`)

| Sheet           | Isi                                        |
| --------------- | ------------------------------------------ |
| `Jadwal`        | Jadwal adzan & imam per hari (baris 3–9)   |
| `Kontak_Asrama` | Nama, nomor WA, nama tag untuk grup asrama |
| `Kontak_Luar`   | Nama, nomor WA, nama tag untuk grup luar   |
| `Jumatan`       | Posisi Jumatan & jumlah orang per posisi   |

## Stack

- [node-cron](https://github.com/node-cron/node-cron) — Penjadwalan cron
- [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web API (Super Cepat! Serverless Ready)
- [xlsx](https://github.com/SheetJS/sheetjs) — Baca file Excel
- [PM2](https://pm2.keymetrics.io/) — Process manager (opsional)
