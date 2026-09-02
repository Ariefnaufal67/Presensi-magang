const { parse: parseUrl } = require('url');
const store = require('../lib/store');

module.exports = async (req, res) => {
  // Route ditentukan langsung dari req.url (bukan req.query.route bawaan
  // Vercel), karena fitur dynamic-route-nya terbukti tidak konsisten untuk
  // Serverless Functions tanpa framework.
  const { pathname, query } = parseUrl(req.url, true);
  const route = pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const method = req.method;
  req.q = Object.assign({}, query, req.query || {});

  try {
    if (route === 'login' && method === 'POST') return await handleLogin(req, res);
    if (route === 'roster') return await handleRoster(req, res);
    if (route === 'settings') return await handleSettings(req, res);
    if (route === 'qr-session' && method === 'GET') return await handleQrSession(req, res);
    if (route === 'credentials' && method === 'POST') return await handleCredentials(req, res);
    if (route === 'admins') return await handleAdmins(req, res);
    if (route === 'scan' && method === 'POST') return await handleScan(req, res);
    if (route === 'mark-pulang' && method === 'POST') return await handleMarkPulang(req, res);
    if (route === 'auto-pulang' && method === 'GET') return await handleAutoPulangCron(req, res);
    if (route === 'auto-pulang' && method === 'POST') return await handleAutoPulangManual(req, res);
    if (route === 'today' && method === 'GET') return await handleToday(req, res);
    if (route === 'history' && method === 'GET') return await handleHistory(req, res);
    if (route === 'izin' && method === 'GET') return await handleIzinList(req, res);
    if (route === 'izin' && method === 'POST') return await handleIzinAjukan(req, res);
    if (route === 'izin-approve' && method === 'POST') return await handleIzinApprove(req, res);
    if (route === 'izin-reject' && method === 'POST') return await handleIzinReject(req, res);
    if (route === 'stats' && method === 'GET') return await handleStats(req, res);

    res.status(404).json({ ok: false, message: 'Endpoint tidak ditemukan: ' + route });
  } catch (e) {
    console.error('[presensi] API error:', e);
    res.status(500).json({
      ok: false,
      message:
        e && e.message && e.message.includes('MONGODB_URI')
          ? e.message
          : 'Terjadi kesalahan server. Cek koneksi database (MONGODB_URI) dan log deployment di Vercel.'
    });
  }
};

// ---------- login ----------
async function handleLogin(req, res) {
  const { role, username, password, id } = req.body || {};

  if (role === 'admin') {
    const valid = await store.verifyAdmin(username, password);
    if (valid) {
      res.status(200).json({ ok: true, admin: { username } });
    } else {
      res.status(401).json({ ok: false, message: 'Username atau password salah.' });
    }
    return;
  }

  if (role === 'peserta') {
    const p = await store.findPeserta(id);
    if (p) {
      res.status(200).json({ ok: true, peserta: p });
    } else {
      res.status(404).json({ ok: false, message: 'ID tidak ditemukan. Hubungi admin.' });
    }
    return;
  }

  res.status(400).json({ ok: false, message: 'Role tidak valid.' });
}

// ---------- roster ----------
async function handleRoster(req, res) {
  if (req.method === 'GET') {
    const roster = await store.getRoster();
    res.status(200).json({ roster });
    return;
  }

  if (req.method === 'POST') {
    const { nama, asalKampus } = req.body || {};
    if (!nama || !String(nama).trim()) {
      res.status(400).json({ ok: false, message: 'Nama wajib diisi.' });
      return;
    }
    const item = await store.addPeserta(nama, asalKampus);
    const roster = await store.getRoster();
    res.status(200).json({ ok: true, peserta: item, roster });
    return;
  }

  if (req.method === 'DELETE') {
    const id = (req.q && req.q.id) || (req.body && req.body.id);
    await store.deletePeserta(id);
    const roster = await store.getRoster();
    res.status(200).json({ ok: true, roster });
    return;
  }

  res.status(405).json({ ok: false, message: 'Method not allowed' });
}

// ---------- settings ----------
async function handleSettings(req, res) {
  if (req.method === 'GET') {
    const settings = await store.getSettings();
    res.status(200).json(settings);
    return;
  }

  if (req.method === 'POST') {
    const { jamMasuk, toleransi, officeLat, officeLng, officeRadius } = req.body || {};
    const settings = await store.updateSettings({ jamMasuk, toleransi, officeLat, officeLng, officeRadius });
    res.status(200).json({ ok: true, settings });
    return;
  }

  res.status(405).json({ ok: false, message: 'Method not allowed' });
}

// ---------- qr-session (token QR yang ditampilkan admin, di-scan peserta) ----------
async function handleQrSession(req, res) {
  const session = await store.getOrRefreshSession();
  res.status(200).json(session);
}

// ---------- credentials (ganti username/password akun admin sendiri) ----------
async function handleCredentials(req, res) {
  const { oldUsername, username, password } = req.body || {};
  if (!oldUsername || !username || !String(username).trim() || !password || String(password).length < 4) {
    res.status(400).json({
      ok: false,
      message: 'Data tidak lengkap: username wajib diisi & password minimal 4 karakter.'
    });
    return;
  }
  const result = await store.updateCredentials(
    String(oldUsername).trim(),
    String(username).trim(),
    String(password)
  );
  res.status(result.ok ? 200 : 400).json(result);
}

// ---------- admins (kelola banyak akun admin) ----------
async function handleAdmins(req, res) {
  if (req.method === 'GET') {
    const admins = await store.getAdmins();
    res.status(200).json({ admins });
    return;
  }

  if (req.method === 'POST') {
    const { username, password } = req.body || {};
    if (!username || !String(username).trim() || !password || String(password).length < 4) {
      res.status(400).json({
        ok: false,
        message: 'Username wajib diisi & password minimal 4 karakter.'
      });
      return;
    }
    const result = await store.addAdmin(String(username).trim(), String(password));
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    const admins = await store.getAdmins();
    res.status(200).json({ ok: true, admins });
    return;
  }

  if (req.method === 'DELETE') {
    const username = (req.q && req.q.username) || (req.body && req.body.username);
    const result = await store.deleteAdmin(username);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    const admins = await store.getAdmins();
    res.status(200).json({ ok: true, admins });
    return;
  }

  res.status(405).json({ ok: false, message: 'Method not allowed' });
}

// ---------- scan ----------
async function handleScan(req, res) {
  const { id, token, lat, lng, accuracy, curigaPalsu } = req.body || {};
  const result = await store.processScan({
    pesertaId: id,
    token,
    lat: typeof lat === 'number' ? lat : parseFloat(lat),
    lng: typeof lng === 'number' ? lng : parseFloat(lng),
    accuracy: accuracy === undefined || accuracy === null ? undefined : parseFloat(accuracy),
    curigaPalsu: !!curigaPalsu
  });
  const statusCode = 'peserta' in result ? 200 : 404;
  res.status(statusCode).json(result);
}

// ---------- mark-pulang ----------
async function handleMarkPulang(req, res) {
  const { pesertaId } = req.body || {};
  const result = await store.markPulangManual(pesertaId);
  res.status(result.ok ? 200 : 400).json(result);
}

// ---------- pulang otomatis ----------

// Dipanggil oleh Vercel Cron Job tiap hari pada jam terjadwal (lihat
// vercel.json). Vercel otomatis mengirim header
// "Authorization: Bearer <CRON_SECRET>" berdasarkan environment variable
// CRON_SECRET di project settings — endpoint ini hanya jalan kalau cocok,
// supaya URL publiknya tidak bisa dipicu sembarang orang.
async function handleAutoPulangCron(req, res) {
  const expected = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'] || '';
  if (!expected || authHeader !== `Bearer ${expected}`) {
    res.status(401).json({ ok: false, message: 'Unauthorized' });
    return;
  }
  const result = await store.runAutoCheckout({ force: false });
  res.status(200).json(result);
}

// Dipanggil dari tombol "Jalankan Sekarang" di panel admin, untuk tes manual.
// Selalu jalan (force) terlepas dari toggle aktif/nonaktif, supaya admin bisa
// memverifikasi fiturnya bekerja kapan saja.
async function handleAutoPulangManual(req, res) {
  const result = await store.runAutoCheckout({ force: true });
  res.status(200).json(result);
}

// ---------- today ----------
async function handleToday(req, res) {
  const data = await store.getTodayLog();
  res.status(200).json(data);
}

// ---------- history ----------
async function handleHistory(req, res) {
  const pesertaId = req.q && req.q.pesertaId;
  if (!pesertaId) {
    res.status(400).json({ ok: false, message: 'pesertaId wajib diisi.' });
    return;
  }
  const history = await store.getHistory(pesertaId);
  res.status(200).json({ history });
}

// ---------- izin ----------
async function handleIzinList(req, res) {
  const pesertaId = req.q && req.q.pesertaId;
  const status = req.q && req.q.status;
  const izin = await store.getIzinList({ pesertaId, status });
  res.status(200).json({ izin });
}

async function handleIzinAjukan(req, res) {
  const { pesertaId, tanggal, jenis, alasan, buktiFoto } = req.body || {};
  const result = await store.ajukanIzin({ pesertaId, tanggal, jenis, alasan, buktiFoto });
  res.status(result.ok ? 200 : 400).json(result);
}

async function handleIzinApprove(req, res) {
  const { izinId } = req.body || {};
  const result = await store.approveIzin(izinId);
  res.status(result.ok ? 200 : result.message && result.message.includes('tidak ditemukan') ? 404 : 400).json(
    result
  );
}

async function handleIzinReject(req, res) {
  const { izinId } = req.body || {};
  const result = await store.rejectIzin(izinId);
  res.status(result.ok ? 200 : result.message && result.message.includes('tidak ditemukan') ? 404 : 400).json(
    result
  );
}

// ---------- statistik ----------
async function handleStats(req, res) {
  const days = (req.q && req.q.days) || '14';
  const stats = await store.getStats(days);
  res.status(200).json(stats);
}
