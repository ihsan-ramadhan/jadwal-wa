'use strict';

const fs   = require('fs');
const path = require('path');

const STATUS_FILE = path.join(__dirname, 'status.json');
const LOG_DIR     = path.join(__dirname, 'logs');

// ── Helpers ─────────────────────────────────────────────────────────────────
function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function formatDt(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function nextCron(hour, minute) {
  const now  = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.toLocaleString('id-ID', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}

function todayLogFile() {
  const d  = new Date();
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `${yy}-${mm}-${dd}.log`);
}

function countTodayLogs() {
  try {
    const content = fs.readFileSync(todayLogFile(), 'utf8');
    return content.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function statusLabel(s) {
  switch (s) {
    case 'connected':    return 'TERHUBUNG';
    case 'disconnected': return 'TERPUTUS';
    case 'initializing': return 'Sedang init...';
    case 'qr_needed':    return 'Perlu scan QR';
    case 'auth_failed':  return 'Auth gagal!';
    case 'reconnecting': return 'Reconnecting...';
    default:            return s || '-';
  }
}

// ── Baca config jam kirim dari kirim_jadwal.js ────────────────────────────
function readCronConfig() {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'kirim_jadwal.js'), 'utf8');
    const jam   = (/const JAM_KIRIM\s*=\s*(\d+)/.exec(src) || [])[1] || '20';
    const menit = (/const MENIT_KIRIM\s*=\s*(\d+)/.exec(src) || [])[1] || '0';
    return { jam: parseInt(jam), menit: parseInt(menit) };
  } catch {
    return { jam: 20, menit: 0 };
  }
}

// ── Tampilkan last N baris log hari ini ───────────────────────────────────
function showRecentLogs(n = 10) {
  try {
    const content = fs.readFileSync(todayLogFile(), 'utf8');
    const lines   = content.split('\n').filter(Boolean);
    const slice   = lines.slice(-n);
    slice.forEach(l => console.log('  ' + l));
  } catch {
    console.log('  (belum ada log hari ini)');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const st = readStatus();
const { jam, menit } = readCronConfig();

const SEP = '═'.repeat(52);
console.log('\n' + SEP);
console.log('  jadwal-wa  |  STATUS TERKINI');
console.log(SEP);

if (!st) {
  console.log('  [ERROR] File status.json tidak ditemukan atau rusak.');
  console.log(SEP + '\n');
  process.exit(1);
}

const sendInfo = st.last_send;

console.log(`  WA          : ${statusLabel(st.wa_status)}`);
if (st.wa_status === 'connected' && st.last_connected) {
  console.log(`  Terhubung   : ${formatDt(st.last_connected)}`);
}
if (st.last_disconnected) {
  console.log(`  Terputus    : ${formatDt(st.last_disconnected)}`);
}
if (st.uptime_start) {
  const uptimeSec = Math.floor((Date.now() - new Date(st.uptime_start).getTime()) / 1000);
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = uptimeSec % 60;
  console.log(`  Uptime      : ${h}j ${m}m ${s}d`);
}
if (st.restart_count > 0) {
  console.log(`  Restart WA  : ${st.restart_count}x`);
}

console.log('  ' + '─'.repeat(50));

if (sendInfo) {
  const statusOk = sendInfo.status === 'ok' ? 'SUKSES' :
                   sendInfo.status === 'partial' ? 'SEBAGIAN' : 'GAGAL';
  console.log(`  Kirim terakhir : ${formatDt(sendInfo.time)}`);
  console.log(`  Tipe pesan     : ${sendInfo.type}`);
  console.log(`  Grup           : ${(sendInfo.groups || []).join(', ') || '-'}`);
  console.log(`  Status kirim   : ${statusOk}`);
  if (sendInfo.error) {
    console.log(`  Error          : ${sendInfo.error}`);
  }
} else {
  console.log('  Kirim terakhir : (belum pernah kirim)');
}

console.log('  ' + '─'.repeat(50));
console.log(`  Cron berikutnya: ${nextCron(jam, menit)} WIB`);
console.log(`  Log hari ini   : ${todayLogFile()}`);
console.log(`  Baris log      : ${countTodayLogs()} baris`);
console.log(SEP + '\n');

// Tampilkan 12 log terakhir hari ini
console.log('  -- 12 log terbaru hari ini --');
showRecentLogs(12);
console.log('');
