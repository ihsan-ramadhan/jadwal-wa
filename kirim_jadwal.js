'use strict';

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

// ── Konfigurasi ──────────────────────────────────────────────────────────────
const GROUP_ID_ASRAMA = "XXXXXXXXXX@g.us"; // Ganti dengan ID grup WhatsApp kamu
const GROUP_ID_SQUAD  = "XXXXXXXXXX@g.us"; // Ganti dengan ID grup WhatsApp kamu

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
  console.log("[INFO] Mencoba reconnect dalam 10 detik...");
  setTimeout(() => {
    client.initialize().catch(err =>
      console.error("[ERROR] Gagal reinitialize:", err.message)
    );
  }, 10_000);
});

client.initialize();
