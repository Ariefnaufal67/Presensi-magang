const path = require('path');
require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const store = require('./lib/store');

const app = express();
const PORT = process.env.PORT || 3000;

// Lampiran bukti izin (foto) dikirim sebagai base64 lewat JSON, jadi limit
// body default Express (100kb) dinaikkan supaya tidak ditolak.
app.use(express.json({ limit: '10mb' }));

// Serve frontend statis (public/index.html, css, js) — otomatis melayani
// index.html di path root.
app.use(express.static(path.join(__dirname, 'public')));

function handleError(res, e) {
  console.error('[presensi] API error:', e);
  res.status(500).json({
    ok: false,
    message:
      e && e.message && e.message.includes('MONGODB_URI')
        ? e.message
        : 'Terjadi kesalahan server. Cek koneksi database (MONGODB_URI) dan log server.'
  });
}

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      handleError(res, e);
    }
  };
}

// ---------- login ----------
app.post('/api/login', wrap(async (req, res) => {
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
}));

// ---------- roster ----------
app.get('/api/roster', wrap(async (req, res) => {
  const roster = await store.getRoster();
  res.status(200).json({ roster });
}));

app.post('/api/roster', wrap(async (req, res) => {
  const { nama, nim, asalKampus } = req.body || {};
  if (!nama || !String(nama).trim()) {
    res.status(400).json({ ok: false, message: 'Nama wajib diisi.' });
    return;
  }
  const item = await store.addPeserta(nama, nim, asalKampus);
  const roster = await store.getRoster();
  res.status(200).json({ ok: true, peserta: item, roster });
}));

app.delete('/api/roster', wrap(async (req, res) => {
  const id = req.query.id || (req.body && req.body.id);
  await store.deletePeserta(id);
  const roster = await store.getRoster();
  res.status(200).json({ ok: true, roster });
}));

// ---------- settings ----------
app.get('/api/settings', wrap(async (req, res) => {
  const settings = await store.getSettings();
  res.status(200).json(settings);
}));

app.post('/api/settings', wrap(async (req, res) => {
  const { jamMasuk, toleransi, officeLat, officeLng, officeRadius, jamPulangOtomatis, pulangOtomatisAktif } =
    req.body || {};
  const settings = await store.updateSettings({
    jamMasuk,
    toleransi,
    officeLat,
    officeLng,
    officeRadius,
    jamPulangOtomatis,
    pulangOtomatisAktif
  });
  res.status(200).json({ ok: true, settings });
}));

// ---------- qr-session ----------
app.get('/api/qr-session', wrap(async (req, res) => {
  const session = await store.getOrRefreshSession();
  res.status(200).json(session);
}));

// ---------- credentials ----------
app.post('/api/credentials', wrap(async (req, res) => {
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
}));

// ---------- admins ----------
app.get('/api/admins', wrap(async (req, res) => {
  const admins = await store.getAdmins();
  res.status(200).json({ admins });
}));

app.post('/api/admins', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !String(username).trim() || !password || String(password).length < 4) {
    res.status(400).json({ ok: false, message: 'Username wajib diisi & password minimal 4 karakter.' });
    return;
  }
  const result = await store.addAdmin(String(username).trim(), String(password));
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  const admins = await store.getAdmins();
  res.status(200).json({ ok: true, admins });
}));

app.delete('/api/admins', wrap(async (req, res) => {
  const username = req.query.username || (req.body && req.body.username);
  const result = await store.deleteAdmin(username);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  const admins = await store.getAdmins();
  res.status(200).json({ ok: true, admins });
}));

// ---------- scan ----------
app.post('/api/scan', wrap(async (req, res) => {
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
}));

// ---------- mark-pulang (manual, dari admin) ----------
app.post('/api/mark-pulang', wrap(async (req, res) => {
  const { pesertaId } = req.body || {};
  const result = await store.markPulangManual(pesertaId);
  res.status(result.ok ? 200 : 400).json(result);
}));

// ---------- pulang otomatis: tombol "Jalankan Sekarang" di admin ----------
// (Trigger jadwal harian sekarang ditangani node-cron di bawah, bukan lagi
// lewat endpoint publik + CRON_SECRET seperti versi Vercel — lihat blok
// cron.schedule di bagian bawah file ini.)
app.post('/api/auto-pulang', wrap(async (req, res) => {
  const result = await store.runAutoCheckout({ force: true });
  res.status(200).json(result);
}));

// ---------- today / log per tanggal ----------
app.get('/api/today', wrap(async (req, res) => {
  const data = await store.getTodayLog(req.query.tanggal);
  res.status(200).json(data);
}));

// ---------- history ----------
app.get('/api/history', wrap(async (req, res) => {
  const pesertaId = req.query.pesertaId;
  if (!pesertaId) {
    res.status(400).json({ ok: false, message: 'pesertaId wajib diisi.' });
    return;
  }
  const history = await store.getHistory(pesertaId);
  res.status(200).json({ history });
}));

// ---------- izin ----------
app.get('/api/izin', wrap(async (req, res) => {
  const { pesertaId, status } = req.query;
  const izin = await store.getIzinList({ pesertaId, status });
  res.status(200).json({ izin });
}));

app.post('/api/izin', wrap(async (req, res) => {
  const { pesertaId, tanggal, jenis, alasan, buktiFoto } = req.body || {};
  const result = await store.ajukanIzin({ pesertaId, tanggal, jenis, alasan, buktiFoto });
  res.status(result.ok ? 200 : 400).json(result);
}));

app.post('/api/izin-approve', wrap(async (req, res) => {
  const { izinId } = req.body || {};
  const result = await store.approveIzin(izinId);
  res
    .status(result.ok ? 200 : result.message && result.message.includes('tidak ditemukan') ? 404 : 400)
    .json(result);
}));

app.post('/api/izin-reject', wrap(async (req, res) => {
  const { izinId } = req.body || {};
  const result = await store.rejectIzin(izinId);
  res
    .status(result.ok ? 200 : result.message && result.message.includes('tidak ditemukan') ? 404 : 400)
    .json(result);
}));

// ---------- statistik ----------
app.get('/api/stats', wrap(async (req, res) => {
  const days = req.query.days || '14';
  const stats = await store.getStats(days);
  res.status(200).json(stats);
}));

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, message: 'Endpoint tidak ditemukan: ' + req.path });
});

// ---------- jadwal pulang otomatis (pengganti Vercel Cron) ----------
// Dijalankan tiap menit di dalam process Node yang sama (mungkin ini yang
// paling beda dari versi Vercel): server ini menyala terus, jadi kita bisa
// cek waktu Jakarta tiap menit dan cocokkan langsung ke jam yang admin atur
// di pengaturan "Pulang Otomatis" — hasilnya presisi ke menit, tidak lagi
// meleset ±1 jam seperti keterbatasan Vercel Cron di paket gratis.
let lastAutoCheckoutRunKey = null;
cron.schedule(
  '* * * * *',
  async () => {
    try {
      const settings = await store.getSettings();
      if (!settings.pulangOtomatisAktif) return;

      const now = new Date();
      const jakartaParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(now);
      const get = (type) => jakartaParts.find((p) => p.type === type).value;
      const todayKey = `${get('year')}-${get('month')}-${get('day')}`;
      const currentHM = `${get('hour')}:${get('minute')}`;
      const runKey = `${todayKey} ${currentHM}`;

      if (currentHM === settings.jamPulangOtomatis && lastAutoCheckoutRunKey !== runKey) {
        lastAutoCheckoutRunKey = runKey;
        const result = await store.runAutoCheckout({ force: false });
        console.log('[cron] pulang otomatis dijalankan:', result);
      }
    } catch (e) {
      console.error('[cron] pulang otomatis gagal:', e);
    }
  },
  { timezone: 'Asia/Jakarta' }
);

app.listen(PORT, () => {
  console.log(`[presensi] Server jalan di port ${PORT}`);
});
