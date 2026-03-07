'use strict';

require('dotenv').config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode  = require("qrcode-terminal");
const XLSX    = require("xlsx");
const cron    = require("node-cron");
const fs      = require("fs");
const path    = require("path");
const { execSync } = require("child_process");
const logger  = require("./logger");

// Jika dalam 2 menit belum ready, trigger reconnect
const INIT_TIMEOUT_MS = 2 * 60 * 1000; // 2 menit

// ── Konfigurasi ──────────────────────────────────────────────────────────────
const PATH_EXCEL = "./jadwal.xlsx";

const GROUP_ID_ASRAMA = process.env.GROUP_ID_ASRAMA || "XXXXXXXXXX@g.us";
const GROUP_ID_SQUAD  = process.env.GROUP_ID_SQUAD || "XXXXXXXXXX@g.us";

const JAM_KIRIM   = 20;
const MENIT_KIRIM = 0;

const SHEET_JADWAL        = "Jadwal";
const SHEET_KONTAK_ASRAMA = "Kontak_Asrama";
const SHEET_KONTAK_SQUAD  = "Kontak_Luar";
const SHEET_JUMATAN       = "Jumatan";

const MAX_RECONNECT = 5;   // batas maksimal reconnect otomatis

// ── Status tracking ───────────────────────────────────────────────────────────
const STATUS_FILE = path.join(__dirname, "status.json");

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8")); } catch { return {}; }
}

function writeStatus(patch) {
  try {
    const current = readStatus();
    const next    = Object.assign(current, patch);
    fs.writeFileSync(STATUS_FILE, JSON.stringify(next, null, 2), "utf8");
  } catch (e) {
    logger.warn("Gagal update status.json:", e.message);
  }
}

// Init status saat startup
writeStatus({ wa_status: "initializing", uptime_start: new Date().toISOString() });

// ── Helper ───────────────────────────────────────────────────────────────────
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

function pilihRandom(arr, n) {
  const copy     = [...arr];
  const terpilih = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    terpilih.push(copy.splice(idx, 1)[0]);
  }
  return [terpilih, copy];
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
  if (!ws) { logger.warn(`Sheet "${sheetName}" tidak ditemukan.`); return {}; }
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
  if (!ws) { logger.warn(`Sheet "${SHEET_JUMATAN}" tidak ditemukan.`); return []; }
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

// ── Generate Jumat ────────────────────────────────────────────────────────────
function generateJumat(semuaNama, listImam, posisiJumatan) {
  const sudahBertugas = new Set();

  const [[muadzin]] = pilihRandom(semuaNama, 1);
  sudahBertugas.add(muadzin);

  let poolProtokol = semuaNama.filter(n => !sudahBertugas.has(n));
  const [[protokol]] = pilihRandom(poolProtokol, 1);
  sudahBertugas.add(protokol);

  const waktusAdzan = ["Shubuh", "Ashar", "Maghrib", "Isya'"];
  const adzanResult = {};
  let poolAdzan = semuaNama.filter(n => !sudahBertugas.has(n));
  for (const waktu of waktusAdzan) {
    const [[pilihan], sisa] = pilihRandom(poolAdzan, 1);
    adzanResult[waktu] = pilihan;
    poolAdzan = sisa;
    sudahBertugas.add(pilihan);
  }

  let poolImam = listImam.filter(n => !sudahBertugas.has(n));
  const [[imamMaghrib], poolImam2] = pilihRandom(poolImam, 1);
  sudahBertugas.add(imamMaghrib);
  const [[imamIsya]] = pilihRandom(poolImam2, 1);
  sudahBertugas.add(imamIsya);

  const posisiResult = {};
  let poolPosisi = semuaNama.filter(n => n !== muadzin && n !== protokol);

  for (const pos of posisiJumatan) {
    if (pos.nama === "Lantai Utama") {
      const [[extra]] = pilihRandom(poolPosisi, 1);
      poolPosisi = poolPosisi.filter(n => n !== extra);
      posisiResult[pos.nama] = [muadzin, protokol, extra];
    } else {
      const [terpilih, sisa] = pilihRandom(poolPosisi, pos.jumlah);
      posisiResult[pos.nama] = terpilih;
      poolPosisi = sisa;
    }
  }

  return { muadzin, protokol, adzanResult, imamMaghrib, imamIsya, posisiResult };
}

// ── Resolve kontak ────────────────────────────────────────────────────────────
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

// ── Buat pesan ────────────────────────────────────────────────────────────────
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

async function buatPesanJumat(client, kontak, tanggalBesok, semuaNama, listImam, posisiJumatan) {
  const allContacts = await client.getContacts();
  const resolve     = (nama) => resolveContact(client, allContacts, kontak, nama);

  const { muadzin, protokol, adzanResult, imamMaghrib, imamIsya, posisiResult } =
    generateJumat(semuaNama, listImam, posisiJumatan);

  const [rMuadzin, rProtokol, rImamMaghrib, rImamIsya,
         rSubuh, rAshar, rMaghrib, rIsya] =
    await Promise.all([
      resolve(muadzin), resolve(protokol),
      resolve(imamMaghrib), resolve(imamIsya),
      resolve(adzanResult["Shubuh"]),  resolve(adzanResult["Ashar"]),
      resolve(adzanResult["Maghrib"]), resolve(adzanResult["Isya'"]),
    ]);

  const posisiResolved = {};
  for (const [posNama, orang] of Object.entries(posisiResult)) {
    posisiResolved[posNama] = await Promise.all(orang.map(resolve));
  }

  const mentions = [
    rMuadzin, rProtokol, rImamMaghrib, rImamIsya,
    rSubuh, rAshar, rMaghrib, rIsya,
    ...Object.values(posisiResolved).flat(),
  ].map(r => r.contact).filter(Boolean);

  const barisPosisi = Object.entries(posisiResolved)
    .map(([pos, orang]) => `* *${pos}* ${orang.map(o => o.teks).join(" ")}`)
    .join("\n");

  const body =
`*[Petugas Jumatan ${formatTanggalPendek(tanggalBesok)}]*
Muadzin ${rMuadzin.teks}
Protokol+Operator ${rProtokol.teks}
*Adzan*
Shubuh ${rSubuh.teks}
Ashar ${rAshar.teks}
Maghrib ${rMaghrib.teks}
Isya' ${rIsya.teks}
*Imam*
Maghrib ${rImamMaghrib.teks}
Isya' ${rImamIsya.teks}
*Posisi Jumatan*
${barisPosisi}`;

  return { body, mentions };
}

// ── Kirim jadwal ─────────────────────────────────────────────────────────────
async function kirimJadwal(client) {
  if (client.info == null) {
    logger.warn("Kirim jadwal dibatalkan — WhatsApp belum siap atau sudah disconnect.");
    return;
  }

  const sentGroups = [];
  const sendTime   = new Date().toISOString();

  try {
    logger.cron(`Memulai pengiriman jadwal... (${new Date().toLocaleString("id-ID")})`);

    const { jadwal, kontakAsrama, kontakLuar, posisiJumatan, semuaNama, listImam } = bacaExcel();

    const besok   = new Date();
    besok.setDate(besok.getDate() + 1);
    const isJumat = getNamaHari(besok) === "Jum'at";

    logger.info(`Jadwal untuk: ${getNamaHari(besok)}, ${formatTanggal(besok)} (tipe: ${isJumat ? "Jumat" : "harian"})`);

    async function getPesan(kontak) {
      return isJumat
        ? buatPesanJumat(client, kontak, besok, semuaNama, listImam, posisiJumatan)
        : buatPesanHarian(client, jadwal, kontak, besok);
    }

    if (GROUP_ID_ASRAMA && GROUP_ID_ASRAMA !== "XXXXXXXXXX@g.us") {
      const pesan = await getPesan(kontakAsrama);
      logger.info("Preview pesan ASRAMA:\n" + pesan.body);
      await client.sendMessage(GROUP_ID_ASRAMA, pesan.body, { mentions: pesan.mentions });
      logger.ok("Pesan berhasil dikirim ke grup ASRAMA");
      sentGroups.push("ASRAMA");
    } else {
      logger.skip("Grup ASRAMA dilewati (ID belum diisi)");
    }

    if (GROUP_ID_SQUAD && GROUP_ID_SQUAD !== "XXXXXXXXXX@g.us") {
      const pesan = await getPesan(kontakLuar);
      logger.info("Preview pesan LUAR ASRAMA:\n" + pesan.body);
      await client.sendMessage(GROUP_ID_SQUAD, pesan.body, { mentions: pesan.mentions });
      logger.ok("Pesan berhasil dikirim ke grup LUAR ASRAMA");
      sentGroups.push("LUAR ASRAMA");
    } else {
      logger.skip("Grup LUAR ASRAMA dilewati (ID belum diisi)");
    }

    writeStatus({
      last_send: {
        time:   sendTime,
        type:   isJumat ? "jumat" : "harian",
        groups: sentGroups,
        status: "ok",
        error:  null,
      },
    });

    logger.ok(`Pengiriman selesai. Grup terkirim: ${sentGroups.join(", ") || "tidak ada"}`);

  } catch (err) {
    logger.error("Gagal kirim jadwal:", err.message);
    logger.error(err.stack);

    writeStatus({
      last_send: {
        time:   sendTime,
        type:   "unknown",
        groups: sentGroups,
        status: "error",
        error:  err.message,
      },
    });

    // Jika error karena detached frame / browser crash, trigger reconnect
    if (/detached Frame|Session closed|Target closed|Protocol error/i.test(err.message)) {
      logger.warn("Terdeteksi browser/frame error — memulai reinitialize...");
      triggerReconnect("browser-error");
    }
  }
}

// ── Kirim daftar grup ─────────────────────────────────────────────────────────
async function listGrup(client) {
  logger.info("Daftar semua grup WhatsApp:");
  const chats  = await client.getChats();
  const groups = chats.filter(c => c.isGroup);
  if (!groups.length) { logger.info("Tidak ada grup ditemukan."); return; }
  groups.forEach(g => {
    logger.raw(`  Nama : ${g.name}`);
    logger.raw(`  ID   : ${g.id._serialized}`);
    logger.raw(`  ${"─".repeat(45)}`);
  });
  logger.info("Copy ID grup yang sesuai ke GROUP_ID_ASRAMA / GROUP_ID_SQUAD.");
}

// ── WhatsApp Client & Reconnect ───────────────────────────────────────────────
let reconnectCount = 0;
let isReconnecting = false;

function createClient() {
  return new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-features=site-per-process",
        "--disable-site-isolation-trials",
        "--no-first-run",
      ],
    },
  });
}

let client = createClient();

function attachEvents(c) {
  c.on("qr", qr => {
    logger.info("Scan QR Code ini dengan WhatsApp kamu:");
    qrcode.generate(qr, { small: true });
    writeStatus({ wa_status: "qr_needed" });
  });

  c.on("ready", () => {
    reconnectCount = 0;
    isReconnecting = false;
    logger.ok("WhatsApp berhasil terhubung!");
    writeStatus({ wa_status: "connected", last_connected: new Date().toISOString() });

    if (process.argv.includes("--test"))        kirimJadwal(c);
    if (process.argv.includes("--list-groups")) listGrup(c);
  });

  c.on("auth_failure", () => {
    logger.error("Autentikasi gagal. Hapus folder .wwebjs_auth dan coba lagi.");
    writeStatus({ wa_status: "auth_failed" });
  });

  c.on("disconnected", reason => {
    logger.warn("WhatsApp terputus. Alasan:", reason);
    writeStatus({ wa_status: "disconnected", last_disconnected: new Date().toISOString() });
    triggerReconnect("disconnected");
  });
}

function triggerReconnect(reason) {
  if (isReconnecting) {
    logger.warn(`Reconnect sudah berjalan, skip. (pemicu: ${reason})`);
    return;
  }
  if (reconnectCount >= MAX_RECONNECT) {
    logger.error(`Batas reconnect (${MAX_RECONNECT}x) tercapai. Hentikan reconnect otomatis.`);
    logger.error("Jalankan ulang secara manual: pm2 restart jadwal-wa");
    writeStatus({ wa_status: "reconnect_limit_reached" });
    return;
  }

  isReconnecting  = true;
  reconnectCount += 1;
  const delay     = Math.min(reconnectCount * 10_000, 60_000); // 10s, 20s, 30s, dst maks 60s

  logger.info(`Reconnect ke-${reconnectCount}/${MAX_RECONNECT} dalam ${delay / 1000}s... (alasan: ${reason})`);
  writeStatus({ wa_status: "reconnecting", restart_count: reconnectCount });

  setTimeout(async () => {
    try {
      // Destroy client lama sepenuhnya sebelum buat baru
      try { await client.destroy(); } catch { /* abaikan */ }

      // Force-kill semua proses Chrome yang mungkin tersisa
      try {
        execSync('taskkill /F /IM chrome.exe /T 2>nul', { stdio: 'ignore' });
        logger.info("Proses Chrome lama sudah dibersihkan.");
      } catch { /* abaikan jika tidak ada */ }

      // Tunggu sebentar agar port/socket sempat bebas
      await new Promise(r => setTimeout(r, 3000));

      client = createClient();
      attachEvents(client);

      // Pasang timeout: jika tidak ready dalam INIT_TIMEOUT_MS, trigger reconnect
      let initTimeout = setTimeout(() => {
        logger.warn(`Initialize timeout (>${INIT_TIMEOUT_MS/1000}s) — memulai reconnect...`);
        writeStatus({ wa_status: "init_timeout" });
        isReconnecting = false;
        triggerReconnect("init-timeout");
      }, INIT_TIMEOUT_MS);

      client.once("ready", () => clearTimeout(initTimeout));
      client.once("auth_failure", () => clearTimeout(initTimeout));

      await client.initialize();
    } catch (err) {
      logger.error("Gagal reinitialize client:", err.message);
      isReconnecting = false;
      triggerReconnect("init-error");
    }
  }, delay);
}

// ── Cron ──────────────────────────────────────────────────────────────────────
cron.schedule(
  `0 ${MENIT_KIRIM} ${JAM_KIRIM} * * *`,
  () => {
    logger.cron(`Cron triggered — jam ${JAM_KIRIM}:${String(MENIT_KIRIM).padStart(2,"0")} WIB`);
    kirimJadwal(client);
  },
  { timezone: "Asia/Jakarta" }
);

// ── Startup ───────────────────────────────────────────────────────────────────
logger.info(`Kirim otomatis : setiap jam ${JAM_KIRIM}:${String(MENIT_KIRIM).padStart(2,"0")} WIB`);
logger.info(`File Excel     : ${PATH_EXCEL}`);
logger.info("Tips: node kirim_jadwal.js --list-groups | --test");

attachEvents(client);

// Pasang timeout awal: jika tidak ready dalam INIT_TIMEOUT_MS, trigger reconnect
let startupTimeout = setTimeout(() => {
  logger.warn(`Initialize timeout saat startup (>${INIT_TIMEOUT_MS/1000}s) — memulai reconnect...`);
  writeStatus({ wa_status: "init_timeout" });
  triggerReconnect("startup-timeout");
}, INIT_TIMEOUT_MS);

client.once("ready", () => clearTimeout(startupTimeout));
client.once("auth_failure", () => clearTimeout(startupTimeout));

client.initialize();
