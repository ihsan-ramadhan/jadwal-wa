'use strict';

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const XLSX   = require("xlsx");
const cron   = require("node-cron");

// ── Konfigurasi ──────────────────────────────────────────────────────────────
const PATH_EXCEL = "./jadwal.xlsx";

const GROUP_ID_ASRAMA = "XXXXXXXXXX@g.us"; // Ganti dengan ID grup kamu
const GROUP_ID_SQUAD  = "XXXXXXXXXX@g.us"; // Ganti dengan ID grup kamu

const JAM_KIRIM   = 20; // Jam pengiriman otomatis (WIB)
const MENIT_KIRIM = 0;

const SHEET_JADWAL        = "Jadwal";
const SHEET_KONTAK_ASRAMA = "Kontak_Asrama";
const SHEET_KONTAK_SQUAD  = "Kontak_Luar";
const SHEET_JUMATAN       = "Jumatan";

// ── Utilitas ──────────────────────────────────────────────────────────────────
function getNamaHari(t) { return ["Minggu","Senin","Selasa","Rabu","Kamis","Jum'at","Sabtu"][t.getDay()]; }
function formatTanggal(t) { return t.toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"}); }
function formatTanggalPendek(t) { return t.toLocaleDateString("id-ID",{day:"numeric",month:"long",year:"numeric"}); }
function pilihRandom(arr,n) {
  const copy=[...arr],r=[];
  for(let i=0;i<n&&copy.length>0;i++){const idx=Math.floor(Math.random()*copy.length);r.push(copy.splice(idx,1)[0]);}
  return [r,copy];
}

// ── Baca Excel ────────────────────────────────────────────────────────────────
function bacaExcel() {
  const wb=XLSX.readFile(PATH_EXCEL), rows=XLSX.utils.sheet_to_json(wb.Sheets[SHEET_JADWAL],{header:1,defval:null});
  const semuaNama=new Set(),listImam=new Set(),jadwal={};
  for(let i=2;i<=8;i++){
    const r=rows[i]; if(!r||!r[0]) continue;
    const hari=r[0].toString().trim();
    const [iM,iI,aS,aD,aA,aM,aI]=[r[1]||"-",r[2]||"-",r[5]||"-",r[6]||"-",r[7]||"-",r[8]||"-",r[9]||"-"];
    jadwal[hari]={imam:{Maghrib:iM,Isya:iI},adzan:{Shubuh:aS,Dhuhur:aD,Ashar:aA,Maghrib:aM,Isya:aI}};
    [iM,iI,aS,aD,aA,aM,aI].filter(n=>n&&n!=="-").forEach(n=>semuaNama.add(n));
    [iM,iI].filter(n=>n&&n!=="-").forEach(n=>listImam.add(n));
  }
  return {jadwal,kontakAsrama:bacaKontak(wb,SHEET_KONTAK_ASRAMA),kontakLuar:bacaKontak(wb,SHEET_KONTAK_SQUAD),
    posisiJumatan:bacaPosisiJumatan(wb),semuaNama:[...semuaNama],listImam:[...listImam]};
}
function bacaKontak(wb,sn){
  const ws=wb.Sheets[sn]; if(!ws){console.warn(`[WARN] Sheet "${sn}" tidak ditemukan.`);return{};}
  const map={};
  XLSX.utils.sheet_to_json(ws,{header:1,defval:null}).slice(2).forEach(r=>{
    if(!r||!r[0])return;
    const ne=r[0].toString().trim();
    map[ne]={nomor:r[1]?.toString().trim()||null,namaTag:r[2]?.toString().trim()||ne.toLowerCase()};
  });
  return map;
}
function bacaPosisiJumatan(wb){
  const ws=wb.Sheets[SHEET_JUMATAN]; if(!ws)return[];
  return XLSX.utils.sheet_to_json(ws,{header:1,defval:null}).slice(2)
    .filter(r=>r&&r[0]&&r[1]).map(r=>({nama:r[0].toString().trim(),jumlah:parseInt(r[1])})).filter(p=>!isNaN(p.jumlah));
}

// ── Resolve kontak ────────────────────────────────────────────────────────────
async function resolveContact(client,allContacts,kontak,namaExcel){
  if(!namaExcel||namaExcel==="-")return{teks:namaExcel||"-",contact:null};
  const info=kontak[namaExcel];
  if(!info?.nomor)return{teks:info?.namaTag||namaExcel,contact:null};
  const waId=`${info.nomor}@c.us`;
  let contact=allContacts.find(c=>c.id._serialized===waId);
  if(!contact){try{contact=await client.getContactById(waId);}catch{contact=null;}}
  return{teks:`@${info.namaTag}`,contact};
}

// ── Pesan harian ──────────────────────────────────────────────────────────────
async function buatPesanHarian(client,jadwal,kontak,besok){
  const data=jadwal[getNamaHari(besok)];
  if(!data)return{body:`Jadwal tidak ditemukan di Excel.`,mentions:[]};
  const all=await client.getContacts(),res=n=>resolveContact(client,all,kontak,n);
  const [sh,dh,as,aM,aI,iM,iI]=await Promise.all([
    res(data.adzan.Shubuh),res(data.adzan.Dhuhur),res(data.adzan.Ashar),
    res(data.adzan.Maghrib),res(data.adzan.Isya),res(data.imam.Maghrib),res(data.imam.Isya)
  ]);
  return{body:`[Jadwal Adzan]\n${formatTanggal(besok)}\n* Shubuh: ${sh.teks}\n- Dzuhur: ${dh.teks}\n- Ashar: ${as.teks}\n- Maghrib: ${aM.teks}\n- Isya': ${aI.teks}\n\n[Jadwal Imam]\n- Maghrib: ${iM.teks}\n- Isya': ${iI.teks}`,
    mentions:[sh,dh,as,aM,aI,iM,iI].map(r=>r.contact).filter(Boolean)};
}

// ── Pesan Jumatan ─────────────────────────────────────────────────────────────
function generateJumat(semuaNama,listImam,posisiJumatan){
  const used=new Set();
  const[[mu]]=pilihRandom(semuaNama,1);used.add(mu);
  const[[pr]]=pilihRandom(semuaNama.filter(n=>!used.has(n)),1);used.add(pr);
  const adzanResult={};let poolA=semuaNama.filter(n=>!used.has(n));
  for(const w of["Shubuh","Ashar","Maghrib","Isya'"]){
    const[[p],s]=pilihRandom(poolA,1);adzanResult[w]=p;poolA=s;used.add(p);
  }
  let poolI=listImam.filter(n=>!used.has(n));
  const[[iM],pI2]=pilihRandom(poolI,1);used.add(iM);const[[iI]]=pilihRandom(pI2,1);used.add(iI);
  const posisiResult={};let poolP=semuaNama.filter(n=>n!==mu&&n!==pr);
  for(const pos of posisiJumatan){
    if(pos.nama==="Lantai Utama"){const[[e]]=pilihRandom(poolP,1);poolP=poolP.filter(n=>n!==e);posisiResult[pos.nama]=[mu,pr,e];}
    else{const[t,s]=pilihRandom(poolP,pos.jumlah);posisiResult[pos.nama]=t;poolP=s;}
  }
  return{muadzin:mu,protokol:pr,adzanResult,imamMaghrib:iM,imamIsya:iI,posisiResult};
}
async function buatPesanJumat(client,kontak,besok,semuaNama,listImam,posisiJumatan){
  const all=await client.getContacts(),res=n=>resolveContact(client,all,kontak,n);
  const{muadzin,protokol,adzanResult,imamMaghrib,imamIsya,posisiResult}=generateJumat(semuaNama,listImam,posisiJumatan);
  const[rMu,rPr,rIM,rII,rSh,rAs,rMg,rIs]=await Promise.all([
    res(muadzin),res(protokol),res(imamMaghrib),res(imamIsya),
    res(adzanResult["Shubuh"]),res(adzanResult["Ashar"]),res(adzanResult["Maghrib"]),res(adzanResult["Isya'"]),
  ]);
  const posRes={};
  for(const[n,org]of Object.entries(posisiResult))posRes[n]=await Promise.all(org.map(res));
  return{
    body:`*[Petugas Jumatan ${formatTanggalPendek(besok)}]*\nMuadzin ${rMu.teks}\nProtokol+Operator ${rPr.teks}\n*Adzan*\nShubuh ${rSh.teks}\nAshar ${rAs.teks}\nMaghrib ${rMg.teks}\nIsya' ${rIs.teks}\n*Imam*\nMaghrib ${rIM.teks}\nIsya' ${rII.teks}\n*Posisi Jumatan*\n${Object.entries(posRes).map(([p,o])=>`* *${p}* ${o.map(x=>x.teks).join(" ")}`).join("\n")}`,
    mentions:[rMu,rPr,rIM,rII,rSh,rAs,rMg,rIs,...Object.values(posRes).flat()].map(r=>r.contact).filter(Boolean)
  };
}

// ── Kirim jadwal ke grup ──────────────────────────────────────────────────────
async function kirimJadwal(client) {
  if (client.info == null) {
    console.warn("[WARN] Kirim dibatalkan — WhatsApp belum siap.");
    return;
  }
  try {
    console.log(`\n[CRON] ${new Date().toLocaleString("id-ID")} — Memulai pengiriman...`);
    const { jadwal, kontakAsrama, kontakLuar, posisiJumatan, semuaNama, listImam } = bacaExcel();
    const besok   = new Date(); besok.setDate(besok.getDate()+1);
    const isJumat = getNamaHari(besok) === "Jum'at";
    console.log(`[INFO] Tipe pesan: ${isJumat?"Jumatan":"Harian"} — ${getNamaHari(besok)}, ${formatTanggal(besok)}`);

    const getPesan = kontak => isJumat
      ? buatPesanJumat(client,kontak,besok,semuaNama,listImam,posisiJumatan)
      : buatPesanHarian(client,jadwal,kontak,besok);

    if (GROUP_ID_ASRAMA && GROUP_ID_ASRAMA !== "XXXXXXXXXX@g.us") {
      const pesan = await getPesan(kontakAsrama);
      console.log("\n[INFO] Pesan Asrama:\n" + pesan.body);
      await client.sendMessage(GROUP_ID_ASRAMA, pesan.body, { mentions: pesan.mentions });
      console.log("[OK] Terkirim ke grup ASRAMA");
    } else {
      console.log("[SKIP] Grup ASRAMA dilewati (ID belum diisi)");
    }

    if (GROUP_ID_SQUAD && GROUP_ID_SQUAD !== "XXXXXXXXXX@g.us") {
      const pesan = await getPesan(kontakLuar);
      console.log("\n[INFO] Pesan Luar Asrama:\n" + pesan.body);
      await client.sendMessage(GROUP_ID_SQUAD, pesan.body, { mentions: pesan.mentions });
      console.log("[OK] Terkirim ke grup LUAR ASRAMA");
    } else {
      console.log("[SKIP] Grup LUAR ASRAMA dilewati (ID belum diisi)");
    }

  } catch (err) {
    console.error("[ERROR] Gagal kirim:", err.message);
    console.error(err.stack);
  }
}

async function listGrup(client) {
  console.log("\n[INFO] Daftar semua grup WhatsApp:");
  const groups = (await client.getChats()).filter(c=>c.isGroup);
  if (!groups.length) { console.log("Tidak ada grup."); return; }
  groups.forEach(g => { console.log(`  Nama : ${g.name}`); console.log(`  ID   : ${g.id._serialized}`); console.log(`  ${"─".repeat(45)}`); });
  console.log("\nCopy ID grup yang sesuai ke GROUP_ID_ASRAMA / GROUP_ID_SQUAD.");
}

// ── WhatsApp Client ───────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true, args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"] },
});

client.on("qr", qr => { console.log("\nScan QR Code ini dengan WhatsApp kamu:\n"); qrcode.generate(qr,{small:true}); });
client.on("ready", () => {
  console.log("[OK] WhatsApp berhasil terhubung!\n");
  if (process.argv.includes("--test"))        kirimJadwal(client);
  if (process.argv.includes("--list-groups")) listGrup(client);
});
client.on("auth_failure", () => console.error("[ERROR] Autentikasi gagal. Hapus .wwebjs_auth dan coba lagi."));
client.on("disconnected", reason => {
  console.log("[WARN] WhatsApp terputus:", reason);
  setTimeout(()=>client.initialize().catch(e=>console.error("[ERROR]",e.message)), 10_000);
});

// ── Cron ──────────────────────────────────────────────────────────────────────
cron.schedule(
  `0 ${MENIT_KIRIM} ${JAM_KIRIM} * * *`,
  () => kirimJadwal(client),
  { timezone: "Asia/Jakarta" }
);

console.log(`Kirim otomatis : setiap jam ${JAM_KIRIM}:${String(MENIT_KIRIM).padStart(2,"0")} WIB`);
console.log(`File Excel     : ${PATH_EXCEL}`);
console.log(`\nTips:`);
console.log(`  node kirim_jadwal.js --list-groups   -> lihat ID semua grup`);
console.log(`  node kirim_jadwal.js --test          -> kirim pesan sekarang\n`);

client.initialize();
