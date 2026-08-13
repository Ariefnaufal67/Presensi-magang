const { getDB, saveDB, todayKey, formatJam } = require('../lib/store');

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'Method not allowed' });
    return;
  }

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

  // Belum ada entri hari ini -> ini absen MASUK
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

  // Sudah masuk, belum pulang -> ini absen PULANG
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

  // Sudah masuk & sudah pulang hari ini -> tolak
  res.status(200).json({
    ok: false,
    peserta: p,
    message: 'Sudah tercatat pulang hari ini.'
  });
};
