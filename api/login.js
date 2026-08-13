const { getDB } = require('../lib/store');

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'Method not allowed' });
    return;
  }

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
};
