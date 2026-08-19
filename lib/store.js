// Lapisan data aplikasi. Semua fungsi di sini berbicara ke MongoDB Atlas
// lewat lib/db.js — menggantikan penyimpanan file /tmp yang dipakai versi
// prototipe sebelumnya (yang datanya bisa hilang tiap cold start).
//
// Koleksi yang dipakai:
//   roster       { id, nama, nim, asalKampus }
//   settings     satu dokumen tetap (_id: 'app_settings') — jam masuk,
//                toleransi
//   admins       { username, passwordHash } — bisa lebih dari satu akun admin
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
  const adminsCol = db.collection('admins');

  await attendanceCol.createIndex({ pesertaId: 1, tanggal: 1 }, { unique: true });
  await rosterCol.createIndex({ id: 1 }, { unique: true });
  await adminsCol.createIndex({ username: 1 }, { unique: true });

  const existing = await settingsCol.findOne({ _id: SETTINGS_ID });
  if (!existing) {
    await settingsCol.insertOne({
      _id: SETTINGS_ID,
      jamMasuk: seed.settings.jamMasuk,
      toleransi: seed.settings.toleransi
    });

    const rosterCount = await rosterCol.countDocuments();
    if (rosterCount === 0 && Array.isArray(seed.roster) && seed.roster.length > 0) {
      await rosterCol.insertMany(seed.roster);
    }
  } else if (existing.adminUsername && existing.adminPasswordHash) {
    // Migrasi dari versi lama (admin tunggal disimpan di dokumen settings)
    // ke koleksi admins yang baru, kalau belum pernah dimigrasikan.
    const already = await adminsCol.findOne({ username: existing.adminUsername });
    if (!already) {
      await adminsCol.insertOne({
        username: existing.adminUsername,
        passwordHash: existing.adminPasswordHash
      });
    }
    await settingsCol.updateOne(
      { _id: SETTINGS_ID },
      { $unset: { adminUsername: '', adminPasswordHash: '' } }
    );
  }

  const adminCount = await adminsCol.countDocuments();
  if (adminCount === 0) {
    const hashedPassword = bcrypt.hashSync(seed.settings.adminPassword, 10);
    await adminsCol.insertOne({
      username: seed.settings.adminUsername,
      passwordHash: hashedPassword
    });
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

// Bandingkan waktu sekarang terhadap batas "jam masuk + toleransi", di mana
// batas itu dimaksudkan sebagai jam dinding WIB (Asia/Jakarta) — bukan jam
// lokal server. Vercel menjalankan function di UTC, jadi kalau batas dibangun
// pakai Date.setHours() biasa (zona waktu server), hasilnya keliru drastis
// (offset 7 jam). Di sini batas dibangun eksplisit sebagai instant UTC yang
// benar lewat penulisan offset +07:00 di string ISO, supaya perbandingan
// dengan `now` (instant UTC yang sebenarnya) selalu akurat di zona manapun
// server dijalankan.
function computeStatusMasuk(now, tanggal, jamMasuk, toleransiMenit) {
  const [jh, jm] = jamMasuk.split(':').map(Number);
  let totalMinutes = jh * 60 + jm + (toleransiMenit || 0);
  totalMinutes = ((totalMinutes % 1440) + 1440) % 1440; // jaga-jaga kalau lewat tengah malam
  const bh = Math.floor(totalMinutes / 60);
  const bm = totalMinutes % 60;
  const pad = (n) => String(n).padStart(2, '0');

  const batas = new Date(`${tanggal}T${pad(bh)}:${pad(bm)}:00+07:00`);
  return now <= batas ? 'Tepat waktu' : 'Terlambat';
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
  const doc = await db.collection('admins').findOne({ username });
  if (!doc) return false;
  return bcrypt.compare(password, doc.passwordHash);
}

// Ganti username/password akun admin yang sedang login (dikenali lewat
// oldUsername). Kalau username diganti, dokumen lama dihapus dan diganti
// dokumen baru supaya index unik tetap terjaga.
async function updateCredentials(oldUsername, newUsername, password) {
  const db = await getReadyDb();
  const hash = await bcrypt.hash(password, 10);
  const adminsCol = db.collection('admins');

  if (newUsername !== oldUsername) {
    const clash = await adminsCol.findOne({ username: newUsername });
    if (clash) {
      return { ok: false, message: 'Username tersebut sudah dipakai admin lain.' };
    }
  }

  await adminsCol.updateOne(
    { username: oldUsername },
    { $set: { username: newUsername, passwordHash: hash } }
  );
  return { ok: true };
}

async function getAdmins() {
  const db = await getReadyDb();
  const docs = await db
    .collection('admins')
    .find({}, { projection: { _id: 0, username: 1 } })
    .toArray();
  return docs;
}

async function addAdmin(username, password) {
  const db = await getReadyDb();
  const adminsCol = db.collection('admins');
  const existing = await adminsCol.findOne({ username });
  if (existing) {
    return { ok: false, message: 'Username tersebut sudah dipakai.' };
  }
  const hash = await bcrypt.hash(password, 10);
  await adminsCol.insertOne({ username, passwordHash: hash });
  return { ok: true };
}

async function deleteAdmin(username) {
  const db = await getReadyDb();
  const adminsCol = db.collection('admins');
  const count = await adminsCol.countDocuments();
  if (count <= 1) {
    return { ok: false, message: 'Tidak bisa menghapus satu-satunya akun admin yang tersisa.' };
  }
  await adminsCol.deleteOne({ username });
  return { ok: true };
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

async function addPeserta(nama, nim, asalKampus) {
  const db = await getReadyDb();
  const id = 'PST-' + Math.floor(1000 + Math.random() * 8999);
  const item = {
    id,
    nama: String(nama).trim(),
    nim: nim ? String(nim).trim() : '-',
    asalKampus: asalKampus ? String(asalKampus).trim() : '-'
  };
  await db.collection('roster').insertOne(item);
  return item;
}

async function deletePeserta(id) {
  const db = await getReadyDb();
  await db.collection('roster').deleteOne({ id });
}

// ---------- attendance (scan / log / history) ----------

async function processScan(pesertaId, metode) {
  const metodeAman = metode === 'qr' ? 'qr' : 'manual';
  const db = await getReadyDb();
  const peserta = await findPesertaById(pesertaId);
  if (!peserta) return { ok: false, message: 'ID kartu tidak terdaftar.' };

  const settingsDoc = await db.collection('settings').findOne({ _id: SETTINGS_ID });
  const attendanceCol = db.collection('attendance');
  const tanggal = todayKey();
  const now = new Date();
  const waktu = formatJam(now);

  let existing = await attendanceCol.findOne({ pesertaId, tanggal });

  // Kalau hari ini sudah ada catatan izin/sakit/cuti yang disetujui tapi
  // peserta ternyata tetap datang dan scan, catatan izin itu ditimpa jadi
  // absen masuk asli.
  if (existing && existing.sumber === 'izin') {
    await attendanceCol.deleteOne({ pesertaId, tanggal });
    existing = null;
  }

  if (!existing) {
    const statusMasuk = computeStatusMasuk(now, tanggal, settingsDoc.jamMasuk, settingsDoc.toleransi);

    await attendanceCol.insertOne({
      pesertaId,
      nama: peserta.nama,
      tanggal,
      jamMasuk: waktu,
      statusMasuk,
      jamPulang: null,
      pulangManual: false,
      sumber: 'scan',
      metodeMasuk: metodeAman,
      metodePulang: null
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
      { $set: { jamPulang: waktu, pulangManual: false, metodePulang: metodeAman } }
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

// ---------- izin (izin / sakit / cuti) ----------

const JENIS_IZIN_VALID = ['Izin', 'Sakit', 'Cuti'];
const MAKS_HARI_MUNDUR = 3; // batas ajuan susulan: maksimal 3 hari ke belakang
const MAKS_UKURAN_BUKTI = 1_800_000; // ~1.3MB file asli setelah encode base64 (data URL)

function selisihHari(dariTk, keTk) {
  const a = new Date(dariTk + 'T00:00:00');
  const b = new Date(keTk + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

async function getIzinList({ pesertaId, status }) {
  const db = await getReadyDb();
  const filter = {};
  if (pesertaId) filter.pesertaId = pesertaId;
  if (status && status !== 'Semua') filter.status = status;
  const rows = await db.collection('izin').find(filter, { projection: { _id: 0 } }).toArray();
  rows.sort((a, b) => (a.diajukanPada < b.diajukanPada ? 1 : -1));
  return rows;
}

async function ajukanIzin({ pesertaId, tanggal, jenis, alasan, buktiFoto }) {
  const db = await getReadyDb();
  const peserta = await findPesertaById(pesertaId);
  if (!peserta) return { ok: false, message: 'Peserta tidak ditemukan.' };
  if (!tanggal || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    return { ok: false, message: 'Tanggal izin wajib diisi.' };
  }
  if (!JENIS_IZIN_VALID.includes(jenis)) {
    return { ok: false, message: 'Jenis izin tidak valid.' };
  }
  if (!alasan || !String(alasan).trim()) {
    return { ok: false, message: 'Alasan wajib diisi.' };
  }

  const todayTk = todayKey();
  const selisih = selisihHari(todayTk, tanggal); // negatif = tanggal sudah lewat
  if (selisih < -MAKS_HARI_MUNDUR) {
    return {
      ok: false,
      message: `Tidak bisa mengajukan izin untuk tanggal lebih dari ${MAKS_HARI_MUNDUR} hari yang lalu.`
    };
  }
  const susulan = selisih < 0;

  if (buktiFoto) {
    if (typeof buktiFoto !== 'string' || !buktiFoto.startsWith('data:image/')) {
      return { ok: false, message: 'Format lampiran bukti tidak valid.' };
    }
    if (buktiFoto.length > MAKS_UKURAN_BUKTI) {
      return { ok: false, message: 'Ukuran lampiran bukti terlalu besar. Gunakan foto yang lebih kecil.' };
    }
  }

  const izinCol = db.collection('izin');
  const existingForDate = await izinCol.find({ pesertaId, tanggal }).toArray();
  const sudahAda = existingForDate.find((r) => r.status !== 'Ditolak');
  if (sudahAda) {
    return { ok: false, message: 'Sudah ada pengajuan izin untuk tanggal tersebut.' };
  }

  const item = {
    id: 'IZN-' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100),
    pesertaId,
    nama: peserta.nama,
    tanggal,
    jenis,
    alasan: String(alasan).trim(),
    susulan,
    buktiFoto: buktiFoto || null,
    status: 'Menunggu',
    diajukanPada: new Date().toISOString(),
    diprosesPada: null
  };
  await izinCol.insertOne(item);
  return { ok: true, izin: item };
}

async function approveIzin(izinId) {
  const db = await getReadyDb();
  const izinCol = db.collection('izin');
  const item = await izinCol.findOne({ id: izinId });
  if (!item) return { ok: false, message: 'Pengajuan izin tidak ditemukan.' };
  if (item.status !== 'Menunggu') {
    return { ok: false, message: 'Pengajuan ini sudah diproses sebelumnya.' };
  }

  const attendanceCol = db.collection('attendance');
  const bentrok = await attendanceCol.findOne({ pesertaId: item.pesertaId, tanggal: item.tanggal });
  if (bentrok) {
    return { ok: false, message: 'Peserta sudah punya catatan kehadiran (scan) di tanggal tersebut.' };
  }

  await attendanceCol.insertOne({
    pesertaId: item.pesertaId,
    nama: item.nama,
    tanggal: item.tanggal,
    jamMasuk: null,
    statusMasuk: item.jenis, // 'Izin' | 'Sakit' | 'Cuti'
    jamPulang: null,
    pulangManual: false,
    sumber: 'izin',
    alasan: item.alasan,
    susulan: item.susulan,
    buktiFoto: item.buktiFoto
  });

  const diprosesPada = new Date().toISOString();
  await izinCol.updateOne({ id: izinId }, { $set: { status: 'Disetujui', diprosesPada } });
  return { ok: true, izin: { ...item, status: 'Disetujui', diprosesPada } };
}

async function rejectIzin(izinId) {
  const db = await getReadyDb();
  const izinCol = db.collection('izin');
  const item = await izinCol.findOne({ id: izinId });
  if (!item) return { ok: false, message: 'Pengajuan izin tidak ditemukan.' };
  if (item.status !== 'Menunggu') {
    return { ok: false, message: 'Pengajuan ini sudah diproses sebelumnya.' };
  }
  const diprosesPada = new Date().toISOString();
  await izinCol.updateOne({ id: izinId }, { $set: { status: 'Ditolak', diprosesPada } });
  return { ok: true, izin: { ...item, status: 'Ditolak', diprosesPada } };
}

// ---------- statistik ----------

function addDays(tk, delta) {
  const d = new Date(tk + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function getStats(daysInput) {
  const db = await getReadyDb();
  let days = parseInt(daysInput, 10);
  if (!Number.isFinite(days)) days = 14;
  days = Math.min(60, Math.max(7, days));

  const todayTk = todayKey();
  const tanggalList = [];
  for (let i = days - 1; i >= 0; i--) tanggalList.push(addDays(todayTk, -i));

  const attendanceCol = db.collection('attendance');
  const allEntries = await attendanceCol
    .find({ tanggal: { $in: tanggalList } }, { projection: { _id: 0 } })
    .toArray();

  const byTanggal = {};
  tanggalList.forEach((t) => (byTanggal[t] = []));
  allEntries.forEach((e) => {
    if (byTanggal[e.tanggal]) byTanggal[e.tanggal].push(e);
  });

  const daily = tanggalList.map((tanggal) => {
    const entries = byTanggal[tanggal] || [];
    return {
      tanggal,
      hadir: entries.filter((e) => e.sumber === 'scan').length,
      tepat: entries.filter((e) => e.statusMasuk === 'Tepat waktu').length,
      terlambat: entries.filter((e) => e.statusMasuk === 'Terlambat').length,
      izin: entries.filter((e) => e.sumber === 'izin').length
    };
  });

  const ringkasan = daily.reduce(
    (acc, d) => {
      acc.totalHadir += d.hadir;
      acc.totalTepat += d.tepat;
      acc.totalTerlambat += d.terlambat;
      acc.totalIzin += d.izin;
      return acc;
    },
    { totalHadir: 0, totalTepat: 0, totalTerlambat: 0, totalIzin: 0 }
  );
  ringkasan.persenTepatWaktu =
    ringkasan.totalHadir > 0 ? Math.round((ringkasan.totalTepat / ringkasan.totalHadir) * 100) : null;

  const perPeserta = {};
  allEntries.forEach((e) => {
    if (!perPeserta[e.pesertaId]) {
      perPeserta[e.pesertaId] = { pesertaId: e.pesertaId, nama: e.nama, hadir: 0, tepat: 0, terlambat: 0, izin: 0 };
    }
    const row = perPeserta[e.pesertaId];
    row.nama = e.nama;
    if (e.sumber === 'scan') {
      row.hadir += 1;
      if (e.statusMasuk === 'Tepat waktu') row.tepat += 1;
      if (e.statusMasuk === 'Terlambat') row.terlambat += 1;
    } else if (e.sumber === 'izin') {
      row.izin += 1;
    }
  });

  const peringkat = Object.values(perPeserta)
    .map((r) => ({ ...r, persenTepatWaktu: r.hadir > 0 ? Math.round((r.tepat / r.hadir) * 100) : null }))
    .sort((a, b) => {
      if (a.persenTepatWaktu === null) return 1;
      if (b.persenTepatWaktu === null) return -1;
      return b.persenTepatWaktu - a.persenTepatWaktu || b.hadir - a.hadir;
    });

  return {
    range: { from: tanggalList[0], to: tanggalList[tanggalList.length - 1], days },
    daily,
    ringkasan,
    peringkat
  };
}

module.exports = {
  getSettings,
  updateSettings,
  verifyAdmin,
  updateCredentials,
  getAdmins,
  addAdmin,
  deleteAdmin,
  getRoster,
  findPeserta,
  addPeserta,
  deletePeserta,
  processScan,
  markPulangManual,
  getTodayLog,
  getHistory,
  getIzinList,
  ajukanIzin,
  approveIzin,
  rejectIzin,
  getStats
};
