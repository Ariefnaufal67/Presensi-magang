const { getDB, saveDB } = require('../lib/store');

module.exports = (req, res) => {
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
    const id = (req.query && req.query.id) || (req.body && req.body.id);
    db.roster = db.roster.filter((p) => p.id !== id);
    saveDB(db);
    res.status(200).json({ ok: true, roster: db.roster });
    return;
  }

  res.status(405).json({ ok: false, message: 'Method not allowed' });
};
