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

  if (!entry) {
    const [jh, jm] = db.settings.jamMasuk.split(':').map(Number);
    const batas = new Date(now);
    batas.setHours(jh, jm + (db.settings.toleransi || 0), 0, 0);
    const statusMasuk = now <= batas ? 'Tepat waktu' : 'Terlambat';

    entry = {
      pesertaId: p.id,
      nama: p.nama,
      tanggal: tk,
      jamMasuk: waktu,
      statusMasuk,
      jamPulang: null,
      pulangManual: false
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
