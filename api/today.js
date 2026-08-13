const { getDB, todayKey } = require('../lib/store');

module.exports = (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, message: 'Method not allowed' });
    return;
  }
  const db = getDB();
  const tk = todayKey();
  res.status(200).json({ tanggal: tk, log: db.logs[tk] || [] });
};
