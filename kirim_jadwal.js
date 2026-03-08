'use strict';

require('dotenv').config();
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const pino    = require("pino");
const qrcode  = require("qrcode-terminal");
const XLSX    = require("xlsx");
const cron    = require("node-cron");
const fs      = require("fs");
const path    = require("path");
const logger  = require("./logger");

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

const MAX_RECONNECT = 5;

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
    const nomor     = r[1] ? r[1].toString().trim().replace(/[^0-9]/g, '') : null;
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
function resolveContact(kontak, namaExcel) {
  if (!namaExcel || namaExcel === "-") return { teks: namaExcel || "-", id: null };
  const info = kontak[namaExcel];
  if (!info || !info.nomor) return { teks: info?.namaTag || namaExcel, id: null };
  const jid = `${info.nomor}@s.whatsapp.net`;
  return { teks: `@${info.nomor}`, id: jid };
}

// ── Buat pesan ────────────────────────────────────────────────────────────────
function buatPesanHarian(jadwal, kontak, tanggalBesok) {
  const namaHari = getNamaHari(tanggalBesok);
  const data     = jadwal[namaHari];
  if (!data) return { text: `Jadwal ${namaHari} tidak ditemukan di Excel.`, mentions: [] };

  const resolve = (nama) => resolveContact(kontak, nama);

  const subuh       = resolve(data.adzan.Shubuh);
  const dhuhur      = resolve(data.adzan.Dhuhur);
  const ashar       = resolve(data.adzan.Ashar);
  const adzMaghrib  = resolve(data.adzan.Maghrib);
  const adzIsya     = resolve(data.adzan.Isya);
  const imamMaghrib = resolve(data.imam.Maghrib);
  const imamIsya    = resolve(data.imam.Isya);

  const mentions = [subuh, dhuhur, ashar, adzMaghrib, adzIsya, imamMaghrib, imamIsya]
    .map(r => r.id).filter(Boolean);

  const text =
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

  return { text, mentions };
}

function buatPesanJumat(kontak, tanggalBesok, semuaNama, listImam, posisiJumatan) {
  const resolve = (nama) => resolveContact(kontak, nama);

  const { muadzin, protokol, adzanResult, imamMaghrib, imamIsya, posisiResult } =
    generateJumat(semuaNama, listImam, posisiJumatan);

  const rMuadzin      = resolve(muadzin);
  const rProtokol     = resolve(protokol);
  const rImamMaghrib  = resolve(imamMaghrib);
  const rImamIsya     = resolve(imamIsya);
  const rSubuh        = resolve(adzanResult["Shubuh"]);
  const rAshar        = resolve(adzanResult["Ashar"]);
  const rMaghrib      = resolve(adzanResult["Maghrib"]);
  const rIsya         = resolve(adzanResult["Isya'"]);

  const posisiResolved = {};
  for (const [posNama, orang] of Object.entries(posisiResult)) {
    posisiResolved[posNama] = orang.map(resolve);
  }

  const mentions = [
    rMuadzin, rProtokol, rImamMaghrib, rImamIsya,
    rSubuh, rAshar, rMaghrib, rIsya,
    ...Object.values(posisiResolved).flat(),
  ].map(r => r.id).filter(Boolean);

  const barisPosisi = Object.entries(posisiResolved)
    .map(([pos, orang]) => `* *${pos}* ${orang.map(o => o.teks).join(" ")}`)
    .join("\n");

  const text =
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

  return { text, mentions };
}

// ── Kirim jadwal ─────────────────────────────────────────────────────────────
async function kirimJadwal(sock) {
  const sentGroups = [];
  const sendTime   = new Date().toISOString();

  try {
    logger.cron(`Memulai pengiriman jadwal... (${new Date().toLocaleString("id-ID")})`);

    const { jadwal, kontakAsrama, kontakLuar, posisiJumatan, semuaNama, listImam } = bacaExcel();

    const besok   = new Date();
    besok.setDate(besok.getDate() + 1);
    const isJumat = getNamaHari(besok) === "Jum'at";

    logger.info(`Jadwal untuk: ${getNamaHari(besok)}, ${formatTanggal(besok)} (tipe: ${isJumat ? "Jumat" : "harian"})`);

    function getPesan(kontak) {
      return isJumat
        ? buatPesanJumat(kontak, besok, semuaNama, listImam, posisiJumatan)
        : buatPesanHarian(jadwal, kontak, besok);
    }

    if (GROUP_ID_ASRAMA && GROUP_ID_ASRAMA !== "XXXXXXXXXX@g.us") {
      const pesan = getPesan(kontakAsrama);
      logger.info("Preview pesan ASRAMA:\n" + pesan.text);
      await sock.sendMessage(GROUP_ID_ASRAMA, { text: pesan.text, mentions: pesan.mentions });
      logger.ok("Pesan berhasil dikirim ke grup ASRAMA");
      sentGroups.push("ASRAMA");
    } else {
      logger.skip("Grup ASRAMA dilewati (ID belum diisi)");
    }

    if (GROUP_ID_SQUAD && GROUP_ID_SQUAD !== "XXXXXXXXXX@g.us") {
      const pesan = getPesan(kontakLuar);
      logger.info("Preview pesan LUAR ASRAMA:\n" + pesan.text);
      await sock.sendMessage(GROUP_ID_SQUAD, { text: pesan.text, mentions: pesan.mentions });
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
  }
}

// ── WhatsApp Client ────────────────────────────────────────────────
let reconnectCount = 0;
let sock;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const { version } = await fetchLatestBaileysVersion();
  logger.info(`Menggunakan WA versi v${version.join('.')}`);

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }), // Kembalikan ke silent agar rapi
    browser: Browsers.macOS('Desktop'),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info("Scan QR Code ini dengan WhatsApp kamu:");
      qrcode.generate(qr, { small: true });
      writeStatus({ wa_status: "qr_needed" });
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.warn('WhatsApp terputus akibat:', lastDisconnect.error?.message || 'Unknown', ', Reconnect:', shouldReconnect);
      writeStatus({ wa_status: "disconnected", last_disconnected: new Date().toISOString() });
      
      if (shouldReconnect) {
        if (reconnectCount < MAX_RECONNECT) {
          reconnectCount++;
          setTimeout(connectToWhatsApp, 5000 * reconnectCount);
        } else {
          logger.error(`Batas reconnect (${MAX_RECONNECT}x) tercapai.`);
          if (process.argv.includes("--test")) process.exit(1);
        }
      } else {
        logger.error("Sesi ter-logout. Hapus folder 'auth_info_baileys' dan scan QR lagi.");
        if (process.argv.includes("--test")) process.exit(1);
      }
    } else if (connection === 'open') {
      reconnectCount = 0;
      logger.ok("WhatsApp berhasil terhubung (Baileys)!");
      writeStatus({ wa_status: "connected", last_connected: new Date().toISOString() });

      if (process.argv.some(arg => arg.includes("--list-groups"))) {
        logger.info("Mengambil daftar grup...");
        sock.groupFetchAllParticipating().then(groups => {
          logger.info("=== DAFTAR GRUP ===");
          for (const id in groups) {
            logger.info(`ID: ${id} | Nama: ${groups[id].subject}`);
          }
          logger.info("===================");
          process.exit(0);
        }).catch(err => {
          logger.error("Gagal mengambil daftar grup:", err);
          process.exit(1);
        });
        return;
      }

      if (process.argv.includes("--test")) {
        logger.info("Jalan di mode --test (GitHub Actions mode)..");
        kirimJadwal(sock).then(async () => {
          logger.info("Pengiriman tes selesai, exit 0.");
          await new Promise(r => setTimeout(r, 3000));
          process.exit(0);
        }).catch(err => {
          logger.error("Error di mode --test:", err);
          process.exit(1);
        });
      }
    }
  });
}

// ── Startup & Cron ────────────────────────────────────────────────────────────
logger.info(`Kirim otomatis : setiap jam ${JAM_KIRIM}:${String(MENIT_KIRIM).padStart(2,"0")} WIB`);
logger.info(`File Excel     : ${PATH_EXCEL}`);
logger.info("Tips: node kirim_jadwal.js --test");

connectToWhatsApp();

cron.schedule(
  `0 ${MENIT_KIRIM} ${JAM_KIRIM} * * *`,
  () => {
    logger.cron(`Cron triggered — jam ${JAM_KIRIM}:${String(MENIT_KIRIM).padStart(2,"0")} WIB`);
    if(sock) kirimJadwal(sock);
  },
  { timezone: "Asia/Jakarta" }
);
