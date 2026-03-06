# jadwal-wa — WhatsApp Schedule Bot

Bot WhatsApp otomatis yang mengirim **jadwal adzan, imam, dan petugas Jumatan** ke grup WhatsApp setiap hari pukul 20.00 WIB, dengan data bersumber dari file Excel.

## Fitur

- Kirim jadwal **harian** (adzan & imam Maghrib/Isya) ke grup
- Kirim jadwal **petugas Jumatan** secara acak setiap Kamis malam
- Auto-mention kontak yang bertugas via `@nomor`
- **Cron job** otomatis jam 20:00 WIB setiap hari
- **Logging terstruktur** ke file harian `./logs/YYYY-MM-DD.log`
- **Status tracking** real-time via `node status.js`
- Auto-reconnect jika WhatsApp terputus (exponential backoff, maks 5x)

## Struktur File

```
jadwal-wa/
├── kirim_jadwal.js   # Skrip utama
├── logger.js         # Modul logging ke file & console
├── status.js         # CLI untuk cek status terkini
├── status.json       # State real-time (auto-update oleh skrip)
├── jadwal.xlsx       # Data jadwal (tidak di-commit)
├── logs/             # Log harian (auto-create, tidak di-commit)
└── .wwebjs_auth/     # Session WhatsApp (tidak di-commit)
```

## Cara Pakai

### 1. Install dependencies

```bash
npm install
```

### 2. Isi konfigurasi di `kirim_jadwal.js`

```js
const GROUP_ID_ASRAMA = "XXXXXXXXXX@g.us"; // ganti dengan ID grup
const GROUP_ID_SQUAD = "XXXXXXXXXX@g.us";
const JAM_KIRIM = 20; // jam kirim (WIB)
const MENIT_KIRIM = 0;
```

### 3. Jalankan & scan QR

```bash
node kirim_jadwal.js
# Scan QR Code yang muncul dengan WhatsApp
```

### 4. Cari ID grup

```bash
node kirim_jadwal.js --list-groups
```

### 5. Test kirim sekarang

```bash
node kirim_jadwal.js --test
```

### 6. Cek status

```bash
node status.js
```

### 7. Jalankan dengan PM2 (background)

```bash
pm2 start kirim_jadwal.js --name jadwal-wa
pm2 save
```

## Format Excel (`jadwal.xlsx`)

| Sheet           | Isi                                        |
| --------------- | ------------------------------------------ |
| `Jadwal`        | Jadwal adzan & imam per hari (baris 3–9)   |
| `Kontak_Asrama` | Nama, nomor WA, nama tag untuk grup asrama |
| `Kontak_Luar`   | Nama, nomor WA, nama tag untuk grup luar   |
| `Jumatan`       | Posisi Jumatan & jumlah orang per posisi   |

## Stack

- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) — WhatsApp Web API
- [node-cron](https://github.com/node-cron/node-cron) — Penjadwalan cron
- [xlsx](https://github.com/SheetJS/sheetjs) — Baca file Excel
- [PM2](https://pm2.keymetrics.io/) — Process manager (opsional)
