const { getDB, saveDB, todayKey, formatJam } = require('../lib/store');

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'Method not allowed' });
    return;
  }

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
};
