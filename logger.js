'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_DIR     = path.join(__dirname, 'logs');
const MAX_LOG_AGE = 30; // hari

// Buat folder logs jika belum ada
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function timestamp() {
  return new Date().toLocaleString('id-ID', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).replace(/\//g, '-');
}

function todayLogFile() {
  const d    = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `${yyyy}-${mm}-${dd}.log`);
}

function writeToFile(line) {
  try {
    fs.appendFileSync(todayLogFile(), line + '\n', 'utf8');
  } catch { /* jangan crash hanya karena log gagal */ }
}

function format(level, msg) {
  return `[${level.padEnd(5)}] ${timestamp()} | ${msg}`;
}

function log(level, msg, extra) {
  const line = format(level, extra !== undefined ? `${msg} ${extra}` : msg);
  console.log(line);
  writeToFile(line);
}

// Bersihkan log lama (> MAX_LOG_AGE hari) — dijalankan sekali saat startup
function cleanOldLogs() {
  try {
    const cutoff = Date.now() - MAX_LOG_AGE * 24 * 60 * 60 * 1000;
    fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .forEach(f => {
        const full  = path.join(LOG_DIR, f);
        const mtime = fs.statSync(full).mtimeMs;
        if (mtime < cutoff) fs.unlinkSync(full);
      });
  } catch { /* abaikan */ }
}

cleanOldLogs();

module.exports = {
  info:  (msg, extra) => log('INFO',  msg, extra),
  ok:    (msg, extra) => log('OK',    msg, extra),
  warn:  (msg, extra) => log('WARN',  msg, extra),
  error: (msg, extra) => log('ERROR', msg, extra),
  cron:  (msg, extra) => log('CRON',  msg, extra),
  skip:  (msg, extra) => log('SKIP',  msg, extra),
  raw:   (line)      => { console.log(line); writeToFile(line); },
};
