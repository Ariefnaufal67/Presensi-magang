// Semua endpoint /api/* digabung jadi SATU serverless function.
//
// KENAPA DIGABUNG:
// Di Vercel, tiap file terpisah di /api/ (mis. scan.js, today.js, history.js)
// jadi function yang benar-benar terpisah, masing-masing dengan folder /tmp
// sendiri. Akibatnya data yang ditulis oleh satu function (mis. scan.js)
// tidak terbaca oleh function lain (mis. today.js) -> log/riwayat kelihatan
// kosong padahal scan sukses. Dengan digabung jadi satu function di sini,
// semua operasi baca/tulis memakai /tmp yang sama sehingga konsisten.
//
// Route ditentukan dari path setelah /api/, contoh:
//   POST /api/login        -> handleLogin
//   GET  /api/roster        -> handleRoster (list)
//   POST /api/scan          -> handleScan
//   GET  /api/history?pesertaId=... -> handleHistory

const { parse: parseUrl } = require('url');
const { getDB, saveDB, todayKey, formatJam } = require('../lib/store');

module.exports = (req, res) => {
  // Route ditentukan langsung dari req.url, bukan dari req.query.route.
  // (req.query.route dari fitur dynamic-route Vercel ternyata tidak selalu
  // terisi dengan konsisten untuk Serverless Functions tanpa framework,
  // jadi kita parse manual di sini supaya pasti jalan.)
  const { pathname, query } = parseUrl(req.url, true);
  const route = pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const method = req.method;

  // Gabungkan query string dari URL dengan req.query bawaan (kalau ada),
  // dipakai oleh handler yang butuh parameter seperti ?pesertaId= atau ?id=
  req.q = Object.assign({}, query, req.query || {});

  try {
    if (route === 'login' && method === 'POST') return handleLogin(req, res);
    if (route === 'roster') return handleRoster(req, res);
    if (route === 'settings') return handleSettings(req, res);
    if (route === 'credentials' && method === 'POST') return handleCredentials(req, res);
    if (route === 'scan' && method === 'POST') return handleScan(req, res);
    if (route === 'mark-pulang' && method === 'POST') return handleMarkPulang(req, res);
    if (route === 'today' && method === 'GET') return handleToday(req, res);
    if (route === 'history' && method === 'GET') return handleHistory(req, res);
    if (route === 'izin' && method === 'GET') return handleIzinList(req, res);
    if (route === 'izin' && method === 'POST') return handleIzinAjukan(req, res);
    if (route === 'izin-approve' && method === 'POST') return handleIzinApprove(req, res);
    if (route === 'izin-reject' && method === 'POST') return handleIzinReject(req, res);

    res.status(404).json({ ok: false, message: 'Endpoint tidak ditemukan: ' + route });
  } catch (e) {
    res.status(500).json({ ok: false, message: 'Terjadi kesalahan server: ' + e.message });
  }
};

// ---------- login ----------
function handleLogin(req, res) {
  const { role, username, password, nim } = req.body || {};
  const db = getDB();

  if (role === 'admin') {
    if (username === db.settings.adminUsername && password === db.settings.adminPassword) {
      res.status(200).json({ ok: true, admin: { username } });
    } else {
      res.status(401).json({ ok: false, message: 'Username atau password salah.' });
    }
    return;
  }

  if (role === 'peserta') {
    const needle = String(nim || '').trim().toLowerCase();
    const p = db.roster.find(
      (x) => x.nim.toLowerCase() === needle || x.id.toLowerCase() === needle
    );
    if (p) {
      res.status(200).json({ ok: true, peserta: p });
    } else {
      res.status(404).json({ ok: false, message: 'NIM / ID tidak ditemukan. Hubungi admin.' });
    }
    return;
  }

  res.status(400).json({ ok: false, message: 'Role tidak valid.' });
}

// ---------- roster ----------
function handleRoster(req, res) {
  const db = getDB();

  if (req.method === 'GET') {
    res.status(200).json({ roster: db.roster });
    return;
  }

  if (req.method === 'POST') {
    const { nama, nim } = req.body || {};
    if (!nama || !String(nama).trim()) {
      res.status(400).json({ ok: false, message: 'Nama wajib diisi.' });
      return;
    }
    const id = 'PST-' + Math.floor(1000 + Math.random() * 8999);
    const item = { id, nama: String(nama).trim(), nim: nim ? String(nim).trim() : '-' };
    db.roster.push(item);
    saveDB(db);
    res.status(200).json({ ok: true, peserta: item, roster: db.roster });
    return;
  }

  if (req.method === 'DELETE') {
    const id = (req.q && req.q.id) || (req.body && req.body.id);
    db.roster = db.roster.filter((p) => p.id !== id);
    saveDB(db);
    res.status(200).json({ ok: true, roster: db.roster });
    return;
  }

  res.status(405).json({ ok: false, message: 'Method not allowed' });
}

// ---------- settings ----------
function handleSettings(req, res) {
  const db = getDB();

  if (req.method === 'GET') {
    res.status(200).json({ jamMasuk: db.settings.jamMasuk, toleransi: db.settings.toleransi });
    return;
  }

  if (req.method === 'POST') {
    const { jamMasuk, toleransi } = req.body || {};
    if (jamMasuk) db.settings.jamMasuk = jamMasuk;
    if (toleransi !== undefined && toleransi !== null && toleransi !== '') {
      db.settings.toleransi = parseInt(toleransi, 10) || 0;
    }
    saveDB(db);
    res.status(200).json({
      ok: true,
      settings: { jamMasuk: db.settings.jamMasuk, toleransi: db.settings.toleransi }
    });
    return;
  }

  res.status(405).json({ ok: false, message: 'Method not allowed' });
}

// ---------- credentials ----------
function handleCredentials(req, res) {
  const { username, password } = req.body || {};
  if (!username || !String(username).trim() || !password || String(password).length < 4) {
    res.status(400).json({
      ok: false,
      message: 'Username wajib diisi & password minimal 4 karakter.'
    });
    return;
  }
  const db = getDB();
  db.settings.adminUsername = String(username).trim();
  db.settings.adminPassword = String(password);
  saveDB(db);
  res.status(200).json({ ok: true });
}

// ---------- scan ----------
function handleScan(req, res) {
  const { id } = req.body || {};
  const db = getDB();
  const p = db.roster.find((x) => x.id === id);
  if (!p) {
    res.status(404).json({ ok: false, message: 'ID kartu tidak terdaftar.' });
    return;
  }

  const tk = todayKey();
  if (!db.logs[tk]) db.logs[tk] = [];
  let entry = db.logs[tk].find((r) => r.pesertaId === p.id);
  const now = new Date();
  const waktu = formatJam(now);

  // Kalau hari ini sudah ada catatan izin/sakit/cuti yang disetujui tapi peserta
  // ternyata tetap datang dan scan, catatan izin itu ditimpa jadi absen masuk asli.
  if (entry && entry.sumber === 'izin') {
    db.logs[tk] = db.logs[tk].filter((r) => r.pesertaId !== p.id);
    entry = null;
  }

  if (!entry) {
    // Bandingkan menggunakan waktu Jakarta (WIB), bukan waktu server (biasanya UTC),
    // supaya "Batas jam masuk" yang diisi admin (mis. 08:00) konsisten dengan jam WIB asli.
    const nowJakarta = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const [jh, jm] = db.settings.jamMasuk.split(':').map(Number);
    const batas = new Date(nowJakarta);
    batas.setHours(jh, jm + (db.settings.toleransi || 0), 0, 0);
    const statusMasuk = nowJakarta <= batas ? 'Tepat waktu' : 'Terlambat';

    entry = {
      pesertaId: p.id,
      nama: p.nama,
      tanggal: tk,
      jamMasuk: waktu,
      statusMasuk,
      jamPulang: null,
      pulangManual: false,
      sumber: 'scan'
    };
    db.logs[tk].push(entry);
    saveDB(db);
    res.status(200).json({
      ok: true,
      peserta: p,
      jenis: 'Masuk',
      waktu,
      status: statusMasuk,
      message: `Absen masuk tercatat · ${waktu} · ${statusMasuk}`
    });
    return;
  }

  if (!entry.jamPulang) {
    entry.jamPulang = waktu;
    entry.pulangManual = false;
    saveDB(db);
    res.status(200).json({
      ok: true,
      peserta: p,
      jenis: 'Pulang',
      waktu,
      message: `Absen pulang tercatat · ${waktu}`
    });
    return;
  }

  res.status(200).json({ ok: false, peserta: p, message: 'Sudah tercatat pulang hari ini.' });
}

// ---------- mark-pulang ----------
function handleMarkPulang(req, res) {
  const { pesertaId } = req.body || {};
  const db = getDB();
  const tk = todayKey();
  const entry = (db.logs[tk] || []).find((r) => r.pesertaId === pesertaId);

  if (!entry || entry.jamPulang) {
    res.status(400).json({
      ok: false,
      message: 'Peserta belum tercatat masuk hari ini, atau sudah tercatat pulang.'
    });
    return;
  }

  entry.jamPulang = formatJam(new Date());
  entry.pulangManual = true;
  saveDB(db);
  res.status(200).json({ ok: true, entry });
}

// ---------- today ----------
function handleToday(req, res) {
  const db = getDB();
  const tk = todayKey();
  res.status(200).json({ tanggal: tk, log: db.logs[tk] || [] });
}

// ---------- history ----------
function handleHistory(req, res) {
  const pesertaId = req.q && req.q.pesertaId;
  if (!pesertaId) {
    res.status(400).json({ ok: false, message: 'pesertaId wajib diisi.' });
    return;
  }

  const db = getDB();
  const rows = [];
  Object.keys(db.logs)
    .sort()
    .reverse()
    .forEach((tanggal) => {
      const entry = (db.logs[tanggal] || []).find((r) => r.pesertaId === pesertaId);
      if (entry) rows.push(entry);
    });

  res.status(200).json({ history: rows });
}

// ---------- izin ----------
const JENIS_IZIN_VALID = ['Izin', 'Sakit', 'Cuti'];

function handleIzinList(req, res) {
  const db = getDB();
  const pesertaId = req.q && req.q.pesertaId;
  const status = req.q && req.q.status;

  let rows = db.izin.slice();
  if (pesertaId) rows = rows.filter((r) => r.pesertaId === pesertaId);
  if (status) rows = rows.filter((r) => r.status === status);
  rows.sort((a, b) => (a.diajukanPada < b.diajukanPada ? 1 : -1));

  res.status(200).json({ izin: rows });
}

function handleIzinAjukan(req, res) {
  const { pesertaId, tanggal, jenis, alasan } = req.body || {};
  const db = getDB();

  const p = db.roster.find((x) => x.id === pesertaId);
  if (!p) {
    res.status(404).json({ ok: false, message: 'Peserta tidak ditemukan.' });
    return;
  }
  if (!tanggal || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    res.status(400).json({ ok: false, message: 'Tanggal izin wajib diisi.' });
    return;
  }
  if (!JENIS_IZIN_VALID.includes(jenis)) {
    res.status(400).json({ ok: false, message: 'Jenis izin tidak valid.' });
    return;
  }
  if (!alasan || !String(alasan).trim()) {
    res.status(400).json({ ok: false, message: 'Alasan wajib diisi.' });
    return;
  }
  const sudahAda = db.izin.find(
    (r) => r.pesertaId === pesertaId && r.tanggal === tanggal && r.status !== 'Ditolak'
  );
  if (sudahAda) {
    res.status(400).json({
      ok: false,
      message: 'Sudah ada pengajuan izin untuk tanggal tersebut.'
    });
    return;
  }

  const item = {
    id: 'IZN-' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100),
    pesertaId,
    nama: p.nama,
    tanggal,
    jenis,
    alasan: String(alasan).trim(),
    status: 'Menunggu',
    diajukanPada: new Date().toISOString(),
    diprosesPada: null
  };
  db.izin.push(item);
  saveDB(db);
  res.status(200).json({ ok: true, izin: item });
}

function handleIzinApprove(req, res) {
  const { izinId } = req.body || {};
  const db = getDB();
  const item = db.izin.find((r) => r.id === izinId);
  if (!item) {
    res.status(404).json({ ok: false, message: 'Pengajuan izin tidak ditemukan.' });
    return;
  }
  if (item.status !== 'Menunggu') {
    res.status(400).json({ ok: false, message: 'Pengajuan ini sudah diproses sebelumnya.' });
    return;
  }

  if (!db.logs[item.tanggal]) db.logs[item.tanggal] = [];
  const bentrok = db.logs[item.tanggal].find((r) => r.pesertaId === item.pesertaId);
  if (bentrok) {
    res.status(400).json({
      ok: false,
      message: 'Peserta sudah punya catatan kehadiran (scan) di tanggal tersebut.'
    });
    return;
  }

  db.logs[item.tanggal].push({
    pesertaId: item.pesertaId,
    nama: item.nama,
    tanggal: item.tanggal,
    jamMasuk: null,
    statusMasuk: item.jenis, // 'Izin' | 'Sakit' | 'Cuti'
    jamPulang: null,
    pulangManual: false,
    sumber: 'izin',
    alasan: item.alasan
  });

  item.status = 'Disetujui';
  item.diprosesPada = new Date().toISOString();
  saveDB(db);
  res.status(200).json({ ok: true, izin: item });
}

function handleIzinReject(req, res) {
  const { izinId } = req.body || {};
  const db = getDB();
  const item = db.izin.find((r) => r.id === izinId);
  if (!item) {
    res.status(404).json({ ok: false, message: 'Pengajuan izin tidak ditemukan.' });
    return;
  }
  if (item.status !== 'Menunggu') {
    res.status(400).json({ ok: false, message: 'Pengajuan ini sudah diproses sebelumnya.' });
    return;
  }

  item.status = 'Ditolak';
  item.diprosesPada = new Date().toISOString();
  saveDB(db);
  res.status(200).json({ ok: true, izin: item });
}
