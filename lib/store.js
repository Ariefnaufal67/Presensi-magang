// Penyimpanan data sederhana berbasis file JSON.
//
// CATATAN PENTING UNTUK PRODUKSI:
// Vercel Serverless Functions berjalan di lingkungan read-only, kecuali folder /tmp.
// File di /tmp TIDAK permanen — bisa hilang saat cold start baru atau deploy ulang.
// Ini cukup untuk PROTOTIPE/DEMO, tapi untuk produksi sungguhan gunakan database
// asli (mis. Vercel Postgres, Vercel KV, Supabase, MongoDB Atlas, dll).

const fs = require('fs');
const path = require('path');

const SEED_PATH = path.join(process.cwd(), 'data', 'seed.json');
const TMP_DB_PATH = '/tmp/presensi-db.json';

function readSeed() {
  const raw = fs.readFileSync(SEED_PATH, 'utf8');
  return JSON.parse(raw);
}

function getDB() {
  try {
    if (fs.existsSync(TMP_DB_PATH)) {
      const raw = fs.readFileSync(TMP_DB_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    // file rusak / tidak terbaca -> jatuh ke seed
  }
  const seed = readSeed();
  try {
    fs.writeFileSync(TMP_DB_PATH, JSON.stringify(seed, null, 2));
  } catch (e) {
    // abaikan kegagalan tulis (mis. filesystem read-only di sebagian lingkungan)
  }
  return seed;
}

function saveDB(db) {
  try {
    fs.writeFileSync(TMP_DB_PATH, JSON.stringify(db, null, 2));
  } catch (e) {
    // abaikan kegagalan tulis
  }
}

function todayKey() {
  // Tanggal berbasis waktu Jakarta (WIB, UTC+7) agar konsisten dengan tampilan.
  const now = new Date();
  const jakarta = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const y = jakarta.getFullYear();
  const m = String(jakarta.getMonth() + 1).padStart(2, '0');
  const d = String(jakarta.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatJam(date) {
  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta'
  });
}

module.exports = { getDB, saveDB, todayKey, formatJam };
