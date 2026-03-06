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
  const semuaNama  = new Set();
  const listImam   = new Set();
  const jadwal     = {};
  for (let i = 2; i <= 8; i++) {
    const r = rowsJadwal[i];
    if (!r || !r[0]) continue;
    const hari        = r[0].toString().trim();
    const imamMaghrib = r[1] || "-"; const imamIsya  = r[2] || "-";
    const adzSubuh    = r[5] || "-"; const adzDhuhur = r[6] || "-";
    const adzAshar    = r[7] || "-"; const adzMaghrib = r[8] || "-";
    const adzIsya     = r[9] || "-";
    jadwal[hari] = {
      imam:  { Maghrib: imamMaghrib, Isya: imamIsya },
      adzan: { Shubuh: adzSubuh, Dhuhur: adzDhuhur, Ashar: adzAshar, Maghrib: adzMaghrib, Isya: adzIsya },
    };
    [imamMaghrib, imamIsya, adzSubuh, adzDhuhur, adzAshar, adzMaghrib, adzIsya]
      .filter(n => n && n !== "-").forEach(n => semuaNama.add(n));
    [imamMaghrib, imamIsya].filter(n => n && n !== "-").forEach(n => listImam.add(n));
  }
  return { jadwal,
    kontakAsrama:  bacaKontak(wb, SHEET_KONTAK_ASRAMA),
    kontakLuar:    bacaKontak(wb, SHEET_KONTAK_SQUAD),
    posisiJumatan: bacaPosisiJumatan(wb),
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

// ── Resolve kontak ke mention ─────────────────────────────────────────────────
async function resolveContact(client, allContacts, kontak, namaExcel) {
  if (!namaExcel || namaExcel === "-") return { teks: namaExcel || "-", contact: null };
  const info = kontak[namaExcel];
  if (!info || !info.nomor) return { teks: info?.namaTag || namaExcel, contact: null };
  const waId = `${info.nomor}@c.us`;
  let contact = allContacts.find(c => c.id._serialized === waId);
  if (!contact) {
    try { contact = await client.getContactById(waId); } catch { contact = null; }
  }
  return { teks: `@${info.namaTag}`, contact };
}

// ── Buat pesan jadwal harian ──────────────────────────────────────────────────
async function buatPesanHarian(client, jadwal, kontak, tanggalBesok) {
  const namaHari = getNamaHari(tanggalBesok);
  const data     = jadwal[namaHari];
  if (!data) return { body: `Jadwal ${namaHari} tidak ditemukan di Excel.`, mentions: [] };

  const allContacts = await client.getContacts();
  const resolve     = (nama) => resolveContact(client, allContacts, kontak, nama);

  const [subuh, dhuhur, ashar, adzMaghrib, adzIsya, imamMaghrib, imamIsya] =
    await Promise.all([
      resolve(data.adzan.Shubuh), resolve(data.adzan.Dhuhur), resolve(data.adzan.Ashar),
      resolve(data.adzan.Maghrib), resolve(data.adzan.Isya),
      resolve(data.imam.Maghrib),  resolve(data.imam.Isya),
    ]);

  const mentions = [subuh, dhuhur, ashar, adzMaghrib, adzIsya, imamMaghrib, imamIsya]
    .map(r => r.contact).filter(Boolean);

  const body =
`[Jadwal Adzan]
${formatTanggal(tanggalBesok)}
* Shubuh: ${subuh.teks}
- Dzuhur: ${dhuhur.teks}
- Ashar: ${ashar.teks}
- Maghrib: ${adzMaghrib.teks}
- Isya': ${adzIsya.teks}

[Jadwal Imam]
- Maghrib: ${imamMaghrib.teks}
- Isya': ${imamIsya.teks}`;

  return { body, mentions };
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

client.on("ready", async () => {
  console.log("[OK] WhatsApp berhasil terhubung!\n");

  if (process.argv.includes("--test")) {
    const { jadwal, kontakAsrama } = bacaExcel();
    const besok = new Date(); besok.setDate(besok.getDate() + 1);
    const pesan = await buatPesanHarian(client, jadwal, kontakAsrama, besok);
    console.log("\n[INFO] Preview pesan harian:\n" + pesan.body);
    await client.sendMessage(GROUP_ID_ASRAMA, pesan.body, { mentions: pesan.mentions });
    console.log("[OK] Pesan terkirim.");
  }
});

client.on("auth_failure", () =>
  console.error("[ERROR] Autentikasi gagal. Hapus folder .wwebjs_auth dan coba lagi.")
);
client.on("disconnected", reason => {
  console.log("[WARN] WhatsApp terputus:", reason);
  setTimeout(() => client.initialize().catch(e => console.error("[ERROR]", e.message)), 10_000);
});

client.initialize();
