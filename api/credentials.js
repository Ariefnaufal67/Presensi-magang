const { getDB, saveDB } = require('../lib/store');

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'Method not allowed' });
    return;
  }

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
};
