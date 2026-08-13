const { getDB, saveDB } = require('../lib/store');

module.exports = (req, res) => {
  const db = getDB();

  if (req.method === 'GET') {
    res.status(200).json({
      jamMasuk: db.settings.jamMasuk,
      toleransi: db.settings.toleransi
    });
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
};
