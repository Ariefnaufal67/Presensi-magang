const { getDB } = require('../lib/store');

module.exports = (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, message: 'Method not allowed' });
    return;
  }

  const pesertaId = req.query && req.query.pesertaId;
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
};
