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
    if (route === 'credentials' && method === 'POST') return await handleCredentials(req, res);
    if (route === 'admins') return await handleAdmins(req, res);
    if (route === 'scan' && method === 'POST') return await handleScan(req, res);
    if (route === 'mark-pulang' && method === 'POST') return await handleMarkPulang(req, res);
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
  const { role, username, password, nim } = req.body || {};

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
    const p = await store.findPeserta(nim);
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
async function handleRoster(req, res) {
  if (req.method === 'GET') {
    const roster = await store.getRoster();
    res.status(200).json({ roster });
    return;
  }

  if (req.method === 'POST') {
    const { nama, nim } = req.body || {};
    if (!nama || !String(nama).trim()) {
      res.status(400).json({ ok: false, message: 'Nama wajib diisi.' });
      return;
    }
    const item = await store.addPeserta(nama, nim);
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
    const { jamMasuk, toleransi } = req.body || {};
    const settings = await store.updateSettings({ jamMasuk, toleransi });
    res.status(200).json({ ok: true, settings });
    return;
  }

  res.status(405).json({ ok: false, message: 'Method not allowed' });
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
  const { id } = req.body || {};
  const result = await store.processScan(id);
  const statusCode = 'peserta' in result ? 200 : 404;
  res.status(statusCode).json(result);
}

// ---------- mark-pulang ----------
async function handleMarkPulang(req, res) {
  const { pesertaId } = req.body || {};
  const result = await store.markPulangManual(pesertaId);
  res.status(result.ok ? 200 : 400).json(result);
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
