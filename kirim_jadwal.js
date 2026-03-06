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

// ── Utilitas ──────────────────────────────────────────────────────────────────
function getNamaHari(tanggal) {
  return ["Minggu","Senin","Selasa","Rabu","Kamis","Jum'at","Sabtu"][tanggal.getDay()];
}
function formatTanggal(tanggal) {
  return tanggal.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function formatTanggalPendek(tanggal) {
  return tanggal.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

// Pilih n elemen acak dari array tanpa pengulangan
function pilihRandom(arr, n) {
  const copy = [...arr]; const terpilih = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    terpilih.push(copy.splice(idx, 1)[0]);
  }
  return [terpilih, copy];
}

// ── Baca Excel ────────────────────────────────────────────────────────────────
function bacaExcel() {
  const wb = XLSX.readFile(PATH_EXCEL);
  const rowsJadwal = XLSX.utils.sheet_to_json(wb.Sheets[SHEET_JADWAL], { header: 1, defval: null });
  const semuaNama  = new Set(); const listImam = new Set(); const jadwal = {};
  for (let i = 2; i <= 8; i++) {
    const r = rowsJadwal[i]; if (!r || !r[0]) continue;
    const hari = r[0].toString().trim();
    const [iM, iI, aS, aD, aA, aM, aI] = [r[1]||"-", r[2]||"-", r[5]||"-", r[6]||"-", r[7]||"-", r[8]||"-", r[9]||"-"];
    jadwal[hari] = { imam: { Maghrib: iM, Isya: iI }, adzan: { Shubuh: aS, Dhuhur: aD, Ashar: aA, Maghrib: aM, Isya: aI } };
    [iM,iI,aS,aD,aA,aM,aI].filter(n=>n&&n!=="-").forEach(n=>semuaNama.add(n));
    [iM,iI].filter(n=>n&&n!=="-").forEach(n=>listImam.add(n));
  }
  return { jadwal, kontakAsrama: bacaKontak(wb,SHEET_KONTAK_ASRAMA), kontakLuar: bacaKontak(wb,SHEET_KONTAK_SQUAD),
    posisiJumatan: bacaPosisiJumatan(wb), semuaNama:[...semuaNama], listImam:[...listImam] };
}
function bacaKontak(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) { console.warn(`[WARN] Sheet "${sheetName}" tidak ditemukan.`); return {}; }
  const map = {};
  XLSX.utils.sheet_to_json(ws, { header:1, defval:null }).slice(2).forEach(r => {
    if (!r || !r[0]) return;
    const namaExcel = r[0].toString().trim();
    map[namaExcel] = { nomor: r[1]?.toString().trim()||null, namaTag: r[2]?.toString().trim()||namaExcel.toLowerCase() };
  });
  return map;
}
function bacaPosisiJumatan(wb) {
  const ws = wb.Sheets[SHEET_JUMATAN];
  if (!ws) { console.warn(`[WARN] Sheet "${SHEET_JUMATAN}" tidak ditemukan.`); return []; }
  return XLSX.utils.sheet_to_json(ws, { header:1, defval:null }).slice(2)
    .filter(r=>r&&r[0]&&r[1]).map(r=>({ nama:r[0].toString().trim(), jumlah:parseInt(r[1]) }))
    .filter(p=>!isNaN(p.jumlah));
}

// ── Resolve kontak ────────────────────────────────────────────────────────────
async function resolveContact(client, allContacts, kontak, namaExcel) {
  if (!namaExcel || namaExcel === "-") return { teks: namaExcel||"-", contact: null };
  const info = kontak[namaExcel];
  if (!info?.nomor) return { teks: info?.namaTag||namaExcel, contact: null };
  const waId = `${info.nomor}@c.us`;
  let contact = allContacts.find(c=>c.id._serialized===waId);
  if (!contact) { try { contact = await client.getContactById(waId); } catch { contact=null; } }
  return { teks: `@${info.namaTag}`, contact };
}

// ── Pesan harian ──────────────────────────────────────────────────────────────
async function buatPesanHarian(client, jadwal, kontak, tanggalBesok) {
  const data = jadwal[getNamaHari(tanggalBesok)];
  if (!data) return { body: `Jadwal tidak ditemukan di Excel.`, mentions: [] };
  const all  = await client.getContacts();
  const res  = n => resolveContact(client, all, kontak, n);
  const [sh,dh,as,aM,aI,iM,iI] = await Promise.all([
    res(data.adzan.Shubuh), res(data.adzan.Dhuhur), res(data.adzan.Ashar),
    res(data.adzan.Maghrib), res(data.adzan.Isya), res(data.imam.Maghrib), res(data.imam.Isya)
  ]);
  return {
    body:
`[Jadwal Adzan]
${formatTanggal(tanggalBesok)}
* Shubuh: ${sh.teks}
- Dzuhur: ${dh.teks}
- Ashar: ${as.teks}
- Maghrib: ${aM.teks}
- Isya': ${aI.teks}

[Jadwal Imam]
- Maghrib: ${iM.teks}
- Isya': ${iI.teks}`,
    mentions: [sh,dh,as,aM,aI,iM,iI].map(r=>r.contact).filter(Boolean)
  };
}

// ── Generate petugas Jumatan (acak) ───────────────────────────────────────────
function generateJumat(semuaNama, listImam, posisiJumatan) {
  const used = new Set();
  const [[muadzin]]  = pilihRandom(semuaNama, 1); used.add(muadzin);
  const [[protokol]] = pilihRandom(semuaNama.filter(n=>!used.has(n)), 1); used.add(protokol);

  const waktus = ["Shubuh","Ashar","Maghrib","Isya'"]; const adzanResult = {};
  let poolAdzan = semuaNama.filter(n=>!used.has(n));
  for (const w of waktus) {
    const [[p],sisa] = pilihRandom(poolAdzan,1); adzanResult[w]=p; poolAdzan=sisa; used.add(p);
  }

  let poolImam = listImam.filter(n=>!used.has(n));
  const [[imamMaghrib],pool2] = pilihRandom(poolImam,1); used.add(imamMaghrib);
  const [[imamIsya]]          = pilihRandom(pool2,1);     used.add(imamIsya);

  const posisiResult = {}; let poolPos = semuaNama.filter(n=>n!==muadzin&&n!==protokol);
  for (const pos of posisiJumatan) {
    if (pos.nama==="Lantai Utama") {
      const [[extra]] = pilihRandom(poolPos,1); poolPos=poolPos.filter(n=>n!==extra);
      posisiResult[pos.nama] = [muadzin,protokol,extra];
    } else {
      const [t,s] = pilihRandom(poolPos,pos.jumlah); posisiResult[pos.nama]=t; poolPos=s;
    }
  }
  return { muadzin, protokol, adzanResult, imamMaghrib, imamIsya, posisiResult };
}

// ── Pesan Jumatan ─────────────────────────────────────────────────────────────
async function buatPesanJumat(client, kontak, tanggalBesok, semuaNama, listImam, posisiJumatan) {
  const all = await client.getContacts();
  const res = n => resolveContact(client, all, kontak, n);
  const { muadzin, protokol, adzanResult, imamMaghrib, imamIsya, posisiResult } =
    generateJumat(semuaNama, listImam, posisiJumatan);
  const [rMu,rPr,rIM,rII,rSh,rAs,rMg,rIs] = await Promise.all([
    res(muadzin), res(protokol), res(imamMaghrib), res(imamIsya),
    res(adzanResult["Shubuh"]), res(adzanResult["Ashar"]),
    res(adzanResult["Maghrib"]), res(adzanResult["Isya'"]),
  ]);
  const posisiResolved = {};
  for (const [n,org] of Object.entries(posisiResult))
    posisiResolved[n] = await Promise.all(org.map(res));

  return {
    body:
`*[Petugas Jumatan ${formatTanggalPendek(tanggalBesok)}]*
Muadzin ${rMu.teks}
Protokol+Operator ${rPr.teks}
*Adzan*
Shubuh ${rSh.teks}
Ashar ${rAs.teks}
Maghrib ${rMg.teks}
Isya' ${rIs.teks}
*Imam*
Maghrib ${rIM.teks}
Isya' ${rII.teks}
*Posisi Jumatan*
${Object.entries(posisiResolved).map(([p,o])=>`* *${p}* ${o.map(x=>x.teks).join(" ")}`).join("\n")}`,
    mentions: [rMu,rPr,rIM,rII,rSh,rAs,rMg,rIs,...Object.values(posisiResolved).flat()]
      .map(r=>r.contact).filter(Boolean)
  };
}

// ── WhatsApp Client ───────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true, args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"] },
});

client.on("qr", qr => { console.log("\nScan QR Code ini dengan WhatsApp kamu:\n"); qrcode.generate(qr,{small:true}); });
client.on("ready", async () => {
  console.log("[OK] WhatsApp berhasil terhubung!\n");
  if (process.argv.includes("--test")) {
    const { jadwal, kontakAsrama, semuaNama, listImam, posisiJumatan } = bacaExcel();
    const besok = new Date(); besok.setDate(besok.getDate()+1);
    const isJumat = getNamaHari(besok) === "Jum'at";
    const pesan = isJumat
      ? await buatPesanJumat(client, kontakAsrama, besok, semuaNama, listImam, posisiJumatan)
      : await buatPesanHarian(client, jadwal, kontakAsrama, besok);
    console.log("\n[INFO] Preview pesan:\n" + pesan.body);
    await client.sendMessage(GROUP_ID_ASRAMA, pesan.body, { mentions: pesan.mentions });
    console.log("[OK] Pesan terkirim.");
  }
});
client.on("auth_failure", () => console.error("[ERROR] Autentikasi gagal. Hapus .wwebjs_auth dan coba lagi."));
client.on("disconnected", reason => {
  console.log("[WARN] WhatsApp terputus:", reason);
  setTimeout(()=>client.initialize().catch(e=>console.error("[ERROR]",e.message)), 10_000);
});
client.initialize();
