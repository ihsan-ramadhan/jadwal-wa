# jadwal-wa — WhatsApp Schedule Bot (Baileys Edition)

Bot WhatsApp otomatis yang mengirim **jadwal adzan, imam, dan petugas Jumatan** ke grup WhatsApp setiap hari pukul 20.00 WIB, dengan data bersumber dari file Excel.
Versi ini menggunakan library WhatsApp **Baileys**, dan dirancang untuk berjalan otomatis di background secara lokal menggunakan PM2.

## Fitur

- Kirim jadwal **harian** (adzan & imam Maghrib/Isya) ke grup
- Kirim jadwal **petugas Jumatan** secara acak setiap Kamis malam
- Auto-mention kontak yang bertugas via `@nomor`
- **Cron job** otomatis di lokal harian (20:00 WIB)
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

Jika kamu mau bot berjalan di laptop/server pribadi selama 24/7 di background:

```bash
pm2 start kirim_jadwal.js --name jadwal-wa
pm2 save
```

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
