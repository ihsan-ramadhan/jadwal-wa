'use strict';

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const XLSX   = require("xlsx");

// ── Konfigurasi ──────────────────────────────────────────────────────────────
const PATH_EXCEL = "./jadwal.xlsx";

const GROUP_ID_ASRAMA = "XXXXXXXXXX@g.us";
const GROUP_ID_SQUAD  = "XXXXXXXXXX@g.us";

const SHEET_JADWAL        = "Jadwal";
const SHEET_KONTAK_ASRAMA = "Kontak_Asrama";
const SHEET_KONTAK_SQUAD  = "Kontak_Luar";
const SHEET_JUMATAN       = "Jumatan";

// ── Utilitas tanggal ──────────────────────────────────────────────────────────
function getNamaHari(tanggal) {
  return ["Minggu","Senin","Selasa","Rabu","Kamis","Jum'at","Sabtu"][tanggal.getDay()];
}

function formatTanggal(tanggal) {
  return tanggal.toLocaleDateString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function formatTanggalPendek(tanggal) {
  return tanggal.toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric",
  });
}

// ── Baca Excel ────────────────────────────────────────────────────────────────
function bacaExcel() {
  const wb = XLSX.readFile(PATH_EXCEL);

  const wsJadwal   = wb.Sheets[SHEET_JADWAL];
  const rowsJadwal = XLSX.utils.sheet_to_json(wsJadwal, { header: 1, defval: null });

  const semuaNama = new Set();
  const listImam  = new Set();
  const jadwal    = {};

  for (let i = 2; i <= 8; i++) {
    const r = rowsJadwal[i];
    if (!r || !r[0]) continue;
    const hari        = r[0].toString().trim();
    const imamMaghrib = r[1] || "-";
    const imamIsya    = r[2] || "-";
    const adzSubuh    = r[5] || "-";
    const adzDhuhur   = r[6] || "-";
    const adzAshar    = r[7] || "-";
    const adzMaghrib  = r[8] || "-";
    const adzIsya     = r[9] || "-";

    jadwal[hari] = {
      imam:  { Maghrib: imamMaghrib, Isya: imamIsya },
      adzan: { Shubuh: adzSubuh, Dhuhur: adzDhuhur, Ashar: adzAshar, Maghrib: adzMaghrib, Isya: adzIsya },
    };

    [imamMaghrib, imamIsya, adzSubuh, adzDhuhur, adzAshar, adzMaghrib, adzIsya]
      .filter(n => n && n !== "-").forEach(n => semuaNama.add(n));
    [imamMaghrib, imamIsya]
      .filter(n => n && n !== "-").forEach(n => listImam.add(n));
  }

  const kontakAsrama  = bacaKontak(wb, SHEET_KONTAK_ASRAMA);
  const kontakLuar    = bacaKontak(wb, SHEET_KONTAK_SQUAD);
  const posisiJumatan = bacaPosisiJumatan(wb);

  return { jadwal, kontakAsrama, kontakLuar, posisiJumatan,
           semuaNama: [...semuaNama], listImam: [...listImam] };
}

function bacaKontak(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) { console.warn(`[WARN] Sheet "${sheetName}" tidak ditemukan.`); return {}; }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const map  = {};
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    const namaExcel = r[0].toString().trim();
    const nomor     = r[1] ? r[1].toString().trim() : null;
    const namaTag   = r[2] ? r[2].toString().trim() : namaExcel.toLowerCase();
    if (namaExcel) map[namaExcel] = { nomor, namaTag };
  }
  return map;
}

function bacaPosisiJumatan(wb) {
  const ws = wb.Sheets[SHEET_JUMATAN];
  if (!ws) { console.warn(`[WARN] Sheet "${SHEET_JUMATAN}" tidak ditemukan.`); return []; }
  const rows   = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const posisi = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0] || !r[1]) continue;
    const nama = r[0].toString().trim();
    const jml  = parseInt(r[1]);
    if (nama && !isNaN(jml)) posisi.push({ nama, jumlah: jml });
  }
  return posisi;
}

// ── WhatsApp Client ───────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  },
});

client.on("qr", qr => {
  console.log("\nScan QR Code ini dengan WhatsApp kamu:\n");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("[OK] WhatsApp berhasil terhubung!\n");
});

client.on("auth_failure", () => {
  console.error("[ERROR] Autentikasi gagal. Hapus folder .wwebjs_auth dan coba lagi.");
});

client.on("disconnected", reason => {
  console.log("[WARN] WhatsApp terputus:", reason);
  setTimeout(() => {
    client.initialize().catch(err => console.error("[ERROR] Gagal reinitialize:", err.message));
  }, 10_000);
});

client.initialize();
