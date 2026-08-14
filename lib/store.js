// Lapisan data aplikasi. Semua fungsi di sini berbicara ke MongoDB Atlas
// lewat lib/db.js — menggantikan penyimpanan file /tmp yang dipakai versi
// prototipe sebelumnya (yang datanya bisa hilang tiap cold start).
//
// Koleksi yang dipakai:
//   roster       { id, nama, nim }
//   settings     satu dokumen tetap (_id: 'app_settings') — jam masuk,
//                toleransi, username & HASH password admin
//   attendance   { pesertaId, nama, tanggal, jamMasuk, statusMasuk,
//                  jamPulang, pulangManual } — satu dokumen per peserta
//                  per hari, unik lewat index {pesertaId, tanggal}

const bcrypt = require('bcryptjs');
const { getDb } = require('./db');
const seed = require('../data/seed.json');

const SETTINGS_ID = 'app_settings';
let ensured = false;

// Pastikan koleksi punya index & data awal (seed) — hanya benar-benar
// mengerjakan sesuatu di request pertama setelah database kosong; sesudah
// itu langsung return karena flag `ensured` sudah true untuk instance ini,
// dan settings collection sudah terisi untuk instance/lokasi lain.
async function ensureReady(db) {
  if (ensured) return;

  const settingsCol = db.collection('settings');
  const rosterCol = db.collection('roster');
  const attendanceCol = db.collection('attendance');

  await attendanceCol.createIndex({ pesertaId: 1, tanggal: 1 }, { unique: true });
  await rosterCol.createIndex({ id: 1 }, { unique: true });

  const existing = await settingsCol.findOne({ _id: SETTINGS_ID });
  if (!existing) {
    const hashedPassword = bcrypt.hashSync(seed.settings.adminPassword, 10);
    await settingsCol.insertOne({
      _id: SETTINGS_ID,
      jamMasuk: seed.settings.jamMasuk,
      toleransi: seed.settings.toleransi,
      adminUsername: seed.settings.adminUsername,
      adminPasswordHash: hashedPassword
    });

    const rosterCount = await rosterCol.countDocuments();
    if (rosterCount === 0 && Array.isArray(seed.roster) && seed.roster.length > 0) {
      await rosterCol.insertMany(seed.roster);
    }
  }

  ensured = true;
}

async function getReadyDb() {
  const db = await getDb();
  await ensureReady(db);
  return db;
}

function todayKey() {
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

// ---------- settings & auth ----------

async function getSettings() {
  const db = await getReadyDb();
  const doc = await db.collection('settings').findOne({ _id: SETTINGS_ID });
  return { jamMasuk: doc.jamMasuk, toleransi: doc.toleransi };
}

async function updateSettings({ jamMasuk, toleransi }) {
  const db = await getReadyDb();
  const set = {};
  if (jamMasuk) set.jamMasuk = jamMasuk;
  if (toleransi !== undefined && toleransi !== null && toleransi !== '') {
    set.toleransi = parseInt(toleransi, 10) || 0;
  }
  await db.collection('settings').updateOne({ _id: SETTINGS_ID }, { $set: set });
  return getSettings();
}

async function verifyAdmin(username, password) {
  const db = await getReadyDb();
  const doc = await db.collection('settings').findOne({ _id: SETTINGS_ID });
  if (!doc || username !== doc.adminUsername) return false;
  return bcrypt.compare(password, doc.adminPasswordHash);
}

async function updateCredentials(username, password) {
  const db = await getReadyDb();
  const hash = await bcrypt.hash(password, 10);
  await db.collection('settings').updateOne(
    { _id: SETTINGS_ID },
    { $set: { adminUsername: username, adminPasswordHash: hash } }
  );
}

// ---------- roster ----------

async function getRoster() {
  const db = await getReadyDb();
  const docs = await db.collection('roster').find({}, { projection: { _id: 0 } }).toArray();
  return docs;
}

async function findPeserta(needle) {
  const db = await getReadyDb();
  const n = String(needle || '').trim().toLowerCase();
  const docs = await db.collection('roster').find({}, { projection: { _id: 0 } }).toArray();
  return docs.find((x) => x.nim.toLowerCase() === n || x.id.toLowerCase() === n) || null;
}

async function findPesertaById(id) {
  const db = await getReadyDb();
  return db.collection('roster').findOne({ id }, { projection: { _id: 0 } });
}

async function addPeserta(nama, nim) {
  const db = await getReadyDb();
  const id = 'PST-' + Math.floor(1000 + Math.random() * 8999);
  const item = { id, nama: String(nama).trim(), nim: nim ? String(nim).trim() : '-' };
  await db.collection('roster').insertOne(item);
  return item;
}

async function deletePeserta(id) {
  const db = await getReadyDb();
  await db.collection('roster').deleteOne({ id });
}

// ---------- attendance (scan / log / history) ----------

async function processScan(pesertaId) {
  const db = await getReadyDb();
  const peserta = await findPesertaById(pesertaId);
  if (!peserta) return { ok: false, message: 'ID kartu tidak terdaftar.' };

  const settingsDoc = await db.collection('settings').findOne({ _id: SETTINGS_ID });
  const attendanceCol = db.collection('attendance');
  const tanggal = todayKey();
  const now = new Date();
  const waktu = formatJam(now);

  const existing = await attendanceCol.findOne({ pesertaId, tanggal });

  if (!existing) {
    const [jh, jm] = settingsDoc.jamMasuk.split(':').map(Number);
    const batas = new Date(now);
    batas.setHours(jh, jm + (settingsDoc.toleransi || 0), 0, 0);
    const statusMasuk = now <= batas ? 'Tepat waktu' : 'Terlambat';

    await attendanceCol.insertOne({
      pesertaId,
      nama: peserta.nama,
      tanggal,
      jamMasuk: waktu,
      statusMasuk,
      jamPulang: null,
      pulangManual: false
    });

    return {
      ok: true,
      peserta,
      jenis: 'Masuk',
      waktu,
      status: statusMasuk,
      message: `Absen masuk tercatat · ${waktu} · ${statusMasuk}`
    };
  }

  if (!existing.jamPulang) {
    await attendanceCol.updateOne(
      { pesertaId, tanggal },
      { $set: { jamPulang: waktu, pulangManual: false } }
    );
    return { ok: true, peserta, jenis: 'Pulang', waktu, message: `Absen pulang tercatat · ${waktu}` };
  }

  return { ok: false, peserta, message: 'Sudah tercatat pulang hari ini.' };
}

async function markPulangManual(pesertaId) {
  const db = await getReadyDb();
  const tanggal = todayKey();
  const attendanceCol = db.collection('attendance');
  const existing = await attendanceCol.findOne({ pesertaId, tanggal });

  if (!existing || existing.jamPulang) {
    return { ok: false, message: 'Peserta belum tercatat masuk hari ini, atau sudah tercatat pulang.' };
  }

  const waktu = formatJam(new Date());
  await attendanceCol.updateOne(
    { pesertaId, tanggal },
    { $set: { jamPulang: waktu, pulangManual: true } }
  );
  return { ok: true, entry: { ...existing, jamPulang: waktu, pulangManual: true } };
}

async function getTodayLog() {
  const db = await getReadyDb();
  const tanggal = todayKey();
  const log = await db
    .collection('attendance')
    .find({ tanggal }, { projection: { _id: 0 } })
    .toArray();
  return { tanggal, log };
}

async function getHistory(pesertaId) {
  const db = await getReadyDb();
  const history = await db
    .collection('attendance')
    .find({ pesertaId }, { projection: { _id: 0 } })
    .sort({ tanggal: -1 })
    .toArray();
  return history;
}

module.exports = {
  getSettings,
  updateSettings,
  verifyAdmin,
  updateCredentials,
  getRoster,
  findPeserta,
  addPeserta,
  deletePeserta,
  processScan,
  markPulangManual,
  getTodayLog,
  getHistory
};
